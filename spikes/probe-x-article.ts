/**
 * Probe: load an X Article via authenticated Patchright + dump the
 * rendered DOM. Used to find the right selector(s) for the article
 * ingestor (T14 follow-on).
 */

import * as os from 'node:os';
import * as path from 'node:path';

import { closeSession, openAuthenticatedSession } from '@x-scraper/scraper';

const PROFILE = path.join(os.homedir(), '.config', 'x-scraper', 'browser-profile');
const URL = process.argv[2] ?? 'https://x.com/i/article/2020590196488585217';

const main = async (): Promise<void> => {
  const session = await openAuthenticatedSession({ profileDir: PROFILE });
  try {
    const page = session.page;
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Wait for SPA to render. X uses React; article content lands
    // inside a <article> or [data-testid] element.
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(2_000);

    // Dump candidate selectors.
    const probe = await page.evaluate(() => {
      const out: Record<string, unknown> = {};
      out.title = document.title;
      out.urlNow = window.location.href;
      // Common candidates for X Article body.
      const selectors = [
        'article',
        '[data-testid="article-body"]',
        '[data-testid="tweetText"]',
        '[data-testid="ArticleContent"]',
        '[role="article"]',
        '[data-testid="ArticleBody"]',
        'main [data-testid]',
      ];
      const found: { selector: string; matches: number; firstText?: string }[] = [];
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        const first = (els[0]?.textContent ?? '').trim().slice(0, 200);
        found.push({ selector: sel, matches: els.length, firstText: first });
      }
      out.candidates = found;
      // Largest text block.
      let best = { tag: '', textLen: 0, sample: '' };
      document.querySelectorAll('main *').forEach((el) => {
        const tc = el.textContent as string | null;
        const t = tc === null ? '' : tc.trim();
        if (t.length > best.textLen) {
          best = { tag: el.tagName, textLen: t.length, sample: t.slice(0, 200) };
        }
      });
      out.largestBlock = best;
      // Get all data-testid values on main descendants.
      const testIds = new Set<string>();
      document.querySelectorAll('main [data-testid]').forEach((el) => {
        testIds.add(el.getAttribute('data-testid') ?? '');
      });
      out.testIds = Array.from(testIds);
      return out;
    });

    console.log(JSON.stringify(probe, null, 2));
  } finally {
    await closeSession(session);
  }
};

main().catch((err: unknown) => {
  console.error('probe failed:', err);
  process.exit(1);
});
