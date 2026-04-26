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

export const buildUpsertNode = (label: EntityType): string => {
  assertValidLabel(label);
  return `MERGE (n:${label} { id: $id })
ON CREATE SET n += $props
ON MATCH SET n += $props`;
};

export const buildUpsertNodeWithEmbedding = (label: EntityType): string => {
  assertValidLabel(label);
  return `MERGE (n:${label} { id: $id })
ON CREATE SET n += $props, n.embedding = $embedding
ON MATCH SET n += $props, n.embedding = $embedding`;
};

export const buildUpsertEdge = (edgeType: EdgeType): string => {
  assertValidEdgeType(edgeType);
  // Bi-temporal upsert: only the relationship with invalid_at IS NULL is the
  // "current" one. Re-upserting must update that current edge in place, but
  // must NEVER reset invalid_at on a previously invalidated edge — that would
  // erase history. We OPTIONAL MATCH on the current edge, then FOREACH to
  // either CREATE a new current edge (none exists) or SET the existing one.
  return `MATCH (a { id: $from }), (b { id: $to })
OPTIONAL MATCH (a)-[existing:${edgeType}]->(b)
WHERE existing.invalid_at IS NULL
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
WHERE r.invalid_at IS NULL
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
