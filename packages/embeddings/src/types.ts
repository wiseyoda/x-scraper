/**
 * EmbeddingProvider port + shared types/errors.
 *
 * Adapters (Gemini, OpenAI) implement `EmbeddingProvider`. Higher-level
 * code only ever touches the port.
 */

export interface EmbeddingResult {
  /** One vector per input, in input order. */
  vectors: number[][];
  /** Model that actually produced the vectors (after fallback, if any). */
  modelUsed: string;
  /** Estimated cost in USD for this call (input-token-based). */
  costUsd: number;
  /** Server-reported input token count when available; else estimated. */
  inputTokens: number;
}

export interface EmbeddingProvider {
  /** Provider id, e.g. 'gemini' or 'openai'. */
  readonly provider: string;
  /** Output vector size for this provider/config. */
  readonly dims: number;
  /** Embed a batch of texts; respects batch-size + retry config internally. */
  embed: (texts: string[]) => Promise<EmbeddingResult>;
}

export type EmbeddingErrorCode =
  | 'CONFIG'
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'PROVIDER'
  | 'INVALID_RESPONSE'
  | 'DIMS_MISMATCH'
  | 'UNKNOWN';

export class EmbeddingError extends Error {
  public readonly code: EmbeddingErrorCode;
  public override readonly cause: unknown;
  public readonly httpStatus: number | null;

  constructor(
    message: string,
    code: EmbeddingErrorCode,
    options: { cause?: unknown; httpStatus?: number | null } = {},
  ) {
    super(message);
    this.name = 'EmbeddingError';
    this.code = code;
    this.cause = options.cause;
    this.httpStatus = options.httpStatus ?? null;
  }
}
