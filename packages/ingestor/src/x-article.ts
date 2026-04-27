/**
 * X Article ingestor — long-form posts at x.com/<user>/article/<id> or
 * x.com/i/article/<id>. The page is a React SPA whose content arrives
 * after a follow-up GraphQL call, so static HTML + Readability returns
 * nothing. We render the page in a headless authenticated browser and
 * scrape the rendered DOM.
 *
 * The browser session is injected (not constructed here) — the
 * ingestor package can't depend on @x-scraper/scraper without a cycle,
 * and a long-lived session is the wire layer's concern. The ingestor
 * lazy-resolves the session on the first ingest and reuses it across
 * subsequent calls in the same wire scope. dispose() is wired into
 * SyncDeps cleanup so the browser closes when the run ends.
 *
 * Failure modes we map to PARSE (permanent, no retry):
 *   - URL doesn't render the article view (deleted / private).
 *   - Body element renders but contains zero readable text.
 *
 * Things we DON'T handle (for now, by design):
 *   - x.com/<user>/status/<id> tweet permalinks. The bookmark scraper
 *     owns those; standalone tweet ingestion is out of scope.
 */

import {
  MAX_BODY_CHARS,
  MIN_BODY_CHARS,
  X_ARTICLE_BODY_SELECTOR,
  X_ARTICLE_CONTENT_SELECTOR,
  X_ARTICLE_NAV_TIMEOUT_MS,
  X_ARTICLE_RENDER_WAIT_MS,
  X_ARTICLE_TITLE_SELECTOR,
  X_ARTICLE_URL_RE,
  X_ARTICLE_USERCELL_SELECTOR,
  X_TWEET_URL_RE,
} from './constants.js';
import { type IngestedSource, type Ingestor, IngestorError } from './types.js';

/**
 * Minimum surface the ingestor needs from a Patchright page. Defining it
 * in terms of capabilities (not the patchright Page type) keeps this
 * module dependency-free.
 */
export interface XArticlePage {
  goto: (url: string, options?: { timeout?: number; waitUntil?: string }) => Promise<unknown>;
  url: () => string;
  waitForLoadState: (state: string, options?: { timeout?: number }) => Promise<void>;
  waitForSelector: (selector: string, options?: { timeout?: number }) => Promise<unknown>;
  waitForTimeout: (ms: number) => Promise<void>;
  evaluate: <T>(
    fn: (selectors: { title: string; content: string; userCell: string }) => T,
    selectors: { title: string; content: string; userCell: string },
  ) => Promise<T>;
}

export interface XArticleSession {
  page: XArticlePage;
  /** Close the underlying browser context. */
  close: () => Promise<void>;
}

export interface XArticleConfig {
  /**
   * Lazily open the authenticated session. Called at most once (and
   * only if a matching URL actually arrives). Returns the session;
   * the ingestor caches it for subsequent ingests in the same run.
   */
  openSession: () => Promise<XArticleSession>;
  /** Override now() for tests. */
  now?: () => Date;
}

const clamp = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

export const isXArticleUrl = (url: string): boolean =>
  X_ARTICLE_URL_RE.test(url) && !X_TWEET_URL_RE.test(url);

export const createXArticleIngestor = (config: XArticleConfig): Ingestor => {
  const now = config.now ?? ((): Date => new Date());
  let cachedSession: XArticleSession | null = null;
  let openPromise: Promise<XArticleSession> | null = null;

  const getSession = async (): Promise<XArticleSession> => {
    if (cachedSession !== null) return cachedSession;
    // Coalesce concurrent first calls so only one browser context spawns.
    openPromise ??= config.openSession();
    cachedSession = await openPromise;
    return cachedSession;
  };

  const matches = (url: string): boolean => isXArticleUrl(url);

  const ingest = async (url: string): Promise<IngestedSource> => {
    const session = await getSession();
    const page = session.page;
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: X_ARTICLE_NAV_TIMEOUT_MS,
      });
    } catch (err) {
      throw new IngestorError(`x-article: navigation failed for ${url}`, 'PARSE', {
        url,
        cause: err,
      });
    }
    // Skip networkidle — X holds WebSocket connections open, so the
    // 30s timeout would always trip without giving us useful signal.
    // waitForSelector is the right primitive: React mounts the article
    // view as soon as the GraphQL response lands, usually within ~3s.
    try {
      await page.waitForSelector(X_ARTICLE_BODY_SELECTOR, {
        timeout: X_ARTICLE_NAV_TIMEOUT_MS,
      });
    } catch (err) {
      throw new IngestorError(
        `x-article: article view never rendered for ${url} (deleted or unauthorized?)`,
        'PARSE',
        { url, cause: err },
      );
    }
    // Small grace period for React to finish hydrating the rich-text view.
    await page.waitForTimeout(X_ARTICLE_RENDER_WAIT_MS);

    const probe = await page.evaluate(
      (selectors): { title: string; content: string; byline: string; canonical: string } => {
        const t = (document.querySelector(selectors.title)?.textContent ?? '').trim();
        // textContent flattens the rich-text view into one paragraph —
        // headings, paragraphs, code blocks, and list items all run
        // together with no separator, hurting both readability and
        // LLM extraction quality. innerText preserves visible line
        // breaks because the browser computes it post-layout. We
        // collapse runs of >2 newlines to exactly 2 so the output
        // looks like normal markdown paragraphs.
        const contentEl = document.querySelector<HTMLElement>(selectors.content);
        const rawContent = contentEl?.innerText ?? contentEl?.textContent ?? '';
        const c = rawContent.replace(/\n{3,}/g, '\n\n').trim();
        // Byline: prefer the user-profile anchor's href because it's
        // the authoritative handle ("/<handle>"). UserCell textContent
        // concatenates handle + button labels with no separator
        // ("@voxyz_aiFollowC"), and the label can spill into the
        // 15-char handle window so a greedy regex captures the wrong
        // string. Anchor first, regex fallback only when no anchor.
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
        return {
          title: t,
          content: c,
          byline: handle.length > 0 ? `@${handle}` : '',
          canonical: window.location.href,
        };
      },
      {
        title: X_ARTICLE_TITLE_SELECTOR,
        content: X_ARTICLE_CONTENT_SELECTOR,
        userCell: X_ARTICLE_USERCELL_SELECTOR,
      },
    );

    if (probe.content.length < MIN_BODY_CHARS) {
      throw new IngestorError(
        `x-article: rendered body too short (${String(probe.content.length)} < ${String(MIN_BODY_CHARS)}) for ${url}`,
        'EMPTY_BODY',
        { url },
      );
    }

    return {
      url: probe.canonical.length > 0 ? probe.canonical : url,
      kind: 'x-article',
      title: probe.title.length > 0 ? probe.title : null,
      body: clamp(probe.content, MAX_BODY_CHARS),
      byline: probe.byline.length > 0 ? probe.byline : null,
      capturedAt: now().toISOString(),
      metadata: {},
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

  return { kind: 'x-article', matches, ingest, dispose };
};
