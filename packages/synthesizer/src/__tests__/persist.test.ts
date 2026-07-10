import type { EntityType, IdeaFrontmatter } from '@x-scraper/core';
import type { VaultListEntry, VaultRecord, VaultStore } from '@x-scraper/vault';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  AUTO_CONFIRM_CONFIDENCE,
  AUTO_CONFIRM_SOURCES,
  SYNTHESIS_PROMPT_VERSION,
} from '../constants.js';
import { ideaIdForCluster, persistIdea } from '../persist.js';
import type { ClaimCluster, ClaimRef, IdeaDraft } from '../types.js';

/**
 * In-memory VaultStore stub. Satisfies the port without touching disk.
 * Only `read` and `write` are exercised by persistIdea; the rest throw
 * so any accidental dependency surfaces fast.
 */
const makeFakeVault = (seed: Map<string, VaultRecord> = new Map()): VaultStore => {
  const records = seed;
  return {
    root: '/tmp/fake-vault',
    init: () => Promise.reject(new Error('init not implemented')),
    write: (record: VaultRecord): Promise<string> => {
      records.set(record.frontmatter.id, record);
      return Promise.resolve(`/tmp/fake-vault/${record.frontmatter.id}.md`);
    },
    read: (id: string, _type: EntityType): Promise<VaultRecord> => {
      const r = records.get(id);
      if (r === undefined) return Promise.reject(new Error(`not found: ${id}`));
      return Promise.resolve(r);
    },
    list: (): Promise<VaultListEntry[]> => Promise.resolve([]),
    commit: () => Promise.resolve(null),
  };
};

const claim = (over: Partial<ClaimRef> = {}): ClaimRef => ({
  id: over.id ?? 'claim_x',
  subject: over.subject ?? 'Anthropic',
  predicate: over.predicate ?? 'ships',
  object: over.object ?? 'Claude',
  text: over.text ?? 'Anthropic ships Claude.',
  confidence: over.confidence ?? 0.9,
  sourceId: over.sourceId ?? 'src_a',
});

const cluster = (over: Partial<ClaimCluster> & { sourceCount?: number }): ClaimCluster => {
  const sourceCount = over.sourceCount ?? 5;
  const claims =
    over.claims ??
    Array.from({ length: Math.max(sourceCount, 3) }, (_, i) =>
      claim({ id: `claim_${String(i)}`, sourceId: `src_${String(i)}` }),
    );
  const sourceIds = over.sourceIds ?? claims.map((c) => c.sourceId).slice(0, sourceCount);
  const result: ClaimCluster = {
    anchor: over.anchor ?? 'anthropic',
    anchorDisplay: over.anchorDisplay ?? 'Anthropic',
    claims,
    sourceIds,
  };
  if (over.entityId !== undefined) result.entityId = over.entityId;
  return result;
};

const draft = (confidence: number): IdeaDraft => ({
  title: 'Anthropic',
  body: '# Anthropic\n\n## Thesis\n\nAnthropic ships Claude.\n',
  thesis: 'Anthropic ships Claude.',
  evidence: ['Multi-source claims about Claude'],
  openQuestions: ['How does pricing evolve?'],
  watchFors: ['New model launches'],
  caveat: null,
  confidence,
});

const HIGH = AUTO_CONFIRM_CONFIDENCE + 0.05;
const LOW = AUTO_CONFIRM_CONFIDENCE - 0.05;
const STALE_NOW = (): Date => new Date('2026-01-01T00:00:00.000Z');
const FRESH_NOW = (): Date => new Date('2026-05-01T00:00:00.000Z');

describe('persistIdea — auto-confirm policy', () => {
  let vault: VaultStore;
  let seed: Map<string, VaultRecord>;

  beforeEach(() => {
    seed = new Map();
    vault = makeFakeVault(seed);
  });

  it('auto-confirms a new cluster that crosses both bars', async () => {
    const c = cluster({ sourceCount: AUTO_CONFIRM_SOURCES });
    const result = await persistIdea(vault, null, {
      cluster: c,
      draft: draft(HIGH),
      now: FRESH_NOW,
    });
    expect(result.status).toBe('confirmed');
    expect(result.autoConfirmed).toBe(true);
    expect(result.created).toBe(true);

    const written = seed.get(result.id);
    expect(written).toBeDefined();
    const fm = written?.frontmatter as IdeaFrontmatter;
    expect(fm.status).toBe('confirmed');
    expect(fm.auto_confirmed).toBe(true);
  });

  it('leaves a new cluster below the confidence bar as draft', async () => {
    const c = cluster({ sourceCount: AUTO_CONFIRM_SOURCES });
    const result = await persistIdea(vault, null, {
      cluster: c,
      draft: draft(LOW),
      now: FRESH_NOW,
    });
    expect(result.status).toBe('draft');
    expect(result.autoConfirmed).toBe(false);
  });

  it('leaves a new cluster below the source bar as draft (high-conf-low-evidence case)', async () => {
    const c = cluster({ sourceCount: AUTO_CONFIRM_SOURCES - 1 });
    const result = await persistIdea(vault, null, {
      cluster: c,
      draft: draft(HIGH),
      now: FRESH_NOW,
    });
    expect(result.status).toBe('draft');
    expect(result.autoConfirmed).toBe(false);
  });

  it('preserves a manual confirm even when current evidence would not auto-confirm', async () => {
    const c = cluster({ sourceCount: AUTO_CONFIRM_SOURCES - 1 });
    const id = ideaIdForCluster(c, SYNTHESIS_PROMPT_VERSION);
    seed.set(id, {
      frontmatter: {
        id,
        type: 'Idea',
        created_at: STALE_NOW().toISOString(),
        updated_at: STALE_NOW().toISOString(),
        prompt_version: { extraction: 0, reconciliation: 0, embedding: 0 },
        sources: c.sourceIds,
        aliases: [],
        tags: [],
        topics: [],
        tier: 1,
        status: 'confirmed',
        subject: c.anchorDisplay ?? c.anchor,
        synthesizer_confidence: 0.5,
        synthesizer_version: 1,
        synthesized_at: STALE_NOW().toISOString(),
        derived_from: [],
        edited_body: false,
        auto_confirmed: false,
      } satisfies IdeaFrontmatter,
      body: 'manual',
    });
    const result = await persistIdea(vault, null, {
      cluster: c,
      draft: draft(LOW),
      now: FRESH_NOW,
    });
    expect(result.status).toBe('confirmed');
    expect(result.autoConfirmed).toBe(false);
  });

  it('preserves a manual reject even when current evidence would auto-confirm', async () => {
    const c = cluster({ sourceCount: AUTO_CONFIRM_SOURCES });
    const id = ideaIdForCluster(c, SYNTHESIS_PROMPT_VERSION);
    seed.set(id, {
      frontmatter: {
        id,
        type: 'Idea',
        created_at: STALE_NOW().toISOString(),
        updated_at: STALE_NOW().toISOString(),
        prompt_version: { extraction: 0, reconciliation: 0, embedding: 0 },
        sources: c.sourceIds,
        aliases: [],
        tags: [],
        topics: [],
        tier: 1,
        status: 'rejected',
        subject: c.anchorDisplay ?? c.anchor,
        synthesizer_confidence: 0.5,
        synthesizer_version: 1,
        synthesized_at: STALE_NOW().toISOString(),
        derived_from: [],
        edited_body: false,
        auto_confirmed: false,
      } satisfies IdeaFrontmatter,
      body: 'rejected',
    });
    const result = await persistIdea(vault, null, {
      cluster: c,
      draft: draft(HIGH),
      now: FRESH_NOW,
    });
    expect(result.status).toBe('rejected');
    expect(result.autoConfirmed).toBe(false);
  });

  it('downgrades a prior auto-confirm when evidence weakens', async () => {
    const c = cluster({ sourceCount: AUTO_CONFIRM_SOURCES - 1 });
    const id = ideaIdForCluster(c, SYNTHESIS_PROMPT_VERSION);
    seed.set(id, {
      frontmatter: {
        id,
        type: 'Idea',
        created_at: STALE_NOW().toISOString(),
        updated_at: STALE_NOW().toISOString(),
        prompt_version: { extraction: 0, reconciliation: 0, embedding: 0 },
        sources: c.sourceIds,
        aliases: [],
        tags: [],
        topics: [],
        tier: 1,
        status: 'confirmed',
        subject: c.anchorDisplay ?? c.anchor,
        synthesizer_confidence: HIGH,
        synthesizer_version: 1,
        synthesized_at: STALE_NOW().toISOString(),
        derived_from: [],
        edited_body: false,
        auto_confirmed: true,
      } satisfies IdeaFrontmatter,
      body: 'auto',
    });
    const result = await persistIdea(vault, null, {
      cluster: c,
      draft: draft(LOW),
      now: FRESH_NOW,
    });
    expect(result.status).toBe('draft');
    expect(result.autoConfirmed).toBe(false);
  });

  it('upgrades a stale draft to auto-confirmed when new evidence crosses the bar', async () => {
    const c = cluster({ sourceCount: AUTO_CONFIRM_SOURCES });
    const id = ideaIdForCluster(c, SYNTHESIS_PROMPT_VERSION);
    seed.set(id, {
      frontmatter: {
        id,
        type: 'Idea',
        created_at: STALE_NOW().toISOString(),
        updated_at: STALE_NOW().toISOString(),
        prompt_version: { extraction: 0, reconciliation: 0, embedding: 0 },
        sources: c.sourceIds.slice(0, 2),
        aliases: [],
        tags: [],
        topics: [],
        tier: 1,
        status: 'draft',
        subject: c.anchorDisplay ?? c.anchor,
        synthesizer_confidence: LOW,
        synthesizer_version: 1,
        synthesized_at: STALE_NOW().toISOString(),
        derived_from: [],
        edited_body: false,
        auto_confirmed: false,
      } satisfies IdeaFrontmatter,
      body: 'old',
    });
    const result = await persistIdea(vault, null, {
      cluster: c,
      draft: draft(HIGH),
      now: FRESH_NOW,
    });
    expect(result.status).toBe('confirmed');
    expect(result.autoConfirmed).toBe(true);
  });

  it('preserves edited_body and created_at across re-synthesis (smoke)', async () => {
    const c = cluster({ sourceCount: AUTO_CONFIRM_SOURCES });
    const id = ideaIdForCluster(c, SYNTHESIS_PROMPT_VERSION);
    const created = STALE_NOW().toISOString();
    seed.set(id, {
      frontmatter: {
        id,
        type: 'Idea',
        created_at: created,
        updated_at: created,
        prompt_version: { extraction: 0, reconciliation: 0, embedding: 0 },
        sources: c.sourceIds,
        aliases: [],
        tags: [],
        topics: [],
        tier: 1,
        status: 'draft',
        subject: c.anchorDisplay ?? c.anchor,
        synthesizer_confidence: LOW,
        synthesizer_version: 1,
        synthesized_at: created,
        derived_from: [],
        edited_body: true,
        auto_confirmed: false,
      } satisfies IdeaFrontmatter,
      body: '# Hand-written body — keep me',
    });
    await persistIdea(vault, null, {
      cluster: c,
      draft: draft(HIGH),
      now: FRESH_NOW,
    });
    const written = seed.get(id);
    expect(written).toBeDefined();
    const fm = written?.frontmatter as IdeaFrontmatter;
    expect(fm.created_at).toBe(created);
    expect(fm.edited_body).toBe(true);
    expect(written?.body).toBe('# Hand-written body — keep me');
  });
});
