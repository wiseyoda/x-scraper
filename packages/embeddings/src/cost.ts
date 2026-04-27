/**
 * Cost-ledger plumbing for embedding calls.
 *
 * The cost-ledger surface is owned by `@x-scraper/queue`. Embedding
 * adapters accept an optional ledger sink so a single sync can
 * attribute every external call to the run/job/stage that triggered it.
 */

import type { Stage } from '@x-scraper/queue';

export interface CostSink {
  recordCost: (input: {
    runId?: string;
    jobId?: string;
    /** bookmark_ledger.entry_id (T22). */
    entryId?: string;
    stage?: Stage;
    provider: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreateTokens?: number;
    costUsd?: number;
  }) => string;
}

export interface CostAttribution {
  sink: CostSink;
  runId?: string;
  jobId?: string;
  entryId?: string;
  stage?: Stage;
}

import {
  GEMINI_USD_PER_MILLION_INPUT_TOKENS,
  OPENAI_USD_PER_MILLION_INPUT_TOKENS,
  ROUGH_CHARS_PER_TOKEN,
} from './constants.js';

const ONE_MILLION = 1_000_000;

export const estimateInputTokens = (texts: string[]): number => {
  let total = 0;
  for (const t of texts) total += Math.ceil(t.length / ROUGH_CHARS_PER_TOKEN);
  return total;
};

export const estimateGeminiCostUsd = (inputTokens: number): number =>
  (inputTokens / ONE_MILLION) * GEMINI_USD_PER_MILLION_INPUT_TOKENS;

export const estimateOpenAICostUsd = (inputTokens: number): number =>
  (inputTokens / ONE_MILLION) * OPENAI_USD_PER_MILLION_INPUT_TOKENS;
