/**
 * Search constants. Endpoints, defaults, retry budget.
 */

export const EXA_SEARCH_URL = 'https://api.exa.ai/search';
export const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
export const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';

export const DEFAULT_NUM_RESULTS = 8;
export const MAX_NUM_RESULTS = 25;
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

export const SEARCH_PROVIDERS = ['exa', 'tavily', 'brave'] as const;
export type SearchProviderId = (typeof SEARCH_PROVIDERS)[number];

/** Heuristic gate for auto-expand: claims below this confidence are eligible. */
export const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.6;
