import { describe, expect, it, vi } from 'vitest';

import {
  type AnthropicCreateInput,
  type AnthropicMessageReply,
  createClaudeProvider,
  type MessagesCreateFn,
} from '../claude-adapter.js';
import { HARD_CEILING_MAX_TOKENS, SONNET_MODEL } from '../constants.js';
import { LlmError } from '../types.js';

const makeReply = (overrides: Partial<AnthropicMessageReply> = {}): AnthropicMessageReply => ({
  content: [{ type: 'text', text: '{"ok":true}' }],
  stop_reason: 'end_turn',
  usage: {
    input_tokens: 100,
    output_tokens: 200,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  },
  ...overrides,
});

describe('createClaudeProvider', () => {
  it('forwards model + max_tokens + cached system block to messages.create', async () => {
    const captured: { value: AnthropicCreateInput | null } = { value: null };
    const messagesCreate: MessagesCreateFn = vi.fn((input: AnthropicCreateInput) => {
      captured.value = input;
      return Promise.resolve(makeReply());
    });
    const provider = createClaudeProvider({ messagesCreate });
    await provider.complete({
      maxTokens: 4_000,
      system: [{ text: 'schema doc' }],
      messages: [{ role: 'user', content: 'extract' }],
    });
    expect(captured.value?.model).toBe(SONNET_MODEL);
    expect(captured.value?.max_tokens).toBe(4_000);
    expect(captured.value?.system?.[0]).toMatchObject({
      type: 'text',
      text: 'schema doc',
      cache_control: { type: 'ephemeral' },
    });
  });

  it('omits cache_control when system block has cache:false', async () => {
    const captured: { value: AnthropicCreateInput | null } = { value: null };
    const messagesCreate: MessagesCreateFn = vi.fn((input: AnthropicCreateInput) => {
      captured.value = input;
      return Promise.resolve(makeReply());
    });
    const provider = createClaudeProvider({ messagesCreate });
    await provider.complete({
      system: [{ text: 'no-cache', cache: false }],
      messages: [{ role: 'user', content: 'x' }],
    });
    const block = captured.value?.system?.[0];
    expect(block).toBeDefined();
    expect(block && 'cache_control' in block).toBe(false);
  });

  it('throws TRUNCATED when stop_reason is max_tokens', async () => {
    const messagesCreate: MessagesCreateFn = vi.fn(() =>
      Promise.resolve(makeReply({ stop_reason: 'max_tokens' })),
    );
    const provider = createClaudeProvider({ messagesCreate });
    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ name: 'LlmError', code: 'TRUNCATED' });
  });

  it('records the truncated reply in the cost ledger before throwing', async () => {
    const messagesCreate: MessagesCreateFn = vi.fn(() =>
      Promise.resolve(makeReply({ stop_reason: 'max_tokens' })),
    );
    const recorded: Record<string, unknown>[] = [];
    const provider = createClaudeProvider({
      messagesCreate,
      cost: {
        recordCost: (input) => {
          recorded.push(input);
          return 'cost_id';
        },
      },
    });
    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ code: 'TRUNCATED' });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.outputTokens).toBe(200);
  });

  it('throws CONFIG when max_tokens exceeds the hard ceiling', async () => {
    const messagesCreate: MessagesCreateFn = vi.fn(() => Promise.resolve(makeReply()));
    const provider = createClaudeProvider({ messagesCreate });
    await expect(
      provider.complete({
        maxTokens: HARD_CEILING_MAX_TOKENS + 1,
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toMatchObject({ name: 'LlmError', code: 'CONFIG' });
  });

  it('records usage and cost into the supplied sink', async () => {
    const messagesCreate: MessagesCreateFn = vi.fn(() =>
      Promise.resolve(
        makeReply({
          usage: {
            input_tokens: 1_000,
            output_tokens: 500,
            cache_read_input_tokens: 200,
            cache_creation_input_tokens: 0,
          },
        }),
      ),
    );
    const recorded: Record<string, unknown>[] = [];
    const provider = createClaudeProvider({
      messagesCreate,
      cost: {
        recordCost: (input) => {
          recorded.push(input);
          return 'cost_id';
        },
      },
    });
    const reply = await provider.complete({
      messages: [{ role: 'user', content: 'x' }],
      cost: { runId: 'run_x', jobId: 'job_y', stage: 'extract_facts' },
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.runId).toBe('run_x');
    expect(recorded[0]?.stage).toBe('extract_facts');
    expect(recorded[0]?.cacheReadTokens).toBe(200);
    expect(reply.usage.cacheReadTokens).toBe(200);
    expect(reply.costUsd).toBeGreaterThan(0);
  });

  it('throws INVALID_RESPONSE when there are no text blocks', async () => {
    const messagesCreate: MessagesCreateFn = vi.fn(() =>
      Promise.resolve(makeReply({ content: [] })),
    );
    const provider = createClaudeProvider({ messagesCreate });
    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ name: 'LlmError', code: 'INVALID_RESPONSE' });
  });

  it('joins multiple text blocks into a single string', async () => {
    const messagesCreate: MessagesCreateFn = vi.fn(() =>
      Promise.resolve(
        makeReply({
          content: [
            { type: 'text', text: 'part-1\n' },
            { type: 'text', text: 'part-2' },
          ],
        }),
      ),
    );
    const provider = createClaudeProvider({ messagesCreate });
    const reply = await provider.complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(reply.text).toBe('part-1\npart-2');
  });

  it('wraps SDK errors in LlmError with code PROVIDER', async () => {
    const messagesCreate: MessagesCreateFn = vi.fn(() => Promise.reject(new Error('rate limit')));
    const provider = createClaudeProvider({ messagesCreate });
    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBeInstanceOf(LlmError);
  });
});
