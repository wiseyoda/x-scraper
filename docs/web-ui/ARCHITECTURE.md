# Architecture — apps/web-ui

System design for the Next.js 15 + shadcn web surface that wraps the
existing x-scraper TypeScript monorepo.

## Position in the monorepo

```
x-scraper/
  packages/
    core, vault, queue, graph, llm, embeddings,
    extractor, reconciler, ingestor, scraper,
    search, community, observability,
    cli, rest, mcp-server, digest
  apps/
    web-ui/        ← new                   (Next.js 15, RSC, Node runtime)
```

`apps/*` is the established home for deployables (already declared in
`pnpm-workspace.yaml`); `packages/*` stays libraries. The web-ui depends
on existing packages via `workspace:*`; nothing in `packages/*` ever
imports from `apps/*`.

## Project structure inside the app

```
apps/web-ui/
  src/
    app/
      layout.tsx                              SidebarProvider; theme
      page.tsx                                redirect to /graph
      (review)/
        graph/
          @graph/page.tsx                     graph canvas (parallel slot)
          @panel/[entityId]/page.tsx          detail pane (parallel slot)
          layout.tsx                          composes the slots
        sources/
          page.tsx                            sources table (RSC)
          [sourceId]/page.tsx                 source detail
        entities/
          page.tsx                            entities table
          [entityId]/page.tsx                 entity detail
        topics/page.tsx                       topic communities
        chat/[sessionId]/page.tsx             agent session view
      api/
        agent/
          route.ts                            POST: run agent (streaming)
          [sessionId]/route.ts                GET: replay a session
        graph/
          cypher/route.ts                     POST: ad-hoc Cypher (read-only)
          subgraph/route.ts                   POST: filtered slice for canvas
        vault/
          [...path]/route.ts                  GET: streamed markdown
    components/
      ui/                                     shadcn primitives (untouched)
      layout/
        app-sidebar.tsx
        header.tsx
        right-drawer.tsx
      domain/
        entity-card.tsx
        claim-row.tsx
        source-row.tsx
        topic-pill.tsx
        cost-badge.tsx
      graph/
        graph-canvas.tsx                      'use client', dynamic import
        graph-controls.tsx                    layout / depth / color-by
        graph-search.tsx
      agent/
        agent-chat.tsx                        useChat
        agent-message.tsx
        tool-call.tsx
        cost-meter.tsx
    features/
      entities/
        queries.ts                            getEntities / getEntity / search
        actions.ts                            mergeEntities / splitEntity / retag
        schema.ts                             zod
        components/...
      sources/
        queries.ts, actions.ts, schema.ts
      claims/queries.ts, actions.ts
      graph/
        queries.ts                            subgraph, neighborhood, traversal
        layout.ts                             ForceAtlas2 worker setup
      agent/
        tools.ts                              tool catalog (read + write)
        runner.ts                             query() loop, hooks, persistence
        sessions.ts                           SQLite persistence layer
      topics/queries.ts
    lib/
      neo4j.ts                                singleton driver (globalThis)
      queue.ts                                singleton SQLite handle
      vault.ts                                MarkdownVault adapter
      auth.ts                                 bearer middleware helper
      env.ts                                  Zod-validated env
      logger.ts                               proxy to @x-scraper/observability
    hooks/
      use-graph-selection.ts
      use-saved-view.ts
      use-cost-ledger.ts
    middleware.ts                             bearer auth gate
  next.config.ts
  package.json
```

Hard rule: dependency flow is one-way `app → features → components → lib`.
`lib/` and `features/*/queries.ts` never import from `components/` or `app/`.

## Runtime model

- **Server Components by default.** Every page in `(review)/` is RSC
  and fetches via `features/*/queries.ts` — direct calls into the
  existing TS packages, no HTTP hop.
- **Server Actions for mutations.** Entity merge, claim retag,
  saved-view persist. Every action is in `features/*/actions.ts`,
  uses Zod for validation, and ends with `revalidatePath()`.
- **Route Handlers for streaming + ad-hoc.** Two cases only:
  1. Agent runs (`POST /api/agent`) — needs `ReadableStream` and
     `runtime = 'nodejs'`, which Server Actions can't promise.
  2. Cypher ad-hoc (`POST /api/graph/cypher`) — used by power-user
     mode for arbitrary read queries; not addressable elsewhere.
- **Client Components only where needed.** Graph canvas, agent chat
  UI, table sort/filter, sidebar collapse. Each is a leaf wrapped in
  `'use client'`; server-rendered shells host them.

## Data flow

### Reads (graph view)

```
Server Component (page.tsx)
  → features/graph/queries.ts → packages/graph (Bolt)
  → returns Graphology export (nodes[] + edges[])
  → passed as prop to <GraphCanvas /> (client)
  → @react-sigma/core renders WebGL
```

### Reads (table)

```
Server Component (sources/page.tsx, params: ?page&sort&q)
  → features/sources/queries.ts → packages/queue + packages/vault
  → returns paginated rows
  → <SourceTable /> (client) renders TanStack Table with manualPagination
```

### Writes (mutation)

```
Client form (RHF + zod) → Server Action (features/entities/actions.ts)
  → packages/graph + packages/vault writes
  → revalidatePath('/entities/[id]') + return result
  → RSC re-renders; client form clears
```

### Agent (read or write)

```
Client (<AgentChat />) → useChat → POST /api/agent
  → features/agent/runner.ts → @anthropic-ai/claude-agent-sdk query()
  → in-process MCP server with tools that call packages/graph,
    packages/vault, packages/cli (for ingest)
  → ReadableStream of events back to useChat
  → SQLite persistence (agent_sessions, agent_tool_calls)
```

## Singletons (hot-reload-safe)

Hot reload in `next dev` re-evaluates modules on every save; without
care this exhausts the Bolt connection pool inside a minute. Anchor
expensive resources on `globalThis`:

```ts
// lib/neo4j.ts
import neo4j, { type Driver } from 'neo4j-driver';
const g = globalThis as unknown as { __xs_neo4j?: Driver };
export const driver =
  g.__xs_neo4j ??
  neo4j.driver(
    env.NEO4J_URI,
    neo4j.auth.basic(env.NEO4J_USER, env.NEO4J_PASSWORD),
  );
if (env.NODE_ENV !== 'production') g.__xs_neo4j = driver;
```

Same shape for `better-sqlite3` (queue) and the Claude `Agent` instance
when reused across requests.

`next.config.ts` declares `serverExternalPackages: ['better-sqlite3',
'neo4j-driver']` so Next doesn't try to bundle native modules, and
`transpilePackages` lists every `@x-scraper/*` workspace dep so source
hot-reload works.

## Auth

- `next dev -H 127.0.0.1` binds the dev server to loopback only — not
  reachable from the LAN.
- `middleware.ts` checks `authorization: Bearer <token>` against
  `XS_WEB_TOKEN` env var on every `/api/*` route.
- `/login` page sets a `xs_token` httpOnly cookie via a Server Action;
  middleware accepts header *or* cookie.
- Mirrors `XSCRAPER_REST_ALLOW_UNAUTH=1` escape hatch from `xs-rest` —
  fail-closed by default.

## Caching posture

Next 15 flipped many caching defaults — the app leans on this and adds
explicit invalidation:

- `fetch()` defaults to no-cache: fine, the app barely uses `fetch`.
- Route handlers default to dynamic: required for streaming.
- Client-side router cache no longer reuses page segments by default:
  reduces stale-data risk on the table pages.
- After every mutation Server Action, call `revalidatePath()` for the
  affected route(s) so the next navigation re-runs the RSC.

## CI integration

Add `apps/web-ui` to:
- `.github/workflows/ci.yml` — already runs `pnpm install`, `pnpm build`,
  `pnpm lint`, `pnpm typecheck`, `pnpm test`. Web-ui adds nothing
  workflow-side; it just gets covered by the existing matrix.
- `tsconfig.json` paths — add `@x-scraper/web-ui` if anything else needs
  to import from it (probably not).
- `eslint.config.js` — extend with Next-specific rules
  (`eslint-config-next`).

## Production gotchas to design around

1. `'use client'` cascade: a client component imported into another
   client component does not re-cross the boundary, but a client
   component imported into an RSC silently makes the entire subtree
   client. Push `'use client'` as deep as possible.
2. Hydration mismatches from `Date`/`Math.random`/`Intl`: render raw
   ISO strings on the server, format inside `useEffect` on the client.
3. Streaming + middleware: middleware that calls `req.json()` consumes
   the body and breaks downstream streaming. The bearer middleware
   must NOT touch the body.
4. better-sqlite3 ABI drift between Node 24 (CI / Homebrew) and other
   versions: pin via `packageManager` field; CI uses `actions/setup-node`
   with `node-version: 24`.
5. Sigma.js / cytoscape touch `window` at import time: always
   `dynamic(() => import(...), { ssr: false })`. Direct import from
   an RSC will crash the server.
