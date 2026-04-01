import { AppConfig } from "./types";
import { loadConfig } from "./config";
import { loadSeenStore } from "./utils/seenStore";
import { runPollCycle } from "./poller";
import { logger } from "./utils/logger";

// ─── #1 Digest buffer ─────────────────────────────────────────────────────────
// When DIGEST_HOURS is set, article notifications are held until the next
// digest hour rather than firing every cycle.
import type { Article } from "./types";
let pendingDigestArticles: Article[] = [];
let lastDigestHour = -1;

// ─── #14 Graceful shutdown ────────────────────────────────────────────────────
let isShuttingDown = false;
let activeCyclePromise: Promise<void> | null = null;

async function main(): Promise<void> {
  logger.info("Gossip AI starting up...");

  const config = loadConfig();

  const notifierCount = [
    config.notifiers.email.enabled,
    config.notifiers.slack.enabled,
  ].filter(Boolean).length;

  if (notifierCount === 0) {
    logger.warn("No notifiers are enabled! Set EMAIL_ENABLED=true and/or SLACK_ENABLED=true.");
  }

  const enabledSources = config.sources.filter((s) => s.enabled);
  logger.info(`Sources enabled: ${enabledSources.map((s) => s.name).join(", ") || "none"}`);
  logger.info(`Poll interval: every ${config.pollIntervalMinutes} minute(s)`);

  if (config.digestHours.length > 0) {
    logger.info(`Digest mode: notifications at hour(s) ${config.digestHours.join(", ")} (local time)`);
  }

  if (config.ai.enabled) {
    const chain: string[] = [];
    if (config.ai.openaiApiKeyRaw && !config.ai.openaiBaseUrl) {
      chain.push(`OpenAI (${config.ai.model})`);
    }
    if (config.ai.anthropicApiKey) {
      chain.push(`Anthropic (${config.ai.anthropicModel})`);
    }
    if (config.ai.openaiBaseUrl) {
      chain.push(`local LLM (${config.ai.model} @ ${config.ai.openaiBaseUrl})`);
    }
    logger.info(`AI: enabled — try in order: ${chain.join(" → ")}`);
  } else {
    logger.info("AI: disabled (using excerpts)");
  }

  if (config.fetchFullArticles) {
    logger.info("Full article fetch: enabled");
  }

  loadSeenStore();

  // ── Graceful shutdown handlers ─────────────────────────────────────────
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info(`Received ${signal}. Finishing current cycle before exit...`);
    if (activeCyclePromise) {
      try { await activeCyclePromise; } catch { /* already logged */ }
    }
    logger.info("Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));

  // ── First poll on startup ──────────────────────────────────────────────
  if (!isShuttingDown) {
    activeCyclePromise = runCycle(config);
    await activeCyclePromise;
    activeCyclePromise = null;
  }

  // ── Recurring polls ────────────────────────────────────────────────────
  const intervalMs = config.pollIntervalMinutes * 60 * 1000;

  const timer = setInterval(async () => {
    if (isShuttingDown) { clearInterval(timer); return; }

    try {
      activeCyclePromise = runCycle(config);
      await activeCyclePromise;
    } catch (err: any) {
      logger.error(`Unhandled error in poll cycle: ${err.message}`);
    } finally {
      activeCyclePromise = null;
    }

    if (!isShuttingDown) {
      logger.info(`Next poll in ${config.pollIntervalMinutes} minute(s)...`);
    }
  }, intervalMs);

  logger.info(`Next poll in ${config.pollIntervalMinutes} minute(s)...`);
}

// ─── Digest-aware cycle ───────────────────────────────────────────────────────

async function runCycle(config: AppConfig): Promise<void> {
  if (config.digestHours.length === 0) {
    // Normal mode: notify immediately every cycle
    return runPollCycle(config);
  }

  // Digest mode: run the full pipeline but suppress notifications,
  // accumulate results, and flush at digest hours.
  const { sendEmailNotification } = await import("./notifiers/emailNotifier");
  const { sendSlackNotification } = await import("./notifiers/slackNotifier");
  const { detectTrends }          = await import("./utils/trendDetector");
  const { fetchAllSources }       = await import("./sources");
  const { filterNew, markAsSeen, saveSeenStore } = await import("./utils/seenStore");
  const { enrichArticles }        = await import("./utils/summarizer");
  const { deduplicateArticles, applyAIClusters } = await import("./utils/deduplicator");
  const { filterByRelevance }     = await import("./utils/scorer");
  const { applyBlocklist, filterByLanguage } = await import("./utils/filters");
  const { enrichWithFullArticles } = await import("./utils/articleFetcher");
  const { saveStats }             = await import("./utils/statsStore");
  const { getSourceErrors }       = await import("./utils/sourceHealth");

  logger.info("=== Poll cycle starting (digest mode) ===");

  const allArticles    = await fetchAllSources(config);
  const newArticles    = filterNew(allArticles);

  if (newArticles.length > 0) {
    const langFiltered   = filterByLanguage(newArticles);
    const blockFiltered  = applyBlocklist(langFiltered, config.blocklistKeywords);
    const withContent    = config.fetchFullArticles
      ? await enrichWithFullArticles(blockFiltered)
      : blockFiltered;
    const jaccardDeduped = deduplicateArticles(withContent);
    const enriched       = await enrichArticles(jaccardDeduped, config);
    const aiDeduped      = applyAIClusters(enriched);
    const relevant       = filterByRelevance(aiDeduped, config.ai.relevanceThreshold);
    const sorted         = relevant.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

    pendingDigestArticles.push(...sorted);
    logger.info(`Digest buffer: +${sorted.length} articles (total ${pendingDigestArticles.length})`);

    markAsSeen(newArticles.map((a) => a.id));
    saveSeenStore();

    saveStats({
      timestamp: new Date().toISOString(),
      fetched: allArticles.length,
      ageFiltered: allArticles.length - newArticles.length,
      languageFiltered: newArticles.length - langFiltered.length,
      blocklistFiltered: langFiltered.length - blockFiltered.length,
      jaccardDeduped: withContent.length - jaccardDeduped.length,
      aiDeduped: jaccardDeduped.length - aiDeduped.length,
      relevanceFiltered: aiDeduped.length - relevant.length,
      sent: 0,
      groups: 0,
      trendingTopics: [],
      sourceErrors: getSourceErrors(),
    });
  } else {
    logger.info("No new articles this cycle.");
  }

  // ── Check digest hour ───────────────────────────────────────────────────
  const currentHour  = new Date().getHours();
  const isDigestHour = config.digestHours.includes(currentHour) && currentHour !== lastDigestHour;

  if (isDigestHour) {
    lastDigestHour = currentHour;

    if (pendingDigestArticles.length > 0) {
      logger.info(`Digest hour ${currentHour}:00 — sending ${pendingDigestArticles.length} buffered article(s)...`);
      const trending = detectTrends(pendingDigestArticles);
      await Promise.allSettled([
        sendEmailNotification(pendingDigestArticles, config),
        sendSlackNotification(pendingDigestArticles, config, trending),
      ]);
      pendingDigestArticles = [];
      logger.info("Digest sent. Buffer cleared.");
    } else {
      logger.info(`Digest hour ${currentHour}:00 — no buffered articles.`);
    }
  }

  logger.info("=== Poll cycle complete ===\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
