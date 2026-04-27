# Graph visualization

How the canvas renders 5–50k heterogeneous nodes (Source, 8 Entity
types, Claim, Topic) with cluster overlays, click-through navigation,
and 60fps interaction.

## Library choice: Sigma.js v3 + Graphology

After comparing Cytoscape.js, Sigma.js, vis-network, React Flow,
ECharts, D3-force, and Neo4j NVL, **Sigma.js v3 with Graphology and
the `@react-sigma/core` React wrapper** is the right pick. Three
reasons, ranked:

1. **Performance ceiling.** Sigma's WebGL renderer holds 50k nodes at
   60fps. Cytoscape's canvas renderer starts visibly chugging around
   5–10k. React Flow uses DOM-per-node and dies at 5k. The corpus
   target is 5–50k nodes; nothing else in the same league handles it
   in browser.
2. **Right data model.** Graphology is the de-facto graph data
   structure for JS — incremental updates, subgraph filtering,
   neighborhood traversal, Louvain (already used server-side via
   `graphology-communities-louvain` in `@x-scraper/community`),
   shortest path, betweenness, all built in. Even if the renderer
   changed, Graphology stays.
3. **Heterogeneous node typing fits the reducer pattern.** Sigma's
   "reducer" lets us mutate per-frame node/edge attributes from UI
   state without touching the underlying graph: `setSettings({
nodeReducer: (n, attrs) => ({ ...attrs, color: colorFor(attrs.type, filterState) }) })`.
   Filter / focus / search-highlight all become pure functions of UI
   state, not graph mutations.

Trade-off accepted: we'll write 1-2 custom node programs (~50 LOC of
WebGL setup each) for the topic-halo overlay and per-type icons.

### What we're not picking and why

| Considered            | Reason for skipping                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Cytoscape.js          | Canvas perf cap. React story is imperative-via-`react-cytoscapejs` wrapper, weaker than `@react-sigma/core`.       |
| React Flow / @xyflow  | DOM-per-node — fine for diagrams (≤2k), wrong shape for an explorer. License OK for OSS but Pro features sneak in. |
| vis-network           | Old, no real React wrapper, perf falls off ~3k.                                                                    |
| ECharts               | "Just a chart with a graph type." Constrained styling, big bundle.                                                 |
| D3-force from scratch | We'd rebuild Sigma.                                                                                                |
| Neo4j NVL             | License ties to Neo4j Enterprise — disqualifying.                                                                  |

## Visual encoding

| Channel    | Encodes                                                                | Notes                                                                                                     |
| ---------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Color      | Entity type (default) OR topic membership (toggle) OR recency (toggle) | Single radio in left rail switches between modes.                                                         |
| Size       | Degree (in + out) on a log scale                                       | Capped at 30px so super-hubs don't dominate.                                                              |
| Border     | Selected / hovered                                                     | 2px white border on hover, 3px accent on selected.                                                        |
| Halo       | Topic community membership                                             | Faint filled circle behind the node, color by topic, 60% opacity. Only when "color-by topic" mode is off. |
| Edge color | Edge type                                                              | Subtle palette; cooccurrence edges are 30% opacity so they don't dominate.                                |
| Edge width | `cooccurrence_count` (for RELATED_TO) or 1 (for everything else)       | Cap at 5px.                                                                                               |
| Icon       | Entity sub-type (when zoomed in)                                       | Lucide icons rendered as SVG-to-WebGL via `@sigma/node-image`.                                            |

Color palette is generated from a categorical scheme (`d3-scale-chromatic`'s `schemeTableau10` or similar) frozen into Tailwind theme tokens for consistency across the app.

## Layout

- Default: **ForceAtlas2** (Graphology's `graphology-layout-forceatlas2`),
  computed in a Web Worker before the canvas mounts. Settings tuned
  for clarity (`gravity: 1, scalingRatio: 10, slowDown: 5`,
  `barnesHutOptimize: true`, `barnesHutTheta: 0.5`). Pre-compute 500
  iterations off the main thread, then render.
- Optional: **Circular** for "topic carousel" mode where Topic nodes
  arrange around the perimeter and members orbit inward.
- Optional: **DAG / hierarchical** for tracing Source → Claim → Entity
  derivations of a single source. Use `dagre` via Graphology.
- Saved view captures `{ layoutSeed, settings, filters, focusNode,
depth, colorBy }` so re-opening a view always lands in the same
  visual state.

## Interaction patterns

Stolen from Linear, Obsidian, and Neo4j Bloom:

- **Hover = rich preview card.** Tailwind-styled, 320px, shows: type
  badge, name, top 3 claims, last-mentioned-at, "X sources mention
  this entity". Cheap to render; huge UX win. Floating UI handles
  positioning + collision.
- **Click = select.** Updates `selectedNodeIds` in URL state (`?n=...`).
  Right drawer's tabs (Detail / Sources / Chat) all re-render against
  the new selection. Graph itself does not navigate or remount.
- **Double-click = focus mode.** Reframes the canvas to the N-hop
  neighborhood (depth slider in left rail, default 2). Background nodes
  fade to 10% opacity. Press Esc to exit focus.
- **Cmd-click = multi-select.** Build a node set the chat tab can
  scope its prompt to.
- **Drag-select = lasso.** Same as multi-select but freehand.
- **Search-on-graph.** Type in left rail; matches highlight in-canvas
  with a halo, top match auto-centers, others throb. Sigma's reducer
  pattern again.
- **Pin a node.** Right-click → "pin" locks the node's position so
  layout iterations don't move it. Useful when curating a view.

## URL state

Saved views serialize to a URL hash so they can be linked from the
chat agent's tool-call output:

```
/graph#v={
  layout: 'forceatlas2',
  seed: 1234,
  filters: { types: ['Tool', 'Concept'], minDegree: 2 },
  focus: 'tool_xyz',
  depth: 2,
  colorBy: 'topic',
  selectedIds: ['tool_xyz', 'c_abc']
}
```

(JSON URL-encoded; or a small Zod-validated query string codec.)

The agent's `tool_use` results can include
`{ action: 'open_graph_view', params: {...} }` and the chat UI renders
that as a "Show in graph" chip; clicking it pushes the encoded view to
the URL. Round-trip from chat → graph → table preserves selection.

## Canvas component design

```
app/(review)/graph/@graph/page.tsx (Server Component)
  → fetches initial subgraph via features/graph/queries.ts
    (Cypher: top-N nodes by degree, plus their 1-hop neighbors)
  → renders <GraphCanvas initial={...} /> (client)

components/graph/graph-canvas.tsx ('use client')
  → dynamic import of '@react-sigma/core' (ssr: false)
  → useGraphology hook builds the in-memory graph from initial data
  → useSigma exposes the renderer for reducers
  → useGraphSelection() hook wires URL state
  → fires 'expand' tool requests when user opens a node's neighborhood

components/graph/graph-controls.tsx ('use client')
  → layout picker (ForceAtlas2 / circular / DAG)
  → depth slider
  → color-by radio
  → "save view" button (writes to features/graph/saved-views table)

components/graph/graph-search.tsx ('use client')
  → debounced search box
  → calls features/graph/queries.ts → fuzzy match across vault.list()
  → updates Sigma's nodeReducer with highlight state
```

Graph data shipping format is **Graphology's serialized form**
(`graph.export()` → `{ nodes, edges, attributes, options }`). Server
returns this via Server Action; client `Graph.import(serialized)` and
mounts. Smaller and more semantic than ad-hoc `{nodes:[],edges:[]}`.

## Topic overlay (the differentiator)

Every Concept entity has a `topic` membership computed by the
existing `xs topic detect` (Louvain over the cooccurrence subgraph).
We render topics as filled background circles ("halos"):

1. For each topic, compute the centroid of its member concepts'
   layout positions.
2. Compute the radius from member positions (covering circle algorithm
   via `d3-array`'s `extent` + a small padding).
3. Draw a low-opacity filled circle behind everything, color-coded by
   topic, labeled at the center.

This gives an at-a-glance "what regions of the graph are about" view
without requiring the user to color nodes by topic (that loses the
type signal). Halos plus type-colored nodes communicate two
dimensions at once.

Implementation: Sigma supports background layers via custom node
programs OR a separate `<canvas>` underlay rendered by the same
parent. Underlay is simpler (DOM canvas, CSS `position: absolute`),
re-rendered when layout changes.

## Performance targets

- 60fps pan/zoom up to 50k nodes (Sigma's claimed ceiling).
- <500ms first paint for a 5k-node initial subgraph (RSC ships
  serialized graph; client hydrates Sigma).
- <150ms response to filter / color-by toggles (reducer pattern; no
  layout re-run).
- <2s for "expand neighborhood" (server query + incremental
  Graphology mergeNodes).

## Gotchas

1. **`@react-sigma/core` and SSR:** must be `dynamic(() => import,
{ ssr: false })`. Direct import from a Server Component crashes the
   server.
2. **ForceAtlas2 in a worker:** `graphology-layout-forceatlas2/worker`
   exists; use it. Running 500+ iterations on the main thread blocks
   render for 1-2s.
3. **CSS bundle:** Sigma doesn't ship a CSS file (canvas-based) but
   `@react-sigma/core` does (`@react-sigma/core/lib/style.css`) for
   the default container. Import it from the client component, not
   `app/layout.tsx`, so server tree doesn't pull it.
4. **Sigma + zoom + retina:** WebGL needs `devicePixelRatio` handling.
   `@react-sigma/core` does this automatically; if you customize
   `<SigmaContainer>` props watch out.
5. **Edge bundling at high density:** for very dense regions
   (cooccurrence networks of 1000+ concepts), consider pre-bundling
   edges via `d3-bundle` or filtering to top-N by `cooccurrence_count`.
   Don't render every edge; cap to ~edges-per-frame.

## Open questions / deferred decisions

- Do we want a "timeline scrubber" that animates the graph by
  `valid_at` over time? Probably yes, but Phase 3.
- Drag-and-drop reorganization of pinned nodes for curation? Nice-to-
  have. Not Phase 1.
- Export-as-PNG / SVG for sharing a view? Sigma supports PNG export
  natively. Phase 2.
