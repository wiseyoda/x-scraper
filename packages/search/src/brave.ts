/**
 * Brave search adapter.
 *
 * `GET https://api.search.brave.com/res/v1/web/search?q=...` —
 * subscription token carried in the `X-Subscription-Token` header.
 */

import { z } from 'zod';

import { BRAVE_SEARCH_URL, DEFAULT_NUM_RESULTS, MAX_NUM_RESULTS } from './constants.js';
import { fetchJsonOrThrow, type HttpConfig } from './http.js';
import { SearchError, type SearchProvider, type SearchResult } from './types.js';

const BraveResponseSchema = z.object({
  web: z
    .object({
      results: z
        .array(
          z.object({
            url: z.string(),
            title: z.string().nullable().optional(),
            description: z.string().nullable().optional(),
            page_age: z.string().nullable().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export interface BraveConfig extends HttpConfig {
  apiKey: string;
  /** Country code (e.g. 'US', 'GB'). */
  country?: string;
  /** Search type. Default 'web'. */
  searchType?: 'web';
}

export const createBraveSearch = (config: BraveConfig): SearchProvider => {
  if (!config.apiKey)
    throw new SearchError('BRAVE_API_KEY missing', 'CONFIG', { providerId: 'brave' });
  const search = async (
    query: string,
    options: { numResults?: number } = {},
  ): Promise<SearchResult> => {
    const numResults = Math.min(options.numResults ?? DEFAULT_NUM_RESULTS, MAX_NUM_RESULTS);
    const params = new URLSearchParams({ q: query, count: String(numResults) });
    if (config.country !== undefined) params.set('country', config.country);
    const data = await fetchJsonOrThrow(
      `${BRAVE_SEARCH_URL}?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'X-Subscription-Token': config.apiKey,
        },
      },
      config,
      'brave',
    );
    const parsed = BraveResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new SearchError('brave: unexpected response shape', 'INVALID_RESPONSE', {
        providerId: 'brave',
        cause: parsed.error,
      });
    }
    const results = parsed.data.web?.results ?? [];
    return {
      provider: 'brave',
      query,
      hits: results.map((r) => ({
        url: r.url,
        title: r.title ?? null,
        snippet: r.description ?? null,
        score: null,
        publishedAt: r.page_age ?? null,
      })),
    };
  };
  return { provider: 'brave', search };
};
