/**
 * Synthesizer constants.
 *
 * Bumping SYNTHESIS_PROMPT_VERSION invalidates prior LLM-drafted ideas
 * in a "needs re-synthesis" sense — the older drafts stay on disk and
 * can be confirmed/rejected as is, but `xs ideas synthesize` will run
 * the new prompt on the same clusters and produce parallel drafts.
 */

/** v2 = research-thread contract (thesis / evidence / open questions / watch-fors). */
export const SYNTHESIS_PROMPT_VERSION = 2;

/**
 * Cluster admission thresholds. The "interestingness" floor: an Idea
 * worth surfacing is not a single claim from one source.
 */
export const MIN_CLAIMS_PER_CLUSTER = 3;
export const MIN_SOURCES_PER_CLUSTER = 2;
/**
 * Prefer clusters with this many distinct authors when author handles are known.
 * Clusters below this still admit if they meet source thresholds, but rank lower.
 */
export const PREFERRED_AUTHORS_PER_CLUSTER = 2;
/** Confidence haircut for 2-source / single-author echo clusters (0..1). */
export const ECHO_CHAMBER_CONFIDENCE_PENALTY = 0.15;

/** Default model + token budget for the synthesizer. Sonnet 4.6, generous. */
export const DEFAULT_SYNTHESIS_MAX_TOKENS = 8_000;

/** Idea body cap — clamps pathological LLM outputs. */
export const MAX_IDEA_BODY_CHARS = 8_000;

/**
 * Auto-confirm thresholds. When a synthesized cluster crosses BOTH
 * bars (broad evidence AND no LLM-flagged conflict), the Idea is
 * persisted as `confirmed` with `auto_confirmed: true`. Manual confirms
 * and rejects always win (see persistIdea for the precedence rules).
 *
 * Bars chosen against the live corpus distribution: the synthesizer's
 * confidence scores stay around 0.70–0.82 for broadly-evidenced clusters
 * (the LLM appropriately gets more conservative when harmonizing across
 * many sources), while single-narrative 2-source clusters land at
 * 0.92–0.97. Source count IS the cross-source signal; confidence is a
 * conflict floor, not a strength signal.
 *
 * ≥10 sources catches patterns that span genuinely multiple bookmarks
 * rather than echo-chamber-of-one. ≥0.70 rules out anything the LLM
 * flagged active disagreement on. Tune if the auto pile drifts noisy.
 */
export const AUTO_CONFIRM_CONFIDENCE = 0.7;
export const AUTO_CONFIRM_SOURCES = 10;
