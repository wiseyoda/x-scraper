/**
 * `xs related <id> [--limit=N]` — debug connection engine.
 * Uses the shared @x-scraper/related entry (same as web-ui).
 */

import * as fs from 'node:fs';

import type { GraphStore } from '@x-scraper/graph';
import { createNeo4jGraph } from '@x-scraper/graph';
import type { Logger } from '@x-scraper/observability';
import { createLogger, jsonLineSink } from '@x-scraper/observability';
import { related } from '@x-scraper/related';
import { createMarkdownVault } from '@x-scraper/vault';

import type { CliConfig } from '../config.js';
import { ENV_FILE_PATH } from '../constants.js';

export interface RelatedCommandOptions {
  id: string;
  limit?: number;
  logger?: Logger;
  /** Skip Neo4j open entirely (vault-only). */
  vaultOnly?: boolean;
}

export interface RelatedCommandResult {
  id: string;
  hitCount: number;
  mode: string;
  graphDegraded: boolean;
  hits: {
    targetId: string;
    targetKind: string;
    reason: string;
    score: number;
    evidenceIds: string[];
  }[];
}

const stdoutLogger = (): Logger =>
  createLogger({
    level: 'info',
    sink: jsonLineSink((line) => {
      process.stderr.write(`${line}\n`);
    }),
  });

const parseEnvFile = (path: string): Record<string, string> => {
  if (!fs.existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
};

export const runRelated = async (
  config: CliConfig,
  options: RelatedCommandOptions,
): Promise<RelatedCommandResult> => {
  const logger = options.logger ?? stdoutLogger();
  const vault = createMarkdownVault(config.vaultDir);

  let graph: GraphStore | null = null;
  let graphDegradedForced = options.vaultOnly === true;
  if (!graphDegradedForced) {
    try {
      const env = parseEnvFile(ENV_FILE_PATH);
      const uri = process.env.NEO4J_URI ?? env.NEO4J_URI;
      const user = process.env.NEO4J_USER ?? env.NEO4J_USER;
      const password = process.env.NEO4J_PASSWORD ?? env.NEO4J_PASSWORD;
      if (uri !== undefined && user !== undefined && password !== undefined) {
        graph = createNeo4jGraph({ uri, user, password });
        await graph.init();
      } else {
        graphDegradedForced = true;
        logger.info('related.graph_skipped', { reason: 'missing NEO4J_* env' });
      }
    } catch (err) {
      graphDegradedForced = true;
      logger.info('related.graph_degraded', {
        reason: err instanceof Error ? err.message : String(err),
      });
      graph = null;
    }
  }

  try {
    const result = await related(
      { vault, graph },
      { id: options.id, ...(options.limit === undefined ? {} : { limit: options.limit }) },
    );
    return {
      id: result.id,
      hitCount: result.hits.length,
      mode: result.mode,
      graphDegraded: result.graphDegraded || graphDegradedForced,
      hits: result.hits.map((h) => ({
        targetId: h.targetId,
        targetKind: h.targetKind,
        reason: h.reason,
        score: h.score,
        evidenceIds: h.evidenceIds,
      })),
    };
  } finally {
    if (graph !== null) {
      await graph.close();
    }
  }
};
