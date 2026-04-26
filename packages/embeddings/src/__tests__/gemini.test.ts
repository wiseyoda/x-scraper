import { describe, expect, it, vi } from 'vitest';

import { TARGET_DIMS } from '../constants.js';
import { createGeminiEmbedding } from '../gemini-adapter.js';
import type { FetchLike } from '../http.js';
import { EmbeddingError } from '../types.js';

const TEST_DIMS = 4;

const buildResponse = (vectors: number[][], status = 200): Response =>
  new Response(JSON.stringify({ embeddings: vectors.map((v) => ({ values: v })) }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const ok =
  (vectors: number[][]): FetchLike =>
  () =>
    Promise.resolve(buildResponse(vectors));

describe('createGeminiEmbedding', () => {
  it('rejects an empty API key at construction', () => {
    expect(() => createGeminiEmbedding({ apiKey: '' })).toThrow(EmbeddingError);
  });

  it('returns one vector per input and the model that produced it', async () => {
    const vectors = [
      [0.1, 0.2, 0.3, 0.4],
      [0.5, 0.6, 0.7, 0.8],
    ];
    const fetchImpl = vi.fn(ok(vectors));
    const provider = createGeminiEmbedding({
      apiKey: 'fake',
      dims: TEST_DIMS,
      fetchImpl,
      sleep: () => Promise.resolve(),
    });
    const result = await provider.embed(['hello', 'world']);
    expect(result.vectors).toEqual(vectors);
    expect(result.modelUsed).toContain('gemini');
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(provider.dims).toBe(TEST_DIMS);
  });

  it('falls back to the alt model on a provider 500', async () => {
    const callLog: string[] = [];
    const fetchImpl: FetchLike = vi.fn((url: string) => {
      callLog.push(url);
      if (callLog.length === 1) {
        return Promise.resolve(new Response('boom', { status: 500 }));
      }
      return Promise.resolve(buildResponse([[0.1, 0.2, 0.3, 0.4]]));
    });
    const provider = createGeminiEmbedding({
      apiKey: 'fake',
      dims: TEST_DIMS,
      fetchImpl,
      sleep: () => Promise.resolve(),
      maxRetries: 0,
    });
    const result = await provider.embed(['hello']);
    expect(result.modelUsed).toContain('gemini-embedding-001');
    expect(callLog.length).toBeGreaterThanOrEqual(2);
  });

  it('throws DIMS_MISMATCH when the response shape disagrees with config', async () => {
    const fetchImpl = vi.fn(ok([[0.1, 0.2]]));
    const provider = createGeminiEmbedding({
      apiKey: 'fake',
      dims: TEST_DIMS,
      fallbackModel: null,
      fetchImpl,
      sleep: () => Promise.resolve(),
    });
    await expect(provider.embed(['hi'])).rejects.toMatchObject({
      name: 'EmbeddingError',
      code: 'DIMS_MISMATCH',
    });
  });

  it('records cost into the supplied sink with run/job attribution', async () => {
    const fetchImpl = vi.fn(ok([[0.1, 0.2, 0.3, 0.4]]));
    const recorded: Record<string, unknown>[] = [];
    const provider = createGeminiEmbedding({
      apiKey: 'fake',
      dims: TEST_DIMS,
      fetchImpl,
      sleep: () => Promise.resolve(),
      cost: {
        sink: {
          recordCost: (input) => {
            recorded.push(input);
            return 'cost_fake_id';
          },
        },
        runId: 'run_x',
        jobId: 'job_y',
        stage: 'embed_source',
      },
    });
    await provider.embed(['hello']);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.runId).toBe('run_x');
    expect(recorded[0]?.jobId).toBe('job_y');
    expect(recorded[0]?.stage).toBe('embed_source');
    expect(recorded[0]?.provider).toBe('gemini');
  });

  it('respects batchSize by issuing multiple HTTP calls', async () => {
    const fetchImpl = vi.fn(ok([[0.1, 0.2, 0.3, 0.4]]));
    const provider = createGeminiEmbedding({
      apiKey: 'fake',
      dims: TEST_DIMS,
      batchSize: 1,
      fetchImpl,
      sleep: () => Promise.resolve(),
    });
    const result = await provider.embed(['a', 'b', 'c']);
    expect(result.vectors).toHaveLength(3);
    expect(fetchImpl.mock.calls).toHaveLength(3);
  });

  it('uses TARGET_DIMS by default', () => {
    const provider = createGeminiEmbedding({ apiKey: 'fake' });
    expect(provider.dims).toBe(TARGET_DIMS);
  });
});
