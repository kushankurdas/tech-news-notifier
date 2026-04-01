import axios from "axios";
import * as cheerio from "cheerio";
import { Article } from "../types";
import { logger } from "./logger";

// Max characters of body text to keep as excerpt (feeds AI with more context)
const MAX_EXCERPT = 1200;

// Domains known to block scrapers or return paywalled content — skip these.
// Also used by filterPaywalled() in filters.ts to drop articles from these sources.
export const PAYWALL_DOMAINS = new Set([
  "reddit.com", "twitter.com", "x.com", "youtube.com",
  "linkedin.com", "facebook.com", "instagram.com",
  "wsj.com", "ft.com", "bloomberg.com", "nytimes.com", "thetimes.co.uk",
]);

function shouldSkip(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return PAYWALL_DOMAINS.has(host);
  } catch {
    return false;
  }
}

/**
 * Fetches the full body text of an article URL using cheerio.
 * Strips nav/header/footer/ads and returns plain text up to MAX_EXCERPT chars.
 * Returns null if the fetch fails or should be skipped.
 */
async function fetchArticleBody(url: string): Promise<string | null> {
  if (shouldSkip(url)) return null;

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; GossipAI/1.0; +https://github.com/kushankurdas/tech-news-notifier)",
        Accept: "text/html",
      },
      timeout: 8000,
      maxRedirects: 3,
      // Limit response size to 500KB to avoid huge pages
      maxContentLength: 512 * 1024,
    });

    const $ = cheerio.load(response.data as string);

    // Remove noise elements
    $("script, style, noscript, nav, header, footer, aside, .ad, .ads, .advertisement, " +
      ".sidebar, .related, .comments, [aria-hidden=true]").remove();

    // Try paragraph-scoped selectors first — avoids title/date/tag noise at the top of articles
    const paragraphSelectors = [
      "article p",
      '[role="main"] p',
      ".article-body p",
      ".post-content p",
      ".entry-content p",
      ".content-body p",
      "main p",
    ];

    let text = "";
    for (const sel of paragraphSelectors) {
      const els = $(sel);
      if (els.length) {
        text = els.map((_, el) => $(el).text()).get().join(" ");
        if (text.trim().length >= 50) break;
        text = ""; // too short — likely empty paragraphs, try next
      }
    }

    // Fall back to full container text if no paragraphs found
    if (!text) {
      const containerSelectors = [
        "article",
        '[role="main"]',
        ".article-body",
        ".post-content",
        ".entry-content",
        ".content-body",
        "main",
      ];
      for (const sel of containerSelectors) {
        const el = $(sel);
        if (el.length) {
          text = el.text();
          break;
        }
      }
    }

    if (!text) text = $("body").text();

    // Normalise whitespace
    text = text.replace(/\s+/g, " ").trim();

    return text.length > MAX_EXCERPT ? text.slice(0, MAX_EXCERPT) + "..." : text;
  } catch {
    // Silent — full-fetch is best-effort
    return null;
  }
}

/**
 * #7 — Enriches articles with full body text when FETCH_FULL_ARTICLES=true.
 * Fetches articles concurrently (up to CONCURRENCY at a time) and replaces
 * the excerpt with the fuller body text if the fetch succeeds.
 *
 * Falls back to the original excerpt on any failure.
 */
export async function enrichWithFullArticles(articles: Article[]): Promise<Article[]> {
  const CONCURRENCY = 5;
  const results: Article[] = [...articles];

  for (let i = 0; i < articles.length; i += CONCURRENCY) {
    const batch = articles.slice(i, i + CONCURRENCY);
    const bodies = await Promise.allSettled(batch.map((a) => fetchArticleBody(a.url)));

    for (let j = 0; j < batch.length; j++) {
      const result = bodies[j];
      if (result.status === "fulfilled" && result.value && result.value.length >= 100 && result.value.length > batch[j].excerpt.length) {
        results[i + j] = { ...batch[j], excerpt: result.value };
      }
    }
  }

  logger.info(`Full article fetch: enriched ${articles.length} article(s)`);
  return results;
}
