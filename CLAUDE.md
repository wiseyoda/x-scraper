# x-scraper

Local-first knowledge graph from X.com bookmarks/likes/posts. TypeScript monorepo, surfaces via MCP/CLI/REST + git-tracked Obsidian vault.

Public repo: https://github.com/wiseyoda/x-scraper

## Project structure

```
packages/
  core/          # Zod schemas, frontmatter codec, IDs, URL canonicalization (MERGED via PR #3 once CI green)
  vault/         # Markdown vault, simple-git auto-commit, safeJoin (with PR #3)
  scraper/       # X.com auth + bookmarks fetch (Patchright + GraphQL replay) — MERGED
  queue/         # Durable SQLite job queue + cost ledger (slice/3-queue branch, no PR yet)
  graph/         # Neo4j adapter for bi-temporal knowledge graph (slice/4-graph branch, no PR yet)
docs/            # ARCHITECTURE, ROADMAP, SPIKES, CODING_STANDARDS, CODEX_REVIEW
spikes/          # 1-auth, 2-bookmarks, 3-neo4j, 4-gemini, 5-claude, 6-mcp/-server, 7-readability, verify-keys
```

Read `docs/ARCHITECTURE.md` and `HANDOFF.md` first.

## Commands

```bash
# Setup once
brew install neo4j && brew services start neo4j
# password reset on first run; see ~/.config/x-scraper/.env (chmod 600)
pnpm install

# Per-package build (composite TS project references)
pnpm -F @x-scraper/core build

# Project-wide gates (must pass for CI)
pnpm format          # write
pnpm format:check    # check
pnpm lint
pnpm typecheck
pnpm test            # vitest, 50 tests when slice 2 ships, 67 with slices 3+4
pnpm build           # all packages
pnpm circular        # madge

# Run a spike
pnpm spike spikes/<file>.ts

# Verify env keys (Anthropic, Gemini, OpenAI, Exa, Tavily, Brave)
pnpm spike spikes/verify-keys.ts

# Run integration graph tests against the local Neo4j
RUN_INTEGRATION=1 pnpm test packages/graph

# Codex review at milestones
codex review --base main
```

## Stack (locked)

TypeScript (Node 22+, ESM, pnpm 10) · Patchright (stealth Playwright) · **Neo4j Community 2026.04** (graph + native HNSW + GDS Leiden) · SQLite via better-sqlite3 (queue + cost ledger) · `gemini-embedding-2-preview` (1536 dims via Matryoshka) · Claude Sonnet 4.6 / Haiku 4.5 · `@modelcontextprotocol/sdk` · `@mozilla/readability` · Hono (REST) · Vitest + Playwright (E2E).

## Key constraints

- Markdown vault is canonical; the graph is a derivable index. Vault root: `~/Documents/x-scraper-vault/` (git-tracked, Obsidian-compatible).
- Hexagonal architecture: every package exposes a port (interface); adapters implement it. No business logic depends on a concrete adapter.
- No magic numbers in logic — constants files per package, named with intent. Test fixtures may use literals.
- Zod-validate at every system boundary (scraper output, LLM JSON, MCP/REST input, frontmatter on read).
- LLM defaults: `max_tokens` 16k–32k for extraction, no MIN_ thresholds in schemas, prompt caching on schema/system portion, always check `stop_reason`.
- One feature branch open at a time. Each slice branches off main AFTER the previous slice merges (do NOT stack — see HANDOFF.md for why).
- Codex review at every milestone: spike completion, slice merge, phase tag. Critical findings block merge.

## Environment

- Secrets: `~/.config/x-scraper/.env` (chmod 600). Populated for Anthropic, Gemini, OpenAI, Exa, Tavily, Brave, Neo4j.
- macOS Darwin 25.x, Apple Silicon. Node 24, pnpm 10.28.

## Current status

**Two PRs in flight; PR #3 has a known CI failure that must be the next session's first task.** See HANDOFF.md.
