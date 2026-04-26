/**
 * Cost computation + ledger sink for LLM calls.
 */

import type { Stage } from '@x-scraper/queue';

import {
  HAIKU_CACHE_READ_FACTOR,
  HAIKU_CACHE_WRITE_SURCHARGE,
  HAIKU_MODEL,
  HAIKU_USD_PER_MILLION_INPUT,
  HAIKU_USD_PER_MILLION_OUTPUT,
  SONNET_CACHE_READ_FACTOR,
  SONNET_CACHE_WRITE_SURCHARGE,
  SONNET_MODEL,
  SONNET_USD_PER_MILLION_INPUT,
  SONNET_USD_PER_MILLION_OUTPUT,
} from './constants.js';
import type { CompleteUsage } from './types.js';

const ONE_MILLION = 1_000_000;

interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
  cacheReadFactor: number;
  cacheWriteSurcharge: number;
}

const HAIKU_PREFIX = 'claude-haiku';

const pricingFor = (model: string): ModelPricing => {
  if (model.startsWith(HAIKU_PREFIX) || model === HAIKU_MODEL) {
    return {
      inputPerM: HAIKU_USD_PER_MILLION_INPUT,
      outputPerM: HAIKU_USD_PER_MILLION_OUTPUT,
      cacheReadFactor: HAIKU_CACHE_READ_FACTOR,
      cacheWriteSurcharge: HAIKU_CACHE_WRITE_SURCHARGE,
    };
  }
  // Sonnet (default).
  void SONNET_MODEL;
  return {
    inputPerM: SONNET_USD_PER_MILLION_INPUT,
    outputPerM: SONNET_USD_PER_MILLION_OUTPUT,
    cacheReadFactor: SONNET_CACHE_READ_FACTOR,
    cacheWriteSurcharge: SONNET_CACHE_WRITE_SURCHARGE,
  };
};

export const computeCostUsd = (model: string, usage: CompleteUsage): number => {
  const p = pricingFor(model);
  const baseInput = (usage.inputTokens / ONE_MILLION) * p.inputPerM;
  const cacheRead = (usage.cacheReadTokens / ONE_MILLION) * p.inputPerM * p.cacheReadFactor;
  const cacheWrite = (usage.cacheCreateTokens / ONE_MILLION) * p.inputPerM * p.cacheWriteSurcharge;
  const output = (usage.outputTokens / ONE_MILLION) * p.outputPerM;
  return baseInput + cacheRead + cacheWrite + output;
};

export interface LlmCostSink {
  recordCost: (input: {
    runId?: string;
    jobId?: string;
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
