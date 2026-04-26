# x-scraper

Local-first knowledge graph from X.com bookmarks/likes/posts. TypeScript monorepo, surfaces via MCP/CLI/REST + git-tracked Obsidian vault.

Public repo: https://github.com/wiseyoda/x-scraper

## Project structure

```
packages/
  core/           Zod schemas, frontmatter codec, IDs, URL canonicalization
  vault/          Markdown vault, simple-git auto-commit, safeJoin
  scraper/        X.com auth + bookmarks fetch + bot-mitigation primitives
  queue/          Durable SQLite job queue + cost ledger (lease-token-safe)
  graph/          Neo4j adapter for the bi-temporal knowledge graph
  embeddings/     Gemini (primary) + OpenAI (alt) behind EmbeddingProvider
  llm/            Claude Sonnet/Haiku behind LlmProvider with prompt caching
  extractor/      Versioned extraction prompts + Zod-validated output
  reconciler/     ER (vector + LLM judge) + ADD/UPDATE/DELETE/NONE
  ingestor/       article (Readability) + repo (GitHub) + youtube (captions)
  search/         Exa + Tavily + Brave + auto-expand with dedupe
  cli/            xs — init / sync / reindex / status / cost / doctor / auth / mcp / review (zero-dep argv)
  mcp-server/     xs-mcp — search_vault / read_source / queue_status
  rest/           xs-rest — Hono REST mirror with bearer auth
  digest/         Weekly digest + launchd plist builder
  observability/  pino-compatible NDJSON logger + perf timers
  community/      Louvain detector over the Concept subgraph
docs/             ARCHITECTURE, ROADMAP, SPIKES, CODING_STANDARDS, CODEX_REVIEW
spikes/           1-auth, 2-bookmarks, 3-neo4j, 4-gemini, 5-claude, 6-mcp/-server, 7-readability, verify-keys, verify-pdf-ingestor
```

Read `docs/ARCHITECTURE.md` and `HANDOFF.md` first.

## Commands

```bash
# Setup once
brew install neo4j && brew services start neo4j
# password reset on first run; see ~/.config/x-scraper/.env (chmod 600)
pnpm install

# Project-wide gates (must pass for CI)
pnpm format          # write
pnpm format:check    # check
pnpm lint
pnpm typecheck
pnpm test            # vitest, 270 tests across all packages
pnpm build           # all packages
pnpm circular        # madge

# Run a spike
pnpm spike spikes/<file>.ts

# Verify env keys (Anthropic, Gemini, OpenAI, Exa, Tavily, Brave)
pnpm spike spikes/verify-keys.ts

# Run integration graph tests against the local Neo4j
RUN_INTEGRATION=1 pnpm test packages/graph

# Run perf bench tests (opt-in; not in CI by default)
RUN_BENCH=1 pnpm test packages/community packages/reconciler packages/core

# Local CLIs
node packages/cli/dist/bin.js init                                  # creates the vault + queue
node packages/cli/dist/bin.js doctor                                # sanity-checks env + paths
node packages/cli/dist/bin.js sync --urls=https://...,https://...   # ingest pipeline against curated URLs
node packages/cli/dist/bin.js reindex --from-vault                  # rebuild graph from existing markdown
node packages/cli/dist/bin.js status                                # per-status job counts
node packages/cli/dist/bin.js cost                                  # USD spent on LLM/embed since 30d back
node packages/cli/dist/bin.js auth login                            # open authenticated x.com session
node packages/cli/dist/bin.js mcp register --client=claude          # wire xs-mcp into Claude Desktop
node packages/cli/dist/bin.js review                                # list duplicate-name entity candidates

# REST + MCP servers (need vault + queue to exist)
node packages/rest/dist/bin.js          # bearer-protected REST on :7777
node packages/mcp-server/dist/bin.js    # stdio MCP server

# Codex review at milestones
codex review --base main
```

## Stack (locked)

TypeScript (Node 22.13+, ESM, pnpm 10) · Patchright (stealth Playwright) · **Neo4j Community 2026.04** (graph + native HNSW; community detection runs in-JS via graphology Louvain since GDS isn't installed locally) · SQLite via better-sqlite3 (queue + cost ledger) · `gemini-embedding-2-preview` (1536 dims via Matryoshka) · Claude Sonnet 4.6 / Haiku 4.5 · `@modelcontextprotocol/sdk` · `@mozilla/readability` · `pdfjs-dist` · Hono (REST) · Vitest + Playwright (E2E).

## Key constraints

- Markdown vault is canonical; the graph is a derivable index. Vault root: `~/Documents/x-scraper-vault/` (git-tracked, Obsidian-compatible).
- Hexagonal architecture: every package exposes a port (interface); adapters implement it. No business logic depends on a concrete adapter.
- All external JSON is Zod-validated at the boundary. No `as T` casts.
- No magic numbers in logic — constants files per package, named with intent. Test fixtures may use literals.
- LLM defaults: `max_tokens` 16k–32k for extraction, no MIN\_ thresholds in schemas, prompt caching on schema/system portion, always check `stop_reason`.
- One feature branch open at a time. Each slice branches off main AFTER the previous slice merges (do NOT stack).
- Codex review at every milestone: spike completion, slice merge, phase tag. P1/P2 findings block merge.
- Reserved fields (logger time/level/msg, timer label/ms) beat caller data — spread caller fields first.
- Auth fails closed: `xs-rest` refuses to start without a bearer token unless `XSCRAPER_REST_ALLOW_UNAUTH=1`.

## Environment

- Secrets: `~/.config/x-scraper/.env` (chmod 600). Populated for Anthropic, Gemini, OpenAI, Exa, Tavily, Brave, Neo4j.
- macOS Darwin 25.x, Apple Silicon. Node 24, pnpm 10.28.
- HNSW vector index `claim_embed_idx` lives at 1536 dims in production. The graph package's runtime guard refuses to bind to a drift-mismatched index — change dims by dropping the index first.
