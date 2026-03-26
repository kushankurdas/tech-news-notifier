import { Article, AppConfig } from "../types";
import { fetchRssFeed } from "./rssFetcher";
import { fetchRedditJSON } from "./redditFetcher";
import { fetchDailyDev } from "./dailyDevScraper";
import { logger } from "../utils/logger";

export async function fetchAllSources(config: AppConfig): Promise<Article[]> {
  const enabledSources = config.sources.filter((s) => s.enabled);
  logger.info(`Polling ${enabledSources.length} enabled source(s)...`);

  const results = await Promise.allSettled(
    enabledSources.map((source) => {
      if (source.type === "reddit") {
        return fetchRedditJSON(source);
      }
      if (source.type === "scrape" && source.name === "daily.dev") {
        return fetchDailyDev(source);
      }
      if (source.type === "rss") {
        return fetchRssFeed(source);
      }
      logger.warn(`Unknown source type "${source.type}" for "${source.name}", skipping.`);
      return Promise.resolve([] as Article[]);
    })
  );

  const allArticles: Article[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      allArticles.push(...result.value);
    }
  }

  // Drop articles older than maxAgeHours
  const cutoff = new Date(Date.now() - config.maxAgeHours * 60 * 60 * 1000);
  const fresh = allArticles.filter((a) => a.publishedAt >= cutoff);
  const dropped = allArticles.length - fresh.length;
  if (dropped > 0) {
    logger.info(`Age filter (${config.maxAgeHours}h): dropped ${dropped} old article(s), kept ${fresh.length}`);
  }

  // Deduplicate by id within this batch (same article can appear in multiple feeds)
  const seen = new Set<string>();
  return fresh.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}
