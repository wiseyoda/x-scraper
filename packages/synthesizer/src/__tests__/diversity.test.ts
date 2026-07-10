import type { IdeaFrontmatter } from '@x-scraper/core';
import type { VaultListEntry, VaultRecord, VaultStore } from '@x-scraper/vault';
import { describe, expect, it } from 'vitest';

import { SYNTHESIS_PROMPT_VERSION } from '../constants.js';
import {
  clusterDiversityScore,
  isEchoChamberCluster,
  rankClustersByDiversity,
} from '../diversity.js';
import { ideaIdForCluster, persistIdea } from '../persist.js';
import type { ClaimCluster, ClaimRef, IdeaDraft } from '../types.js';

const claim = (over: Partial<ClaimRef>): ClaimRef => ({
  id: over.id ?? 'c1',
  subject: over.subject ?? 'X',
  predicate: over.predicate ?? 'is',
  object: over.object ?? 'Y',
  text: over.text ?? 'x',
  confidence: over.confidence ?? 0.8,
  sourceId: over.sourceId ?? 'src_1',
  ...(over.authorHandle === undefined ? {} : { authorHandle: over.authorHandle }),
});

const cluster = (over: {
  sources: number;
  authors?: string[];
  anchor?: string;
}): ClaimCluster => {
  const claims: ClaimRef[] = [];
  for (let i = 0; i < Math.max(3, over.sources); i++) {
    const author =
      over.authors !== undefined && over.authors.length > 0
        ? over.authors[i % over.authors.length]
        : undefined;
    claims.push(
      claim({
        id: `c_${String(i)}`,
        sourceId: `src_${String(i % over.sources)}`,
        ...(author === undefined ? {} : { authorHandle: author }),
      }),
    );
  }
  return {
    anchor: over.anchor ?? 'topic',
    claims,
    sourceIds: Array.from({ length: over.sources }, (_, i) => `src_${String(i)}`),
  };
};

describe('cluster diversity', () => {
  it('scores multi-source multi-author above two-source single-author echo', () => {
    const diverse = cluster({ sources: 5, authors: ['a', 'b', 'c'] });
    const echo = cluster({ sources: 2, authors: ['only'] });
    expect(clusterDiversityScore(diverse)).toBeGreaterThan(clusterDiversityScore(echo));
    expect(isEchoChamberCluster(echo)).toBe(true);
    expect(isEchoChamberCluster(diverse)).toBe(false);
  });

  it('rankClustersByDiversity puts diverse first', () => {
    const diverse = cluster({ sources: 6, authors: ['a', 'b'], anchor: 'd' });
    const echo = cluster({ sources: 2, authors: ['z'], anchor: 'e' });
    const ranked = rankClustersByDiversity([echo, diverse]);
    expect(ranked[0]?.anchor).toBe('d');
  });
});

describe('persist re-synthesis identity', () => {
  const makeFakeVault = (seed: Map<string, VaultRecord>): VaultStore => ({
    root: '/tmp/fake',
    init: () => Promise.reject(new Error('no')),
    write: (record) => {
      seed.set(record.frontmatter.id, record);
      return Promise.resolve(record.frontmatter.id);
    },
    read: (id) => {
      const r = seed.get(id);
      if (r === undefined) return Promise.reject(new Error('nf'));
      return Promise.resolve(r);
    },
    list: (): Promise<VaultListEntry[]> => Promise.resolve([]),
    commit: () => Promise.resolve(null),
  });

  const draft = (thesis: string): IdeaDraft => ({
    title: 'T',
    body: `# T\n\n## Thesis\n\n${thesis}\n`,
    thesis,
    evidence: ['e1'],
    openQuestions: ['q1'],
    watchFors: ['w1'],
    confidence: 0.8,
    caveat: null,
  });

  it('re-synth with more claims updates same idea id (no fork)', async () => {
    const seed = new Map<string, VaultRecord>();
    const vault = makeFakeVault(seed);
    const c1 = cluster({ sources: 3, anchor: 'stable-topic' });
    const id1 = ideaIdForCluster(c1, SYNTHESIS_PROMPT_VERSION);
    const first = await persistIdea(vault, null, {
      cluster: c1,
      draft: draft('First thesis'),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(first.id).toBe(id1);

    // Same anchor, more sources/claims — identity must not fork.
    const c2: ClaimCluster = {
      ...c1,
      claims: [
        ...c1.claims,
        claim({ id: 'c_new', sourceId: 'src_9', authorHandle: 'new_author' }),
      ],
      sourceIds: [...c1.sourceIds, 'src_9'],
    };
    const id2 = ideaIdForCluster(c2, SYNTHESIS_PROMPT_VERSION);
    expect(id2).toBe(id1);

    const second = await persistIdea(vault, null, {
      cluster: c2,
      draft: draft('Updated thesis with new evidence'),
      now: () => new Date('2026-06-01T00:00:00.000Z'),
    });
    expect(second.id).toBe(id1);
    expect(second.created).toBe(false);
    const written = seed.get(id1);
    expect(written).toBeDefined();
    const fm = written?.frontmatter as IdeaFrontmatter;
    expect(fm.sources).toContain('src_9');
    expect(written?.body).toContain('Updated thesis');
  });
});
