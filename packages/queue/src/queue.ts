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
import { MIGRATIONS, SCHEMA_SQL, SCHEMA_VERSION } from './schema.js';
import type {
  BookmarkEntry,
  BookmarkKind,
  BookmarkLedgerStats,
  BookmarkListFilter,
  BookmarkSource,
  BookmarkStatus,
  BookmarkUpdateFields,
  BookmarkUpsertInput,
  Job,
} from './types.js';
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
  current_attempt_id: number | null;
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
  currentAttemptId: r.current_attempt_id,
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
  attemptId: number;
  errorCode: string;
  errorMsg: string;
  maxAttempts?: number;
}

export interface CostInput {
  runId?: string;
  jobId?: string;
  /** Originating bookmark_ledger.entry_id (T22). */
  entryId?: string;
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
  /** Claim the next ready job. Optionally restrict to one runId, which is
   *  what `xs sync` uses so a new run can't accidentally pick up a stale
   *  pending job from a prior run and fail it as UNKNOWN_SOURCE. */
  claimNext: (filter?: { runId?: string }) => Job | null;
  completeStage: (jobId: string, stage: Stage, attemptId: number) => Job;
  /** Mark every remaining stage as completed in one shot and finish the
   *  job. Used when the dispatcher runs all stages back-to-back under a
   *  single lease, to avoid the inter-stage re-claim race. */
  completeAllStages: (jobId: string, attemptId: number) => Job;
  failStage: (input: FailInput) => Job;
  retryFailed: (jobId: string) => Job;
  listJobs: (filter?: { runId?: string; status?: JobStatus }) => Job[];
  listDlq: () => Job[];
  recordCost: (cost: CostInput) => string;
  costSince: (sinceIso: string) => number;
  /** Top-N (entry_id, total cost since) tuples. NULL entry_ids excluded. */
  costByEntry: (sinceIso: string, limit: number) => { entryId: string; totalUsd: number }[];
  stats: (runId?: string) => QueueStats;
  /**
   * Upsert a bookmark into the ledger. Idempotent on entry_id — re-pulling
   * the same entry is a no-op (status/synced_at preserved). Used by
   * `xs bookmarks pull`.
   */
  upsertBookmark: (input: BookmarkUpsertInput) => 'inserted' | 'unchanged';
  /** List bookmarks ordered by captured_at; defaults to oldest-first new. */
  listBookmarks: (filter?: BookmarkListFilter) => BookmarkEntry[];
  /** Look up a single ledger entry. */
  getBookmark: (entryId: string) => BookmarkEntry | null;
  /**
   * Look up a single non-superseded ledger entry by canonical source URL.
   * Used by hard auto-expand to dedupe discovered URLs against any prior
   * pull (organic or derived) before enqueuing a new derived row.
   */
  findBookmarkBySourceUrl: (sourceUrl: string) => BookmarkEntry | null;
  /** Mark a ledger row superseded (used by edit-detection on re-pull). */
  markBookmarkSuperseded: (entryId: string) => void;
  /**
   * Find the latest non-superseded ledger row for a given tweet_id, plus
   * the total count of versions in the chain. Used by edit-detection on
   * re-pull so a second edit supersedes the latest version (not the
   * original) and gets a non-colliding _vN suffix.
   */
  bookmarkChainStatus: (tweetId: string) => {
    current: BookmarkEntry | null;
    totalVersions: number;
  };
  /**
   * Update mutable status/error fields on a ledger row. `updated_at` is
   * always refreshed; pass `bumpAttempts:true` to atomically increment
   * the attempts counter.
   */
  updateBookmark: (entryId: string, fields: BookmarkUpdateFields) => BookmarkEntry;
  /** Aggregate counts by status. */
  bookmarkStats: (filter?: { source?: BookmarkSource }) => BookmarkLedgerStats;
  close: () => void;
}

/**
 * Walk a db to SCHEMA_VERSION. Two paths:
 *
 *   • Fresh db (user_version=0): apply SCHEMA_SQL bootstrap directly —
 *     it's at the latest shape, stamp the version and return.
 *   • Existing db (user_version > 0): walk forward through MIGRATIONS,
 *     each of which is responsible for the ALTER/CREATE statements its
 *     version needs. SCHEMA_SQL is NOT applied to existing dbs because
 *     it can reference columns added by a later migration (e.g. a
 *     CREATE INDEX on a v3 column would fail on a v2 db before its
 *     migration runs). After the walk, idempotent SCHEMA_SQL is safe to
 *     re-apply for drift recovery.
 *
 * A db ahead of SCHEMA_VERSION is a downgrade and is rejected — running
 * an older binary against a newer db would silently break invariants
 * the newer code expects.
 */
const ALTER_ADD_COLUMN_RE = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)\b/i;

/**
 * Error codes that won't get better on retry. failStage short-circuits
 * to dead instead of scheduling a retry. Saves the backoff window
 * (~90s on a 3-attempt run) per permanently-broken source.
 *
 * - PARSE: Readability returned null, JSON parse failed, etc — input
 *   shape is wrong, not transient.
 * - DIM_MISMATCH: embedding dims wrong, won't change.
 * - INVALID_INPUT: caller bug, not transient.
 * - INVALID_FRONTMATTER: vault validation failed.
 * - SCHEMA: graph init wasn't run.
 * - STAGE_OUT_OF_ORDER: dispatcher bug.
 *
 * Things NOT in this list (transient, retried): network errors, rate
 * limits, provider 5xx, lease conflicts.
 */
const PERMANENT_ERROR_CODES = new Set<string>([
  'PARSE',
  'DIM_MISMATCH',
  'INVALID_INPUT',
  'INVALID_FRONTMATTER',
  'SCHEMA',
  'STAGE_OUT_OF_ORDER',
]);

const columnExists = (db: DatabaseType, table: string, column: string): boolean => {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
};

// Strip SQL line comments (-- ... newline) before splitting on `;` so a
// semicolon inside a comment doesn't fragment a statement. Block
// comments (/* ... */) aren't currently used in our migrations.
const stripSqlLineComments = (sql: string): string =>
  sql
    .split('\n')
    .map((line) => {
      // Keep the line if it has no `--` outside of string literals. We
      // don't currently embed `--` inside strings in any migration; the
      // simple pre-trim check is fine.
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');

const runMigration = (db: DatabaseType, migration: string): void => {
  const cleaned = stripSqlLineComments(migration);
  const stmts = cleaned
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of stmts) {
    const m = ALTER_ADD_COLUMN_RE.exec(stmt);
    if (m !== null) {
      const table = m[1];
      const column = m[2];
      if (table !== undefined && column !== undefined && columnExists(db, table, column)) {
        continue;
      }
    }
    db.exec(stmt);
  }
};

const ensureSchema = (db: DatabaseType): void => {
  // Per-connection pragmas first so they apply regardless of branch.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  const versionRow = db.prepare('PRAGMA user_version').get() as
    | { user_version: number }
    | undefined;
  let current = versionRow?.user_version ?? 0;
  if (current === 0) {
    // Fresh bootstrap: SCHEMA_SQL is at the latest shape.
    db.exec(SCHEMA_SQL);
    db.exec(`PRAGMA user_version = ${String(SCHEMA_VERSION)};`);
    return;
  }
  if (current > SCHEMA_VERSION) {
    throw new QueueError(
      `schema version ahead of binary: db=${String(current)} binary=${String(SCHEMA_VERSION)}`,
      'SCHEMA_MIGRATE',
    );
  }
  while (current < SCHEMA_VERSION) {
    const next = current + 1;
    const migration = MIGRATIONS[next];
    if (migration === undefined) {
      throw new QueueError(`no migration defined for v${String(next)}`, 'SCHEMA_MIGRATE');
    }
    // Skip ALTER TABLE statements when the column already exists. Tests
    // that synthesize older schemas from the latest bootstrap (then
    // PRAGMA user_version downgrade) sometimes have a forward-looking
    // column already present — running ALTER would throw 'duplicate
    // column'. Production paths from a real older binary don't hit
    // this. Only ALTER TABLE ADD COLUMN gets the guard; everything
    // else runs as-is.
    runMigration(db, migration);
    db.exec(`PRAGMA user_version = ${String(next)};`);
    current = next;
  }
  // After migrations land, run SCHEMA_SQL to catch any drift (e.g. a
  // missed index in a hand-edited db). All statements are CREATE IF
  // NOT EXISTS so this is a no-op when migrations did the right thing.
  db.exec(SCHEMA_SQL);
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
         leased_at, current_attempt_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?)
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
    claimReadyForRun: db.prepare(
      `SELECT * FROM jobs
       WHERE run_id = ?
         AND ((status = 'pending' AND (next_run_at IS NULL OR next_run_at <= ?))
           OR (status = 'running' AND leased_at IS NOT NULL AND leased_at < ?))
       ORDER BY created_at ASC LIMIT 1`,
    ),
    leaseJob: db.prepare(
      `UPDATE jobs SET status = 'running', leased_at = ?, current_attempt_id = ?, updated_at = ?
       WHERE job_id = ? AND status IN ('pending','running')`,
    ),
    advanceStage: db.prepare(
      `UPDATE jobs SET current_stage = ?, status = 'pending', leased_at = NULL,
         current_attempt_id = NULL,
         attempts = 0, last_error = NULL, next_run_at = NULL, updated_at = ?
       WHERE job_id = ?`,
    ),
    markDone: db.prepare(
      `UPDATE jobs SET status = 'done', leased_at = NULL, current_attempt_id = NULL,
         attempts = 0, next_run_at = NULL, last_error = NULL, updated_at = ?
       WHERE job_id = ?`,
    ),
    markFailed: db.prepare(
      `UPDATE jobs SET status = ?, attempts = attempts + 1,
         next_run_at = ?, last_error = ?, leased_at = NULL, current_attempt_id = NULL,
         updated_at = ?
       WHERE job_id = ?`,
    ),
    resetAttempts: db.prepare(`UPDATE jobs SET attempts = 0 WHERE job_id = ?`),
    insertAttempt: db.prepare(
      `INSERT INTO attempts (job_id, stage, started_at, status) VALUES (?, ?, ?, 'running')`,
    ),
    finishAttemptById: db.prepare(
      `UPDATE attempts SET finished_at = ?, status = ?, error_code = ?, error_msg = ?
       WHERE attempt_id = ? AND status = 'running'`,
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
         ledger_id, recorded_at, run_id, job_id, entry_id, stage, provider, model,
         input_tokens, output_tokens, cache_read_tokens, cache_create_tokens, cost_usd
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    sumCostSince: db.prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM cost_ledger WHERE recorded_at >= ?`,
    ),
    statsAll: db.prepare(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`),
    statsByRun: db.prepare(
      `SELECT status, COUNT(*) AS n FROM jobs WHERE run_id = ? GROUP BY status`,
    ),
    // Bookmark ledger statements. Insert is idempotent on entry_id; we
    // never overwrite a row that's already been processed because that
    // would clobber the status/synced_at audit trail.
    insertBookmark: db.prepare(
      `INSERT INTO bookmark_ledger (
         entry_id, tweet_id, source, source_url, author, text, urls_json,
         captured_at, tweet_created_at, status, attempts, created_at, updated_at,
         parent_entry_id, source_kind, text_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 0, ?, ?, ?, ?, ?)
       ON CONFLICT(entry_id) DO NOTHING`,
    ),
    selectBookmark: db.prepare(`SELECT * FROM bookmark_ledger WHERE entry_id = ?`),
    selectBookmarkBySourceUrl: db.prepare(
      `SELECT * FROM bookmark_ledger WHERE source_url = ? AND superseded_at IS NULL LIMIT 1`,
    ),
    markSuperseded: db.prepare(
      `UPDATE bookmark_ledger SET superseded_at = ?, updated_at = ? WHERE entry_id = ?`,
    ),
    // Order by tweet_created_at when known (so "oldest" means oldest tweet,
    // not oldest pull batch); fall back to captured_at for rows without
    // a parseable created_at.
    listBookmarksAll: db.prepare(
      `SELECT * FROM bookmark_ledger ORDER BY COALESCE(tweet_created_at, captured_at) ASC`,
    ),
    listBookmarksAllDesc: db.prepare(
      `SELECT * FROM bookmark_ledger ORDER BY COALESCE(tweet_created_at, captured_at) DESC`,
    ),
    listBookmarksByStatus: db.prepare(
      `SELECT * FROM bookmark_ledger WHERE status = ? ORDER BY COALESCE(tweet_created_at, captured_at) ASC`,
    ),
    listBookmarksByStatusDesc: db.prepare(
      `SELECT * FROM bookmark_ledger WHERE status = ? ORDER BY COALESCE(tweet_created_at, captured_at) DESC`,
    ),
    listBookmarksBySource: db.prepare(
      `SELECT * FROM bookmark_ledger WHERE source = ? ORDER BY COALESCE(tweet_created_at, captured_at) ASC`,
    ),
    listBookmarksBySourceDesc: db.prepare(
      `SELECT * FROM bookmark_ledger WHERE source = ? ORDER BY COALESCE(tweet_created_at, captured_at) DESC`,
    ),
    listBookmarksBySourceStatus: db.prepare(
      `SELECT * FROM bookmark_ledger WHERE source = ? AND status = ? ORDER BY COALESCE(tweet_created_at, captured_at) ASC`,
    ),
    listBookmarksBySourceStatusDesc: db.prepare(
      `SELECT * FROM bookmark_ledger WHERE source = ? AND status = ? ORDER BY COALESCE(tweet_created_at, captured_at) DESC`,
    ),
    bookmarkStatsAll: db.prepare(
      `SELECT status, COUNT(*) AS n FROM bookmark_ledger GROUP BY status`,
    ),
    bookmarkStatsBySource: db.prepare(
      `SELECT status, COUNT(*) AS n FROM bookmark_ledger WHERE source = ? GROUP BY status`,
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

  const claimNext = (filter: { runId?: string } = {}): Job | null => {
    const now = isoNow();
    const staleCutoff = new Date(Date.now() - STALE_LEASE_MS).toISOString();
    const txn = db.transaction((): JobRow | null => {
      const row =
        filter.runId === undefined
          ? (stmts.claimReady.get(now, staleCutoff) as JobRow | undefined)
          : (stmts.claimReadyForRun.get(filter.runId, now, staleCutoff) as JobRow | undefined);
      if (!row) return null;
      const result = stmts.insertAttempt.run(row.job_id, row.current_stage, now);
      const attemptId = Number(result.lastInsertRowid);
      stmts.leaseJob.run(now, attemptId, now, row.job_id);
      const fresh = queryJob(row.job_id);
      if (!fresh) throw new QueueError('job vanished after claim', 'INVALID_STATE');
      return fresh;
    });
    const result = txn();
    return result === null ? null : rowToJob(result);
  };

  const assertOwnsLease = (job: JobRow, attemptId: number, callsite: string): void => {
    if (job.current_attempt_id !== attemptId) {
      throw new QueueError(
        `stale lease at ${callsite}: job ${job.job_id} active attempt is ${String(job.current_attempt_id)}, caller has ${String(attemptId)}`,
        'STALE_LEASE',
      );
    }
  };

  const completeStage = (jobId: string, stage: Stage, attemptId: number): Job => {
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
      assertOwnsLease(job, attemptId, 'completeStage');
      const updated = stmts.finishAttemptById.run(now, 'done', null, null, attemptId);
      if (updated.changes === 0) {
        throw new QueueError(
          `attempt ${String(attemptId)} not running; cannot complete`,
          'STALE_LEASE',
        );
      }
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

  /**
   * Mark every remaining stage as completed in one shot. Used by the
   * `xs sync` dispatcher, which runs all stages back-to-back under a
   * single lease — splitting the completion across N round-trips would
   * release the lease between stages and let an unrelated job race in.
   */
  const completeAllStages = (jobId: string, attemptId: number): Job => {
    const now = isoNow();
    const txn = db.transaction((): JobRow => {
      const job = queryJob(jobId);
      if (!job) throw new QueueError(`job not found: ${jobId}`, 'NOT_FOUND');
      assertOwnsLease(job, attemptId, 'completeAllStages');
      const updated = stmts.finishAttemptById.run(now, 'done', null, null, attemptId);
      if (updated.changes === 0) {
        throw new QueueError(
          `attempt ${String(attemptId)} not running; cannot complete`,
          'STALE_LEASE',
        );
      }
      stmts.markDone.run(now, jobId);
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
      assertOwnsLease(job, input.attemptId, 'failStage');
      const updated = stmts.finishAttemptById.run(
        now,
        'failed',
        input.errorCode,
        input.errorMsg,
        input.attemptId,
      );
      if (updated.changes === 0) {
        throw new QueueError(
          `attempt ${String(input.attemptId)} not running; cannot fail`,
          'STALE_LEASE',
        );
      }
      const newAttempts = job.attempts + 1;
      // Permanent errors (parse failures, dim mismatches, schema bugs)
      // will fail the same way on every retry — skip the backoff and go
      // straight to dead so a single bad URL doesn't burn 90s of waits.
      const isPermanent = PERMANENT_ERROR_CODES.has(input.errorCode);
      if (isPermanent || newAttempts >= max) {
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
    stmts.insertCost.run(
      ledgerId,
      isoNow(),
      cost.runId ?? null,
      cost.jobId ?? null,
      cost.entryId ?? null,
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

  const costByEntry = (
    sinceIso: string,
    limit: number,
  ): { entryId: string; totalUsd: number }[] => {
    const rows = db
      .prepare(
        `SELECT entry_id AS entryId, SUM(cost_usd) AS totalUsd
         FROM cost_ledger
         WHERE entry_id IS NOT NULL AND recorded_at >= ?
         GROUP BY entry_id
         ORDER BY totalUsd DESC
         LIMIT ?`,
      )
      .all(sinceIso, limit) as { entryId: string; totalUsd: number }[];
    return rows;
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

  // ─── Bookmark ledger ────────────────────────────────────────────────
  interface BookmarkRow {
    entry_id: string;
    tweet_id: string;
    source: BookmarkSource;
    source_url: string;
    author: string | null;
    text: string;
    urls_json: string;
    captured_at: string;
    tweet_created_at: string | null;
    status: BookmarkStatus;
    synced_at: string | null;
    run_id: string | null;
    job_id: string | null;
    attempts: number;
    last_error: string | null;
    created_at: string;
    updated_at: string;
    parent_entry_id: string | null;
    source_kind: BookmarkKind;
    text_hash: string | null;
    superseded_at: string | null;
  }

  const parseUrls = (json: string): string[] => {
    try {
      const parsed: unknown = JSON.parse(json);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((v): v is string => typeof v === 'string');
    } catch {
      return [];
    }
  };

  const rowToBookmark = (r: BookmarkRow): BookmarkEntry => ({
    entryId: r.entry_id,
    tweetId: r.tweet_id,
    source: r.source,
    sourceUrl: r.source_url,
    author: r.author,
    text: r.text,
    urls: parseUrls(r.urls_json),
    capturedAt: r.captured_at,
    tweetCreatedAt: r.tweet_created_at,
    status: r.status,
    syncedAt: r.synced_at,
    runId: r.run_id,
    jobId: r.job_id,
    attempts: r.attempts,
    lastError: r.last_error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    parentEntryId: r.parent_entry_id,
    sourceKind: r.source_kind,
    textHash: r.text_hash,
    supersededAt: r.superseded_at,
  });

  const upsertBookmark = (input: BookmarkUpsertInput): 'inserted' | 'unchanged' => {
    const now = isoNow();
    const result = stmts.insertBookmark.run(
      input.entryId,
      input.tweetId,
      input.source,
      input.sourceUrl,
      input.author ?? null,
      input.text,
      JSON.stringify(input.urls ?? []),
      input.capturedAt,
      input.tweetCreatedAt ?? null,
      now,
      now,
      input.parentEntryId ?? null,
      input.sourceKind ?? 'organic',
      input.textHash ?? null,
    );
    return result.changes > 0 ? 'inserted' : 'unchanged';
  };

  const findBookmarkBySourceUrl = (sourceUrl: string): BookmarkEntry | null => {
    const row = stmts.selectBookmarkBySourceUrl.get(sourceUrl) as BookmarkRow | undefined;
    return row === undefined ? null : rowToBookmark(row);
  };

  const markBookmarkSuperseded = (entryId: string): void => {
    const now = isoNow();
    stmts.markSuperseded.run(now, now, entryId);
  };

  const bookmarkChainStatus = (
    tweetId: string,
  ): { current: BookmarkEntry | null; totalVersions: number } => {
    const rows = db
      .prepare(
        `SELECT * FROM bookmark_ledger WHERE tweet_id = ? ORDER BY captured_at ASC`,
      )
      .all(tweetId) as BookmarkRow[];
    if (rows.length === 0) {
      return { current: null, totalVersions: 0 };
    }
    const current = rows.find((r) => r.superseded_at === null);
    return {
      current: current === undefined ? null : rowToBookmark(current),
      totalVersions: rows.length,
    };
  };

  const listBookmarks = (filter: BookmarkListFilter = {}): BookmarkEntry[] => {
    const order = filter.order ?? 'oldest';
    const desc = order === 'newest';
    const includeSuperseded = filter.includeSuperseded === true;
    // Build the SQL dynamically. Compound filters (status × source × kind ×
    // includeSuperseded) make the prepared-statement matrix hard to maintain;
    // sqlite query plan caches generated SQL so the cost is amortized.
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.status !== undefined) {
      where.push('status = ?');
      args.push(filter.status);
    }
    if (filter.source !== undefined) {
      where.push('source = ?');
      args.push(filter.source);
    }
    if (filter.sourceKind !== undefined) {
      where.push('source_kind = ?');
      args.push(filter.sourceKind);
    }
    if (!includeSuperseded) {
      where.push('superseded_at IS NULL');
    }
    const whereSql = where.length === 0 ? '' : ` WHERE ${where.join(' AND ')}`;
    const orderSql = ` ORDER BY COALESCE(tweet_created_at, captured_at) ${desc ? 'DESC' : 'ASC'}`;
    const limitSql = filter.limit === undefined ? '' : ` LIMIT ${String(filter.limit)}`;
    const sql = `SELECT * FROM bookmark_ledger${whereSql}${orderSql}${limitSql}`;
    const rows = db.prepare(sql).all(...args) as BookmarkRow[];
    return rows.map(rowToBookmark);
  };

  const getBookmark = (entryId: string): BookmarkEntry | null => {
    const row = stmts.selectBookmark.get(entryId) as BookmarkRow | undefined;
    return row === undefined ? null : rowToBookmark(row);
  };

  /**
   * Build the UPDATE SQL dynamically — only fields the caller supplied
   * are written. Keeps every other column intact, including the audit
   * fields like attempts and synced_at when not explicitly cleared.
   */
  const updateBookmark = (entryId: string, fields: BookmarkUpdateFields): BookmarkEntry => {
    const sets: string[] = [];
    const args: unknown[] = [];
    if (fields.status !== undefined) {
      sets.push('status = ?');
      args.push(fields.status);
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'syncedAt')) {
      sets.push('synced_at = ?');
      args.push(fields.syncedAt ?? null);
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'runId')) {
      sets.push('run_id = ?');
      args.push(fields.runId ?? null);
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'jobId')) {
      sets.push('job_id = ?');
      args.push(fields.jobId ?? null);
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'lastError')) {
      sets.push('last_error = ?');
      args.push(fields.lastError ?? null);
    }
    if (fields.bumpAttempts === true) {
      sets.push('attempts = attempts + 1');
    }
    sets.push('updated_at = ?');
    args.push(isoNow());
    if (sets.length === 1) {
      // Only updated_at would change — caller passed an empty patch.
      // Run it anyway so the timestamp moves; this is the documented
      // "touch" behavior callers can rely on.
    }
    args.push(entryId);
    const sql = `UPDATE bookmark_ledger SET ${sets.join(', ')} WHERE entry_id = ?`;
    const result = db.prepare(sql).run(...args);
    if (result.changes === 0) {
      throw new QueueError(`bookmark not found: ${entryId}`, 'NOT_FOUND');
    }
    const fresh = getBookmark(entryId);
    if (fresh === null) throw new QueueError('bookmark vanished after update', 'INVALID_STATE');
    return fresh;
  };

  const bookmarkStats = (filter: { source?: BookmarkSource } = {}): BookmarkLedgerStats => {
    const out: BookmarkLedgerStats = { total: 0, new: 0, synced: 0, failed: 0, skipped: 0 };
    const rows = (
      filter.source !== undefined
        ? stmts.bookmarkStatsBySource.all(filter.source)
        : stmts.bookmarkStatsAll.all()
    ) as { status: BookmarkStatus; n: number }[];
    for (const r of rows) {
      out[r.status] = r.n;
      out.total += r.n;
    }
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
    completeAllStages,
    failStage,
    retryFailed,
    listJobs,
    listDlq,
    recordCost,
    costSince,
    costByEntry,
    stats,
    upsertBookmark,
    listBookmarks,
    getBookmark,
    findBookmarkBySourceUrl,
    markBookmarkSuperseded,
    bookmarkChainStatus,
    updateBookmark,
    bookmarkStats,
    close,
  };
};
