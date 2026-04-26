import type { EntityType } from '@x-scraper/core';

export type ErDecision = 'MERGE' | 'NEW' | 'SAME_AS_PROBABLE';

export interface ErJudgement {
  decision: ErDecision;
  /** Existing graph node id when decision is MERGE or SAME_AS_PROBABLE. */
  matchId: string | null;
  /** 0..1 confidence for the decision. */
  confidence: number;
  /** Vector-similarity score that produced the candidate, if any. */
  vectorScore: number | null;
}

export interface ErCandidateFinder {
  /** Find vector-similar entity nodes; returns ids ordered by similarity. */
  findCandidates: (
    type: EntityType,
    embedding: number[],
    k: number,
  ) => Promise<{ id: string; score: number }[]>;
}

export type ClaimAction = 'ADD' | 'UPDATE' | 'DELETE' | 'NONE';

export interface IncomingClaim {
  /** Stable client-side id (claim_xxxx) — used for idempotency. */
  id: string;
  subject: string;
  predicate: string;
  object: string;
  text: string;
  confidence: number;
  /** Source id (the document that produced this claim). */
  sourceId: string;
}

export interface ExistingClaim {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  validAt: string;
  invalidAt: string | null;
  /**
   * Source the existing claim was extracted from. Required so that
   * UPDATE/DELETE decisions can invalidate the original claim's actual
   * EXTRACTED_FROM edge — without this, the dispatcher would invalidate
   * an edge to the new (unrelated) source and silently leave the
   * superseded claim still current in the graph.
   */
  sourceId: string;
}

export interface ReconcileDecision {
  action: ClaimAction;
  /** Existing claim id when UPDATE / DELETE / NONE */
  existingId: string | null;
  reason: string;
}

export type ReconcilerErrorCode = 'PROVIDER' | 'INVALID_RESPONSE' | 'UNKNOWN';

export class ReconcilerError extends Error {
  public readonly code: ReconcilerErrorCode;
  public override readonly cause: unknown;

  constructor(message: string, code: ReconcilerErrorCode, cause?: unknown) {
    super(message);
    this.name = 'ReconcilerError';
    this.code = code;
    this.cause = cause;
  }
}
