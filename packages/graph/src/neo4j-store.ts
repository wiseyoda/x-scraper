/**
 * Neo4j adapter for GraphStore.
 *
 * Patterns proven in spike 3 (warm-cache: vector top-10 ~12 ms, 2-hop
 * traversal ~26 ms on a 1k-claim corpus). Schema uses native HNSW
 * vector index + uniqueness constraints on (label).id. Bi-temporal
 * edges store valid_at + invalid_at; queries default to invalid_at IS
 * NULL for "current" view.
 *
 * The adapter never builds Cypher inline — every string is sourced
 * from `cypher.ts` so the test surface covers them.
 */

import type { EdgeType, EntityType } from '@x-scraper/core';
import neo4j, { type Driver, type Session } from 'neo4j-driver';

import {
  DEFAULT_AWAIT_INDEXES_SECONDS,
  DEFAULT_EMBED_DIMS,
  DEFAULT_SIMILARITY,
  ID_CONSTRAINTS,
  VECTOR_INDEX_NAME,
} from './constants.js';
import {
  buildCountNodes,
  buildIdConstraint,
  buildInvalidateEdge,
  buildTraversal,
  buildUpsertEdge,
  buildUpsertNode,
  buildUpsertNodeWithEmbedding,
  buildVectorIndex,
  buildVectorSearch,
} from './cypher.js';
import type {
  GraphEdge,
  GraphInitOptions,
  GraphNode,
  GraphStore,
  TraverseStep,
  VectorHit,
} from './types.js';
import { GraphError } from './types.js';

export interface Neo4jConfig {
  uri: string;
  user: string;
  password: string;
  database?: string;
}

const VECTOR_INDEX_PROP = 'embedding';

const neoIntFromNumber = (n: number): ReturnType<typeof neo4j.int> => neo4j.int(n);

export const createNeo4jGraph = (config: Neo4jConfig): GraphStore => {
  const driver: Driver = neo4j.driver(config.uri, neo4j.auth.basic(config.user, config.password));
  const dbName = config.database ?? 'neo4j';

  const withSession = async <T>(fn: (session: Session) => Promise<T>): Promise<T> => {
    const session = driver.session({ database: dbName });
    try {
      return await fn(session);
    } finally {
      await session.close();
    }
  };

  const init = async (options: GraphInitOptions = {}): Promise<void> => {
    const dims = options.vectorDims ?? DEFAULT_EMBED_DIMS;
    await driver.verifyConnectivity().catch((err: unknown) => {
      throw new GraphError(`cannot reach Neo4j at ${config.uri}`, 'CONNECTION', err);
    });
    await withSession(async (session) => {
      for (const c of ID_CONSTRAINTS) {
        await session.run(buildIdConstraint(c.name, c.label));
      }
      await session.run(
        buildVectorIndex(VECTOR_INDEX_NAME, 'Claim', VECTOR_INDEX_PROP, dims, DEFAULT_SIMILARITY),
      );
      // Block until every newly-created index is ONLINE. Without this, a
      // cold-start init() can return while the vector index is POPULATING
      // and an immediate vectorSearch() will fail.
      await session.run('CALL db.awaitIndexes($timeout)', {
        timeout: neoIntFromNumber(options.awaitIndexesSeconds ?? DEFAULT_AWAIT_INDEXES_SECONDS),
      });
    });
  };

  const upsertNode = async (node: GraphNode): Promise<void> => {
    await withSession(async (session) => {
      const params = { id: node.id, props: { ...node.props, id: node.id } };
      if (node.embedding !== undefined) {
        await session.run(buildUpsertNodeWithEmbedding(node.type), {
          ...params,
          embedding: node.embedding,
        });
      } else {
        await session.run(buildUpsertNode(node.type), params);
      }
    });
  };

  const upsertEdge = async (edge: GraphEdge): Promise<void> => {
    await withSession(async (session) => {
      await session.run(buildUpsertEdge(edge.type), {
        from: edge.from,
        to: edge.to,
        validAt: edge.validAt,
        invalidAt: edge.invalidAt ?? null,
        confidence: edge.confidence ?? null,
        props: edge.props ?? {},
      });
    });
  };

  const invalidateEdge = async (
    from: string,
    to: string,
    type: EdgeType,
    invalidAt: string,
  ): Promise<number> => {
    return await withSession(async (session) => {
      const result = await session.run(buildInvalidateEdge(type), {
        from,
        to,
        invalidAt,
      });
      const first = result.records[0]?.get('n') as { toNumber: () => number } | number | undefined;
      if (first === undefined) return 0;
      return typeof first === 'number' ? first : first.toNumber();
    });
  };

  const vectorSearch = async (
    label: EntityType,
    embedding: number[],
    k: number,
  ): Promise<VectorHit[]> => {
    if (label !== 'Claim') {
      throw new GraphError(
        `vectorSearch only supported on Claim today (got ${label})`,
        'INVALID_INPUT',
      );
    }
    return await withSession(async (session) => {
      const result = await session.run(buildVectorSearch(VECTOR_INDEX_NAME), {
        index: VECTOR_INDEX_NAME,
        k: neoIntFromNumber(k),
        embedding,
      });
      return result.records.map((r) => ({
        id: r.get('id') as string,
        score: r.get('score') as number,
      }));
    });
  };

  const traverse = async (
    startId: string,
    depth: number,
    edgeTypes?: EdgeType[],
  ): Promise<TraverseStep[]> => {
    return await withSession(async (session) => {
      const result = await session.run(buildTraversal(depth, edgeTypes), { startId });
      return result.records.map((r) => ({
        fromId: r.get('fromId') as string,
        edgeType: r.get('edgeType') as EdgeType,
        toId: r.get('toId') as string,
        toType: r.get('toType') as EntityType,
      }));
    });
  };

  const countNodes = async (label?: EntityType): Promise<number> => {
    return await withSession(async (session) => {
      const result = await session.run(buildCountNodes(label));
      const value = result.records[0]?.get('n') as { toNumber: () => number } | number | undefined;
      if (value === undefined) return 0;
      return typeof value === 'number' ? value : value.toNumber();
    });
  };

  const close = async (): Promise<void> => {
    await driver.close();
  };

  return {
    init,
    upsertNode,
    upsertEdge,
    invalidateEdge,
    vectorSearch,
    traverse,
    countNodes,
    close,
  };
};
