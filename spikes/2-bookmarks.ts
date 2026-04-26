/// <reference lib="dom" />
/**
 * Spike 2 — Bookmarks pagination via GraphQL.
 *
 * Goal: confirm we can fetch the user's bookmarks (>= 50) and follow the
 * cursor across pages. Two paths:
 *   (A) passive: open /i/bookmarks, auto-scroll, intercept the real
 *       frontend's Bookmarks GraphQL responses
 *   (B) active replay: take the captured request from (A) and re-issue it
 *       via context.request to confirm we can drive pagination ourselves
 *
 * Run:  pnpm spike spikes/2-bookmarks.ts
 * Prereq: spike 1 has run successfully (profile is at spikes/auth/x-profile).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { APIRequestContext, BrowserContext, Page, Response } from 'patchright';
import { chromium } from 'patchright';

const PROFILE_DIR = path.resolve('spikes/auth/x-profile');
const FIXTURES_DIR = path.resolve('spikes/fixtures');
const BOOKMARKS_URL = 'https://x.com/i/bookmarks';
const NAV_TIMEOUT_MS = 30_000;
const SCROLL_PAUSE_MS = 2500;
const SCROLL_TIMES = 20;
const PASSIVE_TARGET_BOOKMARKS = 50;
const ACTIVE_REPLAY_PAGES = 3;
const RESPONSE_PATH_MARKER = '/Bookmarks';

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData: string | null;
}

interface BookmarkEntry {
  entryId: string;
  isCursor: boolean;
  cursorType: string | undefined;
  cursorValue: string | undefined;
}

interface InstructionEntry {
  entryId?: string;
  content?: {
    cursorType?: string;
    value?: string;
    itemContent?: { tweet_results?: { result?: { rest_id?: string } } };
  };
}

interface BookmarksResponse {
  data?: {
    bookmark_timeline_v2?: {
      timeline?: {
        instructions?: { type?: string; entries?: InstructionEntry[] }[];
      };
    };
  };
}

const ensureDir = (dir: string): void => {
  fs.mkdirSync(dir, { recursive: true });
};

const isBookmarksResponse = (resp: Response): boolean => {
  return resp.url().includes(RESPONSE_PATH_MARKER) && resp.request().method() === 'GET';
};

const parseEntries = (json: BookmarksResponse): BookmarkEntry[] => {
  const out: BookmarkEntry[] = [];
  const instructions = json.data?.bookmark_timeline_v2?.timeline?.instructions ?? [];
  for (const ins of instructions) {
    if (ins.type !== 'TimelineAddEntries') continue;
    for (const entry of ins.entries ?? []) {
      if (!entry.entryId) continue;
      const isCursor = entry.entryId.startsWith('cursor-');
      out.push({
        entryId: entry.entryId,
        isCursor,
        cursorType: entry.content?.cursorType,
        cursorValue: entry.content?.value,
      });
    }
  }
  return out;
};

const capturePassive = async (
  ctx: BrowserContext,
  page: Page,
): Promise<{ captured: CapturedRequest; entries: BookmarkEntry[]; rawPages: BookmarksResponse[] }> => {
  // Holder pattern keeps TS from narrowing the field to null after the
  // synchronous flow completes; the listener mutates it asynchronously.
  const captured: { value: CapturedRequest | null } = { value: null };
  const rawPages: BookmarksResponse[] = [];
  const entries: BookmarkEntry[] = [];

  ctx.on('response', (resp) => {
    if (!isBookmarksResponse(resp)) return;
    void (async () => {
      try {
        const json = (await resp.json()) as BookmarksResponse;
        rawPages.push(json);
        entries.push(...parseEntries(json));
        if (captured.value === null) {
          const req = resp.request();
          captured.value = {
            url: resp.url(),
            method: req.method(),
            headers: await req.allHeaders(),
            postData: req.postData(),
          };
        }
      } catch {
        // ignore non-JSON responses
      }
    })();
  });

  await page.goto(BOOKMARKS_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT_MS }).catch(() => undefined);

  let nonCursor = entries.filter((e) => !e.isCursor).length;
  let lastNonCursor = -1;
  for (let i = 0; i < SCROLL_TIMES && nonCursor < PASSIVE_TARGET_BOOKMARKS; i += 1) {
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await page.waitForTimeout(SCROLL_PAUSE_MS);
    nonCursor = entries.filter((e) => !e.isCursor).length;
    if (nonCursor === lastNonCursor) {
      // No progress this iteration — try one more nudge then bail.
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(SCROLL_PAUSE_MS);
      nonCursor = entries.filter((e) => !e.isCursor).length;
      if (nonCursor === lastNonCursor) break;
    }
    lastNonCursor = nonCursor;
  }

  if (captured.value === null) {
    throw new Error('did not capture any Bookmarks GraphQL response');
  }
  return { captured: captured.value, entries, rawPages };
};

const buildReplayUrl = (capturedUrl: string, cursor: string | undefined): string => {
  const url = new URL(capturedUrl);
  const variablesStr = url.searchParams.get('variables');
  if (variablesStr === null) return capturedUrl;
  const parsed = JSON.parse(variablesStr) as Record<string, unknown>;
  const { cursor: _drop, ...rest } = parsed;
  const next: Record<string, unknown> = cursor === undefined ? rest : { ...rest, cursor };
  url.searchParams.set('variables', JSON.stringify(next));
  return url.toString();
};

const replayActive = async (
  api: APIRequestContext,
  captured: CapturedRequest,
): Promise<{ entries: BookmarkEntry[]; pages: BookmarksResponse[] }> => {
  // Drop HTTP/2 pseudo-headers like :authority, :path that can't be replayed.
  const headers: Record<string, string> = Object.fromEntries(
    Object.entries(captured.headers).filter(([k]) => !k.startsWith(':')),
  );

  let cursor: string | undefined;
  const allEntries: BookmarkEntry[] = [];
  const pages: BookmarksResponse[] = [];

  for (let i = 0; i < ACTIVE_REPLAY_PAGES; i += 1) {
    const url = buildReplayUrl(captured.url, cursor);
    const resp = await api.get(url, { headers });
    if (!resp.ok()) {
      throw new Error(`active replay page ${String(i + 1)} HTTP ${String(resp.status())}`);
    }
    const json = (await resp.json()) as BookmarksResponse;
    pages.push(json);
    const pageEntries = parseEntries(json);
    allEntries.push(...pageEntries);
    const bottom = pageEntries.find((e) => e.cursorType === 'Bottom');
    if (!bottom?.cursorValue) {
      console.log(`[active] no bottom cursor on page ${String(i + 1)} — stopping`);
      break;
    }
    cursor = bottom.cursorValue;
    await new Promise((r) => setTimeout(r, SCROLL_PAUSE_MS));
  }
  return { entries: allEntries, pages };
};

const main = async (): Promise<void> => {
  ensureDir(FIXTURES_DIR);
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 800 },
  });
  try {
    const page = await ctx.newPage();

    console.log('=== passive capture ===');
    const passive = await capturePassive(ctx, page);
    const passiveTweets = passive.entries.filter((e) => !e.isCursor);
    console.log(`captured ${String(passive.rawPages.length)} GraphQL pages`);
    console.log(`extracted ${String(passiveTweets.length)} tweet entries`);
    console.log(`example: ${passiveTweets[0]?.entryId ?? '(none)'}`);

    fs.writeFileSync(
      path.join(FIXTURES_DIR, 'bookmarks-passive.raw.json'),
      JSON.stringify(passive.rawPages, null, 2),
    );
    fs.writeFileSync(
      path.join(FIXTURES_DIR, 'bookmarks-passive.captured.json'),
      JSON.stringify(passive.captured, null, 2),
    );

    console.log('\n=== active replay ===');
    const active = await replayActive(ctx.request, passive.captured);
    const activeTweets = active.entries.filter((e) => !e.isCursor);
    console.log(`replayed ${String(active.pages.length)} pages`);
    console.log(`extracted ${String(activeTweets.length)} tweet entries`);
    fs.writeFileSync(
      path.join(FIXTURES_DIR, 'bookmarks-active.raw.json'),
      JSON.stringify(active.pages, null, 2),
    );

    console.log('\n=== Spike 2 result ===');
    const passiveOk = passiveTweets.length >= PASSIVE_TARGET_BOOKMARKS;
    const activeOk = activeTweets.length > 0;
    console.log(`passive >= ${String(PASSIVE_TARGET_BOOKMARKS)} bookmarks: ${passiveOk ? 'PASS' : 'FAIL'} (got ${String(passiveTweets.length)})`);
    console.log(`active replay returned data: ${activeOk ? 'PASS' : 'FAIL'} (got ${String(activeTweets.length)})`);
    const ok = passiveOk && activeOk;
    console.log(`\nspike 2 ${ok ? 'PASSED' : 'FAILED'}`);
    if (!ok) process.exit(1);
  } finally {
    await ctx.close();
  }
};

main().catch((err: unknown) => {
  console.error('spike 2 failed:', err);
  process.exit(1);
});
