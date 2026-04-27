import { describe, expect, it } from 'vitest';

import { clusterClaims, normalizeAnchor } from '../cluster.js';
import type { ClaimRef } from '../types.js';

const claim = (over: Partial<ClaimRef>): ClaimRef => ({
  id: over.id ?? 'claim_x',
  subject: over.subject ?? 'AI Agents',
  predicate: over.predicate ?? 'are',
  object: over.object ?? 'autonomous',
  text: over.text ?? 'AI agents are autonomous',
  confidence: over.confidence ?? 0.9,
  sourceId: over.sourceId ?? 'src_a',
});

describe('clusterClaims', () => {
  it('admits a cluster with >= 3 claims from >= 2 sources', () => {
    const result = clusterClaims([
      claim({ id: 'a', sourceId: 's1' }),
      claim({ id: 'b', sourceId: 's2' }),
      claim({ id: 'c', sourceId: 's3' }),
    ]);
    expect(result.admitted.length).toBe(1);
    expect(result.admitted[0]?.claims.length).toBe(3);
    expect(result.admitted[0]?.sourceIds.length).toBe(3);
    expect(result.belowThreshold).toBe(0);
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

  it('orders admitted clusters by claim count desc', () => {
    const claims: ClaimRef[] = [];
    for (let i = 0; i < 3; i += 1) {
      claims.push(claim({ id: `a${i.toString()}`, subject: 'A', sourceId: `s${i.toString()}` }));
    }
    for (let i = 0; i < 5; i += 1) {
      claims.push(claim({ id: `b${i.toString()}`, subject: 'B', sourceId: `s${i.toString()}` }));
    }
    const result = clusterClaims(claims);
    expect(result.admitted.map((c) => c.anchor)).toEqual(['b', 'a']);
  });

  it('honors custom thresholds', () => {
    const result = clusterClaims(
      [claim({ id: 'a', sourceId: 's1' }), claim({ id: 'b', sourceId: 's2' })],
      { minClaims: 2, minSources: 2 },
    );
    expect(result.admitted.length).toBe(1);
  });

  it('drops claims with empty subjects', () => {
    const result = clusterClaims([
      claim({ id: 'a', subject: '', sourceId: 's1' }),
      claim({ id: 'b', subject: '', sourceId: 's2' }),
      claim({ id: 'c', subject: '', sourceId: 's3' }),
    ]);
    expect(result.admitted.length).toBe(0);
  });
});

describe('normalizeAnchor', () => {
  it('lowercases and trims', () => {
    expect(normalizeAnchor('  AI Agents  ')).toBe('ai agents');
  });

  it('NFKC-normalizes', () => {
    // Full-width 'A' → ASCII 'a' under NFKC + lowercase.
    expect(normalizeAnchor('Ａ')).toBe('a');
  });
});
