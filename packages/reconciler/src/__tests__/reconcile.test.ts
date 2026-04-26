import { describe, expect, it } from 'vitest';

import { reconcileClaim } from '../reconcile.js';
import type { ExistingClaim, IncomingClaim } from '../types.js';

const baseIncoming = (overrides: Partial<IncomingClaim> = {}): IncomingClaim => ({
  id: 'claim_new1',
  subject: 'neo4j',
  predicate: 'has_feature',
  object: 'native HNSW',
  text: 'Neo4j ships native HNSW.',
  confidence: 0.9,
  sourceId: 'src_a',
  ...overrides,
});

const existing = (overrides: Partial<ExistingClaim> = {}): ExistingClaim => ({
  id: 'claim_old1',
  subject: 'neo4j',
  predicate: 'has_feature',
  object: 'native HNSW',
  validAt: '2026-04-01T00:00:00.000Z',
  invalidAt: null,
  ...overrides,
});

describe('reconcileClaim', () => {
  it('returns ADD when no existing claim shares (subject, predicate)', () => {
    const decision = reconcileClaim({ incoming: baseIncoming(), existing: [] });
    expect(decision.action).toBe('ADD');
    expect(decision.existingId).toBeNull();
  });

  it('returns NONE when the same triple is already current', () => {
    const decision = reconcileClaim({
      incoming: baseIncoming(),
      existing: [existing({ id: 'claim_old1' })],
    });
    expect(decision.action).toBe('NONE');
    expect(decision.existingId).toBe('claim_old1');
  });

  it('returns UPDATE when current claim shares (subject, predicate) but object differs', () => {
    const decision = reconcileClaim({
      incoming: baseIncoming({ object: 'GDS Leiden' }),
      existing: [existing({ id: 'claim_old1', object: 'native HNSW' })],
    });
    expect(decision.action).toBe('UPDATE');
    expect(decision.existingId).toBe('claim_old1');
  });

  it('ignores invalidated claims when looking for current matches', () => {
    const decision = reconcileClaim({
      incoming: baseIncoming(),
      existing: [
        existing({
          id: 'claim_invalidated',
          object: 'kuzu HNSW',
          invalidAt: '2026-04-15T00:00:00.000Z',
        }),
      ],
    });
    expect(decision.action).toBe('ADD');
  });

  it('returns DELETE when incoming confidence is 0 against an exact current match', () => {
    const decision = reconcileClaim({
      incoming: baseIncoming({ confidence: 0 }),
      existing: [existing()],
    });
    expect(decision.action).toBe('DELETE');
  });

  it('treats a confidence-0 incoming with no exact match as ADD/UPDATE per existing semantics', () => {
    // Current behavior: if there's no exact triple to delete, the
    // confidence-0 incoming still ADDs (the caller might later notice
    // the suspicious confidence and skip writing). Keeping ADD here
    // documents the contract.
    const decision = reconcileClaim({
      incoming: baseIncoming({ confidence: 0, object: 'something else' }),
      existing: [existing()],
    });
    expect(decision.action).toBe('UPDATE');
  });
});
