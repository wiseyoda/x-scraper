import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Frontmatter } from '@x-scraper/core';
import type { CompleteRequest, LlmProvider } from '@x-scraper/llm';
import { createMarkdownVault, type VaultStore } from '@x-scraper/vault';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDigest } from '../digest.js';

const NOW = new Date('2026-04-26T18:00:00Z');

let workDir = '';
let vault: VaultStore;

const sourceFM = (id: string): Frontmatter => ({
  id,
  type: 'Source',
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
  url: `https://example.com/${id}`,
  canonical_url: `https://example.com/${id}`,
  captured_at: NOW.toISOString(),
  content_type: 'article',
  sources: [],
  aliases: [],
  tags: [],
  topics: [],
  prompt_version: { extraction: 0, reconciliation: 0, embedding: 0 },
  host_metadata: {},
});

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xscraper-digest-test-'));
  vault = createMarkdownVault(path.join(workDir, 'vault'));
  await vault.init({ initialCommit: false });
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('buildDigest', () => {
  it('emits a deterministic listing when no LLM is supplied', async () => {
    await vault.write({ frontmatter: sourceFM('src_alpha0001'), body: 'a' });
    await vault.write({ frontmatter: sourceFM('src_beta00002'), body: 'b' });
    const artifact = await buildDigest(vault, { now: NOW });
    expect(artifact.weekLabel).toBe('2026-W17');
    expect(artifact.sourceCount).toBe(2);
    expect(artifact.body).toContain('src_alpha0001');
    expect(artifact.body).toContain('src_beta00002');
    expect(artifact.body).toContain('# Digest 2026-W17');
  });

  it('routes through the LLM provider when supplied', async () => {
    await vault.write({ frontmatter: sourceFM('src_alpha0001'), body: 'a' });
    const seen: CompleteRequest[] = [];
    const llm: LlmProvider = {
      provider: 'anthropic',
      complete: vi.fn((req: CompleteRequest) => {
        seen.push(req);
        return Promise.resolve({
          text: 'A summary of the week.',
          modelUsed: 'claude-sonnet-4-6',
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreateTokens: 0 },
          costUsd: 0.0001,
        });
      }),
    };
    const artifact = await buildDigest(vault, { now: NOW, llm });
    expect(seen).toHaveLength(1);
    expect(artifact.body).toContain('# Digest 2026-W17');
    expect(artifact.body).toContain('A summary of the week.');
  });

  it('only counts records inside the 7-day window', async () => {
    // Write a record, then back-date its file mtime to two weeks ago.
    await vault.write({ frontmatter: sourceFM('src_old00001'), body: 'old' });
    const oldFile = path.join(workDir, 'vault', 'sources', 'src_old00001.md');
    const oldDate = new Date(NOW.getTime() - 14 * 24 * 60 * 60 * 1_000);
    await fs.utimes(oldFile, oldDate, oldDate);

    await vault.write({ frontmatter: sourceFM('src_new00002'), body: 'new' });
    const artifact = await buildDigest(vault, { now: NOW });
    expect(artifact.sourceCount).toBe(1);
    expect(artifact.body).toContain('src_new00002');
    expect(artifact.body).not.toContain('src_old00001');
  });
});
