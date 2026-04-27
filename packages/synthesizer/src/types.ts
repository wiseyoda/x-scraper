/**
 * Synthesizer types.
 *
 * IdeaDraft is the LLM output shape — a synthesized claim cluster
 * before it's persisted. After persistence it becomes an Idea
 * frontmatter record on disk + a graph node.
 */

export interface ClaimRef {
  /** Claim id from the vault. */
  id: string;
  subject: string;
  predicate: string;
  object: string;
  /** Plain-text claim body (for the LLM). */
  text: string;
  confidence: number;
  /** First (and currently only) source the claim came from. */
  sourceId: string;
}

/**
 * A candidate cluster of claims that share an anchor (subject right
 * now; later: shared concept entity, semantic neighborhood, etc).
 *
 * Survives admission iff:
 *   - claims.length >= MIN_CLAIMS_PER_CLUSTER
 *   - distinct(claims.sourceId).length >= MIN_SOURCES_PER_CLUSTER
 */
export interface ClaimCluster {
  /** Stable cluster key — used as part of the Idea id derivation. */
  anchor: string;
  /** Claims in the cluster. */
  claims: ClaimRef[];
  /** Distinct source ids that contributed claims. */
  sourceIds: string[];
}

/**
 * The LLM-synthesized output for one cluster, before persistence.
 */
export interface IdeaDraft {
  /** Short title (≤120 chars). */
  title: string;
  /** Synthesized 1-3 paragraph body summarizing what the cluster expresses. */
  body: string;
  /** Confidence the synthesizer has in cross-source agreement (0..1). */
  confidence: number;
  /** Optional warning about disagreement / open question among the claims. */
  caveat: string | null;
}

export interface SynthesisResult {
  /** Idea ids written this run. */
  ideaIdsWritten: string[];
  /** Clusters skipped because an Idea already exists. */
  skippedExisting: number;
  /** Clusters that didn't pass the admission thresholds. */
  belowThreshold: number;
  /** Total LLM cost for this run. */
  costUsd: number;
}
