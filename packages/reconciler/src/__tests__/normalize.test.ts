import { describe, expect, it } from 'vitest';

import { normalizedSurfaceForms, normalizeEntityName } from '../normalize.js';

describe('normalizeEntityName', () => {
  it('lowercases and trims whitespace', () => {
    expect(normalizeEntityName('  Claude Code  ')).toBe('claude code');
  });

  it('strips leading articles', () => {
    expect(normalizeEntityName('The Anthropic API')).toBe('anthropic api');
    expect(normalizeEntityName('A Tool')).toBe('tool');
    expect(normalizeEntityName('An Agent')).toBe('agent');
  });

  it('singularizes regular plurals', () => {
    expect(normalizeEntityName('AI Agents')).toBe('ai agent');
    expect(normalizeEntityName('LLMs')).toBe('llm');
  });

  it('singularizes -ies to -y', () => {
    expect(normalizeEntityName('Repositories')).toBe('repository');
    expect(normalizeEntityName('Libraries')).toBe('library');
  });

  it('does not singularize -ss / -us / -is words', () => {
    expect(normalizeEntityName('class')).toBe('class');
    expect(normalizeEntityName('status')).toBe('status');
    expect(normalizeEntityName('basis')).toBe('basis');
  });

  it('strips inner punctuation but preserves dashes/underscores', () => {
    expect(normalizeEntityName('OpenAI, Inc.')).toBe('openai inc');
    expect(normalizeEntityName('foo-bar_baz')).toBe('foo-bar_baz');
  });

  it('NFKC-normalizes unicode variants', () => {
    expect(normalizeEntityName('ＡＩ Ａｇｅｎｔｓ')).toBe('ai agent');
  });

  it('returns empty string when input has no letters/digits', () => {
    expect(normalizeEntityName('!!!')).toBe('');
    expect(normalizeEntityName('')).toBe('');
  });

  it('produces the same form for AI Agents and AI Agent (the headline collision)', () => {
    expect(normalizeEntityName('AI Agents')).toBe(normalizeEntityName('AI Agent'));
  });
});

describe('normalizedSurfaceForms', () => {
  it('dedupes name + aliases into normalized set', () => {
    const forms = normalizedSurfaceForms('Model Context Protocol', ['MCP', 'mcp', 'the MCP']);
    expect(forms.sort()).toEqual(['mcp', 'model context protocol']);
  });

  it('drops empty / whitespace-only aliases', () => {
    const forms = normalizedSurfaceForms('Claude', ['', '   ', 'Anthropic Claude']);
    expect(forms.sort()).toEqual(['anthropic claude', 'claude']);
  });
});
