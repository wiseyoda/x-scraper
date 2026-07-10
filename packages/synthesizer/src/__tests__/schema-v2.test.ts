import { describe, expect, it } from 'vitest';

import { formatResearchThreadBody, parseResearchThreadBody } from '../body-format.js';
import { IdeaDraftSchema } from '../schemas.js';

describe('IdeaDraftSchema v2 research-thread', () => {
  const good = {
    title: 'Claude Code as agent harness',
    thesis: 'Claude Code is becoming a primary coding agent surface.',
    evidence: [
      'Multiple sources describe multi-agent workflows',
      'Users report hour-level task automation',
    ],
    open_questions: ['Where does it fail on large repos?'],
    watch_fors: ['New MCP tool ecosystem'],
    confidence: 0.78,
    caveat: null,
  };

  it('accepts a valid research-thread draft via shipped schema', () => {
    const parsed = IdeaDraftSchema.safeParse(good);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.thesis).toContain('Claude Code');
    expect(parsed.data.evidence.length).toBeGreaterThanOrEqual(1);
    expect(parsed.data.open_questions.length).toBeGreaterThanOrEqual(1);
    expect(parsed.data.watch_fors.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects missing thesis (invalid shape)', () => {
    const bad = { ...good, thesis: undefined };
    const parsed = IdeaDraftSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it('rejects empty evidence array', () => {
    const bad = { ...good, evidence: [] };
    expect(IdeaDraftSchema.safeParse(bad).success).toBe(false);
  });

  it('formatResearchThreadBody round-trips parseable sections', () => {
    const body = formatResearchThreadBody({
      title: good.title,
      thesis: good.thesis,
      evidence: good.evidence,
      openQuestions: good.open_questions,
      watchFors: good.watch_fors,
      confidence: good.confidence,
      caveat: null,
    });
    expect(body).toContain('## Thesis');
    expect(body).toContain('## Open questions');
    expect(body.startsWith('# ')).toBe(false);
    expect(body.startsWith('## Thesis')).toBe(true);
    const parsed = parseResearchThreadBody(body);
    expect(parsed.thesis).toContain('coding agent');
    expect(parsed.openQuestions.some((q) => q.includes('large repos'))).toBe(true);
    expect(parsed.evidence.length).toBe(2);
  });
});
