import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import type { FetchLike } from '../http.js';
import { createRepoIngestor, parseGitHubUrl } from '../repo.js';

const REPO_INFO = {
  name: 'graphiti',
  full_name: 'getzep/graphiti',
  description: 'A knowledge graph engine',
  default_branch: 'main',
  owner: { login: 'getzep' },
  stargazers_count: 1234,
  language: 'TypeScript',
};

const README_TEXT = `# Graphiti\n\nKnowledge graph engine with bi-temporal facts.\n${'It indexes claims, sources, and entities. '.repeat(8)}`;

const REPO_BLOB = {
  content: Buffer.from(README_TEXT, 'utf8').toString('base64'),
  encoding: 'base64',
};

describe('parseGitHubUrl', () => {
  it('parses owner/repo from a canonical URL', () => {
    expect(parseGitHubUrl('https://github.com/getzep/graphiti')).toEqual({
      owner: 'getzep',
      repo: 'graphiti',
    });
  });

  it('strips a trailing .git suffix', () => {
    expect(parseGitHubUrl('https://github.com/getzep/graphiti.git')).toEqual({
      owner: 'getzep',
      repo: 'graphiti',
    });
  });

  it('returns null for non-GitHub hosts', () => {
    expect(parseGitHubUrl('https://gitlab.com/g/r')).toBeNull();
  });

  it('returns null for owner-only URLs', () => {
    expect(parseGitHubUrl('https://github.com/getzep')).toBeNull();
  });
});

describe('createRepoIngestor', () => {
  it('returns repo metadata + decoded README body', async () => {
    const fetchImpl: FetchLike = vi.fn((url: string) => {
      if (url.endsWith('/readme')) {
        return Promise.resolve(
          new Response(JSON.stringify(REPO_BLOB), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(REPO_INFO), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    const ingestor = createRepoIngestor({
      fetchImpl,
      now: () => new Date('2026-04-26T00:00:00.000Z'),
    });
    const source = await ingestor.ingest('https://github.com/getzep/graphiti');
    expect(source.kind).toBe('repo');
    expect(source.title).toBe('getzep/graphiti');
    expect(source.byline).toBe('getzep');
    expect(source.body).toContain('knowledge graph');
    expect(source.metadata.stars).toBe(1234);
    expect(source.metadata.language).toBe('TypeScript');
  });

  it('still ingests when README is absent', async () => {
    const fetchImpl: FetchLike = vi.fn((url: string) => {
      if (url.endsWith('/readme')) {
        return Promise.resolve(new Response('not found', { status: 404 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(REPO_INFO), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    const ingestor = createRepoIngestor({ fetchImpl });
    const source = await ingestor.ingest('https://github.com/getzep/graphiti');
    expect(source.title).toBe('getzep/graphiti');
    expect(source.body).toContain('A knowledge graph engine');
  });

  it('forwards a Bearer token when supplied', async () => {
    const seen: Record<string, string>[] = [];
    const fetchImpl: FetchLike = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.headers !== undefined) seen.push(init.headers as Record<string, string>);
      return Promise.resolve(
        new Response(JSON.stringify(REPO_INFO), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    const ingestor = createRepoIngestor({ fetchImpl, token: 'gh_test_xxx' });
    await ingestor.ingest('https://github.com/getzep/graphiti').catch(() => undefined);
    expect(seen[0]?.authorization).toBe('Bearer gh_test_xxx');
  });
});
