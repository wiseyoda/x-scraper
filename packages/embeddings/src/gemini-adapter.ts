/**
 * Gemini embedding adapter.
 *
 * Uses the public REST API directly (no SDK) so we keep our dependency
 * surface small. Primary model is `gemini-embedding-2-preview` at 1536
 * dims (Matryoshka). On a hard failure we fall back once to
 * `gemini-embedding-001`. Inputs are batched to `batchSize`.
 */

import { z } from 'zod';

import {
  DEFAULT_BATCH_SIZE,
  GEMINI_BATCH_URL_BASE,
  GEMINI_FALLBACK_MODEL,
  GEMINI_PRIMARY_MODEL,
  TARGET_DIMS,
} from './constants.js';
import { type CostAttribution, estimateGeminiCostUsd, estimateInputTokens } from './cost.js';
import { fetchJsonWithRetry, type HttpConfig } from './http.js';
import { EmbeddingError, type EmbeddingProvider, type EmbeddingResult } from './types.js';

export interface GeminiConfig extends HttpConfig {
  apiKey: string;
  model?: string;
  fallbackModel?: string | null;
  dims?: number;
  batchSize?: number;
  cost?: CostAttribution;
}

const GeminiResponseSchema = z.object({
  embeddings: z.array(z.object({ values: z.array(z.number()) })),
});

const batchUrlFor = (model: string, key: string): string =>
  `${GEMINI_BATCH_URL_BASE}/${model}:batchEmbedContents?key=${encodeURIComponent(key)}`;

const callGemini = async (
  model: string,
  apiKey: string,
  texts: string[],
  dims: number,
  http: HttpConfig,
): Promise<number[][]> => {
  const body = {
    requests: texts.map((text) => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      outputDimensionality: dims,
    })),
  };
  const data = await fetchJsonWithRetry<unknown>(
    batchUrlFor(model, apiKey),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    http,
  );
  const parsed = GeminiResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new EmbeddingError(`gemini ${model}: malformed response`, 'INVALID_RESPONSE', {
      cause: parsed.error,
    });
  }
  if (parsed.data.embeddings.length !== texts.length) {
    throw new EmbeddingError(
      `gemini ${model}: expected ${String(texts.length)} embeddings, got ${String(parsed.data.embeddings.length)}`,
      'INVALID_RESPONSE',
    );
  }
  for (const e of parsed.data.embeddings) {
    if (e.values.length !== dims) {
      throw new EmbeddingError(
        `gemini ${model}: dim mismatch — expected ${String(dims)}, got ${String(e.values.length)}`,
        'DIMS_MISMATCH',
      );
    }
  }
  return parsed.data.embeddings.map((e) => e.values);
};

const chunk = <T>(arr: T[], size: number): T[][] => {
  if (size <= 0) throw new EmbeddingError('batch size must be positive', 'CONFIG');
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export const createGeminiEmbedding = (config: GeminiConfig): EmbeddingProvider => {
  if (!config.apiKey) {
    throw new EmbeddingError('GEMINI_API_KEY missing', 'CONFIG');
  }
  const primary = config.model ?? GEMINI_PRIMARY_MODEL;
  const fallback =
    config.fallbackModel === undefined ? GEMINI_FALLBACK_MODEL : config.fallbackModel;
  const dims = config.dims ?? TARGET_DIMS;
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;

  const embed = async (texts: string[]): Promise<EmbeddingResult> => {
    if (texts.length === 0) {
      return { vectors: [], modelUsed: primary, costUsd: 0, inputTokens: 0 };
    }
    const batches = chunk(texts, batchSize);
    const vectors: number[][] = [];
    let modelUsed = primary;
    for (const batch of batches) {
      let batchVectors: number[][];
      try {
        batchVectors = await callGemini(primary, config.apiKey, batch, dims, config);
      } catch (err) {
        if (fallback === null) throw err;
        if (!(err instanceof EmbeddingError)) throw err;
        // Only fall back on provider/server errors, not on our config errors.
        if (err.code === 'CONFIG' || err.code === 'DIMS_MISMATCH') throw err;
        batchVectors = await callGemini(fallback, config.apiKey, batch, dims, config);
        modelUsed = fallback;
      }
      vectors.push(...batchVectors);
    }
    const inputTokens = estimateInputTokens(texts);
    const costUsd = estimateGeminiCostUsd(inputTokens);
    if (config.cost !== undefined) {
      config.cost.sink.recordCost({
        ...(config.cost.runId === undefined ? {} : { runId: config.cost.runId }),
        ...(config.cost.jobId === undefined ? {} : { jobId: config.cost.jobId }),
        ...(config.cost.stage === undefined ? {} : { stage: config.cost.stage }),
        provider: 'gemini',
        model: modelUsed,
        inputTokens,
        costUsd,
      });
    }
    return { vectors, modelUsed, costUsd, inputTokens };
  };

  return {
    provider: 'gemini',
    dims,
    embed,
  };
};
