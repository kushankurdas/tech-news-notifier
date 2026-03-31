# Tech News Notifier

A Dockerized Node.js/TypeScript service that polls popular tech news sources and sends notifications to **Email** and/or **Slack** whenever new articles appear — no manual browsing required.

**Requirements:** Node.js 20+ (or Docker)

## Sources

| Source | Method | Toggle |
|---|---|---|
| Hacker News | RSS | `SOURCE_HN_ENABLED` |
| Reddit r/programming | Reddit API | `SOURCE_REDDIT_PROGRAMMING_ENABLED` |
| Reddit r/webdev | Reddit API | `SOURCE_REDDIT_WEBDEV_ENABLED` |
| Reddit r/javascript | Reddit API | `SOURCE_REDDIT_JS_ENABLED` |
| daily.dev | GraphQL API | `SOURCE_DAILYDEV_ENABLED` |
| IEEE Spectrum | RSS | `SOURCE_IEEE_ENABLED` |
| AWS What's New | RSS | `SOURCE_AWS_ENABLED` |
| Techmeme | RSS | `SOURCE_TECHMEME_ENABLED` |
| TechCrunch | RSS | `SOURCE_TECHCRUNCH_ENABLED` |
| Wired | RSS | `SOURCE_WIRED_ENABLED` |
| Engadget | RSS | `SOURCE_ENGADGET_ENABLED` |
| InfoQ | RSS | `SOURCE_INFOQ_ENABLED` |
| TLDR Tech | RSS | `SOURCE_TLDR_ENABLED` |

Adding more sources is a one-liner in `src/config.ts`.

## Features

- Configurable poll interval (any number of minutes)
- **Digest mode** — batch notifications at specific hours of the day (e.g. 8am and 6pm)
- **Age filtering** — only process articles published within a configurable window
- **Blocklist filtering** — drop articles matching keywords (sponsored, deals, etc.)
- Deduplication — Jaccard similarity + optional AI semantic dedup so you never see the same story twice
- **AI pipeline** (optional, via OpenAI or any OpenAI-compatible API — e.g. Ollama, LM Studio, vLLM):
  - **Personalized relevance scoring** — describe your role in `AI_USER_CONTEXT` and the AI calibrates scores to your specific interests
  - **Rising topic detection** — flags topics with a ≥3× spike vs their rolling average, shown in Slack digest intro
  - Category labels (`Breaking`, `Release`, `Deep Dive`, `Opinion`, `Security`, `Tutorial`)
  - Sentiment labels (`positive`, `negative`, `neutral`)
  - Trending topic extraction
  - Story grouping with semantic deduplication
  - Enhanced AI summaries — up to 100 words with calibrated relevance anchors
- Summaries via LLM (OpenAI-compatible) or auto-extracted excerpts as fallback
- Full article fetching for richer AI summaries (optional)
- Rich HTML emails + Slack Block Kit messages
- **Slack threading** — post topic groups as thread replies (requires Bot Token)
- Persists seen-article state and cycle stats across restarts via JSON files
- Docker + docker-compose ready, runs as a lightweight background service

## Quick Start

### 1. Configure

```bash
cp .env.example .env
# Edit .env with your SMTP / Slack credentials
```

### 2. Run with Docker (recommended)

```bash
docker compose up -d --build
docker compose logs -f   # tail logs
```

#### Ollama (local open-weight LLM)

The app speaks any **OpenAI-compatible** `/v1/chat/completions` API. [Ollama](https://ollama.com) is the usual choice for self-hosted inference. You do **not** need `OPENAI_API_KEY` for a default local Ollama server (a placeholder is sent).

Pick **one** of the setups below and set `OPENAI_MODEL` to a tag you have pulled (examples use `llama3.1`).

| Setup | `OPENAI_BASE_URL` in `.env` |
|--------|-----------------------------|
| Notifier + Ollama **both** in Docker Compose | `http://ollama:11434/v1` |
| Notifier on the **host** (`npm run dev` / `npm start`), Ollama on the **host** | `http://localhost:11434/v1` |
| Notifier **in Docker**, Ollama **on the host** (e.g. Ollama desktop) | `http://host.docker.internal:11434/v1` (Mac/Win Docker Desktop; see Linux note below) |

**Verify Ollama is up:** `curl -s http://localhost:11434/api/tags` (from the host) should return JSON listing models.

##### A. Ollama in Docker (Compose)

[`docker-compose.yml`](docker-compose.yml) defines an optional `ollama` service. It is **not** started unless you use the `llm-local` profile.

1. In `.env`:

   ```env
   OPENAI_BASE_URL=http://ollama:11434/v1
   OPENAI_MODEL=llama3.1
   ```

2. Start notifier + Ollama:

   ```bash
   docker compose --profile llm-local up -d --build
   ```

3. Pull a model **inside** the Ollama container (repeat when you change `OPENAI_MODEL`):

   ```bash
   docker compose exec ollama ollama pull llama3.1
   ```

Weights live in the `ollama-data` volume. Port **11434** is mapped to the host so you can debug or run `ollama` CLI against `localhost:11434` if needed.

**GPU (Linux + NVIDIA):** install the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html), then uncomment the `deploy.resources.reservations.devices` block under `ollama` in [`docker-compose.yml`](docker-compose.yml). On **macOS**, Ollama inside Docker is usually **CPU-only**; for Apple Silicon GPU use **Ollama on the host** (section B) or mixed Docker + host Ollama (section C).

##### B. Ollama on your machine (no Docker for the LLM)

Best when you use the **Ollama desktop app** or `ollama serve` and run the notifier with Node on the same machine.

1. Install Ollama from [ollama.com](https://ollama.com) and start it.
2. Pull a model:

   ```bash
   ollama pull llama3.1
   ```

3. In `.env`:

   ```env
   OPENAI_BASE_URL=http://localhost:11434/v1
   OPENAI_MODEL=llama3.1
   ```

4. Run the notifier on the host:

   ```bash
   npm install
   npm run dev
   ```

   Or after `npm run build`: `npm start`.

##### C. Notifier in Docker, Ollama on the host

Use this when the notifier runs in Compose but Ollama runs as a **separate** app on your machine (common on Mac with the Ollama app).

1. Do **not** enable the `llm-local` profile (only the notifier container):

   ```bash
   docker compose up -d --build
   ```

2. In `.env`:

   ```env
   OPENAI_BASE_URL=http://host.docker.internal:11434/v1
   OPENAI_MODEL=llama3.1
   ```

On **Linux**, `host.docker.internal` is not always defined. You can add to the `tech-news-notifier` service in Compose: `extra_hosts: - "host.docker.internal:host-gateway"`, or set `OPENAI_BASE_URL` to your host LAN IP (e.g. `http://192.168.1.10:11434/v1`).

### 3. Run locally (development)

```bash
npm install
npm run dev
```

### 4. Build & run compiled JS

```bash
npm run build
npm start
```

## Architecture

### Poll Cycle Pipeline

Every `POLL_INTERVAL_MINUTES`, `runPollCycle()` in `src/poller.ts` runs articles through a sequential filter/enrich pipeline:

```
Sources (parallel fetch)
        │
        ▼
 Age filter (drop articles older than SOURCE_MAX_AGE_HOURS)
        │
        ▼
 Seen filter (drop already-notified article IDs from data/seen.json)
        │
        ▼
 Language filter (drop non-English articles)
        │
        ▼
 Blocklist filter (drop titles matching BLOCKLIST_KEYWORDS)
        │
        ▼
 Paywall filter [optional] (drop known paywalled domains)
        │
        ▼
 Full article fetch [optional] (enrich excerpt with page body)
        │
        ▼
 Jaccard dedup (group near-duplicate titles by word-set similarity ≥ 0.45)
        │
        ▼
 AI enrichment (batched chat completions → summary, category, sentiment,
                relevanceScore, topics, clusterId per article)
        │
        ▼
 AI semantic dedup (merge articles with same AI-assigned clusterId)
        │
        ▼
 Relevance filter (drop articles below AI_RELEVANCE_THRESHOLD)
        │
        ▼
 Sort newest-first
        │
        ▼
 Trend detection (topic frequency + rising spike detection)
        │
        ▼
 Notify (email + Slack in parallel)
        │
        ▼
 Mark seen + persist stats
```

### Digest Mode

When `DIGEST_HOURS` is set, the pipeline runs every cycle as normal but **suppresses notifications** and buffers qualifying articles in memory. At each digest hour the buffer is flushed as a single notification and cleared.

### Codebase Map

```
src/
├── index.ts              Entrypoint — scheduler loop, graceful shutdown, digest buffer
├── config.ts             Reads env vars → AppConfig struct
├── poller.ts             runPollCycle() — the main pipeline (steps above)
├── types.ts              Article, AppConfig, CycleStats, SourceConfig interfaces
│
├── sources/
│   ├── index.ts          fetchAllSources() — dispatches to fetchers in parallel
│   ├── rssFetcher.ts     Parses RSS/Atom feeds via rss-parser
│   ├── redditFetcher.ts  Calls Reddit JSON API (/r/sub.json)
│   └── dailyDevScraper.ts  Queries daily.dev GraphQL endpoint
│
├── notifiers/
│   ├── emailNotifier.ts  Renders HTML email and sends via nodemailer/SMTP
│   └── slackNotifier.ts  Builds Slack Block Kit payload; supports webhook and bot token + threading
│
└── utils/
    ├── summarizer.ts     LLM enrichment (OpenAI-compatible) — batched in chunks of 50 articles per call
    ├── deduplicator.ts   Jaccard title dedup + AI cluster dedup (applyAIClusters)
    ├── scorer.ts         Filters articles below the relevance threshold
    ├── filters.ts        Blocklist, language, and paywall filters
    ├── trendDetector.ts  Counts topic mentions per cycle to identify trending topics
    ├── topicHistory.ts   Loads/saves rolling topic history; detectRisingTopics (≥3× spike)
    ├── articleFetcher.ts  Fetches full article body via HTTP + cheerio extraction
    ├── seenStore.ts      Persistent seen-IDs store backed by data/seen.json
    ├── statsStore.ts     Writes per-cycle and all-time stats to data/stats.json
    ├── sourceHealth.ts   Tracks consecutive fetch errors per source
    ├── hash.ts           Normalised URL hashing to produce stable article IDs
    └── logger.ts         Winston logger (respects LOG_LEVEL env var)

data/                     Runtime data directory (auto-created, gitignored)
├── seen.json             Seen article IDs with timestamps — pruned after SEEN_MAX_AGE_DAYS
├── stats.json            Last cycle stats + all-time totals
└── topic-history.json    Rolling window of topic mention counts (last 14 cycles)
```

### Key Data Structures

**`Article`** (the core unit flowing through the pipeline):

```ts
{
  id: string            // stable hash of normalised URL
  title: string
  url: string
  source: string        // e.g. "Hacker News"
  sources?: string[]    // all sources covering this story (set after dedup merge)
  publishedAt: Date
  excerpt: string       // raw feed excerpt (or full body when fetchFullArticles=true)
  summary?: string      // AI-generated (or falls back to excerpt)
  category?: ArticleCategory    // Breaking | Release | Deep Dive | Opinion | Security | Tutorial | Other
  sentiment?: ArticleSentiment  // positive | negative | neutral
  relevanceScore?: number       // 1–10, assigned by AI
  topics?: string[]             // 1–3 topic keywords from AI
  language?: string             // detected language code
}
```

**`AppConfig`** is built once at startup from environment variables by `loadConfig()` in `src/config.ts`. No runtime reloading — restart the service to pick up config changes.

### AI Enrichment Details

When `OPENAI_API_KEY` and/or `OPENAI_BASE_URL` is set, `enrichArticles()` sends articles to the configured endpoint in batches of 50 (to stay within token limits). A single structured prompt requests all fields at once — summary, category, sentiment, relevanceScore, topics, and clusterId — to minimise API calls.

**Local / open-weight models (e.g. Ollama):** set `OPENAI_BASE_URL=http://localhost:11434/v1` and `OPENAI_MODEL` to your model tag (e.g. `llama3.1`). You can omit `OPENAI_API_KEY` for typical local setups; a placeholder is used automatically.

The `clusterId` field drives the second dedup pass: articles sharing the same cluster ID are merged into one representative story (the one with the longest excerpt), with source names combined. This catches semantically duplicate stories that Jaccard misses due to differently-worded headlines.

If AI is disabled or the API call fails, every article gets `relevanceScore: 10` (passes all filters) and `clusterId` equal to its array index (no merging).

### Adding a New Source

**RSS source** — add one entry to the `sources` array in `src/config.ts`:

```ts
{
  name: "My New Source",
  type: "rss",
  url: "https://example.com/feed.rss",
  enabled: optionalEnv("SOURCE_MYNEWSOURCE_ENABLED", "true") === "true",
},
```

Then add `SOURCE_MYNEWSOURCE_ENABLED=true` to your `.env`.

**New source type** — add a fetcher in `src/sources/`, implement the `(source: SourceConfig) => Promise<Article[]>` signature, register the new `type` value in `src/types.ts`, and add a dispatch branch in `src/sources/index.ts`.

### Adding a New Notifier

Create `src/notifiers/myNotifier.ts` and export:

```ts
export async function sendMyNotification(
  articles: Article[],
  config: AppConfig
): Promise<void>
```

Then call it alongside the existing notifiers in `src/poller.ts` inside the `Promise.allSettled([...])` block (step 12 of the pipeline).

## Configuration Reference

All config is via environment variables (see `.env.example`).

### Polling & Filtering

| Variable | Default | Description |
|---|---|---|
| `POLL_INTERVAL_MINUTES` | `15` | How often to check for new articles |
| `SOURCE_MAX_AGE_HOURS` | `24` | Max age of articles to process (hours) |
| `DIGEST_HOURS` | _(empty)_ | Comma-separated hours to send digest (e.g. `8,18`). Empty = notify every cycle |
| `BLOCKLIST_KEYWORDS` | `sponsored,...` | Comma-separated keywords — matching articles are dropped |
| `FETCH_FULL_ARTICLES` | `false` | Fetch full article body for richer AI summaries |
| `FILTER_PAYWALLED_ARTICLES` | `false` | Drop articles from known paywalled domains (WSJ, FT, Bloomberg, NYT, etc.) |

### Email

| Variable | Default | Description |
|---|---|---|
| `EMAIL_ENABLED` | `false` | Enable email notifications |
| `SMTP_HOST` | `smtp.gmail.com` | SMTP server |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_SECURE` | `false` | Use TLS (true for port 465) |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password / app password |
| `EMAIL_FROM` | — | Sender address |
| `EMAIL_TO` | — | Comma-separated recipient list |

### Slack

| Variable | Default | Description |
|---|---|---|
| `SLACK_ENABLED` | `false` | Enable Slack notifications |
| `SLACK_WEBHOOK_URL` | — | Incoming Webhook URL (simple, no threading) |
| `SLACK_BOT_TOKEN` | — | Bot token (`xoxb-...`) — required for thread support |
| `SLACK_CHANNEL_ID` | — | Channel ID — required when using bot token |
| `SLACK_USE_THREADS` | `false` | Post topic groups as thread replies (requires bot token) |

### AI (optional)

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | — | API key for OpenAI or compatible servers — enables AI when set (optional if `OPENAI_BASE_URL` alone is enough for your server) |
| `OPENAI_BASE_URL` | _(unset)_ | OpenAI-compatible API root — enables AI when set. Ollama examples: `http://localhost:11434/v1` (host Node + host Ollama), `http://ollama:11434/v1` (Compose + Ollama container), `http://host.docker.internal:11434/v1` (Compose notifier + host Ollama). See **Ollama (local open-weight LLM)** under Quick Start |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model name (OpenAI ID or local tag such as `llama3.1`) |
| `AI_USER_CONTEXT` | _(empty)_ | Describe your role and interests — AI uses this to personalize relevance scores. When set, `AI_TOPIC_FILTER` is ignored. |
| `AI_TOPIC_FILTER` | `software engineering,...` | Fallback topic list for relevance scoring, used only when `AI_USER_CONTEXT` is not set |
| `AI_RELEVANCE_THRESHOLD` | `5` | Minimum relevance score (1–10) to include an article |
| `AI_MIN_GROUP_SIZE` | `2` | Minimum articles per topic group |

### Sources

| Variable | Default | Description |
|---|---|---|
| `SOURCE_HN_ENABLED` | `true` | Hacker News |
| `SOURCE_REDDIT_PROGRAMMING_ENABLED` | `true` | Reddit r/programming |
| `SOURCE_REDDIT_WEBDEV_ENABLED` | `true` | Reddit r/webdev |
| `SOURCE_REDDIT_JS_ENABLED` | `true` | Reddit r/javascript |
| `SOURCE_DAILYDEV_ENABLED` | `true` | daily.dev |
| `SOURCE_IEEE_ENABLED` | `true` | IEEE Spectrum |
| `SOURCE_AWS_ENABLED` | `true` | AWS What's New |
| `SOURCE_TECHMEME_ENABLED` | `true` | Techmeme |
| `SOURCE_TECHCRUNCH_ENABLED` | `true` | TechCrunch |
| `SOURCE_WIRED_ENABLED` | `true` | Wired |
| `SOURCE_ENGADGET_ENABLED` | `true` | Engadget |
| `SOURCE_INFOQ_ENABLED` | `true` | InfoQ |
| `SOURCE_TLDR_ENABLED` | `true` | TLDR Tech |

### Misc

| Variable | Default | Description |
|---|---|---|
| `DATA_DIR` | `./data` | Directory for seen-articles and stats persistence |
| `SEEN_MAX_AGE_DAYS` | `14` | Days to retain seen article IDs before pruning |
| `LOG_LEVEL` | `info` | Logging verbosity (`error`, `warn`, `info`, `debug`) |

## Personalized Relevance Scoring

Set `AI_USER_CONTEXT` to describe who you are and what you care about. The AI uses this to score articles 1–10 for relevance to *you specifically*, rather than generic topics.

**Example — Security / CISO:**
```
AI_USER_CONTEXT=CISO focused on vulnerabilities, CVEs, zero-days, breaches, ransomware, and patch advisories. Not interested in product releases, AI/ML, or general tech trends unless they involve a direct security risk.
AI_RELEVANCE_THRESHOLD=7
```

**Example — Full-stack engineer:**
```
AI_USER_CONTEXT=Senior full-stack engineer focused on TypeScript, React, Node.js, and AWS. Interested in developer tooling, AI/ML engineering, and open source. Not interested in consumer gadgets or crypto.
AI_RELEVANCE_THRESHOLD=5
```

When `AI_USER_CONTEXT` is set, `AI_TOPIC_FILTER` is ignored.

## Rising Topics

Every poll cycle, topic mention counts are persisted to `data/topic-history.json`. A topic is flagged as **rising** when its current count is ≥3× its rolling average over the last 7 cycles — indicating a sudden spike in coverage.

Rising topics appear in the Slack digest intro:

> 📈 **Rising:** `Rust`  `WebAssembly`

This catches breaking stories and viral posts early, before they become obvious. The history file retains the last 14 cycles (~3.5 hours at the default 15-min poll interval).

## Gmail Setup

1. Enable 2-Step Verification on your Google account
2. Generate an **App Password** at https://myaccount.google.com/apppasswords
3. Use that 16-character password as `SMTP_PASS`

## Slack Setup

**Option A — Incoming Webhook** (simple, no threading):

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**
2. Enable **Incoming Webhooks**
3. Add a webhook to your desired channel
4. Copy the Webhook URL into `SLACK_WEBHOOK_URL`

**Option B — Bot Token** (enables thread replies):

1. Create a Slack app with the `chat:write` scope
2. Install the app to your workspace and copy the Bot Token (`xoxb-...`) into `SLACK_BOT_TOKEN`
3. Add the bot to your target channel and set `SLACK_CHANNEL_ID`
4. Set `SLACK_USE_THREADS=true` to post topic groups as thread replies

## Contributing

Contributions are welcome! Here's how to get started:

### Setup

```bash
git clone <repo-url>
cd tech-news-notifier
npm install
cp .env.example .env
# Configure at minimum one notifier (EMAIL_ENABLED or SLACK_ENABLED)
npm run dev
```

### Development Workflow

```bash
npm run dev      # Run with ts-node (no build step, watches .env)
npm run build    # Compile TypeScript to dist/
npm run lint     # ESLint
```

The service logs a cycle summary on every run:

```
Cycle summary: fetched=42 | age-filtered=5 | lang-filtered=2 | jaccard-deduped=3 | ai-deduped=1 | relevance-filtered=8 | sent=23 | trending=[TypeScript,Rust] | 4821ms
```

Use `LOG_LEVEL=debug` to see per-article decisions (Jaccard grouping, AI cluster merges, filter drops).

### Where to Look for Common Tasks

| Task | File(s) |
|---|---|
| Add a new news source | `src/config.ts` (entry) + `src/sources/` (fetcher if new type) |
| Add a new notifier | `src/notifiers/` + `src/poller.ts` step 12 |
| Change pipeline step order | `src/poller.ts` |
| Modify AI prompt or fields | `src/utils/summarizer.ts` |
| Change dedup logic | `src/utils/deduplicator.ts` |
| Change rising topic threshold | `src/utils/topicHistory.ts` |
| Add a new env variable | `src/config.ts` + `.env.example` + README |
| Change notification format | `src/notifiers/emailNotifier.ts` or `slackNotifier.ts` |

### PR Checklist

1. `npm run build` — must compile with no errors
2. `npm run lint` — must pass
3. If adding env variables: update `.env.example` and the Configuration Reference in this README
4. If adding a source type: update the `SourceConfig.type` union in `src/types.ts`
5. For larger changes, open an issue first to discuss the approach

## License

MIT — see [LICENSE](LICENSE) for details.
