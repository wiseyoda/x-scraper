# Session Handoff

> Updated 2026-07-10 — Phase 4 started (P4.4 done). Web-ui for viewing on :3737.

## Current State

- **Branch:** `main` (ahead of origin; Phase 2–3 skeptic wiring + P4.4 **uncommitted**)
- **Tests:** package suite ~396; web-ui adds pipeline-status + inbox-display + **sync-run-retention** tests
- **Product plan:** Phases 0–3 done; **P4.4 done**; P4.1–P4.3 / P4.5 open
- **Synthesizer:** prompt version **2**. Existing ideas remain v1 bodies until re-synth with `--force`
- **Web-ui:** `http://127.0.0.1:3737` (dev server started for this session)

## What shipped recently

| Area | Surface |
|------|---------|
| Ideas | v2 research-thread; diversity ranking |
| Digest | Theme-forward package + web-ui `/digest` |
| Recall | MCP + CLI related / whats-new / search-ideas |
| Inbox | Real progressive stage + fast primary from ledger |
| **P4.4** | Sync-run log retention under `.xscraper/sync-runs/` (keep 20 / 14d) |

## Ranked next work

1. **#1 Commit** Phase 2–3 + P4.4 dirty tree (stabilize product value)
2. Schedule install (`run-cycle`) — needs your OK (LaunchAgent)
3. Limited v2 re-synth of top ideas (`--force --limit=N`)
4. P4.3 mobile layout
5. P4.1 graph canvas / P4.2 topics / P4.5 likes only if dogfood demands them

Full table: `docs/PRODUCT_PLAN.md` Working log (2026-07-10 Phase 4 start).

## Commands

```bash
# Web-ui
pnpm --filter @x-scraper/web-ui dev   # http://127.0.0.1:3737

/opt/homebrew/bin/node packages/cli/dist/bin.js related idea_8ec95fc7 --vault-only
/opt/homebrew/bin/node packages/cli/dist/bin.js search-ideas --query=claude --limit=10
/opt/homebrew/bin/node packages/cli/dist/bin.js whats-new --limit=10
/opt/homebrew/bin/node packages/cli/dist/bin.js ideas synthesize --force --limit=3
```

## Traps

- v2 idea ids differ from v1 (prompt version in id key)
- Web-ui related is vault-only (no graph embeddings)
- Do not `schedule install` without explicit consent
