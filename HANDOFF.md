# Session Handoff

> Updated 2026-04-26 at the end of a session that shipped a further 7 PRs on top of the prior 9, taking us from 4 production packages to 14 and from 137 to 227 tests.
> Read this first in the next session.

## Current State

The repo is live at github.com/wiseyoda/x-scraper with `main` clean and green. Working tree is clean. No PRs are in flight.

```
git log --oneline -20 main
<slice-18 squash>     Slice 18: docs + onboarding refresh (#21)
<slice-16 squash>     Slice 16: scraper bot-mitigation primitives (#20)
15265fe              Slice 17: packages/observability — structured logger + perf timers (#19)
6de8a57              Slice 15: packages/digest — weekly digest + launchd plist (#18)
7be7494              Slice 13: packages/rest — localhost REST API (Hono) (#17)
a827e92              Slice 12: packages/mcp-server — vault search/read/status over MCP (#16)
49fbd4a              Slice 11: packages/search — Exa / Tavily / Brave + auto-expand (#15)
32c788b              Slice 9:  packages/ingestor — article + repo + youtube (#14)
08dc9b2              docs: refresh HANDOFF.md (#13)
ec3a430              Slice 14: packages/cli — xs init / status / cost / doctor (#12)
93103f3              Slice 7:  packages/reconciler — ER + ADD/UPDATE/DELETE/NONE (#11)
95f4f6a              Slice 6:  packages/llm + packages/extractor (#10)
0d6e375              Slice 5:  packages/embeddings — Gemini + OpenAI (#9)
1c18255              docs: add CLAUDE.md (#8)
9fe3683              Slice 4:  packages/graph — Neo4j adapter (#7)
a36002f              Slice 3:  packages/queue — durable SQLite queue + cost ledger (#6)
8b2f15f              Slice 2:  packages/core + packages/vault (#3)
f020ac2              fix(scraper): cursor backfill + passive resume + replay fallback (#4)
44fa305              Slice 1:  packages/scraper + Neo4j pivot (#2)
4a0adc4              Spikes 1-8 (#1)
```

## Package Map

```
packages/core           Zod schemas, frontmatter codec, IDs, URL canon
packages/vault          Markdown vault, simple-git auto-commit, safeJoin
packages/scraper        X.com auth + bookmarks fetch + bot-mitigation prims
packages/queue          Durable SQLite job queue + cost ledger (lease-token-safe)
packages/graph          Neo4j adapter for the bi-temporal graph
packages/embeddings     Gemini (primary) + OpenAI (alt) behind EmbeddingProvider
packages/llm            Claude Sonnet/Haiku behind LlmProvider with prompt caching
packages/extractor      Versioned extraction prompts + Zod-validated output
packages/reconciler     ER (vector + LLM judge) + ADD/UPDATE/DELETE/NONE
packages/ingestor       article (Readability) + repo (GitHub) + youtube (captions)
packages/search         Exa + Tavily + Brave + auto-expand with dedupe
packages/cli            `xs` — init / status / cost / doctor (zero-dep argv)
packages/mcp-server     `xs-mcp` — search_vault / read_source / queue_status
packages/rest           `xs-rest` — Hono REST mirror with bearer auth
packages/digest         Weekly digest + launchd plist builder
packages/observability  pino-compatible NDJSON logger + perf timers
```

## What Was Done This Session

This session continued the build that started in the prior session. Phase 0

- slices 5/6/7/14 were already merged at the start. We added 7 more slices,
  each through the same loop: branch off main, write the package + tests,
  gate (lint + typecheck + format + test), open PR, run codex review,
  fix every P1/P2 finding, push, wait for CI, squash-merge.

* **Slice 9 (`packages/ingestor`)**: three adapters behind one Ingestor
  port — article (`@mozilla/readability` + jsdom), repo (GitHub REST),
  youtube (parses ytInitialPlayerResponse, fetches the timed-text XML).
  Codex caught (P2) parseGitHubUrl matching subresource URLs (e.g.
  `/issues/123`) and silently rewriting them to the repo README; (P2)
  README fetch swallowed every non-200 instead of just 404; (P2)
  fetchJsonWithTimeout did unchecked `as T` casts. Fixed all three;
  added `httpStatus` to IngestorError.
* **Slice 11 (`packages/search`)**: Exa / Tavily / Brave behind a
  SearchProvider port + autoExpandClaim with vault-aware dedup via
  `canonicalizeUrl`. Codex clean.
* **Slice 12 (`packages/mcp-server`)**: production MCP over stdio with
  three tools (search_vault, read_source, queue_status). Pure handlers
  unit-tested directly; thin MCP wiring on top. Codex clean.
* **Slice 13 (`packages/rest`)**: Hono REST mirror of the MCP surface,
  bearer-token-protected. Codex caught (P2) the bin only read
  XSCRAPER_REST_TOKEN from process.env (not the .env file), silently
  disabling auth; (P2) the documented `curl /search?q=foo` GET path
  returned 404 because we only registered POST. Fixed both — bin now
  parses `~/.config/x-scraper/.env` and FAILS CLOSED unless
  XSCRAPER_REST_ALLOW_UNAUTH=1 is set.
* **Slice 15 (`packages/digest`)**: buildDigest pure function over the
  vault + buildLaunchdPlist for ~/Library/LaunchAgents. Codex caught
  (P2) the digest window stretched up to 13 days when run on Sunday;
  (P2) LLM prompt only listed ids and paths so the model couldn't
  actually summarize. Fixed: exact 7-day window, prompt now includes
  url/title/triple/body excerpt clamped to 800 chars per record.
* **Slice 16 (scraper bot-mitigation)**: jitteredDelay + createSessionCap
  - createQueryIdRegistry. Pure-ish helpers with injectable rng / now /
    delay so unit tests skip real timers. Codex clean.
* **Slice 17 (`packages/observability`)**: tiny zero-dep NDJSON logger
  with bindings + child loggers + level gate; `time`/`timeSync` perf
  helpers. Codex caught (P2) caller bindings could replace `time`/
  `level`/`msg` in the JSON output and (P2) `options.fields` could
  replace `label`/`ms` in timer output. Fixed both: reserved fields
  are spread last.
* **Slice 18 (this PR)**: refreshed HANDOFF.md and CLAUDE.md to match
  the post-slice-17 reality.

## Key Decisions This Session

- **Codex review remains worth it on every slice**, even the small
  ones. Across 7 PRs codex flagged 11 real P1/P2 issues that lint /
  typecheck / format / tests didn't catch (mostly bi-directional fields
  trumping caller data, security defaults that fail open, semantic
  prompt content). Cost: ~5 min per slice. Value: huge.
- **`as T` casts at JSON boundaries are a footgun.** Codex flagged
  this on the ingestor's GitHub helper. Now every adapter that touches
  external JSON validates with a Zod schema before reading any field.
- **Reserved fields beat caller data.** Both the logger (time/level/msg)
  and the timer (label/ms/error) make the producer authoritative,
  not the caller. Spread caller fields first, reserved fields last.
- **Auth fails closed.** xs-rest refuses to start without
  XSCRAPER_REST_TOKEN unless XSCRAPER_REST_ALLOW_UNAUTH=1 is explicitly
  set. The roadmap originally documented "localhost-only by default";
  that's a defense-in-depth measure, not a substitute for auth.
- **GET + POST for documented paths.** The REST `/search` endpoint
  speaks both; POST takes a JSON body, GET maps `?q=...&type=...&limit=...`.
- **Session caps are rolling-window + injectable clock.** Real
  rate-limit primitives must be testable without sleeping; ours are.

## What Failed (and how to repeat)

- **Codex sandbox `tsc --noEmit` writes to dist/.tsbuildinfo and fails
  with EPERM.** Codex itself reports this as a typecheck failure;
  ignore it — local `pnpm typecheck` is the source of truth and CI
  runs in a writable workspace.
- **Hono Context type can't be expressed with
  `Parameters<Parameters<typeof app.post>[1]>[0]`.** Use `import type
{ Context } from 'hono'` and annotate explicitly.
- **`exactOptionalPropertyTypes: true`** continues to reject the
  `{ runId: maybeUndefined }` pattern. Use conditional spreads
  consistently across packages.

## Deferred / Backlog

- **Slice 8: community detection + topic notes.** Leiden via Neo4j
  GDS over the Concept/Topic subgraph, periodic recluster, topic.md
  regen via Sonnet synthesis, cross-topic RELATED_TO edges.
- **Slice 10: scraper extension for likes + own posts.** Currently
  bookmarks-only. Needs the matching X.com GraphQL endpoints + parser.
- **PDF ingestor.** Article/repo/youtube shipped in slice 9; PDF
  was deferred. The `Ingestor` port already accommodates it.
- **Wire `xs sync`.** The CLI exposes init/status/cost/doctor; the
  full orchestration (fetch → embed → extract → reconcile → write_vault
  → update_graph) needs a CLI command that pulls the queue, dispatches
  to ingestors by source kind, and invokes the LLM/embedding adapters.
  This is the single highest-value follow-up.
- **`xs reindex --from-vault`** to rebuild the graph from markdown.
- **`xs review` interactive merge-decision queue** (per the roadmap).
- **`xs auth login`** wiring the spike-1 cookie-import + Patchright
  fallback into the CLI.
- **`xs mcp register --client {claude,codex,gemini}`** that writes the
  appropriate MCP server config block.
- **xs status TUI.** Currently plain text. Roadmap calls for ink/blessed.
- **Perf regression gate in CI.** Roadmap calls for a 5%-degradation
  fail on hot paths (vector search, traversal, reconcile).
- **Golden corpus** for the extractor (10 hand-picked source markdowns
  - expected extraction JSON). Currently extractor tests use
    synthesized JSON inline.
- **HNSW dimension production check.** `packages/graph/src/constants.ts`
  defaults to 1536 (Gemini Matryoshka). Integration tests use 16 dims.
  No runtime guard yet.

## Traps for Next Session

- **Branch off main AFTER the prior slice merges.** No stacking.
- **Run `codex review --base main`** on every slice PR before merge.
  The pattern this session: file PR, codex finds 0–3 P1/P2 issues, fix,
  re-push, CI green, merge.
- **Always check `stop_reason`** on Anthropic replies. The LlmProvider
  port already throws TRUNCATED on `stop_reason === 'max_tokens'`.
- **`max_tokens` 16k–32k for extraction.** Default is 16k.
- **Cost is recorded BEFORE any throw path.** If you add new error
  paths in the LLM adapter, record cost first.
- **Vector search expects a single embedding space per result set.**
  Gemini fallback re-runs the first batch on fallback; don't undo.
- \*\*Bi-temporal upsert: `OPTIONAL MATCH ... WHERE invalid_at IS NULL`
  - two FOREACH branches.\*\* A plain MERGE will clobber history.
- **All provider JSON gets Zod-validated at the boundary.** No `as T`.
- **Reserved fields beat caller data** in the logger and the timer.
  When you add new fields to either, double-check the spread order.
- **Neo4j tests need a running daemon.** `brew services start neo4j`.
- **`pnpm.onlyBuiltDependencies` is unreliable.** Workaround documented
  in slice 3.

## Next Steps

The repo now has every component the architecture needs: data layer
(vault, queue, graph), provider adapters (embeddings, llm), pipeline
modules (extractor, reconciler, ingestor, search), surfaces (cli,
mcp-server, rest), supporting (digest, observability), and the original
scraper. The single remaining pre-1.0 item that ties it all together is
**`xs sync`** — wire the queue stages (fetch_links → extract_text →
embed_source → extract_facts → resolve_ents → reconcile → write_vault
→ update_graph) into a runnable CLI command. With slice 17's logger
attached at every stage and slice 16's session cap on the scraper, the
orchestration should be small.

After that:

1. Slice 8 (communities) once we have real ingested data to cluster.
2. Slice 10 (likes/posts) — minor scraper extension.
3. PDF ingestor follow-up.
4. Golden corpus + perf regression gate (CI hygiene).

Open file paths to remember:

- `docs/ARCHITECTURE.md` — full design + Kùzu→Neo4j pivot history
- `docs/ROADMAP.md` — original slice plan
- `docs/CODING_STANDARDS.md` — including the LLM defaults
- `docs/CODEX_REVIEW.md` — review process
- `~/.config/x-scraper/.env` — six API keys (chmod 600)
- `~/Documents/x-scraper-vault/` — created when you run `xs init`
- `~/.config/x-scraper/queue.sqlite` — created when you run `xs init`
