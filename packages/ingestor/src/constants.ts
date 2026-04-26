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
export const INGESTOR_KINDS = ['article', 'repo', 'youtube', 'pdf'] as const;
export type IngestorKind = (typeof INGESTOR_KINDS)[number];
