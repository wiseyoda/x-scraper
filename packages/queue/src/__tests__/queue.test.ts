import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { STAGES } from '../constants.js';
import { createSqliteQueue, type JobQueue } from '../queue.js';
import { QueueError } from '../types.js';

let dbDir = '';
let queue: JobQueue;

beforeEach(async () => {
  dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xscraper-queue-test-'));
  queue = createSqliteQueue(path.join(dbDir, 'q.sqlite'));
});

afterEach(async () => {
  queue.close();
  await fs.rm(dbDir, { recursive: true, force: true });
});

describe('createSqliteQueue', () => {
  it('starts a run and enqueues jobs idempotently', () => {
    const runId = queue.startRun();
    const jobIdA = queue.enqueue({
      runId,
      sourceId: 'src_1',
      sourceKind: 'bookmarks',
      idempotencyKey: 'hash_a',
    });
    const jobIdB = queue.enqueue({
      runId,
      sourceId: 'src_1',
      sourceKind: 'bookmarks',
      idempotencyKey: 'hash_a',
    });
    expect(jobIdA).toBe(jobIdB);
    expect(queue.listJobs({ runId })).toHaveLength(1);
  });

  it('claimNext returns the only pending job and leases it', () => {
    const runId = queue.startRun();
    const jobId = queue.enqueue({
      runId,
      sourceId: 'src_1',
      sourceKind: 'bookmarks',
      idempotencyKey: 'k',
    });
    const claimed = queue.claimNext();
    expect(claimed?.jobId).toBe(jobId);
    expect(claimed?.status).toBe('running');
    expect(claimed?.leasedAt).not.toBeNull();
    expect(queue.claimNext()).toBeNull();
  });

  it('completeStage advances through every stage and lands at done', () => {
    const runId = queue.startRun();
    queue.enqueue({
      runId,
      sourceId: 'src_1',
      sourceKind: 'bookmarks',
      idempotencyKey: 'k',
    });
    for (const stage of STAGES) {
      const job = queue.claimNext();
      if (job === null) throw new Error('expected a claimable job');
      expect(job.currentStage).toBe(stage);
      if (job.currentAttemptId === null) throw new Error('expected lease token');
      queue.completeStage(job.jobId, stage, job.currentAttemptId);
    }
    const final = queue.listJobs({ runId })[0];
    expect(final?.status).toBe('done');
    expect(final?.attempts).toBe(0);
    expect(final?.lastError).toBeNull();
    expect(final?.nextRunAt).toBeNull();
    expect(queue.claimNext()).toBeNull();
  });

  it('failStage with maxAttempts=2 leaves job pending with backoff after one failure', () => {
    const runId = queue.startRun();
    const jobId = queue.enqueue({
      runId,
      sourceId: 'src_1',
      sourceKind: 'bookmarks',
      idempotencyKey: 'k',
    });
    const job = queue.claimNext();
    if (!job?.currentAttemptId) throw new Error('expected lease token');
    queue.failStage({
      jobId,
      stage: STAGES[0],
      attemptId: job.currentAttemptId,
      errorCode: 'NETWORK',
      errorMsg: 'first fail',
      maxAttempts: 2,
    });
    const after = queue.listJobs({ runId })[0];
    expect(after?.status).toBe('pending');
    expect(after?.attempts).toBe(1);
    expect(after?.nextRunAt).not.toBeNull();
    expect(after?.lastError).toBe('first fail');
  });

  it('failStage with maxAttempts=1 sends the job straight to DLQ', () => {
    const runId = queue.startRun();
    const jobId = queue.enqueue({
      runId,
      sourceId: 'src_1',
      sourceKind: 'bookmarks',
      idempotencyKey: 'k',
    });
    const job = queue.claimNext();
    if (!job?.currentAttemptId) throw new Error('expected lease token');
    queue.failStage({
      jobId,
      stage: STAGES[0],
      attemptId: job.currentAttemptId,
      errorCode: 'NETWORK',
      errorMsg: 'fatal',
      maxAttempts: 1,
    });
    const after = queue.listJobs({ runId })[0];
    expect(after?.status).toBe('dead');
    expect(queue.listDlq().map((j) => j.jobId)).toContain(jobId);
  });

  it('retryFailed reopens a DLQ job and resets attempts', () => {
    const runId = queue.startRun();
    const jobId = queue.enqueue({
      runId,
      sourceId: 'src_1',
      sourceKind: 'bookmarks',
      idempotencyKey: 'k',
    });
    const claimed = queue.claimNext();
    if (!claimed?.currentAttemptId) throw new Error('expected lease token');
    queue.failStage({
      jobId,
      stage: STAGES[0],
      attemptId: claimed.currentAttemptId,
      errorCode: 'X',
      errorMsg: 'x',
      maxAttempts: 1,
    });
    expect(queue.listDlq().map((j) => j.jobId)).toContain(jobId);
    const reopened = queue.retryFailed(jobId);
    expect(reopened.status).toBe('pending');
    expect(reopened.attempts).toBe(0);
    expect(queue.listDlq()).toHaveLength(0);
  });

  it('rejects completeStage when the job is at a different stage', () => {
    const runId = queue.startRun();
    const jobId = queue.enqueue({
      runId,
      sourceId: 'src_1',
      sourceKind: 'bookmarks',
      idempotencyKey: 'k',
    });
    const claimed = queue.claimNext();
    if (!claimed?.currentAttemptId) throw new Error('expected lease token');
    const attemptId = claimed.currentAttemptId;
    expect(() => queue.completeStage(jobId, STAGES[1], attemptId)).toThrow(QueueError);
  });

  it('completeAllStages marks the job done in one transaction', () => {
    const runId = queue.startRun();
    queue.enqueue({
      runId,
      sourceId: 'src_1',
      sourceKind: 'bookmarks',
      idempotencyKey: 'k',
    });
    const job = queue.claimNext();
    if (!job?.currentAttemptId) throw new Error('expected lease token');
    const final = queue.completeAllStages(job.jobId, job.currentAttemptId);
    expect(final.status).toBe('done');
    expect(final.leasedAt).toBeNull();
    expect(queue.claimNext()).toBeNull();
  });

  it('completeAllStages rejects a stale attempt id', () => {
    const runId = queue.startRun();
    const jobId = queue.enqueue({
      runId,
      sourceId: 'src_1',
      sourceKind: 'bookmarks',
      idempotencyKey: 'k',
    });
    const job = queue.claimNext();
    if (!job?.currentAttemptId) throw new Error('expected lease token');
    queue.completeAllStages(jobId, job.currentAttemptId);
    // Second call with the same attemptId — already-finished job, lease cleared.
    expect(() => queue.completeAllStages(jobId, job.currentAttemptId ?? 0)).toThrow(QueueError);
  });

  it('claimNext({runId}) only returns jobs from the requested run', () => {
    const runA = queue.startRun();
    const runB = queue.startRun();
    queue.enqueue({ runId: runA, sourceId: 'a', sourceKind: 'bookmarks', idempotencyKey: 'a' });
    queue.enqueue({ runId: runB, sourceId: 'b', sourceKind: 'bookmarks', idempotencyKey: 'b' });
    const onlyB = queue.claimNext({ runId: runB });
    expect(onlyB?.runId).toBe(runB);
    expect(onlyB?.sourceId).toBe('b');
    // runA's job stays untouched.
    const stillA = queue.listJobs({ runId: runA, status: 'pending' });
    expect(stillA).toHaveLength(1);
  });

  it('rejects completeStage with a stale attempt id (lease theft protection)', () => {
    const runId = queue.startRun();
    const jobId = queue.enqueue({
      runId,
      sourceId: 'src_1',
      sourceKind: 'bookmarks',
      idempotencyKey: 'k',
    });
    const first = queue.claimNext();
    if (!first?.currentAttemptId) throw new Error('expected lease token');
    queue.failStage({
      jobId,
      stage: STAGES[0],
      attemptId: first.currentAttemptId,
      errorCode: 'X',
      errorMsg: 'x',
      maxAttempts: 5,
    });
    // After failStage, current_attempt_id is cleared. Old attempt id is stale.
    const staleAttemptId = first.currentAttemptId;
    expect(() => queue.completeStage(jobId, STAGES[0], staleAttemptId)).toThrow(QueueError);
    expect(() =>
      queue.failStage({
        jobId,
        stage: STAGES[0],
        attemptId: staleAttemptId,
        errorCode: 'X',
        errorMsg: 'x',
      }),
    ).toThrow(QueueError);
  });

  it('records cost and sums it since a timestamp', () => {
    const runId = queue.startRun();
    queue.recordCost({
      runId,
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
    });
    queue.recordCost({
      runId,
      provider: 'google',
      model: 'gemini-embedding-2-preview',
      inputTokens: 200,
      costUsd: 0.0002,
    });
    const total = queue.costSince('2000-01-01T00:00:00.000Z');
    expect(total).toBeCloseTo(0.0012, 6);
  });

  it('stats reports per-status counts scoped to a run', () => {
    const runId = queue.startRun();
    queue.enqueue({
      runId,
      sourceId: 'src_a',
      sourceKind: 'bookmarks',
      idempotencyKey: 'a',
    });
    queue.enqueue({
      runId,
      sourceId: 'src_b',
      sourceKind: 'bookmarks',
      idempotencyKey: 'b',
    });
    const stats = queue.stats(runId);
    expect(stats.pending).toBe(2);
    expect(stats.done).toBe(0);
  });

  it('survives reopen — durable across createSqliteQueue calls', () => {
    const dbPath = path.join(dbDir, 'durable.sqlite');
    const q1 = createSqliteQueue(dbPath);
    const runId = q1.startRun();
    q1.enqueue({
      runId,
      sourceId: 'src_x',
      sourceKind: 'bookmarks',
      idempotencyKey: 'k',
    });
    q1.close();

    const q2 = createSqliteQueue(dbPath);
    const reopened = q2.listJobs({ runId });
    expect(reopened).toHaveLength(1);
    q2.close();
  });
});

describe('bookmark ledger', () => {
  it('upserts bookmarks idempotently', () => {
    const result1 = queue.upsertBookmark({
      entryId: 'tweet-1',
      tweetId: '1',
      source: 'bookmarks',
      sourceUrl: 'https://x.com/u/status/1',
      text: 'hello',
      author: 'u',
      urls: ['https://example.com'],
      capturedAt: '2026-01-01T00:00:00.000Z',
    });
    const result2 = queue.upsertBookmark({
      entryId: 'tweet-1',
      tweetId: '1',
      source: 'bookmarks',
      sourceUrl: 'https://x.com/u/status/1',
      text: 'changed',
      capturedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(result1).toBe('inserted');
    expect(result2).toBe('unchanged');
    const got = queue.getBookmark('tweet-1');
    expect(got?.text).toBe('hello');
    expect(got?.urls).toEqual(['https://example.com']);
  });

  it('lists bookmarks oldest-first by default and filters by status/source', () => {
    queue.upsertBookmark({
      entryId: 'a',
      tweetId: '1',
      source: 'bookmarks',
      sourceUrl: 'u1',
      text: 't1',
      capturedAt: '2026-01-01T00:00:00.000Z',
    });
    queue.upsertBookmark({
      entryId: 'b',
      tweetId: '2',
      source: 'bookmarks',
      sourceUrl: 'u2',
      text: 't2',
      capturedAt: '2026-01-03T00:00:00.000Z',
    });
    queue.upsertBookmark({
      entryId: 'c',
      tweetId: '3',
      source: 'likes',
      sourceUrl: 'u3',
      text: 't3',
      capturedAt: '2026-01-02T00:00:00.000Z',
    });

    const all = queue.listBookmarks();
    expect(all.map((b) => b.entryId)).toEqual(['a', 'c', 'b']);

    const newest = queue.listBookmarks({ order: 'newest' });
    expect(newest.map((b) => b.entryId)).toEqual(['b', 'c', 'a']);

    const onlyBookmarks = queue.listBookmarks({ source: 'bookmarks' });
    expect(onlyBookmarks.map((b) => b.entryId)).toEqual(['a', 'b']);

    queue.updateBookmark('a', { status: 'synced' });
    const stillNew = queue.listBookmarks({ status: 'new' });
    expect(stillNew.map((b) => b.entryId)).toEqual(['c', 'b']);

    expect(queue.listBookmarks({ limit: 1 }).map((b) => b.entryId)).toEqual(['a']);
  });

  it('updates only supplied fields, bumps attempts atomically', () => {
    queue.upsertBookmark({
      entryId: 'x',
      tweetId: '9',
      source: 'bookmarks',
      sourceUrl: 'u',
      text: 't',
      capturedAt: '2026-01-01T00:00:00.000Z',
    });
    const after = queue.updateBookmark('x', {
      status: 'failed',
      lastError: 'boom',
      runId: 'run_1',
      jobId: 'job_1',
      bumpAttempts: true,
    });
    expect(after.status).toBe('failed');
    expect(after.lastError).toBe('boom');
    expect(after.attempts).toBe(1);

    const second = queue.updateBookmark('x', { bumpAttempts: true });
    expect(second.attempts).toBe(2);
    expect(second.lastError).toBe('boom'); // not cleared
  });

  it('updateBookmark on a missing entry throws NOT_FOUND', () => {
    expect(() => queue.updateBookmark('missing', { status: 'synced' })).toThrowError(QueueError);
  });

  it('reports stats per status with optional source filter', () => {
    queue.upsertBookmark({
      entryId: 'a',
      tweetId: '1',
      source: 'bookmarks',
      sourceUrl: 'u',
      text: 't',
      capturedAt: '2026-01-01T00:00:00.000Z',
    });
    queue.upsertBookmark({
      entryId: 'b',
      tweetId: '2',
      source: 'likes',
      sourceUrl: 'u',
      text: 't',
      capturedAt: '2026-01-01T00:00:00.000Z',
    });
    queue.updateBookmark('a', { status: 'synced' });
    const all = queue.bookmarkStats();
    expect(all).toEqual({ total: 2, new: 1, synced: 1, failed: 0, skipped: 0 });
    const onlyLikes = queue.bookmarkStats({ source: 'likes' });
    expect(onlyLikes).toEqual({ total: 1, new: 1, synced: 0, failed: 0, skipped: 0 });
  });

  it('forward-migrates a v1 db onto v2 schema without losing jobs', () => {
    const dbPath = path.join(dbDir, 'v1-to-v2.sqlite');
    // Synthesize a v1 db: bootstrap the queue, then manually downgrade
    // PRAGMA user_version, drop the v2 table, and re-open.
    const seed = createSqliteQueue(dbPath);
    const runId = seed.startRun();
    seed.enqueue({
      runId,
      sourceId: 'src_1',
      sourceKind: 'bookmarks',
      idempotencyKey: 'k',
    });
    seed.close();

    // Simulate "this db was created by the v1 binary": drop the v2
    // bookmark table and reset user_version to 1.
    const raw = new Database(dbPath);
    raw.exec('DROP TABLE IF EXISTS bookmark_ledger;');
    raw.exec('PRAGMA user_version = 1;');
    raw.close();

    // Reopen via the production factory — should run the v2 migration.
    const upgraded = createSqliteQueue(dbPath);
    expect(upgraded.listJobs({ runId })).toHaveLength(1);
    expect(() =>
      upgraded.upsertBookmark({
        entryId: 'a',
        tweetId: '1',
        source: 'bookmarks',
        sourceUrl: 'u',
        text: 't',
        capturedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).not.toThrow();
    upgraded.close();
  });

  it('forward-migrates a v2 db onto v3 schema preserving existing rows', () => {
    const dbPath = path.join(dbDir, 'v2-to-v3.sqlite');
    // Bootstrap then synthesize v2 by dropping v3 columns. SQLite doesn't
    // support DROP COLUMN cross-version cleanly; rebuild the table without
    // them and reset user_version.
    const seed = createSqliteQueue(dbPath);
    seed.upsertBookmark({
      entryId: 'org-1',
      tweetId: '1',
      source: 'bookmarks',
      sourceUrl: 'https://x.com/u/status/1',
      text: 'organic tweet',
      capturedAt: '2026-01-01T00:00:00.000Z',
    });
    seed.close();

    const raw = new Database(dbPath);
    raw.exec('ALTER TABLE bookmark_ledger RENAME TO bookmark_ledger_v3;');
    raw.exec(`
      CREATE TABLE bookmark_ledger (
        entry_id    TEXT PRIMARY KEY,
        tweet_id    TEXT NOT NULL,
        source      TEXT NOT NULL CHECK (source IN ('bookmarks','likes','posts')),
        source_url  TEXT NOT NULL,
        author      TEXT,
        text        TEXT NOT NULL,
        urls_json   TEXT NOT NULL DEFAULT '[]',
        captured_at TEXT NOT NULL,
        tweet_created_at TEXT,
        status      TEXT NOT NULL CHECK (status IN ('new','synced','failed','skipped')) DEFAULT 'new',
        synced_at   TEXT,
        run_id      TEXT,
        job_id      TEXT,
        attempts    INTEGER NOT NULL DEFAULT 0,
        last_error  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      ) WITHOUT ROWID;
    `);
    raw.exec(`
      INSERT INTO bookmark_ledger
        (entry_id, tweet_id, source, source_url, author, text, urls_json,
         captured_at, tweet_created_at, status, synced_at, run_id, job_id,
         attempts, last_error, created_at, updated_at)
      SELECT entry_id, tweet_id, source, source_url, author, text, urls_json,
             captured_at, tweet_created_at, status, synced_at, run_id, job_id,
             attempts, last_error, created_at, updated_at
      FROM bookmark_ledger_v3;
    `);
    raw.exec('DROP TABLE bookmark_ledger_v3;');
    raw.exec('PRAGMA user_version = 2;');
    raw.close();

    const upgraded = createSqliteQueue(dbPath);
    const existing = upgraded.getBookmark('org-1');
    expect(existing).not.toBeNull();
    expect(existing?.sourceKind).toBe('organic');
    expect(existing?.parentEntryId).toBeNull();
    expect(existing?.textHash).toBeNull();
    expect(existing?.supersededAt).toBeNull();

    // New derived row insertion + parent_entry_id round-trip.
    upgraded.upsertBookmark({
      entryId: 'derived-1',
      tweetId: 'na',
      source: 'bookmarks',
      sourceUrl: 'https://example.com/article',
      text: '',
      capturedAt: '2026-01-02T00:00:00.000Z',
      parentEntryId: 'org-1',
      sourceKind: 'derived',
    });
    const derived = upgraded.getBookmark('derived-1');
    expect(derived?.parentEntryId).toBe('org-1');
    expect(derived?.sourceKind).toBe('derived');

    // findBookmarkBySourceUrl finds the derived row.
    const found = upgraded.findBookmarkBySourceUrl('https://example.com/article');
    expect(found?.entryId).toBe('derived-1');

    // markBookmarkSuperseded hides the row from non-superseded queries.
    upgraded.markBookmarkSuperseded('derived-1');
    expect(upgraded.findBookmarkBySourceUrl('https://example.com/article')).toBeNull();
    const includingSuperseded = upgraded.listBookmarks({ includeSuperseded: true });
    expect(includingSuperseded.find((b) => b.entryId === 'derived-1')?.supersededAt).not.toBeNull();
    upgraded.close();
  });
});
