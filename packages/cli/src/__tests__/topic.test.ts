/**
 * `xs topic detect` tests with stubbed graph, llm, and vault. We don't
 * need to exercise the Louvain detector itself (the community package
 * has its own tests); we exercise the wiring: subgraph load, dispatch
 * to detector, synthesis pass, vault writes, graph upserts.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { GraphEdge, GraphNode, GraphStore } from '@x-scraper/graph';
import type { CompleteReply, CompleteRequest, LlmProvider } from '@x-scraper/llm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runTopicDetect } from '../commands/topic.js';
import type { CliConfig } from '../config.js';

let dbDir = '';
let config: CliConfig;

beforeEach(async () => {
  dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xs-topic-test-'));
  config = {
    vaultDir: path.join(dbDir, 'vault'),
    queuePath: path.join(dbDir, 'q.sqlite'),
  };
});

afterEach(async () => {
  await fs.rm(dbDir, { recursive: true, force: true });
});

const fakeGraph = (
  nodes: { id: string; name: string }[],
  edges: { from: string; to: string }[],
): GraphStore & { upserts: GraphNode[]; edges: GraphEdge[] } => {
  const upserts: GraphNode[] = [];
  const writtenEdges: GraphEdge[] = [];
  return {
    upserts,
    edges: writtenEdges,
    init: () => Promise.resolve(),
    upsertNode: (n) => {
      upserts.push(n);
      return Promise.resolve();
    },
    upsertEdge: (e) => {
      writtenEdges.push(e);
      return Promise.resolve();
    },
    invalidateEdge: () => Promise.resolve(0),
    vectorSearch: () => Promise.resolve([]),
    traverse: () => Promise.resolve([]),
    countNodes: () => Promise.resolve(0),
    listConceptSubgraph: () =>
      Promise.resolve({
        nodes: nodes.map((n) => ({ id: n.id, type: 'Concept' as const, name: n.name })),
        edges: edges.map((e) => ({
          from: e.from,
          to: e.to,
          type: 'RELATED_TO' as const,
          cooccurrenceCount: 1,
          lastObservedAt: null,
        })),
      }),
    findEntityByNormalizedSurface: () => Promise.resolve(null),
    findClaimsForSubject: () => Promise.resolve([]),
    upsertCooccurrenceEdge: () => Promise.resolve(1),
    close: () => Promise.resolve(),
  };
};

const stubLlm = (jsonReply: string): LlmProvider => ({
  provider: 'stub',
  complete: (_req: CompleteRequest): Promise<CompleteReply> =>
    Promise.resolve({
      text: jsonReply,
      modelUsed: 'stub-sonnet',
      stopReason: 'end_turn',
      usage: { inputTokens: 50, outputTokens: 30, cacheReadTokens: 0, cacheCreateTokens: 0 },
      costUsd: 0.001,
    }),
});

describe('runTopicDetect', () => {
  it('returns zero topics when the subgraph is empty', async () => {
    const graph = fakeGraph([], []);
    const result = await runTopicDetect(config, { graph });
    expect(result.communitiesFound).toBe(0);
    expect(result.topicsWritten).toBe(0);
  });

  it('detects communities, writes Topic.md and edges (no synthesis)', async () => {
    // Two clusters of 5: a-b-c-d-e and f-g-h-i-j
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((id) => ({
      id,
      name: id.toUpperCase(),
    }));
    const edges: { from: string; to: string }[] = [];
    const link = (xs: string[]): void => {
      for (let i = 0; i < xs.length; i += 1) {
        for (let j = i + 1; j < xs.length; j += 1) {
          const a = xs[i];
          const b = xs[j];
          if (a !== undefined && b !== undefined) {
            edges.push({ from: a, to: b });
            edges.push({ from: b, to: a });
          }
        }
      }
    };
    link(['a', 'b', 'c', 'd', 'e']);
    link(['f', 'g', 'h', 'i', 'j']);

    const graph = fakeGraph(nodes, edges);
    const result = await runTopicDetect(config, {
      graph,
      synthesize: false,
      minCommunitySize: 5,
    });

    expect(result.communitiesFound).toBeGreaterThanOrEqual(2);
    expect(result.topicsWritten).toBe(result.communitiesFound);
    // Each community member -> Topic edge.
    expect(graph.edges.length).toBeGreaterThanOrEqual(10);
    // Topic nodes upserted.
    const topicNodes = graph.upserts.filter((n) => n.type === 'Topic');
    expect(topicNodes.length).toBe(result.topicsWritten);
  });

  it('uses the LLM to title topics when --synthesize is set', async () => {
    const nodes = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => ({ id, name: id }));
    const edges: { from: string; to: string }[] = [];
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        edges.push({ from: `p${String(i + 1)}`, to: `p${String(j + 1)}` });
      }
    }
    const graph = fakeGraph(nodes, edges);
    const llm = stubLlm(
      JSON.stringify({ title: 'Programming Languages', summary: 'A cluster about programming.' }),
    );
    const result = await runTopicDetect(config, {
      graph,
      llm,
      synthesize: true,
      minCommunitySize: 5,
    });
    expect(result.topics[0]?.title).toBe('Programming Languages');
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it('falls back to deterministic title when LLM returns malformed JSON', async () => {
    const nodes = ['x1', 'x2', 'x3', 'x4', 'x5'].map((id) => ({ id, name: id.toUpperCase() }));
    const edges: { from: string; to: string }[] = [];
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        edges.push({ from: `x${String(i + 1)}`, to: `x${String(j + 1)}` });
      }
    }
    const graph = fakeGraph(nodes, edges);
    const llm = stubLlm('not json at all');
    const result = await runTopicDetect(config, {
      graph,
      llm,
      synthesize: true,
      minCommunitySize: 5,
    });
    // Falls back to the first member name.
    expect(result.topics[0]?.title).toBeTruthy();
  });

  it('respects --dry-run (no vault or graph writes)', async () => {
    const nodes = ['n1', 'n2', 'n3', 'n4', 'n5'].map((id) => ({ id, name: id }));
    const edges: { from: string; to: string }[] = [];
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        edges.push({ from: `n${String(i + 1)}`, to: `n${String(j + 1)}` });
      }
    }
    const graph = fakeGraph(nodes, edges);
    const result = await runTopicDetect(config, {
      graph,
      synthesize: false,
      minCommunitySize: 5,
      dryRun: true,
    });
    expect(result.communitiesFound).toBeGreaterThan(0);
    expect(result.topicsWritten).toBe(0);
    expect(graph.edges.length).toBe(0);
    expect(graph.upserts.length).toBe(0);
  });
});
