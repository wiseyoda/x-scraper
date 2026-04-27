# Session Handoff

> Updated 2026-04-27 at end of session 8. Pipeline reshaped from
> monolithic ingest into a value-loop architecture: capture/refine
> split, L0→L1 synthesizer, Next.js review UI. Live corpus rebuilt
> at v3 prompt scale (304 sources, 16 draft Ideas). 352 tests pass.
> 6 commits on main.
>
> **Read this first.**

## Current State

- **Branch:** `main`, head `c31943d` (clean).
- **Commits since session 7:**
  - `1ebb999` Slice 1: capture + xs refine
  - `83f7603` fix: refine no longer overwrites repo/article captures
  - `021f5d4` Slice 3: synthesizer + xs ideas CLI
  - `cf3004b` Slice 4: apps/web-ui Phase 0 (/ideas)
  - `be40105` Slice 6: cluster by entity (replaces subject-string)
  - `3787fcf` extractor v3 + cross-type entity merge
  - `c31943d` fix: t.co filter in body URL_RE path
- **New packages:** `@x-scraper/capture`, `@x-scraper/synthesizer`.
- **New app:** `apps/web-ui` (Next.js 15, port 3737, /ideas screen).
- **Live data state at session end:**
  - Vault rebuilt at `~/x-scraper-vault/` from a clean reset this
    session. Backups at `/tmp/x-scraper-vault-pre-rebuild-*` and
    `/tmp/x-scraper-vault-pre-drain-*`.
  - 304 source files, 1,261 claims, 391 entities, 16 draft Ideas,
    189 cache entries.
  - 352 tests passing across 49 files (was 347/49). Lint, typecheck,
    format, circular all clean.
  - Cumulative LLM cost this session: ~$5.38 ($5.20 drain + $0.18
    synthesis).
  - 20 sync failures total: 19 t.co rows (now filtered upstream by
    the `c31943d` fix; pre-fix dead rows remain in the queue), 1
    JS-heavy SPA Readability couldn't extract.
  - 145 derived ledger rows still status=`new` (mix of t.co and
    other discoveries the body-scan made — deferred).

## What Was Done This Session

### 1. Pat's diagnosis at session open

Pat surfaced eight concerns about the system not being a real
knowledge library: claims feel bad, no L0→L1 promotion, no topics,
ingest takes forever because we re-scrape on every change, raw
sources not stored, nothing tested except ingest, the system isn't
useful. I synthesized to three structural problems:

1. Capture and refine entangled.
2. No knowledge promotion (everything stayed L0).
3. No consumption surface to validate output against.

Pat agreed and authorized rebuild end-to-end ("nuke what we have").

### 2. Slice 1 — `@x-scraper/capture` (commit `1ebb999`)

- New package with `CaptureStore` (content-addressed file cache at
  `<vaultDir>/.cache/raw/<sha256>.json`) and captors per
  content_type (article/repo/youtube/pdf/x-article/tweet).
- Each captor preserves raw bytes/text alongside the parsed view
  the extractor consumes (raw_html + Readability output;
  raw_repo_json + decoded README; raw_watch_html + raw_caption_xml
  + transcript_segments; base64 PDF + per-page text;
  Patchright-rendered HTML + parsed blocks).
- `extractTextStage` refactored to read-through the cache. Cache
  miss triggers capture + write; cache hit returns instantly. Cache
  is keyed by canonical URL (http→https variants share one entry).
- New `xs refine [--content-type=KIND] [--source=ID] [--limit=N]` —
  iterates the cache, builds SourceItems with body pre-populated,
  pushes through dispatcher with `skipFetchLinks=true`. No network.
- t.co guard added to `enqueueEntityLinkDerivedRows` (closes the
  carry-over t.co bug from session 6).
- Vault `.gitignore` adds `.cache/`.
- New `extractPdfPagesText` exported from `@x-scraper/ingestor` so
  pdfjs doesn't get duplicated into capture/.

### 3. Slice 3 — `@x-scraper/synthesizer` (commit `021f5d4`)

- Cluster claims, draft L1 Ideas via Sonnet, persist with
  provenance.
- Cluster admission threshold: ≥3 claims AND ≥2 distinct sources.
- Idea id derived from (anchor, prompt-version) — stable across
  re-runs; new evidence updates existing Ideas.
- `persistIdea` preserves status/edited_body/created_at across
  re-syntheses. Manual edits stick (`edited_body: true`).
- Core schema additions:
  - `ENTITY_TYPES` adds `Idea` (ID prefix `idea_`).
  - `VAULT_DIRS` adds `ideas` (vault/ideas/idea_<id>.md).
  - `EDGE_TYPES` adds `SYNTHESIZED_FROM` and `PROMOTES`.
  - `IdeaFrontmatterSchema` with tier=1, status, confidence.
- Extractor explicitly excludes Idea / SYNTHESIZED_FROM / PROMOTES
  from its enum — synthesizer is the sole writer.
- CLI: `xs ideas synthesize | list | show | confirm | reject`.

### 4. Slice 4 — `apps/web-ui` Phase 0 (commit `cf3004b`)

- Next.js 15 + React 19 + Tailwind 4 (CSS-only `@import` config;
  no tailwind.config.ts). Port 3737.
- Server actions consume `@x-scraper/{vault,core,synthesizer}`
  in-process. No REST round-trip.
- Routes:
  - `/` → redirect to `/ideas`
  - `/ideas` → list ideas filtered by status (default draft)
  - `/ideas/<id>` → idea body + Confirm/Reject server actions
- Workspace tsconfig + eslint exclude `apps/web-ui/`. Web-ui has
  its own gates via `next build` and `tsc -p tsconfig.json`.

### 5. Slice 6 — Entity-anchored clustering (commit `be40105`)

- Subject-string clustering admitted only 1 cluster on a 6-source
  test corpus. The LLM extractor anchors claims on per-source slugs
  ("claude-code", "anthropic-cookbook"), so subjects don't intersect.
  The cross-source signal lives in the entity graph: "Anthropic"
  mentioned in 6 sources, "Claude Code" in 5.
- New `clusterByEntity` walks each entity's name+aliases against
  every claim's normalized subject AND object. Loose-equality match
  (NFKC + lowercase + whitespace/hyphen/underscore collapse) so
  "Claude Code" matches "claude-code" matches "claude_code".
- New `loadEntitiesFromVault` for Person/Tool/Concept/Repo/etc.
- Idea frontmatter `subject` uses entity display form.
- New `PROMOTES` edge (entity → idea) for graph navigation.
- Result: 8 admitted clusters on the 6-source corpus (up from 1
  via subject-string).

### 6. Extractor v3 + cross-type entity merge (commit `3787fcf`)

- New `extraction-v3.ts` (`EXTRACTION_PROMPT_VERSION=3`):
  - 5–15 substantive claims per source (was 40+).
  - Subject MUST be display-form entity name (was kebab-case slug).
  - Organizations are Tool, not Person.
  - Skip trivially-derivable claims (install URLs, license names,
    repo metadata).
- `buildFindAnyEntityByNormalizedSurface` cypher + GraphStore
  method `findEntityByNormalizedSurfaceAcrossTypes`.
- `ErCandidateFinder.findByNormalizedSurfaceAcrossTypes` + new
  `ErJudgementWithType` interface returning `matchedType`.
- `resolveEntity` Phase 0b: when type-scoped lookup misses AND the
  candidate type is in {Person, Tool, Concept}, fall back to a
  cross-type lookup. URL-anchored types stay strictly scoped.
- `writeVaultStage` + `updateGraphStage` honor `resolution.matchedType`
  — preserve the existing label rather than writing parallel records.
- Test mocks updated to stub the new finder method.

### 7. Bug found by Pat inspecting cache JSON (commit `83f7603`)

- Pat ran `jq` over a cache file and saw `captor: "tweet"` /
  `content_type: "tweet"` for a github.com URL. Repo captures were
  being silently rewritten as tweet envelopes during refine — the
  pre-fetched-body short-circuit called `buildTweetCapture` for ANY
  pre-fetched body, including refine/reindex paths.
- Fix: only write a TweetCaptured when `inferContentType` says the
  URL is a tweet AND the cache has nothing yet. For non-tweet URLs
  with body pre-fetched, trust whatever's in cache and never
  overwrite.
- Verified post-fix: re-synced two repos, ran refine, both captures
  retained `captor: repo` with `raw_repo_json` + `raw_readme_md`.

### 8. Corpus drain (full ramp 1→2→4→8→16→32→64→128)

- Restored 200 organic ledger rows from
  `/tmp/queue-nuked-20260427-105137.sqlite` into the fresh queue
  (avoided re-pulling x.com).
- Wiped Neo4j + vault, re-init, ran `xs bookmarks sync` ramped.
- Costs: $0 / $0.029 / $0.039 / $0.041 / $0.180 / $0.551 / $1.086
  / $3.276 — total $5.20 drain.
- Final: 236 organic+derived synced, 19 failed (all t.co or SPA),
  145 still pending.
- Spot-checked v3 output: 3 claims/source avg vs ~20 under v2;
  concept-level subjects ("AI Personality Prompting",
  "System Prompt Customization") not slug-form.
- Top entities by source-count: AI Personality Prompting (32),
  Claude Code (28), System Prompt Customization (25), OpenClaw (16),
  Agent Primitives (15), Anthropic (10 — single record, cross-type
  merge worked).

### 9. Final synthesis on full corpus

- 17 idea_written events / 16 unique Idea ids (one Idea was
  re-synthesized on a second `--force` pass and updated in place).
- Top: OpenClaw (51 claims/23 sources), Claude Code (44/30, conf
  0.62 — captures the productivity narrative AND the skeptical
  reverse-engineering source), Anthropic (19/12), Moltis (16/2,
  0.96), Pi Messenger (13/2, 0.93), X-CLI (13/2, 0.88), Ralph Loop
  (10/2, 0.95), CLAUDE.md (9/4), Obsidian, Superpowers, ClawVault,
  AutoResearch, Block, Vibe Coding, Nano Banana 2, Visual Explainer
  Skill.
- Synthesis cost: $0.18.

## Key Decisions

- **Build the value loop first.** Captured the architectural shift
  in a feedback memory: capture/refine separation + L0→L1 promotion
  + consumption surface trump any single-layer tuning. Each piece of
  the old monolith was technically clean; the value loop didn't
  exist.
- **Cluster by entity, not by subject.** The graph already has
  cross-source signal in `MENTIONED_IN`; the LLM doesn't put it in
  claim subjects. clusterByEntity is the correct primitive.
- **Idea id stable on (anchor, version), not (anchor, sources).**
  Adding new evidence updates the existing Idea instead of minting
  a parallel draft. Bumping `SYNTHESIS_PROMPT_VERSION` is the
  explicit fork mechanism.
- **Cross-type merge only for {Person, Tool, Concept}.** URL-anchored
  types (Source/Article/Tweet/Video/PDF/Repo) stay scoped — a github
  URL is genuinely a Repo, not a Tool.
- **Web-ui excluded from workspace lint/typecheck.** Next-flavored
  RSC/JSX conflicts with the strict-type-checked profile we run on
  packages. Web-ui passes its own gates.
- **Wipe + rebuild instead of migrate.** Pat authorized "nuke what
  we have" when the architecture changed. v2-prompt artifacts would
  have been awkward to migrate to v3 conventions; cleaner to backup
  and start fresh. Backups live at /tmp/.

## What Failed

- **Refine silently overwrote rich repo captures with tweet
  envelopes.** Caught by Pat literally `jq`-ing a cache file. Fix
  in `83f7603`. Saved as feedback: queue success status hides shape
  mismatches; always cat the actual artifacts after pipeline changes.
- **First entity-clustering attempt found only 2 ideas on 6 sources.**
  Even after fixing subject vs entity anchor, 5 of 6 entities still
  failed admission because their cross-source mentions didn't
  produce CLAIMS in those other sources — only passing references.
  Resolved by: (a) accepting that conservative is correct, and (b)
  ingesting more sources.
- **Loose normalization missed `claude-code` ↔ `Claude Code` until I
  added `looseAnchor`.** First `clusterByEntity` cut still used the
  strict `normalizeAnchor` that didn't collapse hyphens vs spaces.
  One-line fix.
- **CI test broke after t.co fix** — sync.test.ts had a fixture
  that expected t.co URLs to enqueue derived rows. Updated fixture
  + added comment explaining the guard now fires.
- **Web-ui scaffold initially used `JSX.Element` return types.**
  React 19 dropped global JSX namespace. Fix: omit the explicit
  return type on async server components.
- **Next.js production build failed lint** — workspace eslint config
  doesn't fit RSC patterns. Fix: exclude `apps/web-ui/` from
  workspace lint; web-ui lints itself via `next lint`.

## Deferred / Backlog

- **Drain remaining 145 derived ledger rows.** Now that the t.co
  body-scan filter is in (`c31943d`), most t.co rows are no longer
  enqueued, but the 145 already-enqueued rows include both t.co
  carry-over and reachable URLs. Decide whether to retry, mark
  dead, or selectively drain.
- **L1→L2 promotion (Idea → Learning).** EDGE_TYPES already
  reserves `PROMOTES` for this. Same shape as L0→L1: cluster
  Ideas by overlapping derived_from sources / shared subject
  themes, draft a more durable Learning that survives even when
  individual underlying claims are invalidated.
- **Web-ui beyond Phase 0.** `docs/web-ui/ROADMAP.md` has the full
  plan: Sigma.js graph viz of Concepts × Claims × Ideas, Claude
  Agent SDK chat surface, source browser, search.
- **Codex review on main.** 6 new commits (3 features, 3 fixes)
  haven't been reviewed. Recreate the worktree at
  `/Users/ppatterson/Working/x-scraper-codex-review`.
- **Investigate Claude Code idea's confidence drop.** The first
  synthesis at 12 sources gave 0.72; with 30 sources it dropped to
  0.62. The synthesizer noticed conflict between productivity
  framing and the skeptical reverse-engineering source — that's
  correct behavior, but worth confirming the caveat is doing the
  right thing.
- **Synthesize a digest.** Once Pat reviews/confirms ideas, can
  build a weekly digest of newly-confirmed L1 Ideas. Pat declined
  the scheduling offer at end of session.
- **Drain restore-from-backup of session 6's 154 derived rows.**
  Those are still in /tmp/queue-pre-rebuild-*.sqlite. Probably
  not worth restoring — most were t.co stubs anyway.

## Traps for Next Session

- **Use `/opt/homebrew/bin/node`** for the CLI — better-sqlite3 ABI
  matches Homebrew Node 25, not nvm Node 24.
- **Capture cache lives inside the vault** at `.cache/raw/`. A vault
  tarball includes it; `git push` does not. If you wipe the vault
  you wipe the cache.
- **Cache is the source of truth for raw bytes.** Refine paths must
  never overwrite a cache entry with a less-rich shape (the bug
  Pat caught). Test before shipping any change to extractTextStage.
- **`SYNTHESIS_PROMPT_VERSION` lives at 1.** Bumping creates new
  Idea ids; the existing 16 stay on disk under v1. Confirmed/rejected
  state survives within a version, not across.
- **`EXTRACTION_PROMPT_VERSION` lives at 3.** Bump and add a sibling
  file when changing rules; never edit a published version in place.
- **Edited Idea bodies are sticky** (`edited_body: true` survives
  re-synthesis). Flip to `false` to opt back in.
- **Web-ui's vault path defaults to `~/x-scraper-vault`.** Override
  via `XSCRAPER_VAULT`. Server actions write to disk — the dev
  server needs filesystem permissions.
- **Cross-type merge only for {Person, Tool, Concept}.** Adding new
  types to the equivalence set requires care — would let URL-anchored
  types collide.
- **Synthesizer admission threshold is hard-coded** (≥3 claims AND
  ≥2 sources). Loosening produces noise, not insight.
- **Next.js 15 + React 19 quirks:** no global `JSX.Element`, async
  server components need params/searchParams as Promises, JSX
  return types should be omitted (let TS infer).
- **352 tests pass** — if a number lower than that comes back,
  something regressed. Check the test mocks first when adding
  graph/finder methods.
- **Drain failures = 20 known.** Don't treat that as a clean run.
  Most are t.co (now filtered upstream); some are JS-heavy SPAs
  Readability can't handle. Future fix would be a Patchright
  fallback for SPA articles.

## Next Steps

1. **Open the web-ui and review the 16 draft Ideas.**

   ```bash
   pnpm --filter @x-scraper/web-ui dev   # http://localhost:3737/ideas
   ```

   Confirm or reject each. The point of session 8 was to deliver a
   working review loop — the next session validates whether it's
   actually useful by USING it. Look for:
   - Ideas that synthesized something you didn't already know.
   - Ideas where the caveat correctly flagged thin evidence.
   - Ideas that should be rejected (false patterns).

2. **Codex review on main.**

   ```bash
   git worktree add /Users/ppatterson/Working/x-scraper-codex-review main
   cd /Users/ppatterson/Working/x-scraper-codex-review
   codex review --base main \
     > /Users/ppatterson/Working/x-scraper/.repostat/codex-review/run-$(date +%Y%m%d-%H%M%S).log 2>&1 &
   ```

   Six commits unreviewed; expect a few P2s on the prompt v3 rules,
   the cross-type merge edge cases, and the cache-overwrite fix.

3. **Decide L1→L2 direction.** With 16 confirmed/rejected Ideas as
   data, choose the L2 (Learning) cluster anchor: shared
   `derived_from` claims? shared entity-set? semantic centroid? The
   answer probably falls out of which Ideas Pat keeps after review.

4. **Drain the 145 pending derived rows** (or mark dead).

   ```bash
   /opt/homebrew/bin/node packages/cli/dist/bin.js bookmarks sync \
     --order=oldest --limit=128
   ```

5. **Web-ui Phase 1: Sigma.js graph viz** per `docs/web-ui/GRAPH_VIS.md`
   — show Entities × Claims × Ideas, click-through to detail panes.
