import { z } from 'zod';

export const RelatedKindSchema = z.enum([
  'Source',
  'Claim',
  'Idea',
  'Person',
  'Tool',
  'Concept',
  'Repo',
  'Article',
  'Tweet',
  'Video',
  'PDF',
  'Topic',
  'Entity',
]);
export type RelatedKind = z.infer<typeof RelatedKindSchema>;

export const RelatedHitSchema = z.object({
  targetId: z.string().min(1),
  targetKind: RelatedKindSchema,
  reason: z.string().min(1),
  score: z.number().nonnegative(),
  evidenceIds: z.array(z.string()).default([]),
});
export type RelatedHit = z.infer<typeof RelatedHitSchema>;

export const RelatedQuerySchema = z.object({
  id: z.string().min(1),
  limit: z.number().int().positive().max(100).optional(),
});
export type RelatedQuery = z.infer<typeof RelatedQuerySchema>;

export interface AttachmentEvent {
  /** New source that triggered the connection. */
  sourceId: string;
  /** When the source was captured/saved (ISO). */
  at: string;
  /** Connected existing node. */
  targetId: string;
  targetKind: RelatedKind;
  reason: string;
  score: number;
}

/**
 * In-memory inverted index for pure related scoring.
 * Built from vault (and optionally graph) — no I/O inside scorers.
 */
export interface RelatedCorpus {
  /** id → kind label for hits. */
  kinds: Map<string, RelatedKind>;
  /** Display names for reason strings. */
  names: Map<string, string>;
  /** entityId → member node ids (sources, ideas that attach). */
  entityToMembers: Map<string, Set<string>>;
  /** nodeId → entity ids it participates in. */
  memberToEntities: Map<string, Set<string>>;
  /**
   * Normalized claim subject key → claim ids.
   * Used so sources with claims about the same subject connect.
   */
  subjectToClaims: Map<string, Set<string>>;
  /** claimId → source ids on that claim. */
  claimToSources: Map<string, Set<string>>;
  /** sourceId → claim ids. */
  sourceToClaims: Map<string, Set<string>>;
  /** lowercase author handle → source ids. */
  authorToSources: Map<string, Set<string>>;
  /** sourceId → author handle. */
  sourceToAuthor: Map<string, string>;
  /**
   * Optional embedding neighbors: seed id → [{ id, score in 0..1 }].
   * Omitted / empty when Neo4j is down.
   */
  embeddingNeighbors: Map<string, { id: string; score: number }[]>;
  /** sourceId → captured_at ISO for attachment timeline. */
  sourceCapturedAt: Map<string, string>;
}
