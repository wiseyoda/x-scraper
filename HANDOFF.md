# Session Handoff

> Updated 2026-07-10 — Phase 0 complete (stabilize). See `docs/PRODUCT_PLAN.md`.

## Current State

- **Branch:** `main`, commits:
  - `187f1b4` feat(synthesizer+cli): auto-confirm policy and run-cycle command
  - `3af6873` feat(web-ui): dashboard, inbox humanization, and sync-from-app
- **Product plan:** Phase 0 **done**; **Current phase: Phase 1** (connection engine).
- **Tests:** 370 passed / 3 skipped (51 files). Web-ui `tsc --noEmit` green.
- **Node:** host is Node v26.0.0 (MODULE 147). better-sqlite3 rebuilt via `pnpm install --force`.
- **Neo4j:** started this session (`brew services start neo4j`).
- **Ledger:** failed 20+ (derived), new ~152 (11 organic / 141 derived), synced ~254. Full drain blocked by **invalid Gemini API key** on `embed_source`.
- **Schedule:** **not installed** (explicit skip — no prior LaunchAgent). Code defaults to `run-cycle` mode.

## What Was Done

### Phase 0 (PRODUCT_PLAN)

1. Landed session-9 CLI/synth + web-ui as two commits.
2. Humanized inbox: `deriveInboxDisplay` — primary title/gist/@author, URL secondary; unit tests in `apps/web-ui/lib/inbox-display.test.ts`.
3. Documented ledger inventory + drain attempt failures (Neo4j then Gemini key).
4. Documented schedule install skip.
5. V0 gates green; evidence under goal scratch + `.repostat/phase0-evidence/`.

## Key Decisions

- Schedule install deferred (host mutation without consent).
- Drain inventory path accepted over multi-hour sync with bad Gemini key.
- Inbox display pure module lives in web-ui (vitest include extended for `apps/web-ui/**/*.test.ts`).

## Traps

- NEVER import `better-sqlite3` / `@x-scraper/queue` from web-ui — subprocess sqlite3 only.
- Sync child must use file stdio.
- Gemini key currently invalid — fix before expecting embed/sync success.
- Node 26: rebuild better-sqlite3 after Node upgrades.

## Next Steps

1. **Phase 1** `related()` engine — start at P1.1 in `docs/PRODUCT_PLAN.md`.
2. Fix `GEMINI_API_KEY` then `xs bookmarks sync --order=newest --limit=N` for remaining organic rows.
3. Optionally: `xs schedule install --interval=3600 --mode=run-cycle`.
4. Keep PRODUCT_PLAN + this file updated each session.
