/**
 * Cluster claims into idea-worthy groups.
 *
 * v2 default: cluster by ENTITY. The LLM extractor tends to anchor
 * claims on per-source subjects ("claude-code", "anthropic-cookbook")
 * so a pure subject-string match misses cross-source agreement. The
 * actual cross-source signal lives in the entity graph: "Anthropic"
 * mentioned in 6 sources, "Claude Code" in 5, etc. Entity-anchored
 * clustering walks each entity's name+aliases against every claim's
 * subject AND object so a claim mentioning "Claude Code" anywhere
 * — as a subject, an object, or an alias — joins that entity's cluster.
 *
 * v1 (clusterClaims, subject-only) is kept as a fallback/explicit option.
 *
 * Admission threshold: a cluster needs ≥MIN_CLAIMS_PER_CLUSTER claims
 * AND ≥MIN_SOURCES_PER_CLUSTER distinct sources.
 */

import { MIN_CLAIMS_PER_CLUSTER, MIN_SOURCES_PER_CLUSTER } from './constants.js';
import type { ClaimCluster, ClaimRef, EntityRef } from './types.js';

export const normalizeAnchor = (s: string): string => s.normalize('NFKC').trim().toLowerCase();

/**
 * Loose-equality normalization for entity-anchor matching. Collapses
 * runs of whitespace, hyphens, and underscores to a single space so
 * "Claude Code", "claude-code", and "claude_code" all compare equal.
 * Used ONLY for entity-cluster matching — the canonical anchor stays
 * exactly what normalizeAnchor returns.
 *
 * Why: extractor subjects often arrive as kebab-case (`claude-code`)
 * while entity names are display-cased (`Claude Code`). Without this,
 * the entity for "Claude Code" mentioned in 5 sources would never
 * match the 40 `claude-code` claims pointing at it.
 */
export const looseAnchor = (s: string): string =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();

export interface ClusterClaimsOptions {
  minClaims?: number;
  minSources?: number;
}

/**
 * Subject-anchored clustering (v1). Buckets claims by normalized subject.
 * Keep it around for tests and as an opt-in fallback.
 */
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
  admitted.sort((a, b) => b.claims.length - a.claims.length || a.anchor.localeCompare(b.anchor));
  return { admitted, belowThreshold };
};

const MIN_TOKEN_LEN = 2;

/**
 * Match strategy: an entity matches a claim when the claim's normalized
 * subject OR object exactly equals the entity's normalized name OR any
 * normalized alias. Single-token names shorter than MIN_TOKEN_LEN are
 * dropped (avoids "ai", "an" matching everything).
 */
const buildEntitySurfaceForms = (entity: EntityRef): string[] => {
  const set = new Set<string>();
  const candidates = [entity.name, ...entity.aliases];
  for (const c of candidates) {
    const norm = looseAnchor(c);
    if (norm.length < MIN_TOKEN_LEN) continue;
    set.add(norm);
  }
  return Array.from(set);
};

/**
 * Entity-anchored clustering (v2 — current default). For each entity
 * with ≥minSources sources, find claims whose normalized subject OR
 * object matches the entity's name or any alias. A single claim can
 * appear in multiple entity clusters (e.g. "Anthropic authors
 * claude-code" feeds both the Anthropic and Claude-Code Ideas), and
 * that's fine — Ideas are about the entity, not about owning the claim.
 */
export const clusterByEntity = (
  claims: ClaimRef[],
  entities: EntityRef[],
  options: ClusterClaimsOptions = {},
): { admitted: ClaimCluster[]; belowThreshold: number } => {
  const minClaims = options.minClaims ?? MIN_CLAIMS_PER_CLUSTER;
  const minSources = options.minSources ?? MIN_SOURCES_PER_CLUSTER;

  // Pre-normalize claim fields once. Use looseAnchor so kebab-case
  // subjects (`claude-code`) match display-case entity names
  // (`Claude Code`).
  const normalizedClaims = claims.map((c) => ({
    claim: c,
    subject: looseAnchor(c.subject),
    object: looseAnchor(c.object),
  }));

  const admitted: ClaimCluster[] = [];
  let belowThreshold = 0;

  for (const entity of entities) {
    if (entity.sources.length < minSources) {
      belowThreshold += 1;
      continue;
    }
    const surfaces = buildEntitySurfaceForms(entity);
    if (surfaces.length === 0) {
      belowThreshold += 1;
      continue;
    }
    const matched: ClaimRef[] = [];
    const matchedIds = new Set<string>();
    for (const { claim, subject, object } of normalizedClaims) {
      let hit = false;
      for (const s of surfaces) {
        if (subject === s || object === s) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
      if (matchedIds.has(claim.id)) continue;
      matchedIds.add(claim.id);
      matched.push(claim);
    }
    if (matched.length < minClaims) {
      belowThreshold += 1;
      continue;
    }
    const sourceIds = Array.from(new Set(matched.map((c) => c.sourceId)));
    if (sourceIds.length < minSources) {
      belowThreshold += 1;
      continue;
    }
    admitted.push({
      anchor: normalizeAnchor(entity.name),
      anchorDisplay: entity.name,
      entityId: entity.id,
      claims: matched,
      sourceIds,
    });
  }

  // Largest first (claim count, then alphabetical).
  admitted.sort((a, b) => b.claims.length - a.claims.length || a.anchor.localeCompare(b.anchor));
  return { admitted, belowThreshold };
};
