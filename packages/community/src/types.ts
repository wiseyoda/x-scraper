/**
 * Community detection over a Concept/Topic-flavoured subgraph of the
 * knowledge graph.
 *
 * We use Louvain (graphology-communities-louvain) rather than Neo4j GDS
 * Leiden so the dependency surface stays in JS and doesn't require the
 * Neo4j GDS plugin to be installed in the user's local instance.
 * Quality is comparable for our use case (small to medium graphs of
 * Concept nodes connected by RELATED_TO and IS_A edges).
 */

import type { EdgeType, EntityType } from '@x-scraper/core';

export interface GraphEdgeRecord {
  from: string;
  to: string;
  type: EdgeType;
  weight?: number;
}

export interface GraphNodeRecord {
  id: string;
  type: EntityType;
  name: string;
}

/**
 * What the detector returns: one entry per discovered community, with
 * the member node ids and a deterministic "representative" id (the node
 * that appears in the most edges within the community — used as the
 * topic name when the LLM synthesis step downstream needs an anchor).
 */
export interface CommunityResult {
  communityId: number;
  members: string[];
  representativeId: string;
  edgeCount: number;
}

export interface DetectorInput {
  /** Nodes that participate in the subgraph. */
  nodes: GraphNodeRecord[];
  /** Edges restricted to the subgraph. */
  edges: GraphEdgeRecord[];
  /** Drop communities below this size. Default 3. */
  minCommunitySize?: number;
  /** Pass-through to the Louvain detector. */
  resolution?: number;
}

export type CommunityErrorCode = 'EMPTY_GRAPH' | 'INVALID_INPUT' | 'UNKNOWN';

export class CommunityError extends Error {
  public readonly code: CommunityErrorCode;
  public override readonly cause: unknown;

  constructor(message: string, code: CommunityErrorCode, cause?: unknown) {
    super(message);
    this.name = 'CommunityError';
    this.code = code;
    this.cause = cause;
  }
}
