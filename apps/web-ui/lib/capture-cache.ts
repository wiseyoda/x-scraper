/**
 * Read raw capture artifacts from the vault's .cache/raw/<sha256>.json
 * tree. The capture package writes these; the web-ui reads them so we
 * can render tweet bodies, article text, and repo metadata inline on
 * source detail pages.
 *
 * Cache key derivation matches `packages/capture/src/store.ts`:
 *   sha256(canonical_url) → hex
 */

import 'server-only';

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { resolveWebUiConfig } from './config';

export type Captor = 'tweet' | 'article' | 'repo' | 'video' | 'pdf' | 'x-article';
export type CapturedContentType = 'tweet' | 'article' | 'repo' | 'video' | 'pdf';

export interface CapturedParsed {
  title: string | null;
  byline: string | null;
  body: string;
  metadata: Record<string, unknown>;
}

export interface CapturedArtifact {
  schema_version: number;
  url: string;
  canonical_url: string;
  fetched_at: string;
  http_status: number;
  captor: Captor;
  content_type: CapturedContentType;
  raw_text?: string;
  parsed: CapturedParsed;
  /** Captor-specific raw fields (raw_html, raw_repo_json, etc.) — kept opaque. */
  [extra: string]: unknown;
}

const cachePathFor = (canonicalUrl: string): string => {
  const sha = createHash('sha256').update(canonicalUrl).digest('hex');
  return path.join(resolveWebUiConfig().vaultDir, '.cache', 'raw', `${sha}.json`);
};

export const readCaptureCache = async (canonicalUrl: string): Promise<CapturedArtifact | null> => {
  try {
    const raw = await fs.readFile(cachePathFor(canonicalUrl), 'utf8');
    const parsed = JSON.parse(raw) as CapturedArtifact;
    return parsed;
  } catch {
    return null;
  }
};

/**
 * Tweet-specific extraction — pulls `parsed.byline` (author handle),
 * `parsed.body` (tweet text), `parsed.metadata.tweet_id`. Returns null
 * if the cache is missing or doesn't look like a tweet.
 */
export interface TweetCaptureView {
  authorHandle: string | null;
  body: string;
  tweetId: string | null;
  fetchedAt: string;
  url: string;
}

export const readTweetCapture = async (canonicalUrl: string): Promise<TweetCaptureView | null> => {
  const cap = await readCaptureCache(canonicalUrl);
  if (cap === null || cap.content_type !== 'tweet') return null;
  const meta = cap.parsed.metadata as Record<string, unknown>;
  const tweetId = typeof meta.tweet_id === 'string' ? meta.tweet_id : null;
  return {
    authorHandle: cap.parsed.byline,
    body: cap.parsed.body,
    tweetId,
    fetchedAt: cap.fetched_at,
    url: cap.canonical_url,
  };
};

export interface ArticleCaptureView {
  title: string | null;
  byline: string | null;
  body: string;
  fetchedAt: string;
  url: string;
}

export const readArticleCapture = async (
  canonicalUrl: string,
): Promise<ArticleCaptureView | null> => {
  const cap = await readCaptureCache(canonicalUrl);
  if (cap === null) return null;
  if (cap.content_type !== 'article' && cap.content_type !== 'pdf') return null;
  return {
    title: cap.parsed.title,
    byline: cap.parsed.byline,
    body: cap.parsed.body,
    fetchedAt: cap.fetched_at,
    url: cap.canonical_url,
  };
};

export interface RepoCaptureView {
  owner: string | null;
  repo: string | null;
  stars: number | null;
  language: string | null;
  body: string;
  fetchedAt: string;
  url: string;
}

export const readRepoCapture = async (canonicalUrl: string): Promise<RepoCaptureView | null> => {
  const cap = await readCaptureCache(canonicalUrl);
  if (cap === null || cap.content_type !== 'repo') return null;
  const meta = cap.parsed.metadata as Record<string, unknown>;
  const owner = typeof meta.owner === 'string' ? meta.owner : null;
  const repo = typeof meta.repo === 'string' ? meta.repo : null;
  const stars =
    typeof meta.stars === 'number'
      ? meta.stars
      : typeof meta.stars === 'string'
        ? Number.parseInt(meta.stars, 10)
        : null;
  const language = typeof meta.language === 'string' ? meta.language : null;
  return {
    owner,
    repo,
    stars,
    language,
    body: cap.parsed.body,
    fetchedAt: cap.fetched_at,
    url: cap.canonical_url,
  };
};
