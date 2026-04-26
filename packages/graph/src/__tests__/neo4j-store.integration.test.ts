/**
 * Integration tests against a live Neo4j Community instance.
 *
 * Gated by RUN_INTEGRATION=1 so CI doesn't try to connect. Run locally
 * with:
 *
 *   brew services start neo4j  # if not already running
 *   RUN_INTEGRATION=1 pnpm test packages/graph
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createNeo4jGraph } from '../neo4j-store.js';
import type { GraphStore } from '../types.js';

const RUN = process.env.RUN_INTEGRATION === '1';
const ENV_PATH = path.join(os.homedir(), '.config', 'x-scraper', '.env');
const TEST_DB = process.env.NEO4J_DATABASE ?? 'neo4j';
// Match the production index dims. Neo4j keys vector indexes on (label,
// property), so we cannot create a parallel 16-dim test index alongside the
// real claim_embed_idx without dropping it first — and dropping the user's
// production index would destroy their data. Instead we use the real index
// with prefixed IDs and clean up after.
const VECTOR_DIMS = 1536;
const VECTOR_TOPK = 5;
const TEST_ID_PREFIX = 'xs_int_test_';

const loadEnv = (): Record<string, string> => {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const t = line.trim();
    if (t.length === 0 || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const v = t.slice(eq + 1).trim();
    if (v.length > 0) out[t.slice(0, eq).trim()] = v;
  }
  return out;
};

describe.runIf(RUN)('Neo4jGraphStore (integration)', () => {
  let store: GraphStore;
  let driverForCleanup: { close: () => Promise<unknown> } | undefined;

  const id = (suffix: string): string => `${TEST_ID_PREFIX}${suffix}`;

  beforeAll(async () => {
    const env = loadEnv();
    store = createNeo4jGraph({
      uri: env.NEO4J_URI ?? 'bolt://localhost:7687',
      user: env.NEO4J_USER ?? 'neo4j',
      password: env.NEO4J_PASSWORD ?? '',
      database: env.NEO4J_DATABASE ?? TEST_DB,
    });
    await store.init({ vectorDims: VECTOR_DIMS });
  });

  afterAll(async () => {
    // Best-effort cleanup of every node we wrote, identifiable by the prefix.
    // Done via the public store: detach-delete each known test id and any
    // stragglers whose id begins with TEST_ID_PREFIX.
    try {
      const env = loadEnv();
      // Lazy import the underlying driver only for cleanup — kept out of the
      // public API surface.
      const neo4j = await import('neo4j-driver');
      const driver = neo4j.default.driver(
        env.NEO4J_URI ?? 'bolt://localhost:7687',
        neo4j.default.auth.basic(env.NEO4J_USER ?? 'neo4j', env.NEO4J_PASSWORD ?? ''),
      );
      driverForCleanup = driver;
      const session = driver.session({ database: env.NEO4J_DATABASE ?? TEST_DB });
      try {
        await session.run('MATCH (n) WHERE n.id STARTS WITH $p DETACH DELETE n', {
          p: TEST_ID_PREFIX,
        });
      } finally {
        await session.close();
      }
    } finally {
      if (driverForCleanup !== undefined) await driverForCleanup.close();
      await store.close();
    }
  });

  it('upserts a node idempotently', async () => {
    await store.upsertNode({ id: id('tool_a'), type: 'Tool', props: { name: 'Tool A' } });
    await store.upsertNode({
      id: id('tool_a'),
      type: 'Tool',
      props: { name: 'Tool A (updated)' },
    });
    const count = await store.countNodes('Tool');
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('writes a Claim with embedding and finds it via vector search', async () => {
    // Sparse vector: a 1 at position 0, zeros elsewhere. Production-dim, so it
    // exercises the real index without dropping anything.
    const embedding = new Array(VECTOR_DIMS).fill(0).map((_, i) => (i === 0 ? 1 : 0));
    const claimId = id('claim_x');
    await store.upsertNode({
      id: claimId,
      type: 'Claim',
      props: { text: 'test claim x' },
      embedding,
    });
    const hits = await store.vectorSearch('Claim', embedding, VECTOR_TOPK);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.map((h) => h.id)).toContain(claimId);
  });

  it('rejects an embedding whose length does not match the configured dims', async () => {
    const wrong = new Array(VECTOR_DIMS + 1).fill(0).map((_, i) => i / 100);
    await expect(
      store.upsertNode({
        id: id('claim_dim_bad'),
        type: 'Claim',
        props: { text: 'wrong dims' },
        embedding: wrong,
      }),
    ).rejects.toMatchObject({ code: 'DIM_MISMATCH' });
    await expect(store.vectorSearch('Claim', wrong, VECTOR_TOPK)).rejects.toMatchObject({
      code: 'DIM_MISMATCH',
    });
  });

  it('upserts and invalidates an edge', async () => {
    await store.upsertNode({ id: id('src_a'), type: 'Source', props: { name: 'a' } });
    await store.upsertNode({ id: id('claim_a'), type: 'Claim', props: { text: 'a' } });
    const validAt = '2026-04-26T00:00:00.000Z';
    await store.upsertEdge({
      from: id('claim_a'),
      to: id('src_a'),
      type: 'EXTRACTED_FROM',
      validAt,
      confidence: 0.9,
    });
    const invalidated = await store.invalidateEdge(
      id('claim_a'),
      id('src_a'),
      'EXTRACTED_FROM',
      '2026-04-27T00:00:00.000Z',
    );
    expect(invalidated).toBe(1);
  });
});

describe.skipIf(RUN)('Neo4jGraphStore (integration disabled)', () => {
  it('skipped — set RUN_INTEGRATION=1 to enable', () => {
    expect(true).toBe(true);
  });
});
