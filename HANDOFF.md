# Session Handoff

> Updated 2026-04-26 at the end of a long session that shipped 8 PRs (Phase 0 stabilization + slices 5/6/7/14) on top of the 4 already on `main`.
> Read this first in the next session.

## Current State

The repo is live at github.com/wiseyoda/x-scraper with `main` clean and green. Working tree is clean. No PRs are in flight.

```
git log --oneline -10 main
<slice-14 squash>     Slice 14: packages/cli — xs init / status / cost / doctor (#12)
93103f3              Slice 7: packages/reconciler — entity resolution + ADD/UPDATE/DELETE/NONE (#11)
95f4f6a              Slice 6: packages/llm + packages/extractor (Claude + versioned extraction) (#10)
0d6e375              Slice 5: packages/embeddings (Gemini + OpenAI) (#9)
1c18255              docs: add CLAUDE.md project guide for future sessions (#8)
9fe3683              Slice 4: packages/graph — Neo4j adapter for the bi-temporal graph (#7)
a36002f              Slice 3: packages/queue — durable SQLite job queue + cost ledger (#6)
8b2f15f              Slice 2: packages/core + packages/vault (#3)
f020ac2              fix(scraper): cursor backfill + passive resume + replay fallback (#4)
44fa305              Slice 1: packages/scraper + Neo4j pivot (#2)
```

## What Was Done This Session

Phase 0 stabilization (cleanup of branches Pat had stacked):

- **PR #3 (slice 2)** had failing CI because vitest resolved workspace packages through `package.json#exports` to unbuilt `dist/`. Fixed by adding `resolve.alias` to `vitest.config.ts`. Codex review then caught two real bugs in `packages/vault/src/vault.ts`: (P1) `simple-git`'s constructor throws when `baseDir` doesn't exist, blocking `init()` for a fresh vault; (P2) `init()` would auto-commit any pre-staged user records under the message `chore(vault): initial layout`. Both fixed; two regression tests added. **Merged.**
- **Slice 3 (queue)** cherry-picked off main as a clean branch. Codex caught three P2 bugs: (1) lease-theft — old worker could clobber the new worker's attempt after `STALE_LEASE_MS`. Fixed by adding `current_attempt_id` to `jobs` and gating `completeStage`/`failStage` on it. (2) `markDone` left stale `attempts`/`next_run_at`/`last_error` from the failed-then-succeeded path. Fixed by clearing them on `markDone`. (3) `recordCost` returned a generated `cost_xxxx` id that was never persisted (schema used `INTEGER AUTOINCREMENT`). Fixed by changing `cost_ledger.ledger_id` to `TEXT PRIMARY KEY`. **Merged as PR #6.**
- **Slice 4 (graph)** cherry-picked off main. Codex caught three real bugs: (P1) `buildTraversal` emitted invalid Cypher and used `nodes(p)` after `WITH` had dropped `p`. Replaced with a clean `UNWIND relationships(p) AS rel`. (P1) `buildUpsertEdge`'s `MERGE` matched ALL relationships of the type, so re-upsert after `invalidateEdge` reset `invalid_at` to NULL on historical edges, erasing bi-temporal history. Replaced with `OPTIONAL MATCH` on the current edge plus two `FOREACH` branches (CREATE if none exists, SET if one does). (P2) `init()` returned before the vector index was ONLINE; now blocks on `db.awaitIndexes($timeout)` (default 60s, configurable). **Merged as PR #7.**
- **CLAUDE.md** added so future sessions get an immediate orientation. **Merged as PR #8.**

New slices:

- **Slice 5: `packages/embeddings`** — `EmbeddingProvider` port + `createGeminiEmbedding` (gemini-embedding-2-preview, 1536 dims, fallback to gemini-embedding-001) + `createOpenAIEmbedding` (text-embedding-3-large, native dimensions=1536). Shared timeout-bounded fetch with retry-on-429/5xx. Optional cost attribution via `CostSink`. Codex P2 fixes: (1) HTTP timeout now armed during body read so a stalled body can't hang `resp.json()` past `timeoutMs`. (2) Gemini never mixes vectors from primary + fallback in one `embed()` call; the first batch is a probe, and fallback is used for ALL batches if it triggers. **Merged as PR #9.** 96 tests.
- **Slice 6: `packages/llm` + `packages/extractor`** — `LlmProvider` port + Claude adapter (Sonnet 4.6 default, max_tokens 16k, prompt caching via `cache_control: ephemeral`, throws `TRUNCATED` on `stop_reason==='max_tokens'`). Versioned extraction prompt at `extraction-v1` with Zod-validated output (`entities`, `claims`, `relationships`). Codex caught: (P1) extraction enums diverged from `@x-scraper/core` (`Service`/`Other` not in `ENTITY_TYPES`, `MENTIONS`/`USES` not in `EDGE_TYPES`). Fixed by deriving the extractor enums from core, filtering out non-LLM-assignable types (`Source`, `Claim`, `SAME_AS_PROBABLE`). (P2) Truncated replies still carry billable usage; record-then-throw. (P2) `stage` field typed as `Stage` from `@x-scraper/queue` rather than bare string. (P2) Broadened `AnthropicMessageReply.content` to a structural superset so a bound `new Anthropic({...}).messages.create` is directly assignable. **Merged as PR #10.** 113 tests.
- **Slice 7: `packages/reconciler`** — `resolveEntity` (vector-top-K via injectable `ErCandidateFinder`, deterministic threshold gate at MERGE 0.92 / SAME_AS_PROBABLE 0.82) + `reconcileClaim` (mem0-style ADD/UPDATE/DELETE/NONE on `(subject, predicate, object)`) + optional `judgeWithLlm` tie-breaker. Codex found no defects on this slice. **Merged as PR #11.** 124 tests.
- **Slice 14: `packages/cli`** — `xs init`, `xs status`, `xs cost`, `xs doctor`. Zero-dep argv parser, pure command functions, `XSCRAPER_VAULT`/`XSCRAPER_QUEUE` overrides. Codex P2: (1) `xs status --run=ID` was scoping per-status counts but leaving `dlqCount` global. Fixed. (2) `xs doctor` returned a single WARN when `~/.config/x-scraper/.env` was missing instead of FAILing every required key. Fixed. **Merged as PR #12.** 137 tests.

## Key Decisions This Session

- **Codex review at every slice merge.** Pattern proven: codex consistently surfaces 2–3 real bugs per slice that lint/typecheck/format wouldn't catch. The cost is one extra round-trip per slice, ~5 minutes; the value is enormous.
- **No mixing of provider models within one embed/complete call.** Each `embed()` call returns vectors from one model; switching to fallback re-runs the first batch on fallback. Vector search would be silently broken otherwise.
- **`current_attempt_id` lease tokens.** Lease theft via stale lease is a real risk; the queue now requires the caller's claimed attempt id to match for `completeStage`/`failStage`. Old workers throwing `STALE_LEASE` is much better than them silently overwriting the active attempt.
- **`OPTIONAL MATCH` + two `FOREACH` branches for bi-temporal upsert.** A plain `MERGE` matches historical (invalidated) edges and resets `invalid_at`; that was destroying history. The new pattern only modifies the current edge.
- **Extractor enums derived from `@x-scraper/core`.** Single source of truth for `ENTITY_TYPES` and `EDGE_TYPES`. Extracted entities flow straight into the graph without casts.
- **CLI uses zero-dep argv parser.** Commander is a fine library, but the surface is small enough that owning the parser keeps `packages/cli` light. About 30 lines.
- **`xs doctor` distinguishes required vs optional keys.** Anthropic / Gemini / Neo4j credentials are FAIL if missing; OpenAI / Exa / Tavily / Brave are WARN. A missing env file is FAIL (with one row per required key marked FAIL).

## What Failed (and how to repeat)

- **Codex review uses a sandboxed shell that may fail to write `dist/.tsbuildinfo`.** Codex itself reports this as a `tsc` failure; ignore it — what matters is that local `pnpm typecheck` is clean. CI in GitHub Actions has full filesystem access.
- **`pnpm install` ignores build scripts for native deps unless they're listed in `package.json` `pnpm.onlyBuiltDependencies`.** `better-sqlite3` is now in there from slice 3. If you add another native dep, list it.
- **A naive `gh pr view --json statusCheckRollup --jq 'all(... .conclusion != "")'` jq filter can return `true` while a check is still running** (the field flips from absent to empty string momentarily). Wait on `[.statusCheckRollup[] | select(.name == "Lint, typecheck, test, build") | .conclusion] | .[0]` being non-empty AND non-null instead.
- **`exactOptionalPropertyTypes: true` rejects `{ runId: maybeUndefined }` even when the target type is `runId?: string`.** Use conditional spreads: `...(x === undefined ? {} : { runId: x })`. Done in embeddings, llm, and extractor.

## Deferred / Backlog

- **Slice 8: community detection + topic notes.** Leiden via Neo4j GDS over the Concept/Topic subgraph. Periodic recluster + topic.md regen via Sonnet synthesis. Cross-topic `RELATED_TO` edges.
- **Slice 9: `packages/ingestor`** for article (`@mozilla/readability` + Patchright fallback), GitHub repo (`octokit` + shallow clone), YouTube transcript (`youtube-transcript` + `yt-dlp` fallback), and PDF (`pdfjs-dist`). All become `Source` records. The ingestor port should mirror `EmbeddingProvider`/`LlmProvider` so adapters can be swapped per source kind.
- **Slice 10: scraper extension** for `likes` and `posts` (currently bookmarks-only). Extends `packages/scraper` with new GraphQL endpoints + replay paths.
- **Slice 11: `packages/search`.** Exa/Tavily/Brave adapters behind a `SearchProvider` port. Auto-expand: when a high-signal claim has low corroboration, fan out to one or more search providers and enqueue the discovered URLs as new `Source` jobs.
- **Slice 12: `packages/mcp-server`** — production MCP server using `@modelcontextprotocol/sdk`. Tools: `search`, `read`, `capture_url`, `summarize_topic`. Resources for vault docs. Pat will need an `xs mcp register --client {claude,codex,gemini}` command at the CLI level.
- **Slice 13: `packages/rest`** — Hono REST API mirroring the MCP surface. Bearer token from `~/.config/x-scraper/.env`, localhost-only by default.
- **Slice 14 follow-ups:** `xs sync` (the actual end-to-end command — needs slices 9 + 10 + 11), `xs reindex --from-vault` (rebuild the graph from markdown), `xs review` (interactive merge-decision queue), `xs auth login` (cookie-import + Patchright-fallback flow from spike 1), `xs mcp register`. The current CLI lays the surface but doesn't wire the orchestration yet.
- **Slice 15: digests + launchd.** Weekly DIGEST.md emitted by the reconciler; `xs schedule install` writes a launchd plist for hourly sync.
- **Slice 16: bot-mitigation hardening.** Jittered cadence, session caps, queryId hot-reload, GraphQL→scrape fallback path tested under simulated 429.
- **Slice 17: observability + perf.** pino logger, OTel traces, ink/blessed TUI for `xs status`, perf regression gate in CI.
- **Slice 18: docs + onboarding.** README screencast, install steps, troubleshooting matrix, prompt-versioning convention finalized.
- **Golden corpus** for the extractor (10 hand-picked source markdowns + expected extraction JSON). Currently the extractor tests use synthesized JSON inline.
- **Cookie-import auth path** (Chrome/Arc keychain extraction) deferred from spike 1.
- **HNSW dimension production check.** `packages/graph/src/constants.ts` defaults to 1536 (matches our Gemini Matryoshka pick). The integration test uses 16 dims. Production must use 1536. There is no runtime guard yet.

## Traps for Next Session

- **Branch off main AFTER the prior slice merges.** No stacking. Codified in `feedback_branch_strategy.md` memory.
- **Run `codex review --base main`** on every slice PR before merge. P1/P2 findings block. The pattern in this session: after the initial PR, codex finds 2–3 issues, you fix, re-push, CI goes green, merge.
- **Always check `stop_reason`** on Anthropic replies. The `LlmProvider` port already throws `TRUNCATED` on `stop_reason === 'max_tokens'` — don't swallow it.
- **`max_tokens` 16k–32k for extraction.** Default is 16k; bump to 32k for long sources. Truncation drops claims silently.
- **Cost is recorded BEFORE any throw path** in the LLM adapter. If you add new error paths, record cost first.
- **Vector search expects a single embedding space per result set.** Gemini fallback re-runs the first batch on fallback rather than mixing models. Don't undo this.
- **Bi-temporal upsert: `OPTIONAL MATCH ... WHERE invalid_at IS NULL` then two FOREACH branches.** A plain `MERGE` will match historical edges and clobber `invalid_at`. Don't shortcut this.
- **`pnpm.onlyBuiltDependencies` is unreliable.** Even after listing a native dep, pnpm sometimes ignores its install script. Workaround documented in slice 3 (use `npx prebuild-install` from inside the package's `node_modules`).
- **Neo4j tests need a running daemon.** `brew services start neo4j` before any spike 3 or `RUN_INTEGRATION=1 pnpm test packages/graph`.
- **Spike fixtures are gitignored.** Real auth headers + bookmark data live under `spikes/fixtures/*`; scrubbed golden fixtures will live under `golden-corpus/` (created in slice 9).

## Next Steps

The next high-value slice is **slice 9 (`packages/ingestor`)** — without an ingestor, `xs sync` can't actually fetch anything. Implementation order inside slice 9: article first (Readability, easiest), then GitHub repo (octokit), then YouTube (`youtube-transcript`), then PDF (`pdfjs-dist`). Each adapter implements the same `Ingestor` port so the queue can dispatch by source kind.

Once slice 9 is in, **wire the orchestration into `xs sync`**: read seeds from `packages/scraper`, enqueue → claim → fetch → embed → extract → reconcile → write_vault → update_graph. That unlocks the first end-to-end demo. Codex review the orchestration file specifically for race conditions on stage transitions.

After that, **slice 12 (MCP server)** gives Claude Code a way to query the vault directly, which is the highest-value surface for daily use. Slice 13 (REST) and 14-followups (other CLI commands) are nice-to-haves on top.

Open file paths to remember:

- `docs/ARCHITECTURE.md` — full design including the Kùzu→RyuGraph→Neo4j pivot history
- `docs/ROADMAP.md` — slice plan (slices 8–18 listed)
- `docs/CODING_STANDARDS.md` — including the LLM defaults Pat called out
- `docs/CODEX_REVIEW.md` — review process and severity levels
- `~/.config/x-scraper/.env` — all six API keys (chmod 600)
- `~/Documents/x-scraper-vault/` — created when you run `xs init`
- `~/.config/x-scraper/queue.sqlite` — created when you run `xs init`
