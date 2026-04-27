/**
 * Article captor — fetch raw HTML, run Readability, store both.
 *
 * Reuses parseArticleHtml from the ingestor package so the parser stays
 * single-source. The captor's job is only the network step + envelope.
 */

import { canonicalizeUrl } from '@x-scraper/core';
import type { FetchOptions } from '@x-scraper/ingestor';
import { fetchTextWithTimeout, parseArticleHtml } from '@x-scraper/ingestor';

import { CAPTURE_SCHEMA_VERSION, MAX_RAW_HTML_BYTES } from '../constants.js';
import { type ArticleCaptured, type Captor, CaptureError } from '../types.js';

export interface ArticleCaptorConfig extends FetchOptions {
  now?: () => Date;
}

const PROTOCOL_HTTPS = 'https:';
const PROTOCOL_HTTP = 'http:';

const isHttp = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === PROTOCOL_HTTPS || parsed.protocol === PROTOCOL_HTTP;
  } catch {
    return false;
  }
};

const clampBytes = (s: string, maxBytes: number): string => {
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return s;
  // Slice in chars; not exact for multi-byte but close enough — the cap
  // is defensive against pathological pages, not a security boundary.
  return s.slice(0, maxBytes);
};

export const createArticleCaptor = (config: ArticleCaptorConfig = {}): Captor => {
  const now = config.now ?? ((): Date => new Date());

  const matches = (url: string): boolean => isHttp(url);

  const capture = async (url: string): Promise<ArticleCaptured> => {
    if (!isHttp(url)) {
      throw new CaptureError(`unsupported URL: ${url}`, 'UNSUPPORTED_URL', { url });
    }
    const { text, contentType } = await fetchTextWithTimeout(url, config);
    void contentType;
    let parsed: { title: string | null; byline: string | null; body: string };
    try {
      parsed = parseArticleHtml(text, url);
    } catch (err) {
      throw new CaptureError(
        `Readability failed for ${url}`,
        err instanceof Error && err.name === 'IngestorError' ? 'PARSE' : 'PARSE',
        { url, cause: err },
      );
    }
    return {
      schema_version: CAPTURE_SCHEMA_VERSION,
      url,
      canonical_url: canonicalizeUrl(url),
      fetched_at: now().toISOString(),
      http_status: 200,
      captor: 'article',
      content_type: 'article',
      raw_html: clampBytes(text, MAX_RAW_HTML_BYTES),
      parsed: {
        title: parsed.title,
        byline: parsed.byline,
        body: parsed.body,
      },
    };
  };

  return { id: 'article', matches, capture };
};
