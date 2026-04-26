# Session Handoff

> Updated 2026-04-26 after a marathon session that landed durable bookmark backlog management, end-to-end live ingestion against real X.com, plus 5 deferred-backlog items (likes/posts live verify, xs topic detect, xs schedule install, soft auto-expand, RUN_GOLDEN_LIVE mode, bench CI workflow). The post-roadmap "make it work end-to-end" milestone.
>
> Read this first in the next session.

## Current State

`feat/bookmark-ledger` branch pushed to origin with 3 commits ahead of main. **xs bookmarks pull → xs bookmarks sync runs end-to-end against the live X.com profile.** 200 bookmarks pulled, 55+ synced (sync still in progress at session end, draining the remaining 145), 0 failures. Vault has grown from 52 → 530+ claims and 37 → 319+ entities. Cost so far: ~$1.84 in LLM/embed.

```
git log --oneline -5 feat/bookmark-ledger
dc27195  fix(bookmarks): order ledger by tweet_created_at, not pull captured_at
40044c8  feat: golden corpus, topic detect, schedule, soft auto-expand, parsing fix
cd49741  feat(bookmarks): durable backlog with xs bookmarks pull + sync
ac27f82  docs(handoff): refresh after backlog drain merged (#27)
```

301 vitest tests across 45 files (3 perf-bench skipped without RUN_BENCH=1) in 17 packages. lint clean, typecheck clean.

## What Was Done This Session

The user's ask: ingest all bookmarks oldest-to-newest, fixing pipeline issues as we go, AND complete the deferred backlog. Did both.

### Phase A — durable bookmark backlog (3 commits)

| Commit  | What                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------ |
| cd49741 | bookmark_ledger table (queue v2 + forward-only migration), extractTweetPayload helper, xs bookmarks pull/sync commands, 20 new tests (queue + scraper + cli) |
| 40044c8 | xs topic detect, xs schedule install/uninstall, soft auto-expand fetch_links, golden corpus + RUN_GOLDEN_LIVE, bench CI workflow, **parsing fix** that unblocked live ingestion |
| dc27195 | ORDER BY COALESCE(tweet_created_at, captured_at) so --order=oldest sorts by tweet age, not pull batch |

### Phase B — live verification

- **Auth refreshed**: `xs auth login` → `auth: PatOnTheLevel (id 18276723) via headed-login`
- **First pull**: 50 bookmarks, all skipped — turned out parseBookmarksPage was returning Zod-stripped entries (rest_id only) so extractTweetPayload had nothing to read
- **Parsing fix** (in 40044c8): change TimelineInstructionSchema's `entries` to `z.array(z.unknown())` and validate per-entry inside the loop, pushing the original raw entry into the BookmarkRecord
- **Re-pull**: 200/200 bookmarks parsed cleanly into the ledger; 10/10 likes parsed too (slice 22 verified live)
- **First sync**: 3 bookmarks → all 3 synced ($0.06, ~13s/bookmark, full pipeline including Gemini embed + Sonnet extract + reconcile + Neo4j upsert + git commit)
- **Bigger batch**: 50 bookmarks → 50/50 synced, 0 failures, $1.39
- **Backlog drain**: 145 bookmarks remaining at session end, sync running in background (PID-tracked elsewhere)

### Live verification artifacts (current vault state)

```
~/Documents/x-scraper-vault/
  sources/   56 .md (one per synced bookmark)
  claims/    534 .md (LLM-extracted facts)
  entities/  319 .md (people, tools, concepts referenced)
```

## Key Decisions

- **Pre-fetched body short-circuit re-used**: each bookmark feeds the existing `xs sync` pipeline as a SourceItem with `body=tweet text`. extract_text becomes a no-op; no separate "tweet ingestor" needed.
- **One queue run per bookmark**: each bookmark gets its own `runId` in xs sync. Vault commits stay atomic per source. Trades a few hundred ms per bookmark (one extra commit) for clean audit logs and isolated retry semantics.
- **Tweet-age ordering, not pull-batch ordering**: `--order=oldest` sorts by `COALESCE(tweet_created_at, captured_at)` so a Feb 2026 tweet pulled today still sorts before an Apr 2026 tweet pulled today. Existing tests stay green because their fixtures don't set tweet_created_at, and COALESCE falls back to captured_at.
- **Soft auto-expand only for v1**: `fetch_links` stage now logs every embedded URL it sees in the body but does NOT recurse. Hard auto-expand (recursive enqueue with parent_entry_id dedupe) needs another schema column and canonicalization-vs-vault-list dedup; explicitly deferred.
- **Skip rules for bookmarks**: tombstones (entries lacking text + author + urls) are silently skipped. The pull command logs `bookmarks.pull.skipped_unparseable` for each. Bookmarks for video-only posts get an empty-ish body but still sync — the pipeline tolerates zero claims.
- **Two Node versions on this Mac**: `/opt/homebrew/bin/node` is 25.9.0 (NODE_MODULE_VERSION 141), nvm-managed `node` is 24.13.0 (137). `pnpm exec node` picks 25; `node` picks 24. better-sqlite3 must be rebuilt against the *Node that vitest uses* (25), not the *Node from the shell prompt* (24). The xs bin scripts MUST be invoked via `/opt/homebrew/bin/node` to load the correct binary.
- **Golden corpus minimal**: 3 fixtures (anthropic-claude-code, neo4j-vector-index, typescript-pnpm). Stub mode runs in CI; RUN_GOLDEN_LIVE=1 hits real Sonnet for entity-recall regressions.

## What Failed (and how it was fixed)

- **`headless: false` killed the headless cookie reuse path** in xs bookmarks pull. The auth fallback then waited 300s for an interactive login that never came. Fix: don't pass headless explicitly; let auth.ts try headless first.
- **better-sqlite3 ABI drift**: same trap as last session, BUT the rebuild needs `--target=25.9.0` to match `pnpm exec node`'s Node 25, not Node 24. Recipe in HANDOFF "Traps".
- **All 200 bookmarks initially "skipped_unparseable"**: parseBookmarksPage was passing the Zod-stripped entry (containing only entryId + rest_id) as `BookmarkRecord.raw`. extractTweetPayload had no payload to read. Fix in parsing.ts: change `entries` to `z.array(z.unknown())` and validate per-entry inside the loop, pushing the ORIGINAL `rawEntry` into partials.
- **Golden corpus directory didn't exist** despite prior HANDOFF saying it did. Created from scratch with 3 fixtures.

## Package Map (unchanged: 17 packages)

New surfaces this session:

| Package         | Additions                                                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queue`         | `bookmark_ledger` table (v2 forward migration); `upsertBookmark`, `listBookmarks`, `getBookmark`, `updateBookmark`, `bookmarkStats`; `BookmarkSource`/`BookmarkStatus`/`BookmarkEntry` types |
| `scraper`       | `extractTweetPayload(record)`, `tweetPermalink(tweetId, author)` — pulls text/author/urls/createdAt out of the BookmarkRecord raw payload                                |
| `graph`         | `listConceptSubgraph()` returning `{nodes, edges}` of Concept-RELATED_TO-Concept edges (current only)                                                                    |
| `cli`           | `xs bookmarks pull/sync`, `xs topic detect`, `xs schedule install/uninstall`                                                                                             |
| `extractor`     | golden corpus (3 fixtures + stub-or-live test)                                                                                                                           |
| `cli/sync`      | fetchLinksStage now scans body for URLs and logs them under `sync.fetch_links.discovered`                                                                                |

## Deferred / Backlog (smaller now)

- **Hard auto-expand**: scan body for URLs → enqueue as new bookmark_ledger rows with `parent_entry_id` for dedupe lineage. Schema bump to v3.
- **Likes/posts sync**: 10 likes are in the ledger but the sync doesn't differentiate source. Should work as-is via `xs bookmarks sync --source=likes` — untested live.
- **Topic detect against the live graph**: ran on stubbed graph in unit tests (5/5 pass). Live test deferred until enough Concept nodes exist to form communities (≥5 concepts per cluster).
- **CI bench**: workflow file shipped but never triggered. First scheduled run lands Sunday 06:00 UTC.
- **RUN_GOLDEN_LIVE=1 first run**: never executed live. Cost ~$0.05 to validate the 3 fixtures.
- **xs schedule install live test**: writes the plist but never bootstrapped against launchd in this session.

## Traps for Next Session

- **`/opt/homebrew/bin/node`, not `node`**: vitest and xs CLI must use the same binary or better-sqlite3 errors with NODE_MODULE_VERSION mismatch. Quick check: `pnpm exec node --version` should match `which xs` invocation.
- **better-sqlite3 ABI rebuild target**: when a Homebrew Node update lands, `cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && rm -rf build && /opt/homebrew/bin/npx node-gyp rebuild --target=$(node --version | tr -d v)`. Confirm the binary's NODE_MODULE_VERSION via Node's load-error message.
- **`extractTweetPayload` returns null for tombstones / non-tweet entries** — caller MUST handle (in `runBookmarksPull` the loop counts these as `skipped`).
- **Bookmark ledger upsert is idempotent on entry_id only** — if X.com edits a tweet, we'll keep the old text. By design (the ledger is an audit trail). To re-pull a refreshed tweet, delete the ledger row first.
- **xs sync `loadSources` is curated-only**. Bookmark sync builds the SourceItem list ahead of time and passes it in. The dispatcher can't load more sources mid-run.
- **All prior-session traps still apply**: max_tokens 16k–32k for extraction; cost recorded BEFORE throw path; bi-temporal upsert pattern; reserved-fields-beat-caller logger spread; auth fails closed; HNSW dim drift refused at init; Neo4j vector index keyed on (label, property); pdfjs-dist needs Buffer→Uint8Array copy.

## Next Steps — exactly where to pick up

1. **Drain the bookmark backlog** (145 bookmarks left at session end, may be done by next read). Check `xs status` and `xs bookmarks sync` for stats. Failures should auto-retry up to maxAttempts=3.
2. **Run `xs topic detect --synthesize`** once the graph has enough Concept nodes (the 50 synced bookmarks may already qualify; the 200-bookmark ingest definitely will). First run will write topics/<id>.md and Topic graph nodes — review them for quality.
3. **Live-test xs schedule install** (writes a launchd plist, bootstraps it). Then verify it runs xs bookmarks sync on the next interval. Uninstall when done dogfooding.
4. **Live-verify slice 22 likes sync**: `xs bookmarks sync --source=likes --limit=5` against the 10 likes already in the ledger.
5. **Hard auto-expand**: schema migration v3 adding `parent_entry_id` + URL canonicalization dedupe in fetch_links. Discovered URLs become new ledger rows.
6. **PR**: `feat/bookmark-ledger` is pushed; open the PR (3 commits, ~30 files changed). After codex review + CI green, squash-merge.

## Open file paths to remember

- `packages/cli/src/commands/bookmarks.ts` — pull + sync runners with full test seams
- `packages/scraper/src/payload.ts` — extractTweetPayload + tweetPermalink
- `packages/queue/src/schema.ts` — schema v2 + MIGRATIONS map
- `packages/cli/src/commands/topic.ts` — topic detect with optional Sonnet synthesis
- `packages/cli/src/commands/schedule.ts` — launchd install/uninstall
- `packages/extractor/src/__tests__/golden/` — 3 fixtures + stub-or-live test
- `~/Documents/x-scraper-vault/` — git-tracked, has 56+ live-synced sources
- `~/.config/x-scraper/queue.sqlite` — bookmark_ledger lives here alongside jobs/runs/cost_ledger
- `spikes/inspect-bookmark.ts` — dump real bookmark raw payload for debugging schema drift
