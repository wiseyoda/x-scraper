import type { CompleteReply, CompleteRequest, LlmProvider } from '@x-scraper/llm';
import { describe, expect, it, vi } from 'vitest';

import { EXTRACTION_PROMPT_VERSION } from '../constants.js';
import { extract, ExtractorError } from '../extractor.js';

const VALID_OUTPUT = JSON.stringify({
  entities: [
    { id: 'claude-code', type: 'Tool', name: 'Claude Code', aliases: [] },
    { id: 'anthropic', type: 'Service', name: 'Anthropic', aliases: [] },
  ],
  claims: [
    {
      id: 'claim_001',
      subject: 'claude-code',
      predicate: 'is_built_by',
      object: 'anthropic',
      text: 'Claude Code is built by Anthropic.',
      confidence: 0.95,
    },
  ],
  relationships: [{ from: 'claude-code', to: 'anthropic', type: 'AUTHORED_BY' }],
});

const fakeReply = (text: string, modelUsed = 'claude-sonnet-4-6'): CompleteReply => ({
  text,
  modelUsed,
  stopReason: 'end_turn',
  usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreateTokens: 0 },
  costUsd: 0.001,
});

const stub = (impl: (req: CompleteRequest) => Promise<CompleteReply>): LlmProvider => ({
  provider: 'anthropic',
  complete: vi.fn(impl),
});

describe('extract', () => {
  it('returns validated extraction on first try', async () => {
    const llm = stub(() => Promise.resolve(fakeReply(VALID_OUTPUT)));
    const result = await extract(llm, { body: 'Claude Code is built by Anthropic.' });
    expect(result.data.entities).toHaveLength(2);
    expect(result.data.claims[0]?.predicate).toBe('is_built_by');
    expect(result.meta.attempts).toBe(1);
    expect(result.meta.promptVersion).toBe(EXTRACTION_PROMPT_VERSION);
  });

  it('strips ```json fences before parsing', async () => {
    const fenced = '```json\n' + VALID_OUTPUT + '\n```';
    const llm = stub(() => Promise.resolve(fakeReply(fenced)));
    const result = await extract(llm, { body: 'x' });
    expect(result.data.entities).toHaveLength(2);
  });

  it('repairs once when first reply is malformed JSON', async () => {
    let calls = 0;
    const llm = stub(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve(fakeReply('this is not json'));
      return Promise.resolve(fakeReply(VALID_OUTPUT));
    });
    const result = await extract(llm, { body: 'x' });
    expect(result.meta.attempts).toBe(2);
  });

  it('throws ExtractorError after the repair budget is exhausted', async () => {
    const llm = stub(() => Promise.resolve(fakeReply('still not json')));
    await expect(extract(llm, { body: 'x', maxRepairAttempts: 1 })).rejects.toBeInstanceOf(
      ExtractorError,
    );
  });

  it('rejects extractions whose predicates violate snake_case', async () => {
    const bad = JSON.stringify({
      entities: [{ id: 'a', type: 'Tool', name: 'A', aliases: [] }],
      claims: [
        {
          id: 'claim_1',
          subject: 'a',
          predicate: 'IsBuiltBy',
          object: 'b',
          text: 'x',
          confidence: 0.5,
        },
      ],
      relationships: [],
    });
    const llm = stub(() => Promise.resolve(fakeReply(bad)));
    await expect(extract(llm, { body: 'x', maxRepairAttempts: 0 })).rejects.toBeInstanceOf(
      ExtractorError,
    );
  });

  it('aggregates cost across multiple attempts', async () => {
    let calls = 0;
    const llm = stub(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve(fakeReply('not json'));
      return Promise.resolve(fakeReply(VALID_OUTPUT));
    });
    const result = await extract(llm, { body: 'x' });
    // Two completions × 0.001 USD each.
    expect(result.meta.costUsd).toBeCloseTo(0.002, 3);
  });

  it('passes user-supplied cost attribution through to llm.complete', async () => {
    const seen: CompleteRequest[] = [];
    const llm = stub((req) => {
      seen.push(req);
      return Promise.resolve(fakeReply(VALID_OUTPUT));
    });
    await extract(llm, {
      body: 'x',
      cost: { runId: 'run_x', stage: 'extract_facts' },
    });
    expect(seen[0]?.cost?.runId).toBe('run_x');
    expect(seen[0]?.cost?.stage).toBe('extract_facts');
  });
});
