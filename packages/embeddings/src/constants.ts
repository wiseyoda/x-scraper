/**
 * Embedding constants. Models, dims, retry/backoff knobs, batch sizes.
 *
 * 1536 dims matches our Neo4j HNSW vector index (packages/graph). Gemini's
 * embedding-2-preview supports Matryoshka truncation to that size; OpenAI's
 * text-embedding-3-large supports `dimensions=1536` natively.
 */

export const TARGET_DIMS = 1536;

export const GEMINI_PRIMARY_MODEL = 'gemini-embedding-2-preview';
export const GEMINI_FALLBACK_MODEL = 'gemini-embedding-001';
export const OPENAI_DEFAULT_MODEL = 'text-embedding-3-large';

export const GEMINI_BATCH_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';

export const DEFAULT_BATCH_SIZE = 100;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_INITIAL_BACKOFF_MS = 500;
export const DEFAULT_BACKOFF_MULTIPLIER = 2;
export const DEFAULT_MAX_BACKOFF_MS = 8_000;

// Indicative token cost. Real cost-per-call is computed from the response
// usage where the API returns token counts; otherwise we conservatively
// estimate from input length.
export const GEMINI_USD_PER_MILLION_INPUT_TOKENS = 0.15;
export const OPENAI_USD_PER_MILLION_INPUT_TOKENS = 0.13;
export const ROUGH_CHARS_PER_TOKEN = 4;
