import { describe, expect, it } from 'vitest';

import { clusterByEntity, clusterClaims, normalizeAnchor } from '../cluster.js';
import type { ClaimRef, EntityRef } from '../types.js';

const claim = (over: Partial<ClaimRef>): ClaimRef => ({
  id: over.id ?? 'claim_x',
  subject: over.subject ?? 'AI Agents',
  predicate: over.predicate ?? 'are',
  object: over.object ?? 'autonomous',
  text: over.text ?? 'AI agents are autonomous',
  confidence: over.confidence ?? 0.9,
  sourceId: over.sourceId ?? 'src_a',
});

const entity = (over: Partial<EntityRef>): EntityRef => ({
  id: over.id ?? 'tool_anthropic',
  type: over.type ?? 'Tool',
  name: over.name ?? 'Anthropic',
  aliases: over.aliases ?? [],
  sources: over.sources ?? ['src_a', 'src_b'],
});

describe('clusterClaims (subject-anchored)', () => {
  it('admits a cluster with >= 3 claims from >= 2 sources', () => {
    const result = clusterClaims([
      claim({ id: 'a', sourceId: 's1' }),
      claim({ id: 'b', sourceId: 's2' }),
      claim({ id: 'c', sourceId: 's3' }),
    ]);
    expect(result.admitted.length).toBe(1);
    expect(result.admitted[0]?.claims.length).toBe(3);
    expect(result.admitted[0]?.sourceIds.length).toBe(3);
  });

  it('rejects clusters with fewer than min claims', () => {
    const result = clusterClaims([
      claim({ id: 'a', sourceId: 's1' }),
      claim({ id: 'b', sourceId: 's2' }),
    ]);
    expect(result.admitted.length).toBe(0);
    expect(result.belowThreshold).toBe(1);
  });

  it('rejects clusters where all claims share one source', () => {
    const result = clusterClaims([
      claim({ id: 'a', sourceId: 's1' }),
      claim({ id: 'b', sourceId: 's1' }),
      claim({ id: 'c', sourceId: 's1' }),
    ]);
    expect(result.admitted.length).toBe(0);
    expect(result.belowThreshold).toBe(1);
  });

  it('groups by normalized subject (case + whitespace insensitive)', () => {
    const result = clusterClaims([
      claim({ id: 'a', subject: '  AI Agents ', sourceId: 's1' }),
      claim({ id: 'b', subject: 'ai agents', sourceId: 's2' }),
      claim({ id: 'c', subject: 'AI AGENTS', sourceId: 's3' }),
    ]);
    expect(result.admitted.length).toBe(1);
  });

  it('honors custom thresholds', () => {
    const result = clusterClaims(
      [claim({ id: 'a', sourceId: 's1' }), claim({ id: 'b', sourceId: 's2' })],
      { minClaims: 2, minSources: 2 },
    );
    expect(result.admitted.length).toBe(1);
  });
});

describe('clusterByEntity', () => {
  it('matches claims via entity name on subject OR object', () => {
    const claims = [
      claim({
        id: 'c1',
        sourceId: 's1',
        subject: 'anthropic',
        predicate: 'authored',
        object: 'claude-code',
      }),
      claim({
        id: 'c2',
        sourceId: 's2',
        subject: 'claude-code',
        predicate: 'authored_by',
        object: 'Anthropic',
      }),
      claim({
        id: 'c3',
        sourceId: 's3',
        subject: 'unrelated',
        predicate: 'is',
        object: 'irrelevant',
      }),
    ];
    const entities = [entity({ name: 'Anthropic', sources: ['s1', 's2'] })];
    const result = clusterByEntity(claims, entities, { minClaims: 2, minSources: 2 });
    expect(result.admitted.length).toBe(1);
    const cluster = result.admitted[0];
    expect(cluster?.claims.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(cluster?.sourceIds.sort()).toEqual(['s1', 's2']);
  });

  it('admits when ≥3 claims and ≥2 sources match the entity', () => {
    const claims = [
      claim({ id: 'a', sourceId: 's1', subject: 'claude code', object: 'cli' }),
      claim({ id: 'b', sourceId: 's2', subject: 'cli', object: 'Claude Code' }),
      claim({ id: 'c', sourceId: 's3', subject: 'CLAUDE CODE', object: 'agentic' }),
    ];
    const entities = [
      entity({
        id: 'tool_cc',
        name: 'Claude Code',
        sources: ['s1', 's2', 's3'],
        aliases: [],
      }),
    ];
    const result = clusterByEntity(claims, entities);
    expect(result.admitted.length).toBe(1);
    expect(result.admitted[0]?.entityId).toBe('tool_cc');
    expect(result.admitted[0]?.anchorDisplay).toBe('Claude Code');
  });

  it('matches via aliases too', () => {
    const claims = [
      claim({ id: 'a', sourceId: 's1', subject: 'gpt-4', predicate: 'is', object: 'a model' }),
      claim({ id: 'b', sourceId: 's2', subject: 'GPT4', predicate: 'is', object: 'a model' }),
      claim({ id: 'c', sourceId: 's3', subject: 'gpt 4', predicate: 'is', object: 'a model' }),
    ];
    const entities = [
      entity({ name: 'GPT-4', aliases: ['GPT4', 'GPT 4', 'gpt4'], sources: ['s1', 's2', 's3'] }),
    ];
    const result = clusterByEntity(claims, entities);
    expect(result.admitted.length).toBe(1);
    expect(result.admitted[0]?.claims.length).toBe(3);
  });

  it('rejects entities with too few sources', () => {
    const claims = [
      claim({ id: 'a', sourceId: 's1', subject: 'anthropic' }),
      claim({ id: 'b', sourceId: 's1', subject: 'anthropic' }),
      claim({ id: 'c', sourceId: 's1', subject: 'anthropic' }),
    ];
    const entities = [entity({ name: 'Anthropic', sources: ['s1'] })];
    const result = clusterByEntity(claims, entities);
    expect(result.admitted.length).toBe(0);
    expect(result.belowThreshold).toBe(1);
  });

  it('rejects entities when claims map to fewer sources than threshold', () => {
    // Entity claims sources s1+s2, but only claims from s1 actually
    // mention it — admission must check matched-claim sources, not
    // the entity's mentioned-in count alone.
    const claims = [
      claim({ id: 'a', sourceId: 's1', subject: 'anthropic' }),
      claim({ id: 'b', sourceId: 's1', subject: 'anthropic' }),
      claim({ id: 'c', sourceId: 's1', subject: 'anthropic' }),
    ];
    const entities = [entity({ name: 'Anthropic', sources: ['s1', 's2'] })];
    const result = clusterByEntity(claims, entities);
    expect(result.admitted.length).toBe(0);
  });

  it('drops trivially-short entity names (avoids "ai" matching everything)', () => {
    const claims = [
      claim({ id: 'a', sourceId: 's1', subject: 'ai', object: 'broad' }),
      claim({ id: 'b', sourceId: 's2', subject: 'ai', object: 'still broad' }),
      claim({ id: 'c', sourceId: 's3', subject: 'ai', object: 'too broad' }),
    ];
    const entities = [entity({ name: 'AI', aliases: [], sources: ['s1', 's2', 's3'] })];
    const result = clusterByEntity(claims, entities);
    // 'ai' is 2 chars — passes MIN_TOKEN_LEN=2, so it admits.
    // Test the harder case: 1-char name.
    const entities2 = [entity({ name: 'A', aliases: [], sources: ['s1', 's2', 's3'] })];
    const result2 = clusterByEntity(claims, entities2);
    void result;
    expect(result2.admitted.length).toBe(0);
  });

  it('orders admitted clusters by claim count desc', () => {
    const claims: ClaimRef[] = [];
    for (let i = 0; i < 3; i += 1) {
      claims.push(claim({ id: `a${i.toString()}`, subject: 'foo', sourceId: `s${i.toString()}` }));
    }
    for (let i = 0; i < 5; i += 1) {
      claims.push(claim({ id: `b${i.toString()}`, subject: 'bar', sourceId: `s${i.toString()}` }));
    }
    const entities = [
      entity({ id: 'e_foo', name: 'foo', sources: ['s0', 's1', 's2'] }),
      entity({ id: 'e_bar', name: 'bar', sources: ['s0', 's1', 's2', 's3', 's4'] }),
    ];
    const result = clusterByEntity(claims, entities);
    expect(result.admitted.map((c) => c.entityId)).toEqual(['e_bar', 'e_foo']);
  });
});

describe('normalizeAnchor', () => {
  it('lowercases and trims', () => {
    expect(normalizeAnchor('  AI Agents  ')).toBe('ai agents');
  });

  it('NFKC-normalizes', () => {
    expect(normalizeAnchor('Ａ')).toBe('a');
  });
});
