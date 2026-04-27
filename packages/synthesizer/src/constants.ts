/**
 * Synthesizer constants.
 *
 * Bumping SYNTHESIS_PROMPT_VERSION invalidates prior LLM-drafted ideas
 * in a "needs re-synthesis" sense — the older drafts stay on disk and
 * can be confirmed/rejected as is, but `xs ideas synthesize` will run
 * the new prompt on the same clusters and produce parallel drafts.
 */

export const SYNTHESIS_PROMPT_VERSION = 1;

/**
 * Cluster admission thresholds. The "interestingness" floor: an Idea
 * worth surfacing is not a single claim from one source.
 */
export const MIN_CLAIMS_PER_CLUSTER = 3;
export const MIN_SOURCES_PER_CLUSTER = 2;

/** Default model + token budget for the synthesizer. Sonnet 4.6, generous. */
export const DEFAULT_SYNTHESIS_MAX_TOKENS = 8_000;

/** Idea body cap — clamps pathological LLM outputs. */
export const MAX_IDEA_BODY_CHARS = 8_000;
