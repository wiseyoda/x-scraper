# Session Handoff

> Updated 2026-04-26 at end of session 5. Branch `feat/bookmark-ledger` is pushed
> with 8 new commits (T8/T9/T10/T11/T12/T13/T16/T18/T19/T20/T21/T22/T23 + X
> Article ingestor + content_type routing). PR #28 still OPEN, NOT MERGED.
>
> **Next session is a RESET.** Pat reviewed the synced output and saw too many
> small/wrong source files. The plan: nuke vault + db, rebuild from scratch
> with a doubling-batch (1→2→4→8…) cadence and manual verification at each
> ramp. Plus build a lightweight web UI for ongoing review.
>
> **Read this first.**

## Current State

Branch `feat/bookmark-ledger` pushed with 8 commits past session 4's snapshot:

```
f1b808f  feat: X Article ingestor + 3 correctness bugs + Source content_type routing
257ce32  feat: T16/T18/T19/T20/T21/T22/T23 — coooccurrence, trends, recency, authors, edit-detect, cost-by-entry, claims-shard-warn
f30b4b2  feat(reconciler): per-entity embeddings + Entity meta-label HNSW index (T11)
e398aef  feat: schema v3, hard auto-expand, entity normalization + codex v2 P2 fixes
cd7776d  fix: codex P2/P3 — bookmark wire-failure handling, plist exec path, sync mode + topic dry-run + spike3 hardening + t.co skip
d1906da  style: prettier --write across cli/extractor/graph/queue/scraper
```

316 vitests pass; lint + typecheck clean; codex P2 round 1 + round 2 fixes
landed.

**Live data state at end of session 5 (likely to be wiped — see Next Steps):**
- bookmark_ledger: 210 organic synced + 134 derived new (drain killed mid-flight)
- vault: 211 Source.md (210 tweets + 1 pdf), 1682 Claim.md, ~800 entity files
- Neo4j: 214 Source, 1644 Claim, 492 Concept, 299 Tool, 209 Tweet, 204 Person,
  62 Article, 35 Repo, 6 Video; ~6500 edges incl. 1122 RELATED_TO from cooccurrence
- cost ledger: ~$5.34 spent end-to-end (session 4 + session 5 trials)

## What Was Done This Session

### Foundation upgrades (12 of HANDOFF v4's 12 ranked items)

- **T8** — Neo4j test-pollution prevention. Found 1000 orphan `claim-{i}` nodes
  in production (HANDOFF v4 had mistaken these for a "null-predicate bug").
  Origin: spike 3 (`MATCH (n) DETACH DELETE n` + insert `claim-{i}` + no
  cleanup). Hardened spike 3: refuse-if-populated guard, `xs_spike3_` ID prefix,
  cleanup in finally. Added Neo4j-test-pollution-prevention rule to CLAUDE.md.
- **T9** — t.co-only tweet pre-flight skip. New `TCO_ONLY_TWEET_RE` in scraper
  constants; runBookmarksSync detects link-only tweets, writes a stub Source.md
  with `host_metadata.skipReason='link_only_tweet'`, marks ledger as synced
  without LLM cost. Codex round 2 follow-up: also enqueues derived ledger rows
  from the parent's expanded urls so the actual article isn't lost.
- **T10** — Entity normalization. `packages/reconciler/src/normalize.ts`:
  `normalizeEntityName` (NFKC, lowercase, article-strip, heuristic
  singularization). `resolveEntity` gains a phase-0 pre-flight pass on
  normalized_name + normalized_aliases via the new
  `GraphStore.findEntityByNormalizedSurface`. Real `findClaimsForSubject` wired
  (replaces empty stub that made every claim land as ADD). 794 historical
  entities backfilled with normalized fields via spike.
- **T11** — Per-entity embeddings + Entity meta-label. New `Entity` multi-label
  on every Person/Tool/Concept/Repo/Article/Tweet/Video/PDF node. Single
  `entity_embed_idx` HNSW (1536 dims, dim-drift guarded). New `embed_entities`
  stage between extract_facts and resolve_ents. resolveEntsStage now uses
  per-entity embeddings instead of source-vector proxy. 702 historical entities
  backfilled with embeddings.
- **T12** — Schema v3: bookmark_ledger gets `parent_entry_id`, `source_kind`
  ('organic'|'derived'), `text_hash`, `superseded_at`. Forward migration v2→v3
  + v3→v4 (the cost_ledger.entry_id ALTER, see T22). `runMigration` helper
  parses SQL line comments + skips ALTER ADD COLUMN when the column already
  exists (so test-time downgrades-then-rewalks survive).
- **T13** — Hard auto-expand. `fetchLinksStage` rewrote: extracts URLs from
  source body, dedupes via `findBookmarkBySourceUrl`, drops same-host
  self-references and tweet permalinks, enqueues derived ledger rows with
  `parent_entry_id` lineage. Idempotent (deterministic `derived_<source-id>`).
- **T16** — Concept co-occurrence edges. Every pair of Concepts in the same
  source gets a `RELATED_TO` edge with additive `cooccurrence_count` + sources
  list. New `GraphStore.upsertCooccurrenceEdge` port. Backfill against the
  historical 200 sources bumped edge density 52→1122 (21x; HANDOFF v4
  estimated 5–10x).
- **T18** — `xs trends` CLI. Top-N entities/concepts/tools/authors,
  predicate distribution, content_type mix, edge type counts, monthly cadence.
  ASCII tables (default) or `--format=json`.
- **T19** — Recency weighting in topic detect.
  `--recency-half-life-days=N` (default 0). Each edge weighted by
  `cooccurrence_count * 2^(-age_days / N)`. Wired through
  `ConceptEdgeRecord` (added `cooccurrenceCount`, `lastObservedAt`).
- **T20** — Author Person entity. updateGraphStage materializes
  `host_metadata.byline` as a Person + `(s)-[:AUTHORED_BY]->(p)` edge.
- **T21** — Soft-delete on edit via text_hash. runBookmarksPull computes hash,
  detects edit on re-pull, marks old row superseded + inserts a derived row
  preserving the audit trail.
- **T22** — Cost ledger entry_id attribution. `cost_ledger.entry_id`,
  CostInput/LlmCostSink/CostSink/CompleteRequest.cost all grow entryId.
  wireSyncDeps populates wireTimeEntryId for single-source bookmark syncs.
  New `JobQueue.costByEntry` + `xs cost --by-entry --top=N`.
- **T23** — Claims sharding deferral. Vault warns once per process when
  claims/ exceeds 8000 flat files.

### X Article ingestor (the late-session unplanned work)

- Found via the user inspecting trial drain failures: x.com/i/article/<id> URLs
  rendered as a React SPA whose content arrives via a follow-up GraphQL call.
  Readability was getting an empty shell and returning null. ~96 long-form X
  posts were being silently lost.
- `packages/ingestor/src/x-article.ts`: Patchright-rendered scrape using the
  existing authenticated browser session. Lazy-opened, cached across the run,
  disposed via the new `Ingestor.dispose` port wired into wireSyncDeps cleanup.
- Selectors verified via `spikes/probe-x-article.ts`:
  `[data-testid="twitterArticleReadView"]` (body wrapper),
  `[data-testid="twitter-article-title"]`,
  `[data-testid="twitterArticleRichTextView"]` (body content),
  `[data-testid="UserCell"]` (byline).
- Trial: 13KB rendered text per article, ~$0.11 extraction cost, ~150s wall
  time per item (60s of which is Patchright session cold-start — see Traps).

### Three correctness bugs caught by user output inspection

- `canonicalizeUrl` left http vs https as distinct → two synced Source.md for
  the same X Article with identical content_hash. Now normalizes http→https.
- `inferContentType` matched tweet host check before article path check, so
  `x.com/i/article/<id>` was tagged `content_type: 'tweet'` and routed to
  sources/tweets/. Article path check now runs first.
- X Article byline regex was greedy: `@Voxyz_aiFollowC` (UserCell text
  concatenates handle + adjacent button label). Now anchored with negative
  lookahead `(?![A-Za-z0-9_])`.

### Source.md content_type routing (also user-driven)

- Pat noticed Source.md files landing flat in `sources/` instead of next to
  their entity-stub neighbours in `sources/articles/`, `sources/tweets/`, etc.
- `dirForEntityType(type, contentType?)` now routes Source by content_type.
- `vault.read` and `vault.list` probe all subfolders for backward compat.
- `spikes/migrate-source-folders.ts` moved 214 historical Source.md files
  into the right subfolder; the move was committed to the vault git history.

### Codex review fixes

- Round 1 (3 × P2 + 1 × P3): bookmarks wire-failure handling, plist exec
  path, sync mode without URLs, topic dry-run mutation.
- Round 2 (3 × P2): t.co skip preserves expanded URLs, topic synthesis cost
  ledger sink, spike 3 cleanup destructive-after-refusal hazard.
- All landed.

## Key Decisions

- **PR #28 scope expanded mid-session.** Original branch was just bookmark
  backlog. We added 12 quality upgrades + the X Article ingestor + content_type
  routing on top. The PR is now ~3000 LOC. Pat agreed via "do it all" and
  "build it" guidance. Next session must decide: ship as one mega-PR vs split.
- **Pre-resolve t.co at backfill time, not inside ingest.** Saves the article
  ingestor from following redirects per attempt; lets dedupe key on the real
  destination URL; lets us skip x.com tweet permalinks at backfill rather than
  failing them at extract_text.
- **X Article ingestor uses dependency injection for the Patchright session**
  (the ingestor package can't depend on @x-scraper/scraper without a cycle).
  The wire layer constructs the session-opener lambda; the ingestor lazily
  resolves it on first match and caches.
- **Don't trust queue success status.** The trial drain reported succeeded=2
  but the user found 3 correctness bugs in the produced files. Future
  ingestion ramps must include manual file inspection at each step. Captured
  in `feedback_verify_parser_output.md`.

## What Failed

- **First trial of 5 derived bookmarks took 5+ minutes per item** because
  permanent failures (Readability null on t.co → x.com SPA) were retrying
  with 90s backoff. Fixed by adding `PERMANENT_ERROR_CODES` set in queue's
  failStage — PARSE/DIM_MISMATCH/INVALID_INPUT/etc. short-circuit straight
  to dead, no retries. Now permanent failures cost ~3s instead of 90s.
- **Trial drain claimed success but produced bad data.** Two duplicates
  (http vs https), wrong content_type ('tweet' for an article), garbled
  byline (regex over-capture). Caught by Pat opening the produced
  Source.md files. Three commits to fix.
- **The full 134-item drain was started in background and killed at user's
  request** before completing — only 2 had succeeded (which were the
  duplicate ones I'd already cleaned up earlier). 134 derived rows remain
  in 'new' status. Per user direction, the next session resets vault+db
  rather than resuming this drain.
- **Per-bookmark wireSyncDeps re-creates the Patchright session.** Each
  derived URL pays ~60s of browser cold-start. The cached-session inside
  the ingestor doesn't help because `wireSyncDeps` is re-called per
  bookmark by `runOnePerLedgerItem`. Real fix is to hoist the session
  out of per-bookmark wire — deferred.
- **Topic detection re-run never happened (T17).** The cooccurrence
  backfill bumped edges 21x but we didn't re-run `xs topic detect
  --synthesize` to compare community quality. Deferred.
- **`xs trends` "Top authors" section is empty.** The Cypher uses
  `s.host_metadata.byline IS NOT NULL` but the property is stored as a
  nested map; Cypher dotted access into a JSON map needs different syntax.
  Bug, deferred.

## Deferred / Backlog

### Immediate next-session priorities (per Pat)

1. **Nuke vault + db, ramped re-ingest with manual verification.** Wipe
   `~/Documents/x-scraper-vault/`, drop everything in Neo4j, delete
   `~/.config/x-scraper/queue.sqlite`. Re-pull bookmarks. Then sync 1 →
   verify the produced files manually → fix → 2 → verify → 4 → 8 → 16 →
   batch. At any step that fails, stop, fix, reset that batch's state.
2. **Lightweight web UI** for review. Read-only on top of xs-rest. List
   recent Source.md with body length / content_type / claim count / dup
   status. Click-through to claims, entities, graph neighborhood. Show
   topic communities with concept member names. Belongs as a parallel
   track to the ramped re-ingest.
3. **Address the systemic source-quality issues** observed by Pat:
   - Sources with no body content, just front-matter (articles, videos
     especially). Need to investigate why these end up in vault — may be
     a stub being written even when extraction returned nothing useful.
   - **Duplicate claim detection.** Reconciler's findClaimsForSubject
     now finds candidates but a duplicate-content-hash check at the
     Claim level isn't there. Two Source.md with the same body would
     extract the same claims; the system should detect content_hash
     collision at ingest time and skip the duplicate Source entirely.
   - All graph-side data (entities, claims, topics) needs UI-level review
     because the md vault is only half the picture.

### Lower-priority deferred from session 5

- T14 drain (134 derived rows) — superseded by the reset plan above.
- T15 "reconcile Article entity stubs" — superseded by reset.
- T17 "re-run topic detect + compare quality" — defer until reset
  re-ingest produces the new corpus.
- T24 launchctl bootstrap end-to-end test — not started.
- T25 RUN_GOLDEN_LIVE=1 — not started.
- T26 likes/posts content_type spot-check — partially obsolete (we now
  know content_type was being mis-set for X Articles; same kind of bug
  may exist for other URL patterns).
- T27 final codex review + ship — pending the reset cycle landing first.

### Pre-existing T0 deferred (still applies after reset)

- xs schedule launchctl bootstrap was never end-to-end tested live.
- Hard auto-expand of t.co URLs that resolve to NON-x.com / NON-twitter.com
  destinations works; but the `articles_rest_api_enabled` X feature flag
  surface (in INITIAL_STATE we saw) suggests there's an X.com REST API for
  Articles that would be faster than Patchright — not investigated.

## Traps for Next Session

- **The full vault + db wipe is a one-way action.** Before nuking, take a
  snapshot: `cp -r ~/Documents/x-scraper-vault /tmp/x-scraper-vault-pre-reset`,
  `cp ~/.config/x-scraper/queue.sqlite /tmp/queue-pre-reset.sqlite`,
  `neo4j stop && cp -r /opt/homebrew/var/neo4j/data /tmp/neo4j-pre-reset && neo4j start`
  (or use `cypher-shell ... "CALL apoc.export.cypher.all('/tmp/neo4j.cypher', {format:'cypher-shell'})"`
  if APOC is installed — it isn't by default). The session 5 work all sits in
  vault git so a `git log` recovery is possible too.
- **schema_version is at 4 in production.** Any migration the next session
  adds must use v5+. Don't reuse v4 — it owns the cost_ledger.entry_id ALTER
  fold-in fix.
- **Patchright session cold-start is 60s per ingest.** Until the wire-layer
  refactor lifts the session out of per-bookmark scope, expect ~150s/item
  for X Articles. For the ramped re-ingest with verification this is fine
  (verification time dominates). For batch runs >50 items, fix the wire
  first.
- **`xs trends` "Top authors" Cypher is broken** — the byline lookup
  doesn't work against the nested host_metadata map. Don't trust that
  section's output.
- **Codex review pending.** The branch has had 8 new commits since the
  last codex pass. Run `codex review --base main` again before merge.
- **The `findClaimsForSubject` GraphStore method now hits real Neo4j** —
  it was a stub returning `[]` before T10. This means the reconciler now
  actually finds existing claims and may return UPDATE/DELETE decisions
  where it used to return ADD. On the reset re-ingest, expect different
  claim counts than session 4's run.
- **All prior-session traps still apply**: max_tokens 16k–32k, cost
  recorded BEFORE throw path, bi-temporal upsert, reserved-fields-beat-
  caller, auth fails closed, HNSW dim-drift refused at init, Neo4j vector
  index keyed on (label, property), pdfjs Buffer→Uint8Array copy,
  `/opt/homebrew/bin/node` for CLI invocation.

## Next Steps — exactly where to pick up

1. **Snapshot the current state** before wiping. Run the cp commands in the
   Traps section. Confirm with `ls /tmp/x-scraper-vault-pre-reset/sources |
   wc -l`.
2. **Wipe**: `rm -rf ~/Documents/x-scraper-vault`,
   `rm ~/.config/x-scraper/queue.sqlite ~/.config/x-scraper/queue.sqlite-{shm,wal}`,
   `cypher-shell -u neo4j -p 'xscraper-local-dev' -d neo4j "MATCH (n) DETACH DELETE n"`,
   `cypher-shell ... "DROP INDEX claim_embed_idx IF EXISTS"`,
   `cypher-shell ... "DROP INDEX entity_embed_idx IF EXISTS"`. Drop all
   constraints too.
3. **Re-init**: `/opt/homebrew/bin/node packages/cli/dist/bin.js init`. Verify
   with `xs status` (should show 0 jobs).
4. **Re-pull bookmarks**: `xs auth login` (if cookies expired),
   `xs bookmarks pull --max=200`. Verify ledger has 200 organic rows.
5. **Ramped re-ingest with verification**:
   - `xs bookmarks sync --limit=1`. Open the produced Source.md, Claim.md,
     entity files. Run `xs trends`. Manually verify body length, content_type,
     byline, dedup, claim quality. Report findings to Pat.
   - If OK: `xs bookmarks sync --limit=2`. Verify both new ones.
   - Continue: 4, 8, 16, 32, 64, 128, 200.
   - At ANY failure: stop, fix the bug, reset that batch (delete the
     newly-created vault/graph/ledger entries), restart at size 1.
6. **In parallel**, sketch the lightweight web UI. Start as a new
   `packages/web-ui` workspace. Read-only routes built on the existing
   xs-rest patterns. List sources with quality dimensions. Click-through
   to claims/entities/graph neighborhood. Use the simplest possible
   server-rendered HTML or vanilla TS — minimal deps.
7. **Re-run codex review** on the branch before any merge attempt:
   `codex review --base main` in the worktree at
   `/Users/ppatterson/Working/x-scraper-codex-review`.

## Open file paths to remember

- `packages/ingestor/src/x-article.ts` — the new Patchright SPA scraper
- `packages/cli/src/commands/sync/wire.ts` — Patchright session wiring +
  the per-bookmark cold-start hot spot
- `packages/cli/src/commands/sync/stages.ts` — fetchLinksStage (hard
  auto-expand), inferContentType (article-before-tweet check), updateGraph
  (cooccurrence + AUTHORED_BY)
- `packages/core/src/url.ts` — canonicalizeUrl (now normalizes http→https)
- `packages/vault/src/paths.ts` + `vault.ts` — content_type routing
- `packages/queue/src/queue.ts` — runMigration, PERMANENT_ERROR_CODES,
  costByEntry, findBookmarkBySourceUrl, markBookmarkSuperseded
- `packages/queue/src/schema.ts` — schema_version=4, MIGRATIONS[3], [4]
- `packages/reconciler/src/normalize.ts` — entity name normalization
- `packages/graph/src/neo4j-store.ts` — entity_embed_idx, vectorSearch
  routing, upsertCooccurrenceEdge, findEntityByNormalizedSurface,
  findClaimsForSubject
- `packages/graph/src/cypher.ts` — Entity meta-label upsert,
  buildUpsertCooccurrenceEdge
- `spikes/backfill-*.ts` — 4 backfill spikes (normalized-names,
  entity-embeddings, cooccurrence, derived-urls)
- `spikes/migrate-source-folders.ts` — moved 214 sources into subfolders
- `spikes/probe-x-article.ts` — used to find the X Article DOM selectors
- `spikes/3-neo4j.ts` — hardened with refuse-if-populated + cleanup
- `~/Documents/x-scraper-vault/` — git-tracked; 211 sources, 1682 claims
  (about to be wiped per the reset plan)
- `~/.config/x-scraper/queue.sqlite` — schema v4; 210 organic + 134 derived
  ledger rows (also about to be wiped)
