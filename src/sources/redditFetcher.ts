import axios from "axios";
import { Article, SourceConfig } from "../types";
import { hashUrl } from "../utils/hash";
import { logger } from "../utils/logger";
import { recordSuccess, recordFailure } from "../utils/sourceHealth";

interface RedditPost {
  data: {
    id: string;
    title: string;
    url: string;
    permalink: string;
    selftext: string;
    is_self: boolean;
    created_utc: number;
    subreddit: string;
    score: number;
    num_comments: number;
  };
}

interface RedditListing {
  data: {
    children: RedditPost[];
  };
}

/** #13 — retry helper */
async function withRetry<T>(fn: () => Promise<T>, retryDelayMs = 3000): Promise<T> {
  try {
    return await fn();
  } catch (firstErr: any) {
    logger.debug(`Retrying after error: ${firstErr.message}`);
    await new Promise((r) => setTimeout(r, retryDelayMs));
    return fn();
  }
}

export async function fetchRedditJSON(source: SourceConfig): Promise<Article[]> {
  try {
    logger.info(`Fetching Reddit JSON: ${source.name} (${source.url})`);

    const jsonUrl = source.url.replace(/\/?$/, ".json") + "?limit=25&raw_json=1";

    const response = await withRetry(() =>
      axios.get<RedditListing>(jsonUrl, {
        headers: {
          "User-Agent": "GossipAI/1.0 (tech news aggregator; open source)",
          Accept: "application/json",
        },
        timeout: 15000,
      })
    );

    const posts = response.data?.data?.children ?? [];
    const articles: Article[] = [];

    for (const post of posts) {
      const d = post.data;
      if (d.score < 1) continue;

      const url = d.is_self
        ? `https://www.reddit.com${d.permalink}`
        : d.url;

      let excerpt = "";
      if (d.is_self && d.selftext) {
        excerpt = d.selftext
          .replace(/\n+/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 300);
        if (d.selftext.length > 300) excerpt += "...";
      }

      articles.push({
        id: hashUrl(url),
        title: d.title.trim(),
        url,
        source: source.name,
        publishedAt: new Date(d.created_utc * 1000),
        excerpt,
      });
    }

    recordSuccess(source.name);
    logger.info(`  -> Got ${articles.length} articles from ${source.name}`);
    return articles;
  } catch (err: any) {
    recordFailure(source.name);
    logger.error(`Failed to fetch Reddit JSON for ${source.name}: ${err.message}`);
    return [];
  }
}
