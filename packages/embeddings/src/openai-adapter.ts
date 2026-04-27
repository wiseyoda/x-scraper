/**
 * OpenAI embedding adapter (fallback / alt provider).
 *
 * Uses the public REST API directly. text-embedding-3-large supports
 * `dimensions: 1536` natively — no Matryoshka needed.
 */

import { z } from 'zod';

import {
  DEFAULT_BATCH_SIZE,
  OPENAI_DEFAULT_MODEL,
  OPENAI_EMBEDDINGS_URL,
  TARGET_DIMS,
} from './constants.js';
import { type CostAttribution, estimateInputTokens, estimateOpenAICostUsd } from './cost.js';
import { fetchJsonWithRetry, type HttpConfig } from './http.js';
import { EmbeddingError, type EmbeddingProvider, type EmbeddingResult } from './types.js';

export interface OpenAIConfig extends HttpConfig {
  apiKey: string;
  model?: string;
  dims?: number;
  batchSize?: number;
  cost?: CostAttribution;
}

const OpenAIResponseSchema = z.object({
  data: z.array(z.object({ index: z.number(), embedding: z.array(z.number()) })),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});

const chunk = <T>(arr: T[], size: number): T[][] => {
  if (size <= 0) throw new EmbeddingError('batch size must be positive', 'CONFIG');
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const callOpenAI = async (
  apiKey: string,
  model: string,
  dims: number,
  texts: string[],
  http: HttpConfig,
): Promise<{ vectors: number[][]; promptTokens: number | null }> => {
  const body = { model, input: texts, dimensions: dims };
  const data = await fetchJsonWithRetry<unknown>(
    OPENAI_EMBEDDINGS_URL,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    http,
  );
  const parsed = OpenAIResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new EmbeddingError(`openai ${model}: malformed response`, 'INVALID_RESPONSE', {
      cause: parsed.error,
    });
  }
  if (parsed.data.data.length !== texts.length) {
    throw new EmbeddingError(
      `openai ${model}: expected ${String(texts.length)} embeddings, got ${String(parsed.data.data.length)}`,
      'INVALID_RESPONSE',
    );
  }
  // OpenAI returns embeddings with explicit indices; sort to align.
  const sorted = [...parsed.data.data].sort((a, b) => a.index - b.index);
  for (const e of sorted) {
    if (e.embedding.length !== dims) {
      throw new EmbeddingError(
        `openai ${model}: dim mismatch — expected ${String(dims)}, got ${String(e.embedding.length)}`,
        'DIMS_MISMATCH',
      );
    }
  }
  return {
    vectors: sorted.map((e) => e.embedding),
    promptTokens: parsed.data.usage?.prompt_tokens ?? null,
  };
};

export const createOpenAIEmbedding = (config: OpenAIConfig): EmbeddingProvider => {
  if (!config.apiKey) {
    throw new EmbeddingError('OPENAI_API_KEY missing', 'CONFIG');
  }
  const model = config.model ?? OPENAI_DEFAULT_MODEL;
  const dims = config.dims ?? TARGET_DIMS;
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;

  const embed = async (texts: string[]): Promise<EmbeddingResult> => {
    if (texts.length === 0) {
      return { vectors: [], modelUsed: model, costUsd: 0, inputTokens: 0 };
    }
    const batches = chunk(texts, batchSize);
    const vectors: number[][] = [];
    let serverTokens = 0;
    let serverTokensSeen = false;
    for (const batch of batches) {
      const { vectors: vs, promptTokens } = await callOpenAI(
        config.apiKey,
        model,
        dims,
        batch,
        config,
      );
      vectors.push(...vs);
      if (promptTokens !== null) {
        serverTokens += promptTokens;
        serverTokensSeen = true;
      }
    }
    const inputTokens = serverTokensSeen ? serverTokens : estimateInputTokens(texts);
    const costUsd = estimateOpenAICostUsd(inputTokens);
    if (config.cost !== undefined) {
      config.cost.sink.recordCost({
        ...(config.cost.runId === undefined ? {} : { runId: config.cost.runId }),
        ...(config.cost.jobId === undefined ? {} : { jobId: config.cost.jobId }),
        ...(config.cost.entryId === undefined ? {} : { entryId: config.cost.entryId }),
        ...(config.cost.stage === undefined ? {} : { stage: config.cost.stage }),
        provider: 'openai',
        model,
        inputTokens,
        costUsd,
      });
    }
    return { vectors, modelUsed: model, costUsd, inputTokens };
  };

  return {
    provider: 'openai',
    dims,
    embed,
  };
};
