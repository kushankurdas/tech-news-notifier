import { Article } from "../types";

export interface ArticleGroup {
  topic: string;
  articles: Article[];
}

/**
 * Groups articles by their source name (used when AI is disabled).
 * Sources smaller than minGroupSize are collapsed into "Miscellaneous".
 */
function groupBySource(articles: Article[], minGroupSize: number): ArticleGroup[] {
  const map = new Map<string, Article[]>();

  for (const article of articles) {
    // Normalise source — strip daily.dev sub-source suffix e.g. "daily.dev (GitHub)"
    const source = article.source.replace(/\s*\(.*\)$/, "").trim();
    if (!map.has(source)) map.set(source, []);
    map.get(source)!.push(article);
  }

  const mainGroups: ArticleGroup[] = [];
  const otherArticles: Article[] = [];

  for (const [source, groupArticles] of map.entries()) {
    if (groupArticles.length < minGroupSize) {
      otherArticles.push(...groupArticles);
    } else {
      mainGroups.push({ topic: source, articles: groupArticles });
    }
  }

  // Sort by size descending
  mainGroups.sort((a, b) => b.articles.length - a.articles.length);

  if (otherArticles.length > 0) {
    mainGroups.push({ topic: "Miscellaneous", articles: otherArticles });
  }

  return mainGroups;
}

/**
 * Groups articles by their primary AI-assigned topic (topics[0]).
 *
 * - Articles with no topics are placed in "Miscellaneous".
 * - Groups smaller than minGroupSize are collapsed into "Miscellaneous".
 * - Groups are returned sorted by size descending (most active topic first),
 *   with "Miscellaneous" always last.
 *
 * When AI is disabled and no articles have topics[], returns a single group
 * containing all articles (flat, current behaviour — no grouping).
 *
 * @param articles     - enriched articles
 * @param minGroupSize - groups below this size are merged into "Miscellaneous"
 */
export function groupArticlesByTopic(
  articles: Article[],
  minGroupSize = 2
): ArticleGroup[] {
  // If no article has topics, AI is disabled — group by source instead
  const hasTopics = articles.some((a) => a.topics && a.topics.length > 0);
  if (!hasTopics) {
    return groupBySource(articles, minGroupSize);
  }

  // Normalise primary topic to title-case
  function primaryTopic(a: Article): string {
    const raw = a.topics?.[0]?.trim();
    if (!raw) return "Miscellaneous";
    return raw.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Build topic → articles map
  const map = new Map<string, Article[]>();
  for (const article of articles) {
    const topic = primaryTopic(article);
    if (!map.has(topic)) map.set(topic, []);
    map.get(topic)!.push(article);
  }

  const mainGroups: ArticleGroup[] = [];
  const otherArticles: Article[] = map.get("Miscellaneous") ?? [];

  for (const [topic, groupArticles] of map.entries()) {
    if (topic === "Miscellaneous") continue;

    if (groupArticles.length < minGroupSize) {
      // Too small — collapse into Other
      otherArticles.push(...groupArticles);
    } else {
      mainGroups.push({ topic, articles: groupArticles });
    }
  }

  // Sort main groups by size descending
  mainGroups.sort((a, b) => b.articles.length - a.articles.length);

  // Split overflow articles by their AI category rather than dumping them all
  // into one Miscellaneous group (e.g. Breaking/Security/Release get own sections)
  const CATEGORY_ORDER = ["Breaking", "Security", "Release", "Tutorial", "Deep Dive", "Opinion"];
  const categoryBuckets = new Map<string, Article[]>();
  const trueOther: Article[] = [];

  for (const a of otherArticles) {
    const cat = a.category;
    if (cat && cat !== "Miscellaneous" && CATEGORY_ORDER.includes(cat)) {
      if (!categoryBuckets.has(cat)) categoryBuckets.set(cat, []);
      categoryBuckets.get(cat)!.push(a);
    } else {
      trueOther.push(a);
    }
  }

  for (const cat of CATEGORY_ORDER) {
    const arts = categoryBuckets.get(cat);
    if (arts && arts.length > 0) {
      mainGroups.push({ topic: cat, articles: arts });
    }
  }

  if (trueOther.length > 0) {
    mainGroups.push({ topic: "Miscellaneous", articles: trueOther });
  }

  return mainGroups;
}
