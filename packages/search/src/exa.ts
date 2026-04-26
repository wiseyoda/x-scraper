/**
 * Exa search adapter.
 *
 * `https://api.exa.ai/search` — Bearer-style auth via `x-api-key`.
 * Defaults to neural search with auto-prompt.
 */

import { z } from 'zod';

import { DEFAULT_NUM_RESULTS, EXA_SEARCH_URL, MAX_NUM_RESULTS } from './constants.js';
import { fetchJsonOrThrow, type HttpConfig } from './http.js';
import { SearchError, type SearchProvider, type SearchResult } from './types.js';

const ExaResponseSchema = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().nullable().optional(),
      text: z.string().nullable().optional(),
      score: z.number().nullable().optional(),
      publishedDate: z.string().nullable().optional(),
    }),
  ),
});

export interface ExaConfig extends HttpConfig {
  apiKey: string;
  type?: 'neural' | 'keyword' | 'auto';
  useAutoprompt?: boolean;
}

export const createExaSearch = (config: ExaConfig): SearchProvider => {
  if (!config.apiKey) throw new SearchError('EXA_API_KEY missing', 'CONFIG', { providerId: 'exa' });
  const search = async (
    query: string,
    options: { numResults?: number } = {},
  ): Promise<SearchResult> => {
    const numResults = Math.min(options.numResults ?? DEFAULT_NUM_RESULTS, MAX_NUM_RESULTS);
    const body = {
      query,
      numResults,
      type: config.type ?? 'auto',
      useAutoprompt: config.useAutoprompt ?? true,
    };
    const data = await fetchJsonOrThrow(
      EXA_SEARCH_URL,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': config.apiKey,
        },
        body: JSON.stringify(body),
      },
      config,
      'exa',
    );
    const parsed = ExaResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new SearchError('exa: unexpected response shape', 'INVALID_RESPONSE', {
        providerId: 'exa',
        cause: parsed.error,
      });
    }
    return {
      provider: 'exa',
      query,
      hits: parsed.data.results.map((r) => ({
        url: r.url,
        title: r.title ?? null,
        snippet: r.text ?? null,
        score: r.score ?? null,
        publishedAt: r.publishedDate ?? null,
      })),
    };
  };
  return { provider: 'exa', search };
};
