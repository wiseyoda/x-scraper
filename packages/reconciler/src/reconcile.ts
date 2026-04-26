/**
 * Per-claim reconciliation against the existing graph.
 *
 * Inspired by mem0's ADD/UPDATE/DELETE/NONE protocol. The decision is
 * made deterministically given the (subject, predicate, object) triple
 * and the set of existing claims for the same (subject, predicate).
 *
 *   - No existing claim with the same (subject, predicate) → ADD
 *   - Existing claim with same triple (subject, predicate, object)
 *     where invalid_at IS NULL → NONE (already current)
 *   - Existing current claim with same (subject, predicate) but
 *     different object → UPDATE (invalidate old, ADD new)
 *   - Incoming claim's confidence is 0 and an existing current claim
 *     exists with the same triple → DELETE (invalidate it)
 *
 * Contradictions are NOT silently merged. Two current claims with the
 * same (subject, predicate) and different objects produce a CONTRADICTS
 * edge in the caller's graph layer (this module flags the case via the
 * `reason` field).
 */

import type { ExistingClaim, IncomingClaim, ReconcileDecision } from './types.js';

export interface ReconcileInput {
  incoming: IncomingClaim;
  /** All existing claims for the same subject. */
  existing: ExistingClaim[];
}

const sameTriple = (
  a: { subject: string; predicate: string; object: string },
  b: ExistingClaim,
): boolean => a.subject === b.subject && a.predicate === b.predicate && a.object === b.object;

const samePredicate = (a: { subject: string; predicate: string }, b: ExistingClaim): boolean =>
  a.subject === b.subject && a.predicate === b.predicate;

const isCurrent = (c: ExistingClaim): boolean => c.invalidAt === null;

const ZERO_CONFIDENCE = 0;

export const reconcileClaim = (input: ReconcileInput): ReconcileDecision => {
  const { incoming, existing } = input;

  // Find every current claim that shares the predicate.
  const currentSamePred = existing.filter((c) => isCurrent(c) && samePredicate(incoming, c));

  // DELETE signal: explicit confidence=0 with a matching current triple.
  if (incoming.confidence === ZERO_CONFIDENCE) {
    const exact = currentSamePred.find((c) => sameTriple(incoming, c));
    if (exact !== undefined) {
      return {
        action: 'DELETE',
        existingId: exact.id,
        reason: 'incoming confidence=0 against an existing current claim with the same triple',
      };
    }
  }

  // Same triple already current → NONE.
  const existingTriple = currentSamePred.find((c) => sameTriple(incoming, c));
  if (existingTriple !== undefined) {
    return {
      action: 'NONE',
      existingId: existingTriple.id,
      reason: 'identical (subject, predicate, object) is already current',
    };
  }

  // Same (subject, predicate), different object → UPDATE.
  if (currentSamePred.length > 0) {
    const target = currentSamePred[0];
    if (target !== undefined) {
      return {
        action: 'UPDATE',
        existingId: target.id,
        reason: `superseding existing claim (${target.object} → ${incoming.object})`,
      };
    }
  }

  return {
    action: 'ADD',
    existingId: null,
    reason: 'no existing claim shares (subject, predicate) — adding fresh',
  };
};
