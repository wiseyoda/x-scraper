/**
 * Zod schemas for the LLM-output side of synthesis. We validate every
 * field at the boundary; no `as T` casts.
 *
 * v2 research-thread contract (current). v1 free-form body kept for
 * parsing legacy fixtures only.
 */

import { z } from 'zod';

import { MAX_IDEA_BODY_CHARS } from './constants.js';

/** @deprecated v1 free-form body — prefer IdeaDraftV2Schema. */
export const IdeaDraftSchemaV1 = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(MAX_IDEA_BODY_CHARS),
  confidence: z.number().min(0).max(1),
  caveat: z.string().nullable(),
});

export const IdeaDraftV2Schema = z.object({
  title: z.string().min(1).max(200),
  thesis: z.string().min(1).max(2_000),
  evidence: z.array(z.string().min(1)).min(1).max(12),
  open_questions: z.array(z.string().min(1)).min(1).max(8),
  watch_fors: z.array(z.string().min(1)).min(1).max(8),
  confidence: z.number().min(0).max(1),
  caveat: z.string().nullable(),
});
export type IdeaDraftV2Validated = z.infer<typeof IdeaDraftV2Schema>;

/** Active schema for new synthesis runs. */
export const IdeaDraftSchema = IdeaDraftV2Schema;
export type IdeaDraftValidated = IdeaDraftV2Validated;
