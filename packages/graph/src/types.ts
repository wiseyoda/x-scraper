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
