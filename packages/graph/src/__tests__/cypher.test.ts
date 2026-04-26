import { describe, expect, it } from 'vitest';

import {
  assertValidEdgeType,
  assertValidLabel,
  buildCountNodes,
  buildIdConstraint,
  buildInvalidateEdge,
  buildTraversal,
  buildUpsertEdge,
  buildUpsertNode,
  buildUpsertNodeWithEmbedding,
  buildVectorIndex,
  buildVectorSearch,
} from '../cypher.js';
import { GraphError } from '../types.js';

describe('label / edge-type validation', () => {
  it('accepts known entity types', () => {
    expect(assertValidLabel('Claim')).toBe('Claim');
    expect(assertValidLabel('Tool')).toBe('Tool');
  });

  it('throws on unknown entity types', () => {
    expect(() => assertValidLabel('Bogus' as never)).toThrow(GraphError);
  });

  it('accepts known edge types', () => {
    expect(assertValidEdgeType('MENTIONED_IN')).toBe('MENTIONED_IN');
    expect(assertValidEdgeType('CONTRADICTS')).toBe('CONTRADICTS');
  });

  it('throws on unknown edge types', () => {
    expect(() => assertValidEdgeType('FRIENDS_WITH' as never)).toThrow(GraphError);
  });
});

describe('buildIdConstraint', () => {
  it('emits a parameterless DDL string', () => {
    const sql = buildIdConstraint('claim_id_unique', 'Claim');
    expect(sql).toContain('CREATE CONSTRAINT claim_id_unique');
    expect(sql).toContain('FOR (n:Claim)');
    expect(sql).toContain('REQUIRE n.id IS UNIQUE');
  });
});

describe('buildVectorIndex', () => {
  it('embeds dimensions and similarity function literally', () => {
    const sql = buildVectorIndex('claim_embed_idx', 'Claim', 'embedding', 1536, 'cosine');
    expect(sql).toContain('CREATE VECTOR INDEX claim_embed_idx');
    expect(sql).toContain('FOR (n:Claim) ON (n.embedding)');
    expect(sql).toContain('`vector.dimensions`: 1536');
    expect(sql).toContain("`vector.similarity_function`: 'cosine'");
  });
});

describe('buildUpsertNode', () => {
  it('uses MERGE with id and ON CREATE/MATCH SET', () => {
    const sql = buildUpsertNode('Source');
    expect(sql).toContain('MERGE (n:Source { id: $id })');
    expect(sql).toContain('ON CREATE SET n += $props');
    expect(sql).toContain('ON MATCH SET n += $props');
  });

  it('emits a separate query when an embedding is supplied', () => {
    const sql = buildUpsertNodeWithEmbedding('Claim');
    expect(sql).toContain('n.embedding = $embedding');
  });
});

describe('buildUpsertEdge', () => {
  it('writes valid_at, invalid_at, and confidence on both branches', () => {
    const sql = buildUpsertEdge('CONTRADICTS');
    expect(sql).toContain('CREATE (a)-[r:CONTRADICTS]->(b)');
    expect(sql).toContain('r.valid_at = $validAt');
    expect(sql).toContain('r.invalid_at = $invalidAt');
    expect(sql).toContain('r.confidence = $confidence');
  });

  it('only matches the current (invalid_at IS NULL) edge for re-upsert', () => {
    const sql = buildUpsertEdge('SUPPORTS');
    expect(sql).toContain('OPTIONAL MATCH (a)-[existing:SUPPORTS]->(b)');
    expect(sql).toContain('WHERE existing.invalid_at IS NULL');
    // Two FOREACH branches: one for create (existing IS NULL), one for update.
    expect(sql).toContain('CASE WHEN existing IS NULL');
    expect(sql).toContain('CASE WHEN existing IS NOT NULL');
  });
});

describe('buildInvalidateEdge', () => {
  it('targets only currently-valid edges', () => {
    const sql = buildInvalidateEdge('SUPPORTS');
    expect(sql).toContain('MATCH (a { id: $from })-[r:SUPPORTS]->(b { id: $to })');
    expect(sql).toContain('WHERE r.invalid_at IS NULL');
    expect(sql).toContain('SET r.invalid_at = $invalidAt');
  });
});

describe('buildVectorSearch', () => {
  it('calls db.index.vector.queryNodes', () => {
    const sql = buildVectorSearch('claim_embed_idx');
    expect(sql).toContain('CALL db.index.vector.queryNodes($index, $k, $embedding)');
    expect(sql).toContain('YIELD node, score');
  });
});

describe('buildTraversal', () => {
  it('rejects depth < 1', () => {
    expect(() => buildTraversal(0)).toThrow(GraphError);
  });

  it('builds an unfiltered traversal when no edge types are supplied', () => {
    const sql = buildTraversal(2);
    expect(sql).toContain('-[r*1..2]->(target)');
    expect(sql).toContain('rel.invalid_at IS NULL');
    expect(sql).toContain('UNWIND relationships(p) AS rel');
    // Sanity: no leftover placeholder from earlier flawed implementation.
    expect(sql).not.toContain('$_');
  });

  it('filters by the supplied edge types', () => {
    const sql = buildTraversal(2, ['MENTIONED_IN', 'AUTHORED_BY']);
    expect(sql).toContain('-[r:MENTIONED_IN|:AUTHORED_BY*1..2]->(target)');
  });

  it('rejects an unknown edge type in the filter', () => {
    expect(() => buildTraversal(2, ['BOGUS' as never])).toThrow(GraphError);
  });
});

describe('buildCountNodes', () => {
  it('counts everything when no label is supplied', () => {
    expect(buildCountNodes()).toBe('MATCH (n) RETURN count(n) AS n');
  });

  it('scopes to a label when supplied', () => {
    expect(buildCountNodes('Claim')).toBe('MATCH (n:Claim) RETURN count(n) AS n');
  });
});
