# Spikes — risk reduction before implementation

Each spike is a small, throwaway script (`spikes/<n>-name.ts`) that proves **one risky integration** works end-to-end on this Mac, with this account, before we build production code on top of it. Spikes are sequential — finish, verify with the user, mark the integration green, only then move on.

Every spike has:

- A **success criterion** — a concrete, observable result
- A **time-box** — 30–90 min
- A **deliverable** — code, plus a one-paragraph note in `spikes/RESULTS.md`
- A **gate** — what blocks the next spike if this one fails

Spikes do NOT have tests. Their job is to learn. The production packages re-implement what the spikes prove, with tests.

---

## Spike 1: X.com auth — cookie import + browser fallback

**Goal:** confirm we can authenticate to X.com via persistent profile and at least one bookmarks API call returns valid JSON.

**Steps:**

1. Install `patchright` (or `playwright-extra` + `puppeteer-extra-plugin-stealth`).
2. Try reading Chrome/Arc cookie store via `tough-cookie-file-store` or direct keychain access; extract `auth_token` and `ct0` for x.com.
3. If extraction fails, launch a headed Chromium with `userDataDir = ./tmp/x-profile`, navigate to `x.com/login`, wait for `/home`, persist profile.
4. Hit `https://x.com/i/api/2/notifications/all.json` (a benign authenticated endpoint) and confirm 200.

**Success criterion:** `node spikes/1-auth.ts` prints `{ ok: true, screen_name: 'PatOnTheLevel' }`.

**Deliverable:** confirmed login pathway + the `auth_token`/`ct0` extraction behavior on this Mac.

**Gate:** if cookie import fails on Arc/Chrome, document why and decide whether to require browser fallback only.

---

## Spike 2: Bookmarks pagination — GraphQL + scrape fallback

**Goal:** confirm we can fetch the user's bookmarks (at least 50) with cursor pagination, both via the internal GraphQL `Bookmarks` op and via Patchright rendered-page scraping.

**Steps:**

1. Discover the current `Bookmarks` GraphQL `queryId` by parsing `https://x.com/i/main.<hash>.js` for the operation.
2. Issue a paginated GraphQL request with the auth from Spike 1; parse cursor; loop 3 pages.
3. Implement a parallel Patchright path: open `x.com/i/bookmarks`, scroll, intercept the same GraphQL response from the network layer.
4. Save raw responses to `spikes/fixtures/bookmarks-page-{1,2,3}.json` for golden-corpus tests later.

**Success criterion:** at least 50 bookmark entries with stable IDs, both paths produce equal results.

**Gate:** if the GraphQL endpoint returns 401/403, document required headers (`x-csrf-token`, `authorization` bearer, `x-twitter-auth-type`).

---

## Spike 3: Kùzu — install, schema, vector index, traversal

**Goal:** confirm Kùzu's Node bindings work on Apple Silicon, we can create node/edge tables with vector columns, insert 1k synthetic claims, and run a 2-hop Cypher traversal in <100ms.

**Steps:**

1. `pnpm add kuzu` — verify prebuilt binary loads on Darwin arm64.
2. Define `Person`, `Concept`, `Claim`, `Source` node tables and `EXTRACTED_FROM`, `MENTIONS`, `RELATED_TO` edge tables.
3. Add `embedding FLOAT[1536]` column on `Claim` and create HNSW index.
4. Generate 1000 synthetic claims with random 1536-dim embeddings; insert.
5. Run vector search (top-10) + 2-hop graph traversal (`MATCH (c:Claim)-[:MENTIONS]->(e:Concept)<-[:MENTIONS]-(c2:Claim) ...`) and time it.

**Success criterion:** schema works, vector search and 2-hop traversal each <100ms for 1k rows.

**Gate:** if Node bindings break or vector index is missing on Darwin arm64, fall back to SQLite + `sqlite-vec` and downgrade to recursive CTEs for traversal.

---

## Spike 4: Gemini embedding-2-preview

**Goal:** confirm we can embed 100 short texts in a batch with the new Gemini embedding API at 1536 dims with Matryoshka truncation.

**Steps:**

1. `pnpm add @google/genai`.
2. Read `GEMINI_API_KEY` from env.
3. Send 100 short strings in a batch call to `gemini-embedding-2-preview` with `output_dimensionality: 1536`.
4. Confirm latency, dimensions, and rough cosine similarity sanity (related strings should be more similar than unrelated).

**Success criterion:** 100 embeddings returned in <5s, dim=1536, sanity check passes (e.g. "Anthropic Claude" cosine to "Claude API" > "Anthropic Claude" cosine to "kitchen recipe").

**Gate:** if Gemini API throws (auth, quota, model name), fall back to OpenAI `text-embedding-3-large` and update the adapter default.

---

## Spike 5: Claude extraction — entities + claims from a real bookmark

**Goal:** confirm Claude (Sonnet 4.6) can take an article body and emit a structured JSON of entities, claims, and relationships matching our Zod schema.

**Steps:**

1. `pnpm add @anthropic-ai/sdk zod`.
2. Pick one of the user's actual bookmarks (e.g. an article on AI memory) and paste its plaintext into the spike.
3. Define the Zod schema for the extraction output (entities, claims, relationships).
4. Send to Claude Sonnet 4.6 with prompt caching on the schema portion and the article in the cached input.
5. Validate output with Zod; print pretty-printed extraction.

**Success criterion:** valid JSON, ≥5 plausible claims, ≥3 entities, no hallucinated URLs. Author confidence: "I would trust this in my graph."

**Gate:** if quality is poor on a real bookmark, iterate prompt 2–3 times. If still poor, escalate to a few-shot or chain-of-thought prompt and re-spike.

---

## Spike 6: MCP server roundtrip from Claude Code

**Goal:** confirm we can stand up a minimal MCP server with one `search` tool, register it in Claude Code's `~/.config/claude-code/mcp_servers.json` (or equivalent), and successfully call it from a Claude session.

**Steps:**

1. `pnpm add @modelcontextprotocol/sdk`.
2. Implement an `xs-mcp` server with a single `search` tool that returns a hardcoded `[{ id, title, snippet }]`.
3. Register it; restart Claude Code; verify it appears in the tools list.
4. From a Claude Code session, invoke `search({ query: 'test' })` and confirm the result roundtrips.

**Success criterion:** Claude Code shows the tool, calls succeed, results render in the conversation.

**Gate:** if MCP registration is fiddly across the three clients (Claude Code, Codex, Gemini CLI), document each and decide which to support in v1.

---

## Spike 7: Article extraction — Readability + JS-page fallback

**Goal:** confirm we can extract article text from 5 representative bookmarked URLs, including at least one JS-heavy page that vanilla `fetch` can't handle.

**Steps:**

1. `pnpm add @mozilla/readability jsdom`.
2. For each URL: fetch raw HTML; parse with `jsdom`; pass to `Readability`; extract title, byline, content, length.
3. For at least one JS-heavy page (e.g. an X article view), confirm Readability fails on the raw HTML and Patchright (waiting for selector) succeeds.

**Success criterion:** all 5 produce non-empty extracted text; the JS-heavy fallback is triggered on at least one and returns content.

**Gate:** if a major bookmark host (e.g. paywalled NYT) consistently fails, document and add `archive.ph` redirect to the v1.5 list.

---

## Spike 8: Codex review roundtrip

**Goal:** confirm `codex review` works on a small diff and produces actionable output we can use as a quality gate at milestones.

**Steps:**

1. Make a small, deliberately-imperfect change in a spike file.
2. Run `codex review --base HEAD~1` (per `/codex` skill).
3. Confirm output identifies real issues (not slop).

**Success criterion:** codex review returns a structured pass/fail or a list of findings we can read and act on.

**Gate:** if codex review is too noisy or too quiet, calibrate the prompt template before depending on it as a gate.

---

## Spike 9 (optional): Leiden + community detection

**Goal:** confirm `graphology` + `graphology-communities-louvain` can run Leiden on a graph of 5k nodes / 20k edges in <2s and produce sensible communities.

Defer if time-boxed. Worth doing before the reconciler module starts.

---

## Spike completion gate

When spikes 1–8 pass:

- Each integration has a confirmed working pattern documented in `spikes/RESULTS.md`.
- The architecture doc gets updated with any deviations discovered.
- The roadmap moves to slice 1.

If any spike requires a stack change (e.g. Kùzu fails on Darwin arm64), `ARCHITECTURE.md` is updated before slice 1 starts.
