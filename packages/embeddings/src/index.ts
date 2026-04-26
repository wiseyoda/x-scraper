export {
  DEFAULT_BATCH_SIZE,
  GEMINI_FALLBACK_MODEL,
  GEMINI_PRIMARY_MODEL,
  OPENAI_DEFAULT_MODEL,
  TARGET_DIMS,
} from './constants.js';
export type { CostAttribution, CostSink } from './cost.js';
export type { GeminiConfig } from './gemini-adapter.js';
export { createGeminiEmbedding } from './gemini-adapter.js';
export type { FetchLike, HttpConfig } from './http.js';
export type { OpenAIConfig } from './openai-adapter.js';
export { createOpenAIEmbedding } from './openai-adapter.js';
export type { EmbeddingErrorCode, EmbeddingProvider, EmbeddingResult } from './types.js';
export { EmbeddingError } from './types.js';
