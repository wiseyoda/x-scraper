/**
 * Tweet "captor" — synthesizes a CapturedSource from text the bookmark
 * scraper already pulled. No network step; just envelope conversion.
 *
 * Keeping tweets in the capture cache (alongside articles, repos, etc.)
 * makes refine uniform: every refine target reads from the same store
 * regardless of how the source was obtained.
 */

import { canonicalizeUrl } from '@x-scraper/core';

import { CAPTURE_SCHEMA_VERSION } from '../constants.js';
import { type Captor, CaptureError, type TweetCaptured } from '../types.js';

const TWEET_HOST_RE = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\//i;
const X_ARTICLE_PATH_RE =
  /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:i\/)?[^/]+\/article\/\d+/i;
const TWEET_ID_RE = /\/status\/(\d+)/;
const MIN_BODY_CHARS = 1;

export interface TweetCaptorConfig {
  now?: () => Date;
}

/**
 * Tweet captor takes pre-fetched text via build(). Network capture isn't
 * a thing for tweets in this pipeline — the scraper produces them.
 */
export interface TweetCaptureInput {
  url: string;
  text: string;
  title: string | null;
  byline: string | null;
}

export const buildTweetCapture = (
  input: TweetCaptureInput,
  now: () => Date = () => new Date(),
): TweetCaptured => {
  if (input.text.length < MIN_BODY_CHARS) {
    throw new CaptureError(`tweet body empty for ${input.url}`, 'EMPTY_BODY', { url: input.url });
  }
  const tweetMatch = TWEET_ID_RE.exec(input.url);
  return {
    schema_version: CAPTURE_SCHEMA_VERSION,
    url: input.url,
    canonical_url: canonicalizeUrl(input.url),
    fetched_at: now().toISOString(),
    http_status: 0,
    captor: 'tweet',
    content_type: 'tweet',
    raw_text: input.text,
    parsed: {
      title: input.title,
      byline: input.byline,
      body: input.text,
      metadata: {
        tweet_id: tweetMatch?.[1] ?? null,
      },
    },
  };
};

export const createTweetCaptor = (config: TweetCaptorConfig = {}): Captor => {
  const now = config.now ?? ((): Date => new Date());

  const matches = (url: string): boolean => TWEET_HOST_RE.test(url) && !X_ARTICLE_PATH_RE.test(url);

  const capture = async (_url: string): Promise<TweetCaptured> => {
    void now;
    await Promise.resolve();
    throw new CaptureError(
      'tweet captor cannot capture from URL alone — use buildTweetCapture(text)',
      'CONFIG',
    );
  };

  return { id: 'tweet', matches, capture };
};
