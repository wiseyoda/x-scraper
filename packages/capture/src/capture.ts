/**
 * Top-level capture dispatcher. Routes a URL to the matching captor and
 * writes the result to the cache. Cached entries short-circuit re-capture
 * unless `force: true` is passed (used by `xs refine --refresh`).
 */

import { canonicalizeUrl } from '@x-scraper/core';

import type { CaptureStore } from './store.js';
import { type Captor, type CapturedSource, CaptureError } from './types.js';

export const selectCaptor = (url: string, captors: Captor[]): Captor => {
  for (const c of captors) {
    if (c.matches(url)) return c;
  }
  throw new CaptureError(`no captor matched ${url}`, 'UNSUPPORTED_URL', { url });
};

export interface CaptureOptions {
  /** Force a fresh capture even if the cache has an entry. */
  force?: boolean;
}

/**
 * Get a CapturedSource for a URL. Reads cache when present, otherwise
 * runs the matching captor and writes the result back to the cache.
 */
export const captureWithCache = async (
  url: string,
  captors: Captor[],
  store: CaptureStore,
  options: CaptureOptions = {},
): Promise<{ captured: CapturedSource; fromCache: boolean }> => {
  const canonical = canonicalizeUrl(url);
  if (options.force !== true) {
    const cached = await store.read(canonical);
    if (cached !== null) {
      return { captured: cached, fromCache: true };
    }
  }
  const captor = selectCaptor(url, captors);
  const captured = await captor.capture(url);
  await store.write(captured);
  return { captured, fromCache: false };
};

export const captureMany = async (
  urls: string[],
  captors: Captor[],
  store: CaptureStore,
  options: CaptureOptions & { onProgress?: (done: number, total: number) => void } = {},
): Promise<{
  captured: CapturedSource[];
  fromCache: number;
  freshlyFetched: number;
  failures: { url: string; error: Error }[];
}> => {
  const result: CapturedSource[] = [];
  let fromCache = 0;
  let freshlyFetched = 0;
  const failures: { url: string; error: Error }[] = [];
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    if (url === undefined) continue;
    try {
      const r = await captureWithCache(url, captors, store, options);
      result.push(r.captured);
      if (r.fromCache) fromCache += 1;
      else freshlyFetched += 1;
    } catch (err) {
      failures.push({
        url,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
    options.onProgress?.(i + 1, urls.length);
  }
  return { captured: result, fromCache, freshlyFetched, failures };
};
