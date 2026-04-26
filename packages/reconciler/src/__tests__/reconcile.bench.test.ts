/**
 * Perf regression test for the per-claim reconciler.
 *
 * The reconciler is called once per claim during xs sync's reconcile
 * stage; on a 1k-claim source it adds a per-source overhead equal to
 * 1000 × per-claim cost. We assert each call completes in well under
 * 1ms (median over 1000 iterations) so that overhead stays negligible.
 *
 * Gated by RUN_BENCH=1.
 */

import { describe, expect, it } from 'vitest';

import { reconcileClaim } from '../reconcile.js';
import type { ExistingClaim, IncomingClaim } from '../types.js';

const RUN = process.env.RUN_BENCH === '1';
const ITERATIONS = 1_000;
const TARGET_MEDIAN_MS = 0.5;

const sampleIncoming: IncomingClaim = {
  id: 'claim_x',
  subject: 'kuzu',
  predicate: 'released_by',
  object: 'kuzu_team',
  text: 'Kùzu was released by the Kùzu team.',
  confidence: 0.9,
  sourceId: 'src_x',
};

const sampleExisting: ExistingClaim[] = Array.from({ length: 50 }, (_, i) => ({
  id: `claim_existing_${String(i)}`,
  subject: i === 0 ? 'kuzu' : `subject_${String(i)}`,
  predicate: i === 0 ? 'released_by' : `predicate_${String(i)}`,
  object: i === 0 ? 'kuzu_team_old' : `object_${String(i)}`,
  validAt: '2026-01-01T00:00:00.000Z',
  invalidAt: null,
  sourceId: `src_existing_${String(i)}`,
}));

describe.runIf(RUN)('reconcileClaim perf', () => {
  it(`median per call < ${String(TARGET_MEDIAN_MS)}ms over ${String(ITERATIONS)} iterations`, () => {
    const samples: number[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const start = performance.now();
      reconcileClaim({ incoming: sampleIncoming, existing: sampleExisting });
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)] ?? 0;
    // eslint-disable-next-line no-console
    console.log(`reconcileClaim median: ${median.toFixed(4)}ms`);
    expect(median).toBeLessThan(TARGET_MEDIAN_MS);
  });
});

describe.skipIf(RUN)('reconcileClaim perf (disabled)', () => {
  it('skipped — set RUN_BENCH=1 to enable', () => {
    expect(true).toBe(true);
  });
});
