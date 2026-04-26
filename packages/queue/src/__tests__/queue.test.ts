import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

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
      queue.completeStage(job.jobId, stage);
    }
    const final = queue.listJobs({ runId })[0];
    expect(final?.status).toBe('done');
    expect(queue.claimNext()).toBeNull();
  });

  it('failStage retries with backoff until maxAttempts then DLQs', () => {
    const runId = queue.startRun();
    const jobId = queue.enqueue({
      runId,
      sourceId: 'src_1',
      sourceKind: 'bookmarks',
      idempotencyKey: 'k',
    });
    const job = queue.claimNext();
    expect(job?.jobId).toBe(jobId);
    queue.failStage({
      jobId,
      stage: STAGES[0],
      errorCode: 'NETWORK',
      errorMsg: 'first fail',
      maxAttempts: 2,
    });
    let after = queue.listJobs({ runId })[0];
    expect(after?.status).toBe('pending');
    expect(after?.attempts).toBe(1);

    // Force the next_run_at gate by failing once more without waiting.
    // The claimNext won't pick it up because next_run_at is in the future,
    // but we simulate retry-via-failure by directly failing again at the
    // same stage from the recorded job.
    queue.failStage({
      jobId,
      stage: STAGES[0],
      errorCode: 'NETWORK',
      errorMsg: 'second fail',
      maxAttempts: 2,
    });
    after = queue.listJobs({ runId })[0];
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
    queue.claimNext();
    queue.failStage({ jobId, stage: STAGES[0], errorCode: 'X', errorMsg: 'x', maxAttempts: 1 });
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
    queue.claimNext();
    expect(() => queue.completeStage(jobId, STAGES[1])).toThrow(QueueError);
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
