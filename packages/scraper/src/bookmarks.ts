/**
 * Bookmarks fetching: passive capture (intercept the real frontend's
 * GraphQL responses while auto-scrolling) plus active replay (re-issue
 * the captured request with mutated cursor). Pattern proven in spike 2.
 *
 * Production callers normally use `fetchBookmarks` which prefers the
 * cheap active path and only falls back to passive if active fails or
 * looks rate-limited.
 */

import type { APIRequestContext, Response } from 'patchright';

import type { OpenedSession } from './auth.js';
import {
  ACTIVE_DEFAULT_MAX_PAGES,
  ACTIVE_INTER_PAGE_DELAY_MS,
  BOOKMARKS_GRAPHQL_MARKER,
  MAX_BOOKMARKS_PER_SESSION,
  MOUSE_WHEEL_NUDGE_PX,
  NAV_TIMEOUT_MS,
  NETWORK_IDLE_TIMEOUT_MS,
  PASSIVE_TARGET_BOOKMARKS,
  RATE_LIMIT_BACKOFF_MULTIPLIER,
  RATE_LIMIT_INITIAL_BACKOFF_MS,
  RATE_LIMIT_MAX_BACKOFF_MS,
  SCROLL_PAUSE_MS,
  SCROLL_TIMES,
  X_BOOKMARKS_URL,
} from './constants.js';
import { buildCursorReplayUrl, parseBookmarksPage, stripHttp2PseudoHeaders } from './parsing.js';
import type { BookmarkRecord, SyncOptions } from './types.js';
import { ScraperError } from './types.js';

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
}

const HTTP_TOO_MANY = 429;

const isBookmarksResponse = (resp: Response): boolean =>
  resp.url().includes(BOOKMARKS_GRAPHQL_MARKER) && resp.request().method() === 'GET';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface PassiveOutcome {
  records: BookmarkRecord[];
  captured: CapturedRequest;
  bottomCursor: string | null;
}

/**
 * Drive the rendered bookmarks page and capture every Bookmarks GraphQL
 * response. Used both as the discovery step (we learn the request URL +
 * headers from a real frontend call) and as the rate-limit-resilient
 * fallback when active replay fails.
 */
export const passiveCaptureBookmarks = async (
  session: OpenedSession,
  options: { target: number },
): Promise<PassiveOutcome> => {
  const page = session.page;
  const records: BookmarkRecord[] = [];
  // Holder pattern: TS narrows `let x: T | null = null` to never-reassigned
  // when the assignment happens in an async listener it can't see.
  const captured: { value: CapturedRequest | null } = { value: null };
  const cursorHolder: { value: string | null } = { value: null };
  const target = Math.min(options.target, MAX_BOOKMARKS_PER_SESSION);
  // Track in-flight response handlers so the caller awaits parse + capture
  // before deciding "no capture happened" — fire-and-forget would race.
  const pending = new Set<Promise<void>>();

  session.context.on('response', (resp) => {
    if (!isBookmarksResponse(resp)) return;
    const work = (async (): Promise<void> => {
      try {
        // Capture URL synchronously before any await so the order-of-arrival
        // race with the main loop's exit can't lose us a valid request.
        const url = resp.url();
        const json: unknown = await resp.json();
        const parsed = parseBookmarksPage(json, 'bookmarks');
        records.push(...parsed.records);
        if (parsed.bottomCursor !== null) cursorHolder.value = parsed.bottomCursor;
        captured.value ??= {
          url,
          headers: stripHttp2PseudoHeaders(await resp.request().allHeaders()),
        };
      } catch {
        // Not every Bookmarks-marker response is the real op (some are
        // partial errors we've already accounted for).
      }
    })();
    pending.add(work);
    void work.finally(() => pending.delete(work));
  });

  await page.goto(X_BOOKMARKS_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await page
    .waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS })
    .catch(() => undefined);

  let last = -1;
  for (let i = 0; i < SCROLL_TIMES && records.length < target; i += 1) {
    await page.evaluate(() => {
      const w = (globalThis as unknown as { window?: Window }).window;
      const d = (globalThis as unknown as { document?: Document }).document;
      if (w && d) w.scrollTo(0, d.documentElement.scrollHeight);
    });
    await page.waitForTimeout(SCROLL_PAUSE_MS);
    if (records.length === last) {
      await page.mouse.wheel(0, MOUSE_WHEEL_NUDGE_PX);
      await page.waitForTimeout(SCROLL_PAUSE_MS);
      if (records.length === last) break;
    }
    last = records.length;
  }

  // Drain in-flight response handlers so we don't return before they've
  // had a chance to populate `captured.value` and `records`.
  await Promise.all(pending);

  if (captured.value === null) {
    throw new ScraperError('did not capture any Bookmarks GraphQL response', 'ENDPOINT_CHANGED');
  }
  return { records, captured: captured.value, bottomCursor: cursorHolder.value };
};

interface ActiveOutcome {
  records: BookmarkRecord[];
  pages: number;
  stoppedReason: 'cursor-exhausted' | 'max-pages' | 'max-records' | 'rate-limited';
  bottomCursor: string | null;
}

const replayActiveBookmarks = async (
  api: APIRequestContext,
  captured: CapturedRequest,
  options: { maxPages: number; maxRecords: number; cursorFrom: string | undefined },
): Promise<ActiveOutcome> => {
  const records: BookmarkRecord[] = [];
  let cursor = options.cursorFrom;
  let stoppedReason: ActiveOutcome['stoppedReason'] = 'max-pages';
  let backoff = RATE_LIMIT_INITIAL_BACKOFF_MS;
  let pages = 0;
  let bottomCursor: string | null = options.cursorFrom ?? null;

  for (let i = 0; i < options.maxPages; i += 1) {
    const url = buildCursorReplayUrl(captured.url, cursor);
    const resp = await api.get(url, { headers: captured.headers });
    if (resp.status() === HTTP_TOO_MANY) {
      if (backoff > RATE_LIMIT_MAX_BACKOFF_MS) {
        stoppedReason = 'rate-limited';
        break;
      }
      await sleep(backoff);
      backoff *= RATE_LIMIT_BACKOFF_MULTIPLIER;
      continue;
    }
    if (!resp.ok()) {
      throw new ScraperError(
        `active replay page ${String(i + 1)} HTTP ${String(resp.status())}`,
        'NETWORK',
      );
    }
    const json: unknown = await resp.json();
    const parsed = parseBookmarksPage(json, 'bookmarks');
    records.push(...parsed.records);
    pages += 1;
    if (parsed.bottomCursor !== null) bottomCursor = parsed.bottomCursor;
    if (records.length >= options.maxRecords) {
      stoppedReason = 'max-records';
      break;
    }
    if (parsed.bottomCursor === null) {
      stoppedReason = 'cursor-exhausted';
      break;
    }
    cursor = parsed.bottomCursor;
    await sleep(ACTIVE_INTER_PAGE_DELAY_MS);
  }

  return {
    records: records.slice(0, options.maxRecords),
    pages,
    stoppedReason,
    bottomCursor,
  };
};

/**
 * Fetch bookmarks. Always runs a short passive capture first (cheap;
 * one GraphQL response) so we have a fresh request URL + headers, then
 * drives pagination via active replay starting at the cursor that
 * passive last surfaced — so we don't refetch the page we just rendered.
 *
 * If active replay throws (non-429 HTTP error or schema drift), we keep
 * the passive records and surface them as the result; passive is the
 * documented fallback path and discarding its work would be a regression.
 */
export const fetchBookmarks = async (
  session: OpenedSession,
  options: SyncOptions = { source: 'bookmarks' },
): Promise<{ records: BookmarkRecord[]; pages: number; bottomCursor: string | null }> => {
  const maxRecords = options.maxBookmarks ?? PASSIVE_TARGET_BOOKMARKS;
  const passive = await passiveCaptureBookmarks(session, { target: maxRecords });

  const dedupe = (rs: BookmarkRecord[]): BookmarkRecord[] => {
    const seen = new Set<string>();
    const merged: BookmarkRecord[] = [];
    for (const r of rs) {
      if (merged.length >= maxRecords) break;
      if (seen.has(r.entryId)) continue;
      seen.add(r.entryId);
      merged.push(r);
    }
    return merged;
  };

  // If passive already met the target, skip active entirely — no point
  // re-fetching the same page through the GraphQL endpoint.
  if (passive.records.length >= maxRecords) {
    return { records: dedupe(passive.records), pages: 0, bottomCursor: passive.bottomCursor };
  }

  const resumeCursor = options.cursorFrom ?? passive.bottomCursor ?? undefined;
  let activeRecords: BookmarkRecord[] = [];
  let activePages = 0;
  let bottomCursor: string | null = passive.bottomCursor;
  try {
    const active = await replayActiveBookmarks(session.context.request, passive.captured, {
      maxPages: options.maxPages ?? ACTIVE_DEFAULT_MAX_PAGES,
      maxRecords: Math.max(0, maxRecords - passive.records.length),
      cursorFrom: resumeCursor,
    });
    activeRecords = active.records;
    activePages = active.pages;
    if (active.bottomCursor !== null) bottomCursor = active.bottomCursor;
  } catch (err) {
    // Active replay failed — preserve the passive records and surface
    // them. Caller can retry later; we still made forward progress.
    void err;
  }

  return {
    records: dedupe([...passive.records, ...activeRecords]),
    pages: activePages,
    bottomCursor,
  };
};
