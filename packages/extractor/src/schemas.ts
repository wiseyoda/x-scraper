/**
 * Zod schemas + types for the extraction output. The same shape is
 * enforced both as a runtime guard (post-LLM) and as part of the prompt
 * (so the model knows exactly what to produce).
 *
 * No MIN_ thresholds. We never artificially require N entities or N
 * claims — the model emits what's actually in the source.
 */

import type { EdgeType, EntityType } from '@x-scraper/core';
import { z } from 'zod';

import { ENTITY_TYPES_FOR_EXTRACTION, RELATIONSHIP_TYPES_FOR_EXTRACTION } from './constants.js';

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

const entityEnum = z.enum(
  ENTITY_TYPES_FOR_EXTRACTION as unknown as readonly [EntityType, ...EntityType[]],
);
const relationshipEnum = z.enum(
  RELATIONSHIP_TYPES_FOR_EXTRACTION as unknown as readonly [EdgeType, ...EdgeType[]],
);

export const ExtractionEntitySchema = z.object({
  id: z.string().min(1).describe('stable slug used as the entity id everywhere it appears'),
  type: entityEnum,
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
});
export type ExtractionEntity = z.infer<typeof ExtractionEntitySchema>;

export const ExtractionClaimSchema = z.object({
  id: z.string().min(1).describe('claim_<short-hash>'),
  subject: z.string().min(1),
  predicate: z.string().regex(SNAKE_CASE, 'predicate must be snake_case'),
  object: z.string().min(1),
  text: z.string().min(1).describe('paraphrase or quote that supports the claim'),
  confidence: z.number().min(0).max(1),
});
export type ExtractionClaim = z.infer<typeof ExtractionClaimSchema>;

export const ExtractionRelationshipSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: relationshipEnum,
});
export type ExtractionRelationship = z.infer<typeof ExtractionRelationshipSchema>;

export const ExtractionResultSchema = z.object({
  entities: z.array(ExtractionEntitySchema),
  claims: z.array(ExtractionClaimSchema),
  relationships: z.array(ExtractionRelationshipSchema),
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
