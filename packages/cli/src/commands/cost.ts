/**
 * `xs cost` — total USD spent on LLM/embedding calls since a timestamp.
 *
 * --since=<iso> defaults to 30 days ago.
 */

import { createSqliteQueue } from '@x-scraper/queue';

import type { CliConfig } from '../config.js';

const DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1_000;

export interface CostResult {
  sinceIso: string;
  totalUsd: number;
}

export const runCost = (config: CliConfig, sinceIso?: string): CostResult => {
  const since = sinceIso ?? new Date(Date.now() - DAYS * MS_PER_DAY).toISOString();
  const queue = createSqliteQueue(config.queuePath);
  try {
    const totalUsd = queue.costSince(since);
    return { sinceIso: since, totalUsd };
  } finally {
    queue.close();
  }
};
