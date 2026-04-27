/**
 * Zod schemas for vault frontmatter — the contract on disk.
 *
 * Bumping any of these is a breaking change to existing vault files.
 * Migrations live in the vault package; this file is the schema source
 * of truth.
 */

import { z } from 'zod';

import { EDGE_TYPES, ENTITY_TYPES } from './constants.js';

const PromptVersionsSchema = z.object({
  extraction: z.number().int().nonnegative().default(0),
  reconciliation: z.number().int().nonnegative().default(0),
  embedding: z.number().int().nonnegative().default(0),
});

const BaseFrontmatterShape = {
  id: z.string().min(1),
  type: z.enum(ENTITY_TYPES),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  prompt_version: PromptVersionsSchema.default({
    extraction: 0,
    reconciliation: 0,
    embedding: 0,
  }),
  embedding_model: z.string().optional(),
  content_hash: z.string().optional(),
  sources: z.array(z.string()).default([]),
  aliases: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
  tags: z.array(z.string()).default([]),
  topics: z.array(z.string()).default([]),
} as const;

export const SourceFrontmatterSchema = z.object({
  ...BaseFrontmatterShape,
  type: z.literal('Source'),
  url: z.url(),
  canonical_url: z.url(),
  captured_at: z.iso.datetime(),
  content_type: z.enum(['tweet', 'article', 'repo', 'video', 'pdf']),
  host_metadata: z.record(z.string(), z.unknown()).default({}),
});
export type SourceFrontmatter = z.infer<typeof SourceFrontmatterSchema>;

export const ClaimFrontmatterSchema = z.object({
  ...BaseFrontmatterShape,
  type: z.literal('Claim'),
  valid_at: z.iso.datetime(),
  invalid_at: z.iso.datetime().nullable().default(null),
  subject: z.string().min(1),
  predicate: z.string().regex(/^[a-z][a-z0-9_]*$/),
  object: z.string().min(1),
  contradicts: z.array(z.string()).default([]),
  supersedes: z.array(z.string()).default([]),
});
export type ClaimFrontmatter = z.infer<typeof ClaimFrontmatterSchema>;

export const TopicFrontmatterSchema = z.object({
  ...BaseFrontmatterShape,
  type: z.literal('Topic'),
  community_id: z.string().optional(),
  member_count: z.number().int().nonnegative().default(0),
  representative_claims: z.array(z.string()).default([]),
  last_summarized_at: z.iso.datetime().optional(),
});
export type TopicFrontmatter = z.infer<typeof TopicFrontmatterSchema>;

export const EntityFrontmatterSchema = z.object({
  ...BaseFrontmatterShape,
  type: z.enum(['Person', 'Tool', 'Concept', 'Repo', 'Article', 'Tweet', 'Video', 'PDF']),
  name: z.string().min(1),
  description: z.string().optional(),
});
export type EntityFrontmatter = z.infer<typeof EntityFrontmatterSchema>;

/**
 * Idea = L1 knowledge node. Synthesized from a cluster of L0 claims that
 * share a subject, agree across ≥2 sources, and survived an LLM judge
 * pass. Promotion chain: claim (L0) → idea (L1) → learning (L2) →
 * principle (L3). Only L1 is implemented in this slice; L2/L3 land later.
 *
 * status moves draft → confirmed via `xs ideas confirm`. A rejected
 * idea stays on disk (audit trail) but doesn't surface in lists or the
 * web-ui review queue.
 */
export const IdeaFrontmatterSchema = z.object({
  ...BaseFrontmatterShape,
  type: z.literal('Idea'),
  /** Knowledge tier — 1 for ideas, reserved for future learning/principle. */
  tier: z.literal(1),
  /** Workflow state. */
  status: z.enum(['draft', 'confirmed', 'rejected']).default('draft'),
  /** Surface form of the cluster's anchor (entity / concept name / theme). */
  subject: z.string().min(1),
  /** Synthesizer confidence in the agreement quality of the cluster. */
  synthesizer_confidence: z.number().min(0).max(1),
  /** Synthesizer prompt version that produced this idea. Bump on prompt changes. */
  synthesizer_version: z.number().int().nonnegative().default(1),
  /** ISO timestamp the idea was synthesized. */
  synthesized_at: z.iso.datetime(),
  /** L0 claim ids the idea was drafted from. */
  derived_from: z.array(z.string()).default([]),
  /** Optional manual override of the LLM-generated body. */
  edited_body: z.boolean().default(false),
});
export type IdeaFrontmatter = z.infer<typeof IdeaFrontmatterSchema>;

export const FrontmatterSchema = z.discriminatedUnion('type', [
  SourceFrontmatterSchema,
  ClaimFrontmatterSchema,
  TopicFrontmatterSchema,
  EntityFrontmatterSchema,
  IdeaFrontmatterSchema,
]);
export type Frontmatter = z.infer<typeof FrontmatterSchema>;

export const EdgeRecordSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum(EDGE_TYPES),
  valid_at: z.iso.datetime(),
  invalid_at: z.iso.datetime().nullable().default(null),
  confidence: z.number().min(0).max(1).optional(),
  created_at: z.iso.datetime(),
});
export type EdgeRecord = z.infer<typeof EdgeRecordSchema>;
