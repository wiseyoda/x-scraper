# Session Handoff

> Updated 2026-04-27 end of session 6. Pat had to leave mid-ramp.
> Three things shipped to main this session:
>
> 1. **PR #28 merged** as squash `f8a567f` — bookmark ledger + X Article
>    ingestor + 12 quality upgrades + 11 codex/quality fixes. Branch
>    `feat/bookmark-ledger` deleted locally and remotely.
> 2. **Backed-off ramp** at the new iCloud-safe vault `~/x-scraper-vault`
>    drove all **200 organic bookmarks to synced**. Step 128 was still
>    draining the derived-row backlog (~176 derived new, 6 synced, 1
>    dead) when this was written. Bash background task running step 128
>    will continue if/when Claude Code closes; queue is durable so
>    nothing is lost.
> 3. **`docs/web-ui/` planning set** (6 markdown files, ~56KB) for a
>    Next.js 15 + shadcn web app with knowledge-graph viz + Claude
>    Agent SDK research surface. Build-this-week feature.
>
> **Read this first, then resume with the "On resume" section below.**

## What landed in main this session (f8a567f, squash of 26 commits)

Session 6 picked up from session 5's PR #28 (which was open with all of
T8–T23 + X Article ingestor + content_type routing). Did the full reset
Pat called for, ran a smoke, found bugs, fixed them, ran codex review
twice, fixed everything codex caught, ramped through the corpus.

### Codex review pass 1 fixes (5 of 6 from log run-20260426-234520.log)

- **P1** `@x-scraper/community` TS resolution (root tsconfig + cli refs).
- **P1** `t.co` resolved before derived ledger row creation —
  `fetchLinksStage` now uses `expandedUrls` from the ledger when present;
  body URL_RE scanning is the fallback for non-tweet sources.
- **P2** Cooccurrence ON MATCH only increments `cooccurrence_count` when
  `$sourceId` is not already in `r.sources`. Prevents retry/reindex
  overweighting concept pairs.
- **P2** `xs trends` Top authors uses the `AUTHORED_BY` edge
  (T20-materialized Person), not dotted access into the
  literal-keyed `host_metadata.byline` property.
- **P2** `vault.read`/`list('Source')` probe routed `sources/<kind>/`
  before legacy flat `sources/`, dedupe by id.
- **P2** Backfill spike pagination uses stable `n.id > $lastId` cursor —
  prior SKIP+IS-NULL pattern silently skipped about half the corpus on
  every backfill. (Moot for our wiped vault, fixed for hygiene.)

### Codex review pass 2 fixes (5 from run-fixes-20260427-073610.log)

- **P2** Preserve x.com → x.com/i/article/... links during expansion —
  fetchLinksStage no longer drops ALL same-host URLs; only exact
  self-link + tweet permalinks.
- **P2** Cooccurrence edges isolated from generic semantic upserts via
  `kind IS NULL` filter in `buildUpsertEdge`.
- **P2** Entity vector overfetch ×10 — `db.index.vector.queryNodes`
  returns top-k globally, then we filter by label; without overfetch the
  filter could yield zero same-type candidates in a mixed graph.
- **P2** Edit-version chain via `tweet_id` — new
  `queue.bookmarkChainStatus(tweetId)` returns latest-non-superseded +
  chain length; second edit gets a non-colliding `_v2`.
- **P2** `xs trends --format=json` sends NDJSON logs to stderr.

### My-eyes findings + user-asked features

- x-article body uses `.innerText` (preserves block boundaries) +
  byline anchor-href fallback. Article body went from one wall of
  text to 175 lines with paragraph breaks.
- Self-referential entity filter — drops Article/PDF/Repo/Tweet/Video
  entities whose name matches the source title and content_type, so
  the canonical Source.md isn't shadowed by an empty stub.
- **Auto-ingest from entity aliases** — when extract_facts returns an
  Article/Repo/Video/PDF entity with a URL alias, enqueue a derived
  ledger row for it. Mirrors T13 for entity-discovered links.
- **Extractor prompt v2** — Repo REQUIRES github URL; Article requires
  non-tweet http URL; Video requires youtube URL; PDF requires .pdf
  URL; otherwise classify Concept/Tool. Bumps EXTRACTION_PROMPT_VERSION
  to 2; v1 still exported for historical analysis. Verified:
  voxyz.space (was misclassified as Repo) is now correctly Concept
  with the URL in aliases.
- **Entity stub merge across mentions** — read-then-merge
  sources/aliases/created_at when an entity is re-mentioned by a new
  source. Body now includes `## URLs` and `## Mentioned in [[src_X]]`
  sections for click-through navigation.
- **iCloud-safe default vault path** — `DEFAULT_VAULT_DIR` is now
  `~/x-scraper-vault`. doctor warns when vault realpath resolves into
  iCloud Drive's `Mobile Documents/com~apple~CloudDocs`. Pat's
  `~/Documents` was symlinked to iCloud, causing `topics 2/` ghost
  dirs from concurrent mkdir + iCloud sync conflict resolution.
- **CI build before lint** — typescript-eslint's projectService relies
  on each package's `dist/index.d.ts` to resolve cross-package imports;
  on a fresh CI checkout that didn't exist, so cross-package types
  degraded to `error` and triggered no-unsafe-* errors. Fixed by
  reordering CI steps.

### State of the persistent stores AT THE TIME OF THIS WRITE

(These will keep advancing while step 128 runs; resume should re-query.)

- bookmark_ledger:
  - `organic|synced` 165, `organic|new` 35
  - `derived|synced` 1, `derived|new` 152
- vault `~/x-scraper-vault/`:
  - sources: 203 (`.md`)
  - claims: 1097
  - entities: 316
- Neo4j: schema bootstrapped with `claim_embed_idx` + `entity_embed_idx`
  HNSW (1536 dims), all 7 unique constraints
- cost ledger: $3.32 spent so far
- ghost dirs: 0 (iCloud-safe path holding firm)
- failures/dead jobs: 0

### Ramp progression so far

| Step | limit | succeeded | failed | duration | cost | derived enqueued |
|------|-------|-----------|--------|----------|------|------------------|
| 0a   | 1 oldest  | 1 (t.co stub) | 0 | <1s     | $0.00 | 1 |
| 0b   | 1 newest  | 1 (X Article smoke) | 0 | 135s    | $0.116 | 0 |
| 2    | 2  | 2  | 0 | 24s   | $0.031 | 2  |
| 4    | 4  | 4  | 0 | 27s   | $0.042 | 3  |
| 8    | 8  | 8  | 0 | 30s   | $0.046 | 6  |
| 16   | 16 | 16 | 0 | 130s  | $0.192 | 14 |
| 32   | 32 | 32 | 0 | 413s  | $0.615 | 37 |
| 64   | 64 | 64 | 0 | ~10m  | $1.284 | 67 |
| 128  | 128 | in flight | 0 | running | running | running |

## docs/web-ui/ — planned Next.js + Agent SDK app

Six planning docs at `docs/web-ui/` (committed in `8e33c9e`):

- `README.md` — overview, scope, tech stack at a glance, layout sketch
- `ARCHITECTURE.md` — Next.js 15 + RSC + Server Actions structure,
  runtime model, hot-reload-safe singletons, auth, caching, CI
- `AGENT_SDK.md` — read flow vs write flow, tool catalog (read +
  write tables), in-process MCP server pattern, streaming wiring,
  session persistence schema, three-layer safety
- `GRAPH_VIS.md` — Sigma.js v3 + Graphology + `@react-sigma/core`
  decision (with comparison table), visual encoding, ForceAtlas2 in
  a worker, URL-encoded saved views, topic halo overlay
- `COMPONENTS.md` — three-tier rule (shadcn → domain → page),
  inventory of `<EntityCard>`, `<ClaimRow>`, `<GraphCanvas>`,
  `<AgentChat>`, etc., hooks, state-management posture
- `ROADMAP.md` — four-phase build plan (~5–7 days): scaffold → read
  surface → graph viz → write flow + polish, exit criteria per
  phase

Stack lock-in: Next.js 15 + Tailwind 4 + shadcn/ui + Sigma.js +
TanStack Table + Vercel AI SDK + Claude Agent SDK. App lives at
`apps/web-ui` (the existing `pnpm-workspace.yaml` already has
`apps/*`). Single user, localhost-only, bearer auth.

Three research agents informed each doc — claude-code-guide for the
Agent SDK, two general-purpose for graph viz library comparison and
Next.js 15 + shadcn data-app patterns.

## On resume

### 1. Verify step 128 finished cleanly

```bash
grep -c 'item.failed' .repostat/ramp-logs/step-128.log
grep -c 'sync.finished' .repostat/ramp-logs/step-128.log
sqlite3 ~/.config/x-scraper/queue.sqlite "SELECT source_kind, status, COUNT(*) FROM bookmark_ledger GROUP BY source_kind, status;"
```

If finished cleanly, expect ~all organics synced (`organic|new` near 0)
and a larger derived backlog.

### 2. Fix the t.co-in-entity-alias bug

Surfaced during the ramp: my Phase 6a auto-ingest of URLs from entity
aliases doesn't filter `t.co` shortlinks the way `fetchLinksStage`
does for body URLs. When the LLM emits a `t.co` URL in an entity
alias, `enqueueEntityLinkDerivedRows` writes it to the derived ledger
as-is. Readability returns null → permanent failure → dead.

**Already 1 dead row** from this: `derived_src_eb5e996c`,
`https://t.co/P5rjoZxD4A`. Likely more by the time step 128 finishes.

Fix is one block in
`packages/cli/src/commands/sync/stages.ts:enqueueEntityLinkDerivedRows`:
add a `t.co` hostname guard alongside the existing
`X_TWEET_URL_RE.test(canonical)` skip. The canonical t.co URL won't
resolve here without an HTTP HEAD; simplest is to skip any URL whose
host is `t.co`.

After fixing: any dead rows can be retried via the queue's
`retryFailed` if you want them re-attempted on the LLM resolving the
final URL through some other path. Or just leave them as a record
that the t.co target was unrecoverable.

### 3. Drain remaining derived rows in doubling batches

By the time step 128 finishes there will likely still be 50–100
derived rows in `new` (the queue auto-expands as it ingests). Drain
in doubling batches (`--limit=2`, 4, 8, 16, 32, 64, 128) until
`derived|new` = 0. Stop on any unexpected failure pattern (more than
1-2 dead per batch).

Some derived rows will be cross-host articles (high body, high
extract cost: $0.10-0.30 each). Some will be github repos (~$0.01
each via RepoIngestor). Budget another $5-15 to drain all derived
that come in.

### 4. After everything settles

- Run `xs topic detect --synthesize` against the populated graph (now
  has 600+ entities, much richer cooccurrence — should produce real
  community-based topics for the first time this session).
- Run `xs trends` to confirm the data looks sensible.
- Look at the vault in Obsidian: open a couple Source.md files, click
  through to entity stubs, verify the `## Mentioned in` wikilinks
  resolve correctly across multi-source entities.

### 5. Start building apps/web-ui

Plan is in `docs/web-ui/`. Phase 0 (scaffold) is half a day. See
`docs/web-ui/ROADMAP.md` for the four-phase plan and exit criteria.

## Key absolute paths

- vault: `~/x-scraper-vault/` (NEW, non-iCloud)
- queue: `~/.config/x-scraper/queue.sqlite`
- env: `~/.config/x-scraper/.env` (chmod 600)
- ramp logs: `.repostat/ramp-logs/step-{1,2,4,8,16,32,64,128}.log`
- codex review logs: `.repostat/codex-review/run-*.log`
- snapshots from earlier in session (recoverable):
  - `/tmp/x-scraper-vault-pre-reset` (session 5 state, 525 sources)
  - `/tmp/queue-pre-reset.sqlite` + `/tmp/neo4j-pre-reset/`
  - `/tmp/x-scraper-vault-post-smoke` (post-fix-1 smoke)
  - `/tmp/x-scraper-vault-post-phase6-prereset`

## Traps that still apply

- **Use `/opt/homebrew/bin/node`** for the CLI (matches better-sqlite3
  ABI; nvm `node` is wrong NODE_MODULE_VERSION).
- **The bash background task running step 128 may be killed** when
  Claude Code closes. The queue is durable so no work is lost — any
  jobs the dying process had leased get reclaimed by stale-lease
  recovery on the next claimNext().
- **`xs schedule install` is still untested end-to-end** — won't matter
  for the immediate ramp finish, but worth noting for future cron use.
- **Codex review pending re-run** — main is now at `f8a567f` with the
  squash; if you want a fresh codex pass on main rather than on the
  branch (since branch is gone), spin up a worktree at main HEAD.
- **CI is now: build → lint → typecheck → test → circular**. If you
  reorder, lint will fail on cross-package imports.

## Open task slots

- #5 ramp re-ingest — derived backlog still draining
- #6 plan apps/web-ui — DONE (in `docs/web-ui/`)
- #9 build apps/web-ui per `docs/web-ui/ROADMAP.md` — pending

## State of the persistent stores (snapshot taken just before write)

- bookmark_ledger:
  - `organic|synced` **200 / 200**  ✓ (full corpus ingested)
  - `derived|synced` 6, `derived|new` 176, `derived|failed` 1 (dead)
- vault `~/x-scraper-vault/`:
  - sources: ~210
  - claims: ~1100
  - entities: ~320
- cost ledger: ~$3.40 spent
- ghost dirs: 0
- Step 128 bash bg task: still running, ~62/128 items done

## Files that may matter

- `packages/cli/src/commands/sync/stages.ts` — fetchLinksStage,
  extractFactsStage (incl. self-ref filter + entity-link enqueue),
  writeVaultStage (incl. writeMergedEntity helper)
- `packages/cli/src/commands/bookmarks.ts` — edit-version chain via
  `bookmarkChainStatus`
- `packages/cli/src/commands/trends.ts` — JSON mode logger to stderr
- `packages/extractor/src/prompts/extraction-v2.ts` — new strict
  classification rules (Repo requires github URL etc.)
- `packages/ingestor/src/x-article.ts` — innerText body extraction +
  anchor-first byline
- `packages/cli/src/constants.ts` — `DEFAULT_VAULT_DIR` is now
  `~/x-scraper-vault`
- `packages/cli/src/commands/doctor.ts` — `vault-icloud` check
- `.github/workflows/ci.yml` — build runs before lint
