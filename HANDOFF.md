# Session Handoff

> Updated 2026-04-26 at end of session 4. PR #28 (`feat/bookmark-ledger`) is OPEN and ready for codex review + merge. Next session's work is a focused quality-upgrade pass over the live system, ranked below.
>
> **Read this first.** Then check `xs status` and the bookmark_ledger to confirm nothing has drifted since this snapshot.

## Current State

Branch `feat/bookmark-ledger` pushed; **PR #28 OPEN, NOT YET MERGED**. 5 commits ahead of `main`:

```
0a054f7  docs(handoff): postscript — full backlog drained + topic detect live
8187364  docs(handoff): refresh after live ingestion + deferred backlog drain
dc27195  fix(bookmarks): order ledger by tweet_created_at, not pull captured_at
40044c8  feat: golden corpus, topic detect, schedule, soft auto-expand, parsing fix
cd49741  feat(bookmarks): durable backlog with xs bookmarks pull + sync
```

301 vitest tests across 45 files (3 perf-bench skipped without RUN_BENCH=1). lint clean, typecheck clean. `pnpm build` clean.

**Live data state at session end:**
- `bookmark_ledger`: 210 rows synced (200 bookmarks + 10 likes), 0 failed, 0 new
- vault: 200 Source.md, 1500+ Claim.md, 800+ Entity.md, 6 Topic.md
- Neo4j: 200 Source + 2400+ Claim + ~80 Concept nodes; 6500+ edges across 14 types; HNSW `claim_embed_idx` @ 1536 dims
- cost ledger: ~$5.04 spent end-to-end

## What Was Done This Session

- Added durable bookmark backlog: `bookmark_ledger` table (queue schema v2 + forward migration), `extractTweetPayload(record)` helper, `xs bookmarks pull` and `xs bookmarks sync` commands.
- Added 5 deferred-backlog items: `xs topic detect [--synthesize]`, `xs schedule install/uninstall` (launchd), soft auto-expand in `fetch_links` stage (logs discovered URLs), 3-fixture golden corpus + `RUN_GOLDEN_LIVE=1` mode, `.github/workflows/bench.yml` for `RUN_BENCH=1` weekly.
- Fixed `parseBookmarksPage` / `parseUserTimelinePage` so they preserve the original raw entry object (was returning Zod-stripped entries — caused 100% skip rate against real X.com payloads).
- Fixed `xs bookmarks pull` to NOT pass `headless: false` (was bypassing the headless cookie-reuse path and timing out for 300s).
- Live-verified end-to-end: 210/210 synced, 0 failures, ~$5.04, ~12s/bookmark amortized.
- `xs topic detect --synthesize` ran live and produced 6 thematic communities.
- Verified persistence across all 4 sinks: SQLite ledger, vault markdown, vault git history (174 commits, one per sync run), Neo4j nodes/edges/HNSW.

## Key Decisions

- **Pre-fetched body short-circuit re-used**: `xs bookmarks sync` builds a SourceItem with `body=tweet text` from the ledger, so `extract_text` becomes a no-op. No new "tweet ingestor" needed.
- **One queue run per bookmark**: each bookmark gets its own `runId`. Vault commits stay atomic per source. Trades a few hundred ms for clean audit logs.
- **Tweet-age ordering**: `--order=oldest` sorts by `COALESCE(tweet_created_at, captured_at)` so a Feb 2026 tweet pulled today sorts before an Apr 2026 tweet pulled today.
- **Soft auto-expand only for v1**: `fetch_links` logs discovered URLs but doesn't recurse. Hard auto-expand is item #4 in the upgrade list below.

## What Failed (and how it was fixed)

- **All 200 live bookmarks "skipped_unparseable" on first pull**: parseBookmarksPage was returning Zod-stripped entries (rest_id only). Fixed by changing `entries: z.array(z.unknown())` and validating per-entry inside the loop, pushing the ORIGINAL `rawEntry` into partials.
- **Auth timed out for 300s on first pull**: I'd passed `headless: false` to `runBookmarksPull`, killing the headless cookie-reuse path. Fix: omit the flag.
- **better-sqlite3 ABI drift**: this Mac has TWO Node binaries (24.13 nvm + 25.9 Homebrew). `pnpm exec node` uses 25; nvm shell `node` uses 24. Rebuild target must match the one vitest uses (25). Recipe in `feedback_better_sqlite3_abi_drift.md`.
- **Golden corpus directory didn't exist** despite prior HANDOFF saying it did. Created from scratch with 3 fixtures.

## Next Session — Quality Upgrade Pass (work all of these)

Pat reviewed the populated graph (top entities: Claude Code 39, Claude 16, OpenClaw 16, Codex 10; top concepts: AI Agents, MCP, Vibe Coding) and asked to address every observed weakness. Ranked by impact-per-effort.

### Tier 1 — fixes the data is begging for

1. **Entity normalization is broken.** Graph has both `AI Agents` (6) AND `AI Agent` (4) as separate Concepts; `MCP` (5) AND `Model Context Protocol` (4) split; `Anthropic` exists as both Tool and Person. Reconciler's vector-similarity ER is missing trivial alias collisions. **Fix:** pre-normalize entity names before resolution (lowercase, singularize via Inflector, strip articles); add `aliases[]` lookup *before* vector search. Estimate: collapses 20–30% of duplicate Concept/Person nodes.

2. **`null` predicate count is 1002.** Cypher `MATCH (c:Claim) RETURN c.predicate, count(*)` shows 1002 claims with null predicate (~40% of the corpus). Either the upsert isn't writing `predicate` to Neo4j, or the extractor emits empty strings stored as null. Invalidates any predicate-based query. **Fix:** investigate first (is it a data-write bug or a Cypher-projection bug?). Most likely 30 minutes to a fix once root cause is found.

3. **t.co-only bookmarks waste an LLM call.** ~25 bookmarks have body that's literally just `https://t.co/xyz`. Get 0 useful claims, still pay ~$0.014 in Sonnet+Gemini. **Fix:** in `runBookmarksSync` (or in the pre-flight stage), if body matches `^\s*https?://t\.co/\w+\s*$`, write a stub Source.md and skip extraction stages. Saves ~$0.40 per 200-bookmark run.

### Tier 2 — extensions of what works

4. **Hard auto-expand for embedded URLs.** Soft auto-expand logged 700+ URLs we didn't follow. Bookmarks DO link to substantive articles/repos/PDFs that the existing ingestors can handle. **Fix:** schema v3 adding `parent_entry_id` column; canonicalize-vs-vault-list dedupe in `fetch_links`; enqueue new ledger rows for unseen URLs; mark `source='derived'` so they're distinguishable from organic bookmarks.

5. **Topic detect is starved.** 82 Concepts but only 52 RELATED_TO edges. Communities are tiny because there aren't enough edges. Root cause: the extractor emits relationships between entities but rarely between Concepts. **Fix:** post-extraction step that infers Concept-Concept edges from co-occurrence — every pair of Concepts mentioned in the same Source gets a weak `RELATED_TO` (confidence proportional to inverse Source frequency). Estimate: 5-10x edge density, much richer topics.

6. **Concept embeddings, not just Claim embeddings.** Reconciler currently uses the *source* embedding as a proxy for every entity (because we only embed Claim text). That's why entity dedup is hit-or-miss. **Fix:** add a per-entity embed stage (or batch-embed all unique entity names per run); feed those to `resolveEntity`. The HNSW index already supports it via `ENTITY_VECTOR_INDEX_NAME` from constants.ts (slice 8 deferred this).

### Tier 3 — usability + introspection

7. **`xs trends` command.** What I hand-typed Cypher to surface (top entities, top concepts, top tools, topic clusters, predicate distribution) should be a CLI: 10 lines of Cypher + a printer. Cheap.

8. **Recency weighting in topic detection.** All 200 bookmarks weighted equally now. Add edge weights based on `min(tweet_created_at, captured_at)` recency so currently-hot clusters dominate over dormant ones.

9. **Author entity > byline string.** Currently `bookmark_ledger.author` is a flat string; we should write the tweet author as a Person node with `(:Source)-[:AUTHORED_BY]->(:Person {handle})`. Lets you ask "show me everything bookmarked from steipete."

10. **Soft delete for ledger upsert.** Currently if X edits a tweet we keep the stale text. Add `text_hash` column; on re-pull, if hash differs, mark the old row `superseded` and insert a new one. Audit-trail-friendly.

### Tier 4 — operational

11. **Cost ledger needs entry_id attribution.** Records `run_id` + `job_id` but no easy join back to the ledger's `entry_id`. Add `entry_id` to `cost_ledger` (or a JOIN view).

12. **Shard `vault/claims/` by id prefix.** 1500 flat files now, performance fine. At 10k it'll matter. Move to `claims/c_/c_651ef3b1.md` like git's loose-objects layout.

## Deferred / Backlog (not in the upgrade list)

- **Hardening of `xs schedule install`**: the plist gets written but live launchctl bootstrap was never end-to-end tested in this session.
- **Live `RUN_GOLDEN_LIVE=1` first run**: golden corpus runs in stub mode in CI; a one-time `RUN_GOLDEN_LIVE=1` execution to validate the 3 fixtures against real Sonnet was never done. Cost ~$0.05.
- **Likes/posts sync end-to-end**: 10 likes were pulled and synced this session, but we didn't verify the resulting Source.md content_type tagging is correct.
- **CI bench first scheduled run**: workflow file shipped, first run lands Sunday 06:00 UTC.

## Traps for Next Session

- **Always invoke production CLI via `/opt/homebrew/bin/node`**: matches vitest's runtime (Node 25.9) and the rebuilt better-sqlite3 binary. Plain `node` is nvm Node 24 — wrong binary.
- **PR #28 is OPEN, not merged.** Don't branch off main for next-session upgrades — branch off `feat/bookmark-ledger` (or wait for it to merge first). The bookmark_ledger schema v2 lives only on this branch until merge.
- **Schema v3 migration must respect the v1→v2 forward migration pattern.** Bootstrap SCHEMA_SQL gets the latest shape; MIGRATIONS map handles upgrade-from-prior-version. Don't break the existing v1→v2 path.
- **Reconciler `findClaimsForSubject` is a stub** that returns empty. Most of the upgrade work in #1 will need a real implementation — currently every claim is treated as ADD because nothing is found.
- **Entity ID generation uses `entityId(type, name)`** which lowercases + slugifies but does NOT singularize or strip articles. Don't change this without auditing every caller; it's the natural key for the graph.
- **Bookmark ledger's `text` column may contain a single t.co URL** for video/media bookmarks. Filter before extraction (item #3) to avoid wasted spend.
- **All prior-session traps still apply**: max_tokens 16k–32k for extraction; cost recorded BEFORE throw path; bi-temporal upsert; reserved-fields-beat-caller; auth fails closed; HNSW dim drift refused at init; Neo4j vector index keyed on (label, property); pdfjs needs Buffer→Uint8Array copy.

## Next Steps — exactly where to pick up

1. **Decide PR #28 status**: get codex review (`codex review --base main`), address P1/P2 findings, merge to main. Then start the upgrade branch off the freshly-merged main.
2. **Investigate trap #2 first** (null-predicate bug). It's the only upgrade that's actively corrupting current data. 30 min likely. Run `cat ~/Documents/x-scraper-vault/claims/$(ls ~/Documents/x-scraper-vault/claims | head -1) | head -25` to see if `predicate:` is populated in vault frontmatter — if yes, the bug is in the graph upsert; if no, it's in the extractor's output handling.
3. **Then work upgrades #1, #3, #5, #6 in order** (entity normalization, t.co skip, concept co-occurrence edges, concept embeddings) — these compound. After each, re-run the live trends query and confirm the data is cleaner.
4. **Items #4, #7-#12** can be done in parallel branches once the foundation is fixed.
5. **End-of-cycle**: re-run `xs topic detect --synthesize` against the cleaned graph and compare topic quality vs. the 6 communities from this session.

## Open file paths to remember

- `packages/cli/src/commands/bookmarks.ts` — pull + sync (entry point for upgrade #3, #9, #10)
- `packages/scraper/src/payload.ts` — `extractTweetPayload` (entry point for #9)
- `packages/queue/src/schema.ts` — schema v2 + MIGRATIONS map (entry point for v3)
- `packages/queue/src/queue.ts` — bookmark_ledger CRUD (entry point for #4, #10, #11)
- `packages/reconciler/src/` — ER logic (entry point for #1)
- `packages/cli/src/commands/sync/stages.ts` — `fetchLinksStage` + extract_facts (entry point for #4, #5, #6)
- `packages/cli/src/commands/topic.ts` — Louvain wrapper (entry point for #5, #8)
- `packages/extractor/src/__tests__/golden/` — 3 fixtures + stub-or-live test
- `~/Documents/x-scraper-vault/` — git-tracked, has 200 live-synced sources from this session
- `~/.config/x-scraper/queue.sqlite` — bookmark_ledger lives here alongside jobs/runs/cost_ledger
- `spikes/inspect-bookmark.ts` — dump real bookmark raw payload for debugging schema drift
