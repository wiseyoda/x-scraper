/**
 * Durable, idempotent job queue backed by SQLite.
 *
 * Design notes:
 *   - One row in `runs` per `xs sync` invocation; many `jobs` per run.
 *   - A job carries through all stages — claimNext() leases the next
 *     ready job, the caller runs the current stage, and completeStage()
 *     advances `current_stage` (or marks done at the last stage).
 *   - Idempotency: (run_id, source_id, idempotency_key) UNIQUE prevents
 *     re-enqueuing the same logical work. Within a stage, every attempt
 *     is recorded; the stage is considered complete once one attempt
 *     succeeds.
 *   - Failures: failStage() bumps attempts, sets next_run_at = now +
 *     backoff, and either keeps the job pending (retryable) or moves
 *     it to the DLQ once attempts >= maxAttempts.
 *   - Recovery: stale leases (status='running' but leased_at older than
 *     STALE_LEASE_MS) are reclaimable by the next claimNext() call.
 */

import * as crypto from 'node:crypto';

import type { Database as DatabaseType } from 'better-sqlite3';
import Database from 'better-sqlite3';

import {
  DEFAULT_BACKOFF_MULTIPLIER,
  DEFAULT_INITIAL_BACKOFF_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_BACKOFF_MS,
  type JobStatus,
  type Stage,
  STAGES,
  STALE_LEASE_MS,
} from './constants.js';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js';
import type { Job } from './types.js';
import { QueueError } from './types.js';

const RANDOM_BYTES_RUN = 8;
const RANDOM_BYTES_JOB = 6;
const RANDOM_BYTES_LEDGER = 4;

const newRunId = (): string => `run_${crypto.randomBytes(RANDOM_BYTES_RUN).toString('hex')}`;
const newJobId = (): string => `job_${crypto.randomBytes(RANDOM_BYTES_JOB).toString('hex')}`;
const newLedgerId = (): string => `cost_${crypto.randomBytes(RANDOM_BYTES_LEDGER).toString('hex')}`;

const isoNow = (): string => new Date().toISOString();

const stageIndex = (stage: Stage): number => STAGES.indexOf(stage);

const isLastStage = (stage: Stage): boolean => stageIndex(stage) === STAGES.length - 1;

const nextStage = (stage: Stage): Stage => {
  const idx = stageIndex(stage);
  if (idx < 0 || idx >= STAGES.length - 1) {
    throw new QueueError(`no stage after ${stage}`, 'STAGE_OUT_OF_ORDER');
  }
  const next = STAGES[idx + 1];
  if (next === undefined) {
    throw new QueueError(`no stage after ${stage}`, 'STAGE_OUT_OF_ORDER');
  }
  return next;
};

const computeBackoff = (
  attempts: number,
  initial = DEFAULT_INITIAL_BACKOFF_MS,
  max = DEFAULT_MAX_BACKOFF_MS,
): number => Math.min(initial * Math.pow(DEFAULT_BACKOFF_MULTIPLIER, attempts - 1), max);

interface JobRow {
  job_id: string;
  run_id: string;
  source_id: string;
  source_kind: string;
  idempotency_key: string;
  current_stage: Stage;
  status: JobStatus;
  attempts: number;
  next_run_at: string | null;
  last_error: string | null;
  leased_at: string | null;
  created_at: string;
  updated_at: string;
}

const rowToJob = (r: JobRow): Job => ({
  jobId: r.job_id,
  runId: r.run_id,
  sourceId: r.source_id,
  sourceKind: r.source_kind,
  idempotencyKey: r.idempotency_key,
  currentStage: r.current_stage,
  status: r.status,
  attempts: r.attempts,
  nextRunAt: r.next_run_at,
  lastError: r.last_error,
  leasedAt: r.leased_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface EnqueueInput {
  runId: string;
  sourceId: string;
  sourceKind: string;
  idempotencyKey: string;
  startStage?: Stage;
}

export interface FailInput {
  jobId: string;
  stage: Stage;
  errorCode: string;
  errorMsg: string;
  maxAttempts?: number;
}

export interface CostInput {
  runId?: string;
  jobId?: string;
  stage?: Stage;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
  costUsd?: number;
}

export interface QueueStats {
  pending: number;
  running: number;
  done: number;
  failed: number;
  dead: number;
}

export interface JobQueue {
  startRun: () => string;
  finishRun: (runId: string, status?: JobStatus) => void;
  enqueue: (input: EnqueueInput) => string;
  claimNext: () => Job | null;
  completeStage: (jobId: string, stage: Stage) => Job;
  failStage: (input: FailInput) => Job;
  retryFailed: (jobId: string) => Job;
  listJobs: (filter?: { runId?: string; status?: JobStatus }) => Job[];
  listDlq: () => Job[];
  recordCost: (cost: CostInput) => string;
  costSince: (sinceIso: string) => number;
  stats: (runId?: string) => QueueStats;
  close: () => void;
}

const ensureSchema = (db: DatabaseType): void => {
  db.exec(SCHEMA_SQL);
  const versionRow = db.prepare('PRAGMA user_version').get() as
    | { user_version: number }
    | undefined;
  const current = versionRow?.user_version ?? 0;
  if (current === 0) {
    db.exec(`PRAGMA user_version = ${String(SCHEMA_VERSION)};`);
  } else if (current !== SCHEMA_VERSION) {
    throw new QueueError(
      `schema version mismatch: db=${String(current)} expected=${String(SCHEMA_VERSION)}`,
      'SCHEMA_MIGRATE',
    );
  }
};

export const createSqliteQueue = (dbPath: string): JobQueue => {
  const db = new Database(dbPath);
  ensureSchema(db);

  const stmts = {
    insertRun: db.prepare(`INSERT INTO runs (run_id, started_at, status) VALUES (?, ?, 'running')`),
    finishRun: db.prepare(`UPDATE runs SET finished_at = ?, status = ? WHERE run_id = ?`),
    insertJob: db.prepare(
      `INSERT INTO jobs (
         job_id, run_id, source_id, source_kind, idempotency_key,
         current_stage, status, attempts, next_run_at, last_error,
         leased_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, NULL, ?, ?)
       ON CONFLICT (run_id, source_id, idempotency_key) DO NOTHING`,
    ),
    findExisting: db.prepare(
      `SELECT * FROM jobs WHERE run_id = ? AND source_id = ? AND idempotency_key = ?`,
    ),
    claimReady: db.prepare(
      `SELECT * FROM jobs
       WHERE (status = 'pending' AND (next_run_at IS NULL OR next_run_at <= ?))
          OR (status = 'running' AND leased_at IS NOT NULL AND leased_at < ?)
       ORDER BY created_at ASC LIMIT 1`,
    ),
    leaseJob: db.prepare(
      `UPDATE jobs SET status = 'running', leased_at = ?, updated_at = ?
       WHERE job_id = ? AND status IN ('pending','running')`,
    ),
    advanceStage: db.prepare(
      `UPDATE jobs SET current_stage = ?, status = 'pending', leased_at = NULL,
         attempts = 0, last_error = NULL, next_run_at = NULL, updated_at = ?
       WHERE job_id = ?`,
    ),
    markDone: db.prepare(
      `UPDATE jobs SET status = 'done', leased_at = NULL, updated_at = ? WHERE job_id = ?`,
    ),
    markFailed: db.prepare(
      `UPDATE jobs SET status = ?, attempts = attempts + 1,
         next_run_at = ?, last_error = ?, leased_at = NULL, updated_at = ?
       WHERE job_id = ?`,
    ),
    resetAttempts: db.prepare(`UPDATE jobs SET attempts = 0 WHERE job_id = ?`),
    insertAttempt: db.prepare(
      `INSERT INTO attempts (job_id, stage, started_at, status) VALUES (?, ?, ?, 'running')`,
    ),
    finishAttempt: db.prepare(
      `UPDATE attempts SET finished_at = ?, status = ?, error_code = ?, error_msg = ?
       WHERE attempt_id = (SELECT attempt_id FROM attempts WHERE job_id = ? AND stage = ?
                           ORDER BY attempt_id DESC LIMIT 1)`,
    ),
    insertDlq: db.prepare(
      `INSERT INTO dlq (job_id, stage, error_code, error_msg, added_at) VALUES (?, ?, ?, ?, ?)`,
    ),
    deleteDlq: db.prepare(`DELETE FROM dlq WHERE job_id = ?`),
    selectJob: db.prepare(`SELECT * FROM jobs WHERE job_id = ?`),
    listAll: db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC`),
    listByRun: db.prepare(`SELECT * FROM jobs WHERE run_id = ? ORDER BY created_at DESC`),
    listByStatus: db.prepare(`SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC`),
    listByRunStatus: db.prepare(
      `SELECT * FROM jobs WHERE run_id = ? AND status = ? ORDER BY created_at DESC`,
    ),
    listDlqJobs: db.prepare(
      `SELECT j.* FROM jobs j JOIN dlq d ON d.job_id = j.job_id ORDER BY d.added_at DESC`,
    ),
    insertCost: db.prepare(
      `INSERT INTO cost_ledger (
         recorded_at, run_id, job_id, stage, provider, model,
         input_tokens, output_tokens, cache_read_tokens, cache_create_tokens, cost_usd
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    sumCostSince: db.prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM cost_ledger WHERE recorded_at >= ?`,
    ),
    statsAll: db.prepare(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`),
    statsByRun: db.prepare(
      `SELECT status, COUNT(*) AS n FROM jobs WHERE run_id = ? GROUP BY status`,
    ),
  };

  const queryJob = (id: string): JobRow | undefined =>
    stmts.selectJob.get(id) as JobRow | undefined;
  const queryRows = <T>(rows: unknown): T[] => rows as T[];

  const startRun = (): string => {
    const runId = newRunId();
    stmts.insertRun.run(runId, isoNow());
    return runId;
  };

  const finishRun = (runId: string, status: JobStatus = 'done'): void => {
    stmts.finishRun.run(isoNow(), status, runId);
  };

  const enqueue = (input: EnqueueInput): string => {
    const startStage: Stage = input.startStage ?? STAGES[0];
    const jobId = newJobId();
    const now = isoNow();
    stmts.insertJob.run(
      jobId,
      input.runId,
      input.sourceId,
      input.sourceKind,
      input.idempotencyKey,
      startStage,
      now,
      now,
    );
    const existing = stmts.findExisting.get(input.runId, input.sourceId, input.idempotencyKey) as
      | JobRow
      | undefined;
    if (!existing) {
      throw new QueueError('failed to enqueue job', 'INVALID_STATE');
    }
    return existing.job_id;
  };

  const claimNext = (): Job | null => {
    const now = isoNow();
    const staleCutoff = new Date(Date.now() - STALE_LEASE_MS).toISOString();
    const txn = db.transaction((): JobRow | null => {
      const row = stmts.claimReady.get(now, staleCutoff) as JobRow | undefined;
      if (!row) return null;
      stmts.leaseJob.run(now, now, row.job_id);
      stmts.insertAttempt.run(row.job_id, row.current_stage, now);
      const fresh = queryJob(row.job_id);
      if (!fresh) throw new QueueError('job vanished after claim', 'INVALID_STATE');
      return fresh;
    });
    const result = txn();
    return result === null ? null : rowToJob(result);
  };

  const completeStage = (jobId: string, stage: Stage): Job => {
    const now = isoNow();
    const txn = db.transaction((): JobRow => {
      const job = queryJob(jobId);
      if (!job) throw new QueueError(`job not found: ${jobId}`, 'NOT_FOUND');
      if (job.current_stage !== stage) {
        throw new QueueError(
          `stage mismatch: job at ${job.current_stage}, completing ${stage}`,
          'STAGE_OUT_OF_ORDER',
        );
      }
      stmts.finishAttempt.run(now, 'done', null, null, jobId, stage);
      if (isLastStage(stage)) {
        stmts.markDone.run(now, jobId);
      } else {
        stmts.advanceStage.run(nextStage(stage), now, jobId);
      }
      const fresh = queryJob(jobId);
      if (!fresh) throw new QueueError('job vanished after complete', 'INVALID_STATE');
      return fresh;
    });
    return rowToJob(txn());
  };

  const failStage = (input: FailInput): Job => {
    const now = isoNow();
    const max = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const txn = db.transaction((): JobRow => {
      const job = queryJob(input.jobId);
      if (!job) throw new QueueError(`job not found: ${input.jobId}`, 'NOT_FOUND');
      stmts.finishAttempt.run(
        now,
        'failed',
        input.errorCode,
        input.errorMsg,
        input.jobId,
        input.stage,
      );
      const newAttempts = job.attempts + 1;
      if (newAttempts >= max) {
        stmts.markFailed.run('dead', null, input.errorMsg, now, input.jobId);
        stmts.insertDlq.run(input.jobId, input.stage, input.errorCode, input.errorMsg, now);
      } else {
        const backoff = computeBackoff(newAttempts);
        const nextRunAt = new Date(Date.now() + backoff).toISOString();
        stmts.markFailed.run('pending', nextRunAt, input.errorMsg, now, input.jobId);
      }
      const fresh = queryJob(input.jobId);
      if (!fresh) throw new QueueError('job vanished after fail', 'INVALID_STATE');
      return fresh;
    });
    return rowToJob(txn());
  };

  const retryFailed = (jobId: string): Job => {
    const now = isoNow();
    const txn = db.transaction((): JobRow => {
      const job = queryJob(jobId);
      if (!job) throw new QueueError(`job not found: ${jobId}`, 'NOT_FOUND');
      if (job.status !== 'dead' && job.status !== 'failed') {
        throw new QueueError(`cannot retry job in status ${job.status}`, 'INVALID_STATE');
      }
      stmts.deleteDlq.run(jobId);
      stmts.markFailed.run('pending', null, null, now, jobId);
      stmts.resetAttempts.run(jobId);
      const fresh = queryJob(jobId);
      if (!fresh) throw new QueueError('job vanished after retry', 'INVALID_STATE');
      return fresh;
    });
    return rowToJob(txn());
  };

  const listJobs = (filter: { runId?: string; status?: JobStatus } = {}): Job[] => {
    if (filter.runId !== undefined && filter.status !== undefined) {
      return queryRows<JobRow>(stmts.listByRunStatus.all(filter.runId, filter.status)).map(
        rowToJob,
      );
    }
    if (filter.runId !== undefined) {
      return queryRows<JobRow>(stmts.listByRun.all(filter.runId)).map(rowToJob);
    }
    if (filter.status !== undefined) {
      return queryRows<JobRow>(stmts.listByStatus.all(filter.status)).map(rowToJob);
    }
    return queryRows<JobRow>(stmts.listAll.all()).map(rowToJob);
  };

  const listDlq = (): Job[] => queryRows<JobRow>(stmts.listDlqJobs.all()).map(rowToJob);

  const recordCost = (cost: CostInput): string => {
    const ledgerId = newLedgerId();
    void ledgerId; // kept for symmetry with id-prefixed records elsewhere
    stmts.insertCost.run(
      isoNow(),
      cost.runId ?? null,
      cost.jobId ?? null,
      cost.stage ?? null,
      cost.provider,
      cost.model,
      cost.inputTokens ?? 0,
      cost.outputTokens ?? 0,
      cost.cacheReadTokens ?? 0,
      cost.cacheCreateTokens ?? 0,
      cost.costUsd ?? 0,
    );
    return ledgerId;
  };

  const costSince = (sinceIso: string): number => {
    const row = stmts.sumCostSince.get(sinceIso) as { total: number | null } | undefined;
    return row?.total ?? 0;
  };

  const stats = (runId?: string): QueueStats => {
    const out: QueueStats = { pending: 0, running: 0, done: 0, failed: 0, dead: 0 };
    const rows = (runId !== undefined ? stmts.statsByRun.all(runId) : stmts.statsAll.all()) as {
      status: JobStatus;
      n: number;
    }[];
    for (const r of rows) out[r.status] = r.n;
    return out;
  };

  const close = (): void => {
    db.close();
  };

  return {
    startRun,
    finishRun,
    enqueue,
    claimNext,
    completeStage,
    failStage,
    retryFailed,
    listJobs,
    listDlq,
    recordCost,
    costSince,
    stats,
    close,
  };
};
