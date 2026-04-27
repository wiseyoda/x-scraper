import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CAPTURE_SCHEMA_VERSION } from '../constants.js';
import { captureKeyForUrl, createCaptureStore } from '../store.js';
import type { ArticleCaptured } from '../types.js';

const buildArticle = (url = 'https://example.com/post-1'): ArticleCaptured => ({
  schema_version: CAPTURE_SCHEMA_VERSION,
  url,
  canonical_url: url,
  fetched_at: '2026-04-27T12:00:00.000Z',
  http_status: 200,
  captor: 'article',
  content_type: 'article',
  raw_html: '<html><body><p>hello world</p></body></html>',
  parsed: {
    title: 'Test',
    byline: null,
    body: 'hello world',
  },
});

describe('CaptureStore', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'capture-store-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('writes, reads, and lists captures', async () => {
    const store = createCaptureStore({ vaultDir: tmp });
    const a = buildArticle('https://example.com/post-1');
    const b = buildArticle('https://example.com/post-2');

    expect(await store.has(a.canonical_url)).toBe(false);
    await store.write(a);
    expect(await store.has(a.canonical_url)).toBe(true);

    const read = await store.read(a.canonical_url);
    expect(read).not.toBeNull();
    expect(read?.canonical_url).toBe(a.canonical_url);
    expect(read?.parsed.body).toBe('hello world');

    await store.write(b);
    const listed = await store.list();
    expect(listed.map((r) => r.canonical_url).sort()).toEqual(
      [a.canonical_url, b.canonical_url].sort(),
    );
  });

  it('returns null for missing entries (no throw)', async () => {
    const store = createCaptureStore({ vaultDir: tmp });
    const out = await store.read('https://nope.example/');
    expect(out).toBeNull();
  });

  it('rejects malformed cache JSON via Zod', async () => {
    const store = createCaptureStore({ vaultDir: tmp });
    const cachePath = store.pathFor('https://example.com/bad');
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify({ not: 'a capture' }), 'utf8');
    await expect(store.read('https://example.com/bad')).rejects.toThrow(/schema/);
  });

  it('keys by canonical url so http→https variants share one entry', () => {
    const k1 = captureKeyForUrl('http://example.com/x');
    const k2 = captureKeyForUrl('https://example.com/x');
    expect(k1).toBe(k2);
  });

  it('overwrites the same canonical_url atomically (no half-written read)', async () => {
    const store = createCaptureStore({ vaultDir: tmp });
    const a = buildArticle('https://example.com/post-1');
    await store.write(a);
    const updated: ArticleCaptured = {
      ...a,
      parsed: { ...a.parsed, body: 'updated body' },
    };
    await store.write(updated);
    const read = await store.read(a.canonical_url);
    expect(read?.parsed.body).toBe('updated body');
  });

  it('remove() returns false for missing keys, true after delete', async () => {
    const store = createCaptureStore({ vaultDir: tmp });
    expect(await store.remove('https://nope.example/')).toBe(false);
    const a = buildArticle();
    await store.write(a);
    expect(await store.remove(a.canonical_url)).toBe(true);
    expect(await store.has(a.canonical_url)).toBe(false);
  });
});
