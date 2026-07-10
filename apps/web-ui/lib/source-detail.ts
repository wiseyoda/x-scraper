/**
 * Build the rich data shape for /sources/[id] in one pass.
 *
 * Related hits come from the shared @x-scraper/related engine (same as
 * `xs related`) — not a page-local reimplementation of ranking.
 */

import 'server-only';

import type {
  ClaimFrontmatter,
  EntityFrontmatter,
  EntityType,
  IdeaFrontmatter,
  SourceFrontmatter,
} from '@x-scraper/core';
import { related, type RelatedHit } from '@x-scraper/related';
import type { VaultStore } from '@x-scraper/vault';

import { getVault } from './vault';

const ENTITY_TYPES: EntityType[] = [
  'Person',
  'Tool',
  'Concept',
  'Repo',
  'Article',
  'Tweet',
  'Video',
  'PDF',
];

export interface SourceClaim {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  body: string;
  confidence: number;
}

export interface RelatedEntity {
  id: string;
  type: EntityType;
  name: string;
  sourceCount: number;
}

export interface RelatedIdea {
  id: string;
  subject: string;
  status: 'draft' | 'confirmed' | 'rejected';
  confidence: number;
  sourceCount: number;
  autoConfirmed: boolean;
}

/** Shared related engine hit, enriched for UI routing. */
export interface RelatedVaultHit {
  targetId: string;
  targetKind: string;
  reason: string;
  score: number;
  evidenceIds: string[];
  /** Best-effort label for display. */
  label: string;
  href: string;
}

export interface SourceDetail {
  frontmatter: SourceFrontmatter;
  body: string;
  claims: SourceClaim[];
  entities: RelatedEntity[];
  ideas: RelatedIdea[];
  /** Ranked related nodes from @x-scraper/related. */
  related: RelatedVaultHit[];
}

const hrefFor = (hit: RelatedHit): string => {
  switch (hit.targetKind) {
    case 'Source':
      return `/sources/${hit.targetId}`;
    case 'Idea':
      return `/ideas/${hit.targetId}`;
    case 'Claim':
      return `/sources/${hit.targetId}`;
    default:
      return `/entities/${hit.targetId}`;
  }
};

export const loadSourceDetail = async (id: string): Promise<SourceDetail | null> => {
  const vault = await getVault();
  let record;
  try {
    record = await vault.read(id, 'Source');
  } catch {
    return null;
  }
  if (record.frontmatter.type !== 'Source') return null;
  const fm = record.frontmatter;

  const [claims, entities, ideas, relatedResult] = await Promise.all([
    loadClaimsForSource(vault, id),
    loadEntitiesForSource(vault, id),
    loadIdeasForSource(vault, id),
    related({ vault, graph: null }, { id, limit: 12 }),
  ]);

  const relatedHits: RelatedVaultHit[] = relatedResult.hits.map((h) => ({
    targetId: h.targetId,
    targetKind: h.targetKind,
    reason: h.reason,
    score: h.score,
    evidenceIds: h.evidenceIds,
    label: labelForHit(h, entities, ideas),
    href: hrefFor(h),
  }));

  return {
    frontmatter: fm,
    body: record.body,
    claims,
    entities,
    ideas,
    related: relatedHits,
  };
};

const labelForHit = (
  h: RelatedHit,
  entities: RelatedEntity[],
  ideas: RelatedIdea[],
): string => {
  if (h.targetKind === 'Idea') {
    const idea = ideas.find((i) => i.id === h.targetId);
    if (idea !== undefined) return idea.subject;
  }
  const ent = entities.find((e) => e.id === h.targetId);
  if (ent !== undefined) return ent.name;
  return h.targetId;
};

const safeRead = async (vault: VaultStore, id: string, type: EntityType) => {
  try {
    return await vault.read(id, type);
  } catch {
    return null;
  }
};

const loadClaimsForSource = async (vault: VaultStore, sourceId: string): Promise<SourceClaim[]> => {
  const list = await vault.list('Claim');
  const records = await Promise.all(
    list.map(async (entry) => {
      const r = await safeRead(vault, entry.id, 'Claim');
      if (r === null) return null;
      if (r.frontmatter.type !== 'Claim') return null;
      const cfm = r.frontmatter as ClaimFrontmatter;
      if (!cfm.sources.includes(sourceId)) return null;
      if (cfm.invalid_at !== null) return null;
      return {
        id: cfm.id,
        subject: cfm.subject,
        predicate: cfm.predicate,
        object: cfm.object,
        body: r.body.trim(),
        confidence: cfm.confidence ?? 0,
      } satisfies SourceClaim;
    }),
  );
  return records.filter((c): c is SourceClaim => c !== null);
};

const loadEntitiesForSource = async (
  vault: VaultStore,
  sourceId: string,
): Promise<RelatedEntity[]> => {
  const out: RelatedEntity[] = [];
  await Promise.all(
    ENTITY_TYPES.map(async (type) => {
      let list;
      try {
        list = await vault.list(type);
      } catch {
        return;
      }
      const reads = await Promise.all(
        list.map(async (entry) => {
          const r = await safeRead(vault, entry.id, type);
          if (r === null) return null;
          if (r.frontmatter.type !== type) return null;
          const efm = r.frontmatter as EntityFrontmatter;
          if (!efm.sources.includes(sourceId)) return null;
          return {
            id: efm.id,
            type: efm.type,
            name: efm.name,
            sourceCount: efm.sources.length,
          } satisfies RelatedEntity;
        }),
      );
      for (const e of reads) if (e !== null) out.push(e);
    }),
  );
  return out.sort((a, b) => b.sourceCount - a.sourceCount);
};

const loadIdeasForSource = async (vault: VaultStore, sourceId: string): Promise<RelatedIdea[]> => {
  const list = await vault.list('Idea');
  const reads = await Promise.all(
    list.map(async (entry) => {
      const r = await safeRead(vault, entry.id, 'Idea');
      if (r === null) return null;
      if (r.frontmatter.type !== 'Idea') return null;
      const ifm = r.frontmatter as IdeaFrontmatter;
      if (!ifm.sources.includes(sourceId)) return null;
      return {
        id: ifm.id,
        subject: ifm.subject,
        status: ifm.status,
        confidence: ifm.synthesizer_confidence,
        sourceCount: ifm.sources.length,
        autoConfirmed: ifm.auto_confirmed,
      } satisfies RelatedIdea;
    }),
  );
  return reads.filter((i): i is RelatedIdea => i !== null);
};
