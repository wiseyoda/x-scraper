/**
 * Graph-package constants. Index names, default vector dims, and the
 * single source of truth for the constraints we ship.
 */

export const VECTOR_INDEX_NAME = 'claim_embed_idx';
export const ENTITY_VECTOR_INDEX_NAME = 'entity_embed_idx';
export const ENTITY_VECTOR_PROP = 'embedding';
/**
 * Multi-label every non-Source non-Claim non-Topic node carries on
 * upsert. Lets a single HNSW index `entity_embed_idx` cover all
 * user-facing entity types (Person/Tool/Concept/Repo/Article/Tweet/
 * Video/PDF) without one index per label. Type-specific Cypher still
 * matches on the original labels.
 */
export const ENTITY_META_LABEL = 'Entity';
export const DEFAULT_EMBED_DIMS = 1536;
export const DEFAULT_SIMILARITY = 'cosine';
export const DEFAULT_AWAIT_INDEXES_SECONDS = 60;

export const ID_CONSTRAINTS = [
  { name: 'concept_id_unique', label: 'Concept' },
  { name: 'source_id_unique', label: 'Source' },
  { name: 'claim_id_unique', label: 'Claim' },
  { name: 'topic_id_unique', label: 'Topic' },
  { name: 'person_id_unique', label: 'Person' },
  { name: 'tool_id_unique', label: 'Tool' },
  { name: 'repo_id_unique', label: 'Repo' },
] as const;
