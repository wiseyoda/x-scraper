import { describe, expect, it } from 'vitest';

import { assembleThemes, formatThemeForwardBody } from '../themes.js';

describe('assembleThemes', () => {
  it('names themes with idea subjects and links recent sources', () => {
    const themes = assembleThemes(
      [
        {
          id: 'idea_cc',
          subject: 'Claude Code',
          status: 'confirmed',
          sourceIds: ['src_a', 'src_b', 'src_old'],
          updatedAt: '2026-04-20T00:00:00.000Z',
        },
        {
          id: 'idea_noise',
          subject: 'Unrelated',
          status: 'draft',
          sourceIds: ['src_z'],
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      new Set(['src_a', 'src_b']),
      new Set(),
    );
    expect(themes.length).toBe(1);
    expect(themes[0]?.subject).toBe('Claude Code');
    expect(themes[0]?.linkedSourceIds).toEqual(expect.arrayContaining(['src_a', 'src_b']));
  });
});

describe('formatThemeForwardBody', () => {
  it('includes Themes section with idea ids, not counts-only', () => {
    const body = formatThemeForwardBody(
      '2026-W17',
      [
        {
          subject: 'Claude Code',
          ideaId: 'idea_cc',
          status: 'confirmed',
          linkedSourceIds: ['src_a'],
          sourceIds: ['src_a', 'src_b'],
        },
      ],
      ['src_a'],
      ['claim_1'],
    );
    expect(body).toContain('## Themes');
    expect(body).toContain('Claude Code');
    expect(body).toContain('`idea_cc`');
    expect(body).toContain('`src_a`');
    expect(body).not.toMatch(/^\*\*Sources\*\* \(\d+\):$/m);
  });
});
