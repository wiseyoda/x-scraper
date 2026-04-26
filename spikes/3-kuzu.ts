/**
 * Spike 3 — Kuzu schema, vector index, traversal benchmark.
 *
 * Goal: confirm Kuzu's Node bindings load on Darwin arm64, we can declare
 * node + edge tables, build a vector index, and run vector search +
 * 2-hop traversal under 100ms each on a 1k-claim synthetic corpus.
 *
 * Run:  pnpm spike spikes/3-kuzu.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import * as kuzu from 'kuzu';

const single = (r: kuzu.QueryResult | kuzu.QueryResult[]): kuzu.QueryResult => {
  if (!Array.isArray(r)) return r;
  const first = r[0];
  if (first === undefined) throw new Error('empty kuzu QueryResult array');
  return first;
};

const DB_DIR = path.resolve('spikes/tmp/kuzu-db');
const DB_PARENT = path.dirname(DB_DIR);
const NUM_CLAIMS = 1000;
const NUM_CONCEPTS = 80;
const EMBED_DIMS = 1536;
const VECTOR_TOPK = 10;
const PER_OP_BUDGET_MS = 100;

const cleanDb = (): void => {
  fs.rmSync(DB_DIR, { recursive: true, force: true });
  fs.mkdirSync(DB_PARENT, { recursive: true });
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
    const v = Math.random() * 2 - 1;
    out[i] = v;
    normSq += v * v;
  }
  const norm = Math.sqrt(normSq);
  for (let i = 0; i < EMBED_DIMS; i += 1) {
    out[i] = (out[i] ?? 0) / norm;
  }
  return out;
};

const main = async (): Promise<void> => {
  cleanDb();
  console.log(`db dir: ${DB_DIR}\nkuzu version: ${(kuzu as { VERSION?: string }).VERSION ?? 'unknown'}`);

  const db = new kuzu.Database(DB_DIR);
  const conn = new kuzu.Connection(db);

  // === schema ===
  console.log('\n=== schema ===');
  await time('install vss extension', async () => {
    await conn.query(`INSTALL vector;`).catch(() => undefined);
    await conn.query(`LOAD EXTENSION vector;`).catch(() => undefined);
  });

  await time('create node tables', async () => {
    await conn.query(`
      CREATE NODE TABLE Concept (
        id STRING PRIMARY KEY,
        name STRING
      );
    `);
    await conn.query(`
      CREATE NODE TABLE Source (
        id STRING PRIMARY KEY,
        url STRING
      );
    `);
    await conn.query(`
      CREATE NODE TABLE Claim (
        id STRING PRIMARY KEY,
        text STRING,
        embedding FLOAT[${String(EMBED_DIMS)}]
      );
    `);
  });

  await time('create rel tables', async () => {
    await conn.query(`CREATE REL TABLE EXTRACTED_FROM (FROM Claim TO Source);`);
    await conn.query(`CREATE REL TABLE MENTIONS (FROM Claim TO Concept);`);
  });

  // === insert ===
  console.log('\n=== insert ===');
  await time(`insert ${String(NUM_CONCEPTS)} concepts`, async () => {
    const params = Array.from({ length: NUM_CONCEPTS }, (_, i) => ({
      id: `concept-${String(i)}`,
      name: `Concept ${String(i)}`,
    }));
    for (const p of params) {
      await conn.query(`CREATE (:Concept {id: '${p.id}', name: '${p.name}'});`);
    }
  });

  await time('insert 1 source', async () => {
    await conn.query(`CREATE (:Source {id: 'source-0', url: 'https://example.com/0'});`);
  });

  await time(`insert ${String(NUM_CLAIMS)} claims with embeddings`, async () => {
    for (let i = 0; i < NUM_CLAIMS; i += 1) {
      const embed = randomEmbedding();
      const embedStr = `[${embed.join(',')}]`;
      await conn.query(
        `CREATE (:Claim {id: 'claim-${String(i)}', text: 'Claim ${String(i)}', embedding: ${embedStr}});`,
      );
    }
  });

  await time(`insert ${String(NUM_CLAIMS)} EXTRACTED_FROM edges`, async () => {
    for (let i = 0; i < NUM_CLAIMS; i += 1) {
      await conn.query(`
        MATCH (c:Claim {id: 'claim-${String(i)}'}), (s:Source {id: 'source-0'})
        CREATE (c)-[:EXTRACTED_FROM]->(s);
      `);
    }
  });

  await time(`insert ${String(NUM_CLAIMS * 2)} MENTIONS edges`, async () => {
    for (let i = 0; i < NUM_CLAIMS; i += 1) {
      const a = i % NUM_CONCEPTS;
      const b = (i * 7 + 3) % NUM_CONCEPTS;
      await conn.query(`
        MATCH (c:Claim {id: 'claim-${String(i)}'}), (k:Concept {id: 'concept-${String(a)}'})
        CREATE (c)-[:MENTIONS]->(k);
      `);
      await conn.query(`
        MATCH (c:Claim {id: 'claim-${String(i)}'}), (k:Concept {id: 'concept-${String(b)}'})
        CREATE (c)-[:MENTIONS]->(k);
      `);
    }
  });

  // === vector index ===
  console.log('\n=== vector index ===');
  const indexed = await time('create HNSW index on Claim.embedding', async () => {
    await conn.query(
      `CALL CREATE_VECTOR_INDEX('Claim', 'claim_embed_idx', 'embedding');`,
    );
    return true;
  }).catch((err: unknown) => {
    console.log(`  failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });

  // === queries ===
  console.log('\n=== queries ===');
  const queryEmbed = randomEmbedding();
  const queryEmbedStr = `[${queryEmbed.join(',')}]`;

  const vectorMs: number[] = [];
  if (indexed !== null) {
    const { ms } = await time('vector top-10 search (with index)', async () => {
      const r = await conn.query(`
        CALL QUERY_VECTOR_INDEX('Claim', 'claim_embed_idx', ${queryEmbedStr}, ${String(VECTOR_TOPK)})
        RETURN node.id, distance ORDER BY distance LIMIT ${String(VECTOR_TOPK)};
      `);
      return await single(r).getAll();
    });
    vectorMs.push(ms);
  } else {
    const { ms } = await time('vector top-10 (brute force fallback)', async () => {
      const r = await conn.query(`
        MATCH (c:Claim)
        RETURN c.id AS id ORDER BY array_cosine_similarity(c.embedding, ${queryEmbedStr}) DESC
        LIMIT ${String(VECTOR_TOPK)};
      `);
      return await single(r).getAll();
    });
    vectorMs.push(ms);
  }

  const { ms: traverseMs } = await time('2-hop Claim->Concept->Claim traversal', async () => {
    const r = await conn.query(`
      MATCH (c:Claim {id: 'claim-0'})-[:MENTIONS]->(k:Concept)<-[:MENTIONS]-(c2:Claim)
      WHERE c <> c2
      RETURN c2.id AS id, count(k) AS shared
      ORDER BY shared DESC
      LIMIT 10;
    `);
    return await single(r).getAll();
  });

  // === report ===
  console.log('\n=== Spike 3 result ===');
  const vectorOk = vectorMs.every((m) => m < PER_OP_BUDGET_MS);
  const traverseOk = traverseMs < PER_OP_BUDGET_MS;
  console.log(`vector search: ${vectorOk ? 'PASS' : 'FAIL'} (${vectorMs[0]?.toFixed(2) ?? '?'} ms)`);
  console.log(`2-hop traversal: ${traverseOk ? 'PASS' : 'FAIL'} (${traverseMs.toFixed(2)} ms)`);
  console.log(`vector index used: ${indexed !== null ? 'yes' : 'NO (extension or syntax issue)'}`);

  await conn.close();
  await db.close();

  const ok = vectorOk && traverseOk;
  console.log(`\nspike 3 ${ok ? 'PASSED' : 'FAILED'}`);
  // Force-exit to dodge a known kuzu 0.11 segfault on shutdown teardown.
  process.exit(ok ? 0 : 1);
};

main().catch((err: unknown) => {
  console.error('spike 3 failed:', err);
  process.exit(1);
});
