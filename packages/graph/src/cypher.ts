/**
 * Pure Cypher query builders. Every query string lives here so the
 * adapter is just `prepare + run + map`. Tests cover string output —
 * we never let an arbitrary EdgeType/EntityType reach the wire without
 * being whitelisted against the union.
 */

import { EDGE_TYPES, type EdgeType, ENTITY_TYPES, type EntityType } from '@x-scraper/core';

import { GraphError } from './types.js';

export const assertValidLabel = (type: EntityType): EntityType => {
  if (!ENTITY_TYPES.includes(type)) {
    throw new GraphError(`unknown entity type: ${type as string}`, 'INVALID_INPUT');
  }
  return type;
};

export const assertValidEdgeType = (type: EdgeType): EdgeType => {
  if (!EDGE_TYPES.includes(type)) {
    throw new GraphError(`unknown edge type: ${type as string}`, 'INVALID_INPUT');
  }
  return type;
};

export const buildIdConstraint = (constraintName: string, label: EntityType): string => {
  assertValidLabel(label);
  return `CREATE CONSTRAINT ${constraintName} IF NOT EXISTS FOR (n:${label}) REQUIRE n.id IS UNIQUE`;
};

export const buildVectorIndex = (
  indexName: string,
  label: EntityType,
  property: string,
  dims: number,
  similarity: string,
): string => {
  assertValidLabel(label);
  return `CREATE VECTOR INDEX ${indexName} IF NOT EXISTS
FOR (n:${label}) ON (n.${property})
OPTIONS { indexConfig: {
  \`vector.dimensions\`: ${dims.toString()},
  \`vector.similarity_function\`: '${similarity}'
}}`;
};

// Source/Claim/Topic stay as their own primary label; everything else
// (Person/Tool/Concept/Repo/Article/Tweet/Video/PDF) gets the meta-label
// `Entity` so a single entity_embed_idx covers them all. The multi-label
// is added on CREATE — existing nodes need a backfill SET to acquire it.
const ENTITY_META_TYPES: ReadonlySet<EntityType> = new Set<EntityType>([
  'Person',
  'Tool',
  'Concept',
  'Repo',
  'Article',
  'Tweet',
  'Video',
  'PDF',
]);

// MERGE only accepts a single label; the secondary :Entity label is
// added via SET in the same statement (see setMetaLabel below).
const labelClauseForUpsert = (label: EntityType): string => label;

const setMetaLabel = (label: EntityType): string =>
  ENTITY_META_TYPES.has(label) ? ', n:Entity' : '';

export const buildUpsertNode = (label: EntityType): string => {
  assertValidLabel(label);
  return `MERGE (n:${labelClauseForUpsert(label)} { id: $id })
ON CREATE SET n += $props${setMetaLabel(label)}
ON MATCH SET n += $props${setMetaLabel(label)}`;
};

export const buildUpsertNodeWithEmbedding = (label: EntityType): string => {
  assertValidLabel(label);
  return `MERGE (n:${labelClauseForUpsert(label)} { id: $id })
ON CREATE SET n += $props, n.embedding = $embedding${setMetaLabel(label)}
ON MATCH SET n += $props, n.embedding = $embedding${setMetaLabel(label)}`;
};

export const buildUpsertEdge = (edgeType: EdgeType): string => {
  assertValidEdgeType(edgeType);
  // Bi-temporal upsert: only the relationship with invalid_at IS NULL is the
  // "current" one. Re-upserting must update that current edge in place, but
  // must NEVER reset invalid_at on a previously invalidated edge — that would
  // erase history. We OPTIONAL MATCH on the current edge, then FOREACH to
  // either CREATE a new current edge (none exists) or SET the existing one.
  //
  // Exclude cooccurrence edges from this match path: cooccurrence-typed
  // RELATED_TO edges have kind='cooccurrence' and accumulate
  // sources[]/cooccurrence_count via buildUpsertCooccurrenceEdge. A
  // generic RELATED_TO upsert from the model must NOT match (and
  // overwrite) a cooccurrence edge between the same nodes.
  return `MATCH (a { id: $from }), (b { id: $to })
OPTIONAL MATCH (a)-[existing:${edgeType}]->(b)
WHERE existing.invalid_at IS NULL AND existing.kind IS NULL
FOREACH (_ IN CASE WHEN existing IS NULL THEN [1] ELSE [] END |
  CREATE (a)-[r:${edgeType}]->(b)
  SET r.valid_at = $validAt, r.invalid_at = $invalidAt,
      r.confidence = $confidence, r += $props
)
FOREACH (_ IN CASE WHEN existing IS NOT NULL THEN [1] ELSE [] END |
  SET existing.valid_at = $validAt, existing.invalid_at = $invalidAt,
      existing.confidence = $confidence, existing += $props
)
WITH a, b
OPTIONAL MATCH (a)-[r:${edgeType}]->(b)
WHERE r.invalid_at IS NULL AND r.kind IS NULL
RETURN r`;
};

export const buildInvalidateEdge = (edgeType: EdgeType): string => {
  assertValidEdgeType(edgeType);
  return `MATCH (a { id: $from })-[r:${edgeType}]->(b { id: $to })
WHERE r.invalid_at IS NULL
SET r.invalid_at = $invalidAt
RETURN count(r) AS n`;
};

export const buildVectorSearch = (_indexName: string): string =>
  `CALL db.index.vector.queryNodes($index, $k, $embedding)
YIELD node, score
RETURN node.id AS id, score`;

export const buildTraversal = (depth: number, edgeTypes?: EdgeType[]): string => {
  if (depth < 1) throw new GraphError('depth must be >= 1', 'INVALID_INPUT');
  const filter =
    edgeTypes !== undefined && edgeTypes.length > 0
      ? edgeTypes.map((t) => `:${assertValidEdgeType(t)}`).join('|')
      : '';
  // Variable-length walk up to `depth` hops; emit one row per traversed
  // relationship so callers can reconstruct the walk.
  return `MATCH p = (start { id: $startId })-[r${filter}*1..${depth.toString()}]->(target)
WHERE all(rel IN relationships(p) WHERE rel.invalid_at IS NULL)
UNWIND relationships(p) AS rel
RETURN startNode(rel).id AS fromId, type(rel) AS edgeType,
       endNode(rel).id AS toId, labels(endNode(rel))[0] AS toType
LIMIT 200`;
};

export const buildCountNodes = (label?: EntityType): string => {
  if (label === undefined) return `MATCH (n) RETURN count(n) AS n`;
  assertValidLabel(label);
  return `MATCH (n:${label}) RETURN count(n) AS n`;
};

// Reads the dimensions a vector index was created with, so init() can detect
// drift between the configured DEFAULT_EMBED_DIMS and what's already in the DB.
export const readVectorIndexDims = (): string =>
  `SHOW VECTOR INDEXES YIELD name, options
WHERE name = $name
RETURN options.indexConfig.\`vector.dimensions\` AS dims`;

/**
 * Find an entity of the given type by exact match on normalized_name OR
 * any member of normalized_aliases. Caller computes the surface forms
 * (cheap, deterministic — see reconciler/normalize.ts) and passes them
 * in. We accept up to a handful of forms; the index makes this O(1)-ish
 * per form.
 */
export const buildFindByNormalizedSurface = (label: EntityType): string => {
  assertValidLabel(label);
  return `MATCH (n:${label})
WHERE n.normalized_name IN $surfaces
   OR ANY(a IN coalesce(n.normalized_aliases, []) WHERE a IN $surfaces)
RETURN n.id AS id,
       coalesce(n.normalized_name, head(n.normalized_aliases)) AS matchedSurface
LIMIT 1`;
};

/**
 * Lookup current claims for a subject. Joins through the EXTRACTED_FROM
 * edge (current only — invalid_at IS NULL) so callers can invalidate
 * the right edge on UPDATE/DELETE.
 */
export const buildFindClaimsForSubject = (): string =>
  `MATCH (c:Claim {subject: $subject})-[r:EXTRACTED_FROM]->(s:Source)
WHERE coalesce(r.invalid_at, '') = ''
RETURN c.id AS id,
       c.subject AS subject,
       c.predicate AS predicate,
       c.object AS object,
       coalesce(r.valid_at, '') AS validAt,
       r.invalid_at AS invalidAt,
       s.id AS sourceId
ORDER BY validAt DESC
LIMIT 100`;

/**
 * Upsert a Concept-Concept co-occurrence edge. Unlike the bi-temporal
 * buildUpsertEdge — which models "current relationship" semantics with
 * explicit invalid_at — co-occurrence is additive: each new source that
 * mentions the same pair bumps cooccurrence_count + appends source_id
 * to the sources[] list. The MERGE keys on (from, to, kind) so a single
 * edge accumulates evidence rather than spawning parallel edges.
 *
 * Topic detection (Louvain) reads cooccurrence_count as edge weight in
 * a follow-up upgrade; for now any positive count counts.
 *
 * Self-loop guard at caller (we never call this with from == to).
 */
export const buildUpsertCooccurrenceEdge = (): string =>
  `MATCH (a {id: $from}), (b {id: $to})
MERGE (a)-[r:RELATED_TO {kind: 'cooccurrence'}]->(b)
ON CREATE SET r.cooccurrence_count = 1,
              r.sources = [$sourceId],
              r.created_at = $now,
              r.updated_at = $now
ON MATCH SET r.cooccurrence_count = CASE WHEN $sourceId IN coalesce(r.sources, [])
                                         THEN coalesce(r.cooccurrence_count, 0)
                                         ELSE coalesce(r.cooccurrence_count, 0) + 1
                                    END,
             r.sources = CASE WHEN $sourceId IN coalesce(r.sources, [])
                              THEN r.sources
                              ELSE coalesce(r.sources, []) + $sourceId
                         END,
             r.updated_at = $now
RETURN r.cooccurrence_count AS count`;
