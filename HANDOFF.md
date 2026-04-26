# Session Handoff

> Updated 2026-04-26 after a session that shipped 8 PRs on top of the prior session's 9 — taking the project from 4 production packages to 16 and from 137 to 227 tests.
> Read this first in the next session.

## Current State

`main` is clean and green. Working tree is clean. No PRs are in flight. **16 of 18 roadmap slices merged.** Every component the architecture needs exists; the unfinished item is the orchestration glue (`xs sync`) that runs the queue stages end-to-end.

```
git log --oneline -10 main
f5097c9  docs(slice-18): refresh README, CLAUDE.md, HANDOFF.md after slices 9-17 (#21)
e4ba7ef  feat(slice-16): scraper bot-mitigation primitives (#20)
15265fe  Slice 17: packages/observability — structured logger + perf timers (#19)
6de8a57  Slice 15: packages/digest — weekly digest + launchd plist (#18)
7be7494  Slice 13: packages/rest — localhost REST API (Hono) (#17)
a827e92  Slice 12: packages/mcp-server — vault search/read/status over MCP (#16)
49fbd4a  Slice 11: packages/search — Exa / Tavily / Brave + auto-expand (#15)
32c788b  Slice 9:  packages/ingestor — article + repo + youtube (#14)
08dc9b2  docs: refresh HANDOFF.md (#13)
ec3a430  Slice 14: packages/cli — xs init / status / cost / doctor (#12)
```

## Package Map (16 packages on main)

| Package         | Public surface                                                                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`          | `ENTITY_TYPES`, `EDGE_TYPES`, `FrontmatterSchema`, `parseDocument`/`formatDocument`, `canonicalizeUrl`, ID gen                                                                   |
| `vault`         | `createMarkdownVault({root})` → `{init, read, write, list, commit}`; `safeJoin`                                                                                                  |
| `scraper`       | `openAuthenticatedSession`, `fetchBookmarks`, `passiveCaptureBookmarks`, `parseBookmarksPage`; `jitteredDelay`, `createSessionCap`, `createQueryIdRegistry`                      |
| `queue`         | `createSqliteQueue(path)` → `{startRun, enqueue, claimNext, completeStage, failStage, retryFailed, recordCost, costSince, stats}`; lease-token-safe                              |
| `graph`         | `createNeo4jGraph({uri,user,password})` → `{init, upsertNode, upsertEdge, invalidateEdge, vectorSearch, traverse, countNodes}`                                                   |
| `embeddings`    | `createGeminiEmbedding({apiKey, ...})`, `createOpenAIEmbedding({apiKey, ...})` → `{provider, dims, embed(texts)}`                                                                |
| `llm`           | `createClaudeProvider({messagesCreate, ...})` → `{complete(req)}`; throws `TRUNCATED` on max_tokens; cost recorded BEFORE throw                                                  |
| `extractor`     | `extract(llm, {body, title?, sourceUrl?})` → validated `{entities, claims, relationships}` via Zod + repair loop                                                                 |
| `reconciler`    | `resolveEntity({candidateName, candidateEmbedding, type}, {finder})` → `MERGE`/`NEW`/`SAME_AS_PROBABLE`; `reconcileClaim({incoming, existing})` → `ADD`/`UPDATE`/`DELETE`/`NONE` |
| `ingestor`      | `createArticleIngestor`, `createRepoIngestor`, `createYouTubeIngestor`; `selectIngestor(url, ingestors[])`                                                                       |
| `search`        | `createExaSearch`, `createTavilySearch`, `createBraveSearch`; `autoExpandClaim(claim, {providers})`                                                                              |
| `cli`           | `xs init / status / cost / doctor`; `parseArgs`, `resolveConfig`                                                                                                                 |
| `mcp-server`    | `buildMcpServer({vault, queue})`; `xs-mcp` stdio bin; tools: search_vault / read_source / queue_status                                                                           |
| `rest`          | `buildRestApp({ctx, bearerToken})`; `xs-rest` bin; `/health`, `/search` (GET+POST), `/read`, `/status`                                                                           |
| `digest`        | `buildDigest(vault, {now, llm?})`; `buildLaunchdPlist({label, programPath, intervalSeconds})`                                                                                    |
| `observability` | `createLogger({level, sink, bindings, now})` → `{debug, info, warn, error, child}`; `time(log, label, fn)`, `timeSync`                                                           |

## What Was Done This Session

Eight PRs through the full lifecycle (branch off main → write package + tests → gate locally → open PR → `codex review --base main` → fix every P1/P2 → push → CI green → squash-merge → delete branch).

| PR  | Slice                        | Codex P1/P2 fixed                                                                              |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| #14 | Slice 9 (ingestor)           | repo URL matched subresources; README fetch swallowed all non-200; provider JSON `as T` casts  |
| #15 | Slice 11 (search)            | none — codex clean                                                                             |
| #16 | Slice 12 (mcp-server)        | none — codex clean                                                                             |
| #17 | Slice 13 (rest)              | bin only read token from process.env (not .env file); GET /search returned 404                 |
| #18 | Slice 15 (digest)            | window stretched to 13 days on Sundays; LLM prompt had only ids, no content                    |
| #19 | Slice 17 (observability)     | caller bindings could overwrite reserved time/level/msg; timer fields could overwrite label/ms |
| #20 | Slice 16 (scraper hardening) | none — codex clean                                                                             |
| #21 | Slice 18 (docs refresh)      | format-only                                                                                    |

## Key Decisions

- **Codex review on every slice, no exceptions.** Across the 17 PRs of this build (this session + prior), codex flagged ~22 real P1/P2 issues that the local gates passed cleanly. Pattern is reliable enough to bake into the workflow forever.
- **All external JSON is Zod-validated at the boundary.** No `as T` casts. Every adapter (Gemini, OpenAI, Claude, Exa, Tavily, Brave, GitHub, YouTube) ships its own `*ResponseSchema`.
- **Reserved fields beat caller data.** In any structured-event emitter, spread caller-supplied fields FIRST and reserved (time/level/msg, label/ms, error) LAST.
- **Auth fails closed.** `xs-rest` refuses to start without `XSCRAPER_REST_TOKEN` unless `XSCRAPER_REST_ALLOW_UNAUTH=1` is explicit. The bin reads `~/.config/x-scraper/.env` itself; it doesn't rely on the surrounding shell to have the env exported.
- **GET + POST for documented HTTP paths.** REST `/search` accepts both: POST takes a JSON body, GET maps `?q=&type=&limit=`.
- **Digest window is exactly 7 days, not "the previous ISO week".** Running on a Sunday with the rounding form would have stretched to 13 days.

## What Failed

- **Hono `Context` cannot be expressed as `Parameters<Parameters<typeof app.post>[1]>[0]`** — the inferred parameter is `never`. Use `import type { Context } from 'hono'` and annotate explicitly.
- **`exactOptionalPropertyTypes: true`** continues to reject the `{ runId: maybeUndefined }` pattern even when the target type is `runId?: string`. Use conditional spreads consistently: `...(x === undefined ? {} : { runId: x })`.
- **Codex sandbox `tsc --noEmit` fails with `EPERM` on `dist/.tsbuildinfo`.** Codex itself reports it as a typecheck failure; ignore it. Local `pnpm typecheck` is the source of truth and CI runs in a writable workspace.
- **`pnpm install` warns about `xs-mcp` bin link** because mcp-server hasn't been built yet; this is benign and clears once `pnpm build` runs.
- **`canonicalizeUrl` does NOT lowercase the path** — paths can be case-sensitive. A test that assumed `/A` and `/a` deduplicate had to be rewritten.
- **`@typescript-eslint/no-confusing-void-expression`** rejects `(msg) => emit('debug', msg)` shorthand; wrap in braces: `(msg) => { emit('debug', msg); }`.

## Deferred / Backlog

- **`xs sync` orchestration** — the CLI command tying everything together. THIS IS THE NEXT-SESSION FIRST TASK. See "Next Steps" below.
- **Slice 8** (community detection / topic notes via Neo4j GDS Leiden + topic.md regen). Best done once real ingested data exists.
- **Slice 10** (likes + own posts in scraper). Needs the matching X.com GraphQL endpoints + parsers; the auth + page parsing primitives in `packages/scraper` already cover the hard part.
- **PDF ingestor** (deferred from slice 9). The `Ingestor` port already accommodates it; `pdfjs-dist` is in `package.json`.
- **`xs reindex --from-vault`**, **`xs review`**, **`xs auth login`**, **`xs mcp register --client {claude,codex,gemini}`** — CLI commands listed in the roadmap that follow naturally once `xs sync` exists.
- **Golden corpus** for the extractor (10 hand-picked source markdowns + expected extraction JSON). Currently extractor tests use synthesized JSON inline.
- **Perf regression gate in CI.** Roadmap calls for a 5%-degradation fail on hot paths.
- **HNSW dimension production check.** `packages/graph/src/constants.ts` defaults to 1536; integration tests use 16 dims. There is no runtime guard.

## Traps for Next Session

- **Branch off main AFTER the prior slice merges.** No stacking — codified in `feedback_branch_strategy.md` memory.
- **Run `codex review --base main`** on every slice PR before merge. Pattern: file PR → CI green → codex review → fix P1/P2 → push → CI green → merge.
- **Always check `stop_reason`** on Anthropic replies. The `LlmProvider` port already throws `TRUNCATED`; don't swallow it.
- **`max_tokens` 16k–32k for extraction.** Default is 16k.
- **Cost is recorded BEFORE the throw path** in the LLM adapter. If you add new error paths, record cost first.
- **Vector search expects a single embedding space per result set.** Gemini fallback re-runs the first batch on fallback rather than mixing models. Don't undo.
- **Bi-temporal upsert: `OPTIONAL MATCH ... WHERE invalid_at IS NULL` + two `FOREACH` branches.** A plain `MERGE` will clobber history.
- **All provider JSON gets Zod-validated at the boundary.** No `as T`.
- **Reserved fields beat caller data** in logger and timer. When you add new fields, double-check the spread order.
- **Neo4j tests need a running daemon.** `brew services start neo4j` before `RUN_INTEGRATION=1 pnpm test packages/graph`.
- **`xs-rest` fails closed** without `XSCRAPER_REST_TOKEN`. Set it (or `XSCRAPER_REST_ALLOW_UNAUTH=1`) in `~/.config/x-scraper/.env`.

## Next Steps — exactly where to pick up

**The single concrete first task: build `xs sync` in `packages/cli`.**

It is the orchestration that wires the existing packages into a runnable command. Sketch:

```
packages/cli/src/commands/sync.ts
  runSync(config, options) {
    1. Open the queue (createSqliteQueue) and start a run (queue.startRun).
    2. Open the scraper (openAuthenticatedSession) and pull bookmarks
       via fetchBookmarks; for each, queue.enqueue({sourceId, sourceKind:
       'bookmarks', idempotencyKey: contentHash(...)}) at startStage='fetch_links'.
    3. Loop: queue.claimNext() → dispatch by stage:
         fetch_links    → extract URLs from bookmark text
         extract_text   → ingestor.ingest(url) (selectIngestor against
                          the registered ingestors)
         embed_source   → embedding.embed([source.body])
         extract_facts  → extractor.extract(llm, {body, title, sourceUrl})
         resolve_ents   → for each entity: reconciler.resolveEntity(...)
         reconcile      → for each claim: reconciler.reconcileClaim(...)
                          + invalidateEdge / upsertEdge on the graph
         write_vault    → vault.write({frontmatter, body})
         update_graph   → graph.upsertNode(...) / graph.upsertEdge(...)
       After each successful stage: queue.completeStage(jobId, stage, attemptId).
       After each failure: queue.failStage({jobId, stage, attemptId, errorCode, errorMsg}).
    4. queue.finishRun(runId).
  }
```

Files the orchestration will use (all already shipped):

- `@x-scraper/queue` — `createSqliteQueue`, `STAGES`, `Job` shape
- `@x-scraper/scraper` — `openAuthenticatedSession`, `fetchBookmarks`, `createSessionCap`, `jitteredDelay`
- `@x-scraper/ingestor` — `createArticleIngestor`, `createRepoIngestor`, `createYouTubeIngestor`, `selectIngestor`
- `@x-scraper/embeddings` — `createGeminiEmbedding`
- `@x-scraper/llm` — `createClaudeProvider`
- `@x-scraper/extractor` — `extract`
- `@x-scraper/reconciler` — `resolveEntity`, `reconcileClaim`
- `@x-scraper/graph` — `createNeo4jGraph`
- `@x-scraper/vault` — `createMarkdownVault`
- `@x-scraper/observability` — `createLogger`, `time` (attach `child({runId, jobId, stage})` per job)
- `@x-scraper/digest` — call after the run completes to write a digest

Wire each external adapter to use the existing cost-ledger sink so `xs cost` keeps reporting accurately. The `LlmProvider` and `EmbeddingProvider` cost records carry `{runId, jobId, stage}` already.

Tests: vitest cases for the dispatcher should stub each adapter (no real network), drive a synthetic queue through every stage, and assert (a) the run reaches `done`, (b) the vault gets a Source markdown, (c) the graph gets the expected upsert calls, (d) failed jobs go to DLQ after `maxAttempts`.

Codex review the dispatcher specifically for race conditions on stage transitions and for cost-recording-before-throw.

After `xs sync` lands, the natural follow-ups are slice 8 (communities, once data is real), `xs reindex --from-vault`, and slice 10 (likes/posts in scraper).

## Open file paths to remember

- `docs/ARCHITECTURE.md` — full design + Kùzu→Neo4j pivot history
- `docs/ROADMAP.md` — original slice plan
- `docs/CODING_STANDARDS.md` — including LLM defaults
- `docs/CODEX_REVIEW.md` — review process
- `~/.config/x-scraper/.env` — six API keys + Neo4j creds + `XSCRAPER_REST_TOKEN`
- `~/Documents/x-scraper-vault/` — created by `node packages/cli/dist/bin.js init`
- `~/.config/x-scraper/queue.sqlite` — created by `xs init`
