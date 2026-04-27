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
  ENTITY_VECTOR_INDEX_NAME,
  ENTITY_VECTOR_OVERFETCH,
  ENTITY_VECTOR_PROP,
  ID_CONSTRAINTS,
  VECTOR_INDEX_NAME,
} from './constants.js';
import { readVectorIndexDims } from './cypher.js';
import {
  buildCountNodes,
  buildFindAnyEntityByNormalizedSurface,
  buildFindByNormalizedSurface,
  buildFindClaimsForSubject,
  buildIdConstraint,
  buildInvalidateEdge,
  buildTraversal,
  buildUpsertCooccurrenceEdge,
  buildUpsertEdge,
  buildUpsertNode,
  buildUpsertNodeWithEmbedding,
  buildVectorIndex,
  buildVectorSearch,
} from './cypher.js';
import type {
  ConceptSubgraph,
  ExistingClaimRecord,
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
  // Configured dimensions for the Claim vector index. Set during init() and
  // referenced by every embedding-bearing call so a caller passing a wrong-dim
  // vector fails loudly here instead of producing a cryptic Neo4j error or,
  // worse, silently writing a node whose embedding the index then refuses.
  let configuredDims: number | undefined;

  const withSession = async <T>(fn: (session: Session) => Promise<T>): Promise<T> => {
    const session = driver.session({ database: dbName });
    try {
      return await fn(session);
    } finally {
      await session.close();
    }
  };

  const assertDims = (where: string, embedding: number[]): void => {
    if (configuredDims === undefined) {
      throw new GraphError(`${where}: init() must run before embedding-bearing calls`, 'SCHEMA');
    }
    if (embedding.length !== configuredDims) {
      throw new GraphError(
        `${where}: embedding has ${embedding.length.toString()} dims but index expects ${configuredDims.toString()}`,
        'DIM_MISMATCH',
      );
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
      // Detect drift before issuing the CREATE: if the index already exists
      // at different dims, CREATE IF NOT EXISTS would silently keep the old
      // one and we'd embed against the wrong space.
      const existingDims = await readExistingIndexDims(session, VECTOR_INDEX_NAME);
      if (existingDims !== undefined && existingDims !== dims) {
        throw new GraphError(
          `vector index ${VECTOR_INDEX_NAME} already exists at ${existingDims.toString()} dims; refusing to use it for ${dims.toString()}-dim embeddings. Drop the index or pick a new one.`,
          'DIM_MISMATCH',
        );
      }
      await session.run(
        buildVectorIndex(VECTOR_INDEX_NAME, 'Claim', VECTOR_INDEX_PROP, dims, DEFAULT_SIMILARITY),
      );
      // Same drift-guard for the entity vector index. Both indexes share
      // dims since the same Gemini model produces both Claim and Entity
      // embeddings; if production has the entity index at different
      // dims something has been hand-edited and we refuse to bind.
      const existingEntityDims = await readExistingIndexDims(session, ENTITY_VECTOR_INDEX_NAME);
      if (existingEntityDims !== undefined && existingEntityDims !== dims) {
        throw new GraphError(
          `vector index ${ENTITY_VECTOR_INDEX_NAME} already exists at ${existingEntityDims.toString()} dims; refusing to use it for ${dims.toString()}-dim embeddings. Drop the index or pick a new one.`,
          'DIM_MISMATCH',
        );
      }
      // Single index across the Entity meta-label covers Person/Tool/
      // Concept/Repo/Article/Tweet/Video/PDF — see ENTITY_META_TYPES in
      // cypher.ts. The reconciler's vector ER passes the type label so
      // we filter results post-retrieval to the right kind.
      await session.run(
        `CREATE VECTOR INDEX ${ENTITY_VECTOR_INDEX_NAME} IF NOT EXISTS
         FOR (n:Entity) ON (n.${ENTITY_VECTOR_PROP})
         OPTIONS { indexConfig: {
           \`vector.dimensions\`: ${dims.toString()},
           \`vector.similarity_function\`: '${DEFAULT_SIMILARITY}'
         }}`,
      );
      // Block until every newly-created index is ONLINE. Without this, a
      // cold-start init() can return while the vector index is POPULATING
      // and an immediate vectorSearch() will fail.
      await session.run('CALL db.awaitIndexes($timeout)', {
        timeout: neoIntFromNumber(options.awaitIndexesSeconds ?? DEFAULT_AWAIT_INDEXES_SECONDS),
      });
    });
    configuredDims = dims;
  };

  const readExistingIndexDims = async (
    session: Session,
    indexName: string,
  ): Promise<number | undefined> => {
    const result = await session.run(readVectorIndexDims(), { name: indexName });
    const record = result.records[0];
    if (record === undefined) return undefined;
    const raw = record.get('dims') as { toNumber: () => number } | number | null | undefined;
    if (raw === null || raw === undefined) return undefined;
    return typeof raw === 'number' ? raw : raw.toNumber();
  };

  const upsertNode = async (node: GraphNode): Promise<void> => {
    // Both Claim and Entity-meta nodes hit a vector index — assert dims
    // on either path. Source/Topic carry no embedding.
    if (node.embedding !== undefined) {
      assertDims(`upsertNode(${node.id})`, node.embedding);
    }
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
    assertDims('vectorSearch', embedding);
    if (label === 'Source' || label === 'Topic') {
      // Source/Topic don't carry embeddings — empty result lets resolver
      // fall through to NEW. (Source ER doesn't apply; URLs are the
      // natural key.) (Topic ER not used; communities derive deterministic ids.)
      return [];
    }
    if (label !== 'Claim') {
      // Entity-meta path: query the entity HNSW index, filter results
      // post-retrieval to the requested type label so the score still
      // reflects same-type similarity. db.index.vector.queryNodes
      // returns the GLOBAL top k across all labels in the shared
      // entity_embed_idx; if the nearest k happen to be the wrong
      // type, we'd miss real same-type candidates that are just below
      // them. Overfetch by ENTITY_VECTOR_OVERFETCH so the post-filter
      // has enough candidates to find k same-type hits in mixed graphs.
      const overfetchK = Math.max(k * ENTITY_VECTOR_OVERFETCH, k);
      return await withSession(async (session) => {
        const result = await session.run(
          `CALL db.index.vector.queryNodes($index, $overfetchK, $embedding)
           YIELD node, score
           WHERE $label IN labels(node)
           RETURN node.id AS id, score
           LIMIT $k`,
          {
            index: ENTITY_VECTOR_INDEX_NAME,
            overfetchK: neoIntFromNumber(overfetchK),
            k: neoIntFromNumber(k),
            embedding,
            label,
          },
        );
        return result.records.map((r) => ({
          id: r.get('id') as string,
          score: r.get('score') as number,
        }));
      });
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

  /**
   * Read every Concept node + every current RELATED_TO edge between two
   * Concepts. Used by `xs topic detect` to feed Louvain. Filters on
   * `invalid_at IS NULL` so superseded edges don't pollute the input.
   */
  const listConceptSubgraph = async (): Promise<ConceptSubgraph> => {
    return await withSession(async (session) => {
      // Fetch nodes that participate in at least one current RELATED_TO
      // edge — isolated Concepts add no information for community detection.
      const nodeResult = await session.run(`
        MATCH (c:Concept)
        WHERE EXISTS {
          MATCH (c)-[r:RELATED_TO]-(:Concept)
          WHERE r.invalid_at IS NULL
        }
        RETURN c.id AS id, c.name AS name
      `);
      const nodes = nodeResult.records.map((r) => ({
        id: r.get('id') as string,
        type: 'Concept' as const,
        name: (r.get('name') as string | null) ?? (r.get('id') as string),
      }));
      // Edge query also pulls cooccurrence_count + the most recent
      // captured_at across all sources contributing to the edge, so
      // T19's recency weighting can decay it in JS without round-tripping.
      const edgeResult = await session.run(`
        MATCH (a:Concept)-[r:RELATED_TO]->(b:Concept)
        WHERE coalesce(r.invalid_at, '') = ''
        OPTIONAL MATCH (s:Source)
        WHERE s.id IN coalesce(r.sources, [])
        WITH a, b, r, max(s.captured_at) AS lastObservedAt
        RETURN a.id AS fromId,
               b.id AS toId,
               coalesce(r.cooccurrence_count, 1) AS cooccurrenceCount,
               lastObservedAt
      `);
      const edges = edgeResult.records.map((r) => {
        const rawCount = r.get('cooccurrenceCount') as { toNumber: () => number } | number | null;
        const cooccurrenceCount =
          rawCount === null ? 1 : typeof rawCount === 'number' ? rawCount : rawCount.toNumber();
        return {
          from: r.get('fromId') as string,
          to: r.get('toId') as string,
          type: 'RELATED_TO' as const,
          cooccurrenceCount,
          lastObservedAt: (r.get('lastObservedAt') as string | null) ?? null,
        };
      });
      return { nodes, edges };
    });
  };

  const findEntityByNormalizedSurface = async (
    label: EntityType,
    surfaceForms: string[],
  ): Promise<{ id: string; matchedSurface: string } | null> => {
    if (surfaceForms.length === 0) return null;
    return await withSession(async (session) => {
      const result = await session.run(buildFindByNormalizedSurface(label), {
        surfaces: surfaceForms,
      });
      const row = result.records[0];
      if (row === undefined) return null;
      return {
        id: row.get('id') as string,
        matchedSurface: (row.get('matchedSurface') as string | null) ?? '',
      };
    });
  };

  const findEntityByNormalizedSurfaceAcrossTypes = async (
    labels: EntityType[],
    surfaceForms: string[],
  ): Promise<{ id: string; matchedType: EntityType; matchedSurface: string } | null> => {
    if (surfaceForms.length === 0 || labels.length === 0) return null;
    return await withSession(async (session) => {
      const result = await session.run(buildFindAnyEntityByNormalizedSurface(labels), {
        surfaces: surfaceForms,
      });
      const row = result.records[0];
      if (row === undefined) return null;
      return {
        id: row.get('id') as string,
        matchedType: row.get('matchedType') as EntityType,
        matchedSurface: (row.get('matchedSurface') as string | null) ?? '',
      };
    });
  };

  const upsertCooccurrenceEdge = async (input: {
    from: string;
    to: string;
    sourceId: string;
    now: string;
  }): Promise<number> => {
    return await withSession(async (session) => {
      const result = await session.run(buildUpsertCooccurrenceEdge(), {
        from: input.from,
        to: input.to,
        sourceId: input.sourceId,
        now: input.now,
      });
      const value = result.records[0]?.get('count') as
        | { toNumber: () => number }
        | number
        | undefined;
      if (value === undefined) return 0;
      return typeof value === 'number' ? value : value.toNumber();
    });
  };

  const findClaimsForSubject = async (subject: string): Promise<ExistingClaimRecord[]> => {
    return await withSession(async (session) => {
      const result = await session.run(buildFindClaimsForSubject(), { subject });
      return result.records.map((r) => ({
        id: r.get('id') as string,
        subject: r.get('subject') as string,
        predicate: (r.get('predicate') as string | null) ?? '',
        object: (r.get('object') as string | null) ?? '',
        validAt: r.get('validAt') as string,
        invalidAt: r.get('invalidAt') as string | null,
        sourceId: r.get('sourceId') as string,
      }));
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
    listConceptSubgraph,
    findEntityByNormalizedSurface,
    findEntityByNormalizedSurfaceAcrossTypes,
    findClaimsForSubject,
    upsertCooccurrenceEdge,
    close,
  };
};
