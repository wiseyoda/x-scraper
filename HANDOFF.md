# Session Handoff

> Updated 2026-07-10 — Phases 0–3 complete. Product plan at Phase 4 optional.

## Current State

- **Branch:** `main` with local commits through Phase 2–3 work
- **Tests:** ~396 passed / 3 skipped
- **Product plan:** Phases 0–3 done; J1/J2/J3 assessed in PRODUCT_PLAN Working log
- **Synthesizer:** prompt version **2** (research-thread body). Existing ideas remain v1 bodies until re-synth with `--force`

## What shipped (Phases 2–3)

| Area | Surface |
|------|---------|
| Ideas | Structured thesis/evidence/open questions/watch-fors; diversity ranking |
| Digest | Theme-forward markdown with idea ids |
| Recall | MCP `related_to`, `whats_new`, `search_ideas`; CLI mirrors |
| Inbox | Pipeline stage chip; fast primary from payload (unit-tested) |

## Commands

```bash
/opt/homebrew/bin/node packages/cli/dist/bin.js related idea_8ec95fc7 --vault-only
/opt/homebrew/bin/node packages/cli/dist/bin.js search-ideas --query=claude --limit=10
/opt/homebrew/bin/node packages/cli/dist/bin.js whats-new --limit=10
/opt/homebrew/bin/node packages/cli/dist/bin.js ideas synthesize --force --limit=3   # re-draft with v2 (costs LLM)
pnpm --filter @x-scraper/web-ui dev
```

## Next (optional)

1. Re-synthesize high-value ideas with v2 (`ideas synthesize --force`) for research-thread bodies
2. `xs schedule install --mode=run-cycle` for autonomous growth
3. Phase 4 polish if desired

## Traps

- v2 idea ids differ from v1 (prompt version in id key) — force re-synth creates parallel drafts under new ids unless you map carefully; id is `anchor|v{version}`
- Web-ui still uses related vault-only (no graph embeddings)
