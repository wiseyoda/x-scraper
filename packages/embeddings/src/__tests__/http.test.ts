import { describe, expect, it, vi } from 'vitest';

import { fetchJsonWithRetry, type FetchLike } from '../http.js';
import { EmbeddingError } from '../types.js';

const RETRY_BUDGET = 2;

describe('fetchJsonWithRetry', () => {
  it('retries on 503 and eventually succeeds', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = vi.fn(() => {
      calls += 1;
      if (calls < RETRY_BUDGET) {
        return Promise.resolve(new Response('busy', { status: 503 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    const result = await fetchJsonWithRetry<{ ok: boolean }>(
      'https://x',
      { method: 'GET' },
      {
        fetchImpl,
        sleep: () => Promise.resolve(),
        maxRetries: 3,
      },
    );
    expect(result.ok).toBe(true);
    expect(calls).toBe(RETRY_BUDGET);
  });

  it('does not retry on 4xx (other than 429)', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = vi.fn(() => {
      calls += 1;
      return Promise.resolve(new Response('bad', { status: 400 }));
    });
    await expect(
      fetchJsonWithRetry(
        'https://x',
        { method: 'GET' },
        {
          fetchImpl,
          sleep: () => Promise.resolve(),
          maxRetries: 3,
        },
      ),
    ).rejects.toBeInstanceOf(EmbeddingError);
    expect(calls).toBe(1);
  });

  it('throws TIMEOUT when the request aborts', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchImpl: FetchLike = vi.fn(() => Promise.reject(abortError));
    await expect(
      fetchJsonWithRetry(
        'https://x',
        { method: 'GET' },
        {
          fetchImpl,
          sleep: () => Promise.resolve(),
          maxRetries: 0,
        },
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});
