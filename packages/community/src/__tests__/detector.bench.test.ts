/**
 * Perf regression test for community detection.
 *
 * Asserts that Louvain on a 200-node Erdős–Rényi graph completes within
 * a generous absolute budget (1 second on the user's machine). The
 * threshold is wide enough to absorb CI runner variance but tight enough
 * to catch a real regression (a 10× slowdown would fail).
 *
 * Gated by RUN_BENCH=1 because the timing varies across CI runners and
 * we don't want flaky failures on the routine PR build.
 */

import { describe, expect, it } from 'vitest';

import { detectCommunities } from '../detector.js';
import type { DetectorInput } from '../types.js';

const RUN = process.env.RUN_BENCH === '1';

const NODES_PER_CLUSTER = 50;
const NUM_CLUSTERS = 4;
const EDGES_INTRA = 12;
const EDGES_INTER = 2;
const TARGET_BUDGET_MS = 1_000;
const ITERATIONS = 5;

const buildSyntheticGraph = (): DetectorInput => {
  const nodes: DetectorInput['nodes'] = [];
  const edges: DetectorInput['edges'] = [];
  for (let c = 0; c < NUM_CLUSTERS; c += 1) {
    for (let i = 0; i < NODES_PER_CLUSTER; i += 1) {
      nodes.push({ id: `c${String(c)}_n${String(i)}`, type: 'Concept', name: `n${String(i)}` });
    }
    // Intra-cluster edges: dense within each cluster.
    for (let i = 0; i < NODES_PER_CLUSTER; i += 1) {
      for (let j = i + 1; j < Math.min(i + 1 + EDGES_INTRA, NODES_PER_CLUSTER); j += 1) {
        edges.push({
          from: `c${String(c)}_n${String(i)}`,
          to: `c${String(c)}_n${String(j)}`,
          type: 'RELATED_TO',
        });
      }
    }
    // Inter-cluster edges: a few bridges to neighboring clusters.
    if (c < NUM_CLUSTERS - 1) {
      for (let k = 0; k < EDGES_INTER; k += 1) {
        edges.push({
          from: `c${String(c)}_n${String(k)}`,
          to: `c${String(c + 1)}_n${String(k)}`,
          type: 'RELATED_TO',
        });
      }
    }
  }
  return { nodes, edges, minCommunitySize: 5 };
};

describe.runIf(RUN)('detectCommunities perf', () => {
  it(`completes ${String(NUM_CLUSTERS * NODES_PER_CLUSTER)} nodes in under ${String(TARGET_BUDGET_MS)}ms (median of ${String(ITERATIONS)} runs)`, () => {
    const input = buildSyntheticGraph();
    const samples: number[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const start = performance.now();
      const result = detectCommunities(input);
      const elapsed = performance.now() - start;
      samples.push(elapsed);
      expect(result.length).toBeGreaterThanOrEqual(NUM_CLUSTERS);
    }
    samples.sort((a, b) => a - b);
    const middle = Math.floor(samples.length / 2);
    const median = samples[middle] ?? 0;
    // eslint-disable-next-line no-console
    console.log(
      `detectCommunities median: ${median.toFixed(2)}ms (samples: ${samples.map((s) => s.toFixed(1)).join(', ')})`,
    );
    expect(median).toBeLessThan(TARGET_BUDGET_MS);
  });
});

describe.skipIf(RUN)('detectCommunities perf (disabled)', () => {
  it('skipped — set RUN_BENCH=1 to enable', () => {
    expect(true).toBe(true);
  });
});
