import { Article } from "../types";
import { logger } from "./logger";

export interface TrendingTopic {
  topic: string;
  count: number;
}

/**
 * Feature #4 — Trending topic detection.
 *
 * Flattens all topics[] arrays across every article in the batch, counts
 * how many distinct articles mention each topic, and returns those that
 * appear in >= minCount articles — sorted by count descending.
 *
 * Topics are normalised to title-case so "ai", "AI", and "Ai" all count
 * as the same topic.
 *
 * @param articles  - enriched articles with topics[] populated
 * @param minCount  - minimum mentions to be considered trending (default 3)
 */
export function detectTrends(
  articles: Article[],
  minCount = 3
): TrendingTopic[] {
  const counts = new Map<string, number>();

  for (const article of articles) {
    if (!article.topics?.length) continue;

    // Deduplicate topics within the same article before counting
    const seen = new Set<string>();
    for (const raw of article.topics) {
      const normalised = raw.trim().replace(/\b\w/g, (c) => c.toUpperCase());
      if (!normalised || seen.has(normalised)) continue;
      seen.add(normalised);
      counts.set(normalised, (counts.get(normalised) ?? 0) + 1);
    }
  }

  const trending = [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort(([, a], [, b]) => b - a)
    .map(([topic, count]) => ({ topic, count }));

  if (trending.length > 0) {
    logger.info(
      `Trending topics: ${trending.map((t) => `${t.topic} (${t.count})`).join(", ")}`
    );
  }

  return trending;
}
