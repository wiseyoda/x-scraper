# Component inventory

The web app's component tree, organized by abstraction level.
shadcn/ui primitives stay untouched; everything domain-specific is a
purpose-built composition.

## Three-tier rule

```
shadcn/ui primitives (components/ui/*)         ← never modified
       ↑ composed by
domain components (components/domain/*)        ← reusable across pages
       ↑ composed by
page sections (components/{layout,graph,agent}/* + features/*/components)
```

Hard rule: don't wrap a primitive without adding domain meaning.
`<MyButton>` that just forwards `<Button>` props is dead code. Wrap
when ≥2 callsites need the same shape AND the wrapper holds context
the primitive doesn't.

## shadcn/ui primitives we'll install (`new-york` style)

Day-1 install via `npx shadcn@latest add`:

- `button`, `card`, `badge`, `input`, `label`, `textarea`, `form`
- `select`, `combobox`, `command` (cmdk)
- `dialog`, `sheet`, `drawer`, `popover`, `hover-card`, `tooltip`
- `tabs`, `accordion`, `collapsible`
- `table` (the headless one — TanStack Table builds on it)
- `skeleton`, `progress`, `slider`, `switch`, `separator`
- `sidebar` (the Oct 2024 release with `SidebarProvider` cookie persistence)
- `sonner` (toast)
- `dropdown-menu`, `context-menu`, `menubar`
- `breadcrumb`, `pagination`
- `scroll-area`
- `avatar`

Skip: `calendar`/`date-picker` (not needed Phase 1), `carousel`,
`navigation-menu` (overkill for a sidebar app).

## Domain components (`components/domain/`)

Reusable across multiple pages. Each one composes 2+ primitives and
encodes graph/vault semantics.

### `<EntityCard entity actions />`

Renders an entity for any list/grid context. Composes `Card`, `Badge`
(for type), `HoverCard` (for full body preview on hover), `Button`
(for actions like "merge", "view in graph"). Variants:

- `compact` — single line, type icon + name + degree. For sidebar
  search results.
- `default` — card with name, type badge, alias chips, source count,
  last mentioned. For lists.
- `expanded` — card + claim list + first 3 source backlinks. For the
  detail drawer.

```tsx
<EntityCard entity={e} variant="default" actions={['merge', 'pin']} />
```

### `<ClaimRow claim source? />`

A single claim row showing subject • predicate • object as a
visually-parsed triplet, plus confidence as a `Progress` bar, plus a
source pill if present. Used in:

- the source detail page (all claims from this source)
- the entity detail page (all claims about this entity)
- the agent chat tool-call rendering (when a tool returns claims)

### `<SourceRow source />`

Single source row for tables. Shows: type icon, title, byline,
captured_at, claim count, mentions count. Click → push
`/sources/[id]`.

### `<ClaimTriplet subject predicate object />`

Just the triplet, no metadata. For inline rendering inside agent
chat messages or hover cards. Subject/object link to entity pages.

### `<TopicPill topic />`

Pill showing topic name + member count + community color. Click
opens topic page with member list.

### `<CostBadge cost />`

Renders a USD cost in a colored badge: green ($<0.01), yellow
($0.01–0.10), orange ($0.10–1.00), red (>$1.00). Used for:

- agent session cost
- per-bookmark sync cost
- topic detection cost

### `<TimeAgo iso />`

`<time dateTime={iso} suppressHydrationWarning>`. Renders raw ISO on
server, formats with `formatDistanceToNow` after `useEffect` mount.
Side-steps the hydration mismatch.

### `<ContentTypeIcon type />`

Maps `'tweet' | 'article' | 'repo' | 'video' | 'pdf'` to a Lucide
icon (`Twitter`, `FileText`, `Github`, `Youtube`, `FileText`). Sized
prop. Used everywhere a source is rendered.

### `<EntityTypeIcon type />`

Maps the 8 entity types to Lucide icons:
`Person → User`, `Tool → Wrench`, `Concept → Lightbulb`,
`Repo → Github`, `Article → FileText`, `Tweet → Twitter`,
`Video → Youtube`, `PDF → FileText`.

### `<EmbeddingProgress />`

Shows whether an entity has an embedding, and progress when
backfilling. Tooltip shows model + dim.

## Layout components (`components/layout/`)

### `<AppSidebar />`

The persistent left rail. Wraps shadcn's `<Sidebar>` with our nav
items: Graph, Sources, Entities, Topics, Chat, Cost, Settings. Reads
`usePathname()` to highlight active. State persists via shadcn's
built-in cookie.

### `<RightDrawer />`

Three-tab drawer (Detail / Sources / Chat) bound to the URL's
selection state. Stays mounted across selection changes — only its
inner content swaps. Resizable via shadcn's `Resizable`.

### `<BottomDrawer />`

Collapsible table drawer for "show me all rows for this selection".
Default collapsed; expands when needed. Toggled from the right drawer
or via Cmd-J.

### `<Header />`

Top bar with breadcrumb, global search (cmdk), theme toggle, account
button (just a logout for the bearer cookie).

## Graph components (`components/graph/`)

All `'use client'`. Mostly delegate to `@react-sigma/core` and our
custom hooks.

### `<GraphCanvas initial={serialized} />`

Wraps `<SigmaContainer>` with our default settings. Hosts:

- `<GraphLayoutController>` — runs ForceAtlas2 in a worker before
  first paint.
- `<GraphReducerSync>` — wires URL state and filter UI to Sigma's
  `setSettings(nodeReducer, edgeReducer)`.
- `<GraphHoverCard>` — Floating-UI positioned card on node hover.
- `<GraphSelectionSync>` — emits selection changes to URL state and
  the right drawer.
- `<TopicHaloLayer>` — underlay canvas drawing topic community
  halos.
- Optional `<GraphMinimap>` — Phase 2.

### `<GraphControls />`

Layout picker, depth slider, color-by radio, "save view" button.
Sits over the canvas in the top-right (absolute positioned). Compact;
collapses to an icon button on small screens.

### `<GraphSearch />`

The search box in the left rail. cmdk-based. Returns matches grouped
by entity type. Selecting a match: highlight node, optionally focus
neighborhood.

### `<NodeLegend />`

Type/topic color legend, fixed-bottom-left. Click a legend item to
toggle visibility of that type/topic. Common pattern in scientific
graph tools.

## Agent components (`components/agent/`)

All `'use client'`. Drive the chat surface and write-flow runs.

### `<AgentChat sessionId? mode="read"|"write" scope?={...} />`

The main chat UI. Composes `useChat` (or raw fetch+stream), renders
a message list, has a textarea + send button. `scope` lets the chat
seed the prompt with `selectedNodeIds` so questions are scoped to
whatever's selected on the graph.

### `<AgentMessage message />`

Renders one message. Variants:

- `user` — right-aligned bubble, plain text.
- `assistant` — left-aligned, markdown-rendered (via `react-markdown`
  - `remark-gfm`), citation chips for `[[src_X]]` references.
- `tool_call` — collapsible "Used tool: search_graph_text" with input
  args + output preview.
- `system` — small status line ("Resumed session abc123…").
- `result` — final-state badge with cost + turn count + duration.

### `<ToolCallRow toolCall />`

Collapsible row showing tool name, args (syntax-highlighted JSON),
result (also JSON-highlighted), latency. Used inside
`<AgentMessage variant="tool_call">` and on the session-replay page.

### `<CostMeter session />`

Live-updating cost badge during a streaming run; final figure when
done. Reads cost deltas from the streaming events.

### `<CitationChip sourceId />`

Inline `[[src_a1b2c3]]` rendering. Click → push selection to graph,
update right drawer's Detail tab. Hover → preview card.

## Form patterns (`features/*/components/`)

Each feature folder owns its own forms + the Zod schema shared with
its server actions.

### `<EntityMergeForm aId bId />`

RHF + Zod, calls `mergeEntities` server action. On submit shows a
preview ("Merging 'Vercel' and 'vercel' will combine 12 sources, 47
claims, and 3 aliases") and a confirm step.

### `<RetagSourceForm sourceId />`

Edit tags / topics on a Source. RHF + Zod, server action writes to
vault frontmatter and re-commits the vault git.

### `<NewIngestForm />`

Used in write-mode chat OR standalone on `/sources/new`: paste a URL,
select source kind, submit → triggers `runAdHocSync` server action,
streams progress.

### `<SavedViewForm />`

Persist a graph view: name, optional description, current view-state
serialized from URL. Stores in a small SQLite table (or JSON file in
vault?).

## Page-level "section" components

Composed inside `app/*/page.tsx` files. These aren't reusable — they
exist to keep the page files readable.

- `<SourcesTableSection params />` — RSC, fetches via
  `getSources(params)`, renders `<SourceTable>` (client) with TanStack
  Table.
- `<EntityDetailSection entityId />` — header (`<EntityCard
variant="expanded">`) + claims list + sources list + graph
  neighborhood preview.
- `<TopicCommunitySection topicId />` — topic name + members + an
  embedded mini-graph showing just this topic's nodes.
- `<DashboardSection />` — landing page with key counts (sources,
  entities, claims), recent ingests, total cost, top entities by
  degree.

## Hooks (`hooks/`)

- `useGraphSelection()` — read/write `?selected=` URL params; emits
  the current selection set.
- `useSavedView()` — serialize/deserialize current view state to URL
  hash.
- `useCostLedger(sinceDays?)` — fetches cost rollups via Server
  Action; for the cost dashboard.
- `useAgentChat(sessionId?, mode)` — wraps `useChat` with our
  custom event parsing; returns `messages`, `send`, `cancel`,
  `cost`, `turns`.
- `useDebouncedSearch(query, ms)` — used by `<GraphSearch />` and
  command-palette.
- `useTheme()` — re-export of `next-themes`.

## State management posture

- **Server state** lives in RSC. We don't put graph queries or vault
  reads behind TanStack Query; they're page-time fetches.
- **URL state** is the source of truth for: selection, filters,
  pagination, sort, color-by, depth. Use `nuqs` or hand-rolled
  `useSearchParams` — `nuqs` ergonomically wins.
- **Client form state** is RHF.
- **Streaming state** (chat) is `useChat` from AI SDK.
- **Optimistic UI** for mutations uses `useOptimistic` + Server
  Actions (no TanStack Query needed).
- **Toast / notifications** via Sonner.

If we ever need long-lived client cache (e.g. for a "watched URLs"
feature that polls): TanStack Query. Until then, no.

## What we explicitly NOT building

- A custom `<Button>` wrapper (use shadcn's `Button` directly).
- A `<Theme>` provider (already in `<RootLayout>`).
- Storybook (overkill for one user; we'll iterate in dev).
- Internationalization (English only).
- An icon library beyond Lucide (already shadcn's default).
