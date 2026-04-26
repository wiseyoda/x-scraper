/**
 * LLM constants. Models, max-token defaults, retry/backoff knobs, pricing.
 *
 * `max_tokens` defaults are GENEROUS — codified in CODING_STANDARDS.md.
 * Truncation in extraction silently drops claims and corrupts the graph.
 * 16k–32k for extraction. Always check `stop_reason === 'max_tokens'`.
 */

export const SONNET_MODEL = 'claude-sonnet-4-6';
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

export const DEFAULT_MAX_TOKENS_EXTRACTION = 16_000;
export const DEFAULT_MAX_TOKENS_RECONCILIATION = 8_000;
export const HARD_CEILING_MAX_TOKENS = 32_000;

export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_INITIAL_BACKOFF_MS = 1_000;
export const DEFAULT_BACKOFF_MULTIPLIER = 2;
export const DEFAULT_MAX_BACKOFF_MS = 30_000;

// Sonnet 4.6 list pricing (USD per million tokens). Update when Anthropic
// changes their published rates. Cache reads are 10% of base; cache writes
// are 25% surcharge.
export const SONNET_USD_PER_MILLION_INPUT = 3.0;
export const SONNET_USD_PER_MILLION_OUTPUT = 15.0;
export const SONNET_CACHE_READ_FACTOR = 0.1;
export const SONNET_CACHE_WRITE_SURCHARGE = 1.25;

export const HAIKU_USD_PER_MILLION_INPUT = 1.0;
export const HAIKU_USD_PER_MILLION_OUTPUT = 5.0;
export const HAIKU_CACHE_READ_FACTOR = 0.1;
export const HAIKU_CACHE_WRITE_SURCHARGE = 1.25;
