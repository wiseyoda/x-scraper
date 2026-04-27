/**
 * `xs trends` — read-only graph survey. Surfaces the queries Pat
 * hand-typed against Cypher to inspect the live corpus: top entities,
 * top concepts, predicate distribution, source content_type mix, edge
 * type counts, per-month bookmark cadence.
 *
 * Two output modes: ASCII tables (default) for terminal eyeballing,
 * JSON for piping into other tools.
 */

import { createNeo4jGraph } from '@x-scraper/graph';
import type { Logger } from '@x-scraper/observability';
import { createLogger, jsonLineSink } from '@x-scraper/observability';

import { ENV_FILE_PATH } from '../constants.js';
import { parseEnvFile } from './sync/wire.js';

const TOP_N = 20;
const RECENT_MONTHS = 12;

export interface TrendsOptions {
  /** Default 20. */
  topN?: number;
  /** When 'json', emit a single JSON object instead of pretty tables. */
  format?: 'table' | 'json';
  /** Test seam: pre-built env. */
  env?: Record<string, string>;
  /** Test seam: writable line sink (defaults to stdout). */
  output?: (line: string) => void;
  logger?: Logger;
}

export interface TrendsRow {
  key: string;
  count: number;
}

export interface TrendsResult {
  topEntitiesBySources: TrendsRow[];
  topConceptsBySources: TrendsRow[];
  topToolsBySources: TrendsRow[];
  topAuthorsBySources: TrendsRow[];
  predicateDistribution: TrendsRow[];
  sourceContentTypeDistribution: TrendsRow[];
  edgeTypeDistribution: TrendsRow[];
  bookmarksPerMonth: TrendsRow[];
}

const stdoutLogger = (): Logger =>
  createLogger({
    level: 'info',
    sink: jsonLineSink((line) => process.stdout.write(line)),
  });

const renderTable = (title: string, rows: TrendsRow[], output: (line: string) => void): void => {
  output(`\n=== ${title} ===\n`);
  if (rows.length === 0) {
    output('(no rows)\n');
    return;
  }
  const maxKey = Math.max(...rows.map((r) => r.key.length));
  const maxCount = Math.max(...rows.map((r) => String(r.count).length));
  for (const r of rows) {
    output(`${r.key.padEnd(maxKey)}  ${String(r.count).padStart(maxCount)}\n`);
  }
};

export const runTrends = async (options: TrendsOptions = {}): Promise<TrendsResult> => {
  const topN = options.topN ?? TOP_N;
  const format = options.format ?? 'table';
  const env = options.env ?? parseEnvFile(ENV_FILE_PATH);
  const output = options.output ?? ((line: string) => process.stdout.write(line));
  // In JSON mode, the caller expects stdout to be a single JSON object
  // pipeable to jq. Send the NDJSON progress logs to stderr so they
  // don't pollute the parsed output.
  const logger =
    options.logger ??
    (format === 'json'
      ? createLogger({
          level: 'info',
          sink: jsonLineSink((line) => process.stderr.write(line)),
        })
      : stdoutLogger());

  const graph = createNeo4jGraph({
    uri: env.NEO4J_URI ?? '',
    user: env.NEO4J_USER ?? '',
    password: env.NEO4J_PASSWORD ?? '',
  });

  // The graph adapter doesn't expose a generic-query port (the right
  // call is to add per-trend ports, but that's a lot of boilerplate
  // for a read-only diagnostic). Use the driver directly for these
  // analytics queries.
  const neo4j = await import('neo4j-driver');
  const driver = neo4j.default.driver(
    env.NEO4J_URI ?? '',
    neo4j.default.auth.basic(env.NEO4J_USER ?? '', env.NEO4J_PASSWORD ?? ''),
  );
  const session = driver.session({ database: env.NEO4J_DATABASE ?? 'neo4j' });

  const toRows = (records: { get: (k: string) => unknown }[]): TrendsRow[] =>
    records.map((r) => {
      const raw = r.get('count') as { toNumber: () => number } | number;
      const count = typeof raw === 'number' ? raw : raw.toNumber();
      return { key: (r.get('key') as string | null) ?? '(null)', count };
    });

  try {
    logger.info('trends.started', { topN });

    const topEntities = await session.run(
      `MATCH (e:Entity)-[:MENTIONED_IN]->(s:Source)
       RETURN e.name AS key, count(DISTINCT s) AS count
       ORDER BY count DESC LIMIT $top`,
      { top: neo4j.default.int(topN) },
    );
    const topConcepts = await session.run(
      `MATCH (e:Concept)-[:MENTIONED_IN]->(s:Source)
       RETURN e.name AS key, count(DISTINCT s) AS count
       ORDER BY count DESC LIMIT $top`,
      { top: neo4j.default.int(topN) },
    );
    const topTools = await session.run(
      `MATCH (e:Tool)-[:MENTIONED_IN]->(s:Source)
       RETURN e.name AS key, count(DISTINCT s) AS count
       ORDER BY count DESC LIMIT $top`,
      { top: neo4j.default.int(topN) },
    );
    // T20 materializes a Person node per byline + AUTHORED_BY edge. The
    // raw byline is also stored as a flat property under the literal key
    // `host_metadata.byline` (not a nested map), so dotted access via
    // s.host_metadata.byline always returns null. Querying the edge is
    // both correct and faster.
    const topAuthors = await session.run(
      `MATCH (s:Source)-[:AUTHORED_BY]->(p:Person)
       RETURN p.name AS key, count(DISTINCT s) AS count
       ORDER BY count DESC LIMIT $top`,
      { top: neo4j.default.int(topN) },
    );
    const predicates = await session.run(
      `MATCH (c:Claim)
       RETURN coalesce(c.predicate, '(null)') AS key, count(c) AS count
       ORDER BY count DESC LIMIT $top`,
      { top: neo4j.default.int(topN) },
    );
    const contentTypes = await session.run(
      `MATCH (s:Source)
       RETURN coalesce(s.content_type, '(null)') AS key, count(s) AS count
       ORDER BY count DESC`,
    );
    const edgeTypes = await session.run(
      `MATCH ()-[r]->()
       RETURN type(r) AS key, count(r) AS count
       ORDER BY count DESC`,
    );
    const monthly = await session.run(
      `MATCH (s:Source)
       WHERE s.captured_at IS NOT NULL
       WITH substring(s.captured_at, 0, 7) AS key
       RETURN key, count(*) AS count
       ORDER BY key DESC LIMIT $months`,
      { months: neo4j.default.int(RECENT_MONTHS) },
    );

    const result: TrendsResult = {
      topEntitiesBySources: toRows(topEntities.records),
      topConceptsBySources: toRows(topConcepts.records),
      topToolsBySources: toRows(topTools.records),
      topAuthorsBySources: toRows(topAuthors.records),
      predicateDistribution: toRows(predicates.records),
      sourceContentTypeDistribution: toRows(contentTypes.records),
      edgeTypeDistribution: toRows(edgeTypes.records),
      bookmarksPerMonth: toRows(monthly.records),
    };

    if (format === 'json') {
      output(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      renderTable('Top entities (by source count)', result.topEntitiesBySources, output);
      renderTable('Top concepts', result.topConceptsBySources, output);
      renderTable('Top tools', result.topToolsBySources, output);
      renderTable('Top authors', result.topAuthorsBySources, output);
      renderTable('Predicate distribution', result.predicateDistribution, output);
      renderTable('Source content_type', result.sourceContentTypeDistribution, output);
      renderTable('Edge type counts', result.edgeTypeDistribution, output);
      renderTable('Bookmarks captured per month (recent)', result.bookmarksPerMonth, output);
    }
    logger.info('trends.finished', {});
    return result;
  } finally {
    await session.close();
    await driver.close();
    await graph.close();
  }
};
