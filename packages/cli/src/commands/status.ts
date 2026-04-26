/**
 * `xs status` — per-status job counts (optionally scoped to a run).
 *
 * When --run is supplied, both the status counts AND the DLQ count
 * are scoped to that run so the dashboard never mixes scopes.
 */

import { createSqliteQueue, type QueueStats } from '@x-scraper/queue';

import type { CliConfig } from '../config.js';

export interface StatusResult {
  runId: string | null;
  stats: QueueStats;
  dlqCount: number;
}

export const runStatus = (config: CliConfig, runId: string | null = null): StatusResult => {
  const queue = createSqliteQueue(config.queuePath);
  try {
    const stats = runId === null ? queue.stats() : queue.stats(runId);
    const dlq = queue.listDlq();
    const dlqCount = runId === null ? dlq.length : dlq.filter((j) => j.runId === runId).length;
    return { runId, stats, dlqCount };
  } finally {
    queue.close();
  }
};
