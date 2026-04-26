/**
 * X.com authentication via Patchright with a persistent profile.
 *
 * Pattern proven in spike 1: try headless first (reuses cookies from a
 * prior login), fall back to headed if x.com redirects to /login. After
 * a successful headed login, the persistent profile is reusable
 * headlessly on subsequent runs.
 */

import * as fs from 'node:fs';

import type { BrowserContext, Page } from 'patchright';
import { chromium } from 'patchright';

import {
  LOGIN_POLL_INTERVAL_MS,
  LOGIN_WAIT_MS,
  NAV_TIMEOUT_MS,
  NETWORK_IDLE_TIMEOUT_MS,
  REQUIRED_AUTH_COOKIES,
  SCRAPER_USER_AGENT_VIEWPORT,
  X_BOOKMARKS_URL,
  X_HOME_URL,
  X_LOGIN_URL,
} from './constants.js';
import type { AuthOptions, SessionInfo } from './types.js';
import { ScraperError } from './types.js';

export interface OpenedSession {
  context: BrowserContext;
  page: Page;
  info: SessionInfo;
  pathTaken: 'headless' | 'headed-login';
}

const ensureProfileDir = (dir: string): void => {
  fs.mkdirSync(dir, { recursive: true });
};

const isLoggedInUrl = (currentUrl: string): boolean => {
  const lower = currentUrl.toLowerCase();
  return !lower.includes('/login') && !lower.includes('/i/flow') && !lower.includes('/?lang=');
};

const userIdFromTwid = (twid: string | undefined): string | null => {
  if (!twid) return null;
  const decoded = decodeURIComponent(twid);
  return /u=(\d+)/.exec(decoded)?.[1] ?? null;
};

const readScreenName = async (page: Page): Promise<string | null> => {
  return await page.evaluate(() => {
    const doc = (globalThis as unknown as { document?: Document }).document;
    const profileLink = doc?.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    const href = profileLink?.getAttribute('href') ?? null;
    if (href === null) return null;
    const stripped = href.replace(/^\//, '');
    return stripped.length > 0 ? stripped : null;
  });
};

const collectSessionInfo = async (
  context: BrowserContext,
  page: Page,
): Promise<SessionInfo | null> => {
  const screenName = await readScreenName(page);
  const cookies = await context.cookies();
  const twid = cookies.find((c) => c.name === 'twid')?.value;
  const userId = userIdFromTwid(twid);
  const haveAllRequired = REQUIRED_AUTH_COOKIES.every((name) =>
    cookies.some((c) => c.name === name),
  );
  if (!haveAllRequired || screenName === null || userId === null) return null;
  return { screenName, userId };
};

const launchContext = async (options: AuthOptions, headless: boolean): Promise<BrowserContext> => {
  const channel = options.channel ?? 'chrome';
  return await chromium.launchPersistentContext(options.profileDir, {
    channel,
    headless,
    viewport: { ...SCRAPER_USER_AGENT_VIEWPORT },
  });
};

/**
 * Open an authenticated x.com browser context. Headless if the profile
 * already has live cookies; otherwise launches a headed Chrome window so
 * the user can log in interactively (handles 2FA themselves).
 *
 * Caller MUST `await session.context.close()` when done.
 */
export const openAuthenticatedSession = async (options: AuthOptions): Promise<OpenedSession> => {
  ensureProfileDir(options.profileDir);

  const tryHeadless = options.headless ?? true;
  if (tryHeadless) {
    const context = await launchContext(options, true);
    const page = await context.newPage();
    await page.goto(X_BOOKMARKS_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page
      .waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS })
      .catch(() => undefined);
    if (isLoggedInUrl(page.url())) {
      const info = await collectSessionInfo(context, page);
      if (info !== null) return { context, page, info, pathTaken: 'headless' };
    }
    await context.close();
  }

  const context = await launchContext(options, false);
  const page = await context.newPage();
  await page.goto(X_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

  const start = Date.now();
  while (Date.now() - start < LOGIN_WAIT_MS) {
    if (isLoggedInUrl(page.url())) break;
    await page.waitForTimeout(LOGIN_POLL_INTERVAL_MS);
  }
  if (!isLoggedInUrl(page.url())) {
    await context.close();
    throw new ScraperError(
      `login not completed within ${String(LOGIN_WAIT_MS / 1000)}s`,
      'AUTH_FAILED',
    );
  }

  await page.goto(X_HOME_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  const info = await collectSessionInfo(context, page);
  if (info === null) {
    await context.close();
    throw new ScraperError('logged in but auth cookies are missing', 'AUTH_FAILED');
  }
  return { context, page, info, pathTaken: 'headed-login' };
};

export const closeSession = async (session: OpenedSession): Promise<void> => {
  await session.context.close();
};
