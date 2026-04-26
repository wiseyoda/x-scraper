import { describe, expect, it, vi } from 'vitest';

import type { FetchLike } from '../http.js';
import { createOpenAIEmbedding } from '../openai-adapter.js';

const TEST_DIMS = 4;

const okResponse = (
  rows: { index: number; embedding: number[] }[],
  promptTokens?: number,
): Response =>
  new Response(
    JSON.stringify({
      data: rows,
      ...(promptTokens === undefined ? {} : { usage: { prompt_tokens: promptTokens } }),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

const ok =
  (rows: { index: number; embedding: number[] }[], promptTokens?: number): FetchLike =>
  () =>
    Promise.resolve(okResponse(rows, promptTokens));

describe('createOpenAIEmbedding', () => {
  it('rejects an empty API key at construction', () => {
    expect(() => createOpenAIEmbedding({ apiKey: '' })).toThrow();
  });

  it('returns embeddings sorted by their server-side index', async () => {
    const fetchImpl = vi.fn(
      ok([
        { index: 1, embedding: [0.5, 0.6, 0.7, 0.8] },
        { index: 0, embedding: [0.1, 0.2, 0.3, 0.4] },
      ]),
    );
    const provider = createOpenAIEmbedding({
      apiKey: 'fake',
      dims: TEST_DIMS,
      fetchImpl,
      sleep: () => Promise.resolve(),
    });
    const result = await provider.embed(['first', 'second']);
    expect(result.vectors[0]).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(result.vectors[1]).toEqual([0.5, 0.6, 0.7, 0.8]);
  });

  it('uses server-reported prompt_tokens for cost when present', async () => {
    const fetchImpl = vi.fn(ok([{ index: 0, embedding: [0.1, 0.2, 0.3, 0.4] }], 42));
    const provider = createOpenAIEmbedding({
      apiKey: 'fake',
      dims: TEST_DIMS,
      fetchImpl,
      sleep: () => Promise.resolve(),
    });
    const result = await provider.embed(['short']);
    expect(result.inputTokens).toBe(42);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it('falls back to estimated tokens when usage is absent', async () => {
    const fetchImpl = vi.fn(ok([{ index: 0, embedding: [0.1, 0.2, 0.3, 0.4] }]));
    const provider = createOpenAIEmbedding({
      apiKey: 'fake',
      dims: TEST_DIMS,
      fetchImpl,
      sleep: () => Promise.resolve(),
    });
    const result = await provider.embed(['some longer text to embed']);
    expect(result.inputTokens).toBeGreaterThan(0);
  });

  it('sends a Bearer Authorization header', async () => {
    const seenInit: RequestInit[] = [];
    const fetchImpl: FetchLike = vi.fn((_url: string, init?: RequestInit) => {
      if (init !== undefined) seenInit.push(init);
      return Promise.resolve(okResponse([{ index: 0, embedding: [0.1, 0.2, 0.3, 0.4] }]));
    });
    const provider = createOpenAIEmbedding({
      apiKey: 'sk-test',
      dims: TEST_DIMS,
      fetchImpl,
      sleep: () => Promise.resolve(),
    });
    await provider.embed(['x']);
    expect(seenInit).toHaveLength(1);
    const headers = (seenInit[0]?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test');
  });
});
