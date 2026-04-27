/**
 * Cluster claims by shared anchor.
 *
 * v1: anchor = normalized subject (lowercase, NFKC, trimmed). Cheap,
 * grounded in the claim text, avoids needing graph traversal in the
 * first slice. Future: anchor on resolved entity ids, on cooccurring
 * Concept ids, on semantic centroids.
 *
 * Admission threshold: a cluster needs at least MIN_CLAIMS_PER_CLUSTER
 * claims AND at least MIN_SOURCES_PER_CLUSTER distinct sources before
 * it's worth synthesizing into an Idea. One claim from one source is
 * a fact, not a pattern.
 */

import { MIN_CLAIMS_PER_CLUSTER, MIN_SOURCES_PER_CLUSTER } from './constants.js';
import type { ClaimCluster, ClaimRef } from './types.js';

export const normalizeAnchor = (s: string): string => s.normalize('NFKC').trim().toLowerCase();

export interface ClusterClaimsOptions {
  minClaims?: number;
  minSources?: number;
}

export const clusterClaims = (
  claims: ClaimRef[],
  options: ClusterClaimsOptions = {},
): { admitted: ClaimCluster[]; belowThreshold: number } => {
  const minClaims = options.minClaims ?? MIN_CLAIMS_PER_CLUSTER;
  const minSources = options.minSources ?? MIN_SOURCES_PER_CLUSTER;

  const buckets = new Map<string, ClaimRef[]>();
  for (const c of claims) {
    const key = normalizeAnchor(c.subject);
    if (key.length === 0) continue;
    const list = buckets.get(key) ?? [];
    list.push(c);
    buckets.set(key, list);
  }

  const admitted: ClaimCluster[] = [];
  let belowThreshold = 0;
  for (const [anchor, group] of buckets) {
    if (group.length < minClaims) {
      belowThreshold += 1;
      continue;
    }
    const sourceIds = Array.from(new Set(group.map((c) => c.sourceId)));
    if (sourceIds.length < minSources) {
      belowThreshold += 1;
      continue;
    }
    admitted.push({ anchor, claims: group, sourceIds });
  }
  // Determinism: largest clusters first so subsequent runs that hit a
  // budget cap process the most-loaded clusters before the long tail.
  admitted.sort((a, b) => b.claims.length - a.claims.length || a.anchor.localeCompare(b.anchor));
  return { admitted, belowThreshold };
};
