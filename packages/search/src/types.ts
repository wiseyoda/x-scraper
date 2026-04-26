/**
 * SearchProvider port + shared types.
 */

import type { SearchProviderId } from './constants.js';

export interface SearchHit {
  url: string;
  title: string | null;
  snippet: string | null;
  /** Provider-reported relevance, normalized to 0..1 where possible. */
  score: number | null;
  publishedAt: string | null;
}

export interface SearchResult {
  provider: SearchProviderId;
  query: string;
  hits: SearchHit[];
}

export interface SearchOptions {
  numResults?: number;
}

export interface SearchProvider {
  readonly provider: SearchProviderId;
  search: (query: string, options?: SearchOptions) => Promise<SearchResult>;
}

export type SearchErrorCode =
  | 'CONFIG'
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'PROVIDER'
  | 'INVALID_RESPONSE'
  | 'INVALID_INPUT'
  | 'UNKNOWN';

export class SearchError extends Error {
  public readonly code: SearchErrorCode;
  public override readonly cause: unknown;
  public readonly httpStatus: number | null;
  public readonly providerId: SearchProviderId | null;

  constructor(
    message: string,
    code: SearchErrorCode,
    options: {
      cause?: unknown;
      httpStatus?: number | null;
      providerId?: SearchProviderId | null;
    } = {},
  ) {
    super(message);
    this.name = 'SearchError';
    this.code = code;
    this.cause = options.cause;
    this.httpStatus = options.httpStatus ?? null;
    this.providerId = options.providerId ?? null;
  }
}
