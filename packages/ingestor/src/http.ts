/**
 * Tiny shared fetch helper. Bounded timeout, default UA, optional headers.
 *
 * fetchImpl is injectable so adapters can be unit-tested without network.
 */

import { DEFAULT_FETCH_TIMEOUT_MS, DEFAULT_USER_AGENT } from './constants.js';
import { IngestorError } from './types.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface FetchOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Override accept for non-HTML resources. Defaults to text/html. */
  accept?: string;
}

export const fetchTextWithTimeout = async (
  url: string,
  options: FetchOptions = {},
): Promise<{ text: string; contentType: string | null }> => {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((u, i) => fetch(u, i));
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const resp = await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': DEFAULT_USER_AGENT,
        accept: options.accept ?? 'text/html,*/*',
        ...options.headers,
      },
    });
    if (!resp.ok) {
      throw new IngestorError(`HTTP ${String(resp.status)} fetching ${url}`, 'PROVIDER', {
        url,
        httpStatus: resp.status,
      });
    }
    const text = await resp.text();
    clearTimeout(timer);
    return { text, contentType: resp.headers.get('content-type') };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof IngestorError) throw err;
    const isAbort = err instanceof Error && err.name === 'AbortError';
    throw new IngestorError(
      isAbort ? `fetch timed out after ${String(timeoutMs)}ms: ${url}` : `fetch failed: ${url}`,
      isAbort ? 'TIMEOUT' : 'UNKNOWN',
      { cause: err, url },
    );
  }
};

export const fetchJsonWithTimeout = async <T>(
  url: string,
  options: FetchOptions = {},
): Promise<T> => {
  const { text } = await fetchTextWithTimeout(url, {
    ...options,
    accept: options.accept ?? 'application/json',
  });
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new IngestorError(`JSON parse failed for ${url}`, 'PARSE', { cause: err, url });
  }
};
