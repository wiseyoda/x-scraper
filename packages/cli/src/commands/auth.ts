/**
 * `xs auth login` — open an authenticated X.com session via Patchright.
 *
 * Wraps openAuthenticatedSession with a sensible default profile dir and
 * a terse summary printable line. Headless first; falls back to a headed
 * Chrome window when the persistent profile has no live cookies.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { AuthOptions } from '@x-scraper/scraper';
import { closeSession, openAuthenticatedSession, ScraperError } from '@x-scraper/scraper';

export const DEFAULT_PROFILE_DIR = path.join(
  os.homedir(),
  '.config',
  'x-scraper',
  'browser-profile',
);

export interface AuthLoginResult {
  screenName: string;
  userId: string;
  pathTaken: 'headless' | 'headed-login';
  profileDir: string;
}

export const runAuthLogin = async (
  options: { profileDir?: string; headless?: boolean } = {},
): Promise<AuthLoginResult> => {
  const profileDir = options.profileDir ?? DEFAULT_PROFILE_DIR;
  await fs.mkdir(profileDir, { recursive: true });
  const session = await openAuthenticatedSession({
    profileDir,
    ...(options.headless === undefined ? {} : { headless: options.headless }),
  } satisfies AuthOptions);
  try {
    return {
      screenName: session.info.screenName,
      userId: session.info.userId,
      pathTaken: session.pathTaken,
      profileDir,
    };
  } finally {
    await closeSession(session);
  }
};

export { ScraperError };
