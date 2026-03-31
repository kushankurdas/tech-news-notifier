export type ArticleCategory =
  | "Breaking"
  | "Release"
  | "Deep Dive"
  | "Opinion"
  | "Security"
  | "Tutorial"
  | "Miscellaneous";

export type ArticleSentiment = "positive" | "negative" | "neutral";

export interface Article {
  id: string;           // unique hash of normalised URL
  title: string;
  url: string;
  source: string;       // primary source name, e.g. "Hacker News"
  sources?: string[];   // all sources covering this story (after grouping)
  publishedAt: Date;
  excerpt: string;      // raw excerpt from feed/page (may be full-article body if fetched)
  summary?: string;     // AI-generated or fallback to excerpt
  category?: ArticleCategory;    // AI-assigned content category
  sentiment?: ArticleSentiment;  // AI-assigned tone
  relevanceScore?: number;       // AI relevance score 1–10
  topics?: string[];             // AI-extracted topic keywords
  language?: string;             // detected language code, e.g. "en"
}

export interface SourceConfig {
  name: string;
  type: "rss" | "reddit" | "scrape";
  url: string;
  enabled: boolean;
}

// ─── Cycle stats (written to data/stats.json) ─────────────────────────────────

export interface CycleStats {
  timestamp: string;
  fetched: number;
  ageFiltered: number;
  languageFiltered: number;
  blocklistFiltered: number;
  jaccardDeduped: number;
  aiDeduped: number;
  relevanceFiltered: number;
  sent: number;
  groups: number;
  trendingTopics: string[];
  sourceErrors: Record<string, number>;  // sourceName → consecutive error count
}

export interface StatsStore {
  lastCycle: CycleStats | null;
  allTime: {
    cyclesRun: number;
    totalFetched: number;
    totalSent: number;
  };
}

// ─── App config ───────────────────────────────────────────────────────────────

export interface AppConfig {
  sources: SourceConfig[];
  /** Polling interval in minutes */
  pollIntervalMinutes: number;
  /** Hours of the day to send digest notifications, e.g. [8, 18]. Empty = notify every cycle. */
  digestHours: number[];
  /** Max age of articles to process in hours */
  maxAgeHours: number;
  /** Comma-separated keywords — articles matching any are dropped */
  blocklistKeywords: string[];
  /** Whether to fetch full article body for richer AI summaries */
  fetchFullArticles: boolean;
  /** Whether to drop articles from known paywalled domains */
  filterPaywalledArticles: boolean;
  /** Number of days to retain seen article IDs before pruning */
  seenMaxAgeDays: number;
  notifiers: {
    email: {
      enabled: boolean;
      smtp: {
        host: string;
        port: number;
        secure: boolean;
        user: string;
        pass: string;
      };
      from: string;
      to: string[];
    };
    slack: {
      enabled: boolean;
      webhookUrl: string;       // incoming webhook (no threading)
      botToken?: string;        // bot token for thread support
      channelId?: string;       // required when botToken is set
      useThreads: boolean;      // post groups as thread replies
    };
  };
  ai: {
    enabled: boolean;
    /** API key for api.openai.com or compatible servers (placeholder e.g. ollama when only base URL is set). */
    openaiApiKey: string;
    /** OpenAI-compatible API root, e.g. http://localhost:11434/v1 for Ollama. Empty = default OpenAI cloud. */
    openaiBaseUrl: string;
    model: string;
    topicFilter: string;
    userContext: string;
    relevanceThreshold: number;
    minGroupSize: number;
  };
}
