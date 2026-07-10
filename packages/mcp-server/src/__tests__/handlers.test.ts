import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { createSqliteQueue, type JobQueue } from '@x-scraper/queue';
import { createMarkdownVault, type VaultStore } from '@x-scraper/vault';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getStatus,
  readSource,
  relatedTo,
  searchIdeas,
  searchVault,
  summarizeHit,
  whatsNew,
} from '../handlers.js';
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

describe('relatedTo / searchIdeas / whatsNew', () => {
  it('relatedTo returns structured hits via shared engine for co-entity sources', async () => {
    await writeSource('src_a');
    await writeSource('src_b');
    await vault.write({
      frontmatter: {
        id: 'tool_x',
        type: 'Tool',
        created_at: NOW,
        updated_at: NOW,
        prompt_version: { extraction: 0, reconciliation: 0, embedding: 0 },
        sources: ['src_a', 'src_b'],
        aliases: [],
        tags: [],
        topics: [],
        name: 'Shared Tool',
      },
      body: '',
    });
    const result = await relatedTo({ vault, queue }, { id: 'src_a', limit: 10 });
    expect(result.id).toBe('src_a');
    expect(result.hits.some((h) => h.targetId === 'src_b')).toBe(true);
    const peer = result.hits.find((h) => h.targetId === 'src_b');
    expect(peer?.reason.length).toBeGreaterThan(0);
    expect(peer?.score).toBeGreaterThan(0);
  });

  it('searchIdeas finds by subject and returns idea ids', async () => {
    await vault.write({
      frontmatter: {
        id: 'idea_test01',
        type: 'Idea',
        created_at: NOW,
        updated_at: NOW,
        prompt_version: { extraction: 0, reconciliation: 0, embedding: 0 },
        sources: ['src_a'],
        aliases: [],
        tags: [],
        topics: [],
        tier: 1,
        status: 'confirmed',
        subject: 'Claude Code workflows',
        synthesizer_confidence: 0.8,
        synthesizer_version: 2,
        synthesized_at: NOW,
        derived_from: [],
        edited_body: false,
        auto_confirmed: false,
      },
      body: '## Thesis\n\nClaude Code is useful.\n',
    });
    const result = await searchIdeas({ vault, queue }, { query: 'claude' });
    expect(result.hits.some((h) => h.id === 'idea_test01')).toBe(true);
  });

  it('whatsNew returns since + attachments array without throw', async () => {
    await writeSource('src_recent');
    const result = await whatsNew({ vault, queue }, { since: '2020-01-01T00:00:00.000Z' });
    expect(result.since).toBe('2020-01-01T00:00:00.000Z');
    expect(Array.isArray(result.attachments)).toBe(true);
    expect(Array.isArray(result.recentIdeas)).toBe(true);
  });
});
