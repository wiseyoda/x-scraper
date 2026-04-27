# Session Handoff

> Updated 2026-04-27, end of session 7. Three feature commits on `main`
> (capture/refine, synthesizer, web-ui) reshape the project from a
> monolithic ingest pipeline into a value-loop architecture: capture
> once, refine many; promote L0 claims to L1 ideas; review and confirm
> in a web UI.
>
> **Read this first.**

## Current State

- **Branch**: on `main`, head `cf3004b` (clean).
- **New packages**:
  - `@x-scraper/capture` — content-addressed raw cache + 6 captors
    (article/repo/youtube/pdf/x-article/tweet)
  - `@x-scraper/synthesizer` — L0→L1 promotion (cluster, draft, persist)
  - `apps/web-ui` — Next.js 15 review surface at port 3737
- **Vault**: reset to `~/x-scraper-vault/`. Initialized clean. Backup of
  the prior 290-source corpus at
  `/tmp/x-scraper-vault-nuked-20260427-105109/`. Capture cache lives at
  `~/x-scraper-vault/.cache/raw/<sha256>.json` (gitignored).
- **Queue**: reset to `~/.config/x-scraper/queue.sqlite`. Backup at
  `/tmp/queue-nuked-*.sqlite`.
- **Neo4j**: wiped clean (`MATCH (n) DETACH DELETE n`). Re-population
  begins on the next `xs sync` / `xs bookmarks sync` run.
- **Test suite**: 347 passing across 49 files (was 332 / 47). Lint,
  typecheck, build, format, circular all clean.
- **CI**: green expected on `main`.

## Why This Refactor Happened

Pat called out that the system wasn't actually a knowledge library: too
many APIs hit on every change, claims that didn't help, no
self-organization, no promotion of knowledge tiers, no consumption
surface. Three structural problems:

1. **Capture and refine were entangled.** Re-extraction meant
   re-scraping. New prompts cost network dollars. Raw artifacts
   discarded after extraction.
2. **No knowledge promotion.** Everything was L0. The graph was a flat
   soup of claims; no L1 ideas, no L2 learnings, no L3 principles.
3. **No consumption loop closed.** The pipeline ran without a surface
   to verify what came out of it.

The three feature commits address those three problems.

## What Was Done This Session

### Slice 1 — `@x-scraper/capture` (commit 1ebb999)

- New package with `CaptureStore` (content-addressed file cache at
  `~/x-scraper-vault/.cache/raw/<sha256>.json`) and captors per
  content_type. Each captor preserves raw bytes/text alongside the
  parsed view the extractor consumes.
  - article: raw HTML + Readability
  - repo: raw GitHub /repos JSON + decoded README
  - youtube: raw watch HTML + raw caption XML + timed segments
  - pdf: base64 PDF bytes + per-page text
  - x-article: Patchright-rendered HTML + parsed blocks
  - tweet: pre-fetched text envelope (no network)
- Refactored `extractTextStage` to read-through the cache. Cache miss
  triggers capture + write; cache hit returns instantly. Cache is keyed
  by canonical URL (http→https variants share one entry).
- New `xs refine [--content-type=KIND] [--source=ID] [--limit=N]` —
  iterates the cache, builds SourceItems with body pre-populated, and
  pushes through the dispatcher with `skipFetchLinks=true`. No network
  at all. Lets us roll out a new prompt version without re-fetching.
- T.co guard added to `enqueueEntityLinkDerivedRows` (the bug that
  caused 25 dead rows last session).
- Vault gitignore now excludes `.cache/`.
- New helper `extractPdfPagesText` in `@x-scraper/ingestor` so pdfjs
  doesn't get duplicated into `capture/`.

### Slice 3 — `@x-scraper/synthesizer` (commit 021f5d4)

- Cluster claims by normalized subject; admission threshold ≥3 claims
  AND ≥2 distinct sources.
- `synthesizeCluster` drives Sonnet against a cluster (versioned
  prompt, Zod-validated IdeaDraft, repair budget for malformed JSON).
- `persistIdea` writes Idea.md + Idea node + SYNTHESIZED_FROM edges.
  Idempotent — id is `entityId('Idea', anchor|version|sources)`. Re-runs
  preserve `status` and `edited_body` so a manual edit isn't clobbered.
- Core schema additions:
  - `ENTITY_TYPES` adds `Idea` (ID prefix `idea_`).
  - `VAULT_DIRS` adds `ideas` (`vault/ideas/idea_<id>.md`).
  - `EDGE_TYPES` adds `SYNTHESIZED_FROM` (idea→claim provenance) and
    `PROMOTES` (reserved for L1→L2).
  - `IdeaFrontmatterSchema` with `tier=1`, `status` (draft|confirmed|
    rejected), `synthesizer_confidence`, `derived_from`, `edited_body`.
- Extractor explicitly excludes `Idea`, `SYNTHESIZED_FROM`, `PROMOTES`
  from its enum. Per-source extraction can never accidentally write
  L1 nodes — only the synthesizer is the writer.
- `xs ideas synthesize | list | show | confirm | reject`.

### Slice 4 — `apps/web-ui` (commit cf3004b)

- Next.js 15 + React 19 + Tailwind 4 (CSS-only @import config; no
  tailwind.config.ts). Port 3737, dark UI.
- Server actions consume `@x-scraper/{vault,core,synthesizer}` directly
  in-process. No REST round-trip.
- Routes (deferred routes per `docs/web-ui/ROADMAP.md` will land later:
  graph viz, agent chat, source browser, search):
  - `/`            → redirects to `/ideas`
  - `/ideas`       → list ideas filtered by status (default draft)
  - `/ideas/<id>`  → idea body + Confirm/Reject server-action forms
- Workspace tsconfig + eslint excludes `apps/web-ui/` (Next has its own
  passes; the strict-type-checked profile we run on packages conflicts
  with RSC/JSX patterns).

### Slice 5 — End-to-end verification

Reset state (vault, queue, Neo4j) with /tmp backups, ran the new
pipeline against three seed URLs, verified each layer:

| Step | Result |
| ---- | ------ |
| `xs init` | vault + queue created |
| `xs doctor` | all checks PASS, vault not iCloud-synced |
| `xs sync --urls=<3 URLs>` | 2 captured, 1 dead (404), $0.082 LLM, capture cache wrote 2 JSON entries |
| `xs refine --content-type=repo` | 2 cached refines, 0 dead, $0.080 LLM, no network |
| `xs ideas synthesize` | 48 claims loaded, 3 below-threshold clusters, 0 ideas (small corpus) |
| `xs ideas list` | empty draft list (correct) |
| `xs topic detect --synthesize --min-size=2` | 1 topic, 3 concepts, $0.001 |
| Web-ui (port 3737) | HTTP 200, /ideas renders empty-state |

## Key Decisions

- **Capture and refine separate by design.** Refine never touches the
  network; capture never invokes the LLM. New extraction prompts
  retroactively improve the entire corpus for $0 in network cost.
- **Idea ids derive from (anchor, sources, prompt-version).** Re-running
  synthesize over the same cluster produces the same id; user
  workflow state survives re-syntheses.
- **Edited Idea bodies are sticky.** `edited_body: true` in the
  frontmatter means the synthesizer will never overwrite the body
  on re-run. User can opt back in by toggling the flag.
- **Web-ui talks to the vault in-process.** Server actions import
  `@x-scraper/vault` directly. Sub-millisecond writes vs ~50–200ms
  REST round-trip. xs-rest and xs-mcp stay around for IDE / CLI users.
- **Synthesis admission threshold: ≥3 claims AND ≥2 distinct sources.**
  One claim from one source is a fact, not a pattern. The minimums
  exist to keep noise out of the L1 layer.
- **`apps/web-ui/` excluded from workspace lint/typecheck.** Next.js
  flavored RSC/JSX (async server components, JSX without React in
  scope) conflicts with the strict-type-checked profile we apply to
  packages. Web-ui passes its own gates via `next build` and
  `tsc --noEmit -p tsconfig.json` from inside the package.
- **Ramp ingestion still applies.** Same 1→2→4→8 doubling pattern when
  re-populating the corpus from bookmarks. Run `xs bookmarks pull`
  first, then `xs bookmarks sync --order=oldest --limit=N` with the
  doubling cadence.

## What Failed (and was fixed mid-slice)

- **PDF captor briefly duplicated pdfjs-dist.** Fixed by exporting
  `extractPdfPagesText` from `@x-scraper/ingestor` and importing it
  into the capture/pdf adapter.
- **Adding `Idea` to `ENTITY_TYPES` caused type breakage in `stages.ts`
  writeMergedEntity.** Fixed by adding `Idea` to the skip list in two
  places (writeVaultStage + updateGraphStage) — Idea is never produced
  by extraction; the synthesizer is its sole writer.
- **Next.js 15 + React 19 dropped global `JSX.Element`.** Fixed by
  omitting return type annotations on async server components and
  letting TS infer.
- **Next.js production build linted with project-wide ESLint config
  that doesn't fit RSC patterns.** Fixed by excluding `apps/web-ui/`
  from the workspace eslint config; web-ui lints itself via
  `next lint`.

## Deferred / Backlog

- **Re-populate the corpus.** Run `xs bookmarks pull --max=200` then
  ramp `xs bookmarks sync --order=oldest --limit=1, 2, 4, 8, 16, 32,
  64, 128`. Budget ~$5–8 (capture is one-shot per URL forever; refine
  is free network-wise from then on).
- **First real synthesize run.** Once the corpus has 200+ sources,
  `xs ideas synthesize` should produce real clusters. Use
  `--limit=10` for the first pass to keep cost bounded.
- **Build the rest of `docs/web-ui/ROADMAP.md`.** Phase 0 is shipped.
  Next: Sigma.js graph viz of Concepts × Claims × Ideas, Agent SDK
  chat surface, source browser, search.
- **Drain the t.co dead rows from the prior session.** They were
  backed up in `/tmp/queue-nuked-*.sqlite` but the live queue is
  fresh. Decide whether to reload them.
- **Codex review on main.** Three new packages + one new app — would
  appreciate independent eyes. Recreate the worktree at
  `/Users/ppatterson/Working/x-scraper-codex-review` first.
- **L2 / L3 promotion.** L1 ideas are first; the EDGE_TYPES already
  reserves `PROMOTES` for L1→L2. Slice for a future session.

## Traps for Next Session

- **Use `/opt/homebrew/bin/node`** for the CLI (matches the
  better-sqlite3 ABI; nvm `node` is wrong NODE_MODULE_VERSION).
- **`SYNTHESIS_PROMPT_VERSION` lives at 1.** Bumping it is fine; the
  Idea id incorporates the version, so prior drafts coexist with new
  ones (a new id, status=draft) until you confirm/reject the old.
- **Edited Idea bodies are sticky** (`edited_body: true` survives
  re-synthesis). If you want to wipe a hand-edit and re-synthesize,
  manually flip `edited_body: false` first.
- **Web-ui defaults to vault `~/x-scraper-vault`.** Override with
  `XSCRAPER_VAULT` env var. Server actions write to disk, so the
  process needs filesystem permissions on the vault.
- **Vault git is at `~/x-scraper-vault/.git`.** Same path as before
  the reset — the tree was rebuilt empty under that root.
- **Capture cache is gitignored** but lives inside the vault. A
  vault tarball / rsync backup includes it; a `git push` doesn't.
- **The synthesizer's cluster admission threshold is hard-coded.**
  ≥3 claims AND ≥2 distinct sources. Override via
  `clusterClaims(claims, { minClaims, minSources })` if you need
  to surface partial matches.
- **`schema_version` is at 4** in the queue (unchanged). Any new
  migration uses v5+.

## Next Steps

1. **Re-populate the corpus.**

   ```bash
   /opt/homebrew/bin/node packages/cli/dist/bin.js bookmarks pull --max=200
   /opt/homebrew/bin/node packages/cli/dist/bin.js bookmarks sync \
     --order=oldest --limit=1
   # then 2, 4, 8, 16, 32, 64, 128 — verify between each step
   ```

2. **First real synthesis pass.**

   ```bash
   /opt/homebrew/bin/node packages/cli/dist/bin.js ideas synthesize --limit=10
   /opt/homebrew/bin/node packages/cli/dist/bin.js ideas list
   ```

3. **Boot the web-ui and review the first batch of drafts.**

   ```bash
   pnpm --filter @x-scraper/web-ui dev
   open http://localhost:3737/ideas
   ```

4. **Codex review on main.**

   ```bash
   git worktree add /Users/ppatterson/Working/x-scraper-codex-review main
   cd /Users/ppatterson/Working/x-scraper-codex-review
   codex review --base main > /Users/ppatterson/Working/x-scraper/.repostat/codex-review/run-$(date +%Y%m%d-%H%M%S).log 2>&1 &
   ```

5. **Web-ui Phase 1: graph viz.** See `docs/web-ui/GRAPH_VIS.md` —
   Sigma.js + Graphology, ~1–2 days.
