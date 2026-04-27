/**
 * `xs cost` — total USD spent on LLM/embedding calls since a timestamp.
 *
 * --since=<iso> defaults to 30 days ago.
 * --by-entry --top=N also lists the top-N most expensive bookmarks.
 */

import { createSqliteQueue } from '@x-scraper/queue';

import type { CliConfig } from '../config.js';

const DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1_000;
const DEFAULT_TOP = 20;

export interface CostByEntryRow {
  entryId: string;
  totalUsd: number;
}

export interface CostResult {
  sinceIso: string;
  totalUsd: number;
  /** Populated when `byEntry: true`. Top-N rows ordered by spend desc. */
  byEntry?: CostByEntryRow[];
}

export interface CostOptions {
  sinceIso?: string;
  byEntry?: boolean;
  topN?: number;
}

export const runCost = (config: CliConfig, options: CostOptions = {}): CostResult => {
  const since = options.sinceIso ?? new Date(Date.now() - DAYS * MS_PER_DAY).toISOString();
  const queue = createSqliteQueue(config.queuePath);
  try {
    const totalUsd = queue.costSince(since);
    const result: CostResult = { sinceIso: since, totalUsd };
    if (options.byEntry === true) {
      const topN = options.topN ?? DEFAULT_TOP;
      result.byEntry = queue.costByEntry(since, topN);
    }
    return result;
  } finally {
    queue.close();
  }
};
