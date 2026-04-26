/**
 * Reconciler constants.
 *
 * The default thresholds were calibrated against the spike fixtures —
 * they are not magic numbers, they are project tuning knobs that the
 * caller can override per-run.
 */

export const DEFAULT_ER_VECTOR_K = 5;
export const DEFAULT_ER_MERGE_THRESHOLD = 0.92;
export const DEFAULT_ER_PROBABLE_THRESHOLD = 0.82;

export const DEFAULT_RECONCILE_MAX_TOKENS = 8_000;

export const RECONCILER_PROMPT_VERSION = 1;
