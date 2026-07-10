/**
 * Cluster diversity scoring — prefer multi-source, multi-author clusters
 * over single-narrative echo chambers.
 */

import { PREFERRED_AUTHORS_PER_CLUSTER } from './constants.js';
import type { ClaimCluster } from './types.js';

export const uniqueAuthors = (cluster: ClaimCluster): string[] => {
  const set = new Set<string>();
  for (const c of cluster.claims) {
    if (c.authorHandle !== undefined && c.authorHandle.length > 0) {
      set.add(c.authorHandle.toLowerCase());
    }
  }
  return [...set];
};

/**
 * Higher is better. Sources dominate; distinct authors are a bonus when known.
 * Used to sort admitted clusters before synthesis.
 */
export const clusterDiversityScore = (cluster: ClaimCluster): number => {
  const sources = cluster.sourceIds.length;
  const authors = uniqueAuthors(cluster).length;
  const authorBonus = authors >= PREFERRED_AUTHORS_PER_CLUSTER ? authors : authors * 0.5;
  return sources * 10 + authorBonus * 3 + cluster.claims.length;
};

/** True when the cluster looks like a 2-source / single-author echo. */
export const isEchoChamberCluster = (cluster: ClaimCluster): boolean => {
  if (cluster.sourceIds.length >= 3) return false;
  const authors = uniqueAuthors(cluster);
  if (authors.length >= PREFERRED_AUTHORS_PER_CLUSTER) return false;
  // Unknown authors: treat 2-source clusters as mild echo (still admit).
  return cluster.sourceIds.length <= 2;
};

/** Sort admitted clusters: most diverse first. */
export const rankClustersByDiversity = (clusters: ClaimCluster[]): ClaimCluster[] =>
  [...clusters].sort((a, b) => clusterDiversityScore(b) - clusterDiversityScore(a));
