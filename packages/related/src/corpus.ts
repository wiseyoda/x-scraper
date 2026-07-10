/**
 * Helpers to mutate a RelatedCorpus while building from vault/fixtures.
 */

import { emptyCorpus } from './score.js';
import type { RelatedCorpus, RelatedKind } from './types.js';

const addToSetMap = (map: Map<string, Set<string>>, key: string, value: string): void => {
  let set = map.get(key);
  if (set === undefined) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
};

export const createCorpus = (): RelatedCorpus => emptyCorpus();

export const setKind = (c: RelatedCorpus, id: string, kind: RelatedKind, name?: string): void => {
  c.kinds.set(id, kind);
  if (name !== undefined && name.length > 0) c.names.set(id, name);
};

/** Link an entity to a member (source or idea). */
export const linkEntityMember = (
  c: RelatedCorpus,
  entityId: string,
  memberId: string,
  entityName?: string,
  memberKind: RelatedKind = 'Source',
): void => {
  if (entityName !== undefined) setKind(c, entityId, c.kinds.get(entityId) ?? 'Entity', entityName);
  else if (!c.kinds.has(entityId)) setKind(c, entityId, 'Entity');
  if (!c.kinds.has(memberId)) setKind(c, memberId, memberKind);
  addToSetMap(c.entityToMembers, entityId, memberId);
  addToSetMap(c.memberToEntities, memberId, entityId);
};

export const linkClaim = (
  c: RelatedCorpus,
  claimId: string,
  sourceId: string,
  subjectKey: string,
): void => {
  setKind(c, claimId, 'Claim', subjectKey);
  if (!c.kinds.has(sourceId)) setKind(c, sourceId, 'Source');
  addToSetMap(c.claimToSources, claimId, sourceId);
  addToSetMap(c.sourceToClaims, sourceId, claimId);
  const key = subjectKey.trim().toLowerCase();
  if (key.length > 0) addToSetMap(c.subjectToClaims, key, claimId);
};

export const linkAuthor = (c: RelatedCorpus, sourceId: string, authorHandle: string): void => {
  const h = authorHandle.trim().toLowerCase().replace(/^@/, '');
  if (h.length === 0) return;
  if (!c.kinds.has(sourceId)) setKind(c, sourceId, 'Source');
  c.sourceToAuthor.set(sourceId, h);
  addToSetMap(c.authorToSources, h, sourceId);
};

export const setSourceCapturedAt = (c: RelatedCorpus, sourceId: string, iso: string): void => {
  if (!c.kinds.has(sourceId)) setKind(c, sourceId, 'Source');
  c.sourceCapturedAt.set(sourceId, iso);
};

export const setEmbeddingNeighbors = (
  c: RelatedCorpus,
  seedId: string,
  neighbors: { id: string; score: number }[],
): void => {
  c.embeddingNeighbors.set(seedId, neighbors);
};

/** Normalize claim subject for co-claim matching. */
export const normalizeSubject = (s: string): string =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
