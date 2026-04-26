/**
 * Perf regression test for contentHash (called once per source during
 * xs sync's write_vault stage; bottleneck on large bodies).
 *
 * Gated by RUN_BENCH=1.
 */

import { describe, expect, it } from 'vitest';

import { contentHash } from '../hashing.js';

const RUN = process.env.RUN_BENCH === '1';
const ITERATIONS = 1_000;
const TARGET_MEDIAN_MS = 1.0;
const SAMPLE_SIZE_KB = 50;

const buildBigBody = (kb: number): string => {
  const block = 'The quick brown fox jumps over the lazy dog.\n'.repeat(20); // ~900B
  let body = '';
  while (body.length < kb * 1024) body += block;
  return body.slice(0, kb * 1024);
};

describe.runIf(RUN)('contentHash perf', () => {
  it(`median per call < ${String(TARGET_MEDIAN_MS)}ms on a ${String(SAMPLE_SIZE_KB)}KB body`, () => {
    const body = buildBigBody(SAMPLE_SIZE_KB);
    const samples: number[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const start = performance.now();
      contentHash(body);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)] ?? 0;
    // eslint-disable-next-line no-console
    console.log(`contentHash median: ${median.toFixed(4)}ms (${String(SAMPLE_SIZE_KB)}KB)`);
    expect(median).toBeLessThan(TARGET_MEDIAN_MS);
  });
});

describe.skipIf(RUN)('contentHash perf (disabled)', () => {
  it('skipped — set RUN_BENCH=1 to enable', () => {
    expect(true).toBe(true);
  });
});
