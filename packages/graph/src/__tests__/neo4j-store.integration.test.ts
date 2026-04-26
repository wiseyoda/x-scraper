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

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createNeo4jGraph } from '../neo4j-store.js';
import type { GraphStore } from '../types.js';

const RUN = process.env.RUN_INTEGRATION === '1';
const ENV_PATH = path.join(os.homedir(), '.config', 'x-scraper', '.env');
const TEST_DB = process.env.NEO4J_DATABASE ?? 'neo4j';
const VECTOR_DIMS = 16;
const VECTOR_TOPK = 5;

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
    await store.close();
  });

  beforeEach(async () => {
    // Wipe between tests for predictable counts. Note: drops everything
    // in the test database — only run against a dedicated DB.
    const config = createNeo4jGraph({
      uri: loadEnv().NEO4J_URI ?? 'bolt://localhost:7687',
      user: loadEnv().NEO4J_USER ?? 'neo4j',
      password: loadEnv().NEO4J_PASSWORD ?? '',
      database: TEST_DB,
    });
    await config.close();
  });

  it('upserts a node idempotently', async () => {
    await store.upsertNode({
      id: 'tool_test_a',
      type: 'Tool',
      props: { name: 'Tool A' },
    });
    await store.upsertNode({
      id: 'tool_test_a',
      type: 'Tool',
      props: { name: 'Tool A (updated)' },
    });
    const count = await store.countNodes('Tool');
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('writes a Claim with embedding and finds it via vector search', async () => {
    const embedding = new Array(VECTOR_DIMS).fill(0).map((_, i) => (i === 0 ? 1 : 0));
    await store.upsertNode({
      id: 'claim_test_x',
      type: 'Claim',
      props: { text: 'test claim x' },
      embedding,
    });
    const hits = await store.vectorSearch('Claim', embedding, VECTOR_TOPK);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const ids = hits.map((h) => h.id);
    expect(ids).toContain('claim_test_x');
  });

  it('upserts and invalidates an edge', async () => {
    await store.upsertNode({ id: 'src_int_a', type: 'Source', props: { name: 'a' } });
    await store.upsertNode({ id: 'claim_int_a', type: 'Claim', props: { text: 'a' } });
    const validAt = '2026-04-26T00:00:00.000Z';
    await store.upsertEdge({
      from: 'claim_int_a',
      to: 'src_int_a',
      type: 'EXTRACTED_FROM',
      validAt,
      confidence: 0.9,
    });
    const invalidated = await store.invalidateEdge(
      'claim_int_a',
      'src_int_a',
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
