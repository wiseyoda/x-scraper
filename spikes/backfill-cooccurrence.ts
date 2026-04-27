/**
 * One-off backfill: derive Concept-Concept cooccurrence edges from
 * the existing corpus's MENTIONED_IN edges. T16 adds these for new
 * ingests; this spike replays the historical 200 sources so topic
 * detection sees the densified graph immediately.
 *
 * Algorithm: for every Source, MATCH all (Concept)-[:MENTIONED_IN]->(Source).
 * For every unique pair, call upsertCooccurrenceEdge.
 *
 * Idempotent: re-runs increment cooccurrence_count on existing edges
 * (and append to sources[] only if the source isn't already there).
 *
 * Run:
 *   pnpm spike spikes/backfill-cooccurrence.ts
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createNeo4jGraph } from '@x-scraper/graph';

const ENV_PATH = path.join(os.homedir(), '.config', 'x-scraper', '.env');

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
  const adapter = createNeo4jGraph({
    uri: env.NEO4J_URI ?? 'bolt://localhost:7687',
    user: env.NEO4J_USER ?? 'neo4j',
    password: env.NEO4J_PASSWORD ?? '',
  });
  await adapter.init();

  // We need raw Cypher to enumerate sources + their concept members.
  // The adapter doesn't expose a generic query method, so use the
  // driver directly for the read pass; writes go through the adapter's
  // upsertCooccurrenceEdge so the same Cypher path is exercised.
  const neo4j = await import('neo4j-driver');
  const driver = neo4j.default.driver(
    env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.default.auth.basic(env.NEO4J_USER ?? 'neo4j', env.NEO4J_PASSWORD ?? ''),
  );
  const session = driver.session({ database: env.NEO4J_DATABASE ?? 'neo4j' });

  let sourcesProcessed = 0;
  let pairsWritten = 0;
  try {
    const sourcesResult = await session.run(
      `MATCH (s:Source)
       OPTIONAL MATCH (c:Concept)-[:MENTIONED_IN]->(s)
       WITH s.id AS sourceId, collect(DISTINCT c.id) AS conceptIds
       WHERE size(conceptIds) >= 2
       RETURN sourceId, conceptIds`,
    );
    for (const record of sourcesResult.records) {
      const sourceId = record.get('sourceId') as string;
      const conceptIds = (record.get('conceptIds') as (string | null)[]).filter(
        (v): v is string => typeof v === 'string',
      );
      const now = new Date().toISOString();
      for (let i = 0; i < conceptIds.length; i += 1) {
        for (let j = i + 1; j < conceptIds.length; j += 1) {
          const a = conceptIds[i];
          const b = conceptIds[j];
          if (a === undefined || b === undefined) continue;
          const [from, to] = a < b ? [a, b] : [b, a];
          await adapter.upsertCooccurrenceEdge({ from, to, sourceId, now });
          pairsWritten += 1;
        }
      }
      sourcesProcessed += 1;
      if (sourcesProcessed % 10 === 0) {
        console.log(
          `  ${String(sourcesProcessed)} sources processed, ${String(pairsWritten)} pair-upserts`,
        );
      }
    }
    console.log(
      `\nBackfill complete: ${String(sourcesProcessed)} sources, ${String(pairsWritten)} pair-upserts.`,
    );
  } finally {
    await session.close();
    await driver.close();
    await adapter.close();
  }
};

main().catch((err: unknown) => {
  console.error('backfill failed:', err);
  process.exit(1);
});
