import { describe, expect, it } from "vitest";
import { hashUrl, normaliseUrl } from "./hash";

describe("normaliseUrl", () => {
  it("lowercases hostname", () => {
    expect(normaliseUrl("HTTPS://Example.COM/path")).toBe("https://example.com/path");
  });

  it("strips known tracking query params", () => {
    const base = "https://example.com/article";
    const withUtm = `${base}?utm_source=twitter&id=1`;
    expect(normaliseUrl(withUtm)).toBe(`${base}?id=1`);
  });

  it("removes trailing slash on non-root paths", () => {
    expect(normaliseUrl("https://example.com/foo/")).toBe("https://example.com/foo");
  });

  it("returns raw string on invalid URL", () => {
    expect(normaliseUrl("not-a-url")).toBe("not-a-url");
  });
});

describe("hashUrl", () => {
  it("produces the same hash for URLs that normalise identically", () => {
    const a = "https://example.com/x?utm_source=foo";
    const b = "https://example.com/x";
    expect(hashUrl(a)).toBe(hashUrl(b));
  });

  it("produces a 16-char hex string", () => {
    const h = hashUrl("https://example.com/");
    expect(h).toMatch(/^[a-f0-9]{16}$/);
  });
});
