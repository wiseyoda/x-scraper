/**
 * Entity resolution.
 *
 * Two-phase decision:
 *   1. Vector search: top-K nearest existing entities of the same type
 *      using the candidate's embedding.
 *   2. Threshold gate:
 *      - top score >= MERGE threshold → MERGE
 *      - top score >= PROBABLE threshold → SAME_AS_PROBABLE (LLM judge
 *        is the optional next step; not required for the gate)
 *      - else NEW
 *
 * The deterministic threshold-only path is fully testable. The LLM
 * judge layer is a thin override on top — see `judgeWithLlm`.
 */

import type { EntityType } from '@x-scraper/core';
import type { LlmProvider } from '@x-scraper/llm';

import {
  DEFAULT_ER_MERGE_THRESHOLD,
  DEFAULT_ER_PROBABLE_THRESHOLD,
  DEFAULT_ER_VECTOR_K,
} from './constants.js';
import { normalizedSurfaceForms } from './normalize.js';
import {
  type ErCandidateFinder,
  type ErDecision,
  type ErJudgement,
  ReconcilerError,
} from './types.js';

export interface ResolveEntityInput {
  candidateName: string;
  candidateEmbedding: number[];
  type: EntityType;
  /** Aliases the extractor proposed for this entity. Folded into the
   *  normalized-surface-form pre-flight match. */
  candidateAliases?: string[];
}

export interface ResolveEntityOptions {
  finder: ErCandidateFinder;
  k?: number;
  mergeThreshold?: number;
  probableThreshold?: number;
}

/**
 * Free-text proper-noun types where cross-type surface match is safe.
 * URL-anchored types (Source/Article/Tweet/Video/PDF/Repo) stay
 * type-scoped because a URL collision between types is genuinely
 * different (e.g. a github.com URL is a Repo, never a Tool).
 *
 * The Person↔Tool↔Concept loop is where the LLM legitimately
 * disagrees with itself across runs and we want a single canonical
 * record.
 */
const CROSS_TYPE_EQUIV: readonly EntityType[] = ['Person', 'Tool', 'Concept'];

/**
 * Result extension when ER decided to MERGE into an entity of a
 * different type than the candidate's. Caller (sync stages) should
 * preserve the existing type instead of overwriting.
 */
export interface ErJudgementWithType extends ErJudgement {
  matchedType?: EntityType;
}

export const resolveEntity = async (
  input: ResolveEntityInput,
  options: ResolveEntityOptions,
): Promise<ErJudgementWithType> => {
  const k = options.k ?? DEFAULT_ER_VECTOR_K;
  const mergeT = options.mergeThreshold ?? DEFAULT_ER_MERGE_THRESHOLD;
  const probableT = options.probableThreshold ?? DEFAULT_ER_PROBABLE_THRESHOLD;
  if (mergeT < probableT) {
    throw new ReconcilerError(
      `mergeThreshold ${String(mergeT)} must be >= probableThreshold ${String(probableT)}`,
      'PROVIDER',
    );
  }

  // Phase 0a — cheap exact match on normalized name + aliases, scoped
  // to the candidate's type. Catches `AI Agents`/`AI Agent`,
  // `MCP`/`Model Context Protocol`, etc., that vector ER misses because
  // the embeddings sit just below the merge threshold. Indexed at the
  // adapter — see GraphStore.findEntityByNormalizedSurface.
  const surfaces = normalizedSurfaceForms(input.candidateName, input.candidateAliases ?? []);
  if (options.finder.findByNormalizedSurface !== undefined && surfaces.length > 0) {
    const exact = await options.finder.findByNormalizedSurface(input.type, surfaces);
    if (exact !== null) {
      return { decision: 'MERGE', matchId: exact.id, confidence: 1, vectorScore: null };
    }
  }

  // Phase 0b — cross-type surface match for free-text proper-noun
  // types. The LLM classifies "Anthropic" as Tool one run and Person
  // another. Without this, we'd write two parallel records for the
  // same real-world entity. Restricted to the equivalence set so URL-
  // anchored types stay strictly scoped.
  if (
    options.finder.findByNormalizedSurfaceAcrossTypes !== undefined &&
    surfaces.length > 0 &&
    CROSS_TYPE_EQUIV.includes(input.type)
  ) {
    const cross = await options.finder.findByNormalizedSurfaceAcrossTypes(
      [...CROSS_TYPE_EQUIV],
      surfaces,
    );
    if (cross !== null && cross.matchedType !== input.type) {
      return {
        decision: 'MERGE',
        matchId: cross.id,
        matchedType: cross.matchedType,
        confidence: 1,
        vectorScore: null,
      };
    }
  }

  // Phase 1 — vector ER fallback.
  const candidates = await options.finder.findCandidates(input.type, input.candidateEmbedding, k);
  const top = candidates[0];
  if (top === undefined) {
    return { decision: 'NEW', matchId: null, confidence: 1, vectorScore: null };
  }

  let decision: ErDecision;
  if (top.score >= mergeT) decision = 'MERGE';
  else if (top.score >= probableT) decision = 'SAME_AS_PROBABLE';
  else decision = 'NEW';

  return {
    decision,
    matchId: decision === 'NEW' ? null : top.id,
    confidence: top.score,
    vectorScore: top.score,
  };
};

/**
 * Optional LLM judge: when threshold-only returns SAME_AS_PROBABLE, ask
 * the LLM whether they're the same entity. The judge can flip the
 * decision to MERGE (high confidence) or NEW (clear no-match), keeping
 * SAME_AS_PROBABLE as the fallback when the LLM is uncertain.
 */
export interface JudgeContext {
  candidateName: string;
  matchName: string;
  candidateAliases: string[];
  matchAliases: string[];
}

export const ER_JUDGE_SYSTEM = `You are deciding whether two entity descriptions refer to the same real-world thing.
Reply with a single token: SAME, DIFFERENT, or UNSURE. No prose.`;

export const judgeWithLlm = async (
  llm: LlmProvider,
  ctx: JudgeContext,
): Promise<'SAME' | 'DIFFERENT' | 'UNSURE'> => {
  const prompt = `Candidate: ${ctx.candidateName}\nAliases: ${ctx.candidateAliases.join(', ')}\n\nMatch: ${ctx.matchName}\nAliases: ${ctx.matchAliases.join(', ')}\n\nAre these the same?`;
  const reply = await llm.complete({
    system: [{ text: ER_JUDGE_SYSTEM }],
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 16,
  });
  const trimmed = reply.text.trim().toUpperCase();
  if (trimmed.startsWith('SAME')) return 'SAME';
  if (trimmed.startsWith('DIFFERENT')) return 'DIFFERENT';
  return 'UNSURE';
};
