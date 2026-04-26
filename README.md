# x-scraper

A local-first, self-organizing knowledge base built from your X.com bookmarks, likes, and posts. Surfaces learnings via MCP, CLI, REST, and a git-tracked Obsidian-compatible markdown vault.

> Status: Early development. Following a spike-then-slice plan; not yet usable.

## Why

I keep finding things on X.com I want to "explore later" and they pile up unread. This tool ingests every bookmark, follows linked articles / GitHub repos / videos / PDFs, extracts atomic claims into a bi-temporal knowledge graph, auto-organizes into topic clusters, and exposes it all to my Claude/Codex/Gemini coding sessions so the context is one tool call away.

## Design

The whole design is in [`docs/`](./docs):

| Doc                                               | What's in it                                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md)         | Stack choices (Kùzu, Patchright, Gemini embeddings, Claude API), data model, pipelines, MCP tool surface |
| [ROADMAP.md](./docs/ROADMAP.md)                   | Slice-by-slice build plan with codex review checkpoints                                                  |
| [SPIKES.md](./docs/SPIKES.md)                     | Eight risk-reduction spikes that come before any production code                                         |
| [CODING_STANDARDS.md](./docs/CODING_STANDARDS.md) | Lint/format/test rules, hexagonal architecture, no-magic-numbers policy                                  |
| [CODEX_REVIEW.md](./docs/CODEX_REVIEW.md)         | Independent review process at every milestone                                                            |

## Stack

TypeScript monorepo (pnpm) · Node 22+ · Patchright (stealth Playwright) · Kùzu (embedded graph DB) · SQLite (queue) · Gemini embedding-2-preview · Claude Sonnet 4.6 / Haiku 4.5 · `@modelcontextprotocol/sdk` · `@mozilla/readability` · Hono (REST) · Vitest

## Setup (early; will change)

```bash
pnpm install
cp ~/.config/x-scraper/.env.example ~/.config/x-scraper/.env  # if missing
chmod 600 ~/.config/x-scraper/.env
# fill in ANTHROPIC_API_KEY and GEMINI_API_KEY
```

## License

MIT — see [LICENSE](./LICENSE).
