/**
 * Drives the shipped related() entry with a fake vault that implements
 * the VaultStore surface used by buildCorpusFromVault.
 */
import type { EntityType, Frontmatter } from '@x-scraper/core';
import type { VaultRecord, VaultStore } from '@x-scraper/vault';
import { describe, expect, it } from 'vitest';

import { invalidateRelatedCache, related } from '../related.js';

const now = '2026-06-01T12:00:00.000Z';

const sourceFm = (id: string, url: string): Frontmatter => ({
  id,
  type: 'Source',
  created_at: now,
  updated_at: now,
  prompt_version: { extraction: 0, reconciliation: 0, embedding: 0 },
  sources: [],
  aliases: [],
  tags: [],
  topics: [],
  url,
  canonical_url: url,
  captured_at: now,
  content_type: 'tweet',
  host_metadata: { byline: 'tester' },
  content_hash: 'x',
  embedding_model: 'none',
});

const entityFm = (id: string, name: string, sources: string[]): Frontmatter => ({
  id,
  type: 'Tool',
  created_at: now,
  updated_at: now,
  prompt_version: { extraction: 0, reconciliation: 0, embedding: 0 },
  sources,
  aliases: [],
  tags: [],
  topics: [],
  name,
});

const ideaFm = (id: string, subject: string, sources: string[]): Frontmatter => ({
  id,
  type: 'Idea',
  created_at: now,
  updated_at: now,
  prompt_version: { extraction: 0, reconciliation: 0, embedding: 0 },
  sources,
  aliases: [],
  tags: [],
  topics: [],
  tier: 1,
  status: 'confirmed',
  subject,
  synthesizer_confidence: 0.8,
  synthesizer_version: 1,
  synthesized_at: now,
  derived_from: [],
  edited_body: false,
  auto_confirmed: false,
});

const makeVault = (records: VaultRecord[]): VaultStore => {
  const byType = new Map<string, VaultRecord[]>();
  for (const r of records) {
    const t = r.frontmatter.type;
    const list = byType.get(t) ?? [];
    list.push(r);
    byType.set(t, list);
  }
return {
    root: '/fake-vault-related-test',
    init: () => Promise.resolve(),
    read: (id: string, type: EntityType) => {
      const list = byType.get(type) ?? [];
      const found = list.find((r) => r.frontmatter.id === id);
      if (found === undefined) return Promise.reject(new Error(`missing ${type} ${id}`));
      return Promise.resolve(found);
    },
    write: (rec: VaultRecord) => Promise.resolve(rec.frontmatter.id),
    list: (type?: EntityType) => {
      if (type === undefined) return Promise.resolve([]);
      return Promise.resolve(
        (byType.get(type) ?? []).map((r) => ({
          id: r.frontmatter.id,
          type,
          path: `${type}/${r.frontmatter.id}.md`,
          relativePath: `${type}/${r.frontmatter.id}.md`,
          mtime: new Date(now),
        })),
      );
    },
    commit: () => Promise.resolve(null),
  };
};

describe('related() shipped entry', () => {
  it('returns co-entity hits for a multi-source fixture vault', async () => {
    invalidateRelatedCache();
    const vault = makeVault([
      { frontmatter: sourceFm('src_a', 'https://x.com/a/1'), body: 'about claude code' },
      { frontmatter: sourceFm('src_b', 'https://x.com/b/1'), body: 'more claude code' },
      {
        frontmatter: entityFm('tool_cc', 'Claude Code', ['src_a', 'src_b']),
        body: '',
      },
      {
        frontmatter: ideaFm('idea_cc', 'Claude Code', ['src_a', 'src_b']),
        body: '# Claude Code\n',
      },
    ]);

    const result = await related({ vault, graph: null }, { id: 'src_a', limit: 10 });
    expect(result.graphDegraded).toBe(true);
    expect(result.mode).toBe('vault');
    expect(result.hits.length).toBeGreaterThanOrEqual(1);
    const ids = result.hits.map((h) => h.targetId);
    expect(ids).toContain('src_b');
    const peer = result.hits.find((h) => h.targetId === 'src_b');
    expect(peer).toBeDefined();
    if (peer === undefined) return;
    expect(peer.reason.length).toBeGreaterThan(0);
    expect(peer.score).toBeGreaterThan(0);
  });
});
