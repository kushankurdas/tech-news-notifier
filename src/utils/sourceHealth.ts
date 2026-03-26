import { logger } from "./logger";

// Consecutive failure count per source name
const failureCounts = new Map<string, number>();

// Alert after this many consecutive failures
const ALERT_THRESHOLD = 3;

/**
 * Records a successful fetch for a source, resetting its failure count.
 */
export function recordSuccess(sourceName: string): void {
  if (failureCounts.has(sourceName)) {
    failureCounts.delete(sourceName);
    logger.info(`Source health: "${sourceName}" recovered.`);
  }
}

/**
 * Records a failed fetch for a source and warns if it has failed
 * ALERT_THRESHOLD times consecutively.
 */
export function recordFailure(sourceName: string): void {
  const count = (failureCounts.get(sourceName) ?? 0) + 1;
  failureCounts.set(sourceName, count);

  if (count >= ALERT_THRESHOLD) {
    logger.warn(
      `Source health: "${sourceName}" has failed ${count} consecutive cycle(s). ` +
      `Check the source URL or network connectivity.`
    );
  }
}

/**
 * Returns a snapshot of all sources with consecutive failures > 0.
 */
export function getSourceErrors(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [name, count] of failureCounts.entries()) {
    result[name] = count;
  }
  return result;
}
