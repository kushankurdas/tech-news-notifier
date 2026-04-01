import { Article, ArticleCategory, ArticleSentiment, AppConfig } from "../types";
import { logger } from "./logger";

let openaiClient: any = null;
let openaiClientCacheKey = "";

async function getOpenAIClient(apiKey: string, baseURL?: string): Promise<any> {
  const key = `${apiKey}\0${baseURL ?? ""}`;
  if (!openaiClient || openaiClientCacheKey !== key) {
    const { OpenAI } = await import("openai");
    openaiClient = new OpenAI(
      baseURL ? { apiKey, baseURL } : { apiKey }
    );
    openaiClientCacheKey = key;
  }
  return openaiClient;
}

let anthropicClient: any = null;
let anthropicClientCacheKey = "";

async function getAnthropicClient(apiKey: string): Promise<any> {
  if (!anthropicClient || anthropicClientCacheKey !== apiKey) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    anthropicClient = new Anthropic({ apiKey });
    anthropicClientCacheKey = apiKey;
  }
  return anthropicClient;
}

/**
 * Per-article result returned by the combined AI call.
 * Note: summary is NOT included — it is derived from the article excerpt directly.
 */
interface AIEnrichment {
  category: ArticleCategory;
  sentiment: ArticleSentiment;
  relevanceScore: number;
  topics: string[];
  clusterId: number;
}

/** Returns the first 100 words of text, appending … if truncated. */
function toFirst100Words(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const slice = words.slice(0, 100);
  return slice.join(" ") + (words.length > 100 ? "…" : "");
}

const VALID_CATEGORIES = new Set<ArticleCategory>([
  "Breaking", "Release", "Deep Dive", "Opinion", "Security", "Tutorial", "Miscellaneous",
]);

const VALID_SENTIMENTS = new Set<ArticleSentiment>(["positive", "negative", "neutral"]);

function coerceCategory(raw: any): ArticleCategory {
  return VALID_CATEGORIES.has(raw) ? (raw as ArticleCategory) : "Miscellaneous";
}

function coerceSentiment(raw: any): ArticleSentiment {
  return VALID_SENTIMENTS.has(raw) ? (raw as ArticleSentiment) : "neutral";
}

/**
 * Builds a no-op fallback enrichment for each article (used when AI is disabled
 * or when the API call fails).
 *
 * - summary       → excerpt or title
 * - category      → undefined (no label shown)
 * - relevanceScore→ 10 (everything passes the filter)
 * - topics        → []
 * - clusterId     → unique per article (no semantic grouping)
 */
function fallbackEnrichment(articles: Article[]): Article[] {
  return articles.map((a, i) => ({
    ...a,
    summary: toFirst100Words(a.excerpt || a.title),
    category: undefined,
    relevanceScore: 10,
    topics: [],
    // Use index-based cluster so applyAIClusters treats each as its own story
    _clusterId: i,
  }));
}

// Max articles per LLM call — keeps completion tokens well within typical context limits
// (50 articles × ~120 tokens each = ~6000 tokens, leaving headroom for input tokens)
const AI_CHUNK_SIZE = 50;

function buildEnrichmentMessages(
  chunk: Article[],
  config: AppConfig,
  clusterOffset: number
): { system: string; user: string } {
  const articleList = chunk
    .map((a, i) => `[${i + 1}] Title: "${a.title}"\nExcerpt: "${a.excerpt}"`)
    .join("\n\n");

  const relevanceContext = config.ai.userContext || config.ai.topicFilter;

  const system = `
    You are a tech news analyst processing a batch of articles for a software engineering audience.
    Given a list of numbered articles, return a JSON array with one object per article, in the same order.

    Each object must have exactly these fields:

    - "category": one of exactly ["Breaking","Release","Deep Dive","Opinion","Security","Tutorial","Miscellaneous"]
      Breaking   = urgent news, incidents, outages, major announcements happening now
      Release    = new version, product launch, open-source publish, API update
      Deep Dive  = long-form technical analysis, research paper, architecture post
      Opinion    = editorial, hot take, personal perspective, predictions
      Security   = CVE, vulnerability, breach, exploit, patch advisory
      Tutorial   = how-to, step-by-step guide, code walkthrough
      Miscellaneous = anything that does not fit the above

    - "relevanceScore": integer 1–10 — score how relevant this article is to: ${relevanceContext}
      10 = core topic, directly useful
      7  = adjacent topic, likely interesting
      4  = tangential, minor overlap
      1  = unrelated (business news, consumer gadgets, celebrity, sports)
      Round to nearest integer. Do not use decimals.

    - "topics": array of 1–3 topic keywords.
      Use established names: "TypeScript" not "typescript", "AWS Lambda" not "lambda function", "LLM" not "large language model".
      Prefer specific over generic: "Rust" over "Programming Languages", "Kubernetes" over "DevOps".

    - "sentiment": one of exactly ["positive","negative","neutral"]
      positive = launch, achievement, improvement, positive outcome
      negative = outage, breach, deprecation, layoffs, failure
      neutral  = announcement without clear valence, analysis, opinion without strong tone

    - "clusterId": integer — group articles covering the SAME news event (same incident, same release, same story from different angles).
      Assign the SAME clusterId to: different sources reporting same event, follow-up articles on same incident, reactions/analysis of the same announcement.
      Assign a NEW clusterId to: unrelated stories, even if they share a topic keyword.
      Start from ${clusterOffset + 1}. Use sequential integers.

    Return ONLY a valid JSON array. No markdown fences, no explanation, no trailing text.
  `;

  return { system, user: articleList };
}

function parseEnrichmentResponse(
  raw: string,
  chunk: Article[],
  clusterOffset: number
): Array<Article & { _clusterId: number }> {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("Could not parse AI response as JSON array");

  const enrichments: AIEnrichment[] = JSON.parse(match[0]);

  return chunk.map((a, i) => {
    const e = enrichments[i];
    return {
      ...a,
      summary: toFirst100Words(a.excerpt || a.title),
      category: coerceCategory(e?.category),
      sentiment: coerceSentiment(e?.sentiment),
      relevanceScore: typeof e?.relevanceScore === "number"
        ? Math.min(10, Math.max(1, Math.round(e.relevanceScore)))
        : 10,
      topics: Array.isArray(e?.topics) ? e.topics.map(String) : [],
      _clusterId: typeof e?.clusterId === "number"
        ? e.clusterId + clusterOffset
        : i + clusterOffset,
    };
  });
}

async function enrichChunkOpenAI(
  client: any,
  chunk: Article[],
  config: AppConfig,
  clusterOffset: number
): Promise<Array<Article & { _clusterId: number }>> {
  const { system, user } = buildEnrichmentMessages(chunk, config, clusterOffset);

  const response = await client.chat.completions.create({
    model: config.ai.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    max_tokens: 130 * chunk.length,
  });

  const raw = response.choices[0]?.message?.content ?? "[]";
  return parseEnrichmentResponse(typeof raw === "string" ? raw : JSON.stringify(raw), chunk, clusterOffset);
}

async function enrichChunkAnthropic(
  client: any,
  chunk: Article[],
  config: AppConfig,
  clusterOffset: number
): Promise<Array<Article & { _clusterId: number }>> {
  const { system, user } = buildEnrichmentMessages(chunk, config, clusterOffset);

  const maxTokens = Math.min(16384, Math.max(2048, 200 * chunk.length));

  const response = await client.messages.create({
    model: config.ai.anthropicModel,
    max_tokens: maxTokens,
    temperature: 0.2,
    system,
    messages: [{ role: "user", content: user }],
  });

  const block = response.content[0];
  const raw = block?.type === "text" ? block.text : "[]";
  return parseEnrichmentResponse(raw, chunk, clusterOffset);
}

type EnrichedArticle = Article & { _clusterId: number };

async function runEnrichmentPipeline(
  articles: Article[],
  providerLabel: string,
  enrichChunk: (chunk: Article[], clusterOffset: number) => Promise<EnrichedArticle[]>
): Promise<EnrichedArticle[]> {
  const results: EnrichedArticle[] = [];
  const totalChunks = Math.ceil(articles.length / AI_CHUNK_SIZE);

  logger.info(
    `AI enrichment (${providerLabel}): processing ${articles.length} article(s) in ${totalChunks} chunk(s)...`
  );

  for (let i = 0; i < articles.length; i += AI_CHUNK_SIZE) {
    const chunk = articles.slice(i, i + AI_CHUNK_SIZE);
    const clusterOffset = i;
    const enriched = await enrichChunk(chunk, clusterOffset);
    results.push(...enriched);
  }

  return results;
}

/**
 * Enriches every article with summary, category, relevanceScore, topics, and
 * clusterId via a single model — but split into chunks to respect the model's
 * max_tokens limit.
 *
 * Tries providers in order: OpenAI (official cloud) → Anthropic → OpenAI-compatible local.
 * Falls back gracefully if AI is disabled or all providers fail.
 */
export async function enrichArticles(
  articles: Article[],
  config: AppConfig
): Promise<EnrichedArticle[]> {
  if (!config.ai.enabled) {
    return fallbackEnrichment(articles) as EnrichedArticle[];
  }

  type Attempt = { label: string; run: () => Promise<EnrichedArticle[]> };
  const attempts: Attempt[] = [];

  if (config.ai.openaiApiKeyRaw && !config.ai.openaiBaseUrl) {
    attempts.push({
      label: "OpenAI",
      run: async () => {
        const client = await getOpenAIClient(config.ai.openaiApiKey, undefined);
        return runEnrichmentPipeline(articles, "OpenAI", (chunk, offset) =>
          enrichChunkOpenAI(client, chunk, config, offset)
        );
      },
    });
  }

  if (config.ai.anthropicApiKey) {
    attempts.push({
      label: "Anthropic",
      run: async () => {
        const client = await getAnthropicClient(config.ai.anthropicApiKey);
        return runEnrichmentPipeline(articles, "Anthropic", (chunk, offset) =>
          enrichChunkAnthropic(client, chunk, config, offset)
        );
      },
    });
  }

  if (config.ai.openaiBaseUrl) {
    attempts.push({
      label: "local LLM",
      run: async () => {
        const client = await getOpenAIClient(
          config.ai.openaiApiKey,
          config.ai.openaiBaseUrl
        );
        return runEnrichmentPipeline(articles, "local LLM", (chunk, offset) =>
          enrichChunkOpenAI(client, chunk, config, offset)
        );
      },
    });
  }

  for (const { label, run } of attempts) {
    try {
      return await run();
    } catch (err: any) {
      logger.warn(
        `AI enrichment (${label}) failed: ${err?.message ?? err}. Trying next provider...`
      );
    }
  }

  logger.warn("All AI providers failed or none configured. Falling back to excerpts.");
  return fallbackEnrichment(articles) as EnrichedArticle[];
}
