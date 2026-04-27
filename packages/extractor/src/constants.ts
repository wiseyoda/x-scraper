/**
 * Extractor constants. Prompt versions, retry budgets, sampling caps.
 *
 * The set of entity and edge types the model may emit is derived from
 * `@x-scraper/core` so an extraction can flow straight into the graph
 * without runtime "unknown entity type" failures. We narrow to the
 * subset that's reasonable for an LLM to assign — `Source`/`Claim` are
 * synthesized by the pipeline itself, not the LLM.
 */

import { EDGE_TYPES, type EdgeType, ENTITY_TYPES, type EntityType } from '@x-scraper/core';

export const EXTRACTION_PROMPT_VERSION = 3;
export const RECONCILIATION_PROMPT_VERSION = 0;
export const EMBEDDING_PROMPT_VERSION = 0;

export const DEFAULT_MAX_REPAIR_ATTEMPTS = 2;
export const MAX_REPORTED_VALIDATION_ISSUES = 5;

// Source/Claim are synthesized by the pipeline. Idea is L1 — owned by
// the synthesizer (`xs ideas synthesize`) — never produced by the
// extractor's per-source pass.
const NOT_LLM_ASSIGNABLE_ENTITIES = new Set<EntityType>(['Source', 'Claim', 'Idea']);

export const ENTITY_TYPES_FOR_EXTRACTION = ENTITY_TYPES.filter(
  (t) => !NOT_LLM_ASSIGNABLE_ENTITIES.has(t),
) as readonly EntityType[];

// SAME_AS_PROBABLE is decided by the reconciler. SYNTHESIZED_FROM and
// PROMOTES are written by the synthesizer (Idea provenance).
const NOT_LLM_ASSIGNABLE_EDGES = new Set<EdgeType>([
  'SAME_AS_PROBABLE',
  'SYNTHESIZED_FROM',
  'PROMOTES',
]);

export const RELATIONSHIP_TYPES_FOR_EXTRACTION = EDGE_TYPES.filter(
  (t) => !NOT_LLM_ASSIGNABLE_EDGES.has(t),
) as readonly EdgeType[];
