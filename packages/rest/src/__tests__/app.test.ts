import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { createSqliteQueue, type JobQueue } from '@x-scraper/queue';
import { createMarkdownVault, type VaultStore } from '@x-scraper/vault';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildRestApp } from '../app.js';

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
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xscraper-rest-test-'));
  vault = createMarkdownVault(path.join(workDir, 'vault'));
  await vault.init({ initialCommit: false });
  queue = createSqliteQueue(path.join(workDir, 'q.sqlite'));
});

afterEach(async () => {
  queue.close();
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('buildRestApp', () => {
  it('serves /health without auth', async () => {
    const app = buildRestApp({ ctx: { vault, queue }, bearerToken: 'tok' });
    const resp = await app.request('/health');
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('rejects /search without bearer when configured', async () => {
    const app = buildRestApp({ ctx: { vault, queue }, bearerToken: 'tok' });
    const resp = await app.request('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(resp.status).toBe(401);
  });

  it('accepts /search with the right bearer', async () => {
    await writeSource('src_alpha0001');
    const app = buildRestApp({ ctx: { vault, queue }, bearerToken: 'tok' });
    const resp = await app.request('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
      body: JSON.stringify({}),
    });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { hits: { id: string }[] };
    expect(body.hits[0]?.id).toBe('src_alpha0001');
  });

  it('returns 400 on /search with an invalid limit', async () => {
    const app = buildRestApp({ ctx: { vault, queue } });
    const resp = await app.request('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limit: -1 }),
    });
    expect(resp.status).toBe(400);
  });

  it('returns 400 on /read with an unknown entity type', async () => {
    const app = buildRestApp({ ctx: { vault, queue } });
    const resp = await app.request('/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'x', type: 'Bogus' }),
    });
    expect(resp.status).toBe(400);
  });

  it('returns 200 and full source on /read for a known id', async () => {
    await writeSource('src_alpha0001', 'hello');
    const app = buildRestApp({ ctx: { vault, queue } });
    const resp = await app.request('/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'src_alpha0001', type: 'Source' }),
    });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { id: string; body: string };
    expect(body.id).toBe('src_alpha0001');
    expect(body.body).toContain('hello');
  });

  it('serves /status on a fresh queue', async () => {
    const app = buildRestApp({ ctx: { vault, queue } });
    const resp = await app.request('/status');
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { pending: number; dlqCount: number };
    expect(body.pending).toBe(0);
    expect(body.dlqCount).toBe(0);
  });
});
