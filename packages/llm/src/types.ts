/**
 * LlmProvider port + shared LLM types/errors.
 *
 * The port wraps Anthropic's messages.create with our defaults and a
 * uniform reply shape. Tests stub the SDK client; production wires
 * `@anthropic-ai/sdk`.
 */

import type { Stage } from '@x-scraper/queue';

export interface CachedSystemBlock {
  /** Plain text of the cached portion (e.g. schema/system prompt). */
  text: string;
  /** Whether to send `cache_control: { type: 'ephemeral' }`. Default true. */
  cache?: boolean;
}

export interface MessageInput {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompleteRequest {
  /** Model id to call (Sonnet/Haiku). Provider-supplied default if absent. */
  model?: string;
  /** Max output tokens. Use 16k–32k for extraction; never below 4k. */
  maxTokens?: number;
  /** System blocks; the first block is normally cached schema/system text. */
  system?: CachedSystemBlock[];
  /** Conversation. */
  messages: MessageInput[];
  /** Optional run/job/entry/stage attribution for the cost ledger. */
  cost?: {
    runId?: string;
    jobId?: string;
    entryId?: string;
    stage?: Stage;
  };
}

export interface CompleteUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

export interface CompleteReply {
  text: string;
  modelUsed: string;
  stopReason: string | null;
  usage: CompleteUsage;
  costUsd: number;
}

export interface LlmProvider {
  readonly provider: string;
  complete: (req: CompleteRequest) => Promise<CompleteReply>;
}

export type LlmErrorCode =
  | 'CONFIG'
  | 'TRUNCATED'
  | 'PROVIDER'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'UNKNOWN';

export class LlmError extends Error {
  public readonly code: LlmErrorCode;
  public override readonly cause: unknown;
  public readonly stopReason: string | null;

  constructor(
    message: string,
    code: LlmErrorCode,
    options: { cause?: unknown; stopReason?: string | null } = {},
  ) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.cause = options.cause;
    this.stopReason = options.stopReason ?? null;
  }
}
