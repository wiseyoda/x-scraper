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
  /**
   * Find an existing entity of the given type whose name OR any alias
   * normalizes to one of the supplied surface forms. Returns the
   * graph id when matched, or null. Used for the cheap pre-flight
   * pass before the HNSW vector lookup, catches cases vector ER
   * misses (`AI Agents` / `AI Agent`, `MCP` / `Model Context Protocol`).
   *
   * Implementations should run an indexed exact match against a
   * normalized_name field plus an alias match.
   */
  findByNormalizedSurface?: (
    type: EntityType,
    surfaceForms: string[],
  ) => Promise<{ id: string; matchedSurface: string } | null>;
  /**
   * Cross-type variant — searches for an entity matching any of the
   * supplied surface forms across the supplied label set. Used to
   * merge organization-style names that the LLM classifies as Tool
   * one run and Person another ("Anthropic" being canonical).
   * Returns the matched type so callers can preserve the existing
   * label rather than creating a duplicate.
   */
  findByNormalizedSurfaceAcrossTypes?: (
    types: EntityType[],
    surfaceForms: string[],
  ) => Promise<{ id: string; matchedType: EntityType; matchedSurface: string } | null>;
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
