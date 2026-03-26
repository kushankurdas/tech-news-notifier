import fs from "fs";
import path from "path";
import { StatsStore, CycleStats } from "../types";
import { logger } from "./logger";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const STATS_FILE = path.join(DATA_DIR, "stats.json");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadStatsStore(): StatsStore {
  ensureDataDir();
  try {
    if (fs.existsSync(STATS_FILE)) {
      return JSON.parse(fs.readFileSync(STATS_FILE, "utf-8")) as StatsStore;
    }
  } catch {
    // Start fresh if file is corrupt
  }
  return { lastCycle: null, allTime: { cyclesRun: 0, totalFetched: 0, totalSent: 0 } };
}

/**
 * Persists stats after each cycle.
 * Merges into the existing all-time counters rather than overwriting.
 */
export function saveStats(cycle: CycleStats): void {
  try {
    const store = loadStatsStore();
    store.lastCycle = cycle;
    store.allTime.cyclesRun += 1;
    store.allTime.totalFetched += cycle.fetched;
    store.allTime.totalSent += cycle.sent;

    ensureDataDir();
    fs.writeFileSync(STATS_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err: any) {
    logger.error(`Failed to save stats: ${err.message}`);
  }
}
