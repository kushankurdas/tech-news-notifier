import axios from "axios";
import { Article, SourceConfig } from "../types";
import { hashUrl } from "../utils/hash";
import { logger } from "../utils/logger";
import { recordSuccess, recordFailure } from "../utils/sourceHealth";

const DAILY_DEV_API = "https://api.daily.dev/graphql";

const POPULAR_FEED_QUERY = `
  query AnonymousFeed($first: Int) {
    anonymousFeed(first: $first, ranking: POPULARITY) {
      edges {
        node {
          id
          title
          permalink
          summary
          createdAt
          source {
            name
          }
        }
      }
    }
  }
`;

interface DailyDevPost {
  id: string;
  title: string;
  permalink: string;
  summary: string | null;
  createdAt: string;
  source: { name: string };
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

export async function fetchDailyDev(_source: SourceConfig): Promise<Article[]> {
  try {
    logger.info(`Fetching daily.dev popular feed via GraphQL...`);

    const response = await withRetry(() =>
      axios.post(
        DAILY_DEV_API,
        { query: POPULAR_FEED_QUERY, variables: { first: 20 } },
        {
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "TechNewsNotifier/1.0 (tech news aggregator)",
            Referer: "https://app.daily.dev/",
          },
          timeout: 30000,
        }
      )
    );

    const edges: { node: DailyDevPost }[] =
      response.data?.data?.anonymousFeed?.edges ?? [];

    if (edges.length === 0) {
      logger.warn("daily.dev returned 0 edges — feed may be empty or schema changed.");
    }

    const articles: Article[] = edges.map(({ node }) => {
      const excerpt = node.summary
        ? node.summary.length > 300
          ? node.summary.slice(0, 297) + "..."
          : node.summary
        : "";

      return {
        id: hashUrl(node.permalink),
        title: node.title?.trim() ?? "(no title)",
        url: node.permalink,
        source: `daily.dev (${node.source?.name ?? "unknown"})`,
        publishedAt: new Date(node.createdAt),
        excerpt,
      };
    });

    recordSuccess("daily.dev");
    logger.info(`  -> Got ${articles.length} articles from daily.dev`);
    return articles;
  } catch (err: any) {
    recordFailure("daily.dev");
    logger.error(`daily.dev GraphQL failed: ${err.message}`);
    return [];
  }
}
