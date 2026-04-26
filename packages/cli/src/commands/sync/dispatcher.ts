/**
 * `xs sync` dispatcher loop.
 *
 *  enqueue all SourceItems → loop {
 *    job = queue.claimNext()
 *    if (job === null) break
 *    while (job is in-progress):
 *      stage = job.currentStage
 *      try: handlerFor(stage)(deps, ctx)
 *           → completeStage → job advances to next stage (or 'done')
 *      catch: failStage → job goes back to queue for retry, or DLQ
 *      break the inner loop on failure (the queue will re-claim later)
 *  }
 *
 * The dispatcher runs all stages of a single job back-to-back so the
 * in-memory JobContext stays valid across stages. On a crash mid-job the
 * lease eventually goes stale and the next claim re-runs from the failed
 * stage (re-deriving prior outputs as needed — correctness over speed).
 */

import { time } from '@x-scraper/observability';
import type { Job, Stage } from '@x-scraper/queue';

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
const STAGE_FAILURE_BREAK_FACTOR = 1; // stop processing this job on the first failed stage

const errorCodeOf = (err: unknown): string => {
  if (err !== null && typeof err === 'object' && 'code' in err) {
    const code = (err).code;
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

  // 2) Process loop.
  const jobOutcomes: JobOutcome[] = [];
  let claimed = 0;
  // Hard-cap iterations so a runaway loop can't trap us indefinitely. The
  // queue should naturally exhaust after at most enqueued × maxAttempts.
  const HARD_CAP = enqueueable.length * (options.maxAttempts ?? 3) + 10;
  while (claimed < HARD_CAP) {
    const job = deps.queue.claimNext();
    if (job === null) break;
    claimed += 1;
    const source = sourceById.get(job.sourceId);
    if (source === undefined) {
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

  // 3) Wrap up.
  const stats = deps.queue.stats(runId);
  deps.queue.finishRun(runId, stats.dead > 0 ? 'failed' : 'done');
  const totalCostUsd = deps.queue.costSince(new Date(start).toISOString());
  const durationMs = (deps.now ?? ((): Date => new Date()))().getTime() - start;
  runLog.info('sync.run.finished', {
    enqueued: enqueueable.length,
    completed: stats.done,
    dead: stats.dead,
    failed: stats.failed,
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

const processJob = async (
  deps: SyncDeps,
  options: SyncOptions,
  initialJob: Job,
  source: SourceItem,
): Promise<JobOutcome> => {
  const log = deps.logger.child({ jobId: initialJob.jobId, sourceId: source.sourceId });
  const ctx: JobContext = {
    jobId: initialJob.jobId,
    source,
    ingested: null,
    embedding: null,
    extraction: null,
    entityResolutions: new Map(),
    claimDecisions: new Map(),
    vaultWrites: [],
  };
  const stages: StageOutcome[] = [];

  let job: Job = initialJob;
  // Inner loop: run stages back-to-back as long as they succeed. Break on
  // the first failure (the queue re-leases later for the failed stage).
  let safety = STAGE_FAILURE_BREAK_FACTOR + 100;
  while (safety > 0) {
    safety -= 1;
    const stage: Stage = job.currentStage;
    const attemptId = job.currentAttemptId ?? 0;
    const handler = handlerFor(stage, options);
    const stageStart = Date.now();
    try {
      await time(log.child({ stage }), `stage.${stage}`, () => handler(deps, ctx));
      const advanced = deps.queue.completeStage(job.jobId, stage, attemptId);
      stages.push({ stage, ok: true, durationMs: Date.now() - stageStart });
      if (advanced.status === 'done') {
        log.info('sync.job.done', { stages: stages.length });
        return { jobId: job.jobId, sourceId: source.sourceId, status: 'done', stages };
      }
      // Re-claim the same job for the next stage. claimNext() picks up the
      // same job because the queue's lease was released by completeStage.
      const next = deps.queue.claimNext();
      if (next?.jobId !== job.jobId) {
        // Some other process raced us to claim the next stage. Stop here;
        // the next outer-loop iteration will pick up wherever it landed.
        log.warn('sync.job.preempted', {
          nextStage: advanced.currentStage,
          claimedNext: next?.jobId ?? null,
        });
        return {
          jobId: job.jobId,
          sourceId: source.sourceId,
          status: 'failed',
          stages,
        };
      }
      job = next;
      continue;
    } catch (err) {
      const errorCode = errorCodeOf(err);
      const errorMsg = errorMsgOf(err);
      const failed = deps.queue.failStage({
        jobId: job.jobId,
        stage,
        attemptId,
        errorCode,
        errorMsg,
        ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
      });
      stages.push({ stage, ok: false, errorCode, errorMsg, durationMs: Date.now() - stageStart });
      log.warn('sync.stage.failed', { stage, errorCode, errorMsg, status: failed.status });
      return {
        jobId: job.jobId,
        sourceId: source.sourceId,
        status: failed.status === 'dead' ? 'dead' : 'failed',
        stages,
      };
    }
  }
  log.error('sync.job.safety_exit', { stages: stages.length });
  return { jobId: job.jobId, sourceId: source.sourceId, status: 'failed', stages };
};
