/**
 * Shared timeout-bounded fetch for the search adapters. fetchImpl is
 * injectable so tests don't touch the network.
 */

import type { SearchProviderId } from './constants.js';
import { DEFAULT_REQUEST_TIMEOUT_MS } from './constants.js';
import { SearchError, type SearchErrorCode } from './types.js';

const HTTP_TOO_MANY = 429;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpConfig {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export const fetchJsonOrThrow = async (
  url: string,
  init: RequestInit,
  config: HttpConfig,
  providerId: SearchProviderId,
): Promise<unknown> => {
  const fetchImpl: FetchLike = config.fetchImpl ?? ((u, i) => fetch(u, i));
  const timeoutMs = config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  let resp: Response;
  try {
    resp = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    throw new SearchError(
      isAbort
        ? `${providerId} timed out after ${String(timeoutMs)}ms`
        : `${providerId} fetch failed`,
      isAbort ? 'TIMEOUT' : 'UNKNOWN',
      { cause: err, providerId },
    );
  }
  try {
    if (resp.ok) {
      const data: unknown = await resp.json();
      clearTimeout(timer);
      return data;
    }
    const body = await resp.text().catch(() => '<no body>');
    clearTimeout(timer);
    const code: SearchErrorCode = resp.status === HTTP_TOO_MANY ? 'RATE_LIMIT' : 'PROVIDER';
    throw new SearchError(
      `${providerId} returned HTTP ${String(resp.status)}: ${body.slice(0, 300)}`,
      code,
      { httpStatus: resp.status, providerId },
    );
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof SearchError) throw err;
    throw new SearchError(`${providerId} response read failed`, 'UNKNOWN', {
      cause: err,
      providerId,
    });
  }
};
