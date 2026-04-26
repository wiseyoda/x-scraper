# Session Handoff

> Updated 2026-04-26 after a long build session that landed 3 PRs and stacked 2 more slice branches plus an open PR with a CI failure.
> Read this first in the next session.

## Current State

The repo is live at github.com/wiseyoda/x-scraper. Three PRs merged to `main` (spikes 1-8, slice 1 scraper + Neo4j pivot, slice 1 codex fixes). PR #3 (slice 2 — core + vault) is **open with a failing CI test step**. Two more slice branches (`slice/3-queue`, `slice/4-graph`) are pushed but have no PRs yet because they were stacked on slice/2-vault; they need to be rebased off main one at a time after PR #3 merges.

Local working tree is clean on branch `slice/2-vault-clean` (which is what `slice/2-vault` on origin currently points at after a force-push).

```
git log --oneline -5 main
f020ac2 fix(scraper): cursor backfill + passive resume + replay fallback (#4)
44fa305 Slice 1: packages/scraper + Neo4j pivot (#2)
4a0adc4 Spikes 1-8: prove every external integration before production code (#1)
aa79ae1 ci: defer pnpm version to packageManager field
74e4723 chore: bootstrap pnpm monorepo with strict TS, eslint, prettier, vitest
```

## What Was Done This Session

This was a marathon build-from-zero session. In rough order:

**Discovery (8 question rounds):** locked stack to TS monorepo, Patchright auth with persistent profile, markdown-canonical vault + derived graph, bi-temporal Graphiti-style schema + mem0 ADD/UPDATE/DELETE/NONE reconciliation, Gemini embedding-2-preview at 1536 dims, Claude API primary, full MCP+CLI+REST+markdown surface, codex review at milestones.

**Repo bootstrap (PR #1 merged):**
- pnpm workspace + tsconfig strict + eslint flat config + prettier (100-char) + vitest (80%/75%/80%/80% coverage) + GitHub Actions (CI + Gitleaks)
- Docs: ARCHITECTURE, ROADMAP, SPIKES, CODING_STANDARDS, CODEX_REVIEW
- 8 risk-reduction spikes, all PASSED (with codex catching 3 silent gate gaps that I fixed before merge)
- Verified all six API keys in `~/.config/x-scraper/.env`

**Slice 1 + Neo4j pivot (PR #2 merged):**
- Mid-session discovery: Kùzu was abandoned after Apple's Oct 2025 acquisition. Pivoted to RyuGraph fork → discovered RyuGraph's GitHub is 5+ months stale and its vector extension CDN is offline. Pivoted again to **Neo4j Community 2026.04** (`brew install neo4j`, JVM daemon, native HNSW + GDS).
- Spike 3 rewritten and rerun: vector top-10 12ms / 2-hop traversal 26ms (warm cache). Inserts 38–200× faster than per-row CREATE thanks to UNWIND batching.
- `packages/scraper` shipped: hexagonal X auth + bookmarks fetcher (passive capture + active GraphQL replay + cursor handling), 13 vitest cases on the pure parser.
- Codex review on the slice 1 PR caught 4 real bugs (max_bookmarks not honored in active replay, fire-and-forget response handler races, headed-login DOM timing, page count vs record count). All four fixed before merge.

**Scraper hardening (PR #4 merged):**
- Codex review on slice 2 surfaced 3 more scraper P2 bugs in code I'd already merged: cursor backfill on every record (Bottom cursor entry typically arrives AFTER tweet entries → records carried `cursor: null`), active replay starting at the page passive already rendered (wasted budget), replay failure throwing away passive results. All three fixed.

**Slice 2 (PR #3, OPEN, CI failing):**
- `packages/core`: constants (ENTITY_TYPES, EDGE_TYPES, VAULT_DIRS, ID_PREFIXES), frontmatter Zod schemas (Source/Claim/Topic/Entity discriminated union), frontmatter codec (parseDocument/formatDocument round-trip with CRLF normalization), entityId/randomId, contentHash, canonicalizeUrl. 37 tests.
- `packages/vault`: VaultStore port + createMarkdownVault adapter (init/write/read/list/commit), safeJoin (rejects absolute paths, parent traversal, symlinked-ancestor escape), fileBasename (rejects forbidden chars + `..`). 13 tests.
- After codex review caught the gitignore swallowed `packages/vault/`, force-pushed cherry-picked clean branch.
- Final commit: tsconfig `paths` mapping for `@x-scraper/*` → source so lint/typecheck don't need built dist.

**Slice 3 (`slice/3-queue` branch on origin, no PR):**
- `packages/queue`: durable SQLite job queue. Stages: fetch_links → extract_text → embed_source → extract_facts → resolve_ents → reconcile → write_vault → update_graph. Idempotency on `(run_id, source_id, idempotency_key)`. Stale-lease recovery (5min). Exponential backoff (30s × 2^n, capped 30min). DLQ. Cost ledger with run/job/stage attribution. 9 tests including a durable-across-reopens test. SQL schema PRAGMA-versioned at 1.

**Slice 4 (`slice/4-graph` branch on origin, no PR):**
- `packages/graph`: GraphStore port + createNeo4jGraph adapter. Cypher builder module (cypher.ts, pure, validates labels/edge types against unions). Methods: init (constraints + HNSW), upsertNode (with optional embedding), upsertEdge (bi-temporal), invalidateEdge (sets invalid_at on currently-valid edges), vectorSearch, traverse (variable-length, edge-type filtered), countNodes, close. 17 unit tests on cypher.ts + integration tests gated `RUN_INTEGRATION=1` against the local Neo4j.

**Memory written:** 6 entries total (3 from earlier in session, 3 added at end-session): user_github, feedback_llm_defaults, feedback_production_grade, feedback_branch_strategy, project_x_scraper_status, reference_neo4j_local.

## Key Decisions

- **Neo4j over alternatives.** First we tried RyuGraph (Kùzu fork) — its repo was stale and the vector-extension CDN was offline. Considered FalkorDB but it requires Docker and Pat doesn't have Docker installed. Memgraph also Docker. Neo4j has a current Homebrew formula (2026.04.0 from this month), single command install, ~13k installs/year. Pat verbally confirmed pivoting after I surfaced the trade-offs. The "main repo frozen since Dec 2024" optic exists but the product is shipping monthly via brew. Adapter port keeps the door open to swap to Memgraph (Bolt-compatible) or sqlite-vec later.
- **Markdown is canonical, graph is a derivable index** (Karpathy gist + basic-memory pattern). Vault is git-tracked at `~/Documents/x-scraper-vault/`. The Neo4j graph can be rebuilt from markdown via `xs reindex`.
- **Hexagonal everywhere.** Every package has a port + adapter shape (`VaultStore`, `JobQueue`, `GraphStore`). The in-memory test fakes drop into the same port.
- **Test gates must prove the risky thing.** Codex flagged 3 spike gates that passed PASS without exercising the integration they were meant to prove (HNSW vs brute force; passive fallback never triggered; replay multi-page). Tightened all three.
- **Generous LLM `max_tokens`.** Pat pushed back when I used `max_tokens: 2000` and got truncation. CODING_STANDARDS.md now mandates 16k–32k for extraction, no MIN_ thresholds in schemas, always check `stop_reason`.
- **One PR open at a time, branch off main.** Stacking slice branches caused PR #3 to go DIRTY when PR #4 changed scraper files. Surgery cost ~30 minutes and a force-push.
- **tsconfig `paths` for workspace types.** `@x-scraper/core` was resolving to `dist/index.d.ts` which doesn't exist before build. Added paths mapping to source so lint/typecheck don't need a build step. (Vitest needs the same fix — see below.)

## What Failed

- **Kùzu adoption (Oct 2025 abandonment).** First spike of this stack worked great; only caught the deprecation when re-running install on a new branch and seeing `WARN deprecated kuzu@0.11.3: Package no longer supported`. Lesson: check npm deprecation status BEFORE building a stack on a package.
- **RyuGraph as Kùzu replacement.** Looked promising — npm-published with the same API surface. Two failures: (a) `INSTALL VECTOR` failed because their extension CDN at `extension.ryugraph.io` was unreachable, so HNSW was unavailable; (b) GitHub fork has no commits in 5+ months. Same dead-fork smell I was trying to avoid.
- **FalkorDB / Memgraph evaluation.** Both highly active, but the user has no Docker, Colima, or Podman installed. Both require it. Killed both options.
- **`pnpm.onlyBuiltDependencies` doesn't auto-fix install-script ignores.** Even after adding `better-sqlite3` to the list, pnpm install still wouldn't run the build script. Had to manually `npx prebuild-install` from inside the package's directory. Same kludge worked for kuzu earlier. Document this in the queue package's README before we forget.
- **Stacking slice branches.** Slice/2-vault was branched off slice/1-scraper. When PR #4 merged scraper fixes to main, PR #3 went DIRTY. Had to cherry-pick slice 2's commits onto a clean branch (`slice/2-vault-clean`) and force-push. Slices 3 and 4 inherit the same problem.
- **vault/ gitignore swallowed packages/vault/** (codex caught it). `vault/` matched `packages/vault/` everywhere. Fixed to `/vault/`.
- **First v1.1 verify_credentials API call in spike 1** failed because modern X requires Bearer + x-csrf-token headers. Switched to reading `screen_name` from the rendered sidebar DOM via `data-testid="AppTabBar_Profile_Link"` href.
- **The `kuzu` install script ran inside the wrong cwd** because shell `cd` persists across Bash tool calls (despite my earlier assumption it didn't). Caused a "command not found" cascade. Fixed with explicit `cd /full/path` at the top of every dependent command.
- **better-sqlite3 v12 typings + my generic `db.prepare<unknown[], JobRow>()` pattern.** The variadic spread didn't work the way I expected; switched to ungeneric prepare + casting `as JobRow[]`.
- **PR #3 CI: lint passed locally but failed in CI** because `@x-scraper/core` types resolved through `package.json#types` → `dist/index.d.ts` which CI hadn't built. Added tsconfig `paths` block. (See traps below — vitest still needs the same treatment.)
- **PR #3 CI: tests still failing after the lint fix** because vitest does runtime resolution of the workspace package through `package.json#exports` to `dist/index.js`, which doesn't exist pre-build. The tsconfig fix only covered TS resolution. **This is the open issue.**

## Deferred / Backlog

- **Roadmap slices 5–18 are unbuilt.** Slice 5 (`packages/embeddings`, Gemini adapter), 6 (`packages/llm`, Claude adapter), 7 (`packages/extractor`, prompts), 8 (`packages/reconciler`, ER + Leiden), 9 (`packages/ingestor`, article/repo/youtube/pdf), 10 (likes + own posts), 11 (search adapters Exa/Tavily/Brave + auto-expand), 12 (`packages/mcp-server`), 13 (`packages/rest`), 14 (`packages/cli`), 15 (digests + launchd), 16 (bot-mitigation hardening), 17 (observability + perf), 18 (docs + onboarding).
- **HNSW dimension mismatch.** `packages/graph/src/constants.ts` defaults to 1536 (matches our Gemini embedding-2-preview Matryoshka pick). The integration test uses 16 dims. Fine for tests but production must use 1536.
- **`@x-scraper/observability` not built.** The pino logger + `xs status` dashboard are still in ARCHITECTURE.md; no package skeleton yet.
- **better-sqlite3 install-script kludge** — production setup docs need to mention `npx prebuild-install` if `pnpm.onlyBuiltDependencies` doesn't take effect.
- **Spike 6 MCP server is registered nowhere.** When we get to slice 12 (production MCP server), we'll need a `xs mcp register --client {claude,codex,gemini}` command.
- **Codex review on slice 3 (queue) and slice 4 (graph) never ran** — they were stacked on slice 2 and codex would diff against the wrong base. Run after rebases.
- **Cookie-import auth path** (Chrome/Arc keychain extraction) was deferred from spike 1; the persistent-profile-only path is sufficient for now.

## Traps for Next Session

- **PR #3 CI is broken.** `pnpm test` fails with `Failed to resolve entry for package "@x-scraper/core"`. Vitest does runtime resolution via package.json `exports` → `dist/index.js` which doesn't exist before the build step. **Fix:** add `resolve.alias` to `vitest.config.ts` mapping `@x-scraper/core` → `./packages/core/src/index.ts` (and the other workspace packages). This is the FIRST task for the next session.
- **Local `slice/2-vault-clean` branch is what's pushed to origin's `slice/2-vault`** — they have the same content but different ref names. After PR #3 merges, delete both: `git branch -D slice/2-vault slice/2-vault-clean` and `git push origin :slice/2-vault` (already auto-deleted on merge if `--delete-branch` is used).
- **Slice 3 and slice 4 branches are stale.** Both were branched off slice/2-vault. After PR #3 merges, cherry-pick the slice-3-only and slice-4-only commits onto fresh branches off main. Slice 3 has commits `7082d7d` (queue feat). Slice 4 has commits `e72f43a` (graph feat). Use `git log main..slice/N` to find them.
- **Don't stack new slice branches.** Always branch off main, AFTER the prior slice merges. Codified in `feedback_branch_strategy.md` memory.
- **macOS `cd` persists across Bash tool calls** in this session's shell. If you run `cd /some/dir` it stays until you `cd` back. Always use absolute paths or `cd /Users/ppatterson/Working/x-scraper && <cmd>` if there's any doubt.
- **`pnpm.onlyBuiltDependencies` is unreliable.** Even after listing `better-sqlite3` and `kuzu`, pnpm sometimes ignores install scripts. Workaround: `cd node_modules/.pnpm/<pkg>@version/node_modules/<pkg> && node install.js` or `npx prebuild-install`.
- **Neo4j tests need a running daemon.** `brew services start neo4j` before running any spike 3 or `RUN_INTEGRATION=1 pnpm test packages/graph`. Password is `xscraper-local-dev` in `~/.config/x-scraper/.env`.
- **kuzu/ryugraph segfaults on shutdown** — irrelevant now that we're on Neo4j, but if we ever fall back, force `process.exit(0)` after `await db.close()`.
- **Codex review caught 7 real issues across this session.** Always run `codex review --base main` before merging a slice. Critical/major findings block.
- **Generous max_tokens.** Pat explicitly pushed back on `max_tokens: 2000`. Production extraction calls should use 16k–32k. No MIN_ thresholds in extraction schemas.
- **Spike fixtures directory is gitignored.** `spikes/fixtures/*` contains real bookmark data + auth headers. Scrubbed golden fixtures live in `golden-corpus/` (not yet created — slice 6 will set it up).

## Next Steps

1. **Fix PR #3's vitest workspace resolution.** Add `resolve.alias` to `vitest.config.ts`:
   ```ts
   import { defineConfig } from 'vitest/config';
   import { resolve } from 'node:path';
   export default defineConfig({
     resolve: {
       alias: {
         '@x-scraper/core': resolve(__dirname, 'packages/core/src/index.ts'),
         '@x-scraper/vault': resolve(__dirname, 'packages/vault/src/index.ts'),
         '@x-scraper/queue': resolve(__dirname, 'packages/queue/src/index.ts'),
         '@x-scraper/graph': resolve(__dirname, 'packages/graph/src/index.ts'),
         '@x-scraper/scraper': resolve(__dirname, 'packages/scraper/src/index.ts'),
       },
     },
     test: { /* existing */ },
   });
   ```
   Commit on `slice/2-vault-clean`, force-push to `slice/2-vault`. Expect: CI green.
2. **Run `codex review --base main`** on PR #3 and address findings.
3. **Merge PR #3.** `gh pr merge 3 --squash --delete-branch`.
4. **Rebase slice 3 and 4 cleanly off the new main:**
   ```bash
   git checkout main && git pull
   git checkout -b slice/3-queue-clean
   git cherry-pick 7082d7d   # the queue feat commit
   # verify, push as new PR
   git checkout main
   git checkout -b slice/4-graph-clean
   git cherry-pick e72f43a   # the graph feat commit
   # verify, push as new PR
   ```
5. **Run codex review on each rebased PR.** Address findings, merge.
6. **Resume the roadmap at slice 5** (`packages/embeddings`, Gemini adapter behind an `EmbeddingProvider` port; OpenAI fallback; first-class adapter pattern). Then 6 (`packages/llm` Claude). Then 7 (`packages/extractor` with versioned prompts in `docs/PROMPTS/`).

Open file paths to remember:
- `docs/ARCHITECTURE.md` — full design + Kùzu→RyuGraph→Neo4j pivot history
- `docs/ROADMAP.md` — slice plan
- `docs/CODING_STANDARDS.md` — including the LLM defaults Pat called out
- `docs/CODEX_REVIEW.md` — review process and severity levels
- `~/.config/x-scraper/.env` — all six API keys live (chmod 600)
- `~/Documents/x-scraper-vault/` — does NOT exist yet; slice 14's `xs init` will create it
