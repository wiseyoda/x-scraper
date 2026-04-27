/**
 * One-off backfill: add the `Entity` meta-label and a Gemini embedding
 * to every existing user-facing entity in production Neo4j. The
 * embed_entities stage (T11) handles new ingests; this spike covers
 * the historical corpus so the entity_embed_idx HNSW search returns
 * meaningful candidates immediately rather than after a few re-syncs.
 *
 * Cost: ~0.0001 USD per entity at Gemini's embedding-2-preview tier.
 * 800 entities ≈ $0.08. Cost recorded into queue's cost_ledger.
 *
 * Safe to re-run: idempotent. SET adds the label only if absent;
 * embedding is overwritten in place (same model + same name → same
 * vector, modulo provider non-determinism).
 *
 * Run:
 *   pnpm spike spikes/backfill-entity-embeddings.ts
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { EntityType } from '@x-scraper/core';
import { ENTITY_TYPES } from '@x-scraper/core';
import { createGeminiEmbedding } from '@x-scraper/embeddings';
import { createNeo4jGraph } from '@x-scraper/graph';
import { createSqliteQueue } from '@x-scraper/queue';
import neo4j, { type Driver } from 'neo4j-driver';

const ENV_PATH = path.join(os.homedir(), '.config', 'x-scraper', '.env');
const QUEUE_PATH = path.join(os.homedir(), '.config', 'x-scraper', 'queue.sqlite');
const BATCH_SIZE = 50;
// Source / Claim / Topic carry no entity-style ER.
const ENTITY_TARGETS: EntityType[] = ENTITY_TYPES.filter(
  (t) => t !== 'Source' && t !== 'Claim' && t !== 'Topic',
);

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

const main = async (): Promise<void> => {
  const env = loadEnv();
  const apiKey = env.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? '';
  if (apiKey.length === 0) throw new Error('GEMINI_API_KEY required');

  const queue = createSqliteQueue(QUEUE_PATH);
  const embeddings = createGeminiEmbedding({
    apiKey,
    cost: { sink: { recordCost: (c) => queue.recordCost(c) } },
  });

  // Ensure entity_embed_idx exists (init creates it idempotently). Uses
  // the production adapter so we honor the dim-drift refusal guard.
  const adapter = createNeo4jGraph({
    uri: env.NEO4J_URI ?? 'bolt://localhost:7687',
    user: env.NEO4J_USER ?? 'neo4j',
    password: env.NEO4J_PASSWORD ?? '',
  });
  await adapter.init();
  await adapter.close();

  const driver: Driver = neo4j.driver(
    env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(env.NEO4J_USER ?? 'neo4j', env.NEO4J_PASSWORD ?? ''),
  );
  await driver.verifyConnectivity();
  const session = driver.session({ database: env.NEO4J_DATABASE ?? 'neo4j' });

  let totalUpdated = 0;
  let totalSkipped = 0;
  try {
    for (const type of ENTITY_TARGETS) {
      // No SKIP: each iteration's WHERE filter (n.embedding IS NULL)
      // shrinks the candidate set as we SET n.embedding on the page,
      // so a page-by-page scan with a moving offset would skip about
      // half the corpus. Always read the next BATCH_SIZE rows that
      // still match the filter; loop terminates when the page is empty.
      // The blank-name skip case advances by selecting different rows
      // each time only because we set n.embedding to a sentinel — but
      // we don't. Track a stable last-id cursor so blank-name rows
      // don't trap the loop.
      let lastId = '';
      while (true as boolean) {
        const page = await session.run(
          `MATCH (n:${type})
           WHERE n.embedding IS NULL AND n.id > $lastId
           RETURN n.id AS id, coalesce(n.name, '') AS name
           ORDER BY n.id ASC
           LIMIT $batch`,
          { lastId, batch: neo4j.int(BATCH_SIZE) },
        );
        if (page.records.length === 0) break;

        const items = page.records.map((r) => ({
          id: r.get('id') as string,
          name: r.get('name') as string,
        }));
        const embeddable = items.filter((i) => i.name.length > 0);
        const blanks = items.length - embeddable.length;
        // Advance the cursor past every row we read this page so blank
        // names don't lock the loop on the same id forever.
        lastId = items[items.length - 1]?.id ?? lastId;
        if (embeddable.length === 0) {
          totalSkipped += blanks;
          continue;
        }

        const result = await embeddings.embed(embeddable.map((e) => e.name));
        if (result.vectors.length !== embeddable.length) {
          throw new Error(
            `embed returned ${result.vectors.length.toString()} for ${embeddable.length.toString()} names`,
          );
        }

        // Apply the Entity meta-label and the embedding in one tx so
        // the index sees them at the same time.
        const tx = session.beginTransaction();
        try {
          for (let i = 0; i < embeddable.length; i += 1) {
            const item = embeddable[i];
            const vec = result.vectors[i];
            if (item === undefined || vec === undefined) continue;
            await tx.run(`MATCH (n:${type} {id: $id}) SET n:Entity, n.embedding = $embedding`, {
              id: item.id,
              embedding: vec,
            });
            totalUpdated += 1;
          }
          await tx.commit();
        } catch (err) {
          await tx.rollback();
          throw err;
        }
        totalSkipped += blanks;
        console.log(
          `  ${type}: ${String(totalUpdated)} embedded, ${String(totalSkipped)} skipped (no name)`,
        );
      }
    }
    console.log(
      `\nBackfill complete: ${String(totalUpdated)} entities embedded, ${String(totalSkipped)} skipped (blank names).`,
    );
  } finally {
    await session.close();
    await driver.close();
    queue.close();
  }
};

main().catch((err: unknown) => {
  console.error('backfill failed:', err);
  process.exit(1);
});
