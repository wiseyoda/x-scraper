/**
 * Tavily search adapter.
 *
 * `https://api.tavily.com/search` — `api_key` carried in the JSON body.
 */

import { z } from 'zod';

import { DEFAULT_NUM_RESULTS, MAX_NUM_RESULTS, TAVILY_SEARCH_URL } from './constants.js';
import { fetchJsonOrThrow, type HttpConfig } from './http.js';
import { SearchError, type SearchProvider, type SearchResult } from './types.js';

const TavilyResponseSchema = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().nullable().optional(),
      content: z.string().nullable().optional(),
      score: z.number().nullable().optional(),
      published_date: z.string().nullable().optional(),
    }),
  ),
});

export interface TavilyConfig extends HttpConfig {
  apiKey: string;
  searchDepth?: 'basic' | 'advanced';
  topic?: 'general' | 'news';
}

export const createTavilySearch = (config: TavilyConfig): SearchProvider => {
  if (!config.apiKey)
    throw new SearchError('TAVILY_API_KEY missing', 'CONFIG', { providerId: 'tavily' });
  const search = async (
    query: string,
    options: { numResults?: number } = {},
  ): Promise<SearchResult> => {
    const numResults = Math.min(options.numResults ?? DEFAULT_NUM_RESULTS, MAX_NUM_RESULTS);
    const body = {
      api_key: config.apiKey,
      query,
      max_results: numResults,
      search_depth: config.searchDepth ?? 'basic',
      topic: config.topic ?? 'general',
      include_answer: false,
    };
    const data = await fetchJsonOrThrow(
      TAVILY_SEARCH_URL,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      config,
      'tavily',
    );
    const parsed = TavilyResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new SearchError('tavily: unexpected response shape', 'INVALID_RESPONSE', {
        providerId: 'tavily',
        cause: parsed.error,
      });
    }
    return {
      provider: 'tavily',
      query,
      hits: parsed.data.results.map((r) => ({
        url: r.url,
        title: r.title ?? null,
        snippet: r.content ?? null,
        score: r.score ?? null,
        publishedAt: r.published_date ?? null,
      })),
    };
  };
  return { provider: 'tavily', search };
};
