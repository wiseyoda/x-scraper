/**
 * Extractor constants. Prompt versions, retry budgets, sampling caps.
 */

export const EXTRACTION_PROMPT_VERSION = 1;
export const RECONCILIATION_PROMPT_VERSION = 0;
export const EMBEDDING_PROMPT_VERSION = 0;

export const DEFAULT_MAX_REPAIR_ATTEMPTS = 2;
export const MAX_REPORTED_VALIDATION_ISSUES = 5;

export const ENTITY_TYPES_FOR_EXTRACTION = [
  'Person',
  'Tool',
  'Concept',
  'Repo',
  'Article',
  'Service',
  'Other',
] as const;

export const RELATIONSHIP_TYPES_FOR_EXTRACTION = [
  'IS_A',
  'PART_OF',
  'INSTANCE_OF',
  'AUTHORED_BY',
  'MENTIONS',
  'RELATED_TO',
  'SUPPORTS',
  'CONTRADICTS',
  'EVOLVED_FROM',
  'USES',
] as const;
