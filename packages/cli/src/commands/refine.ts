/**
 * `xs refine` — re-run the extractor → reconciler → graph pipeline over
 * already-captured sources. No network, no re-scraping.
 *
 * Use cases:
 *  - Roll out a new extraction prompt version without re-fetching any URL.
 *  - Add a new entity type / relationship type to the schema and have it
 *    apply to historical content.
 *  - Recover from a graph wipe (Neo4j reset, schema migration).
 *
 * Implementation: read CaptureStore, build SourceItems whose body is the
 * captured body. The dispatcher's extract_text stage uses the
 * pre-fetched-body short-circuit when body is set, so refine never hits
 * the network. fetch_links is no-oped (those derived rows were enqueued
 * at the original sync).
 */

import type { CapturedSource, CaptureStore } from '@x-scraper/capture';
import { canonicalizeUrl, entityId } from '@x-scraper/core';

import type { SourceItem, SyncDeps, SyncResult } from './sync/index.js';
import { runSync } from './sync/index.js';

export interface RefineOptions {
  /** Filter to a single content_type (article|repo|youtube|pdf|x_article|tweet). */
  contentType?: CapturedSource['content_type'];
  /** Filter to a single source id. */
  sourceId?: string;
  /** Cap how many captures to refine in this run. */
  limit?: number;
  /** Per-job retry budget. Default 3. */
  maxAttempts?: number;
}

export interface RefineResult extends SyncResult {
  capturesScanned: number;
  capturesRefined: number;
}

const inferContentType = (url: string): 'tweet' | 'article' | 'repo' | 'video' | 'pdf' => {
  const X_ARTICLE_PATH_RE =
    /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:i\/)?[^/]+\/article\/\d+/i;
  const TWEET_HOST_RE = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\//i;
  if (X_ARTICLE_PATH_RE.test(url)) return 'article';
  if (TWEET_HOST_RE.test(url)) return 'tweet';
  const lower = url.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (/^https?:\/\/github\.com\/[^/]+\/[^/]+\/?$/i.test(url)) return 'repo';
  if (/youtube\.com\/watch|youtu\.be\//i.test(url)) return 'video';
  return 'article';
};

export const loadSourcesFromCapture = async (
  store: CaptureStore,
  options: RefineOptions = {},
): Promise<SourceItem[]> => {
  const records = await store.list();
  const items: SourceItem[] = [];
  for (const rec of records) {
    if (options.contentType !== undefined && rec.content_type !== options.contentType) continue;
    const captured = await store.read(rec.canonical_url);
    if (captured === null) continue;
    const canonicalUrl = canonicalizeUrl(captured.canonical_url);
    const sourceId = entityId('Source', canonicalUrl);
    if (options.sourceId !== undefined && sourceId !== options.sourceId) continue;
    items.push({
      sourceId,
      sourceKind: 'bookmarks',
      url: canonicalUrl,
      body: captured.parsed.body,
      ...(captured.parsed.title === null ? {} : { title: captured.parsed.title }),
      ...(captured.parsed.byline === null ? {} : { byline: captured.parsed.byline }),
      discoveredAt: captured.fetched_at,
    });
    if (options.limit !== undefined && items.length >= options.limit) break;
  }
  return items;
};

export const runRefine = async (
  deps: Omit<SyncDeps, 'loadSources'>,
  options: RefineOptions = {},
): Promise<RefineResult> => {
  if (deps.captureStore === undefined) {
    throw new Error('xs refine: captureStore is required');
  }
  const capturesScanned = (await deps.captureStore.list()).length;
  const sources = await loadSourcesFromCapture(deps.captureStore, options);
  void inferContentType;
  const syncDeps: SyncDeps = {
    ...deps,
    loadSources: () => Promise.resolve(sources),
  };
  const syncResult = await runSync(syncDeps, {
    source: 'bookmarks',
    skipFetchLinks: true,
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
  });
  return {
    ...syncResult,
    capturesScanned,
    capturesRefined: sources.length,
  };
};
