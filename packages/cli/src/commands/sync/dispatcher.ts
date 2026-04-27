/**
 * `xs sync` dispatcher loop.
 *
 *  enqueue all SourceItems → loop {
 *    job = queue.claimNext({runId})    // run-scoped so we don't pick up
 *                                       // foreign pending jobs
 *    if (job === null) break
 *    run every stage handler in memory under the single lease
 *    on full success: queue.completeAllStages(jobId, attemptId)
 *    on failure:       queue.failStage({jobId, stage, attemptId, ...})
 *  }
 *
 * One claim per job avoids the inter-stage race that release-and-reclaim
 * would create. Running all stages in one pass also means a resumed job
 * always derives its own context from scratch — there is no stale
 * intermediate state to carry across crashes.
 */

import { time } from '@x-scraper/observability';
import type { Job, Stage } from '@x-scraper/queue';
import { STAGES } from '@x-scraper/queue';

import { handlerFor } from './stages.js';
import type {
  JobContext,
  JobOutcome,
  SourceItem,
  StageOutcome,
  SyncDeps,
  SyncOptions,
  SyncResult,
} from './types.js';

const DEFAULT_LIMIT = 50;
const SYNC_RUN_COMMIT_MSG = 'chore(vault): xs sync run';
const RETRY_POLL_FALLBACK_MS = 5_000;
const RETRY_TOTAL_BUDGET_MS = 10 * 60 * 1_000;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const errorCodeOf = (err: unknown): string => {
  if (err !== null && typeof err === 'object' && 'code' in err) {
    const code = err.code;
    if (typeof code === 'string') return code;
  }
  return 'UNKNOWN';
};

const errorMsgOf = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  return String(err);
};

export const runSync = async (deps: SyncDeps, options: SyncOptions = {}): Promise<SyncResult> => {
  const log = deps.logger;
  const start = (deps.now ?? ((): Date => new Date()))().getTime();
  const runId = deps.queue.startRun();
  const runLog = log.child({ runId });
  runLog.info('sync.run.started', { source: options.source ?? 'bookmarks' });

  // 1) Load + enqueue.
  const sources = await deps.loadSources(options);
  const limit = options.limit ?? DEFAULT_LIMIT;
  const enqueueable = sources.slice(0, limit);
  const sourceById = new Map<string, SourceItem>();
  for (const item of enqueueable) {
    sourceById.set(item.sourceId, item);
    deps.queue.enqueue({
      runId,
      sourceId: item.sourceId,
      sourceKind: item.sourceKind,
      idempotencyKey: item.sourceId,
    });
  }
  runLog.info('sync.enqueued', { count: enqueueable.length });

  // 2) Process loop. Run-scoped claim filter prevents the dispatcher from
  // incidentally leasing stale jobs from a prior run. When claimNext
  // returns null we check for jobs still pending-with-backoff (failStage
  // sets next_run_at to a future time on retryable failures) and sleep
  // until they're ready, up to a total budget. Without this, a transient
  // failure would strand the job in pending forever — the next sync uses
  // a different runId so the runId-scoped claim never picks it up again.
  const jobOutcomes: JobOutcome[] = [];
  let claimed = 0;
  const HARD_CAP = enqueueable.length * (options.maxAttempts ?? 3) + 10;
  let waitedMs = 0;
  while (claimed < HARD_CAP) {
    let job = deps.queue.claimNext({ runId });
    if (job === null) {
      const nextRetryAt = soonestPendingNextRunAt(deps, runId);
      if (nextRetryAt === null) break;
      const waitMs = Math.max(0, nextRetryAt - Date.now());
      const sleepMs = Math.min(waitMs + 100, RETRY_POLL_FALLBACK_MS);
      if (waitedMs + sleepMs > RETRY_TOTAL_BUDGET_MS) {
        runLog.warn('sync.retry_budget_exhausted', { waitedMs });
        break;
      }
      runLog.info('sync.waiting_for_retry', { sleepMs, waitedMs });
      await sleep(sleepMs);
      waitedMs += sleepMs;
      job = deps.queue.claimNext({ runId });
      if (job === null) continue;
    }
    claimed += 1;
    const source = sourceById.get(job.sourceId);
    if (source === undefined) {
      // Defensive — shouldn't happen with the runId filter above, but if it
      // ever does, fail the orphan job rather than silently looping on it.
      runLog.warn('sync.unknown_source', { jobId: job.jobId, sourceId: job.sourceId });
      deps.queue.failStage({
        jobId: job.jobId,
        stage: job.currentStage,
        attemptId: job.currentAttemptId ?? 0,
        errorCode: 'UNKNOWN_SOURCE',
        errorMsg: `no SourceItem in scope for ${job.sourceId}`,
        ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
      });
      continue;
    }
    const outcome = await processJob(deps, options, job, source);
    jobOutcomes.push(outcome);
  }

  // 3) Commit any vault writes from this batch so the audit log reflects
  // them as a single batch commit, then wrap up. Skipped when the
  // skipVault path is active (xs reindex), since vault is unchanged.
  if (options.skipVault !== true) {
    const commitMsg = `${SYNC_RUN_COMMIT_MSG} ${runId}`;
    await deps.vault.commit(commitMsg).catch((err: unknown) => {
      runLog.warn('sync.vault.commit_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
  }

  const stats = deps.queue.stats(runId);
  // Treat any non-clean state (failed retries pending OR dead) as a failed
  // run so a transient partial failure doesn't get reported as success.
  const runStatus: 'done' | 'failed' = stats.dead > 0 || stats.failed > 0 ? 'failed' : 'done';
  deps.queue.finishRun(runId, runStatus);
  const totalCostUsd = deps.queue.costSince(new Date(start).toISOString());
  const durationMs = (deps.now ?? ((): Date => new Date()))().getTime() - start;
  runLog.info('sync.run.finished', {
    enqueued: enqueueable.length,
    completed: stats.done,
    dead: stats.dead,
    failed: stats.failed,
    runStatus,
    costUsd: totalCostUsd,
    durationMs,
  });

  return {
    runId,
    jobsEnqueued: enqueueable.length,
    jobsCompleted: stats.done,
    jobsDead: stats.dead,
    jobsFailed: stats.failed,
    totalCostUsd,
    durationMs,
    jobs: jobOutcomes,
  };
};

/**
 * Find the earliest nextRunAt across all pending jobs in this run, in ms.
 * Returns null when no pending jobs exist (the loop is genuinely done).
 */
const soonestPendingNextRunAt = (deps: SyncDeps, runId: string): number | null => {
  const pending = deps.queue.listJobs({ runId, status: 'pending' });
  if (pending.length === 0) return null;
  let earliest = Number.POSITIVE_INFINITY;
  for (const job of pending) {
    const at = job.nextRunAt === null ? Date.now() : Date.parse(job.nextRunAt);
    if (at < earliest) earliest = at;
  }
  return earliest === Number.POSITIVE_INFINITY ? null : earliest;
};

const stagesToRun = (_options: SyncOptions): Stage[] => {
  // Always run every stage; the handler-map already swaps in a no-op for
  // skipped stages (e.g. update_graph in --dry-run, write_vault in
  // xs reindex). Iterating the full list keeps the per-stage timing
  // visible in logs even when a stage is a no-op.
  return [...STAGES];
};

const processJob = async (
  deps: SyncDeps,
  options: SyncOptions,
  job: Job,
  source: SourceItem,
): Promise<JobOutcome> => {
  const log = deps.logger.child({ jobId: job.jobId, sourceId: source.sourceId });
  const ctx: JobContext = {
    jobId: job.jobId,
    source,
    ingested: null,
    embedding: null,
    extraction: null,
    entityEmbeddings: new Map(),
    entityResolutions: new Map(),
    claimDecisions: new Map(),
    vaultWrites: [],
  };
  const stages: StageOutcome[] = [];
  const attemptId = job.currentAttemptId ?? 0;

  for (const stage of stagesToRun(options)) {
    const handler = handlerFor(stage, options);
    const stageStart = Date.now();
    try {
      await time(log.child({ stage }), `stage.${stage}`, () => handler(deps, ctx));
      stages.push({ stage, ok: true, durationMs: Date.now() - stageStart });
    } catch (err) {
      const errorCode = errorCodeOf(err);
      const errorMsg = errorMsgOf(err);
      stages.push({ stage, ok: false, errorCode, errorMsg, durationMs: Date.now() - stageStart });
      const failed = deps.queue.failStage({
        jobId: job.jobId,
        stage,
        attemptId,
        errorCode,
        errorMsg,
        ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
      });
      log.warn('sync.stage.failed', { stage, errorCode, errorMsg, status: failed.status });
      return {
        jobId: job.jobId,
        sourceId: source.sourceId,
        status: failed.status === 'dead' ? 'dead' : 'failed',
        stages,
      };
    }
  }

  // All stages succeeded. completeAllStages finishes the attempt, marks
  // the job done, and releases the lease — all in one transaction so an
  // unrelated job can't race in between.
  deps.queue.completeAllStages(job.jobId, attemptId);
  log.info('sync.job.done', { stages: stages.length });
  return { jobId: job.jobId, sourceId: source.sourceId, status: 'done', stages };
};
