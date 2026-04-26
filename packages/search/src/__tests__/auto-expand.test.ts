import { describe, expect, it, vi } from 'vitest';

import { autoExpandClaim, buildExpandQuery } from '../auto-expand.js';
import type { SearchProvider, SearchResult } from '../types.js';
import { SearchError } from '../types.js';

const stub = (provider: 'exa' | 'tavily' | 'brave', urls: string[]): SearchProvider => ({
  provider,
  search: vi.fn(
    (query: string): Promise<SearchResult> =>
      Promise.resolve({
        provider,
        query,
        hits: urls.map((u, i) => ({
          url: u,
          title: `${provider}-t-${String(i)}`,
          snippet: 'snippet',
          score: provider === 'exa' ? 0.9 - i * 0.1 : null,
          publishedAt: null,
        })),
      }),
  ),
});

const failing = (provider: 'exa' | 'tavily' | 'brave', message: string): SearchProvider => ({
  provider,
  search: vi.fn(() =>
    Promise.reject(new SearchError(message, 'PROVIDER', { providerId: provider })),
  ),
});

const claim = (overrides: Partial<Parameters<typeof autoExpandClaim>[0]> = {}) => ({
  subject: 'neo4j',
  predicate: 'has_feature',
  object: 'native HNSW',
  text: 'Neo4j ships native HNSW vector indexes since 5.13.',
  confidence: 0.4,
  ...overrides,
});

describe('buildExpandQuery', () => {
  it('joins subject + predicate + object + a slice of supporting text', () => {
    const q = buildExpandQuery(claim());
    expect(q).toContain('neo4j');
    expect(q).toContain('has feature');
    expect(q).toContain('native HNSW');
  });
});

describe('autoExpandClaim', () => {
  it('skips claims at or above the confidence threshold', async () => {
    const result = await autoExpandClaim(claim({ confidence: 0.9 }), {
      providers: [stub('exa', ['https://x.com/1'])],
      minConfidenceThreshold: 0.6,
    });
    expect(result.expanded).toBe(false);
    expect(result.hits).toEqual([]);
  });

  it('fans out across providers and dedupes by canonical URL', async () => {
    // Tracking params strip; same path stays — both providers find the same URL.
    const exa = stub('exa', ['https://example.com/a?utm_source=x', 'https://example.com/b']);
    const tavily = stub('tavily', ['https://example.com/a', 'https://example.com/c']);
    const result = await autoExpandClaim(claim(), { providers: [exa, tavily] });
    expect(result.expanded).toBe(true);
    expect(result.hits.map((h) => h.url).sort()).toEqual(
      ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'].sort(),
    );
    const collapsed = result.hits.find((h) => h.url === 'https://example.com/a');
    expect(collapsed?.providers.sort()).toEqual(['exa', 'tavily']);
  });

  it('drops URLs in the skip set', async () => {
    const exa = stub('exa', ['https://example.com/a', 'https://example.com/b']);
    const result = await autoExpandClaim(claim(), {
      providers: [exa],
      skip: ['https://example.com/a'],
    });
    expect(result.hits.map((h) => h.url)).toEqual(['https://example.com/b']);
  });

  it('records errors per provider and still returns successful hits', async () => {
    const exa = stub('exa', ['https://example.com/a']);
    const tavily = failing('tavily', 'rate limited');
    const result = await autoExpandClaim(claim(), { providers: [exa, tavily] });
    expect(result.hits).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.provider).toBe('tavily');
  });
});
