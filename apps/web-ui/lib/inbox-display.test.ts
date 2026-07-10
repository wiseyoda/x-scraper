import { describe, expect, it } from 'vitest';

import {
  deriveInboxDisplay,
  firstBodyLine,
  firstHeading,
  githubRepoTitle,
  shortUrlLabel,
} from './inbox-display.js';

describe('firstBodyLine', () => {
  it('skips URL-only bodies (link-only tweets)', () => {
    expect(firstBodyLine('https://t.co/zNRTuxaxJU\n')).toBeNull();
  });

  it('returns a meaty tweet line, not a heading or list marker', () => {
    const body = [
      '---',
      'frontmatter would be stripped already',
      '',
      '# Not this',
      '',
      '> a senior Google engineer with 11 years of experience',
      '> built a system that does 80% of his job automatically',
    ].join('\n');
    const line = firstBodyLine(body);
    expect(line).not.toBeNull();
    expect(line!.toLowerCase()).toContain('senior google engineer');
    expect(line).not.toMatch(/^https?:\/\//);
  });
});

describe('firstHeading', () => {
  it('extracts ATX headings', () => {
    expect(firstHeading('# SkillsBench\n\nSome intro')).toBe('SkillsBench');
  });
});

describe('githubRepoTitle', () => {
  it('returns owner/repo for github URLs', () => {
    expect(githubRepoTitle('https://github.com/HKUDS/VideoRAG')).toBe('HKUDS/VideoRAG');
  });

  it('returns null for non-github URLs', () => {
    expect(githubRepoTitle('https://x.com/foo/status/1')).toBeNull();
  });
});

describe('deriveInboxDisplay', () => {
  it('uses tweet body gist as primary, URL as secondary — not raw URL primary', () => {
    const d = deriveInboxDisplay({
      url: 'https://x.com/polydao/status/2043732432910762444',
      contentType: 'tweet',
      byline: 'polydao',
      body: [
        '&gt; do you understand what Claude Code just did',
        '&gt; a senior Google engineer with 11 years of experience',
        '&gt; built a system that does 80% of his job automatically',
      ].join('\n'),
    });
    expect(d.primary).not.toBe(d.secondary);
    expect(d.primary).not.toMatch(/^https?:\/\/x\.com\//);
    expect(d.primary.toLowerCase()).toMatch(/claude code|senior google engineer/);
    expect(d.secondary).toBe('https://x.com/polydao/status/2043732432910762444');
    expect(d.authorHandle).toBe('polydao');
    expect(d.authorDisplay).toBe('polydao');
    expect(d.snippet).not.toBeNull();
  });

  it('link-only tweet: primary is @author, secondary is URL', () => {
    const d = deriveInboxDisplay({
      url: 'https://x.com/sidrmsh/status/2029339145114374256',
      contentType: 'tweet',
      byline: 'sidrmsh',
      body: 'https://t.co/zNRTuxaxJU\n',
    });
    expect(d.primary).toBe('@sidrmsh');
    expect(d.primary).not.toBe(d.secondary);
    expect(d.secondary).toContain('x.com/sidrmsh');
    expect(d.snippet).toBeNull();
  });

  it('article with H1: title is primary, URL secondary', () => {
    const d = deriveInboxDisplay({
      url: 'https://arxiv.org/abs/2602.12670',
      contentType: 'article',
      body: '# SkillsBench\n\nA benchmark for agent skills with long descriptive prose here.\n',
    });
    expect(d.primary).toBe('SkillsBench');
    expect(d.title).toBe('SkillsBench');
    expect(d.secondary).toBe('https://arxiv.org/abs/2602.12670');
    expect(d.primary).not.toMatch(/^https?:\/\//);
  });

  it('repo URL: owner/repo title as primary', () => {
    const d = deriveInboxDisplay({
      url: 'https://github.com/HKUDS/VideoRAG',
      contentType: 'repo',
      body: 'Aliases: https://github.com/HKUDS/VideoRAG\n\n## URLs\n',
    });
    expect(d.primary).toBe('HKUDS/VideoRAG');
    expect(d.secondary).toBe('https://github.com/HKUDS/VideoRAG');
    expect(d.authorHandle).toBe('hkuds');
  });

  it('empty body with no author falls back to short host path, not full junk', () => {
    const d = deriveInboxDisplay({
      url: 'https://example.com/very/long/path/to/resource?q=1&x=2',
      contentType: 'article',
      body: '',
    });
    expect(d.primary).toBe(shortUrlLabel(d.secondary));
    expect(d.primary).not.toContain('?q=');
    expect(d.secondary).toContain('example.com');
  });
});
