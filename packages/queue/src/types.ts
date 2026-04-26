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

export const BOOKMARK_SOURCES = ['bookmarks', 'likes', 'posts'] as const;
export type BookmarkSource = (typeof BOOKMARK_SOURCES)[number];

export const BOOKMARK_STATUSES = ['new', 'synced', 'failed', 'skipped'] as const;
export type BookmarkStatus = (typeof BOOKMARK_STATUSES)[number];

export const BookmarkSourceSchema = z.enum(BOOKMARK_SOURCES);
export const BookmarkStatusSchema = z.enum(BOOKMARK_STATUSES);

/**
 * One row in the bookmark_ledger. Carries everything xs bookmarks sync
 * needs to feed the existing pipeline without re-scraping: tweet text,
 * author, embedded URLs, captured time. Status moves new → synced |
 * failed | skipped as the pipeline runs.
 */
export interface BookmarkEntry {
  entryId: string;
  tweetId: string;
  source: BookmarkSource;
  sourceUrl: string;
  author: string | null;
  text: string;
  urls: string[];
  capturedAt: string;
  tweetCreatedAt: string | null;
  status: BookmarkStatus;
  syncedAt: string | null;
  runId: string | null;
  jobId: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Input for upsertBookmark — minimal, the queue assigns timestamps + status defaults. */
export interface BookmarkUpsertInput {
  entryId: string;
  tweetId: string;
  source: BookmarkSource;
  sourceUrl: string;
  text: string;
  author?: string | null;
  urls?: string[];
  capturedAt: string;
  tweetCreatedAt?: string | null;
}

export interface BookmarkListFilter {
  status?: BookmarkStatus;
  source?: BookmarkSource;
  order?: 'oldest' | 'newest';
  limit?: number;
}

export interface BookmarkUpdateFields {
  status?: BookmarkStatus;
  syncedAt?: string | null;
  runId?: string | null;
  jobId?: string | null;
  lastError?: string | null;
  /** When true, increment attempts by 1 atomically. */
  bumpAttempts?: boolean;
}

export interface BookmarkLedgerStats {
  total: number;
  new: number;
  synced: number;
  failed: number;
  skipped: number;
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
