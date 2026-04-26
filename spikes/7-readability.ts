/**
 * Spike 7 — Article extraction with Readability + Patchright fallback.
 *
 * Tries vanilla fetch + jsdom + Readability first. If extraction is empty
 * or too short, falls back to Patchright (which executes JS) and retries.
 *
 * Success criterion: every URL produces non-empty extracted text. At
 * least one URL exercises the fallback path.
 *
 * Run:  pnpm spike spikes/7-readability.ts
 */

import * as path from 'node:path';

import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';
import { chromium } from 'patchright';

const PROFILE_DIR = path.resolve('spikes/auth/x-profile');
const NAV_TIMEOUT_MS = 30_000;
const MIN_BODY_CHARS = 300;
const FETCH_TIMEOUT_MS = 20_000;
const SAMPLE_PREFIX_CHARS = 200;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

interface Extraction {
  url: string;
  via: 'fetch' | 'patchright' | 'failed';
  title: string | null;
  byline: string | null;
  textLength: number;
  sample: string;
  error?: string;
}

// Article URLs only. Tweet/thread content is handled by spike 2's GraphQL
// path — Readability can't parse X's virtualised tweet UI and shouldn't
// try. Production code routes URLs by host: x.com → tweet extractor;
// everything else → this article extractor.
const URLS = [
  'https://en.wikipedia.org/wiki/Knowledge_graph',
  'https://github.com/getzep/graphiti',
  'https://help.obsidian.md/Home',
  'https://blog.langchain.com/langgraph/',
  'https://martinfowler.com/articles/exploring-gen-ai.html',
];

const fetchWithTimeout = async (url: string): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' },
      redirect: 'follow',
    });
    if (!resp.ok) throw new Error(`HTTP ${String(resp.status)}`);
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
};

const extractFromHtml = (html: string, url: string): Omit<Extraction, 'url' | 'via'> => {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', () => undefined);
  virtualConsole.on('jsdomError', () => undefined);
  const dom = new JSDOM(html, { url, virtualConsole });
  const doc = new Readability(dom.window.document).parse();
  const text = doc?.textContent?.trim() ?? '';
  return {
    title: doc?.title?.trim() ?? null,
    byline: doc?.byline?.trim() ?? null,
    textLength: text.length,
    sample: text.slice(0, SAMPLE_PREFIX_CHARS),
  };
};

const extractViaFetch = async (url: string): Promise<Extraction> => {
  try {
    const html = await fetchWithTimeout(url);
    const parsed = extractFromHtml(html, url);
    return { url, via: 'fetch', ...parsed };
  } catch (err) {
    return {
      url,
      via: 'failed',
      title: null,
      byline: null,
      textLength: 0,
      sample: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

const extractViaPatchright = async (url: string): Promise<Extraction> => {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 800 },
  });
  try {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT_MS }).catch(() => undefined);
    const html = await page.content();
    const parsed = extractFromHtml(html, url);
    return { url, via: 'patchright', ...parsed };
  } catch (err) {
    return {
      url,
      via: 'failed',
      title: null,
      byline: null,
      textLength: 0,
      sample: '',
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await ctx.close();
  }
};

const extract = async (url: string): Promise<Extraction> => {
  const fast = await extractViaFetch(url);
  if (fast.via !== 'failed' && fast.textLength >= MIN_BODY_CHARS) return fast;

  console.log(
    `  [fallback] ${url} — fetch via=${fast.via} chars=${String(fast.textLength)} ${fast.error ?? ''}`,
  );
  return await extractViaPatchright(url);
};

const main = async (): Promise<void> => {
  const results: Extraction[] = [];
  for (const url of URLS) {
    console.log(`extracting: ${url}`);
    const r = await extract(url);
    console.log(
      `  via=${r.via} title=${(r.title ?? '').slice(0, 60)} chars=${String(r.textLength)}`,
    );
    results.push(r);
  }

  console.log('\n=== Spike 7 result ===');
  let allHaveContent = true;
  let usedFallback = false;
  for (const r of results) {
    const hasBody = r.textLength >= MIN_BODY_CHARS;
    if (!hasBody) allHaveContent = false;
    if (r.via === 'patchright') usedFallback = true;
    console.log(
      `[${hasBody ? 'OK' : 'FAIL'}] ${r.via.padEnd(10)} ${String(r.textLength).padStart(6)} chars  ${r.url}`,
    );
  }
  console.log(`\nall URLs >= ${String(MIN_BODY_CHARS)} chars: ${allHaveContent ? 'PASS' : 'FAIL'}`);
  console.log(`fallback exercised: ${usedFallback ? 'PASS' : 'FAIL'}`);

  // The Patchright fallback IS the risk this spike proves; if every URL
  // happens to extract via plain fetch, we haven't actually exercised it.
  const ok = allHaveContent && usedFallback;
  console.log(`\nspike 7 ${ok ? 'PASSED' : 'FAILED'}`);
  if (!ok) process.exit(1);
};

main().catch((err: unknown) => {
  console.error('spike 7 failed:', err);
  process.exit(1);
});
