import axios from "axios";
import { Article, AppConfig } from "../types";
import { TrendingTopic } from "../utils/trendDetector";
import { groupArticlesByTopic } from "../utils/grouper";
import { logger } from "../utils/logger";

// ─── Constants ────────────────────────────────────────────────────────────────

const ARTICLES_PER_MESSAGE = 14;

// ─── Dynamic digest title ─────────────────────────────────────────────────────

const TIME_OF_DAY: Array<{ from: number; to: number; label: string }> = [
  { from:  6, to: 11, label: "Morning Briefing" },
  { from: 12, to: 17, label: "Afternoon Update" },
  { from: 18, to: 21, label: "Evening Roundup" },
  { from: 22, to: 23, label: "Late Night" },
  { from:  0, to:  5, label: "Late Night" },
];

function digestTitle(): string {
  const now   = new Date();
  const hour  = now.getHours();
  const day   = now.toLocaleDateString("en-US", { weekday: "short" });
  const date  = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const slot  = TIME_OF_DAY.find((s) =>
    hour >= s.from && hour <= s.to
  ) ?? { label: "Update" };

  return `Tech News Digest — ${day} ${date} · ${slot.label}`;
}

// ─── Category / sentiment helpers ────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  Breaking:    "*[Breaking]*",
  Release:     "*[Release]*",
  "Deep Dive": "*[Deep Dive]*",
  Opinion:     "*[Opinion]*",
  Security:    "*[Security]*",
  Tutorial:    "*[Tutorial]*",
  Miscellaneous:  "*[Miscellaneous]*",
};

const SENTIMENT_EMOJI: Record<string, string> = {
  positive: ":large_green_circle:",
  negative: ":red_circle:",
  neutral:  ":white_circle:",
};

function categoryLabel(category: string | undefined): string {
  if (!category) return "";
  return CATEGORY_LABELS[category] ?? `*[${category}]*`;
}

function sentimentEmoji(sentiment: string | undefined): string {
  if (!sentiment) return "";
  return SENTIMENT_EMOJI[sentiment] ?? "";
}

// ─── Slack escape ─────────────────────────────────────────────────────────────

function escapeSlack(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

/** Incoming webhook — no threading support */
async function postViaWebhook(webhookUrl: string, blocks: object[]): Promise<void> {
  await axios.post(
    webhookUrl,
    { blocks, unfurl_links: false, unfurl_media: false },
    { headers: { "Content-Type": "application/json" }, timeout: 10000 }
  );
}

/**
 * Web API post — returns thread_ts of the posted message so replies can
 * be attached to it.
 */
async function postViaAPI(
  botToken: string,
  channelId: string,
  blocks: object[],
  threadTs?: string
): Promise<string | undefined> {
  const payload: Record<string, any> = {
    channel: channelId,
    blocks,
    unfurl_links: false,
    unfurl_media: false,
  };
  if (threadTs) payload.thread_ts = threadTs;

  const response = await axios.post(
    "https://slack.com/api/chat.postMessage",
    payload,
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${botToken}`,
      },
      timeout: 10000,
    }
  );

  if (!response.data.ok) {
    throw new Error(`Slack API error: ${response.data.error}`);
  }

  return response.data.ts as string | undefined;
}

// ─── Block builders ───────────────────────────────────────────────────────────

function buildTrendingIntroBlocks(
  trending: TrendingTopic[],
  totalArticles: number,
  totalGroups: number,
  risingTopics: string[] = []
): object[] {
  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: digestTitle(), emoji: true },
    },
    { type: "divider" },
  ];

  if (trending.length > 0) {
    const trendText = trending
      .slice(0, 6)
      .map((t) => `*${escapeSlack(t.topic)}* (${t.count})`)
      .join("   ");
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `Trending:   ${trendText}` }],
    });
  }

  if (risingTopics.length > 0) {
    const risingText = risingTopics.map((t) => `\`${escapeSlack(t)}\``).join("  ");
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `:chart_with_upwards_trend: *Rising:*   ${risingText}` }],
    });
  }

  blocks.push({
    type: "context",
    elements: [{
      type: "mrkdwn",
      text: `${totalArticles} ${totalArticles === 1 ? "story" : "stories"} across ${totalGroups} topic ${totalGroups === 1 ? "group" : "groups"}`,
    }],
  });

  return blocks;
}

function buildGroupHeaderBlocks(topic: string, count: number): object[] {
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${topic}  —  ${count} ${count === 1 ? "article" : "articles"}`,
        emoji: true,
      },
    },
    { type: "divider" },
  ];
}

function buildArticleBlocks(articles: Article[]): object[] {
  const blocks: object[] = [];

  for (const a of articles) {
    const label   = categoryLabel(a.category);
    const emoji   = sentimentEmoji(a.sentiment);
    const prefix  = [emoji, label].filter(Boolean).join("  ");
    const titleLine = prefix
      ? `${prefix}  *<${a.url}|${escapeSlack(a.title)}>*`
      : `*<${a.url}|${escapeSlack(a.title)}>*`;

    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${titleLine}\n${escapeSlack(a.summary ?? a.excerpt)}`,
        },
      },
      {
        type: "context",
        elements: [{
          type: "mrkdwn",
          text: `${escapeSlack((a.sources ?? [a.source]).join("  ·  "))}  ·  <!date^${Math.floor(a.publishedAt.getTime() / 1000)}^{date_short_pretty} at {time}|${a.publishedAt.toUTCString()}>`,
        }],
      },
      { type: "divider" }
    );
  }

  return blocks;
}

// ─── Core send logic ──────────────────────────────────────────────────────────

async function sendBlocks(
  config: AppConfig,
  blocks: object[],
  threadTs?: string
): Promise<string | undefined> {
  const { slack } = config.notifiers;

  if (slack.botToken && slack.channelId) {
    return postViaAPI(slack.botToken, slack.channelId, blocks, threadTs);
  }

  if (slack.webhookUrl) {
    await postViaWebhook(slack.webhookUrl, blocks);
    return undefined;
  }

  throw new Error("No Slack delivery method configured (need SLACK_WEBHOOK_URL or SLACK_BOT_TOKEN + SLACK_CHANNEL_ID)");
}

// ─── Public notifier ──────────────────────────────────────────────────────────

/**
 * Sends one message per topic group.
 *
 * Thread mode (SLACK_USE_THREADS=true + SLACK_BOT_TOKEN + SLACK_CHANNEL_ID):
 *   • Posts the trending intro as the parent message
 *   • Each topic group is posted as a thread reply — one tidy item in the channel
 *
 * Webhook mode (fallback):
 *   • Same as before — separate top-level messages per group
 */
export async function sendSlackNotification(
  articles: Article[],
  config: AppConfig,
  trending: TrendingTopic[] = [],
  risingTopics: string[] = []
): Promise<void> {
  const { slack } = config.notifiers;
  if (!slack.enabled || articles.length === 0) return;

  const hasDelivery = slack.webhookUrl || (slack.botToken && slack.channelId);
  if (!hasDelivery) {
    logger.warn("Slack notifier: no delivery method configured. Skipping.");
    return;
  }

  const groups = groupArticlesByTopic(articles, config.ai.minGroupSize);
  const isGrouped = groups.length > 1;
  const useThreads = slack.useThreads && !!(slack.botToken && slack.channelId);

  // ── Send intro ────────────────────────────────────────────────────────────
  let parentTs: string | undefined;

  if (useThreads || (trending.length > 0 && isGrouped) || groups.length > 1) {
    try {
      parentTs = await sendBlocks(
        config,
        buildTrendingIntroBlocks(trending, articles.length, groups.length, risingTopics)
      );
      logger.info(`Slack: sent digest intro (${groups.length} groups, ${articles.length} articles)`);
      if (!useThreads) await new Promise((r) => setTimeout(r, 500));
    } catch (err: any) {
      logger.error(`Slack intro failed: ${err.message}`);
    }
  }

  // ── Send groups ───────────────────────────────────────────────────────────
  for (const group of groups) {
    const chunks: Article[][] = [];
    for (let i = 0; i < group.articles.length; i += ARTICLES_PER_MESSAGE) {
      chunks.push(group.articles.slice(i, i + ARTICLES_PER_MESSAGE));
    }

    for (let idx = 0; idx < chunks.length; idx++) {
      const chunk = chunks[idx];
      const headerBlocks = idx === 0 ? buildGroupHeaderBlocks(group.topic, group.articles.length) : [];
      const blocks = [...headerBlocks, ...buildArticleBlocks(chunk)];

      // In thread mode, first chunk of each group is a reply to the intro;
      // subsequent chunks are also replies (keeps the thread tidy).
      const replyTo = useThreads ? parentTs : undefined;

      try {
        await sendBlocks(config, blocks, replyTo);
        logger.info(`Slack: sent group "${group.topic}" chunk ${idx + 1}/${chunks.length} (${chunk.length} articles)${replyTo ? " [thread]" : ""}`);
      } catch (err: any) {
        logger.error(`Slack notification failed for group "${group.topic}": ${err.message}`);
      }

      if (idx < chunks.length - 1) await new Promise((r) => setTimeout(r, 500));
    }

    if (!useThreads && group !== groups[groups.length - 1]) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
