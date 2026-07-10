/** Score weights for pure related fusion. */
export const WEIGHT_CO_ENTITY = 3;
export const WEIGHT_CO_CLAIM = 2;
export const WEIGHT_SHARED_AUTHOR = 1.5;
export const WEIGHT_EMBEDDING = 2;

/** Drop hits at or below this fused score. */
export const MIN_RELATED_SCORE = 0.5;

export const DEFAULT_RELATED_LIMIT = 10;

/** Homepage attachment scan: max new sources to score. */
export const DEFAULT_ATTACHMENT_SOURCE_LIMIT = 24;

/** Homepage attachment scan: related hits considered per new source. */
export const DEFAULT_ATTACHMENT_RELATED_LIMIT = 5;
