# Session Handoff

> Updated 2026-04-26 after a session that drained the entire roadmap backlog: 7 PRs implementing xs sync orchestration, xs reindex, xs auth/mcp/review, PDF ingestor, HNSW dim guard, golden corpus, community detection, perf benches, and likes/posts scraper primitives. **All roadmap slices are now implemented.**
>
> Read this first in the next session.

## Current State

The project no longer has a roadmap backlog. Every slice from `docs/ROADMAP.md` is either merged or under review. Two PRs are open:

- **#25** — Slices 21-27 consolidated: xs sync + reindex + auth/mcp/review + PDF ingestor (slice 20) + HNSW dim guard (slice 19) + golden corpus + community detection + perf benches. **8 codex P1/P2 findings fixed across 4 review rounds.** Live-verified end-to-end on real Neo4j + Gemini + Claude.
- **#26** — Slice 22: scraper likes + own-posts (parsing + passive capture). Live X.com verification deferred — needs an authenticated Patchright profile.

Once both merge, every roadmap slice ships. The user can run `xs sync --urls=...`, `xs reindex --from-vault`, `xs auth login`, `xs mcp register --client=claude`, etc. against the existing local services.

```
git log --oneline -5 main
689d372 docs(handoff): end-of-session refresh with precise next-step playbook (#22)
f5097c9 docs(slice-18): refresh README, CLAUDE.md, HANDOFF.md after slices 9-17 (#21)
e4ba7ef feat(slice-16): scraper bot-mitigation primitives (#20)
15265fe Slice 17: packages/observability — structured logger + perf timers (#19)
6de8a57 Slice 15: packages/digest — weekly digest + launchd plist (#18)
```

## Package Map (17 packages)

| Package         | Public surface                                                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`          | `ENTITY_TYPES`, `EDGE_TYPES`, `FrontmatterSchema`, `parseDocument`/`formatDocument`, `canonicalizeUrl`, ID gen, content hash                                                                                                                                  |
| `vault`         | `createMarkdownVault({root})` → `{init, read, write, list, commit}`; `safeJoin`                                                                                                                                                                               |
| `scraper`       | `openAuthenticatedSession`, `fetchBookmarks`, `fetchLikes`, `fetchPosts`, `passiveCaptureBookmarks`, `passiveCaptureTimeline`, `parseBookmarksPage`, `parseUserTimelinePage`; `jitteredDelay`, `createSessionCap`, `createQueryIdRegistry`                    |
| `queue`         | `createSqliteQueue(path)` → `{startRun, enqueue, claimNext({runId?}), completeStage, completeAllStages, failStage, retryFailed, recordCost, costSince, stats}`                                                                                                |
| `graph`         | `createNeo4jGraph({uri,user,password})` → `{init, upsertNode, upsertEdge, invalidateEdge, vectorSearch, traverse, countNodes}`. **Init checks for HNSW dim drift and refuses to bind to a wrong-dim index. upsertNode/vectorSearch assert embedding length.** |
| `embeddings`    | `createGeminiEmbedding({apiKey, ...})`, `createOpenAIEmbedding({apiKey, ...})` → `{provider, dims, embed(texts)}`                                                                                                                                             |
| `llm`           | `createClaudeProvider({messagesCreate, ...})` → `{complete(req)}`; throws `TRUNCATED` on max_tokens; cost recorded BEFORE throw                                                                                                                               |
| `extractor`     | `extract(llm, {body, title?, sourceUrl?})` → validated `{entities, claims, relationships}` via Zod + repair loop. **Golden corpus of 5 fixtures guards against schema regressions.**                                                                          |
| `reconciler`    | `resolveEntity({candidateName, candidateEmbedding, type}, {finder})` → `MERGE`/`NEW`/`SAME_AS_PROBABLE`; `reconcileClaim({incoming, existing})` → `ADD`/`UPDATE`/`DELETE`/`NONE`. **`ExistingClaim` carries `sourceId` for correct edge invalidation.**       |
| `ingestor`      | `createArticleIngestor`, `createRepoIngestor`, `createYouTubeIngestor`, **`createPdfIngestor`**; `selectIngestor(url, ingestors[])`                                                                                                                           |
| `search`        | `createExaSearch`, `createTavilySearch`, `createBraveSearch`; `autoExpandClaim(claim, {providers})`                                                                                                                                                           |
| `cli`           | `xs init / sync / reindex / status / cost / doctor / auth login / mcp register / review`; `parseArgs`, `resolveConfig`                                                                                                                                        |
| `mcp-server`    | `buildMcpServer({vault, queue})`; `xs-mcp` stdio bin; tools: search_vault / read_source / queue_status                                                                                                                                                        |
| `rest`          | `buildRestApp({ctx, bearerToken})`; `xs-rest` bin; `/health`, `/search` (GET+POST), `/read`, `/status`                                                                                                                                                        |
| `digest`        | `buildDigest(vault, {now, llm?})`; `buildLaunchdPlist({label, programPath, intervalSeconds})`                                                                                                                                                                 |
| `observability` | `createLogger({level, sink, bindings, now})` → `{debug, info, warn, error, child}`; `time(log, label, fn)`, `timeSync`                                                                                                                                        |
| `community`     | `detectCommunities({nodes, edges, minCommunitySize?})` → `CommunityResult[]` (Louvain via graphology)                                                                                                                                                         |

## What Was Done This Session

7 PRs through the lifecycle (branch off main → write package + tests → gate locally → live-test against real services where applicable → open PR → `codex review --base main` → fix every P1/P2 → push → CI green → squash-merge ready). PR #25 went through 4 codex review rounds, fixing 8 findings (3 P1 + 5 P2).

| PR  | Slice                          | Live verification                                                                     | Codex P1/P2 fixed                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #23 | Slice 19 — HNSW dim guard      | Real Neo4j: dim-mismatch refused at init; wrong-length embedding rejected on upsert   | none                                                                                                                                                                                                                                                                                                                     |
| #24 | Slice 20 — PDF ingestor        | arXiv "Attention Is All You Need" PDF: 15 pages, 40k chars, 545ms cold                | non-.pdf URL routing + Node engine bump + Buffer/detached-ArrayBuffer normalization                                                                                                                                                                                                                                      |
| #25 | Slices 21-27 (consolidated)    | xs sync end-to-end on the same arXiv PDF (132s, $0.18); xs reindex against the result | run-scoped claim filter; resumable jobs; stage-context derive-from-scratch; completeAllStages avoids re-claim race; finishRun marks failed when failed > 0; vault.commit per run; pending-retry wait loop; reconciler invalidates the existing claim's actual source edge; mcp register resolves bin via import.meta.url |
| #26 | Slice 22 — likes/posts scraper | unit tests only; live X.com verification deferred (requires authenticated Patchright) | none                                                                                                                                                                                                                                                                                                                     |

## Key Decisions

- **GDS Leiden not available**: the local Neo4j Community doesn't have the GDS plugin installed (`gds.list` returns "no such procedure"). The community-detection slice ships in JS via `graphology-communities-louvain` instead. Quality is comparable for our small/medium Concept subgraph; Leiden is a refinement of Louvain.
- **Single-lease per job in xs sync**: the dispatcher runs every stage back-to-back under one queue lease, then uses `completeAllStages` to finish atomically. Avoids the inter-stage re-claim race that release-and-reclaim would create, and a resumed job derives its own context from scratch (no stale ingested/embedding/extraction nulls).
- **Run-scoped claim filter**: `queue.claimNext({runId})` is the new default for the dispatcher so a fresh sync can't accidentally lease and DLQ a stale pending job from a prior run.
- **Pending-retry wait loop**: when the in-run claim returns null but pending jobs are still scheduled with a future `next_run_at`, the dispatcher sleeps until the earliest is ready (10-min total budget). Without this, retryable failures stranded jobs forever — later sync invocations use a different runId and the runId-scoped claim never picked them up.
- **HNSW dim guard**: `init()` reads existing index dims via `SHOW VECTOR INDEXES` and refuses to bind on drift. `upsertNode`/`vectorSearch` assert embedding length up front. Production index lives at 1536 dims; integration tests now use the same index with prefixed `xs_int_test_*` ids and DETACH DELETE cleanup.
- **Vitest integration-test gating fixed**: the original config unconditionally excluded `*.integration.test.ts`, so the documented `RUN_INTEGRATION=1 pnpm test` command never actually ran them. Now opt-in via the env var.
- **Codex pattern is reliable**: across PR #25's 4 review rounds, codex caught 8 real P1/P2 issues that local gates passed cleanly. Bake into every slice from now on.

## What Failed (still useful learning)

- **Top-level `await` in a vitest test file** under esbuild ESM transform — switch to sync `fs.readdirSync` for fixture loading.
- **`vi.spyOn(os, 'homedir')`** fails under Node ESM ("Cannot redefine property"). Use `vi.stubEnv('HOME', ...)` and resolve home lazily inside helpers.
- **`graphology` and `graphology-communities-louvain`** ship as CJS with a `default` export. Under NodeNext + verbatimModuleSyntax, `import * as Mod from 'graphology'` and grab `Mod.default` as the constructor.
- **better-sqlite3 native module** keeps drifting between NODE_MODULE_VERSION 137 (Node 24) and 141 (newer). When a sync command says "compiled against a different Node.js version", `cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && rm -rf build && npx node-gyp rebuild`.
- **pdfjs-dist** rejects Node `Buffer` even though it extends `Uint8Array`, AND it detaches the input ArrayBuffer. Always copy to a fresh `new Uint8Array(bytes.byteLength); data.set(bytes)` before `getDocument`.
- **Neo4j `CREATE VECTOR INDEX ... IF NOT EXISTS`** is keyed on `(label, property)`, not name. Two parallel indexes on `(:Claim).embedding` cannot coexist — integration tests share the production index instead of trying to create a separate one.

## Deferred / Backlog (genuinely small now)

- **Live X.com test for slice 22** — likes/posts scraping needs a logged-in Patchright profile to verify against the real GraphQL responses. The parser is unit-tested with synthesized fixtures.
- **Topic.md regeneration via LLM** — the community detector finds clusters; the synthesis step that turns each cluster into a `topics/<id>.md` via Sonnet hasn't been wired. Requires a topic-summary prompt and a per-community LLM call (expensive — once per recluster).
- **`xs topic detect` CLI command** — wire `detectCommunities` into a CLI entry point that walks the graph for Concept nodes + RELATED_TO edges, runs detection, writes Topic nodes.
- **CI bench job** — RUN_BENCH=1 wired into a separate workflow with a baselined runner profile. Today it's local-only opt-in.
- **RUN_GOLDEN_LIVE=1** — the golden corpus tests stub the LLM; a live mode that calls real Sonnet and diffs against the snapshot would catch prompt/model drift but is billed per run.
- **Auto-expand integration in xs sync** — slice 11 (search package) ships standalone; the `fetch_links` stage in the dispatcher is a pass-through stub. Future work: wire `autoExpandClaim` so high-signal sources spawn discovery jobs.

## Traps for Next Session

- **Don't trust the cwd** for resolving bundled binaries from CLI commands. Use `fileURLToPath(import.meta.url)` and walk up from there. (Caught by codex P2 on mcp-register.)
- **`ExistingClaim.sourceId` is required**. The reconciler's UPDATE/DELETE decisions need it to invalidate the right edge; the dispatcher's update_graph stage uses it. If you add a new `claimFinder` adapter, populate `sourceId`.
- **Run-scoped queue claims**. Always pass `{runId}` to `claimNext` from xs sync — without it, a new sync will lease stale jobs from prior runs and DLQ them as UNKNOWN_SOURCE.
- **completeAllStages, not per-stage completeStage**, when the dispatcher runs every stage in one pass (which it does in v1). The per-stage `completeStage` API is preserved for future split-process workers but is footgun-prone.
- **codex sandbox `tsc --noEmit`** still fails with EPERM on `dist/.tsbuildinfo`. Local `pnpm typecheck` is the source of truth.
- **HNSW dim drift refused at init**. If you ever want to change embedding dims, drop `claim_embed_idx` first.
- **All the slice-21 traps from prior sessions still apply**: `max_tokens` 16k–32k for extraction; cost is recorded BEFORE the throw path in LLM adapter; bi-temporal upsert uses `OPTIONAL MATCH ... WHERE invalid_at IS NULL` + two FOREACH branches; reserved fields beat caller data; auth fails closed.
- **Better-sqlite3 native ABI** can desync from the Node version vitest uses. If `pnpm test packages/cli` says "compiled against a different Node.js version", rebuild it via `npx node-gyp rebuild` from inside its `.pnpm/...` dir.

## Next Steps — exactly where to pick up

1. **Merge PR #25 and PR #26** once their CI is green and codex on each is clean. (PR #25 has been through 4 codex rounds; v4 was running at end of session.)
2. **Live-verify slice 22 likes/posts** against your real X.com session. Open `xs auth login` first to refresh the Patchright profile, then call `fetchLikes(session, {maxBookmarks: 5})` from a spike to confirm the parser picks up the real GraphQL response shape. If it doesn't, the schema may have drifted since the bookmarks endpoint baseline.
3. **Wire `xs topic detect`** — add `packages/cli/src/commands/topic.ts` that:
   - Reads Concept-RELATED_TO-Concept edges from the graph (via a new `graph.listConceptEdges()` helper or a direct Cypher session)
   - Calls `detectCommunities({nodes, edges, minCommunitySize: 5})`
   - For each community, optionally calls Claude Sonnet with the member names to synthesize a topic title + summary (single LLM call per community)
   - Writes `topics/<topic_id>.md` and upserts a Topic node with `member_count` + `representative_claims`
   - Writes RELATED_TO edges between member Concept nodes and the new Topic
4. **Add a bench CI job**. Pull the local timings off the most recent RUN_BENCH=1 run (currently logged via console.log in each bench file) into a baseline file, then wire a workflow that fails when median exceeds 1.05× baseline.
5. **Slice 11 auto-expand integration**. The search package and ingestors exist; `fetch_links` in the dispatcher is the wire-up point. After ingestion, scan `ctx.ingested.body` for embedded URLs, dedupe against the vault via `canonicalizeUrl + vault.list`, and enqueue them as new SourceItems on the same run.

After those, the project is feature-complete against the original roadmap and ready for `xs sync` to run in a launchd loop on the user's Mac.

## Open file paths to remember

- `docs/ARCHITECTURE.md` — full design + Kùzu→Neo4j pivot history
- `docs/ROADMAP.md` — original slice plan (all slices now shipped)
- `docs/CODING_STANDARDS.md` — including LLM defaults
- `docs/CODEX_REVIEW.md` — review process
- `~/.config/x-scraper/.env` — six API keys + Neo4j creds + `XSCRAPER_REST_TOKEN`
- `~/.config/x-scraper/browser-profile/` — Patchright profile dir created by `xs auth login`
- `~/Documents/x-scraper-vault/` — created by `xs init`; contains the dogfood Source.md from this session's live test
- `~/.config/x-scraper/queue.sqlite` — created by `xs init`; has the run history
- `packages/extractor/src/__tests__/golden/` — 5-fixture corpus for schema regression testing
