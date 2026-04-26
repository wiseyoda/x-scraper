import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Frontmatter } from '@x-scraper/core';
import { CoreError } from '@x-scraper/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createMarkdownVault, type VaultStore } from '../vault.js';

const NOW = '2026-04-26T00:00:00.000Z';

let root = '';
let vault: VaultStore;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'xscraper-vault-test-'));
  vault = createMarkdownVault(root);
  await vault.init({ initialCommit: false });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('createMarkdownVault', () => {
  it('creates the vault directory layout on init', async () => {
    const stat = await fs.stat(path.join(root, 'sources/articles'));
    expect(stat.isDirectory()).toBe(true);
    const stat2 = await fs.stat(path.join(root, 'claims'));
    expect(stat2.isDirectory()).toBe(true);
    const gitignore = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.xscraper/');
  });

  it('writes a Source record and reads it back identically', async () => {
    const fm = {
      id: 'src_aaaa1111',
      type: 'Source' as const,
      created_at: NOW,
      updated_at: NOW,
      url: 'https://example.com/a',
      canonical_url: 'https://example.com/a',
      captured_at: NOW,
      content_type: 'article' as const,
      sources: [],
      aliases: [],
      tags: [],
      topics: [],
      prompt_version: { extraction: 0, reconciliation: 0, embedding: 0 },
      host_metadata: {},
    };
    const relPath = await vault.write({ frontmatter: fm, body: '# Hello\n\nbody\n' });
    expect(relPath).toBe('sources/src_aaaa1111.md');
    const back = await vault.read('src_aaaa1111', 'Source');
    expect(back.frontmatter.id).toBe('src_aaaa1111');
    expect(back.body.trim()).toBe('# Hello\n\nbody');
  });

  it('writes a Claim record into the claims/ directory', async () => {
    const fm = {
      id: 'claim_bbbb2222',
      type: 'Claim' as const,
      created_at: NOW,
      updated_at: NOW,
      valid_at: NOW,
      invalid_at: null,
      subject: 'Neo4j',
      predicate: 'has_feature',
      object: 'native HNSW',
      sources: [],
      aliases: [],
      tags: [],
      topics: [],
      contradicts: [],
      supersedes: [],
      prompt_version: { extraction: 0, reconciliation: 0, embedding: 0 },
    };
    await vault.write({ frontmatter: fm, body: 'claim body\n' });
    const back = await vault.read('claim_bbbb2222', 'Claim');
    expect(back.frontmatter.type).toBe('Claim');
  });

  it('lists records sorted by mtime descending', async () => {
    const make = (id: string): { frontmatter: Frontmatter; body: string } => ({
      frontmatter: {
        id,
        type: 'Source',
        created_at: NOW,
        updated_at: NOW,
        url: `https://example.com/${id}`,
        canonical_url: `https://example.com/${id}`,
        captured_at: NOW,
        content_type: 'article',
        sources: [],
        aliases: [],
        tags: [],
        topics: [],
        prompt_version: { extraction: 0, reconciliation: 0, embedding: 0 },
        host_metadata: {},
      },
      body: 'x\n',
    });
    await vault.write(make('src_first0001'));
    await new Promise((r) => setTimeout(r, 10));
    await vault.write(make('src_secnd0002'));
    const list = await vault.list('Source');
    expect(list.map((e) => e.id)).toEqual(['src_secnd0002', 'src_first0001']);
  });

  it('throws NOT_FOUND when reading a missing id', async () => {
    await expect(vault.read('src_does_not', 'Source')).rejects.toThrow(CoreError);
  });

  it('rejects ids containing path separators', async () => {
    const fm = {
      id: 'src_../escape',
      type: 'Source' as const,
      created_at: NOW,
      updated_at: NOW,
      url: 'https://example.com/x',
      canonical_url: 'https://example.com/x',
      captured_at: NOW,
      content_type: 'article' as const,
      sources: [],
      aliases: [],
      tags: [],
      topics: [],
      prompt_version: { extraction: 0, reconciliation: 0, embedding: 0 },
      host_metadata: {},
    };
    await expect(vault.write({ frontmatter: fm, body: 'x' })).rejects.toThrow(CoreError);
  });
});
