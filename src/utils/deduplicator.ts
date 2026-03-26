import { Article } from "../types";
import { logger } from "./logger";

// ─── Shared helper ────────────────────────────────────────────────────────────

/**
 * Given a group of articles covering the same story, pick the representative
 * (longest excerpt = most context) and merge all source names.
 */
function mergeGroup(group: Article[]): Article {
  if (group.length === 1) return { ...group[0], sources: [group[0].source] };

  const best = group.reduce((a, b) =>
    (b.excerpt?.length ?? 0) > (a.excerpt?.length ?? 0) ? b : a
  );
  const allSources = [...new Set(group.map((a) => a.source))];
  return { ...best, sources: allSources, source: allSources[0] };
}

/**
 * Normalises a title for comparison:
 * - lowercase
 * - strip punctuation / stop words
 * - split into a Set of meaningful words
 */
function titleWords(title: string): Set<string> {
  const STOP_WORDS = new Set([
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "has", "have", "had", "it", "its", "this", "that", "as", "up", "how",
    "why", "what", "when", "who", "will", "can", "do", "not", "new", "via",
  ]);

  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  return new Set(words);
}

/**
 * Jaccard similarity between two sets.
 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((w) => b.has(w)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

/**
 * Groups articles that cover the same story (title similarity >= threshold).
 * Returns one representative article per group with merged source names.
 *
 * The representative is the article with the longest excerpt (most context).
 */
export function deduplicateArticles(
  articles: Article[],
  threshold = 0.45
): Article[] {
  const wordSets = articles.map((a) => titleWords(a.title));
  const grouped: boolean[] = new Array(articles.length).fill(false);
  const result: Article[] = [];

  for (let i = 0; i < articles.length; i++) {
    if (grouped[i]) continue;

    const group: Article[] = [articles[i]];
    grouped[i] = true;

    for (let j = i + 1; j < articles.length; j++) {
      if (grouped[j]) continue;
      if (jaccard(wordSets[i], wordSets[j]) >= threshold) {
        group.push(articles[j]);
        grouped[j] = true;
      }
    }

    const merged = mergeGroup(group);

    if (group.length > 1) {
      logger.debug(
        `Jaccard grouped "${merged.title}" from ${group.length} source(s): ${merged.sources!.join(", ")}`
      );
    }

    result.push(merged);
  }

  logger.info(
    `Jaccard dedup: ${articles.length} articles → ${result.length} unique stories`
  );

  return result;
}

// ─── Feature #1 — AI semantic deduplication ───────────────────────────────────

/**
 * Second-pass deduplication using clusterId values assigned by the AI enrichment
 * call. Articles with the same clusterId cover the same story semantically,
 * even when their headlines are phrased differently (Jaccard would miss these).
 *
 * Must be called AFTER enrichArticles() so that _clusterId is populated.
 *
 * @param articles - already Jaccard-deduped, AI-enriched articles
 */
export function applyAIClusters(
  articles: Array<Article & { _clusterId: number }>
): Article[] {
  const groups = new Map<number, Array<Article & { _clusterId: number }>>();

  for (const a of articles) {
    const id = a._clusterId;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(a);
  }

  const result: Article[] = [];

  for (const group of groups.values()) {
    const merged = mergeGroup(group);

    if (group.length > 1) {
      logger.debug(
        `AI cluster grouped "${merged.title}" from ${group.length} source(s): ${merged.sources!.join(", ")}`
      );
    }

    // Strip internal _clusterId before returning
    const { _clusterId: _dropped, ...clean } = merged as Article & { _clusterId: number };
    result.push(clean);
  }

  if (result.length < articles.length) {
    logger.info(
      `AI semantic dedup: ${articles.length} articles → ${result.length} unique stories`
    );
  }

  return result;
}
