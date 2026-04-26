# x-scraper — Architecture

A local-first, self-organizing knowledge base built from your X.com bookmarks, likes, and posts. Answers from any Claude/Codex/Gemini session via an MCP server, CLI, REST, and a git-tracked Obsidian-compatible vault.

## Goals

1. **Just works** — log in to X once, then `xs sync` pulls fresh bookmarks/likes/posts on demand or schedule.
2. **Self-organizing memory** — bi-temporal knowledge graph that extracts entities, claims, and relationships; merges duplicates; tracks contradictions; auto-clusters into topics.
3. **Multi-surface access** — same data available via MCP, CLI (`xs`), REST, and as plain markdown you can `@`-reference.
4. **Production-grade** — durable job queue, idempotent stages, structured logs, golden-corpus tests, bot-detection mitigations, recoverable from disaster.
5. **Extensible** — every concern (auth, scraping, extraction, embedding, graph storage, search backend) sits behind an interface so backends can be swapped.

## Non-goals

- Multi-user / multi-tenant.
- Real-time streaming (polling is fine).
- Hosted service. Local-first only for v1.
- Mobile clients.
- Privacy partitioning (everything goes to Claude API; user explicitly accepted this).

## Stack (locked)

| Concern               | Choice                                                                                     | Why                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language              | TypeScript (Node 22+, ESM)                                                                 | Best Playwright + MCP SDK story; fits user's preferences.                                                                                                                                                     |
| Package manager       | pnpm workspaces                                                                            | Per CLAUDE.md global preferences.                                                                                                                                                                             |
| Test framework        | Vitest + Playwright                                                                        | Vitest for unit/golden tests; Playwright for nightly E2E against real X.                                                                                                                                      |
| X scraping            | **Patchright** persistent-profile + GraphQL fallback                                       | Stealth-patched Playwright; user-data-dir gives "returning user" fingerprint; GraphQL when stable, rendered-page fallback on 429.                                                                             |
| Auth                  | Cookie import → browser fallback (`xs auth login`)                                         | Hybrid: try Chrome/Arc cookie store first; pop a Chromium window if that fails.                                                                                                                               |
| Article extraction    | `@mozilla/readability` + `jsdom` + Patchright fallback for JS-heavy pages                  | TS-native; pop browser only when needed.                                                                                                                                                                      |
| GitHub repo ingestion | `@octokit/rest` for metadata; shallow clone via `simple-git` for files                     | Avoids cloning huge repos.                                                                                                                                                                                    |
| YouTube transcripts   | `youtube-transcript` npm + `yt-dlp` fallback                                               | Free auto-captions when available; `yt-dlp` for harder cases.                                                                                                                                                 |
| PDF                   | `pdfjs-dist` for text + structure                                                          | Pure JS, no native deps.                                                                                                                                                                                      |
| Graph DB              | **Neo4j Community 2026.04** (`brew install neo4j`)                                         | Active product, native HNSW vector index, full Cypher, GDS for Leiden, mature `neo4j-driver` (Apache-2.0). Daemon, but `brew services` makes it invisible. See note below on the Kùzu→RyuGraph→Neo4j journey. |
| Auxiliary store       | SQLite via `better-sqlite3`                                                                | Job queue, run history, idempotency keys, cost ledger.                                                                                                                                                        |
| Embeddings            | `gemini-embedding-2-preview` (1536 dims via Matryoshka), adapter pattern                   | User has Gemini key; SOTA quality; multimodal-ready for v2.                                                                                                                                                   |
| LLM                   | Claude API (Sonnet 4.6 for reconciliation; Haiku 4.5 for bulk extraction); adapter pattern | User's primary provider; Sonnet for hard prompts, Haiku for cheap bulk.                                                                                                                                       |
| Search backends       | Exa + Tavily + Brave behind a `SearchProvider` adapter                                     | Exa for semantic-similar URLs, Tavily for question research, Brave fallback.                                                                                                                                  |
| Logging               | `pino` JSON                                                                                | Grep-able, fast, standard.                                                                                                                                                                                    |
| MCP                   | `@modelcontextprotocol/sdk`                                                                | Anthropic's official SDK.                                                                                                                                                                                     |
| HTTP                  | `hono` for the localhost REST API                                                          | Lightweight, fast, TS-native.                                                                                                                                                                                 |
| Vault                 | `~/Documents/x-scraper-vault/` git-tracked, Obsidian-compatible                            | User chose this location.                                                                                                                                                                                     |

### Graph DB pivot history (so future-you knows why)

**Original pick:** Kùzu — embedded, MIT, native HNSW. **Failed because:** Apple acquired Kùzu Inc. in October 2025, the open-source repo was archived, the npm package was deprecated.

**Second pick:** RyuGraph — community fork of Kùzu, npm-published, claimed to "continue development". **Failed because:** as of April 2026 the GitHub fork hasn't been touched in 5+ months, and its vector-extension CDN was offline (HNSW unavailable). Same abandoned-fork smell we were trying to avoid.

**Third pick:** Neo4j Community 2026.04. **Trade-offs accepted:** JVM daemon (mitigated by `brew services start neo4j`); GPLv3 server (fine for local-only personal use; the `neo4j-driver` we ship is Apache-2.0). **What we got:** native HNSW vector index in core, full Cypher 25, Graph Data Science library with Leiden/Louvain built in, every reference repo we vendor patterns from (Graphiti, mem0 graph mode, GraphRAG) targets it natively, brew formula updated this month, ~13k installs/year via brew. The "main repo frozen" optic is real but the product is shipping monthly.

**If Neo4j ever goes the way of Kùzu**, our adapter port (`packages/graph`) is one swap away from Memgraph (Bolt-protocol-compatible — drop-in driver), FalkorDB (Redis module), or SQLite + sqlite-vec + recursive CTEs (the boring backup).

## Module layout (pnpm monorepo)

```
x-scraper/
├── packages/
│   ├── core/             # Shared types, Zod schemas, frontmatter codec
│   ├── scraper/          # X.com auth + bookmark/like/post fetch (GraphQL + Patchright)
│   ├── ingestor/         # URL fetch, article/repo/youtube/pdf extraction, content hashing
│   ├── extractor/        # LLM-driven entity/claim/relationship extraction prompts
│   ├── graph/            # Neo4j adapter, schema migrations, ER, contradiction detection
│   ├── embeddings/       # Provider adapters: Gemini, OpenAI, local
│   ├── search/           # External search adapters: Exa, Tavily, Brave
│   ├── reconciler/       # ADD/UPDATE/DELETE/NONE decisions; community detection (Leiden)
│   ├── vault/            # Markdown read/write/sync; git operations; frontmatter <-> graph
│   ├── queue/            # Durable SQLite-backed job queue with idempotent stages
│   ├── llm/              # Claude/OpenAI/Gemini adapters; cost ledger; retry/backoff
│   ├── mcp-server/       # MCP tools: search, read, write, sync, graph ops
│   ├── rest/             # Localhost REST API (Hono)
│   ├── cli/              # `xs` binary: auth, sync, status, review, cite, ...
│   └── observability/    # pino logger, status dashboard renderer
├── apps/
│   └── xs/               # Composed entrypoint that wires everything together
├── docs/
│   ├── ARCHITECTURE.md
│   ├── ROADMAP.md
│   └── PROMPTS/          # Versioned LLM prompts (extraction, ER, reconciliation)
├── golden-corpus/        # Fixture bookmarks + expected graph snapshots
└── pnpm-workspace.yaml
```

Every package exports a stable `interface`; consumers depend on the interface, not the implementation. Swap-in/out is the default expectation.

## Data model

### Vault layout (markdown is canonical)

```
~/Documents/x-scraper-vault/
├── sources/              # immutable raw artifacts
│   ├── tweets/           # one .md per tweet (text + media URLs + frontmatter)
│   ├── articles/         # extracted article text + metadata
│   ├── repos/            # GitHub README + tree summary
│   ├── videos/           # YouTube transcript + metadata
│   └── pdfs/             # extracted text + structure
├── claims/               # atomic facts, mutable, with valid_at/invalid_at
├── entities/             # Person, Tool, Concept, Repo, Topic
├── topics/               # auto-clustered topic notes (LLM-rewritten)
├── digests/              # weekly DIGEST.md, monthly summaries
├── .xscraper/            # tool-managed (not committed by default)
│   ├── kuzu/             # graph DB
│   ├── queue.sqlite      # job queue + run history + cost ledger
│   ├── prompts.json      # active prompt versions
│   └── auth/             # browser profile, cookies (gitignored, encrypted at rest if possible)
└── .gitignore
```

The graph is rebuildable from `sources/`, `claims/`, `entities/`, `topics/` markdown. If `.xscraper/kuzu/` is wiped, `xs reindex` reconstructs it from disk.

### Frontmatter contract

All entity types share base fields and add type-specific ones.

```yaml
# Base
id: <type>_<short-hash> # claim_8f2a, src_a8f, ent_3b1, topic_ai-memory
type: Claim | Source | Entity | Topic | Person | Tool | Repo | Article | Tweet | Video | PDF
created_at: ISO-8601
updated_at: ISO-8601
prompt_version: { extraction: 3, reconciliation: 2, embedding: 1 }
embedding_model: gemini-embedding-2-preview
content_hash: sha256(canonical body)
sources: [src_a8f, src_2b1] # provenance edges; empty for Source nodes
aliases: [] # alternative names
confidence: 0.0–1.0 # extraction or merge confidence

# Claim only
valid_at: ISO-8601
invalid_at: ISO-8601 | null
subject: <entity-id-or-name>
predicate: snake_case
object: <entity-id-or-name-or-literal>
contradicts: [claim_xxx] # reverse edges materialized for git-readability
supersedes: [claim_xxx]

# Topic only
community_id: leiden_42
member_count: 17
representative_claims: [...]
last_summarized_at: ISO-8601

# Source only
url: ...
canonical_url: ...
captured_at: ISO-8601
content_type: tweet | article | repo | video | pdf
host_metadata: { author, published_at, ... }
```

### Graph schema (Kùzu)

Node tables: `Person`, `Tool`, `Concept`, `Repo`, `Topic`, `Claim`, `Source` (Tweet/Article/Video/PDF as Source subtypes via a `subtype` property).

Edge tables (every edge has `valid_at`, `invalid_at`, `confidence`, `created_at`):

- Provenance: `EXTRACTED_FROM`, `AUTHORED_BY`, `MENTIONED_IN`, `CITED_BY`
- Semantic: `IS_A`, `PART_OF`, `RELATED_TO`, `INSTANCE_OF`
- Epistemic: `SUPPORTS`, `CONTRADICTS`, `SUPERSEDES`, `EVOLVED_FROM`
- Behavioral: `LEARNED_FROM`, `REFERENCED_WHILE_BUILDING`
- Tentative: `SAME_AS_PROBABLE` (created when ER is uncertain; surfaced in `xs review`)

Vector index on `Claim.embedding` and `Entity.embedding` for similarity retrieval.

## Pipelines

### Sync pipeline (`xs sync`)

```
1. Auth check    → ensure session valid; refresh cookies if expired
2. Fetch         → GraphQL Bookmarks/Likes/Posts cursor pagination
                   fallback: Patchright rendered-page scraping
3. Diff          → compare against last-seen cursor; enqueue only new items
4. Persist       → write source markdown; commit to git
5. Schedule      → push each new source onto the ingestion queue
```

### Ingestion pipeline (per source, idempotent stages)

```
1. fetch_links   → for each linked URL: classify (article/repo/video/pdf), fetch
2. extract_text  → Readability/octokit/youtube-transcript/pdfjs by type
3. embed_source  → Gemini embedding; store in Kùzu vector index
4. extract_facts → Claude (Haiku) extracts entities + claims + relationships
5. resolve_ents  → for each candidate entity: vector similarity → top-K → LLM judge
                   (Sonnet) → MERGE | NEW | SAME_AS_PROBABLE
6. reconcile     → for each new claim: find conflicting claims by (subject, predicate)
                   → LLM judge → ADD | UPDATE | DELETE | NONE
                   UPDATE/DELETE invalidates predecessor with invalid_at = now
7. write_vault   → emit/update markdown for entities, claims; commit
8. update_graph  → write Kùzu rows; refresh community membership lazily
```

Each stage records `{job_id, source_id, stage, status, attempts, error, prompt_version}` in `queue.sqlite`. Failed stages retry with exponential backoff (max 3 attempts), then go to a DLQ visible via `xs status --dlq`.

### Reconciliation pipeline (background, daily idle)

```
1. detect_dirty_communities  → which Leiden communities have new/changed members
2. recluster_dirty           → run Leiden over the Concept/Topic subgraph
3. resummarize_dirty         → Sonnet rewrites the topic.md page from the cluster
4. cross_topic_link          → find new RELATED_TO edges between topic centroids
5. flag_contradictions       → list new CONTRADICTS edges since last digest
6. emit_digest               → write digests/YYYY-WW.md
```

### Auto-expand high-signal pipeline

When a bookmark trips the heuristic (long thread / multi-link / technical keywords / re-engagement) or is manually flagged `--deep`:

```
1. seed_query           → LLM generates 3-5 sub-queries from the source content
2. search_external      → Exa (similar-URL) + Tavily (NL research)
3. canonicalize+dedupe  → URL canon + content-hash + embedding-sim against vault
4. enqueue              → new URLs join the ingestion queue as `Source` records
                          with `discovered_via: <seed_id>` provenance
```

## Auth (`xs auth login`)

1. Try Chrome/Arc cookie store via `tough-cookie` + macOS Keychain access (prompt user once).
2. If `auth_token` + `ct0` extracted, validate by hitting a benign GraphQL op.
3. On failure, launch Patchright headed at `https://x.com/login` with persistent `user-data-dir` at `vault/.xscraper/auth/x-profile/`.
4. User logs in (handling 2FA themselves).
5. Detect login complete via URL change to `/home`; close window; persist profile.
6. Subsequent runs reuse the profile headlessly.

Cookie/profile file is gitignored. Encryption at rest deferred to v2 (macOS file permissions are sufficient for personal use).

## Bot-detection mitigation

- Patchright with `chromium` channel (real Chrome fingerprint).
- Persistent `user-data-dir` so `client-uuid`, localStorage, IndexedDB, and cookies persist between runs.
- Randomized scroll cadence (1–3s with jitter) when using rendered-page fallback.
- Exponential backoff on 429 with `Retry-After` honored.
- Hard cap: 200 bookmarks per session, then 30-min cool-down.
- Prefer GraphQL endpoint while it returns 200; switch to rendered-page after the 2nd 429 in a sync.
- Extract `queryId` for the Bookmarks/Likes/UserTweets GraphQL ops from `main.js` at runtime — never hardcode (X rotates these).

## MCP tool surface

```ts
// Read/search
search({ query, filters?: { type, topic, since } }) → { hits: Array<{ id, snippet, score }> }
read({ id }) → { frontmatter, body, related: [...] }
list({ type?, topic?, since? }) → Array<{ id, title }>
related({ id, depth?: 1, limit?: 10 }) → Array<{ id, relation, score }>

// Write/capture
capture_url({ url, note?, tags?: [], deep?: false }) → { id, queued: true }
capture_thought({ text, tags?: [], links?: [] }) → { id }
tag({ id, add?: [], remove?: [] })
link({ from, to, type, confidence? })

// Ingestion control
sync({ sources?: [bookmarks, likes, posts] }) → { run_id, queued: N }
ingest_url({ url, deep?: false }) → { id, status }
status() → { queue_depth, last_run, errors_24h, cost_24h, dlq_count }
retry_failed({ run_id? })

// Graph ops
ask_graph({ question }) → { answer, claims: [...], sources: [...] }
find_contradictions({ topic? }) → Array<{ claim_a, claim_b, detected_at }>
summarize_topic({ topic, level?: brief|detailed|exhaustive }) → { markdown }
```

CLI mirrors this surface with the same names. REST endpoint mounts at `localhost:7777/{tool}`.

## Re-ingestion policy

Three independent triggers:

1. **Source content changed** — `xs sync` re-fetches; if `content_hash` changes, re-runs stages 2–8 for that source. Existing claims may be UPDATEd or invalidated.
2. **Prompt version bumped** — `prompts.json` tracks active versions per stage. `xs reindex --prompt extraction --since v3` re-runs that stage on entities tagged with prior versions.
3. **Embedding model changed** — `xs reindex --embeddings` re-embeds everything. The embedding-model version is part of the vector index name so old/new can coexist during cutover.

## Observability

- All output is pino JSON. Logs go to `vault/.xscraper/logs/YYYY-MM-DD.ndjson`.
- `xs status` renders a terminal dashboard: queue depth, last successful run per source, error count by stage, cost spend (24h / 7d / 30d), top 10 longest-running stages.
- Cost ledger is a SQLite table: `(timestamp, run_id, stage, model, input_tokens, output_tokens, cost_usd)`. Logging-only, no caps (per user choice).
- Every LLM call carries `{ run_id, source_id, stage, prompt_version }` in metadata for end-to-end tracing.

## Testing

- **Unit (CI on every commit)** — Vitest for pure logic (frontmatter codec, URL canonicalization, Leiden clustering, prompt template rendering).
- **Golden-corpus (CI on every commit)** — 10 hand-picked bookmark fixtures + expected entities/claims/edges. Tests prompt regressions: any prompt edit that changes graph output beyond a tolerance fails CI.
- **Integration (nightly)** — Playwright actually hits `x.com/i/bookmarks` with a real test session, asserts at least N bookmarks fetched without error. Catches X breakage early.
- **End-to-end smoke** — `xs sync --dry-run` against a fixture bookmark set every commit.

User chose Playwright integration tests against real X as the primary strategy. We're layering golden-corpus on top because prompt regressions can't be caught by E2E alone.

## Roadmap (testable slices)

See [ROADMAP.md](./ROADMAP.md). Each slice produces a working, dogfoodable artifact. Build proceeds slice by slice with explicit verification gates.

## Open questions deferred to implementation

- Exact Leiden resolution parameter (start at 1.0, tune from corpus).
- Whether to gzip raw HTML in `sources/articles/<id>.raw.html.gz` for re-extraction without re-fetching. Probably yes.
- Encryption-at-rest for the auth profile. Probably yes in v1.5.
- Whether `xs cite` uses inline citations like `[src_a8f]` or footnote-style. Try inline first.
