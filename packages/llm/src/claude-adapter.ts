/**
 * Anthropic Claude adapter.
 *
 * Uses the official @anthropic-ai/sdk. The actual SDK client is injected
 * (`messagesCreate`) so tests can stub it deterministically.
 *
 * Defaults follow CODING_STANDARDS.md:
 *   - max_tokens 16k for extraction (callers can bump up to 32k)
 *   - prompt caching on the first system block via cache_control: ephemeral
 *   - always inspect stop_reason and throw TRUNCATED on max_tokens
 */

import {
  DEFAULT_MAX_TOKENS_EXTRACTION,
  HARD_CEILING_MAX_TOKENS,
  SONNET_MODEL,
} from './constants.js';
import { computeCostUsd, type LlmCostSink } from './cost.js';
import {
  type CompleteReply,
  type CompleteRequest,
  type CompleteUsage,
  LlmError,
  type LlmProvider,
} from './types.js';

/**
 * Subset of @anthropic-ai/sdk's Messages API we depend on. Defined as
 * structural types so a bound `new Anthropic({apiKey}).messages.create`
 * can be passed directly without casts: the SDK's content blocks are a
 * superset (text + tool_use + thinking + ...), and we only read `text`.
 */
export interface AnthropicTextBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

/** A content block in the response. We only consume `type === 'text'`. */
export interface AnthropicMessageContentBlock {
  type: string;
  text?: string;
}

export interface AnthropicMessageReply {
  content: AnthropicMessageContentBlock[];
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
  model?: string;
}

export interface AnthropicCreateInput {
  model: string;
  max_tokens: number;
  system?: AnthropicTextBlock[];
  messages: { role: 'user' | 'assistant'; content: string }[];
}

export type MessagesCreateFn = (input: AnthropicCreateInput) => Promise<AnthropicMessageReply>;

export interface ClaudeConfig {
  /** Bound `messages.create` from new Anthropic({apiKey}).messages */
  messagesCreate: MessagesCreateFn;
  defaultModel?: string;
  defaultMaxTokens?: number;
  cost?: LlmCostSink;
}

const toUsage = (reply: AnthropicMessageReply): CompleteUsage => ({
  inputTokens: reply.usage.input_tokens,
  outputTokens: reply.usage.output_tokens,
  cacheReadTokens: reply.usage.cache_read_input_tokens ?? 0,
  cacheCreateTokens: reply.usage.cache_creation_input_tokens ?? 0,
});

const collectText = (reply: AnthropicMessageReply): string =>
  reply.content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text ?? '')
    .join('');

export const createClaudeProvider = (config: ClaudeConfig): LlmProvider => {
  const defaultModel = config.defaultModel ?? SONNET_MODEL;
  const defaultMaxTokens = config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS_EXTRACTION;

  const complete = async (req: CompleteRequest): Promise<CompleteReply> => {
    const model = req.model ?? defaultModel;
    const maxTokens = req.maxTokens ?? defaultMaxTokens;
    if (maxTokens > HARD_CEILING_MAX_TOKENS) {
      throw new LlmError(
        `max_tokens ${String(maxTokens)} exceeds hard ceiling ${String(HARD_CEILING_MAX_TOKENS)}`,
        'CONFIG',
      );
    }

    const system = req.system?.map<AnthropicTextBlock>((block) => {
      const cache = block.cache !== false;
      return cache
        ? { type: 'text', text: block.text, cache_control: { type: 'ephemeral' } }
        : { type: 'text', text: block.text };
    });

    const input: AnthropicCreateInput = {
      model,
      max_tokens: maxTokens,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(system === undefined ? {} : { system }),
    };

    let reply: AnthropicMessageReply;
    try {
      reply = await config.messagesCreate(input);
    } catch (err) {
      if (err instanceof LlmError) throw err;
      throw new LlmError('claude messages.create failed', 'PROVIDER', { cause: err });
    }

    // Record cost FIRST. Anthropic bills for truncated and empty replies
    // alike — we must reflect that in the ledger before any throw path.
    const usage = toUsage(reply);
    const modelUsed = reply.model ?? model;
    const costUsd = computeCostUsd(modelUsed, usage);

    if (config.cost !== undefined) {
      config.cost.recordCost({
        ...(req.cost?.runId === undefined ? {} : { runId: req.cost.runId }),
        ...(req.cost?.jobId === undefined ? {} : { jobId: req.cost.jobId }),
        ...(req.cost?.entryId === undefined ? {} : { entryId: req.cost.entryId }),
        ...(req.cost?.stage === undefined ? {} : { stage: req.cost.stage }),
        provider: 'anthropic',
        model: modelUsed,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreateTokens: usage.cacheCreateTokens,
        costUsd,
      });
    }

    if (reply.stop_reason === 'max_tokens') {
      throw new LlmError(
        `claude truncated at max_tokens=${String(maxTokens)} — bump max_tokens and retry`,
        'TRUNCATED',
        { stopReason: reply.stop_reason },
      );
    }

    const text = collectText(reply);
    if (text.length === 0) {
      throw new LlmError('claude returned no text blocks', 'INVALID_RESPONSE', {
        stopReason: reply.stop_reason,
      });
    }

    return {
      text,
      modelUsed,
      stopReason: reply.stop_reason,
      usage,
      costUsd,
    };
  };

  return {
    provider: 'anthropic',
    complete,
  };
};
