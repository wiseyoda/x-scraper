/**
 * `xs status` — per-status job counts (optionally scoped to a run).
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
    const dlqCount = queue.listDlq().length;
    return { runId, stats, dlqCount };
  } finally {
    queue.close();
  }
};
