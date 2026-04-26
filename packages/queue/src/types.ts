import { z } from 'zod';

import type { JobStatus, Stage } from './constants.js';
import { STAGES } from './constants.js';

export const JOB_STATUSES = ['pending', 'running', 'done', 'failed', 'dead'] as const;

export const StageSchema = z.enum(STAGES);
export const JobStatusSchema = z.enum(JOB_STATUSES);

export interface Run {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  status: JobStatus;
}

export interface Job {
  jobId: string;
  runId: string;
  sourceId: string;
  sourceKind: string;
  idempotencyKey: string;
  currentStage: Stage;
  status: JobStatus;
  attempts: number;
  nextRunAt: string | null;
  lastError: string | null;
  leasedAt: string | null;
  currentAttemptId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttemptRecord {
  attemptId: number;
  jobId: string;
  stage: Stage;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'done' | 'failed';
  errorCode: string | null;
  errorMsg: string | null;
}

export interface CostEntry {
  recordedAt: string;
  runId: string | null;
  jobId: string | null;
  stage: Stage | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsd: number;
}

export type QueueErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'STAGE_OUT_OF_ORDER'
  | 'SCHEMA_MIGRATE'
  | 'STALE_LEASE'
  | 'UNKNOWN';

export class QueueError extends Error {
  public readonly code: QueueErrorCode;
  public override readonly cause: unknown;

  constructor(message: string, code: QueueErrorCode, cause?: unknown) {
    super(message);
    this.name = 'QueueError';
    this.code = code;
    this.cause = cause;
  }
}
