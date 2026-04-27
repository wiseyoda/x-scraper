# Session Handoff

> Updated 2026-04-27 at end of session 6. PR #28 merged to main as
> squash `f8a567f`. Branch `feat/bookmark-ledger` deleted. Full
> 200-bookmark corpus ingested at the new iCloud-safe vault path
> `~/x-scraper-vault`. `docs/web-ui/` planning set landed.
>
> **Read this first.**

## Current State

- **Branch**: on `main`, head `85ac4e7` (clean).
- **Corpus**: 200/200 organic synced, 31 derived synced, 154 derived
  pending, 25 derived dead (all from a known one-line t.co bug).
- **Vault** at `~/x-scraper-vault/`: 290 sources, 2258 claims, 509
  entities. `xs doctor` reports `vault-icloud: vault is not iCloud-synced`.
- **Cost ledger**: ~$7.07 spent end-to-end.
- **Test suite**: 332 passing across 47 files. Lint, typecheck, build,
  format clean.
- **CI**: green on `main` after the build-before-lint reorder fix.
- **Codex review**: two passes done this session (logs at
  `.repostat/codex-review/`); all P1+P2 findings addressed except the
  t.co-in-entity-alias bug surfaced AFTER the second pass.

## What Was Done This Session

### Codex review pass 1 fixes (5 fixes, commit 5599583 + c90d0f8 + fe8057a + aa91a9b + 2b5b9e1)

- **P1** `@x-scraper/community` TS resolution — added paths alias and
  cli project reference.
- **P1** `t.co` resolved before derived ledger row creation —
  `fetchLinksStage` now uses `expandedUrls` from ledger when present.
- **P2** Cooccurrence ON MATCH guarded — only increments
  `cooccurrence_count` when `$sourceId` is not already in `r.sources`.
- **P2** `xs trends` Top authors uses `AUTHORED_BY` edge (was broken
  by dotted access into literal-keyed `host_metadata.byline`).
- **P2** `vault.read`/`list('Source')` probe routed `sources/<kind>/`
  before legacy flat `sources/`; dedupe by id.
- **P2** Backfill spike pagination uses `n.id > $lastId` cursor (was
  silently skipping ~half the corpus on every backfill).

### Codex review pass 2 fixes (5 fixes, commit de536c3)

- Preserve x.com → x.com/i/article links during expansion (was
  dropping all same-host URLs; now only drops exact self-link + tweet
  permalinks).
- Cooccurrence edges isolated from generic semantic upserts via
  `kind IS NULL` filter in `buildUpsertEdge`.
- Entity vector overfetch ×10 — `db.index.vector.queryNodes` returns
  global top-k; we filter by label after, so overfetch is needed to
  survive label-filter culling in mixed graphs.
- Edit-version chain via `tweet_id` — new
  `queue.bookmarkChainStatus(tweetId)`; second edit gets a
  non-colliding `_v2`.
- `xs trends --format=json` sends NDJSON logs to stderr (was
  corrupting stdout).

### My-eyes findings + user-asked features (commits fe8057a, 2b5b9e1, e83c8bc)

- x-article body uses `.innerText` (preserves block boundaries) +
  byline anchor-href fallback.
- Self-referential entity stub filter — drops Article/PDF/Repo/etc.
  whose name matches the source's own title at the right content_type.
- Auto-ingest URLs from entity aliases — when an Article/Repo/Video/PDF
  entity has a URL alias, enqueue a derived ledger row.
- Extractor prompt v2 — Repo REQUIRES github URL; Article requires
  non-tweet http URL; Video requires youtube; PDF requires .pdf;
  otherwise Concept/Tool. Bumped `EXTRACTION_PROMPT_VERSION` to 2.
- Entity stub merge across mentions — `vault.read`+merge so re-mentions
  preserve sources/aliases lists; body includes `## URLs` and
  `## Mentioned in [[src_X]]` sections.
- iCloud-safe default vault path: `~/x-scraper-vault` instead of
  `~/Documents/x-scraper-vault`. `xs doctor` warns if the configured
  vault realpath lands inside iCloud Drive.

### Pre-merge gate fixups (commits 5475978, 40bb568, e6e9e8f)

- Auto-formatted 6 prettier-flagged files; fixed 3 lint errors
  (redundant optional chain, unused type parameter, prefer-optional-chain).
- Added `.repostat/` to `.gitignore` and removed an accidentally-committed
  ramp snapshot JSON.
- CI: build before lint (typescript-eslint projectService needs
  `dist/index.d.ts` to resolve cross-package imports; fresh CI checkouts
  have no dist).

### Squash merge to main (commit f8a567f)

- `gh pr merge 28 --squash --delete-branch` with a structured `--body`
  grouping the 26 commits by category (Major / Codex review fixes /
  Quality). Branch `feat/bookmark-ledger` deleted both locally and
  remotely.
- Pulled `main` locally, pruned stale tracking refs, removed the codex
  review worktree at `/Users/ppatterson/Working/x-scraper-codex-review`.

### Backed-off ramp (steps 1, 2, 4, 8, 16, 32, 64, 128)

| Step | succeeded | failed/dead | duration | cost |
|------|-----------|-------------|----------|------|
| 1 oldest | 1 (t.co stub) | 0 | <1s | $0.00 |
| 1 newest | 1 (X Article smoke) | 0 | 135s | $0.116 |
| 2  | 2  | 0 | 24s   | $0.031 |
| 4  | 4  | 0 | 27s   | $0.042 |
| 8  | 8  | 0 | 30s   | $0.046 |
| 16 | 16 | 0 | 130s  | $0.192 |
| 32 | 32 | 0 | 413s  | $0.615 |
| 64 | 64 | 0 | ~10m  | $1.284 |
| 128 | 103 | 25 dead (t.co bug) | ~32m | $4.74 |

After step 128: all 200 organic synced + 31 derived synced + 154
derived pending + 25 dead.

### docs/web-ui/ planning set (commit 8e33c9e)

Six files at `docs/web-ui/`: README, ARCHITECTURE, AGENT_SDK,
GRAPH_VIS, COMPONENTS, ROADMAP. Stack: Next.js 15 (App Router, RSC +
Server Actions) + Tailwind 4 + shadcn/ui + Sigma.js v3 + Graphology +
Vercel AI SDK + `@anthropic-ai/claude-agent-sdk`. App lives at
`apps/web-ui`. Three research agents informed the docs (claude-code-guide
for the Agent SDK, two general-purpose for graph viz comparison and
Next.js patterns). 4-phase ROADMAP, ~5–7 days build.

## Key Decisions

- **Squash merge with structured body, not default.** PR #28 had 26
  commits; default squash glues their subjects with bullets. Used
  `gh pr merge --subject + --body` to write a real grouped message
  for archaeology purposes.
- **Vault default → `~/x-scraper-vault`, NOT `~/Documents/x-scraper-vault`.**
  iCloud Drive's "Desktop & Documents" sync was creating ghost
  directories during parallel mkdir + git ops.
- **Sigma.js + Graphology over Cytoscape, React Flow, vis-network.**
  Only library that holds 50k nodes at 60fps with a real React story.
  Graphology is the right data model regardless of renderer.
- **In-process MCP tools for the agent (via `createSdkMcpServer`),
  not REST or stdio.** Sub-millisecond per tool call vs 50–200ms for
  REST round-trips. `xs-rest` and `xs-mcp` stay around for IDE / CLI.
- **CI builds before lint.** typescript-eslint's projectService
  resolves cross-package types via dist; lint without dist false-
  positives `no-unsafe-*` rules. Reordered CI steps rather than adding
  postinstall (which would slow every dev install).
- **Extractor prompt v2 over editing v1 in place.** Existing rule:
  bump `EXTRACTION_PROMPT_VERSION` and add `extraction-vN.ts`; never
  edit a published version. v2 tightens type classification (Repo
  requires github URL etc.).
- **`apps/web-ui`, not `packages/web-ui`.** Convention: `packages/*`
  for libraries, `apps/*` for deployables. The existing
  `pnpm-workspace.yaml` already lists `apps/*`.

## What Failed

- **First smoke ingest produced bad data** because `dist/` was stale
  relative to `feat/bookmark-ledger`'s recent commits. The X Article
  ingest ran *old* code that wrote `sources/src_*.md` flat instead of
  `sources/articles/`, and missed the byline + body-structure fixes
  entirely. **Caught** by walking the produced files. **Fixed** by
  `pnpm build`, deleting the stale stub, resetting the ledger row,
  re-running step 1. Lesson: every session should start with a full
  build before the first smoke.
- **`topics 2/` ghost dir during the X Article smoke.** Empty
  directory created at exactly the moment vault.init ran a second
  time during the same smoke. **Traced** to `~/Documents` being a
  symlink into `~/Library/Mobile Documents/com~apple~CloudDocs/Documents`
  (iCloud Drive sync). **Fixed** by changing the default vault path
  AND adding a `vault-icloud` doctor check.
- **CI failed twice on the squash merge prep.** First on
  `pnpm format:check` (6 prettier-flagged files) + 3 eslint errors;
  fixed by `pnpm format` and manual edits. Second on
  `@typescript-eslint/no-unsafe-*` errors that didn't reproduce
  locally — root cause was projectService needing `dist/*.d.ts` that
  fresh CI didn't have. Fixed by reordering CI steps to build before
  lint.
- **Step 128 of the ramp had 25 dead rows** (~20% failure rate),
  ALL from a single bug: my Phase 6a `enqueueEntityLinkDerivedRows`
  doesn't filter t.co URLs the way `fetchLinksStage` does for body
  URLs. When the LLM emits a `t.co` URL in an entity alias, we
  enqueue it as a derived row → Readability null → permanent
  failure → dead. Fix is one line; queued for resume.

## Deferred / Backlog

- **Drain remaining 154 derived rows**, AFTER fixing the t.co guard.
  Doubling cadence (`--limit=2, 4, 8, 16, 32, 64, 128`) until
  `derived|new` = 0. Budget $5–15 (mix of articles, repos, videos).
- **Decide what to do with the 25 dead rows.** Either retry after
  the t.co fix lands (will still fail — t.co is not the canonical
  URL and Readability still won't get content), or leave them as
  archival markers of "the t.co target was unrecoverable". Pat's
  call.
- **Run `xs topic detect --synthesize`** against the populated
  graph (now 600+ entities, much richer cooccurrence — should
  produce real community-based topics for the first time).
- **Build apps/web-ui per `docs/web-ui/ROADMAP.md`** — task #9 in
  the task list. Phase 0 scaffold is half a day; full plan ~5–7
  days. Pat said "we'll build it this week at some point".
- **Codex review on main** (not branch — branch is gone). Recreate
  the worktree via `git worktree add`. Last review was on `e83c8bc`;
  main is now at `85ac4e7` with three additional fixup commits
  + the docs + handoff that codex hasn't seen.

## Traps for Next Session

- **Use `/opt/homebrew/bin/node`** for the CLI (matches the
  better-sqlite3 ABI; nvm `node` is wrong NODE_MODULE_VERSION).
- **Don't run a large `--limit` sync until the t.co guard is in.**
  Each unfiltered t.co URL = a guaranteed dead row. Fix first, then
  drain.
- **`schema_version` is at 4.** Any new migration uses v5+; v4
  already owns the `cost_ledger.entry_id` ALTER fold-in.
- **Vault git is at `~/x-scraper-vault/.git`** (NEW location). The
  old `~/Documents/x-scraper-vault/` was wiped in the reset and is
  no longer referenced anywhere.
- **`/tmp` snapshots from this session** are still around if you
  need recovery: `/tmp/x-scraper-vault-pre-reset` (session 5
  state), `/tmp/queue-pre-reset.sqlite`, `/tmp/neo4j-pre-reset/`,
  `/tmp/x-scraper-vault-post-smoke`,
  `/tmp/x-scraper-vault-post-phase6-prereset`.
- **CI is build → lint → typecheck → test → circular.** Don't
  reorder; lint will fail on cross-package imports otherwise.
- **`HANDOFF.md` is a SNAPSHOT, not a log.** This file was rewritten
  per the end-session skill — older mid-session iterations are in
  git history.

## Next Steps

1. **Fix the t.co guard.** In
   `packages/cli/src/commands/sync/stages.ts:enqueueEntityLinkDerivedRows`,
   add a hostname check alongside the existing `X_TWEET_URL_RE.test(canonical)`
   skip:
   ```ts
   if (X_TWEET_URL_RE.test(canonical)) continue;
   try {
     if (new URL(canonical).hostname === 't.co') continue;
   } catch { continue; }
   ```
   Run `pnpm typecheck && pnpm test packages/cli && pnpm build`.
   Expected: 332 tests still pass.

2. **Drain remaining derived rows.** With the t.co guard in:
   ```bash
   /opt/homebrew/bin/node packages/cli/dist/bin.js bookmarks sync --order=oldest --limit=128
   ```
   Then again at `--limit=128` if rows remain. Expected: most rows
   succeed (articles + repos + videos); failure rate near 0%.

3. **`xs topic detect --synthesize`.** Now that the graph is rich,
   Louvain should find real communities with Sonnet-titled topics.
   ```bash
   /opt/homebrew/bin/node packages/cli/dist/bin.js topic detect --synthesize
   ```
   Expected: 5–15 topics each with 5–30 member concepts.

4. **Codex review on main.**
   ```bash
   git worktree add /Users/ppatterson/Working/x-scraper-codex-review main
   cd /Users/ppatterson/Working/x-scraper-codex-review
   codex review --base main > /Users/ppatterson/Working/x-scraper/.repostat/codex-review/run-$(date +%Y%m%d-%H%M%S).log 2>&1 &
   ```
   Expected: a few P2s, mostly cosmetic since main just had two codex
   passes.

5. **Start `apps/web-ui` Phase 0.** See `docs/web-ui/ROADMAP.md` —
   half a day to scaffold. Open a new branch off main:
   ```bash
   git checkout -b feat/web-ui-scaffold
   pnpm dlx create-next-app@latest apps/web-ui --typescript --tailwind --app --src-dir --no-eslint
   ```
   Expected: `pnpm dev --filter @x-scraper/web-ui` boots on
   `localhost:3000` with shadcn primitives installed.
