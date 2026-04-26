import { describe, expect, it } from 'vitest';

import { formatDocument, parseDocument } from '../frontmatter.js';

describe('parseDocument', () => {
  it('extracts frontmatter and body', () => {
    const raw = `---\nid: src_abc\ntype: Source\n---\n\n# Hello\n\nbody text\n`;
    const doc = parseDocument(raw);
    expect(doc.frontmatter).toEqual({ id: 'src_abc', type: 'Source' });
    expect(doc.body).toBe('# Hello\n\nbody text\n');
  });

  it('returns empty frontmatter when no fence is present', () => {
    const doc = parseDocument('# just markdown\n');
    expect(doc.frontmatter).toEqual({});
    expect(doc.body).toBe('# just markdown\n');
  });

  it('handles CRLF line endings', () => {
    const raw = `---\r\nid: src_abc\r\ntype: Source\r\n---\r\n\r\n# Hello\r\n`;
    const doc = parseDocument(raw);
    expect(doc.frontmatter).toEqual({ id: 'src_abc', type: 'Source' });
    expect(doc.body.startsWith('# Hello')).toBe(true);
  });

  it('round-trips through format -> parse', () => {
    const original = {
      frontmatter: { id: 'claim_42', type: 'Claim', confidence: 0.85, sources: ['src_a', 'src_b'] },
      body: 'body content here\n',
    };
    const out = parseDocument(formatDocument(original));
    expect(out.frontmatter).toEqual(original.frontmatter);
    expect(out.body.trim()).toBe(original.body.trim());
  });
});

describe('formatDocument', () => {
  it('emits valid YAML frontmatter', () => {
    const out = formatDocument({
      frontmatter: { id: 'src_a', type: 'Source' },
      body: 'hello\n',
    });
    expect(out.startsWith('---\n')).toBe(true);
    expect(out).toContain('id: src_a');
    expect(out).toContain('type: Source');
    expect(out).toContain('hello');
  });

  it('strips a leading newline from the body', () => {
    const out = formatDocument({
      frontmatter: { id: 'a', type: 'Source' },
      body: '\n# heading\n',
    });
    expect(out).not.toContain('---\n\n\n# heading');
  });
});
