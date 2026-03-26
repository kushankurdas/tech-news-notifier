import { Article } from "../types";
import { logger } from "./logger";
import { PAYWALL_DOMAINS } from "./articleFetcher";

// ─── #2 Keyword blocklist ─────────────────────────────────────────────────────

/**
 * Drops articles whose title or excerpt contains any blocklisted keyword.
 * Matching is case-insensitive and whole-substring (not word-boundary).
 */
export function applyBlocklist(articles: Article[], keywords: string[]): Article[] {
  if (keywords.length === 0) return articles;

  const kept = articles.filter((a) => {
    const haystack = `${a.title} ${a.excerpt}`.toLowerCase();
    return !keywords.some((kw) => haystack.includes(kw));
  });

  const dropped = articles.length - kept.length;
  if (dropped > 0) {
    logger.info(`Blocklist filter: dropped ${dropped} article(s), kept ${kept.length}`);
  }

  return kept;
}

// ─── #9 Language filter ───────────────────────────────────────────────────────

/**
 * Lightweight heuristic language detection — checks for a high ratio of
 * ASCII-range characters (a-z, 0-9, common punctuation). Articles that are
 * predominantly non-Latin script are flagged as non-English and dropped.
 *
 * This avoids a dependency on a heavy language-detection library while still
 * catching articles in Chinese, Japanese, Korean, Arabic, etc.
 *
 * @param text   - title + excerpt combined
 * @returns      - "en" if likely English, "unknown" otherwise
 */
function detectLanguage(text: string): "en" | "unknown" {
  if (!text || text.length < 10) return "en"; // too short to judge

  const asciiCount = (text.match(/[\x00-\x7F]/g) ?? []).length;
  const ratio = asciiCount / text.length;

  // If > 70% ASCII, treat as English-compatible
  return ratio >= 0.7 ? "en" : "unknown";
}

// ─── #3 Paywall filter ────────────────────────────────────────────────────────

/**
 * Drops articles from known paywalled domains (wsj.com, ft.com, bloomberg.com, etc.).
 * Only active when FILTER_PAYWALLED_ARTICLES=true.
 */
export function filterPaywalled(articles: Article[]): Article[] {
  const kept = articles.filter((a) => {
    try {
      const host = new URL(a.url).hostname.replace(/^www\./, "");
      return !PAYWALL_DOMAINS.has(host);
    } catch {
      return true;
    }
  });

  const dropped = articles.length - kept.length;
  if (dropped > 0) {
    logger.info(`Paywall filter: dropped ${dropped} article(s), kept ${kept.length}`);
  }

  return kept;
}

/**
 * Drops articles that appear to be non-English based on script analysis.
 * Populates article.language for downstream use.
 */
export function filterByLanguage(articles: Article[]): Article[] {
  const tagged = articles.map((a) => ({
    ...a,
    language: detectLanguage(`${a.title} ${a.excerpt}`),
  }));

  const kept = tagged.filter((a) => a.language === "en");
  const dropped = tagged.length - kept.length;

  if (dropped > 0) {
    logger.info(`Language filter: dropped ${dropped} non-English article(s), kept ${kept.length}`);
  }

  return kept;
}
