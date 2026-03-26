import { Article } from "../types";
import { logger } from "./logger";

/**
 * Feature #2 — Relevance filtering.
 *
 * Drops articles whose AI-assigned relevanceScore is below the configured
 * threshold. Articles without a score (AI disabled / fallback) have
 * relevanceScore set to 10 by enrichArticles(), so they always pass.
 *
 * @param articles  - AI-enriched articles
 * @param threshold - minimum score to keep (1–10, from config.ai.relevanceThreshold)
 */
export function filterByRelevance(articles: Article[], threshold: number): Article[] {
  if (threshold <= 1) return articles; // nothing to filter

  const kept = articles.filter((a) => (a.relevanceScore ?? 10) >= threshold);
  const dropped = articles.length - kept.length;

  if (dropped > 0) {
    logger.info(
      `Relevance filter (threshold ${threshold}): dropped ${dropped} article(s), kept ${kept.length}`
    );
  }

  return kept;
}
