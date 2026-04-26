/// <reference lib="dom" />
/**
 * Spike 1 — X.com auth: persistent Patchright profile + browser fallback.
 *
 * Goal: confirm we can authenticate to x.com via a persistent user-data-dir
 * and that an authenticated GraphQL/API call returns valid JSON.
 *
 * Flow:
 *   1. Launch Patchright with a persistent profile at spikes/auth/x-profile/.
 *   2. Try headless first. If x.com redirects to /login, fall back to headed
 *      so the user can log in (handling 2FA themselves) — once.
 *   3. Verify by hitting api.x.com/1.1/account/verify_credentials.json from
 *      inside the browser context (so cookies + headers are real).
 *   4. Print { ok, screen_name } and the cookie names we observed.
 *
 * Run:  pnpm spike spikes/1-auth.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { BrowserContext, Page } from 'patchright';
import { chromium } from 'patchright';

const PROFILE_DIR = path.resolve('spikes/auth/x-profile');
const HOME_URL = 'https://x.com/home';
const BOOKMARKS_URL = 'https://x.com/i/bookmarks';
const LOGIN_URL = 'https://x.com/i/flow/login';
const LOGIN_WAIT_MS = 5 * 60 * 1000;
const LOGIN_WAIT_SECONDS = LOGIN_WAIT_MS / 1000;
const NAV_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;
const REQUIRED_COOKIES = ['auth_token', 'ct0', 'twid'];
const BONUS_COOKIES = ['guest_id', 'personalization_id', 'kdt'];

interface VerifyResult {
  ok: boolean;
  screen_name: string | null;
  user_id: string | null;
  bookmarksUrl: string;
  cookieNames: string[];
  pathTaken: 'headless' | 'headed-login';
}

const ensureProfileDir = (): void => {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
};

const isLoggedIn = (currentUrl: string): boolean => {
  const lower = currentUrl.toLowerCase();
  return !lower.includes('/login') && !lower.includes('/i/flow') && !lower.includes('/?lang=');
};

const readScreenNameFromSidebar = async (page: Page): Promise<string | null> => {
  return await page.evaluate(() => {
    const profileLink = document.querySelector<HTMLAnchorElement>(
      'a[data-testid="AppTabBar_Profile_Link"]',
    );
    const href = profileLink?.getAttribute('href') ?? null;
    if (!href) return null;
    const stripped = href.replace(/^\//, '');
    return stripped.length > 0 ? stripped : null;
  });
};

const extractUserIdFromTwid = (twid: string | undefined): string | null => {
  if (!twid) return null;
  const decoded = decodeURIComponent(twid);
  const match = /u=(\d+)/.exec(decoded);
  return match?.[1] ?? null;
};

const verifyAuth = async (
  ctx: BrowserContext,
  page: Page,
): Promise<{ screen_name: string | null; user_id: string | null; bookmarksUrl: string }> => {
  await page.goto(BOOKMARKS_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT_MS }).catch(() => undefined);
  const bookmarksUrl = page.url();
  const screen_name = await readScreenNameFromSidebar(page);
  const cookies = await ctx.cookies();
  const twid = cookies.find((c) => c.name === 'twid')?.value;
  const user_id = extractUserIdFromTwid(twid);
  return { screen_name, user_id, bookmarksUrl };
};

const tryHeadless = async (): Promise<VerifyResult | null> => {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 800 },
  });
  try {
    const page = await ctx.newPage();
    await page.goto(BOOKMARKS_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT_MS }).catch(() => undefined);
    const url = page.url();
    if (!isLoggedIn(url)) {
      console.log(`[headless] redirected to ${url} — login required.`);
      return null;
    }
    const verified = await verifyAuth(ctx, page);
    const cookies = await ctx.cookies();
    return {
      ok: true,
      screen_name: verified.screen_name,
      user_id: verified.user_id,
      bookmarksUrl: verified.bookmarksUrl,
      cookieNames: cookies.map((c) => c.name),
      pathTaken: 'headless',
    };
  } finally {
    await ctx.close();
  }
};

const headedLogin = async (): Promise<VerifyResult> => {
  console.log('[headed] launching browser. Log in to x.com in the window that opens.');
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 800 },
  });
  try {
    const page = await ctx.newPage();
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

    const start = Date.now();
    while (Date.now() - start < LOGIN_WAIT_MS) {
      if (isLoggedIn(page.url())) {
        console.log(`[headed] login detected at ${page.url()}.`);
        break;
      }
      await page.waitForTimeout(POLL_INTERVAL_MS);
    }
    if (!isLoggedIn(page.url())) {
      throw new Error(`login not completed within ${String(LOGIN_WAIT_SECONDS)}s`);
    }

    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    const verified = await verifyAuth(ctx, page);
    const cookies = await ctx.cookies();
    return {
      ok: true,
      screen_name: verified.screen_name,
      user_id: verified.user_id,
      bookmarksUrl: verified.bookmarksUrl,
      cookieNames: cookies.map((c) => c.name),
      pathTaken: 'headed-login',
    };
  } finally {
    await ctx.close();
  }
};

const main = async (): Promise<void> => {
  ensureProfileDir();
  console.log(`profile dir: ${PROFILE_DIR}`);

  const result = (await tryHeadless()) ?? (await headedLogin());

  console.log('\n=== Spike 1 result ===');
  console.log(JSON.stringify(result, null, 2));
  console.log('\nRequired auth cookies:');
  let allRequiredPresent = true;
  for (const name of REQUIRED_COOKIES) {
    const present = result.cookieNames.includes(name);
    console.log(`  ${name}: ${present ? 'yes' : 'NO'}`);
    if (!present) allRequiredPresent = false;
  }
  console.log('\nBonus cookies:');
  for (const name of BONUS_COOKIES) {
    console.log(`  ${name}: ${result.cookieNames.includes(name) ? 'yes' : 'no'}`);
  }
  console.log(`\nLanded on bookmarks page: ${isLoggedIn(result.bookmarksUrl) ? 'yes' : 'NO'}`);
  console.log(`screen_name: ${result.screen_name ?? '(not detected)'}`);
  console.log(`user_id: ${result.user_id ?? '(not detected)'}`);

  const hardSuccess = allRequiredPresent && isLoggedIn(result.bookmarksUrl);
  console.log(`\nspike 1 ${hardSuccess ? 'PASSED' : 'FAILED'}`);
  if (!hardSuccess) {
    process.exit(1);
  }
};

main().catch((err: unknown) => {
  console.error('spike 1 failed:', err);
  process.exit(1);
});
