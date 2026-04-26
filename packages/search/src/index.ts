export type { AutoExpandOptions, AutoExpandResult, ClaimContext } from './auto-expand.js';
export { autoExpandClaim, buildExpandQuery } from './auto-expand.js';
export type { BraveConfig } from './brave.js';
export { createBraveSearch } from './brave.js';
export type { SearchProviderId } from './constants.js';
export {
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  DEFAULT_NUM_RESULTS,
  MAX_NUM_RESULTS,
  SEARCH_PROVIDERS,
} from './constants.js';
export type { ExaConfig } from './exa.js';
export { createExaSearch } from './exa.js';
export type { FetchLike, HttpConfig } from './http.js';
export type { TavilyConfig } from './tavily.js';
export { createTavilySearch } from './tavily.js';
export type {
  SearchErrorCode,
  SearchHit,
  SearchOptions,
  SearchProvider,
  SearchResult,
} from './types.js';
export { SearchError } from './types.js';
