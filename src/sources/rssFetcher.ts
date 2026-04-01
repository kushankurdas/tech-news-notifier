import Parser from "rss-parser";
import { Article, SourceConfig } from "../types";
import { hashUrl } from "../utils/hash";
import { logger } from "../utils/logger";
import { recordSuccess, recordFailure } from "../utils/sourceHealth";

const parser = new Parser({
  customFields: {
    item: [["media:thumbnail", "mediaThumbnail"]],
  },
  headers: {
    "User-Agent": "GossipAI/1.0 (RSS Reader)",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
  },
  timeout: 10000,
});

function toExcerpt(raw: string | undefined): string {
  if (!raw) return "";
  const text = raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 300 ? text.slice(0, 297) + "..." : text;
}

/** #13 — retry helper: try once, wait retryDelayMs, try once more */
async function withRetry<T>(fn: () => Promise<T>, retryDelayMs = 3000): Promise<T> {
  try {
    return await fn();
  } catch (firstErr: any) {
    logger.debug(`Retrying after error: ${firstErr.message}`);
    await new Promise((r) => setTimeout(r, retryDelayMs));
    return fn(); // let second error propagate
  }
}

export async function fetchRssFeed(source: SourceConfig): Promise<Article[]> {
  try {
    logger.info(`Fetching RSS: ${source.name} (${source.url})`);

    const feed = await withRetry(() => parser.parseURL(source.url));
    const articles: Article[] = [];

    for (const item of feed.items ?? []) {
      const url = item.link ?? item.guid ?? "";
      if (!url) continue;

      const rawExcerpt = toExcerpt(item.contentSnippet ?? item.content ?? item.summary ?? "");
      const excerpt = /^comments?\b/i.test(rawExcerpt) ? "" : rawExcerpt;

      articles.push({
        id: hashUrl(url),
        title: item.title?.trim() ?? "(no title)",
        url,
        source: source.name,
        publishedAt: item.isoDate ? new Date(item.isoDate) : new Date(),
        excerpt,
      });
    }

    recordSuccess(source.name);
    logger.info(`  -> Got ${articles.length} articles from ${source.name}`);
    return articles;
  } catch (err: any) {
    recordFailure(source.name);
    logger.error(`Failed to fetch RSS for ${source.name}: ${err.message}`);
    return [];
  }
}
