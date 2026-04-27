# x-scraper web-ui

Best-in-class personal knowledge-graph review + agentic research app.
Single user, local-first, runs on `localhost`. Wraps the existing
TypeScript monorepo (`xs-mcp`, `xs-rest`, `packages/graph`,
`packages/vault`, `packages/cli`) with a visual interface and a
Claude-powered research agent.

## Why this app exists

The vault + Cypher REPL is too low-bandwidth for routine quality
review of the knowledge graph. By the time the corpus has 1k+ sources
and 10k+ entities, "open Obsidian, click around, run `xs trends`"
stops scaling. The web app gives:

1. **A single visual surface** — graph + tables + detail pane, all
   bound to the same selection state, so seeing what's mentioned with
   what is one click, not a Cypher query.
2. **Read-mode research** — natural-language questions against the
   corpus via a Claude agent that has tool access to the graph + vault.
3. **Write-mode research** — the same agent can fetch new content
   (URLs, repos, X bookmarks the user calls out) and run it through
   the existing ingest pipeline, growing the corpus without a CLI.

Not a multi-user product. Not a public-facing site. Personal review +
research surface for a single curator.

## Tech stack at a glance

| Layer         | Pick                                                                                                         | Reason                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Framework     | Next.js 15 (App Router)                                                                                      | RSC + Server Actions kill the API-route-and-fetch dance for an internal tool. |
| Runtime       | Node                                                                                                         | better-sqlite3 + neo4j-driver + Claude Agent SDK all need Node APIs.          |
| UI primitives | shadcn/ui (`new-york`), Radix, Tailwind 4                                                                    | Standard, ownable code.                                                       |
| Graph viz     | Sigma.js v3 + Graphology + `@react-sigma/core`                                                               | Only library that holds 50k nodes at 60fps and has a real React story.        |
| Tables        | TanStack Table v8 + TanStack Virtual                                                                         | Server-side pagination via search params; virtualization for >200 rows.       |
| Forms         | react-hook-form + Zod (schema reuse with server actions)                                                     | Canonical shadcn pattern.                                                     |
| Streaming     | Vercel AI SDK v5 (`useChat`) for the wire; `@anthropic-ai/claude-agent-sdk` for the agent loop               | AI SDK handles the streaming UX; Agent SDK runs inside a Route Handler.       |
| State         | RSC for reads, Server Actions for writes, TanStack Query for client mutations with optimism only when needed | No Redux, no Zustand, no tRPC.                                                |
| Auth          | Bearer token over localhost (`127.0.0.1` bind + middleware)                                                  | Personal app, no users.                                                       |
| Theme         | `next-themes` + Tailwind dark variants                                                                       | Default dark for late-night curation.                                         |
| Workspace     | `apps/web-ui` in the existing pnpm monorepo                                                                  | `apps/*` already in `pnpm-workspace.yaml`.                                    |

## Layout (planned)

```
+------------+--------------------------------------+----------------+
| Left rail  |                                      | Right drawer   |
| - filters  |          Graph canvas                |                |
| - search   |          (Sigma.js, full-bleed)      |  Tabs:         |
| - color-by |                                      |   • Detail     |
| - views    |                                      |   • Sources    |
|            |                                      |   • Chat       |
+------------+--------------------------------------+----------------+
                       | Bottom drawer (collapsible) |
                       |   Table view of selection   |
```

Selecting in any pane (graph node, table row, chat citation) updates
the others. Graph never re-mounts; layout never re-runs across
selection changes.

## Document index

- [ARCHITECTURE.md](./ARCHITECTURE.md) — System design, package
  layout, data flow, dependency boundaries, CI/lint considerations
  for the new workspace.
- [AGENT_SDK.md](./AGENT_SDK.md) — Read agent, write agent, tool
  catalog, streaming wiring, session persistence, cost ledger,
  anti-patterns.
- [GRAPH_VIS.md](./GRAPH_VIS.md) — Library decision, node program
  design, layout strategy, color/shape encoding, UX patterns to steal
  from Obsidian/Linear/Bloom.
- [COMPONENTS.md](./COMPONENTS.md) — Reusable component inventory:
  shadcn primitives + domain components (`<EntityCard>`, `<ClaimRow>`,
  `<SourceTable>`, `<AgentMessage>`, `<GraphCanvas>`, …).
- [ROADMAP.md](./ROADMAP.md) — Phased build plan (3 phases, ~5–7
  days), milestones, exit criteria, deferred work.

## Non-goals

- Multi-tenant / team collaboration.
- Public deploy. (`next dev -H 127.0.0.1` only.)
- Mobile responsiveness as a first-class concern. Desktop-first; min
  width 1024px. Graceful degradation OK.
- Editing source body content via the UI. Vault remains the
  authoritative store; edits happen in Obsidian and round-trip via git
  pull. The UI can edit _frontmatter_ (tags, topics) and merge/split
  _entities_.
- Replacing `xs-mcp`. The MCP server stays for editor/CLI integration.
  The web UI calls TS modules directly.
