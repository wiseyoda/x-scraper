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

    // Vector search expects a single embedding space per result set, so we
    // never mix models within one embed() call. Probe the FIRST batch on
    // primary; if that fails, run ALL batches (including the first) on
    // fallback. Subsequent-batch failures on primary throw — they cannot
    // silently flip mid-call.
    let modelUsed = primary;
    const vectors: number[][] = [];
    const firstBatch = batches[0];
    if (firstBatch === undefined) {
      return { vectors: [], modelUsed: primary, costUsd: 0, inputTokens: 0 };
    }
    try {
      const probe = await callGemini(primary, config.apiKey, firstBatch, dims, config);
      vectors.push(...probe);
    } catch (err) {
      if (fallback === null) throw err;
      if (!(err instanceof EmbeddingError)) throw err;
      if (err.code === 'CONFIG' || err.code === 'DIMS_MISMATCH') throw err;
      // Switch the whole call to fallback. Re-run the first batch first.
      modelUsed = fallback;
      vectors.length = 0;
      const refirst = await callGemini(fallback, config.apiKey, firstBatch, dims, config);
      vectors.push(...refirst);
    }
    for (let i = 1; i < batches.length; i += 1) {
      const batch = batches[i];
      if (batch === undefined) continue;
      const out = await callGemini(modelUsed, config.apiKey, batch, dims, config);
      vectors.push(...out);
    }
    const inputTokens = estimateInputTokens(texts);
    const costUsd = estimateGeminiCostUsd(inputTokens);
    if (config.cost !== undefined) {
      config.cost.sink.recordCost({
        ...(config.cost.runId === undefined ? {} : { runId: config.cost.runId }),
        ...(config.cost.jobId === undefined ? {} : { jobId: config.cost.jobId }),
        ...(config.cost.entryId === undefined ? {} : { entryId: config.cost.entryId }),
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
