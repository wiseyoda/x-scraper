# x-scraper

Local-first knowledge graph from X.com bookmarks/likes/posts. TypeScript monorepo, surfaces via MCP/CLI/REST + git-tracked Obsidian vault + a Next.js review UI.

Public repo: https://github.com/wiseyoda/x-scraper

## Project structure

```
packages/
  core/           Zod schemas, frontmatter codec (incl. Idea), IDs, URL canonicalization
  vault/          Markdown vault, simple-git auto-commit, safeJoin
  scraper/        X.com auth + bookmarks fetch + bot-mitigation primitives
  queue/          Durable SQLite job queue + cost ledger
  graph/          Neo4j adapter (incl. cross-type surface lookup for entity dedup)
  embeddings/     Gemini (primary) + OpenAI (alt) behind EmbeddingProvider
  llm/            Claude Sonnet/Haiku behind LlmProvider with prompt caching
  extractor/      Versioned extraction prompts (currently v3) + Zod-validated output
  reconciler/     ER (vector + LLM judge + cross-type surface match) + ADD/UPDATE/DELETE/NONE
  ingestor/       Article (Readability) + Repo (GitHub) + YouTube (captions) + PDF + X-Article (Patchright)
  capture/        NEW. Content-addressed raw cache. Captors per content_type. Phase A of two-phase pipeline.
  synthesizer/    NEW. L0 claim → L1 idea promotion. Cluster by entity, draft via Sonnet, persist with provenance.
  search/         Exa + Tavily + Brave + auto-expand with dedupe
  cli/            xs — init / sync / refine / reindex / status / cost / doctor / auth / bookmarks / topic / ideas / schedule / mcp / review
  mcp-server/     xs-mcp — search_vault / read_source / queue_status
  rest/           xs-rest — Hono REST mirror with bearer auth
  digest/         Weekly digest + launchd plist builder
  observability/  pino-compatible NDJSON logger + perf timers
  community/      Louvain detector over the Concept subgraph
apps/
  web-ui/         NEW. Next.js 15 + Tailwind 4 review surface (port 3737, /ideas).
docs/             ARCHITECTURE, ROADMAP, SPIKES, CODING_STANDARDS, CODEX_REVIEW, web-ui/
```

Read `HANDOFF.md` first.

## Commands

```bash
# Setup once
brew install neo4j && brew services start neo4j
pnpm install

# Project-wide gates (must pass for CI)
pnpm format          # write
pnpm format:check    # check
pnpm lint
pnpm typecheck
pnpm test            # vitest, 352 tests across all packages
pnpm build           # all packages
pnpm circular        # madge

# Run a spike
pnpm spike spikes/<file>.ts

# Verify env keys (Anthropic, Gemini, OpenAI, Exa, Tavily, Brave)
pnpm spike spikes/verify-keys.ts

# Run integration graph tests against the local Neo4j
RUN_INTEGRATION=1 pnpm test packages/graph

# Local CLIs — invoke via /opt/homebrew/bin/node (matches better-sqlite3 ABI)
/opt/homebrew/bin/node packages/cli/dist/bin.js init                                  # creates vault + queue
node packages/cli/dist/bin.js doctor                                # sanity-checks env + paths
node packages/cli/dist/bin.js sync --urls=https://...,https://...   # capture+extract pipeline against curated URLs
node packages/cli/dist/bin.js refine [--content-type=KIND] [--limit=N]  # re-run extraction over cache (offline, no network)
node packages/cli/dist/bin.js reindex --from-vault                  # rebuild graph from existing markdown
node packages/cli/dist/bin.js status                                # per-status job counts
node packages/cli/dist/bin.js cost [--by-entry] [--top=N]           # USD spent on LLM/embed since 30d back
node packages/cli/dist/bin.js auth login                            # open authenticated x.com session
node packages/cli/dist/bin.js bookmarks pull --max=200              # populate bookmark_ledger from x.com
node packages/cli/dist/bin.js bookmarks sync --order=oldest --limit=N  # run pipeline against ledger rows
node packages/cli/dist/bin.js topic detect --synthesize             # Louvain communities + Sonnet titles → Topic.md
node packages/cli/dist/bin.js ideas synthesize [--limit=N] [--force]  # cluster claims, draft L1 ideas via Sonnet
node packages/cli/dist/bin.js ideas list [--status=draft|confirmed|rejected]
node packages/cli/dist/bin.js ideas show <id>
node packages/cli/dist/bin.js ideas confirm <id>
node packages/cli/dist/bin.js ideas reject <id>
node packages/cli/dist/bin.js schedule install --interval=3600      # launchd plist for hourly bookmarks sync
node packages/cli/dist/bin.js mcp register --client=claude          # wire xs-mcp into Claude Desktop
node packages/cli/dist/bin.js review                                # list duplicate-name entity candidates
node packages/cli/dist/bin.js trends [--top=N] [--format=table|json]

# REST + MCP servers (need vault + queue to exist)
node packages/rest/dist/bin.js          # bearer-protected REST on :7777
node packages/mcp-server/dist/bin.js    # stdio MCP server

# Web-UI (review surface for L1 ideas; port 3737)
pnpm --filter @x-scraper/web-ui dev
pnpm --filter @x-scraper/web-ui build && pnpm --filter @x-scraper/web-ui start

# Codex review at milestones
codex review --base main
```

## Stack (locked)

TypeScript (Node 22.13+, ESM, pnpm 10) · Patchright (stealth Playwright) · **Neo4j Community 2026.04** (graph + native HNSW; Louvain via graphology in-JS) · SQLite via better-sqlite3 (queue + cost ledger) · `gemini-embedding-2-preview` (1536 dims via Matryoshka) · Claude Sonnet 4.6 / Haiku 4.5 · `@modelcontextprotocol/sdk` · `@mozilla/readability` · `pdfjs-dist` · Hono (REST) · Next.js 15 + React 19 + Tailwind 4 (web-ui) · Vitest + Playwright (E2E).

## Key constraints

- **Two-phase pipeline.** Capture (network) and refine (LLM) are separate phases. Captors write raw artifacts to `<vault>/.cache/raw/<sha256>.json` (gitignored). `xs refine` re-runs extraction over the cache without network — new prompt versions retroactively improve the corpus for $0 in network cost.
- **Markdown vault is canonical.** Vault root: `~/x-scraper-vault/` (git-tracked, Obsidian-compatible). Default `~/x-scraper-vault` since session 6 (avoids iCloud Drive sync conflicts under `~/Documents`). `xs doctor` warns if the vault realpath lands inside iCloud.
- **Knowledge tiers.** L0 = Claim, L1 = Idea (synthesized cluster of L0 claims). EDGE_TYPES reserves `SYNTHESIZED_FROM` (idea→claim) and `PROMOTES` (entity→idea, future L1→L2). The synthesizer is the sole writer of Idea nodes; the extractor explicitly excludes Idea from its enum.
- **Cluster by entity, not by subject.** The synthesizer matches each entity's name+aliases (loose-equality: NFKC + lowercase + whitespace/hyphen/underscore collapse) against every claim's normalized subject AND object. Admission threshold: ≥3 claims AND ≥2 distinct sources. Idea id stable on (anchor, prompt-version) so re-syntheses update the existing record.
- **Hexagonal architecture.** Every package exposes a port; adapters implement it. No business logic depends on a concrete adapter.
- **All external JSON is Zod-validated** at the boundary. No `as T` casts.
- **No magic numbers in logic** — constants files per package. Test fixtures may use literals.
- **LLM defaults:** `max_tokens` 16k–32k for extraction, no MIN\_ thresholds, prompt caching on schema/system, always check `stop_reason`. **Extractor at v3** (`packages/extractor/src/prompts/extraction-v3.ts`): 5–15 substantive claims per source, subject MUST be display-form entity name, organizations are Tool not Person. Bump `EXTRACTION_PROMPT_VERSION` and add a sibling file when changing rules; never edit a published version in place.
- **Cross-type entity merge** in reconciler: when a Person/Tool/Concept candidate's surface form matches an existing entity of a different type in {Person, Tool, Concept}, merge into the existing record preserving its label. URL-anchored types (Source/Article/Tweet/Video/PDF/Repo) stay strictly type-scoped.
- One feature branch open at a time — slices branch off main AFTER previous merges (don't stack).
- Codex review at every milestone: spike completion, slice merge, phase tag. P1/P2 findings block merge. Run in a worktree; stream log to `.repostat/codex-review/` (gitignored).
- CI must build before lint — typescript-eslint's projectService resolves cross-package types via `dist/index.d.ts`.
- Reserved fields (logger time/level/msg, timer label/ms) beat caller data — spread caller fields first.
- Auth fails closed: `xs-rest` refuses to start without a bearer token unless `XSCRAPER_REST_ALLOW_UNAUTH=1`.
- **Neo4j test-pollution prevention**: any spike or test that writes to live Neo4j MUST prefix every node id with `xs_int_test_` (integration tests) or `xs_spike<N>_` (spikes), and DETACH DELETE its prefixed nodes in `afterAll` / `finally`.
- **Web-ui excluded from workspace lint/typecheck.** Next has its own passes via `next build` and per-package `tsc`. The strict-type-checked profile we apply to packages conflicts with RSC/JSX patterns.

## Environment

- Secrets: `~/.config/x-scraper/.env` (chmod 600). Anthropic, Gemini, OpenAI, Exa, Tavily, Brave, Neo4j.
- macOS Darwin 25.x, Apple Silicon. **Two Node binaries**: shell `node` is nvm Node 24.13 (NODE_MODULE_VERSION 137); `pnpm exec node` and `/opt/homebrew/bin/node` are Homebrew Node 25.9 (141). Always invoke production CLI via `/opt/homebrew/bin/node packages/cli/dist/bin.js …` to match better-sqlite3's ABI.
- HNSW `claim_embed_idx` and `entity_embed_idx` live at 1536 dims in production. The graph package's runtime guard refuses to bind to a drift-mismatched index — change dims by dropping the index first.
- Web-ui defaults to vault `~/x-scraper-vault`; override via `XSCRAPER_VAULT` env var.

## Current status

Session 8 reshape: capture/refine split + L0→L1 synthesizer + Next.js review UI shipped. Live corpus: 304 sources, 1,261 claims, 391 entities, 16 draft Ideas. 352 tests passing. Six commits on main since session 7 handoff.
