import fs from "fs";
import path from "path";
import { logger } from "./logger";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const SEEN_FILE = path.join(DATA_DIR, "seen.json");

/**
 * Persistent store of seen article IDs backed by a JSON file.
 * Keeps up to MAX_ENTRIES IDs and prunes entries older than SEEN_MAX_AGE_DAYS days.
 */
const MAX_ENTRIES = 5000;
const MAX_AGE_DAYS = parseInt(process.env.SEEN_MAX_AGE_DAYS ?? "14", 10);

interface SeenEntry {
  id: string;
  seenAt: number; // unix ms timestamp when the article was first seen
}

let seenIds: Set<string> = new Set();
let seenTimestamps: Map<string, number> = new Map();
let loaded = false;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadSeenStore(): void {
  ensureDataDir();
  try {
    if (fs.existsSync(SEEN_FILE)) {
      const raw = fs.readFileSync(SEEN_FILE, "utf-8");
      const parsed: (string | SeenEntry)[] = JSON.parse(raw);
      seenIds = new Set();
      seenTimestamps = new Map();
      for (const entry of parsed) {
        if (typeof entry === "string") {
          // Legacy flat-string format — treat as age 0 so they age out on next save
          seenIds.add(entry);
          seenTimestamps.set(entry, 0);
        } else {
          seenIds.add(entry.id);
          seenTimestamps.set(entry.id, entry.seenAt);
        }
      }
      logger.info(`Loaded ${seenIds.size} seen article IDs from disk.`);
    } else {
      seenIds = new Set();
      seenTimestamps = new Map();
      logger.info("No seen store found — starting fresh.");
    }
  } catch (err: any) {
    logger.warn(`Could not load seen store: ${err.message}. Starting fresh.`);
    seenIds = new Set();
    seenTimestamps = new Map();
  }
  loaded = true;
}

export function saveSeenStore(): void {
  ensureDataDir();
  try {
    const now = Date.now();
    const maxAgeMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

    // Build entries, pruning those older than MAX_AGE_DAYS
    let entries: SeenEntry[] = Array.from(seenIds)
      .map((id) => ({ id, seenAt: seenTimestamps.get(id) ?? now }))
      .filter((e) => now - e.seenAt < maxAgeMs);

    // Trim to MAX_ENTRIES (keep most recently added)
    if (entries.length > MAX_ENTRIES) {
      entries = entries.slice(entries.length - MAX_ENTRIES);
    }

    fs.writeFileSync(SEEN_FILE, JSON.stringify(entries, null, 2), "utf-8");
  } catch (err: any) {
    logger.error(`Could not save seen store: ${err.message}`);
  }
}

export function hasBeenSeen(id: string): boolean {
  if (!loaded) loadSeenStore();
  return seenIds.has(id);
}

export function markAsSeen(ids: string[]): void {
  const now = Date.now();
  for (const id of ids) {
    seenIds.add(id);
    if (!seenTimestamps.has(id)) {
      seenTimestamps.set(id, now);
    }
  }
}

export function filterNew<T extends { id: string }>(articles: T[]): T[] {
  if (!loaded) loadSeenStore();
  return articles.filter((a) => !seenIds.has(a.id));
}
