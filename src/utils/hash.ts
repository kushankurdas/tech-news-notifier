import { createHash } from "crypto";

// UTM and tracking query parameters to strip before hashing
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "utm_id", "utm_reader", "utm_name", "utm_cid",
  "ref", "referrer", "source", "via", "fbclid", "gclid", "msclkid",
  "mc_cid", "mc_eid", "_hsenc", "_hsmi", "yclid", "igshid",
]);

/**
 * Normalises a URL before hashing so the same article with different tracking
 * parameters, trailing slashes, or AMP variants is not treated as a new article.
 */
export function normaliseUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hostname = u.hostname.toLowerCase();

    // Strip tracking params
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        u.searchParams.delete(key);
      }
    }

    // Remove /amp or /amp/ suffix
    u.pathname = u.pathname.replace(/\/amp\/?$/, "");

    // Remove trailing slash (unless root path)
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }

    return u.toString();
  } catch {
    return raw;
  }
}

export function hashUrl(url: string): string {
  return createHash("sha256").update(normaliseUrl(url)).digest("hex").slice(0, 16);
}
