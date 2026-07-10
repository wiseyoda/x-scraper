# Session Handoff

> Updated 2026-07-10 — Phase 1 complete (connection engine). See `docs/PRODUCT_PLAN.md`.

## Current State

- **Branch:** `main` (local commits; Phase 0 + Phase 1 work)
- **Product plan:** Phase 1 **done**; **Current phase: Phase 2** (living ideas & narrative digest)
- **Tests:** 377 passed / 3 skipped (53 files), including `packages/related` (7)
- **Keys:** Anthropic/Gemini/OpenAI verified live after billing fix
- **Organic ledger:** fully drained (214 synced organic)

## Phase 1 shipped

- **Package:** `@x-scraper/related` — `related(id)`, `attachmentsSince()`, pure scorers
- **CLI:** `xs related <id> [--limit=N] [--vault-only]`
- **Web-ui:** `/sources/[id]` "Related in your vault"; homepage "What connected since…"
- **run-cycle:** logs attachment event count after successful sync

## Key commands

```bash
/opt/homebrew/bin/node packages/cli/dist/bin.js related idea_8ec95fc7 --limit=8 --vault-only
pnpm exec vitest run packages/related
pnpm --filter @x-scraper/web-ui dev   # user terminal
```

## Next Steps

1. **Phase 2** — idea prompt rewrite (thesis/evidence/open questions), digest narrative
2. Optional: GraphStore.getEmbedding to activate live embedding-neighbor scorer
3. Optional: drain derived ledger backlog with `--kind=derived` when useful

## Traps

- Web-ui must not reimplement ranking — import `@x-scraper/related` only
- NEVER import better-sqlite3 from web-ui
- related corpus is process-cached ~30s (`invalidateRelatedCache`)
