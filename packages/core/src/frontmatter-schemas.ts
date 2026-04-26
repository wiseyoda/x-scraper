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

export const FrontmatterSchema = z.discriminatedUnion('type', [
  SourceFrontmatterSchema,
  ClaimFrontmatterSchema,
  TopicFrontmatterSchema,
  EntityFrontmatterSchema,
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
