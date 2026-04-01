import dotenv from "dotenv";
import { AppConfig } from "./types";

dotenv.config();

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

function optionalEnv(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export function loadConfig(): AppConfig {
  // Parse DIGEST_HOURS="8,18" → [8, 18]. Empty = notify every cycle.
  const digestHoursRaw = optionalEnv("DIGEST_HOURS", "");
  const digestHours = digestHoursRaw
    ? digestHoursRaw.split(",").map((h) => parseInt(h.trim(), 10)).filter((h) => !isNaN(h))
    : [];

  // Parse BLOCKLIST_KEYWORDS → lowercase string array
  const blocklistRaw = optionalEnv(
    "BLOCKLIST_KEYWORDS",
    "sponsored,deals,best buy,review roundup,giveaway,discount,coupon"
  );
  const blocklistKeywords = blocklistRaw
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);

  return {
    pollIntervalMinutes: parseInt(optionalEnv("POLL_INTERVAL_MINUTES", "15"), 10),
    maxAgeHours: parseInt(optionalEnv("SOURCE_MAX_AGE_HOURS", "24"), 10),
    digestHours,
    blocklistKeywords,
    fetchFullArticles: optionalEnv("FETCH_FULL_ARTICLES", "false") === "true",
    filterPaywalledArticles: optionalEnv("FILTER_PAYWALLED_ARTICLES", "false") === "true",
    seenMaxAgeDays: parseInt(optionalEnv("SEEN_MAX_AGE_DAYS", "14"), 10),

    sources: [
      {
        name: "Hacker News",
        type: "rss",
        url: "https://news.ycombinator.com/rss",
        enabled: optionalEnv("SOURCE_HN_ENABLED", "true") === "true",
      },
      {
        name: "Reddit r/programming",
        type: "reddit",
        url: "https://www.reddit.com/r/programming",
        enabled: optionalEnv("SOURCE_REDDIT_PROGRAMMING_ENABLED", "true") === "true",
      },
      {
        name: "Reddit r/webdev",
        type: "reddit",
        url: "https://www.reddit.com/r/webdev",
        enabled: optionalEnv("SOURCE_REDDIT_WEBDEV_ENABLED", "true") === "true",
      },
      {
        name: "Reddit r/javascript",
        type: "reddit",
        url: "https://www.reddit.com/r/javascript",
        enabled: optionalEnv("SOURCE_REDDIT_JS_ENABLED", "true") === "true",
      },
      {
        name: "daily.dev",
        type: "scrape",
        url: "https://api.daily.dev/graphql",
        enabled: optionalEnv("SOURCE_DAILYDEV_ENABLED", "true") === "true",
      },
      // {
      //   name: "Dev.to",
      //   type: "rss",
      //   url: "https://dev.to/feed",
      //   enabled: optionalEnv("SOURCE_DEVTO_ENABLED", "true") === "true",
      // },
      {
        name: "IEEE Spectrum",
        type: "rss",
        url: "https://spectrum.ieee.org/rss/fulltext",
        enabled: optionalEnv("SOURCE_IEEE_ENABLED", "true") === "true",
      },
      {
        name: "AWS What's New",
        type: "rss",
        url: "https://aws.amazon.com/new/feed/",
        enabled: optionalEnv("SOURCE_AWS_ENABLED", "true") === "true",
      },
      {
        name: "Techmeme",
        type: "rss",
        url: "https://www.techmeme.com/feed.xml",
        enabled: optionalEnv("SOURCE_TECHMEME_ENABLED", "true") === "true",
      },
      {
        name: "TechCrunch",
        type: "rss",
        url: "https://techcrunch.com/feed/",
        enabled: optionalEnv("SOURCE_TECHCRUNCH_ENABLED", "true") === "true",
      },
      {
        name: "Wired",
        type: "rss",
        url: "https://www.wired.com/feed/rss",
        enabled: optionalEnv("SOURCE_WIRED_ENABLED", "true") === "true",
      },
      {
        name: "Engadget",
        type: "rss",
        url: "https://www.engadget.com/rss.xml",
        enabled: optionalEnv("SOURCE_ENGADGET_ENABLED", "true") === "true",
      },
      {
        name: "InfoQ",
        type: "rss",
        url: "https://www.infoq.com/feed/",
        enabled: optionalEnv("SOURCE_INFOQ_ENABLED", "true") === "true",
      },
      {
        name: "TLDR Tech",
        type: "rss",
        url: "https://tldr.tech/api/rss/tech",
        enabled: optionalEnv("SOURCE_TLDR_ENABLED", "true") === "true",
      },
    ],

    notifiers: {
      email: {
        enabled: optionalEnv("EMAIL_ENABLED", "false") === "true",
        smtp: {
          host: optionalEnv("SMTP_HOST", "smtp.gmail.com"),
          port: parseInt(optionalEnv("SMTP_PORT", "587"), 10),
          secure: optionalEnv("SMTP_SECURE", "false") === "true",
          user: optionalEnv("SMTP_USER"),
          pass: optionalEnv("SMTP_PASS"),
        },
        from: optionalEnv("EMAIL_FROM", optionalEnv("SMTP_USER")),
        to: optionalEnv("EMAIL_TO", "")
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean),
      },
      slack: {
        enabled: optionalEnv("SLACK_ENABLED", "false") === "true",
        webhookUrl: optionalEnv("SLACK_WEBHOOK_URL"),
        botToken: optionalEnv("SLACK_BOT_TOKEN") || undefined,
        channelId: optionalEnv("SLACK_CHANNEL_ID") || undefined,
        useThreads: optionalEnv("SLACK_USE_THREADS", "false") === "true",
      },
    },

    ai: (() => {
      const openaiBaseUrl = optionalEnv("OPENAI_BASE_URL").trim().replace(/\/$/, "");
      const openaiApiKeyRaw = optionalEnv("OPENAI_API_KEY").trim();
      const anthropicApiKey = optionalEnv("ANTHROPIC_API_KEY").trim();
      const enabled = !!(openaiApiKeyRaw || openaiBaseUrl || anthropicApiKey);
      const openaiApiKey = openaiApiKeyRaw || (openaiBaseUrl ? "ollama" : "");
      return {
        enabled,
        openaiApiKeyRaw,
        openaiApiKey,
        openaiBaseUrl,
        model: optionalEnv("OPENAI_MODEL", "gpt-4o-mini"),
        anthropicApiKey,
        anthropicModel: optionalEnv("ANTHROPIC_MODEL", "claude-3-5-haiku-20241022"),
        topicFilter: optionalEnv(
          "AI_TOPIC_FILTER",
          "software engineering, AI/ML, cloud infrastructure, developer tools, cybersecurity, open source"
        ),
        userContext: optionalEnv("AI_USER_CONTEXT", ""),
        relevanceThreshold: parseInt(optionalEnv("AI_RELEVANCE_THRESHOLD", "5"), 10),
        minGroupSize: parseInt(optionalEnv("AI_MIN_GROUP_SIZE", "2"), 10),
      };
    })(),
  };
}
