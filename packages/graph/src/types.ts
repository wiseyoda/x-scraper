import type { EdgeType, EntityType } from '@x-scraper/core';

export interface GraphNode {
  id: string;
  type: EntityType;
  props: Record<string, unknown>;
  embedding?: number[];
}

export interface GraphEdge {
  from: string;
  to: string;
  type: EdgeType;
  validAt: string;
  invalidAt?: string | null;
  confidence?: number;
  props?: Record<string, unknown>;
}

export interface VectorHit {
  id: string;
  score: number;
}

export interface TraverseStep {
  fromId: string;
  edgeType: EdgeType;
  toId: string;
  toType: EntityType;
}

export interface GraphInitOptions {
  vectorDims?: number;
  awaitIndexesSeconds?: number;
}

export interface ConceptEdgeRecord {
  from: string;
  to: string;
  type: EdgeType;
  /** Number of distinct sources that co-mention the pair. Defaults to 1
   *  for legacy edges that pre-date the cooccurrence_count property. */
  cooccurrenceCount: number;
  /** ISO timestamp of the most recent Source contributing to this edge,
   *  or null when no captured_at is recoverable. Used by recency
   *  weighting in `xs topic detect --recency-half-life-days=N`. */
  lastObservedAt: string | null;
}

export interface ConceptNodeRecord {
  id: string;
  type: EntityType;
  name: string;
}

export interface ConceptSubgraph {
  nodes: ConceptNodeRecord[];
  edges: ConceptEdgeRecord[];
}

export interface ExistingClaimRecord {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  validAt: string;
  invalidAt: string | null;
  sourceId: string;
}

export interface GraphStore {
  init: (options?: GraphInitOptions) => Promise<void>;
  upsertNode: (node: GraphNode) => Promise<void>;
  upsertEdge: (edge: GraphEdge) => Promise<void>;
  invalidateEdge: (from: string, to: string, type: EdgeType, invalidAt: string) => Promise<number>;
  vectorSearch: (label: EntityType, embedding: number[], k: number) => Promise<VectorHit[]>;
  traverse: (startId: string, depth: number, edgeTypes?: EdgeType[]) => Promise<TraverseStep[]>;
  countNodes: (label?: EntityType) => Promise<number>;
  /**
   * Read the Concept-RELATED_TO-Concept subgraph (current edges only,
   * invalid_at IS NULL). Used by `xs topic detect` to feed the Louvain
   * community detector. Returns nodes and edges deduped by id.
   */
  listConceptSubgraph: () => Promise<ConceptSubgraph>;
  /**
   * Look up an entity of the given type whose `normalized_name` or any
   * member of `normalized_aliases` exactly matches one of the supplied
   * surface forms. Used by the reconciler's pre-flight pass. Returns
   * the first match by id (caller treats matches as opaque).
   */
  findEntityByNormalizedSurface: (
    label: EntityType,
    surfaceForms: string[],
  ) => Promise<{ id: string; matchedSurface: string } | null>;
  /**
   * Return the current (invalid_at IS NULL) Claim nodes whose `subject`
   * exactly matches the supplied string, alongside their originating
   * source id (resolved from the EXTRACTED_FROM edge). Used by the
   * reconciler to find UPDATE/DELETE candidates for an incoming claim.
   * Capped at 100 to avoid runaway result sets.
   */
  findClaimsForSubject: (subject: string) => Promise<ExistingClaimRecord[]>;
  /**
   * Upsert an additive Concept-Concept co-occurrence edge. Each call
   * bumps cooccurrence_count and appends sourceId to the sources list
   * (deduped). Returns the new count. Used by update_graph after the
   * extractor's explicit relationships are written.
   */
  upsertCooccurrenceEdge: (input: {
    from: string;
    to: string;
    sourceId: string;
    now: string;
  }) => Promise<number>;
  close: () => Promise<void>;
}

export type GraphErrorCode =
  | 'CONNECTION'
  | 'CYPHER'
  | 'SCHEMA'
  | 'INVALID_INPUT'
  | 'DIM_MISMATCH'
  | 'NOT_FOUND'
  | 'UNKNOWN';

export class GraphError extends Error {
  public readonly code: GraphErrorCode;
  public override readonly cause: unknown;

  constructor(message: string, code: GraphErrorCode, cause?: unknown) {
    super(message);
    this.name = 'GraphError';
    this.code = code;
    this.cause = cause;
  }
}
