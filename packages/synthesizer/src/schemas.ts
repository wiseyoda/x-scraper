/**
 * Zod schemas for the LLM-output side of synthesis. We validate every
 * field at the boundary; no `as T` casts.
 */

import { z } from 'zod';

import { MAX_IDEA_BODY_CHARS } from './constants.js';

export const IdeaDraftSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(MAX_IDEA_BODY_CHARS),
  confidence: z.number().min(0).max(1),
  caveat: z.string().nullable(),
});
export type IdeaDraftValidated = z.infer<typeof IdeaDraftSchema>;
