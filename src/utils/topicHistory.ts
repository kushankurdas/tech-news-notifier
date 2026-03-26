import fs from "fs";
import path from "path";
import { TrendingTopic } from "./trendDetector";
import { logger } from "./logger";

interface TopicHistoryEntry {
  cycle: string;              // ISO timestamp
  counts: Record<string, number>;  // topic → article count
}

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const HISTORY_FILE = path.join(DATA_DIR, "topic-history.json");
const MAX_HISTORY_ENTRIES = 14;  // keep last 14 cycles (~3.5 hours at 15-min intervals)
const LOOKBACK_CYCLES = 7;       // compare against rolling 7-cycle window
const SPIKE_MULTIPLIER = 3;      // topic must be 3× the rolling average to be "rising"
const MIN_PRIOR_CYCLES = 2;      // need at least 2 prior appearances before declaring a spike

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadTopicHistory(): TopicHistoryEntry[] {
  ensureDataDir();
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8")) as TopicHistoryEntry[];
    }
  } catch {
    // Start fresh if file is corrupt
  }
  return [];
}

export function saveTopicHistory(entries: TopicHistoryEntry[]): void {
  try {
    ensureDataDir();
    const trimmed = entries.slice(-MAX_HISTORY_ENTRIES);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2), "utf-8");
  } catch (err: any) {
    logger.error(`Failed to save topic history: ${err.message}`);
  }
}

/**
 * Returns topics whose current count is >= SPIKE_MULTIPLIER × their rolling average
 * over the last LOOKBACK_CYCLES cycles. Topics must have appeared in at least
 * MIN_PRIOR_CYCLES prior cycles to be considered.
 */
export function detectRisingTopics(
  current: TrendingTopic[],
  history: TopicHistoryEntry[]
): string[] {
  if (history.length < MIN_PRIOR_CYCLES) return [];

  const recent = history.slice(-LOOKBACK_CYCLES);
  const rising: string[] = [];

  for (const { topic, count } of current) {
    const priorCycles = recent.filter((entry) => topic in entry.counts);
    if (priorCycles.length < MIN_PRIOR_CYCLES) continue;

    const avg = priorCycles.reduce((sum, e) => sum + e.counts[topic], 0) / priorCycles.length;
    if (avg > 0 && count >= avg * SPIKE_MULTIPLIER) {
      rising.push(topic);
    }
  }

  return rising;
}
