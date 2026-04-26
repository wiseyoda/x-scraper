/**
 * Louvain community detector. Builds an undirected graph from the input
 * edges (edge weight = sum of incoming/outgoing parallel edges), runs
 * Louvain, and returns one CommunityResult per discovered community
 * meeting the minCommunitySize threshold.
 */

import * as Graphology from 'graphology';
import * as Louvain from 'graphology-communities-louvain';

import { CommunityError, type CommunityResult, type DetectorInput } from './types.js';

interface GraphologyGraph {
  addNode: (id: string, attrs?: Record<string, unknown>) => void;
  hasNode: (id: string) => boolean;
  hasEdge: (a: string, b: string) => boolean;
  addUndirectedEdge: (a: string, b: string, attrs?: { weight: number }) => void;
  forEachEdge: (
    cb: (edge: string, attrs: { weight: number }, source: string, target: string) => void,
  ) => void;
}

// graphology and graphology-communities-louvain ship as CommonJS with a
// default export. Under NodeNext + verbatimModuleSyntax we have to grab
// .default off the namespace import; the published .d.ts types don't
// model this cleanly so the `as unknown as` casts elide them.
type GraphCtor = new (opts: { type: 'undirected'; multi: false }) => GraphologyGraph;
const Graph = (Graphology as unknown as { default: GraphCtor }).default;
const louvain = (
  Louvain as unknown as {
    default: (graph: GraphologyGraph, options?: { resolution?: number }) => Record<string, number>;
  }
).default;

const DEFAULT_MIN_COMMUNITY_SIZE = 3;

type AssignmentResult = Record<string, number>;

const buildGraph = (input: DetectorInput): GraphologyGraph => {
  const graph = new Graph({ type: 'undirected', multi: false });
  for (const node of input.nodes) {
    graph.addNode(node.id, { type: node.type, name: node.name });
  }
  // Sum parallel edges into a single weighted undirected edge. Louvain
  // treats edges as undirected anyway, so collapsing here keeps the
  // graph well-formed and the weight signal intact.
  const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const weights = new Map<string, number>();
  for (const edge of input.edges) {
    if (!graph.hasNode(edge.from) || !graph.hasNode(edge.to)) continue;
    if (edge.from === edge.to) continue;
    const k = edgeKey(edge.from, edge.to);
    weights.set(k, (weights.get(k) ?? 0) + (edge.weight ?? 1));
  }
  for (const [k, weight] of weights) {
    const parts = k.split('|');
    const a = parts[0];
    const b = parts[1];
    if (a === undefined || b === undefined) continue;
    if (!graph.hasEdge(a, b)) graph.addUndirectedEdge(a, b, { weight });
  }
  return graph;
};

const buildResults = (
  assignment: AssignmentResult,
  edgeIndex: Map<string, number>,
  minSize: number,
): CommunityResult[] => {
  const byCommunity = new Map<number, string[]>();
  for (const [nodeId, communityId] of Object.entries(assignment)) {
    const members = byCommunity.get(communityId) ?? [];
    members.push(nodeId);
    byCommunity.set(communityId, members);
  }
  const out: CommunityResult[] = [];
  for (const [communityId, members] of byCommunity) {
    if (members.length < minSize) continue;
    // Pick the member with the most edges inside the community as the
    // representative — a stable, deterministic choice that the LLM
    // synthesis step can use as a topic anchor without introducing
    // randomness.
    let bestId = members[0];
    let bestCount = -1;
    let totalEdges = 0;
    for (const id of members) {
      const count = edgeIndex.get(id) ?? 0;
      if (count > bestCount) {
        bestCount = count;
        bestId = id;
      }
      totalEdges += count;
    }
    if (bestId === undefined) continue;
    out.push({
      communityId,
      members: members.sort(),
      representativeId: bestId,
      edgeCount: totalEdges,
    });
  }
  // Stable order: largest community first; tie-break on representativeId.
  return out.sort((a, b) => {
    if (b.members.length !== a.members.length) return b.members.length - a.members.length;
    return a.representativeId.localeCompare(b.representativeId);
  });
};

export const detectCommunities = (input: DetectorInput): CommunityResult[] => {
  if (input.nodes.length === 0) {
    throw new CommunityError('cannot detect communities on an empty graph', 'EMPTY_GRAPH');
  }
  const minSize = input.minCommunitySize ?? DEFAULT_MIN_COMMUNITY_SIZE;
  const graph = buildGraph(input);
  // Per-node edge count for representative selection. We compute on the
  // collapsed undirected graph, not on the raw edges, so parallel edges
  // don't double-count.
  const edgeIndex = new Map<string, number>();
  graph.forEachEdge((_edge, _attrs, source, target) => {
    edgeIndex.set(source, (edgeIndex.get(source) ?? 0) + 1);
    edgeIndex.set(target, (edgeIndex.get(target) ?? 0) + 1);
  });
  // graphology-communities-louvain returns Record<nodeId, communityId>.
  const assignment: AssignmentResult = louvain(
    graph,
    input.resolution === undefined ? {} : { resolution: input.resolution },
  );
  return buildResults(assignment, edgeIndex, minSize);
};
