/**
 * Ingestor constants. User-Agent strings, timeouts, body-size minimums.
 */

export const DEFAULT_FETCH_TIMEOUT_MS = 20_000;
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Minimum extracted body length before we consider the article ingest a success. */
export const MIN_BODY_CHARS = 300;

/** Maximum captured body length (clamps pathological pages). */
export const MAX_BODY_CHARS = 250_000;

/** GitHub repo extractor. */
export const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_API_ACCEPT = 'application/vnd.github+json';
export const GITHUB_API_VERSION = '2022-11-28';

/** YouTube. */
export const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'];

/** Source kinds we ingest. Mirrors `EntityType` for the relevant subset. */
export const INGESTOR_KINDS = ['article', 'x-article', 'repo', 'youtube', 'pdf'] as const;
export type IngestorKind = (typeof INGESTOR_KINDS)[number];

/** X Article ingestor (T14 follow-on). Patchright-rendered SPA scrape. */
export const X_ARTICLE_NAV_TIMEOUT_MS = 30_000;
export const X_ARTICLE_RENDER_WAIT_MS = 3_000;
export const X_ARTICLE_BODY_SELECTOR = '[data-testid="twitterArticleReadView"]';
export const X_ARTICLE_TITLE_SELECTOR = '[data-testid="twitter-article-title"]';
export const X_ARTICLE_CONTENT_SELECTOR = '[data-testid="twitterArticleRichTextView"]';
export const X_ARTICLE_USERCELL_SELECTOR = '[data-testid="UserCell"]';
/** Matches both /<user>/article/<id> and /i/article/<id> on either x.com or twitter.com. */
export const X_ARTICLE_URL_RE =
  /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:i\/)?[^/]+\/article\/\d+/i;
/** Tweet permalink — we deliberately don't ingest these as articles. */
export const X_TWEET_URL_RE =
  /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[^/]+\/status\/\d+/i;
