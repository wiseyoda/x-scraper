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
