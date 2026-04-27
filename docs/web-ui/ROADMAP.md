# Roadmap — apps/web-ui

Three phases, ~5–7 days of build time end-to-end. Each phase ships a
usable surface; deferred work is enumerated up front so we don't
over-scope.

## Phase 0 — Project scaffolding (½ day)

**Exit criteria:** `pnpm dev --filter @x-scraper/web-ui` boots, shows
a placeholder page on `localhost:3000`, can read from Neo4j and the
queue, has shadcn primitives installed and Tailwind 4 configured.

Tasks:

- Create `apps/web-ui/` Next.js 15 app via `pnpm dlx create-next-app@latest --typescript --tailwind --app --src-dir --no-eslint`. Use eslint flat config from the repo's existing setup.
- Add to `pnpm-workspace.yaml`. Already covered by `apps/*`.
- Add workspace deps: `@x-scraper/core`, `@x-scraper/graph`, `@x-scraper/vault`, `@x-scraper/queue`, `@x-scraper/llm`, `@x-scraper/embeddings`, `@x-scraper/extractor`, `@x-scraper/reconciler`, `@x-scraper/ingestor`, `@x-scraper/community`, `@x-scraper/observability`.
- Configure `next.config.ts`:
  - `transpilePackages: ['@x-scraper/*']`
  - `serverExternalPackages: ['better-sqlite3', 'neo4j-driver']`
  - `experimental.externalDir: true`
- Install shadcn primitives: `pnpm dlx shadcn@latest init` (new-york), then add the day-1 set from COMPONENTS.md.
- `lib/neo4j.ts` + `lib/queue.ts` + `lib/vault.ts` singletons (globalThis-anchored).
- `lib/env.ts` — Zod-validate env vars.
- `middleware.ts` — bearer + cookie auth.
- `app/layout.tsx` — `<SidebarProvider>`, `<ThemeProvider>`, sonner.
- `app/page.tsx` — redirects to `/graph`.
- Smoke test: `localhost:3000` shows placeholder.

## Phase 1 — Read surface (1.5 days)

**Exit criteria:** Can browse sources, entities, topics. Can search.
Sources/entities tables paginate. Detail pages render full content.
Read-mode agent chat works against the corpus and renders citations.

### 1a. Sidebar shell

- `<AppSidebar />` with nav items.
- `app/layout.tsx` mounts the shell; route group `(review)/`.
- Header with breadcrumb + cmdk command palette.

### 1b. Sources / Entities / Claims tables

- `app/(review)/sources/page.tsx` — RSC, server-side pagination via
  search params. `getSources({page, sort, q})` from
  `features/sources/queries.ts`.
- `<SourceTable />` — client, TanStack Table, manualPagination.
- Same shape for `/entities` and `/claims`.

### 1c. Detail pages

- `app/(review)/sources/[id]/page.tsx` — RSC, fetches Source via
  `vault.read`, renders frontmatter + body + extracted claims +
  mentioned entities. `<EntityCard>` rows for entities, `<ClaimRow>`
  for claims.
- `app/(review)/entities/[id]/page.tsx` — RSC, fetches Entity via
  vault + sources backlink graph traversal. Tabs: Overview, Claims
  about, Mentioned in.
- `app/(review)/topics/[id]/page.tsx` — topic + member list + a
  small embedded graph (Phase 2 actually renders the embedded
  graph; Phase 1 just lists members).

### 1d. Read-mode agent chat

- `app/(review)/chat/page.tsx` — fresh chat surface.
- `app/(review)/chat/[sessionId]/page.tsx` — replay an existing
  session.
- `<AgentChat mode="read" />` with the read-tool catalog.
- `app/api/agent/route.ts` POST handler with streaming.
- `features/agent/runner.ts` — `query()` loop, tool catalog,
  session persistence to SQLite.
- `features/agent/sessions.ts` — read/write `agent_sessions` and
  `agent_tool_calls` tables.
- `<CitationChip>` resolves `[[src_X]]` to source detail navigation.

Phase 1 ships a usable curation surface even without the graph
canvas. The chat can answer "what did we ingest about X" purely from
tables + chat.

## Phase 2 — Graph visualization (2 days)

**Exit criteria:** Sigma canvas renders 5–50k nodes at 60fps. Click,
hover, search, color-by, focus mode all work. Right drawer detail
pane is bound to selection. Topic halo overlay renders.

### 2a. Subgraph endpoint

- `features/graph/queries.ts` — `getInitialSubgraph()`, returns
  Graphology-serialized form with top-N nodes by degree + their
  1-hop neighbors.
- `app/api/graph/subgraph/route.ts` — POST: filtered subgraph for
  ad-hoc filter changes that need server-side recomputation
  (otherwise filters are pure client reducer state).

### 2b. Canvas component

- `<GraphCanvas />` mounting `<SigmaContainer>`.
- `<GraphLayoutController>` running ForceAtlas2 in a Web Worker.
- `<GraphReducerSync>` wiring filter UI to Sigma's nodeReducer.
- `<GraphHoverCard>` + `<GraphSelectionSync>`.

### 2c. URL state

- `useGraphSelection()` hook + `useSavedView()` codec.
- Right drawer's Detail/Sources tabs read selection from URL.

### 2d. Controls

- `<GraphControls />` (layout, depth, color-by, save view).
- `<GraphSearch />` in left rail.
- Save view → small SQLite table.

### 2e. Topic halo overlay

- `<TopicHaloLayer />` underlay canvas; redraws when layout settles.
- Color palette frozen to Tailwind tokens.

### 2f. Parallel routes for graph + panel

- `app/(review)/graph/@graph/page.tsx` (canvas).
- `app/(review)/graph/@panel/[entityId]/page.tsx` (detail).
- `app/(review)/graph/layout.tsx` composes both.
- Clicking a node soft-navigates the panel slot; canvas doesn't re-mount.

## Phase 3 — Write flow + saved views + polish (1.5 days)

**Exit criteria:** Write-mode agent can ingest URLs and report results. Entity merge / split works from the UI. Saved views can be named and recalled. Cost dashboard shows totals.

### 3a. Write-mode agent

- Extend `features/agent/tools.ts` with `ingest_url`, `merge_entities`, `retag_source`, `fetch_web_text`, `search_web`.
- `<AgentChat mode="write" />` variant with the larger budget.
- PreToolUse hook for confirmation dialogs on destructive tools.
- `revalidateTag()` calls after each successful ingest.

### 3b. Entity merge UI

- `<EntityMergeForm />` with preview-then-confirm.
- `mergeEntities` Server Action; vault git commit per merge.
- Wire "merge with…" action into `<EntityCard>`.

### 3c. New ingest form

- `<NewIngestForm />` page at `/sources/new`.
- Submit triggers `runAdHocSync` Server Action; streams stage progress to a `<JobProgress />` component.

### 3d. Cost dashboard

- `app/(review)/cost/page.tsx` — RSC pulling from `cost_ledger` and `agent_sessions`.
- Charts via Recharts: per-day spend, per-model breakdown, per-stage breakdown, top-cost entries.

### 3e. Polish

- Keyboard shortcuts: Cmd-K (cmdk), Cmd-J (toggle bottom drawer), Esc (close drawer / exit focus mode), `/` (focus search).
- Empty states for every list page (icon + message + CTA).
- Loading skeletons via shadcn's `<Skeleton>`.
- Error boundaries — `error.tsx` files per route group with retry buttons.
- Dark mode default; light mode tested.

## Deferred (out of scope this week)

- Mobile responsiveness beyond "doesn't break".
- Multi-user / SSO / Auth.js.
- Public deploy / hosting.
- Editing source body content via UI.
- Timeline scrubber animating graph by `valid_at`.
- Drag-to-pin curation mode.
- Export-as-PNG of graph view.
- A `<Storybook>` setup.
- An admin "rebuild graph" UI (CLI is fine for that).
- Internationalization.
- Analytics / telemetry.
- A11y beyond "shadcn defaults". (shadcn's defaults are decent — Radix
  primitives are accessible by construction — but we won't audit.)

## Dependency order

```
Phase 0 (scaffold) → Phase 1 (RSC reads + chat)
                  ↘
                    Phase 2 (graph viz)  →  Phase 3 (write flow + polish)
```

Phase 1 and Phase 2 can interleave once the scaffold is up — graph
canvas is independent of tables. But the read-mode chat in Phase 1
gets value from existing CLI data immediately, so it's the
higher-leverage starting point.

## Verification gates per phase

- **Phase 0**: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`
  all pass on the new app. Local boot succeeds. CI green.
- **Phase 1**: All read pages render against the live corpus
  (currently ~200 sources after the ramp). Chat answers a sample
  question with at least one citation. Tables paginate cleanly.
- **Phase 2**: Graph renders the live corpus at 60fps. Filter / focus
  / search round-trip via URL state. Topic halos visible. No SSR
  crashes.
- **Phase 3**: A live `ingest_url` write run lands a new Source in
  the corpus and the dashboard reflects the cost. Entity merge
  actually changes graph + vault state. Cost dashboard matches
  `xs cost --by-entry` totals.

## After "this week"

The deferred list becomes the next backlog. Likely top-of-list:

- Timeline scrubber (because by then the corpus has 6+ months of
  bi-temporal data and the value is high).
- Curation mode (drag-to-pin, edit topic membership manually).
- Public read-only share view (single-source-of-truth viewer for
  collaborators, no agent access).

Run `flow.review` against the merged-to-main code at end of each
phase. Codex review at every phase merge. PR to main per phase, not
per task.
