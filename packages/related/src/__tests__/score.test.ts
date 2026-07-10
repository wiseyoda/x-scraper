import { describe, expect, it } from 'vitest';

import {
  createCorpus,
  linkAuthor,
  linkClaim,
  linkEntityMember,
  setEmbeddingNeighbors,
  setKind,
  setSourceCapturedAt,
} from '../corpus.js';
import { attachmentEventsSince, rankRelated } from '../score.js';

describe('rankRelated — co-entity', () => {
  it('returns non-empty related for two sources sharing an entity, ordered by signal', () => {
    const c = createCorpus();
    setKind(c, 'ent_claude', 'Tool', 'Claude Code');
    setKind(c, 'src_a', 'Source', 'https://x.com/a/1');
    setKind(c, 'src_b', 'Source', 'https://x.com/b/1');
    setKind(c, 'src_weak', 'Source', 'https://x.com/c/1');
    setKind(c, 'idea_cc', 'Idea', 'Claude Code');

    linkEntityMember(c, 'ent_claude', 'src_a', 'Claude Code');
    linkEntityMember(c, 'ent_claude', 'src_b', 'Claude Code');
    linkEntityMember(c, 'ent_claude', 'idea_cc', 'Claude Code', 'Idea');

    linkAuthor(c, 'src_a', 'alice');
    linkAuthor(c, 'src_weak', 'alice');

    const hits = rankRelated(c, 'src_a', { limit: 10 });
    expect(hits.length).toBeGreaterThanOrEqual(1);

    const ids = hits.map((h) => h.targetId);
    expect(ids).toContain('src_b');
    expect(ids).toContain('idea_cc');

    const b = hits.find((h) => h.targetId === 'src_b');
    const weak = hits.find((h) => h.targetId === 'src_weak');
    expect(b).toBeDefined();
    if (b === undefined) return;
    expect(b.score).toBeGreaterThan(0);
    expect(b.reason.length).toBeGreaterThan(0);
    expect(b.reason.toLowerCase()).toContain('claude');

    if (weak !== undefined) {
      expect(b.score).toBeGreaterThan(weak.score);
    }

    for (let i = 1; i < hits.length; i++) {
      const prev = hits[i - 1];
      const cur = hits[i];
      if (prev === undefined || cur === undefined) continue;
      expect(cur.score).toBeLessThanOrEqual(prev.score);
    }
  });

  it('empty corpus yields empty list without throw', () => {
    const c = createCorpus();
    expect(rankRelated(c, 'missing')).toEqual([]);
  });
});

describe('rankRelated — co-claim', () => {
  it('connects sources that claim about the same subject', () => {
    const c = createCorpus();
    setKind(c, 'src_1', 'Source');
    setKind(c, 'src_2', 'Source');
    linkClaim(c, 'claim_1', 'src_1', 'claude code');
    linkClaim(c, 'claim_2', 'src_2', 'claude code');

    const hits = rankRelated(c, 'src_1');
    const peer = hits.find((h) => h.targetId === 'src_2');
    expect(peer).toBeDefined();
    if (peer === undefined) return;
    expect(peer.score).toBeGreaterThan(0);
    expect(peer.reason.toLowerCase()).toContain('claim');
  });
});

describe('rankRelated — embedding neighbors', () => {
  it('includes embedding neighbor with positive score', () => {
    const c = createCorpus();
    setKind(c, 'src_x', 'Source');
    setKind(c, 'src_y', 'Source');
    setEmbeddingNeighbors(c, 'src_x', [{ id: 'src_y', score: 0.9 }]);

    const hits = rankRelated(c, 'src_x');
    const y = hits.find((h) => h.targetId === 'src_y');
    expect(y).toBeDefined();
    if (y === undefined) return;
    expect(y.reason.toLowerCase()).toContain('embedding');
    expect(y.score).toBeGreaterThan(0);
  });
});

describe('attachmentEventsSince', () => {
  it('emits attachment when a new source shares an entity with an existing idea', () => {
    const c = createCorpus();
    setKind(c, 'ent_x', 'Tool', 'Superpowers');
    setKind(c, 'idea_sp', 'Idea', 'Superpowers');
    setKind(c, 'src_old', 'Source');
    setKind(c, 'src_new', 'Source');
    linkEntityMember(c, 'ent_x', 'src_old', 'Superpowers');
    linkEntityMember(c, 'ent_x', 'idea_sp', 'Superpowers', 'Idea');
    linkEntityMember(c, 'ent_x', 'src_new', 'Superpowers');
    setSourceCapturedAt(c, 'src_old', '2026-01-01T00:00:00.000Z');
    setSourceCapturedAt(c, 'src_new', '2026-06-01T00:00:00.000Z');

    const events = attachmentEventsSince(c, '2026-05-01T00:00:00.000Z');
    expect(events.length).toBeGreaterThanOrEqual(1);
    const hit = events.find((e) => e.sourceId === 'src_new' && e.targetId === 'idea_sp');
    expect(hit).toBeDefined();
    if (hit === undefined) return;
    expect(hit.reason.length).toBeGreaterThan(0);
    expect(hit.score).toBeGreaterThan(0);
  });

  it('returns empty when since is in the future', () => {
    const c = createCorpus();
    setSourceCapturedAt(c, 'src_a', '2026-01-01T00:00:00.000Z');
    expect(attachmentEventsSince(c, '2099-01-01T00:00:00.000Z')).toEqual([]);
  });
});
