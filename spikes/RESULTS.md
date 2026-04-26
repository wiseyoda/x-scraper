# Spike Results

One paragraph per spike, written when it passes. Source of truth for what we learned vs. what's documented in `docs/SPIKES.md`.

---

## Spike 1 — X.com auth (PASSED 2026-04-26)

**Pathway proven:** persistent Patchright profile at `spikes/auth/x-profile/`, launched with `channel: 'chrome'` (real Chrome on this Mac). Headless attempt → if redirected to `/i/flow/login`, fall back to headed → user logs in → close window → on subsequent runs, headless reuses the profile cleanly.

**Confirmed:** required cookies (`auth_token`, `ct0`, `twid`) plus bonus (`guest_id`, `personalization_id`, `kdt`) all persist across runs. `screen_name` extracted from sidebar `data-testid="AppTabBar_Profile_Link"` href; `user_id` extracted from `twid` cookie via `u=(\d+)` pattern. Account: `PatOnTheLevel` / `18276723`.

**Deviations from plan:** dropped the v1.1 `verify_credentials.json` API call — modern x.com requires a Bearer token + `x-csrf-token` header, which we'll harvest in spike 2 by intercepting a real GraphQL request. Sidebar DOM read is sufficient for spike 1's "are we authenticated" question.

**Cookie import (Chrome/Arc keychain):** not implemented in v1 of this spike. Persistent profile + one-time headed login is fast enough for the use case; cookie import deferred to v1.5 only if the headed login becomes friction.

**Production code TODO:** the scraper package's auth module needs the same headless-first-then-headed flow, with profile path moved to `~/Documents/x-scraper-vault/.xscraper/auth/x-profile/`, and exposed as `xs auth login`.

---

## Key verification (PASSED 2026-04-26)

Not a numbered spike — a sanity check on `~/.config/x-scraper/.env`. `pnpm spike spikes/verify-keys.ts` exercised every provider with the cheapest possible call. All six keys live: Anthropic Claude (haiku-4-5), Google Gemini (gemini-embedding-001), OpenAI (text-embedding-3-small), Exa, Tavily, Brave Search. Spike 4 will separately confirm `gemini-embedding-2-preview` works.

---

## Spike 2 — Bookmarks pagination (PASSED 2026-04-26)

**Two paths proven, both converge on 60 entries across 3 pages:**

(A) **Passive capture** — opened `/i/bookmarks` headless, attached a `context.on('response')` listener that filtered on URL substring `/Bookmarks`, auto-scrolled `window.scrollTo(0, document.documentElement.scrollHeight)` with mouse-wheel nudges every 2.5s up to 20 iterations or 50 entries. Captured 3 GraphQL pages and extracted 60 tweet entries plus cursor entries.

(B) **Active replay** — captured the first GraphQL request's URL (with `variables` + `features` query params) and full headers. Built a per-page request that mutates the `variables.cursor` field with the previous response's `cursorType: "Bottom"` value. Re-issued via `context.request.get(url, { headers })` (which inherits the persistent context's cookies) — drops HTTP/2 pseudo-headers (`:authority`, `:path`, etc.) before re-issuing. Got 3 pages × ~20 entries each = 60.

**Production path:** active replay is the cheap default. Each page costs one GraphQL call; we don't need to render the bookmarks UI. Passive scrape stays as fallback — only triggered if X starts 401/403'ing the GraphQL endpoint.

**Production code TODO:**
- Discover the GraphQL `queryId` dynamically by parsing `main.<hash>.js` rather than relying on a captured URL — X rotates queryIds on frontend deploys (~weekly per twscrape's experience).
- Add 429 handling: detect `x-rate-limit-remaining` header → backoff with jitter; on persistent 429, switch to passive scrape mode.
- Track `cursor` per source (bookmarks/likes/posts) so incremental syncs stop at the previous run's last-seen cursor.
- Validate response shape with Zod before parsing.

**Fixtures:** `spikes/fixtures/*.json` are gitignored — they contain real bookmark data and the captured auth headers.

## Spike 3 — Kuzu schema, vector index, traversal (PASSED 2026-04-26)

**Bindings load on Darwin arm64.** `pnpm` ignored kuzu's install script by default — solved by adding `pnpm.onlyBuiltDependencies: ['esbuild', 'kuzu']` to package.json so future `pnpm install` runs the prebuilt-binary copy step. Prebuilt `kuzujs-darwin-arm64.node` ships with the package.

**Schema works.** Created `Concept`, `Source`, `Claim` node tables with `Claim.embedding FLOAT[1536]` and `EXTRACTED_FROM`, `MENTIONS` rel tables. The vector extension (`INSTALL vector; LOAD EXTENSION vector;`) loaded cleanly. HNSW index created via `CALL CREATE_VECTOR_INDEX('Claim', 'claim_embed_idx', 'embedding')`.

**Performance hits the budget on the read path:**
| Op | Time | Budget |
|---|---|---|
| Vector top-10 (HNSW) | 20.93 ms | < 100 ms ✓ |
| 2-hop Claim→Concept→Claim | 4.26 ms | < 100 ms ✓ |

**Performance is awful on the write path** because the spike uses one CREATE-per-row with embedded literals: 14.5s for 1k claims, 4.5s for 1k edges, 3.9s for index creation. Production code MUST use prepared statements + parameterized vector binds + `COPY FROM` for bulk; expect 50-100x speedup. This is a known kuzu pattern, not a stack risk — the read path is what matters.

**Quirk: kuzu 0.11.3 segfaults on shutdown.** Process exits with code 139 even after `await conn.close(); await db.close()`. Worked around with `process.exit(0)`. Watch for fixes in newer 0.x releases; if it persists into the production graph package, isolate the connection lifecycle to a child process or accept the noisy exit.

**Path gotcha:** Kuzu refused our pre-created directory. Fix: ensure the *parent* exists, leave the database path itself for kuzu to create.

**Schema/Cypher reference points:**
- Vector index call shape: `CALL QUERY_VECTOR_INDEX('Claim', 'claim_embed_idx', $vec, $k) RETURN node.id, distance`.
- Brute-force fallback uses `array_cosine_similarity(embedding, $vec)` — useful when the index isn't built yet.
- Multi-statement queries return `QueryResult[]`; single statements return `QueryResult`. Spike has a `single()` helper to normalize.

## Spike 4 — Gemini embedding-2-preview (PASSED 2026-04-26)

100 docs embedded via `batchEmbedContents` against `gemini-embedding-2-preview` in **1012 ms** (latency budget 5s) with `outputDimensionality: 1536` Matryoshka truncation. Cosine sanity check: same-topic pair scored **0.97**, different-topic pair **0.75** — clear semantic separation. Adapter fallback to `gemini-embedding-001` is wired but didn't trigger.

Production code uses `batchEmbedContents` for any batch >1; rate limiting is per-project at the API level so we can fan out concurrent batches up to a per-minute cap.

## Spike 5 — Claude entity/claim extraction (PASSED 2026-04-26)

Sonnet 4.6 extracted 10 entities, 10 claims, 11 relationships from a 350-word AI-memory article excerpt. All claims grounded in source text; no hallucinated URLs, version numbers, or invented entities. Zod schema validated on first attempt.

**Lesson:** initial run with `max_tokens: 2000` got truncated mid-JSON (`stop_reason: max_tokens`). Bumped to 32k. Production default per CODING_STANDARDS.md: 16k–32k for extraction calls. Also dropped artificial `MIN_CLAIMS`/`MIN_ENTITIES` schema constraints — let the model extract what's actually present, gate on quality downstream.

Prompt-caching wired via `cache_control: { type: 'ephemeral' }` on the schema/system portion. First call had 0 cache hits (expected); subsequent calls in the same 5-minute TTL window will read from cache.

Cost: ~740 input tokens + 2000 output tokens for the truncated try, ~700 + ~3500 for the successful try. Production extraction at scale should use Haiku 4.5 for the bulk path and Sonnet only for borderline / contested reconciliation.

## Spike 6 — MCP server roundtrip (PASSED 2026-04-26)

Built a minimal MCP server (`spikes/6-mcp-server.ts`) using the high-level `McpServer` API from `@modelcontextprotocol/sdk@1.29` (the older `Server` class is deprecated). One tool: `search_test`, defined with a Zod input schema that the SDK auto-converts to JSON Schema. Stdio transport.

Test client (`spikes/6-mcp.ts`) spawns the server as `node --import=tsx <server>` over stdio, runs `listTools` (returns the tool with auto-generated JSON schema) and `callTool` (returns 3 hits ranked by token-match score). Both round-trip cleanly.

To register with Claude Code:
```
claude mcp add x-scraper-spike -s local \
  -- node --import=tsx /Users/ppatterson/Working/x-scraper/spikes/6-mcp-server.ts
```
Not registered as part of this spike to avoid polluting the user's config. Production package will offer `xs mcp register --client {claude,codex,gemini}`.

## Spike 7 — Article extraction (PASSED 2026-04-26)

Five article URLs, all extracted with non-empty content (≥ 300 chars):

| URL | Path | Chars |
|---|---|---|
| Wikipedia: Knowledge graph | fetch | 19,470 |
| GitHub: getzep/graphiti | fetch | 21,885 |
| Obsidian Help home | **patchright fallback** | 1,594 |
| LangChain blog: LangGraph | fetch | 11,129 |
| Martin Fowler: Exploring Gen AI | fetch | 644 |

**Lesson — X.com tweets are NOT articles.** Initial test included a tweet URL (`x.com/.../status/...`); Readability couldn't parse the virtualized tweet UI even via Patchright (only 224 chars of page chrome). Tweet content already comes from spike 2's GraphQL path, so production routes by host: `x.com → tweet extractor`, everything else → this article extractor. Updated `URLS` to article-only and recorded the routing rule.

**Lesson — handle 404s before judging quality.** A wrong URL (Simon Willison post that didn't exist) returned 29 chars of "404: Page not found" via Patchright. Production code should distinguish "site failed" from "extraction failed" — don't retry the LLM extraction stage on a 404.

`VirtualConsole` set to swallow jsdom errors (lots of CSS/script noise from real-world pages doesn't add value).

## Spike 8 — TBD
