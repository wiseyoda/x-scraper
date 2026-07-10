export {
  DEFAULT_ATTACHMENT_RELATED_LIMIT,
  DEFAULT_ATTACHMENT_SOURCE_LIMIT,
  DEFAULT_RELATED_LIMIT,
  MIN_RELATED_SCORE,
  WEIGHT_CO_CLAIM,
  WEIGHT_CO_ENTITY,
  WEIGHT_EMBEDDING,
  WEIGHT_SHARED_AUTHOR,
} from './constants.js';
export {
  createCorpus,
  linkAuthor,
  linkClaim,
  linkEntityMember,
  normalizeSubject,
  setEmbeddingNeighbors,
  setKind,
  setSourceCapturedAt,
} from './corpus.js';
export { buildCorpusFromVault, enrichWithEmbeddingNeighbors } from './from-vault.js';
export type { RelatedDeps, RelatedResult } from './related.js';
export {
  attachmentsSince,
  invalidateRelatedCache,
  loadRelatedCorpus,
  related,
  relatedFromCorpus,
} from './related.js';
export {
  attachmentEventsSince,
  emptyCorpus,
  rankRelated,
  scoreCoClaim,
  scoreCoEntity,
  scoreEmbeddingNeighbors,
  scoreSharedAuthor,
} from './score.js';
export type {
  AttachmentEvent,
  RelatedCorpus,
  RelatedHit,
  RelatedKind,
  RelatedQuery,
} from './types.js';
export { RelatedHitSchema, RelatedKindSchema, RelatedQuerySchema } from './types.js';
