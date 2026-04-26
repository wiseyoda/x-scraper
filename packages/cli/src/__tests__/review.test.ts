import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runReview } from '../commands/review.js';

const FIXED_NOW = '2026-04-26T00:00:00.000Z';
const PROMPT_VERSION = { extraction: 1, reconciliation: 1, embedding: 1 };

const stubVault = (
  records: { id: string; type: 'Person' | 'Tool' | 'Concept' | 'Repo'; name: string }[],
): Parameters<typeof runReview>[0] => ({
  root: '/tmp/fake',
  init: () => Promise.resolve(),
  write: () => Promise.resolve('x'),
  read: (id, type) => {
    const found = records.find((r) => r.id === id && r.type === type);
    if (found === undefined) return Promise.reject(new Error('not found'));
    return Promise.resolve({
      frontmatter: {
        id: found.id,
        type: found.type,
        name: found.name,
        created_at: FIXED_NOW,
        updated_at: FIXED_NOW,
        prompt_version: PROMPT_VERSION,
        sources: [],
        aliases: [],
        tags: [],
        topics: [],
      },
      body: '',
    });
  },
  list: (type) =>
    Promise.resolve(
      records
        .filter((r) => type === undefined || r.type === type)
        .map((r) => ({
          id: r.id,
          type: r.type,
          relativePath: `${r.type}/${r.id}.md`,
          mtime: new Date(),
        })),
    ),
  commit: () => Promise.resolve(null),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runReview', () => {
  it('returns no candidates when every name is unique', async () => {
    const vault = stubVault([
      { id: 'p_1', type: 'Person', name: 'Alice' },
      { id: 'p_2', type: 'Person', name: 'Bob' },
    ]);
    const result = await runReview(vault);
    expect(result.scanned).toBe(2);
    expect(result.candidates).toHaveLength(0);
  });

  it('flags duplicate-name entities as review candidates (case-insensitive)', async () => {
    const vault = stubVault([
      { id: 'tool_a', type: 'Tool', name: 'Kuzu' },
      { id: 'tool_b', type: 'Tool', name: 'kuzu' }, // case-only difference
      { id: 'p_1', type: 'Person', name: 'Alice' },
    ]);
    const result = await runReview(vault);
    expect(result.candidates).toHaveLength(1);
    const dup = result.candidates[0];
    expect(dup?.type).toBe('Tool');
    expect(dup?.ids.sort()).toEqual(['tool_a', 'tool_b']);
  });
});
