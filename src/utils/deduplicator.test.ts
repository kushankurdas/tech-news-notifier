import { describe, expect, it } from "vitest";
import { Article } from "../types";
import { applyAIClusters, deduplicateArticles } from "./deduplicator";

function art(partial: Partial<Article> & Pick<Article, "title" | "url" | "source">): Article {
  const { title, url, source, id, publishedAt, excerpt, ...rest } = partial;
  return {
    ...rest,
    id: id ?? "id",
    title,
    url,
    source,
    publishedAt: publishedAt ?? new Date(),
    excerpt: excerpt ?? "",
  };
}

describe("deduplicateArticles", () => {
  it("merges near-duplicate titles into one story with merged sources", () => {
    const articles = [
      art({
        id: "1",
        title: "TypeScript 5.5 released with new features",
        url: "https://a.com/1",
        source: "HN",
        excerpt: "short",
      }),
      art({
        id: "2",
        title: "TypeScript 5.5 Released — New Features",
        url: "https://b.com/2",
        source: "TC",
        excerpt: "longer excerpt here for representative pick",
      }),
    ];
    const out = deduplicateArticles(articles, 0.45);
    expect(out).toHaveLength(1);
    expect(out[0].sources?.sort()).toEqual(["HN", "TC"].sort());
    expect(out[0].excerpt).toBe("longer excerpt here for representative pick");
  });

  it("keeps unrelated titles separate", () => {
    const articles = [
      art({ id: "1", title: "Rust async book updated", url: "https://a.com/1", source: "A", excerpt: "x" }),
      art({ id: "2", title: "Kubernetes patch Tuesday", url: "https://b.com/2", source: "B", excerpt: "y" }),
    ];
    expect(deduplicateArticles(articles)).toHaveLength(2);
  });
});

describe("applyAIClusters", () => {
  it("merges articles that share the same cluster id", () => {
    const articles = [
      { ...art({ id: "1", title: "A", url: "https://a.com", source: "S1", excerpt: "aa" }), _clusterId: 0 },
      { ...art({ id: "2", title: "B", url: "https://b.com", source: "S2", excerpt: "bbbb" }), _clusterId: 0 },
    ];
    const out = applyAIClusters(articles);
    expect(out).toHaveLength(1);
    expect(out[0].sources?.sort()).toEqual(["S1", "S2"].sort());
    expect("_clusterId" in out[0]).toBe(false);
  });
});
