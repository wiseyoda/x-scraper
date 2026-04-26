/**
 * `xs reindex` tests. Verify that:
 *  - it loads sources from the vault
 *  - it runs the pipeline with skipVault=true (no vault writes)
 *  - it still updates the graph (which is the whole point)
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { EmbeddingProvider } from '@x-scraper/embeddings';
import type { GraphEdge, GraphNode, GraphStore } from '@x-scraper/graph';
import type { Ingestor } from '@x-scraper/ingestor';
import type { CompleteReply, LlmProvider } from '@x-scraper/llm';
import { createLogger } from '@x-scraper/observability';
import { createSqliteQueue } from '@x-scraper/queue';
import type { ErCandidateFinder } from '@x-scraper/reconciler';
import type { VaultRecord, VaultStore } from '@x-scraper/vault';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadSourcesFromVault, runReindex } from '../commands/reindex.js';
import type { ClaimFinder, SyncDeps } from '../commands/sync/index.js';

const TEST_DIMS = 4;

const stubLlm = (jsonReply: string): LlmProvider => ({
  provider: 'stub-llm',
  complete: (): Promise<CompleteReply> =>
    Promise.resolve({
      text: jsonReply,
      modelUsed: 'stub-sonnet',
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheCreateTokens: 0 },
      costUsd: 0.0001,
    }),
});

const stubEmbedder = (): EmbeddingProvider => ({
  provider: 'stub-embed',
  dims: TEST_DIMS,
  embed: (texts) =>
    Promise.resolve({
      vectors: texts.map((_t, i) => [i + 1, i + 2, i + 3, i + 4]),
      modelUsed: 'stub-embed-model',
      costUsd: 0.0001,
      inputTokens: 10,
    }),
});

const fakeGraph = (): GraphStore & { upserts: GraphNode[]; edges: GraphEdge[] } => {
  const upserts: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  return {
    upserts,
    edges,
    init: () => Promise.resolve(),
    upsertNode: (n) => {
      upserts.push(n);
      return Promise.resolve();
    },
    upsertEdge: (e) => {
      edges.push(e);
      return Promise.resolve();
    },
    invalidateEdge: () => Promise.resolve(0),
    vectorSearch: () => Promise.resolve([]),
    traverse: () => Promise.resolve([]),
    countNodes: () => Promise.resolve(upserts.length),
    close: () => Promise.resolve(),
  };
};

const SAMPLE_EXTRACTION = JSON.stringify({
  entities: [{ id: 'tool_kuzu', type: 'Tool', name: 'Kùzu', aliases: [] }],
  claims: [
    {
      id: 'claim_1',
      subject: 'kuzu',
      predicate: 'released_by',
      object: 'kuzu_team',
      text: 'Kùzu was released by the Kùzu team.',
      confidence: 0.9,
    },
  ],
  relationships: [],
});

let tmpDir: string;
let queuePath: string;
let vaultDir: string;

const stubVault = (records: VaultRecord[]): VaultStore & { writes: VaultRecord[] } => {
  const writes: VaultRecord[] = [];
  return {
    root: vaultDir,
    init: () => Promise.resolve(),
    write: (r) => {
      writes.push(r);
      return Promise.resolve(`${r.frontmatter.type}/${r.frontmatter.id}.md`);
    },
    read: (id, type) => {
      const found = records.find((r) => r.frontmatter.id === id && r.frontmatter.type === type);
      if (found === undefined) return Promise.reject(new Error('not found'));
      return Promise.resolve(found);
    },
    list: (type) =>
      Promise.resolve(
        records
          .filter((r) => type === undefined || r.frontmatter.type === type)
          .map((r) => ({
            id: r.frontmatter.id,
            type: r.frontmatter.type,
            relativePath: `${r.frontmatter.type}/${r.frontmatter.id}.md`,
            mtime: new Date(),
          })),
      ),
    commit: () => Promise.resolve(null),
    writes,
  };
};

const passthroughIngestor: Ingestor = {
  kind: 'article',
  matches: () => true,
  ingest: () => Promise.reject(new Error('reindex should not call ingestor — body is preloaded')),
};

const noErFinder: ErCandidateFinder = { findCandidates: () => Promise.resolve([]) };
const noClaimFinder: ClaimFinder = { findClaimsForSubject: () => Promise.resolve([]) };

const sampleSource = (id: string, url: string): VaultRecord => ({
  frontmatter: {
    id,
    type: 'Source',
    created_at: '2026-04-26T00:00:00.000Z',
    updated_at: '2026-04-26T00:00:00.000Z',
    prompt_version: { extraction: 1, reconciliation: 1, embedding: 1 },
    sources: [],
    aliases: [],
    tags: [],
    topics: [],
    url,
    canonical_url: url,
    captured_at: '2026-04-26T00:00:00.000Z',
    content_type: 'article',
    host_metadata: {},
  },
  body: 'Body of the source long enough to clear any minimums for the extractor.',
});

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xs-reindex-test-'));
  queuePath = path.join(tmpDir, 'queue.sqlite');
  vaultDir = path.join(tmpDir, 'vault');
  await fs.mkdir(vaultDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('loadSourcesFromVault', () => {
  it('returns one SourceItem per Source record with body preloaded', async () => {
    const vault = stubVault([
      sampleSource('src_a', 'https://example.com/a'),
      sampleSource('src_b', 'https://example.com/b'),
    ]);
    const items = await loadSourcesFromVault(vault);
    expect(items).toHaveLength(2);
    expect(items[0]?.body).toBeDefined();
    expect(items[0]?.url).toBe('https://example.com/a');
  });
});

describe('runReindex', () => {
  it('runs every source through the pipeline without writing back to the vault', async () => {
    const vault = stubVault([
      sampleSource('src_a', 'https://example.com/a'),
      sampleSource('src_b', 'https://example.com/b'),
    ]);
    const graph = fakeGraph();
    const queue = createSqliteQueue(queuePath);
    const deps: Omit<SyncDeps, 'loadSources'> = {
      queue,
      vault,
      graph,
      embeddings: stubEmbedder(),
      llm: stubLlm(SAMPLE_EXTRACTION),
      ingestors: [passthroughIngestor],
      logger: createLogger({ level: 'warn', sink: () => undefined }),
      erFinder: noErFinder,
      claimFinder: noClaimFinder,
      now: () => new Date('2026-04-26T00:00:00.000Z'),
    };
    const result = await runReindex(deps);
    queue.close();

    expect(result.sourcesLoaded).toBe(2);
    expect(result.jobsCompleted).toBe(2);
    expect(result.jobsDead).toBe(0);
    expect(vault.writes).toHaveLength(0); // skipVault → no vault writes
    expect(graph.upserts.length).toBeGreaterThan(0); // graph IS rebuilt
    expect(graph.upserts.filter((u) => u.type === 'Source')).toHaveLength(2);
    expect(graph.upserts.filter((u) => u.type === 'Claim').length).toBeGreaterThanOrEqual(2);
  });

  it('respects --limit', async () => {
    const vault = stubVault(
      Array.from({ length: 5 }, (_, i) =>
        sampleSource(`src_${String(i)}`, `https://e.com/${String(i)}`),
      ),
    );
    const queue = createSqliteQueue(queuePath);
    const deps: Omit<SyncDeps, 'loadSources'> = {
      queue,
      vault,
      graph: fakeGraph(),
      embeddings: stubEmbedder(),
      llm: stubLlm(SAMPLE_EXTRACTION),
      ingestors: [passthroughIngestor],
      logger: createLogger({ level: 'warn', sink: () => undefined }),
      erFinder: noErFinder,
      claimFinder: noClaimFinder,
      now: () => new Date('2026-04-26T00:00:00.000Z'),
    };
    const result = await runReindex(deps, { limit: 2 });
    queue.close();

    expect(result.sourcesLoaded).toBe(5);
    expect(result.jobsEnqueued).toBe(2);
    expect(result.jobsCompleted).toBe(2);
  });
});
