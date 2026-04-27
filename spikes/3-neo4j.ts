/**
 * Spike 3 — Neo4j schema, vector index, traversal benchmark.
 *
 * Originally targeted Kùzu; pivoted to Neo4j Community after Kùzu was
 * abandoned (Apple acquisition, Oct 2025) and the next-most-promising
 * fork (RyuGraph) went stale 5+ months. Neo4j is the active, mature,
 * brew-installed (`brew install neo4j; brew services start neo4j`)
 * pick — JVM daemon, native HNSW vector index, full Cypher, Apache-2.0
 * driver, GDS lib for Leiden community detection.
 *
 * Goal: confirm neo4j-driver works against the local instance, schema
 * + indexes can be created, and vector search + 2-hop traversal both
 * run under 100 ms each on a 1k-claim synthetic corpus.
 *
 * Prereq:
 *   brew install neo4j
 *   brew services start neo4j
 *   # First connect and reset password — see ~/.config/x-scraper/.env
 *
 * Run:  pnpm spike spikes/3-neo4j.ts
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Driver, Session } from 'neo4j-driver';
import neo4j from 'neo4j-driver';

const ENV_PATH = path.join(os.homedir(), '.config', 'x-scraper', '.env');
const NUM_CLAIMS = 1000;
const NUM_CONCEPTS = 80;
const EMBED_DIMS = 1536;
const VECTOR_TOPK = 10;
const PER_OP_BUDGET_MS = 100;
const MENTIONS_PRIME_OFFSET = 7;
const MENTIONS_PRIME_SHIFT = 3;
const RANGE_HALF = 2;
const BATCH_SIZE = 100;
const VECTOR_INDEX_WAIT_MS = 5_000;

const loadEnv = (): Record<string, string> => {
  const text = fs.readFileSync(ENV_PATH, 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.length === 0 || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (v.length > 0) out[k] = v;
  }
  return out;
};

const time = async <T>(label: string, fn: () => Promise<T>): Promise<{ result: T; ms: number }> => {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  console.log(`  ${label}: ${ms.toFixed(2)} ms`);
  return { result, ms };
};

const randomEmbedding = (): number[] => {
  const out = new Array<number>(EMBED_DIMS);
  let normSq = 0;
  for (let i = 0; i < EMBED_DIMS; i += 1) {
    const v = Math.random() * RANGE_HALF - 1;
    out[i] = v;
    normSq += v * v;
  }
  const norm = Math.sqrt(normSq);
  for (let i = 0; i < EMBED_DIMS; i += 1) {
    out[i] = (out[i] ?? 0) / norm;
  }
  return out;
};

// Every node this spike writes is keyed under this prefix so cleanup is a
// scoped DELETE — never the bulk `MATCH (n) DETACH DELETE n` that nuked
// production once. Convention: any spike that talks to the live Neo4j
// MUST prefix its node IDs with `xs_spike<N>_` and DETACH DELETE in its
// `finally` block. Documented in CLAUDE.md.
const SPIKE_PREFIX = 'xs_spike3_';

const refuseIfDbIsPopulated = async (session: Session): Promise<void> => {
  // Guard: this spike used to call `MATCH (n) DETACH DELETE n` which would
  // wipe a populated production graph. Refuse to start if the DB looks like
  // it already has real data.
  const r = await session.run(`MATCH (n) WHERE NOT n.id STARTS WITH $p RETURN count(n) AS n`, {
    p: SPIKE_PREFIX,
  });
  const raw = r.records[0]?.get('n') as { toNumber: () => number } | number | undefined;
  const n = raw === undefined ? 0 : typeof raw === 'number' ? raw : raw.toNumber();
  if (n > 0) {
    throw new Error(
      `refusing to run: Neo4j has ${n.toString()} non-spike nodes. ` +
        `This spike is destructive (drops indexes/constraints) and was the ` +
        `original source of the claim-{i} test pollution. Run only against ` +
        `an empty database, or rename the spike to be prefix-only.`,
    );
  }
};

const wipeSpikeData = async (session: Session): Promise<void> => {
  await session.run(`MATCH (n) WHERE n.id STARTS WITH $p DETACH DELETE n`, { p: SPIKE_PREFIX });
  await session.run(`DROP INDEX claim_embed_idx IF EXISTS`).catch(() => undefined);
  await session.run(`DROP CONSTRAINT concept_id_unique IF EXISTS`).catch(() => undefined);
  await session.run(`DROP CONSTRAINT source_id_unique IF EXISTS`).catch(() => undefined);
  await session.run(`DROP CONSTRAINT claim_id_unique IF EXISTS`).catch(() => undefined);
};

const main = async (): Promise<void> => {
  const env = loadEnv();
  const uri = env.NEO4J_URI ?? 'bolt://localhost:7687';
  const user = env.NEO4J_USER ?? 'neo4j';
  const password = env.NEO4J_PASSWORD;
  if (password === undefined) throw new Error('NEO4J_PASSWORD missing in env');
  const dbName = env.NEO4J_DATABASE ?? 'neo4j';

  console.log(`connecting: ${uri} (db=${dbName})`);
  const driver: Driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  await driver.verifyConnectivity();
  const info = await driver.getServerInfo();
  console.log(`neo4j server: ${info.agent ?? '(unknown)'}`);

  const session = driver.session({ database: dbName });
  try {
    await refuseIfDbIsPopulated(session);
    console.log('\n=== schema ===');
    await time('wipe prior spike data + indexes', async () => {
      await wipeSpikeData(session);
    });

    await time('create node-id constraints', async () => {
      await session.run(
        `CREATE CONSTRAINT concept_id_unique FOR (c:Concept) REQUIRE c.id IS UNIQUE`,
      );
      await session.run(`CREATE CONSTRAINT source_id_unique FOR (s:Source) REQUIRE s.id IS UNIQUE`);
      await session.run(`CREATE CONSTRAINT claim_id_unique FOR (cl:Claim) REQUIRE cl.id IS UNIQUE`);
    });

    await time('create HNSW vector index on Claim.embedding', async () => {
      await session.run(
        `CREATE VECTOR INDEX claim_embed_idx IF NOT EXISTS
         FOR (c:Claim) ON (c.embedding)
         OPTIONS { indexConfig: {
           \`vector.dimensions\`: $dims,
           \`vector.similarity_function\`: 'cosine'
         }}`,
        { dims: neo4j.int(EMBED_DIMS) },
      );
    });

    console.log('\n=== insert ===');
    await time(`insert ${String(NUM_CONCEPTS)} concepts`, async () => {
      const concepts = Array.from({ length: NUM_CONCEPTS }, (_, i) => ({
        id: `${SPIKE_PREFIX}concept-${String(i)}`,
        name: `Concept ${String(i)}`,
      }));
      await session.run(`UNWIND $rows AS row CREATE (c:Concept {id: row.id, name: row.name})`, {
        rows: concepts,
      });
    });

    await time('insert 1 source', async () => {
      await session.run(`CREATE (s:Source {id: $id, url: 'https://example.com/0'})`, {
        id: `${SPIKE_PREFIX}source-0`,
      });
    });

    await time(`insert ${String(NUM_CLAIMS)} claims with embeddings`, async () => {
      for (let i = 0; i < NUM_CLAIMS; i += BATCH_SIZE) {
        const rows = Array.from({ length: Math.min(BATCH_SIZE, NUM_CLAIMS - i) }, (_, j) => ({
          id: `${SPIKE_PREFIX}claim-${String(i + j)}`,
          text: `Claim ${String(i + j)}`,
          embedding: randomEmbedding(),
        }));
        await session.run(
          `UNWIND $rows AS row CREATE (c:Claim {id: row.id, text: row.text, embedding: row.embedding})`,
          { rows },
        );
      }
    });

    await time(`insert ${String(NUM_CLAIMS)} EXTRACTED_FROM edges`, async () => {
      await session.run(
        `MATCH (s:Source {id: $sourceId})
         MATCH (c:Claim) WHERE c.id STARTS WITH $p
         CREATE (c)-[:EXTRACTED_FROM]->(s)`,
        { sourceId: `${SPIKE_PREFIX}source-0`, p: SPIKE_PREFIX },
      );
    });

    await time(`insert ${String(NUM_CLAIMS * 2)} MENTIONS edges`, async () => {
      const pairs: { claimId: string; conceptId: string }[] = [];
      for (let i = 0; i < NUM_CLAIMS; i += 1) {
        const a = i % NUM_CONCEPTS;
        const b = (i * MENTIONS_PRIME_OFFSET + MENTIONS_PRIME_SHIFT) % NUM_CONCEPTS;
        pairs.push({
          claimId: `${SPIKE_PREFIX}claim-${String(i)}`,
          conceptId: `${SPIKE_PREFIX}concept-${String(a)}`,
        });
        pairs.push({
          claimId: `${SPIKE_PREFIX}claim-${String(i)}`,
          conceptId: `${SPIKE_PREFIX}concept-${String(b)}`,
        });
      }
      await session.run(
        `UNWIND $pairs AS p
         MATCH (c:Claim {id: p.claimId}), (k:Concept {id: p.conceptId})
         CREATE (c)-[:MENTIONS]->(k)`,
        { pairs },
      );
    });

    // Vector index is built asynchronously; wait briefly for it to populate.
    await new Promise((r) => setTimeout(r, VECTOR_INDEX_WAIT_MS));

    console.log('\n=== queries (warm-cache pass) ===');
    const queryEmbed = randomEmbedding();

    // Warm-up call so the JVM page cache loads claim/concept pages.
    await session.run(
      `MATCH (c:Claim {id: $id})-[:MENTIONS]->(k:Concept)<-[:MENTIONS]-(c2:Claim)
       RETURN count(c2) AS n`,
      { id: `${SPIKE_PREFIX}claim-0` },
    );
    await session.run(
      `CALL db.index.vector.queryNodes('claim_embed_idx', $k, $embedding) YIELD node RETURN node.id`,
      { k: neo4j.int(VECTOR_TOPK), embedding: queryEmbed },
    );

    const { ms: vectorMs } = await time('vector top-10 search (HNSW)', async () => {
      const result = await session.run(
        `CALL db.index.vector.queryNodes('claim_embed_idx', $k, $embedding)
         YIELD node, score
         RETURN node.id AS id, score`,
        { k: neo4j.int(VECTOR_TOPK), embedding: queryEmbed },
      );
      return result.records.length;
    });

    const { ms: traverseMs } = await time('2-hop Claim->Concept->Claim traversal', async () => {
      const result = await session.run(
        `MATCH (c:Claim {id: $id})-[:MENTIONS]->(k:Concept)<-[:MENTIONS]-(c2:Claim)
         WHERE c <> c2
         RETURN c2.id AS id, count(k) AS shared
         ORDER BY shared DESC LIMIT 10`,
        { id: `${SPIKE_PREFIX}claim-0` },
      );
      return result.records.length;
    });

    console.log('\n=== Spike 3 result ===');
    const vectorOk = vectorMs < PER_OP_BUDGET_MS;
    const traverseOk = traverseMs < PER_OP_BUDGET_MS;
    console.log(`vector search: ${vectorOk ? 'PASS' : 'FAIL'} (${vectorMs.toFixed(2)} ms)`);
    console.log(`2-hop traversal: ${traverseOk ? 'PASS' : 'FAIL'} (${traverseMs.toFixed(2)} ms)`);

    const ok = vectorOk && traverseOk;
    console.log(`\nspike 3 ${ok ? 'PASSED' : 'FAILED'}`);
    if (!ok) process.exit(1);
  } finally {
    // Always clean up — never leave xs_spike3_* nodes behind. The earlier
    // "did not clean up" version of this spike was the original source of
    // 1000 orphan claim-{i} nodes in production.
    await wipeSpikeData(session).catch((err: unknown) => {
      console.error('cleanup failed:', err);
    });
    await session.close();
    await driver.close();
  }
};

main().catch((err: unknown) => {
  console.error('spike 3 failed:', err);
  process.exit(1);
});
