import { AppConfig, CycleStats } from "./types";
import { fetchAllSources } from "./sources";
import { filterNew, markAsSeen, saveSeenStore } from "./utils/seenStore";
import { enrichArticles } from "./utils/summarizer";
import { deduplicateArticles, applyAIClusters } from "./utils/deduplicator";
import { filterByRelevance } from "./utils/scorer";
import { applyBlocklist, filterByLanguage, filterPaywalled } from "./utils/filters";
import { detectTrends } from "./utils/trendDetector";
import { loadTopicHistory, saveTopicHistory, detectRisingTopics } from "./utils/topicHistory";
import { enrichWithFullArticles } from "./utils/articleFetcher";
import { getSourceErrors } from "./utils/sourceHealth";
import { saveStats } from "./utils/statsStore";
import { sendEmailNotification } from "./notifiers/emailNotifier";
import { sendSlackNotification } from "./notifiers/slackNotifier";
import { logger } from "./utils/logger";

export async function runPollCycle(config: AppConfig): Promise<void> {
  logger.info("=== Poll cycle starting ===");
  const cycleStart = Date.now();

  // ── 1. Fetch all enabled sources (with age filter applied inside) ─────────
  const allArticles = await fetchAllSources(config);
  const fetched = allArticles.length;

  // ── 2. Drop already-seen articles ─────────────────────────────────────────
  const newArticles = filterNew(allArticles);

  if (newArticles.length === 0) {
    logger.info("No new articles this cycle. Nothing to notify.");
    _logSummary({ timestamp: new Date().toISOString(), fetched, ageFiltered: 0, languageFiltered: 0, blocklistFiltered: 0, jaccardDeduped: 0, aiDeduped: 0, relevanceFiltered: 0, sent: 0, groups: 0, trendingTopics: [], sourceErrors: getSourceErrors(), cycleMs: Date.now() - cycleStart });
    return;
  }

  // ── 3. Language filter (#9) ───────────────────────────────────────────────
  const langFiltered = filterByLanguage(newArticles);
  const languageFiltered = newArticles.length - langFiltered.length;

  // ── 4. Keyword blocklist (#2) ─────────────────────────────────────────────
  const blockFiltered = applyBlocklist(langFiltered, config.blocklistKeywords);
  const blocklistFiltered = langFiltered.length - blockFiltered.length;

  // ── 4b. Paywall filter ────────────────────────────────────────────────────
  const afterPaywall = config.filterPaywalledArticles
    ? filterPaywalled(blockFiltered)
    : blockFiltered;

  if (afterPaywall.length === 0) {
    logger.info("No articles remain after filters. Nothing to notify.");
    markAsSeen(newArticles.map((a) => a.id));
    saveSeenStore();
    return;
  }

  // ── 5. Optional full article fetch (#7) ───────────────────────────────────
  const withContent = config.fetchFullArticles
    ? await enrichWithFullArticles(afterPaywall)
    : afterPaywall;

  // ── 6. Jaccard dedup ──────────────────────────────────────────────────────
  const jaccardDeduped = deduplicateArticles(withContent);
  const jaccardDeduped_count = withContent.length - jaccardDeduped.length;

  // ── 7. AI enrichment: summary + category + sentiment + relevanceScore +
  //       topics + clusterId (all in one batched call) ─────────────────────
  const enriched = await enrichArticles(jaccardDeduped, config);

  // ── 8. AI semantic dedup (#1) ─────────────────────────────────────────────
  const aiDeduped = applyAIClusters(enriched);
  const aiDeduped_count = jaccardDeduped.length - aiDeduped.length;

  // ── 9. Relevance filter (#2) ──────────────────────────────────────────────
  const relevant = filterByRelevance(aiDeduped, config.ai.relevanceThreshold);
  const relevanceFiltered = aiDeduped.length - relevant.length;

  if (relevant.length === 0) {
    logger.info("No relevant articles after scoring. Nothing to notify.");
    markAsSeen(newArticles.map((a) => a.id));
    saveSeenStore();
    return;
  }

  // ── 10. Sort newest-first ─────────────────────────────────────────────────
  const sorted = relevant.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  // ── 11. Trending topic detection (#4) ─────────────────────────────────────
  const trending = detectTrends(sorted);

  // ── 11b. Emerging topic detection (rising signal) ─────────────────────────
  const topicHistory = loadTopicHistory();
  const risingTopics = detectRisingTopics(trending, topicHistory);
  saveTopicHistory([
    ...topicHistory,
    {
      cycle: new Date().toISOString(),
      counts: Object.fromEntries(trending.map((t) => [t.topic, t.count])),
    },
  ]);
  if (risingTopics.length > 0) {
    logger.info(`Rising topics (3× spike): ${risingTopics.join(", ")}`);
  }

  logger.info(`Sending notifications for ${sorted.length} article(s)...`);

  // ── 12. Send notifications in parallel ────────────────────────────────────
  await Promise.allSettled([
    sendEmailNotification(sorted, config),
    sendSlackNotification(sorted, config, trending, risingTopics),
  ]);

  // ── 13. Mark ALL originally-new articles as seen ──────────────────────────
  markAsSeen(newArticles.map((a) => a.id));
  saveSeenStore();

  // ── 14. Persist stats (#5) + emit cycle summary (#4) ─────────────────────
  const stats: CycleStats = {
    timestamp: new Date().toISOString(),
    fetched,
    ageFiltered: fetched - newArticles.length,
    languageFiltered,
    blocklistFiltered,
    jaccardDeduped: jaccardDeduped_count,
    aiDeduped: aiDeduped_count,
    relevanceFiltered,
    sent: sorted.length,
    groups: 0, // filled below
    trendingTopics: trending.map((t) => t.topic),
    sourceErrors: getSourceErrors(),
  };
  saveStats(stats);
  _logSummary({ ...stats, cycleMs: Date.now() - cycleStart });

  logger.info("=== Poll cycle complete ===\n");
}

// ─── #4 Cycle summary ─────────────────────────────────────────────────────────

interface SummaryInput extends CycleStats {
  cycleMs: number;
}

function _logSummary(s: SummaryInput): void {
  const parts = [
    `fetched=${s.fetched}`,
    s.ageFiltered       ? `age-filtered=${s.ageFiltered}`          : null,
    s.languageFiltered  ? `lang-filtered=${s.languageFiltered}`     : null,
    s.blocklistFiltered ? `blocklist-filtered=${s.blocklistFiltered}` : null,
    s.jaccardDeduped    ? `jaccard-deduped=${s.jaccardDeduped}`     : null,
    s.aiDeduped         ? `ai-deduped=${s.aiDeduped}`               : null,
    s.relevanceFiltered ? `relevance-filtered=${s.relevanceFiltered}` : null,
    `sent=${s.sent}`,
    s.trendingTopics.length ? `trending=[${s.trendingTopics.join(",")}]` : null,
    `${s.cycleMs}ms`,
  ].filter(Boolean);

  logger.info(`Cycle summary: ${parts.join("  |  ")}`);
}
