import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { createSqliteQueue, type JobQueue } from '@x-scraper/queue';
import { createMarkdownVault, type VaultStore } from '@x-scraper/vault';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getStatus, readSource, searchVault, summarizeHit } from '../handlers.js';
import { ToolError } from '../types.js';

const NOW = '2026-04-26T00:00:00.000Z';

let workDir = '';
let vault: VaultStore;
let queue: JobQueue;

const writeSource = async (id: string, body = 'body'): Promise<void> => {
  await vault.write({
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
    body,
  });
};

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xscraper-mcp-test-'));
  vault = createMarkdownVault(path.join(workDir, 'vault'));
  await vault.init({ initialCommit: false });
  queue = createSqliteQueue(path.join(workDir, 'q.sqlite'));
});

afterEach(async () => {
  queue.close();
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('searchVault', () => {
  it('returns vault entries unfiltered', async () => {
    await writeSource('src_alpha0001');
    await writeSource('src_beta00002');
    const hits = await searchVault({ vault, queue }, {});
    expect(hits.map((h) => h.id).sort()).toEqual(['src_alpha0001', 'src_beta00002']);
  });

  it('filters by id substring', async () => {
    await writeSource('src_alpha0001');
    await writeSource('src_beta00002');
    const hits = await searchVault({ vault, queue }, { query: 'beta' });
    expect(hits.map((h) => h.id)).toEqual(['src_beta00002']);
  });

  it('rejects unknown entity types', async () => {
    await expect(searchVault({ vault, queue }, { type: 'Bogus' })).rejects.toBeInstanceOf(
      ToolError,
    );
  });

  it('clamps limit to 100', async () => {
    const hits = await searchVault({ vault, queue }, { limit: 9999 });
    expect(hits.length).toBeLessThanOrEqual(100);
  });
});

describe('readSource', () => {
  it('returns the body and the canonical URL', async () => {
    await writeSource('src_alpha0001', 'this is the body');
    const result = await readSource({ vault, queue }, { id: 'src_alpha0001', type: 'Source' });
    expect(result.body).toContain('this is the body');
    expect(result.url).toBe('https://example.com/src_alpha0001');
  });

  it('rejects an unknown entity type', async () => {
    await expect(readSource({ vault, queue }, { id: 'x', type: 'Bogus' })).rejects.toBeInstanceOf(
      ToolError,
    );
  });
});

describe('getStatus', () => {
  it('reports per-status counts on a fresh queue', () => {
    const report = getStatus({ vault, queue });
    expect(report.pending).toBe(0);
    expect(report.dlqCount).toBe(0);
  });
});

describe('summarizeHit', () => {
  it('truncates long bodies with an ellipsis', () => {
    const summary = summarizeHit('a'.repeat(500));
    expect(summary.endsWith('…')).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(201);
  });

  it('returns short bodies unchanged', () => {
    expect(summarizeHit('short')).toBe('short');
  });
});
