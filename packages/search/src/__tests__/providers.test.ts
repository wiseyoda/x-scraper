import { describe, expect, it, vi } from 'vitest';

import { createBraveSearch } from '../brave.js';
import { createExaSearch } from '../exa.js';
import type { FetchLike } from '../http.js';
import { createTavilySearch } from '../tavily.js';
import { SearchError } from '../types.js';

const exaResponse = {
  results: [
    {
      url: 'https://example.com/a',
      title: 'A',
      text: 'snippet a',
      score: 0.9,
      publishedDate: '2026-01-01',
    },
    { url: 'https://example.com/b', title: 'B', text: 'snippet b', score: 0.8 },
  ],
};

const tavilyResponse = {
  results: [
    {
      url: 'https://tavily.com/a',
      title: 'TA',
      content: 'snippet a',
      score: 0.7,
      published_date: '2026-01-02',
    },
  ],
};

const braveResponse = {
  web: {
    results: [
      { url: 'https://brave.com/a', title: 'BA', description: 'snippet a', page_age: '2026-02-02' },
    ],
  },
};

const ok =
  (body: unknown): FetchLike =>
  () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

describe('exa adapter', () => {
  it('rejects an empty API key', () => {
    expect(() => createExaSearch({ apiKey: '' })).toThrow(SearchError);
  });

  it('returns normalized hits and forwards x-api-key header', async () => {
    const seen: Record<string, string>[] = [];
    const fetchImpl: FetchLike = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.headers !== undefined) seen.push(init.headers as Record<string, string>);
      return ok(exaResponse)('', undefined);
    });
    const provider = createExaSearch({ apiKey: 'exa_test', fetchImpl });
    const result = await provider.search('knowledge graph');
    expect(result.provider).toBe('exa');
    expect(result.hits).toHaveLength(2);
    expect(result.hits[0]?.title).toBe('A');
    expect(result.hits[0]?.score).toBe(0.9);
    expect(seen[0]?.['x-api-key']).toBe('exa_test');
  });
});

describe('tavily adapter', () => {
  it('rejects an empty API key', () => {
    expect(() => createTavilySearch({ apiKey: '' })).toThrow(SearchError);
  });

  it('returns normalized hits', async () => {
    const provider = createTavilySearch({ apiKey: 'tav_test', fetchImpl: ok(tavilyResponse) });
    const result = await provider.search('q');
    expect(result.provider).toBe('tavily');
    expect(result.hits[0]?.url).toBe('https://tavily.com/a');
    expect(result.hits[0]?.publishedAt).toBe('2026-01-02');
  });
});

describe('brave adapter', () => {
  it('rejects an empty API key', () => {
    expect(() => createBraveSearch({ apiKey: '' })).toThrow(SearchError);
  });

  it('returns normalized hits and forwards subscription token', async () => {
    const seen: Record<string, string>[] = [];
    const fetchImpl: FetchLike = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.headers !== undefined) seen.push(init.headers as Record<string, string>);
      return ok(braveResponse)('', undefined);
    });
    const provider = createBraveSearch({ apiKey: 'brave_test', fetchImpl });
    const result = await provider.search('q');
    expect(result.provider).toBe('brave');
    expect(result.hits[0]?.url).toBe('https://brave.com/a');
    expect(seen[0]?.['X-Subscription-Token']).toBe('brave_test');
  });

  it('returns an empty hit list when the response has no web.results', async () => {
    const provider = createBraveSearch({ apiKey: 'k', fetchImpl: ok({ web: {} }) });
    const result = await provider.search('q');
    expect(result.hits).toEqual([]);
  });
});

describe('error mapping', () => {
  it('returns RATE_LIMIT for 429', async () => {
    const fetchImpl: FetchLike = vi.fn(() =>
      Promise.resolve(new Response('slow down', { status: 429 })),
    );
    const provider = createTavilySearch({ apiKey: 'k', fetchImpl });
    await expect(provider.search('q')).rejects.toMatchObject({ code: 'RATE_LIMIT' });
  });

  it('returns INVALID_RESPONSE on a malformed JSON shape', async () => {
    const provider = createExaSearch({ apiKey: 'k', fetchImpl: ok({ unexpected: true }) });
    await expect(provider.search('q')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
