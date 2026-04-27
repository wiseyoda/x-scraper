/**
 * One-off backfill: compute and persist `normalized_name` +
 * `normalized_aliases` on every existing entity in production Neo4j.
 *
 * The reconciler's pre-flight surface-form match (T10) only catches
 * duplicates if the *existing* entities have these properties. New
 * entities get them at write time via stages.ts. This spike walks the
 * historical corpus.
 *
 * Safe to re-run: idempotent (overwrite same value).
 *
 * Run:
 *   pnpm spike spikes/backfill-normalized-names.ts
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { EntityType } from '@x-scraper/core';
import { ENTITY_TYPES } from '@x-scraper/core';
import { normalizedSurfaceForms, normalizeEntityName } from '@x-scraper/reconciler';
import neo4j, { type Driver } from 'neo4j-driver';

const ENV_PATH = path.join(os.homedir(), '.config', 'x-scraper', '.env');
const BATCH_SIZE = 100;
// Source / Claim / Topic don't carry user-facing names with alias collisions.
const NORMALIZABLE_TYPES: EntityType[] = ENTITY_TYPES.filter(
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
  const driver: Driver = neo4j.driver(
    env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(env.NEO4J_USER ?? 'neo4j', env.NEO4J_PASSWORD ?? ''),
  );
  await driver.verifyConnectivity();
  const session = driver.session({ database: env.NEO4J_DATABASE ?? 'neo4j' });

  let totalProcessed = 0;
  let totalUpdated = 0;
  try {
    for (const type of NORMALIZABLE_TYPES) {
      // No SKIP: the WHERE filter (normalized_name IS NULL) shrinks the
      // candidate set on every iteration as we SET the property on the
      // page, so SKIP-based pagination would silently skip about half
      // the corpus. Use a stable id cursor instead.
      let lastId = '';
      while (true as boolean) {
        const page = await session.run(
          `MATCH (n:${type})
           WHERE (n.normalized_name IS NULL OR n.normalized_aliases IS NULL)
                 AND n.id > $lastId
           RETURN n.id AS id, n.name AS name, coalesce(n.aliases, []) AS aliases
           ORDER BY n.id ASC
           LIMIT $batch`,
          { lastId, batch: neo4j.int(BATCH_SIZE) },
        );
        if (page.records.length === 0) break;
        for (const row of page.records) {
          const id = row.get('id') as string;
          const name = (row.get('name') as string | null) ?? '';
          const aliases = ((row.get('aliases') as string[] | null) ?? []).filter(
            (a): a is string => typeof a === 'string',
          );
          const normalizedName = normalizeEntityName(name);
          const normalizedAliases = normalizedSurfaceForms('', aliases);
          await session.run(
            `MATCH (n {id: $id})
             SET n.normalized_name = $normalized_name,
                 n.normalized_aliases = $normalized_aliases`,
            {
              id,
              normalized_name: normalizedName,
              normalized_aliases: normalizedAliases,
            },
          );
          totalUpdated += 1;
          lastId = id;
        }
        totalProcessed += page.records.length;
        console.log(`  ${type}: ${String(totalProcessed)} processed`);
      }
    }
    console.log(`\nBackfill complete: ${String(totalUpdated)} entities updated.`);
  } finally {
    await session.close();
    await driver.close();
  }
};

main().catch((err: unknown) => {
  console.error('backfill failed:', err);
  process.exit(1);
});
