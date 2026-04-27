import { describe, expect, it } from 'vitest';

import { MIN_BODY_CHARS } from '../constants.js';
import { IngestorError } from '../types.js';
import {
  createXArticleIngestor,
  isXArticleUrl,
  type XArticlePage,
  type XArticleSession,
} from '../x-article.js';

interface PageFixture {
  title: string;
  /** Raw rendered text for the rich-text view; \n boundaries simulate
   *  what Chromium's innerText emits across <p>/<h2>/<pre> blocks. */
  contentInnerText: string;
  contentTextContent?: string;
  userCellText: string;
  userCellAnchorHref?: string;
  canonicalUrl?: string;
}

const makePage = (fx: PageFixture): XArticlePage => ({
  goto: () => Promise.resolve(undefined),
  url: () => fx.canonicalUrl ?? 'https://x.com/i/article/123',
  waitForLoadState: () => Promise.resolve(),
  waitForSelector: () => Promise.resolve(undefined),
  waitForTimeout: () => Promise.resolve(),
  evaluate: <T>(
    fn: (selectors: { title: string; content: string; userCell: string }) => T,
    selectors: { title: string; content: string; userCell: string },
  ): Promise<T> => {
    const fakeAnchor =
      fx.userCellAnchorHref === undefined
        ? null
        : {
            getAttribute: (name: string): string | null =>
              name === 'href' ? (fx.userCellAnchorHref ?? null) : null,
          };
    const fakeWindow = { location: { href: fx.canonicalUrl ?? 'https://x.com/i/article/123' } };
    const fakeDocument = {
      querySelector: (sel: string): unknown => {
        if (sel === selectors.title) {
          return { textContent: fx.title };
        }
        if (sel === selectors.content) {
          return {
            innerText: fx.contentInnerText,
            textContent: fx.contentTextContent ?? fx.contentInnerText,
          };
        }
        if (sel === selectors.userCell) {
          return {
            textContent: fx.userCellText,
            querySelectorAll: (q: string): unknown[] =>
              q.startsWith('a[href') && fakeAnchor !== null ? [fakeAnchor] : [],
          };
        }
        return null;
      },
    };
    // The user function references `document` and `window` as browser
    // globals (because that's what page.evaluate's contract is). Shim
    // them onto globalThis for the duration of the call, then restore.
    const g = globalThis as unknown as { document?: unknown; window?: unknown };
    const prevDocument = g.document;
    const prevWindow = g.window;
    g.document = fakeDocument;
    g.window = fakeWindow;
    try {
      return Promise.resolve(fn(selectors));
    } finally {
      if (prevDocument === undefined) delete g.document;
      else g.document = prevDocument;
      if (prevWindow === undefined) delete g.window;
      else g.window = prevWindow;
    }
  },
});

const makeSession = (page: XArticlePage): XArticleSession => ({
  page,
  close: () => Promise.resolve(),
});

describe('isXArticleUrl', () => {
  it('matches /<user>/article/<id> on x.com', () => {
    expect(isXArticleUrl('https://x.com/voxyz_ai/article/123')).toBe(true);
  });

  it('matches /i/article/<id> on x.com', () => {
    expect(isXArticleUrl('https://x.com/i/article/123')).toBe(true);
  });

  it('rejects /<user>/status/<id> tweet permalinks', () => {
    expect(isXArticleUrl('https://x.com/voxyz_ai/status/123')).toBe(false);
  });

  it('rejects non-x.com URLs', () => {
    expect(isXArticleUrl('https://example.com/article/1')).toBe(false);
  });
});

describe('createXArticleIngestor', () => {
  const longBody = 'P'.repeat(MIN_BODY_CHARS + 50);

  it('preserves paragraph structure via innerText (not flattened textContent)', async () => {
    const page = makePage({
      title: 'My Article',
      // innerText preserves block boundaries the browser computed
      // post-layout. Three blocks separated by \n\n should survive.
      contentInnerText: `${longBody}\n\nSecond paragraph.\n\nThird paragraph.`,
      // textContent collapses these into one wall-of-text — the prior
      // bug. Set it to the broken form so the test would fail if the
      // ingestor regressed to textContent.
      contentTextContent: `${longBody}Second paragraph.Third paragraph.`,
      userCellText: '@voxyz_aiFollow',
      userCellAnchorHref: '/voxyz_ai',
    });
    const ingestor = createXArticleIngestor({
      openSession: () => Promise.resolve(makeSession(page)),
      now: () => new Date('2026-04-27T00:00:00.000Z'),
    });
    const result = await ingestor.ingest('https://x.com/i/article/123');
    expect(result.kind).toBe('x-article');
    expect(result.title).toBe('My Article');
    expect(result.byline).toBe('@voxyz_ai');
    expect(result.body).toContain('Second paragraph.');
    // The two paragraph separators must survive — no mash-up.
    expect(result.body).toContain('\n\nSecond paragraph.\n\nThird paragraph.');
  });

  it('collapses runs of >2 newlines to exactly 2', async () => {
    const page = makePage({
      title: 'T',
      contentInnerText: `${longBody}\n\n\n\nNext.`,
      userCellText: '@u',
    });
    const ingestor = createXArticleIngestor({
      openSession: () => Promise.resolve(makeSession(page)),
    });
    const result = await ingestor.ingest('https://x.com/i/article/1');
    expect(result.body).toContain('\n\nNext.');
    expect(result.body).not.toContain('\n\n\n');
  });

  it('prefers the user-profile anchor href over UserCell textContent', async () => {
    // textContent of "@voxyz_aiFollow" is exactly 15 chars after @, so
    // a greedy regex would lock in the wrong handle. The anchor href
    // /<handle> is unambiguous; we prefer it for that reason.
    const page = makePage({
      title: 'T',
      contentInnerText: longBody,
      userCellText: '@voxyz_aiFollow',
      userCellAnchorHref: '/voxyz_ai',
    });
    const ingestor = createXArticleIngestor({
      openSession: () => Promise.resolve(makeSession(page)),
    });
    const result = await ingestor.ingest('https://x.com/i/article/1');
    expect(result.byline).toBe('@voxyz_ai');
  });

  it('falls back to the @handle regex when no anchor href is present', async () => {
    const page = makePage({
      title: 'T',
      contentInnerText: longBody,
      // Whitespace separator between handle and label — the regex's
      // negative lookahead breaks correctly here.
      userCellText: '@voxyz_ai Follow',
    });
    const ingestor = createXArticleIngestor({
      openSession: () => Promise.resolve(makeSession(page)),
    });
    const result = await ingestor.ingest('https://x.com/i/article/1');
    expect(result.byline).toBe('@voxyz_ai');
  });

  it('returns null byline when both regex and anchor fallback miss', async () => {
    const page = makePage({
      title: 'T',
      contentInnerText: longBody,
      userCellText: 'No handle here',
    });
    const ingestor = createXArticleIngestor({
      openSession: () => Promise.resolve(makeSession(page)),
    });
    const result = await ingestor.ingest('https://x.com/i/article/1');
    expect(result.byline).toBeNull();
  });

  it('throws EMPTY_BODY when rendered content is below MIN_BODY_CHARS', async () => {
    const page = makePage({
      title: 'T',
      contentInnerText: 'tiny',
      userCellText: '@u',
    });
    const ingestor = createXArticleIngestor({
      openSession: () => Promise.resolve(makeSession(page)),
    });
    await expect(ingestor.ingest('https://x.com/i/article/1')).rejects.toThrow(IngestorError);
  });

  it('reuses the cached session across multiple ingest calls', async () => {
    let openCount = 0;
    const page = makePage({
      title: 'T',
      contentInnerText: longBody,
      userCellText: '@u',
    });
    const ingestor = createXArticleIngestor({
      openSession: () => {
        openCount += 1;
        return Promise.resolve(makeSession(page));
      },
    });
    await ingestor.ingest('https://x.com/i/article/1');
    await ingestor.ingest('https://x.com/i/article/2');
    expect(openCount).toBe(1);
  });
});
