/**
 * `xs bookmarks pull` and `xs bookmarks sync` command tests.
 *
 * The pull tests stub the scraper fetcher so we don't need a live X
 * session; only the ledger upsert + payload extraction are exercised.
 * The sync tests stub the per-bookmark sync runner so we exercise the
 * order, halting, and ledger-writeback semantics without booting Neo4j.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { createSqliteQueue } from '@x-scraper/queue';
import type { BookmarkRecord } from '@x-scraper/scraper';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type BookmarkSyncOutcome,
  runBookmarksPull,
  runBookmarksSync,
} from '../commands/bookmarks.js';
import type { CliConfig } from '../config.js';

let dbDir = '';
let config: CliConfig;

beforeEach(async () => {
  dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xs-bookmarks-test-'));
  config = {
    vaultDir: path.join(dbDir, 'vault'),
    queuePath: path.join(dbDir, 'q.sqlite'),
  };
});

afterEach(async () => {
  await fs.rm(dbDir, { recursive: true, force: true });
});

const buildRecord = (
  entryId: string,
  tweetId: string,
  text: string,
  capturedAt: string,
  author = 'someuser',
): BookmarkRecord => ({
  entryId,
  tweetId,
  capturedAt,
  cursor: null,
  source: 'bookmarks',
  raw: {
    content: {
      itemContent: {
        tweet_results: {
          result: {
            __typename: 'Tweet',
            core: { user_results: { result: { core: { screen_name: author } } } },
            legacy: {
              full_text: text,
              created_at: 'Sat Apr 26 14:00:00 +0000 2026',
              entities: { urls: [{ expanded_url: 'https://example.com/x' }] },
            },
          },
        },
      },
    },
  },
});

describe('runBookmarksPull', () => {
  it('upserts every record into the ledger and is idempotent', async () => {
    const records = [
      buildRecord('tweet-1', '1', 'first', '2026-04-01T00:00:00.000Z', 'a'),
      buildRecord('tweet-2', '2', 'second', '2026-04-02T00:00:00.000Z', 'b'),
    ];
    const fetcher = (): Promise<BookmarkRecord[]> => Promise.resolve(records);

    const first = await runBookmarksPull(config, { source: 'bookmarks', fetcher });
    expect(first.fetched).toBe(2);
    expect(first.inserted).toBe(2);
    expect(first.unchanged).toBe(0);
    expect(first.skipped).toBe(0);

    const queue = createSqliteQueue(config.queuePath);
    const all = queue.listBookmarks();
    expect(all.map((b) => b.entryId).sort()).toEqual(['tweet-1', 'tweet-2']);
    const t1 = all.find((b) => b.entryId === 'tweet-1');
    expect(t1?.text).toBe('first');
    expect(t1?.author).toBe('a');
    expect(t1?.urls).toEqual(['https://example.com/x']);
    expect(t1?.sourceUrl).toBe('https://x.com/a/status/1');
    queue.close();

    // Re-pull is a no-op.
    const second = await runBookmarksPull(config, { source: 'bookmarks', fetcher });
    expect(second.inserted).toBe(0);
    expect(second.unchanged).toBe(2);
  });

  it('skips records whose payload cannot be extracted (tombstones)', async () => {
    const tombstone: BookmarkRecord = {
      entryId: 'tombstone-1',
      tweetId: '99',
      capturedAt: '2026-01-01T00:00:00.000Z',
      cursor: null,
      source: 'bookmarks',
      raw: {
        content: {
          itemContent: { tweet_results: { result: { __typename: 'TweetTombstone' } } },
        },
      },
    };
    const result = await runBookmarksPull(config, {
      source: 'bookmarks',
      fetcher: () => Promise.resolve([tombstone]),
    });
    expect(result.skipped).toBe(1);
    expect(result.inserted).toBe(0);
  });
});

describe('runBookmarksSync', () => {
  it('processes oldest-first by default and writes synced status back', async () => {
    // Seed two ledger rows directly via the queue.
    const queue = createSqliteQueue(config.queuePath);
    queue.upsertBookmark({
      entryId: 'a',
      tweetId: '1',
      source: 'bookmarks',
      sourceUrl: 'https://x.com/u/status/1',
      author: 'u',
      text: 'first',
      capturedAt: '2026-01-01T00:00:00.000Z',
    });
    queue.upsertBookmark({
      entryId: 'b',
      tweetId: '2',
      source: 'bookmarks',
      sourceUrl: 'https://x.com/u/status/2',
      author: 'u',
      text: 'second',
      capturedAt: '2026-01-02T00:00:00.000Z',
    });
    queue.close();

    const seen: string[] = [];
    const stubSync = (item: { entryId: string }): Promise<BookmarkSyncOutcome> => {
      seen.push(item.entryId);
      return Promise.resolve({
        entryId: item.entryId,
        runId: `run_${item.entryId}`,
        jobId: `job_${item.entryId}`,
        jobStatus: 'done',
        status: 'synced',
        error: null,
        durationMs: 10,
        costUsd: 0.01,
      });
    };
    const result = await runBookmarksSync(config, { syncOne: stubSync });
    expect(seen).toEqual(['a', 'b']); // oldest first
    expect(result.attempted).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);

    const q2 = createSqliteQueue(config.queuePath);
    const final = q2.listBookmarks();
    for (const row of final) {
      expect(row.status).toBe('synced');
      expect(row.runId).toMatch(/^run_/);
      expect(row.syncedAt).not.toBeNull();
      expect(row.attempts).toBe(1);
    }
    q2.close();
  });

  it('halts on first failure when --pause-on-fail is set', async () => {
    const queue = createSqliteQueue(config.queuePath);
    for (const id of ['a', 'b', 'c']) {
      queue.upsertBookmark({
        entryId: id,
        tweetId: id,
        source: 'bookmarks',
        sourceUrl: `https://x.com/u/status/${id}`,
        author: 'u',
        text: id,
        capturedAt: `2026-01-0${id === 'a' ? '1' : id === 'b' ? '2' : '3'}T00:00:00.000Z`,
      });
    }
    queue.close();

    let calls = 0;
    const stubSync = (item: { entryId: string }): Promise<BookmarkSyncOutcome> => {
      calls += 1;
      return Promise.resolve({
        entryId: item.entryId,
        runId: 'r',
        jobId: 'j',
        jobStatus: item.entryId === 'b' ? 'failed' : 'done',
        status: item.entryId === 'b' ? 'failed' : 'synced',
        error: item.entryId === 'b' ? 'boom' : null,
        durationMs: 1,
        costUsd: 0.01,
      });
    };
    const result = await runBookmarksSync(config, { syncOne: stubSync, pauseOnFail: true });
    expect(calls).toBe(2);
    expect(result.attempted).toBe(2);
    expect(result.haltedOnFail).toBe(true);

    const q2 = createSqliteQueue(config.queuePath);
    const failed = q2.getBookmark('b');
    expect(failed?.status).toBe('failed');
    expect(failed?.lastError).toBe('boom');
    expect(q2.getBookmark('c')?.status).toBe('new'); // untouched
    q2.close();
  });

  it('returns empty result when ledger has no new rows', async () => {
    const result = await runBookmarksSync(config, {
      syncOne: () => {
        throw new Error('should not be called');
      },
    });
    expect(result.attempted).toBe(0);
  });

  it('respects --order=newest', async () => {
    const queue = createSqliteQueue(config.queuePath);
    queue.upsertBookmark({
      entryId: 'old',
      tweetId: '1',
      source: 'bookmarks',
      sourceUrl: 'https://x.com/u/status/1',
      author: 'u',
      text: 'old text',
      capturedAt: '2026-01-01T00:00:00.000Z',
    });
    queue.upsertBookmark({
      entryId: 'new',
      tweetId: '2',
      source: 'bookmarks',
      sourceUrl: 'https://x.com/u/status/2',
      author: 'u',
      text: 'new text',
      capturedAt: '2026-01-05T00:00:00.000Z',
    });
    queue.close();

    const seen: string[] = [];
    await runBookmarksSync(config, {
      order: 'newest',
      syncOne: (item) => {
        seen.push(item.entryId);
        return Promise.resolve({
          entryId: item.entryId,
          runId: 'r',
          jobId: 'j',
          jobStatus: 'done',
          status: 'synced',
          error: null,
          durationMs: 1,
          costUsd: 0,
        });
      },
    });
    expect(seen).toEqual(['new', 'old']);
  });

  it('skips link-only tweets without invoking syncOne and writes a stub Source.md', async () => {
    const queue = createSqliteQueue(config.queuePath);
    queue.upsertBookmark({
      entryId: 'link-only',
      tweetId: '1',
      source: 'bookmarks',
      sourceUrl: 'https://x.com/u/status/1',
      author: 'u',
      text: 'https://t.co/abc123XYZ',
      capturedAt: '2026-01-01T00:00:00.000Z',
    });
    queue.upsertBookmark({
      entryId: 'real',
      tweetId: '2',
      source: 'bookmarks',
      sourceUrl: 'https://x.com/u/status/2',
      author: 'u',
      text: 'this is a real tweet with substance',
      capturedAt: '2026-01-02T00:00:00.000Z',
    });
    queue.close();

    const seen: string[] = [];
    const stubSync = (item: { entryId: string }): Promise<BookmarkSyncOutcome> => {
      seen.push(item.entryId);
      return Promise.resolve({
        entryId: item.entryId,
        runId: 'r',
        jobId: 'j',
        jobStatus: 'done',
        status: 'synced',
        error: null,
        durationMs: 1,
        costUsd: 0.01,
      });
    };
    const result = await runBookmarksSync(config, { syncOne: stubSync });
    // syncOne only called for the substantive tweet; link-only short-circuited.
    expect(seen).toEqual(['real']);
    expect(result.attempted).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.totalCostUsd).toBeCloseTo(0.01);

    // Link-only outcome marked synced with skip-link-only runId.
    const skipped = result.outcomes.find((o) => o.entryId === 'link-only');
    expect(skipped?.runId).toBe('skip-link-only');
    expect(skipped?.costUsd).toBe(0);

    // Stub Source.md present in vault with skipReason metadata. Find by
    // scanning sources/ for src_*.md files (vault.init writes README etc.).
    const sourcesDir = path.join(config.vaultDir, 'sources');
    const files = (await fs.readdir(sourcesDir)).filter((f) => f.startsWith('src_'));
    expect(files.length).toBe(1);
    const firstFile = files[0];
    expect(firstFile).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const stub = await fs.readFile(path.join(sourcesDir, firstFile!), 'utf8');
    expect(stub).toContain('skipReason: link_only_tweet');
    expect(stub).toContain('content_type: tweet');
  });
});
