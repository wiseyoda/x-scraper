# x-scraper

A local-first, self-organizing knowledge base built from your X.com bookmarks, likes, and posts. Surfaces learnings via MCP, CLI, REST, and a git-tracked Obsidian-compatible markdown vault.

> Status: 16 of 18 roadmap slices merged. Every component the architecture needs is in place; the remaining work is wiring `xs sync` into a runnable end-to-end orchestration. See [HANDOFF.md](./HANDOFF.md).

## Why

I keep finding things on X.com I want to "explore later" and they pile up unread. This tool ingests every bookmark, follows linked articles / GitHub repos / videos / PDFs, extracts atomic claims into a bi-temporal knowledge graph, auto-organizes into topic clusters, and exposes it all to my Claude/Codex/Gemini coding sessions so the context is one tool call away.

## Packages

| Package         | What it is                                                     |
| --------------- | -------------------------------------------------------------- |
| `core`          | Zod schemas, frontmatter codec, IDs, URL canonicalization      |
| `vault`         | Markdown vault, simple-git auto-commit, safeJoin               |
| `scraper`       | X.com auth + bookmarks fetch + bot-mitigation primitives       |
| `queue`         | Durable SQLite job queue + cost ledger (lease-token-safe)      |
| `graph`         | Neo4j adapter for the bi-temporal knowledge graph              |
| `embeddings`    | Gemini (primary) + OpenAI (alt) behind `EmbeddingProvider`     |
| `llm`           | Claude Sonnet/Haiku behind `LlmProvider` with prompt caching   |
| `extractor`     | Versioned extraction prompts + Zod-validated output            |
| `reconciler`    | ER (vector + LLM judge) + ADD/UPDATE/DELETE/NONE               |
| `ingestor`      | article (Readability) + repo (GitHub) + youtube (captions)     |
| `search`        | Exa + Tavily + Brave + auto-expand with dedupe                 |
| `cli`           | `xs` — init / status / cost / doctor (zero-dep argv)           |
| `mcp-server`    | `xs-mcp` — search_vault / read_source / queue_status           |
| `rest`          | `xs-rest` — Hono REST mirror with bearer auth (fail-closed)    |
| `digest`        | Weekly digest + launchd plist builder                          |
| `observability` | NDJSON logger + perf timers (zero-dep, pino-compatible output) |

## Design

The full design lives in [`docs/`](./docs):

| Doc                                               | What's in it                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md)         | Stack choices, data model, pipelines, MCP tool surface, Kùzu→Neo4j pivot history |
| [ROADMAP.md](./docs/ROADMAP.md)                   | Slice-by-slice build plan with codex review checkpoints                          |
| [SPIKES.md](./docs/SPIKES.md)                     | Eight risk-reduction spikes that came before any production code                 |
| [CODING_STANDARDS.md](./docs/CODING_STANDARDS.md) | Lint/format/test rules, hexagonal architecture, no-magic-numbers policy          |
| [CODEX_REVIEW.md](./docs/CODEX_REVIEW.md)         | Independent review process at every milestone                                    |

## Stack

TypeScript monorepo (pnpm 10) · Node 22+ · Patchright (stealth Playwright) · **Neo4j Community 2026.04** (graph + native HNSW + GDS Leiden) · SQLite via better-sqlite3 (queue) · Gemini `embedding-2-preview` (1536 dims via Matryoshka) · Claude Sonnet 4.6 / Haiku 4.5 · `@modelcontextprotocol/sdk` · `@mozilla/readability` · Hono (REST) · Vitest

## Setup

```bash
brew install neo4j && brew services start neo4j
mkdir -p ~/.config/x-scraper
$EDITOR ~/.config/x-scraper/.env       # add ANTHROPIC_API_KEY, GEMINI_API_KEY,
                                       # NEO4J_*, optionally OPENAI/EXA/TAVILY/BRAVE,
                                       # plus XSCRAPER_REST_TOKEN for the REST API
chmod 600 ~/.config/x-scraper/.env

pnpm install
pnpm typecheck && pnpm lint && pnpm test  # 270 tests across all packages
pnpm build                                # builds every package
```

## Quickstart (after build)

```bash
# Create the vault and the SQLite queue (~/Documents/x-scraper-vault and
# ~/.config/x-scraper/queue.sqlite by default — override with XSCRAPER_VAULT
# and XSCRAPER_QUEUE).
node packages/cli/dist/bin.js init
node packages/cli/dist/bin.js doctor

# Ingest a curated list of URLs end-to-end (real Neo4j + Gemini + Claude):
node packages/cli/dist/bin.js sync --urls=https://arxiv.org/pdf/1706.03762.pdf --limit=1
#   sync run_xxx: enqueued=1 done=1 dead=0 failed=0 cost=$0.18 duration=132s

# Rebuild the graph from existing vault markdown (no re-fetch, no re-write):
node packages/cli/dist/bin.js reindex --from-vault

# Wire xs-mcp into Claude Desktop's MCP config:
node packages/cli/dist/bin.js mcp register --client=claude

# Open an authenticated x.com session (for the future bookmark-scraper path):
node packages/cli/dist/bin.js auth login

# Run the MCP server (stdio) so Claude Code / Codex / Gemini can search
# the vault directly:
node packages/mcp-server/dist/bin.js

# Or run the localhost REST mirror (bearer-protected):
XSCRAPER_REST_TOKEN=secret node packages/rest/dist/bin.js
curl -H 'authorization: Bearer secret' 'http://127.0.0.1:7777/search?q=neo4j'
```

See [HANDOFF.md](./HANDOFF.md) for the deferred follow-ups (CI bench wiring,
`xs topic detect`, slice 11 auto-expand integration, live X.com verification
of likes/posts).

## License

MIT — see [LICENSE](./LICENSE).
