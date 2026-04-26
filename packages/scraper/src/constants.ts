/**
 * Tunable knobs for the scraper. Centralised so eslint's no-magic-numbers
 * rule passes and so production callers can override via the public
 * options API rather than monkey-patching.
 */

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;

export const NAV_TIMEOUT_MS = 30 * SECOND_MS;
export const NETWORK_IDLE_TIMEOUT_MS = 30 * SECOND_MS;
export const LOGIN_WAIT_MS = 5 * MINUTE_MS;
export const LOGIN_POLL_INTERVAL_MS = 500;
export const MOUSE_WHEEL_NUDGE_PX = 2_000;

export const SCROLL_PAUSE_MS = 2_500;
export const SCROLL_TIMES = 20;
export const PASSIVE_TARGET_BOOKMARKS = 50;
export const MAX_BOOKMARKS_PER_SESSION = 200;

export const ACTIVE_INTER_PAGE_DELAY_MS = 2_500;
export const ACTIVE_DEFAULT_MAX_PAGES = 10;
export const RATE_LIMIT_INITIAL_BACKOFF_MS = 30 * SECOND_MS;
export const RATE_LIMIT_MAX_BACKOFF_MS = 5 * MINUTE_MS;
export const RATE_LIMIT_BACKOFF_MULTIPLIER = 2;

export const X_HOME_URL = 'https://x.com/home';
export const X_BOOKMARKS_URL = 'https://x.com/i/bookmarks';
export const X_LOGIN_URL = 'https://x.com/i/flow/login';
export const X_LIKES_URL_TEMPLATE = (screenName: string): string =>
  `https://x.com/${encodeURIComponent(screenName)}/likes`;
export const X_POSTS_URL_TEMPLATE = (screenName: string): string =>
  `https://x.com/${encodeURIComponent(screenName)}`;
export const BOOKMARKS_GRAPHQL_MARKER = '/Bookmarks';
export const LIKES_GRAPHQL_MARKER = '/Likes';
export const POSTS_GRAPHQL_MARKER = '/UserTweets';

export const REQUIRED_AUTH_COOKIES = ['auth_token', 'ct0', 'twid'] as const;

export const SCRAPER_USER_AGENT_VIEWPORT = { width: 1280, height: 800 } as const;
