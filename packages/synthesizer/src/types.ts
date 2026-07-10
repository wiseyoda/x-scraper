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
  /** Optional author handle for diversity scoring (from source URL/byline). */
  authorHandle?: string;
}

/**
 * Entity loaded from the vault for entity-anchored clustering.
 * Used by clusterByEntity to anchor claim clusters on entities that
 * span multiple sources (the actual cross-source signal lives here,
 * not in claim subjects which the LLM tends to anchor per-source).
 */
export interface EntityRef {
  id: string;
  type: string;
  /** Display name (e.g. "Claude Code", "Anthropic"). */
  name: string;
  /** Alternative surface forms. */
  aliases: string[];
  /** Source ids that mention this entity. */
  sources: string[];
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
  /**
   * Entity id when the cluster was anchored on an entity rather than a
   * raw subject string. Lets persist.ts wire SYNTHESIZED_FROM edges
   * back to the entity for graph navigation.
   */
  entityId?: string;
  /** Display name when the anchor is normalized (lowercased, trimmed). */
  anchorDisplay?: string;
}

/**
 * The LLM-synthesized output for one cluster, before persistence.
 * body is always the formatted research-thread markdown (v2).
 */
export interface IdeaDraft {
  /** Short title (≤120 chars). */
  title: string;
  /** Formatted research-thread markdown (thesis / evidence / open questions / watch-fors). */
  body: string;
  /** Thesis sentence(s) — also embedded in body. */
  thesis: string;
  evidence: string[];
  openQuestions: string[];
  watchFors: string[];
  /** Confidence the synthesizer has in cross-source agreement (0..1). */
  confidence: number;
  /** Optional warning about disagreement / open question among the claims. */
  caveat: string | null;
}

export interface SynthesisResult {
  /** Idea ids written this run. */
  ideaIdsWritten: string[];
  /** Of those written, how many landed at status='confirmed' via auto-confirm. */
  autoConfirmed: number;
  /** Clusters skipped because an Idea already exists. */
  skippedExisting: number;
  /** Clusters that didn't pass the admission thresholds. */
  belowThreshold: number;
  /** Total LLM cost for this run. */
  costUsd: number;
}
