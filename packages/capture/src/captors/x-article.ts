/**
 * X Article captor — Patchright-rendered SPA scrape. The session is
 * injected (the scraper package owns Patchright); the captor only
 * navigates, evaluates the rich-text view, and stores raw HTML +
 * parsed blocks.
 */

import { canonicalizeUrl } from '@x-scraper/core';
import { isXArticleUrl } from '@x-scraper/ingestor';

import { CAPTURE_SCHEMA_VERSION, MAX_RAW_HTML_BYTES } from '../constants.js';
import { type Captor, CaptureError, type XArticleCaptured } from '../types.js';

const MIN_BODY_CHARS = 300;
const MAX_BODY_CHARS = 250_000;
const X_ARTICLE_NAV_TIMEOUT_MS = 30_000;
const X_ARTICLE_RENDER_WAIT_MS = 3_000;
const X_ARTICLE_BODY_SELECTOR = '[data-testid="twitterArticleReadView"]';
const X_ARTICLE_TITLE_SELECTOR = '[data-testid="twitter-article-title"]';
const X_ARTICLE_CONTENT_SELECTOR = '[data-testid="twitterArticleRichTextView"]';
const X_ARTICLE_USERCELL_SELECTOR = '[data-testid="UserCell"]';

interface CapturePage {
  goto: (url: string, options?: { timeout?: number; waitUntil?: string }) => Promise<unknown>;
  url: () => string;
  waitForLoadState: (state: string, options?: { timeout?: number }) => Promise<void>;
  waitForSelector: (selector: string, options?: { timeout?: number }) => Promise<unknown>;
  waitForTimeout: (ms: number) => Promise<void>;
  content: () => Promise<string>;
  evaluate: <T>(
    fn: (selectors: { title: string; content: string; userCell: string }) => T,
    selectors: { title: string; content: string; userCell: string },
  ) => Promise<T>;
}

export interface XArticleCaptorSession {
  page: CapturePage;
  close: () => Promise<void>;
}

export interface XArticleCaptorConfig {
  openSession: () => Promise<XArticleCaptorSession>;
  now?: () => Date;
}

const clamp = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

const clampBytes = (s: string, maxBytes: number): string => {
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return s;
  return s.slice(0, maxBytes);
};

const TWEET_ID_RE = /\/article\/(\d+)/;

export const createXArticleCaptor = (config: XArticleCaptorConfig): Captor => {
  const now = config.now ?? ((): Date => new Date());
  let cachedSession: XArticleCaptorSession | null = null;
  let openPromise: Promise<XArticleCaptorSession> | null = null;

  const getSession = async (): Promise<XArticleCaptorSession> => {
    if (cachedSession !== null) return cachedSession;
    openPromise ??= config.openSession();
    cachedSession = await openPromise;
    return cachedSession;
  };

  const matches = (url: string): boolean => isXArticleUrl(url);

  const capture = async (url: string): Promise<XArticleCaptured> => {
    const session = await getSession();
    const page = session.page;
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: X_ARTICLE_NAV_TIMEOUT_MS,
      });
    } catch (err) {
      throw new CaptureError(`x-article: navigation failed for ${url}`, 'PARSE', {
        url,
        cause: err,
      });
    }
    try {
      await page.waitForSelector(X_ARTICLE_BODY_SELECTOR, {
        timeout: X_ARTICLE_NAV_TIMEOUT_MS,
      });
    } catch (err) {
      throw new CaptureError(
        `x-article: article view never rendered for ${url} (deleted or unauthorized?)`,
        'PARSE',
        { url, cause: err },
      );
    }
    await page.waitForTimeout(X_ARTICLE_RENDER_WAIT_MS);

    const probe = await page.evaluate(
      (
        selectors,
      ): {
        title: string;
        content: string;
        byline: string;
        canonical: string;
        blocks: { kind: string; text: string }[];
      } => {
        const t = (document.querySelector(selectors.title)?.textContent ?? '').trim();
        const contentEl = document.querySelector<HTMLElement>(selectors.content);
        const rawContent = contentEl?.innerText ?? contentEl?.textContent ?? '';
        const c = rawContent.replace(/\n{3,}/g, '\n\n').trim();
        const userCellEl = document.querySelector<HTMLElement>(selectors.userCell);
        let handle = '';
        if (userCellEl !== null) {
          const anchors = Array.from(userCellEl.querySelectorAll('a[href^="/"]'));
          for (const a of anchors) {
            const href = a.getAttribute('href') ?? '';
            const m = /^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/.exec(href);
            if (m?.[1] !== undefined) {
              handle = m[1];
              break;
            }
          }
        }
        if (handle.length === 0) {
          const u = (userCellEl?.textContent ?? '').trim();
          const handleMatch = /@([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_])/.exec(u);
          handle = handleMatch?.[1] ?? '';
        }
        // Walk top-level children of the rich-text view to recover block
        // structure. tagName + visible text is enough for downstream
        // rendering; the captor doesn't try to be a full HTML parser.
        const blocks: { kind: string; text: string }[] = [];
        if (contentEl !== null) {
          for (const el of Array.from(contentEl.children) as HTMLElement[]) {
            const text = el.innerText.trim();
            if (text.length === 0) continue;
            blocks.push({ kind: el.tagName.toLowerCase(), text });
          }
        }
        return {
          title: t,
          content: c,
          byline: handle.length > 0 ? `@${handle}` : '',
          canonical: window.location.href,
          blocks,
        };
      },
      {
        title: X_ARTICLE_TITLE_SELECTOR,
        content: X_ARTICLE_CONTENT_SELECTOR,
        userCell: X_ARTICLE_USERCELL_SELECTOR,
      },
    );

    if (probe.content.length < MIN_BODY_CHARS) {
      throw new CaptureError(
        `x-article: rendered body too short (${String(probe.content.length)} < ${String(MIN_BODY_CHARS)}) for ${url}`,
        'EMPTY_BODY',
        { url },
      );
    }

    const html = await page.content().catch(() => '');
    const tweetIdMatch = TWEET_ID_RE.exec(probe.canonical.length > 0 ? probe.canonical : url);

    return {
      schema_version: CAPTURE_SCHEMA_VERSION,
      url,
      canonical_url: canonicalizeUrl(probe.canonical.length > 0 ? probe.canonical : url),
      fetched_at: now().toISOString(),
      http_status: 200,
      captor: 'x-article',
      content_type: 'x_article',
      raw_html: clampBytes(html, MAX_RAW_HTML_BYTES),
      blocks: probe.blocks,
      parsed: {
        title: probe.title.length > 0 ? probe.title : null,
        byline: probe.byline.length > 0 ? probe.byline : null,
        body: clamp(probe.content, MAX_BODY_CHARS),
        metadata: {
          tweet_id: tweetIdMatch?.[1] ?? null,
        },
      },
    };
  };

  const dispose = async (): Promise<void> => {
    if (cachedSession !== null) {
      const s = cachedSession;
      cachedSession = null;
      openPromise = null;
      await s.close().catch(() => undefined);
    }
  };

  return { id: 'x-article', matches, capture, dispose };
};
