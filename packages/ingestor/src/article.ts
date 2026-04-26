/**
 * Article ingestor — Readability over fetched HTML.
 *
 * No Patchright fallback in this package; the queue can promote a
 * failing article job to a "render with Patchright" follow-up later.
 * Keeping this adapter dependency-light makes the unit tests instant.
 */

import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';

import { MAX_BODY_CHARS, MIN_BODY_CHARS } from './constants.js';
import { type FetchOptions, fetchTextWithTimeout } from './http.js';
import { type IngestedSource, type Ingestor, IngestorError } from './types.js';

export interface ArticleConfig extends FetchOptions {
  /** Treat any URL as an article (default true) — used for tests / overrides. */
  acceptAnyUrl?: boolean;
  /** Override the now() fn for deterministic tests. */
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

const clamp = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

export const parseArticleHtml = (
  html: string,
  url: string,
): { title: string | null; byline: string | null; body: string } => {
  const virtualConsole = new VirtualConsole();
  // Discard the noisy "css parser" / "could not load image" chatter that
  // jsdom emits for half-rendered pages.
  virtualConsole.on('error', () => undefined);
  virtualConsole.on('warn', () => undefined);
  virtualConsole.on('jsdomError', () => undefined);

  const dom = new JSDOM(html, { url, virtualConsole });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (article === null) {
    throw new IngestorError(`Readability returned null for ${url}`, 'PARSE', { url });
  }
  const body = (article.textContent ?? '').trim();
  if (body.length < MIN_BODY_CHARS) {
    throw new IngestorError(
      `extracted body too short (${String(body.length)} < ${String(MIN_BODY_CHARS)}) for ${url}`,
      'EMPTY_BODY',
      { url },
    );
  }
  const trimmedTitle = article.title?.trim() ?? '';
  const trimmedByline = article.byline?.trim() ?? '';
  return {
    title: trimmedTitle.length > 0 ? trimmedTitle : null,
    byline: trimmedByline.length > 0 ? trimmedByline : null,
    body: clamp(body, MAX_BODY_CHARS),
  };
};

export const createArticleIngestor = (config: ArticleConfig = {}): Ingestor => {
  const now = config.now ?? ((): Date => new Date());

  const matches = (url: string): boolean => {
    if (!isHttp(url)) return false;
    if (config.acceptAnyUrl !== false) return true;
    return true;
  };

  const ingest = async (url: string): Promise<IngestedSource> => {
    if (!isHttp(url)) {
      throw new IngestorError(`unsupported URL: ${url}`, 'UNSUPPORTED_URL', { url });
    }
    const { text } = await fetchTextWithTimeout(url, config);
    const parsed = parseArticleHtml(text, url);
    return {
      url,
      kind: 'article',
      title: parsed.title,
      body: parsed.body,
      byline: parsed.byline,
      capturedAt: now().toISOString(),
      metadata: {},
    };
  };

  return { kind: 'article', matches, ingest };
};
