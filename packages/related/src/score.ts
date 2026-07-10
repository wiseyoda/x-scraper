/**
 * Pure related ranking. No I/O — feed a RelatedCorpus built from vault/graph.
 */

import {
  DEFAULT_RELATED_LIMIT,
  MIN_RELATED_SCORE,
  WEIGHT_CO_CLAIM,
  WEIGHT_CO_ENTITY,
  WEIGHT_EMBEDDING,
  WEIGHT_SHARED_AUTHOR,
} from './constants.js';
import type { AttachmentEvent, RelatedCorpus, RelatedHit, RelatedKind } from './types.js';

interface Acc {
  score: number;
  reasons: string[];
  evidence: Set<string>;
  kind: RelatedKind;
}

const ensureAcc = (
  map: Map<string, Acc>,
  id: string,
  kind: RelatedKind,
  corpus: RelatedCorpus,
): Acc => {
  let a = map.get(id);
  if (a === undefined) {
    a = {
      score: 0,
      reasons: [],
      evidence: new Set(),
      kind: corpus.kinds.get(id) ?? kind,
    };
    map.set(id, a);
  }
  return a;
};

const addScore = (
  map: Map<string, Acc>,
  seedId: string,
  targetId: string,
  kind: RelatedKind,
  delta: number,
  reason: string,
  evidenceId: string | null,
  corpus: RelatedCorpus,
): void => {
  if (targetId === seedId || delta <= 0) return;
  const a = ensureAcc(map, targetId, kind, corpus);
  a.score += delta;
  if (!a.reasons.includes(reason)) a.reasons.push(reason);
  if (evidenceId !== null) a.evidence.add(evidenceId);
};

/** Shared-entity signal: members of the same entity clusters. */
export const scoreCoEntity = (
  corpus: RelatedCorpus,
  seedId: string,
  acc: Map<string, Acc>,
): void => {
  const entities = corpus.memberToEntities.get(seedId);
  if (entities === undefined) return;
  for (const entId of entities) {
    const members = corpus.entityToMembers.get(entId);
    if (members === undefined) continue;
    const entName = corpus.names.get(entId) ?? entId;
    const reason = `shared entity ${entName}`;
    for (const mid of members) {
      const kind = corpus.kinds.get(mid) ?? 'Source';
      addScore(acc, seedId, mid, kind, WEIGHT_CO_ENTITY, reason, entId, corpus);
    }
  }
};

/**
 * Shared-claim signal: other sources whose claims share a subject key
 * with the seed's claims (or with the seed claim itself).
 */
export const scoreCoClaim = (
  corpus: RelatedCorpus,
  seedId: string,
  acc: Map<string, Acc>,
): void => {
  const seedClaims = corpus.sourceToClaims.get(seedId);
  // Seed may itself be a claim id
  const claimIds = new Set<string>(seedClaims ?? []);
  if (corpus.kinds.get(seedId) === 'Claim') claimIds.add(seedId);

  const subjectKeys = new Set<string>();
  for (const cid of claimIds) {
    for (const [subj, claims] of corpus.subjectToClaims) {
      if (claims.has(cid)) subjectKeys.add(subj);
    }
  }
  // Also: if seed is a Source and we only know claims via reverse walk already covered.
  // If seed is Idea, no claim map — skip.

  for (const subj of subjectKeys) {
    const claims = corpus.subjectToClaims.get(subj);
    if (claims === undefined) continue;
    const reason = `shared claim subject “${subj}”`;
    for (const cid of claims) {
      if (claimIds.has(cid)) {
        // other sources on this claim
        const sources = corpus.claimToSources.get(cid);
        if (sources !== undefined) {
          for (const sid of sources) {
            addScore(acc, seedId, sid, 'Source', WEIGHT_CO_CLAIM, reason, cid, corpus);
          }
        }
      } else {
        // sibling claims with same subject → their sources
        const sources = corpus.claimToSources.get(cid);
        if (sources !== undefined) {
          for (const sid of sources) {
            addScore(acc, seedId, sid, 'Source', WEIGHT_CO_CLAIM, reason, cid, corpus);
          }
        }
        addScore(acc, seedId, cid, 'Claim', WEIGHT_CO_CLAIM * 0.5, reason, cid, corpus);
      }
    }
  }
};

/** Shared author (tweets/github handles). */
export const scoreSharedAuthor = (
  corpus: RelatedCorpus,
  seedId: string,
  acc: Map<string, Acc>,
): void => {
  const author = corpus.sourceToAuthor.get(seedId);
  if (author === undefined || author.length === 0) return;
  const peers = corpus.authorToSources.get(author);
  if (peers === undefined) return;
  const reason = `same author @${author}`;
  for (const sid of peers) {
    addScore(acc, seedId, sid, 'Source', WEIGHT_SHARED_AUTHOR, reason, null, corpus);
  }
};

/** Embedding neighbors when provided (graph path). */
export const scoreEmbeddingNeighbors = (
  corpus: RelatedCorpus,
  seedId: string,
  acc: Map<string, Acc>,
): void => {
  const neighbors = corpus.embeddingNeighbors.get(seedId);
  if (neighbors === undefined) return;
  for (const n of neighbors) {
    const kind = corpus.kinds.get(n.id) ?? 'Source';
    const delta = WEIGHT_EMBEDDING * Math.max(0, Math.min(1, n.score));
    const reason = `similar embedding (score ${n.score.toFixed(2)})`;
    addScore(acc, seedId, n.id, kind, delta, reason, null, corpus);
  }
};

export interface RankRelatedOptions {
  limit?: number;
  minScore?: number;
}

/**
 * Fuse all scorers and return ranked RelatedHit[].
 */
export const rankRelated = (
  corpus: RelatedCorpus,
  seedId: string,
  options: RankRelatedOptions = {},
): RelatedHit[] => {
  const limit = options.limit ?? DEFAULT_RELATED_LIMIT;
  const minScore = options.minScore ?? MIN_RELATED_SCORE;
  const acc = new Map<string, Acc>();

  scoreCoEntity(corpus, seedId, acc);
  scoreCoClaim(corpus, seedId, acc);
  scoreSharedAuthor(corpus, seedId, acc);
  scoreEmbeddingNeighbors(corpus, seedId, acc);

  const hits: RelatedHit[] = [];
  for (const [targetId, a] of acc) {
    if (a.score < minScore) continue;
    const reason = a.reasons[0] ?? 'related';
    const extra =
      a.reasons.length > 1 ? ` (+${String(a.reasons.length - 1)} more signals)` : '';
    hits.push({
      targetId,
      targetKind: a.kind,
      reason: `${reason}${extra}`,
      score: a.score,
      evidenceIds: [...a.evidence],
    });
  }

  hits.sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    return x.targetId.localeCompare(y.targetId);
  });
  return hits.slice(0, limit);
};

/**
 * Attachment events: for each new source since `sinceIso`, find related
 * existing ideas/entities (and strong source peers) as "what connected".
 */
export const attachmentEventsSince = (
  corpus: RelatedCorpus,
  sinceIso: string,
  options: { sourceLimit?: number; relatedLimit?: number } = {},
): AttachmentEvent[] => {
  const sinceMs = Date.parse(sinceIso);
  if (!Number.isFinite(sinceMs)) return [];

  const sourceLimit = options.sourceLimit ?? 24;
  const relatedLimit = options.relatedLimit ?? 5;

  const newSources = [...corpus.sourceCapturedAt.entries()]
    .filter(([, at]) => Date.parse(at) > sinceMs)
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, sourceLimit);

  const events: AttachmentEvent[] = [];
  for (const [sourceId, at] of newSources) {
    const hits = rankRelated(corpus, sourceId, { limit: relatedLimit + 5 });
    for (const h of hits) {
      // Prefer attachments to Ideas/Entities over peer Sources for the homepage.
      if (h.targetKind === 'Source') continue;
      events.push({
        sourceId,
        at,
        targetId: h.targetId,
        targetKind: h.targetKind,
        reason: h.reason,
        score: h.score,
      });
      if (events.filter((e) => e.sourceId === sourceId).length >= relatedLimit) break;
    }
  }

  events.sort((a, b) => {
    if (b.at !== a.at) return b.at.localeCompare(a.at);
    return b.score - a.score;
  });
  return events;
};

/** Empty corpus for tests. */
export const emptyCorpus = (): RelatedCorpus => ({
  kinds: new Map(),
  names: new Map(),
  entityToMembers: new Map(),
  memberToEntities: new Map(),
  subjectToClaims: new Map(),
  claimToSources: new Map(),
  sourceToClaims: new Map(),
  authorToSources: new Map(),
  sourceToAuthor: new Map(),
  embeddingNeighbors: new Map(),
  sourceCapturedAt: new Map(),
});
