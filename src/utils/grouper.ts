import { Article } from "../types";

export interface ArticleGroup {
  topic: string;
  articles: Article[];
}

/**
 * Groups articles by their source name (used when AI is disabled).
 * Sources smaller than minGroupSize are collapsed into "Other".
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
    mainGroups.push({ topic: "Other", articles: otherArticles });
  }

  return mainGroups;
}

/**
 * Groups articles by their primary AI-assigned topic (topics[0]).
 *
 * - Articles with no topics are placed in "Other".
 * - Groups smaller than minGroupSize are collapsed into "Other".
 * - Groups are returned sorted by size descending (most active topic first),
 *   with "Other" always last.
 *
 * When AI is disabled and no articles have topics[], returns a single group
 * containing all articles (flat, current behaviour — no grouping).
 *
 * @param articles     - enriched articles
 * @param minGroupSize - groups below this size are merged into "Other"
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
    if (!raw) return "Other";
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
  const otherArticles: Article[] = map.get("Other") ?? [];

  for (const [topic, groupArticles] of map.entries()) {
    if (topic === "Other") continue;

    if (groupArticles.length < minGroupSize) {
      // Too small — collapse into Other
      otherArticles.push(...groupArticles);
    } else {
      mainGroups.push({ topic, articles: groupArticles });
    }
  }

  // Sort main groups by size descending
  mainGroups.sort((a, b) => b.articles.length - a.articles.length);

  // Append Other last (if non-empty)
  if (otherArticles.length > 0) {
    mainGroups.push({ topic: "Other", articles: otherArticles });
  }

  return mainGroups;
}
