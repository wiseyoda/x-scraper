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
  cli/            xs — init / sync / reindex / status / cost / doctor / auth / bookmarks / topic / schedule / mcp / review (zero-dep argv)
  mcp-server/     xs-mcp — search_vault / read_source / queue_status
  rest/           xs-rest — Hono REST mirror with bearer auth
  digest/         Weekly digest + launchd plist builder
  observability/  pino-compatible NDJSON logger + perf timers
  community/      Louvain detector over the Concept subgraph
docs/             ARCHITECTURE, ROADMAP, SPIKES, CODING_STANDARDS, CODEX_REVIEW
spikes/           1-auth, 2-bookmarks, 3-neo4j, 4-gemini, 5-claude, 6-mcp/-server, 7-readability, verify-keys, verify-pdf-ingestor
```

Read `HANDOFF.md`, `docs/ARCHITECTURE.md`, and `docs/web-ui/README.md` (planned `apps/web-ui` build) first.

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
pnpm test            # vitest, 332 tests across all packages
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

# Local CLIs — invoke via /opt/homebrew/bin/node (matches better-sqlite3 ABI)
/opt/homebrew/bin/node packages/cli/dist/bin.js init                                  # creates the vault + queue
node packages/cli/dist/bin.js doctor                                # sanity-checks env + paths
node packages/cli/dist/bin.js sync --urls=https://...,https://...   # ingest pipeline against curated URLs
node packages/cli/dist/bin.js reindex --from-vault                  # rebuild graph from existing markdown
node packages/cli/dist/bin.js status                                # per-status job counts
node packages/cli/dist/bin.js cost                                  # USD spent on LLM/embed since 30d back
node packages/cli/dist/bin.js auth login                            # open authenticated x.com session
node packages/cli/dist/bin.js bookmarks pull --max=200               # populate bookmark_ledger from x.com (also --source=likes|posts)
node packages/cli/dist/bin.js bookmarks sync --order=oldest --limit=N # run pipeline against ledger rows one-at-a-time
node packages/cli/dist/bin.js topic detect --synthesize              # Louvain communities + Sonnet titles → Topic.md
node packages/cli/dist/bin.js schedule install --interval=3600       # launchd plist that runs xs bookmarks sync hourly
node packages/cli/dist/bin.js mcp register --client=claude          # wire xs-mcp into Claude Desktop
node packages/cli/dist/bin.js review                                # list duplicate-name entity candidates
node packages/cli/dist/bin.js trends [--top=N] [--format=table|json] # top entities/concepts/predicates/edge counts
node packages/cli/dist/bin.js cost --by-entry --top=20              # most expensive bookmarks (T22)

# REST + MCP servers (need vault + queue to exist)
node packages/rest/dist/bin.js          # bearer-protected REST on :7777
node packages/mcp-server/dist/bin.js    # stdio MCP server

# Codex review at milestones
codex review --base main
```

## Stack (locked)

TypeScript (Node 22.13+, ESM, pnpm 10) · Patchright (stealth Playwright) · **Neo4j Community 2026.04** (graph + native HNSW; community detection runs in-JS via graphology Louvain since GDS isn't installed locally) · SQLite via better-sqlite3 (queue + cost ledger) · `gemini-embedding-2-preview` (1536 dims via Matryoshka) · Claude Sonnet 4.6 / Haiku 4.5 · `@modelcontextprotocol/sdk` · `@mozilla/readability` · `pdfjs-dist` · Hono (REST) · Vitest + Playwright (E2E).

## Key constraints

- Markdown vault is canonical; the graph is a derivable index. Vault root: `~/x-scraper-vault/` (git-tracked, Obsidian-compatible). Default changed in session 6 — `~/Documents` is iCloud-synced on this Mac and was creating `topics 2/` ghost dirs. `xs doctor` warns if the configured vault realpath lands inside iCloud.
- Hexagonal architecture: every package exposes a port (interface); adapters implement it. No business logic depends on a concrete adapter.
- All external JSON is Zod-validated at the boundary. No `as T` casts.
- No magic numbers in logic — constants files per package, named with intent. Test fixtures may use literals.
- LLM defaults: `max_tokens` 16k–32k for extraction, no MIN\_ thresholds in schemas, prompt caching on schema/system portion, always check `stop_reason`. **Extractor prompt is at v2** (`packages/extractor/src/prompts/extraction-v2.ts`) — Repo requires github URL, Article requires non-tweet http URL, Video requires youtube URL, PDF requires .pdf URL; otherwise classify Concept/Tool. Bump `EXTRACTION_PROMPT_VERSION` in `constants.ts` and add a sibling file when changing rules; never edit a published version in place.
- One feature branch open at a time. Each slice branches off main AFTER the previous slice merges (do NOT stack).
- Codex review at every milestone: spike completion, slice merge, phase tag. P1/P2 findings block merge. Run in a worktree (`/Users/ppatterson/Working/x-scraper-codex-review`, recreate via `git worktree add`) and stream the log to `.repostat/codex-review/` (gitignored).
- CI must build before lint — typescript-eslint's projectService resolves cross-package types via `dist/index.d.ts`; lint will false-positive on cross-package imports without a fresh build.
- Reserved fields (logger time/level/msg, timer label/ms) beat caller data — spread caller fields first.
- Auth fails closed: `xs-rest` refuses to start without a bearer token unless `XSCRAPER_REST_ALLOW_UNAUTH=1`.
- **Neo4j test-pollution prevention**: any spike or test that writes to the live Neo4j MUST prefix every node id with `xs_int_test_` (integration tests) or `xs_spike<N>_` (spikes), and DETACH DELETE its prefixed nodes in `afterAll` / `finally`. Spikes that need to wipe the DB MUST first refuse-if-populated by counting non-prefixed nodes (see `spikes/3-neo4j.ts:refuseIfDbIsPopulated`). Canonical pattern: `packages/graph/src/__tests__/neo4j-store.integration.test.ts`.

## Environment

- Secrets: `~/.config/x-scraper/.env` (chmod 600). Populated for Anthropic, Gemini, OpenAI, Exa, Tavily, Brave, Neo4j.
- macOS Darwin 25.x, Apple Silicon. **Two Node binaries on this machine**: shell `node` is nvm-managed Node 24.13 (NODE_MODULE_VERSION 137); `pnpm exec node` and `/opt/homebrew/bin/node` are Homebrew Node 25.9 (141). pnpm/vitest run under Node 25, so always invoke production CLI via `/opt/homebrew/bin/node packages/cli/dist/bin.js …` to match the better-sqlite3 binary that vitest expects.
- HNSW vector index `claim_embed_idx` lives at 1536 dims in production. The graph package's runtime guard refuses to bind to a drift-mismatched index — change dims by dropping the index first.
