/**
 * HTTP helpers shared by adapters: timeout-bounded fetch + retry-with-backoff.
 *
 * `fetchImpl` is injectable so tests can pass a stub without monkey-patching
 * global fetch. In production we use globalThis.fetch (Node 22+).
 */

import {
  DEFAULT_BACKOFF_MULTIPLIER,
  DEFAULT_INITIAL_BACKOFF_MS,
  DEFAULT_MAX_BACKOFF_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from './constants.js';
import { EmbeddingError } from './types.js';

const HTTP_TOO_MANY = 429;
const HTTP_SERVER_FLOOR = 500;
const HTTP_SERVER_CEIL = 600;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpConfig {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
  initialBackoffMs?: number;
  backoffMultiplier?: number;
  maxBackoffMs?: number;
  /** Test seam: deterministic sleeper. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isRetryableStatus = (status: number): boolean =>
  status === HTTP_TOO_MANY || (status >= HTTP_SERVER_FLOOR && status < HTTP_SERVER_CEIL);

export const fetchJsonWithRetry = async <T>(
  url: string,
  init: RequestInit,
  config: HttpConfig = {},
): Promise<T> => {
  const fetchImpl: FetchLike = config.fetchImpl ?? ((u, i) => fetch(u, i));
  const timeoutMs = config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialBackoffMs = config.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
  const backoffMultiplier = config.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER;
  const maxBackoffMs = config.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const sleep = config.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    let resp: Response;
    try {
      resp = await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (attempt === maxRetries) {
        throw new EmbeddingError(
          isAbort ? `embedding request timed out after ${String(timeoutMs)}ms` : 'network error',
          isAbort ? 'TIMEOUT' : 'UNKNOWN',
          { cause: err },
        );
      }
      const delay = Math.min(initialBackoffMs * Math.pow(backoffMultiplier, attempt), maxBackoffMs);
      await sleep(delay);
      continue;
    }

    // Keep the abort timer armed while reading the body — a server can send
    // headers and then stall the body indefinitely. Only clear after the
    // body is fully consumed (or the read fails).
    try {
      if (resp.ok) {
        const parsed = (await resp.json()) as T;
        clearTimeout(timer);
        return parsed;
      }
      if (!isRetryableStatus(resp.status) || attempt === maxRetries) {
        const text = await resp.text().catch(() => '<no body>');
        clearTimeout(timer);
        throw new EmbeddingError(
          `provider returned HTTP ${String(resp.status)}: ${text.slice(0, 300)}`,
          resp.status === HTTP_TOO_MANY ? 'RATE_LIMIT' : 'PROVIDER',
          { httpStatus: resp.status },
        );
      }
      // Drain the body before retry so we don't leak the connection.
      await resp.text().catch(() => '');
      clearTimeout(timer);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof EmbeddingError) throw err;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (attempt === maxRetries) {
        throw new EmbeddingError(
          isAbort
            ? `embedding response body timed out after ${String(timeoutMs)}ms`
            : 'response body read failed',
          isAbort ? 'TIMEOUT' : 'UNKNOWN',
          { cause: err },
        );
      }
      lastError = err;
      const delay = Math.min(initialBackoffMs * Math.pow(backoffMultiplier, attempt), maxBackoffMs);
      await sleep(delay);
      continue;
    }

    lastError = new Error(`HTTP ${String(resp.status)}`);
    const delay = Math.min(initialBackoffMs * Math.pow(backoffMultiplier, attempt), maxBackoffMs);
    await sleep(delay);
  }

  throw new EmbeddingError(`embedding request exhausted retries`, 'PROVIDER', { cause: lastError });
};
