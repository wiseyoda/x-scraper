/**
 * Entity detail data layer. Symmetric with source-detail: load the
 * entity frontmatter + body, walk vault to find sources mentioning it,
 * ideas synthesized about it, claims that anchor on it, and co-occurring
 * entities (entities that appear together in the same sources).
 */

import 'server-only';

import type {
  ClaimFrontmatter,
  EntityFrontmatter,
  EntityType,
  IdeaFrontmatter,
  SourceFrontmatter,
} from '@x-scraper/core';
import type { VaultStore } from '@x-scraper/vault';

import { kindFromId } from './idKind';
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

export interface EntitySourceRef {
  id: string;
  url: string;
  contentType: SourceFrontmatter['content_type'];
  capturedAt: string;
}

export interface EntityIdeaRef {
  id: string;
  subject: string;
  status: 'draft' | 'confirmed' | 'rejected';
  autoConfirmed: boolean;
  confidence: number;
  sourceCount: number;
}

export interface EntityClaimRef {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  body: string;
  sourceId: string;
}

export interface EntityCoMention {
  id: string;
  type: EntityType;
  name: string;
  sharedSourceCount: number;
  sourceCount: number;
}

export interface EntityDetail {
  frontmatter: EntityFrontmatter;
  body: string;
  sources: EntitySourceRef[];
  ideas: EntityIdeaRef[];
  claims: EntityClaimRef[];
  coMentions: EntityCoMention[];
}

const safeRead = async (vault: VaultStore, id: string, type: EntityType) => {
  try {
    return await vault.read(id, type);
  } catch {
    return null;
  }
};

const looseEqual = (a: string, b: string): boolean => {
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[\s_-]+/g, ' ')
      .trim();
  return norm(a) === norm(b);
};

export const loadEntityDetail = async (id: string): Promise<EntityDetail | null> => {
  const kind = kindFromId(id);
  if (kind === null) return null;
  // Only entity-like types — Source/Claim/Idea/Topic have their own routes.
  if (!ENTITY_TYPES.includes(kind)) return null;

  const vault = await getVault();
  const record = await safeRead(vault, id, kind);
  if (record === null) return null;
  if (record.frontmatter.type !== kind) return null;
  const fm = record.frontmatter as EntityFrontmatter;

  const [sources, ideas, claims, coMentions] = await Promise.all([
    loadSourcesForIds(vault, fm.sources),
    loadIdeasForEntity(vault, fm),
    loadClaimsForEntity(vault, fm),
    loadCoMentionsForEntity(vault, fm),
  ]);

  return {
    frontmatter: fm,
    body: record.body,
    sources,
    ideas,
    claims,
    coMentions,
  };
};

const loadSourcesForIds = async (
  vault: VaultStore,
  sourceIds: readonly string[],
): Promise<EntitySourceRef[]> => {
  const reads = await Promise.all(
    sourceIds.map(async (sid) => {
      const r = await safeRead(vault, sid, 'Source');
      if (r === null) return null;
      if (r.frontmatter.type !== 'Source') return null;
      const sfm = r.frontmatter as SourceFrontmatter;
      return {
        id: sfm.id,
        url: sfm.canonical_url,
        contentType: sfm.content_type,
        capturedAt: sfm.captured_at,
      } satisfies EntitySourceRef;
    }),
  );
  return reads
    .filter((r): r is EntitySourceRef => r !== null)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
};

const loadIdeasForEntity = async (
  vault: VaultStore,
  entity: EntityFrontmatter,
): Promise<EntityIdeaRef[]> => {
  const list = await vault.list('Idea');
  const reads = await Promise.all(
    list.map(async (entry) => {
      const r = await safeRead(vault, entry.id, 'Idea');
      if (r === null) return null;
      if (r.frontmatter.type !== 'Idea') return null;
      const ifm = r.frontmatter as IdeaFrontmatter;
      // Match either by subject (entity-anchored idea) or by source overlap.
      const subjectMatches =
        looseEqual(ifm.subject, entity.name) ||
        entity.aliases.some((a) => looseEqual(ifm.subject, a));
      const overlap = ifm.sources.filter((s) => entity.sources.includes(s)).length;
      if (!subjectMatches && overlap === 0) return null;
      return {
        id: ifm.id,
        subject: ifm.subject,
        status: ifm.status,
        autoConfirmed: ifm.auto_confirmed,
        confidence: ifm.synthesizer_confidence,
        sourceCount: ifm.sources.length,
      } satisfies EntityIdeaRef;
    }),
  );
  return reads.filter((i): i is EntityIdeaRef => i !== null);
};

const loadClaimsForEntity = async (
  vault: VaultStore,
  entity: EntityFrontmatter,
): Promise<EntityClaimRef[]> => {
  const list = await vault.list('Claim');
  const reads = await Promise.all(
    list.map(async (entry) => {
      const r = await safeRead(vault, entry.id, 'Claim');
      if (r === null) return null;
      if (r.frontmatter.type !== 'Claim') return null;
      const cfm = r.frontmatter as ClaimFrontmatter;
      if (cfm.invalid_at !== null) return null;
      const subjectHit =
        looseEqual(cfm.subject, entity.name) ||
        entity.aliases.some((a) => looseEqual(cfm.subject, a));
      const objectHit =
        looseEqual(cfm.object, entity.name) ||
        entity.aliases.some((a) => looseEqual(cfm.object, a));
      if (!subjectHit && !objectHit) return null;
      const sourceId = cfm.sources[0];
      if (sourceId === undefined) return null;
      return {
        id: cfm.id,
        subject: cfm.subject,
        predicate: cfm.predicate,
        object: cfm.object,
        body: r.body.trim(),
        sourceId,
      } satisfies EntityClaimRef;
    }),
  );
  return reads.filter((c): c is EntityClaimRef => c !== null);
};

const loadCoMentionsForEntity = async (
  vault: VaultStore,
  entity: EntityFrontmatter,
): Promise<EntityCoMention[]> => {
  const targetSources = new Set(entity.sources);
  if (targetSources.size === 0) return [];

  const out: EntityCoMention[] = [];
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
          if (entry.id === entity.id) return null;
          const r = await safeRead(vault, entry.id, type);
          if (r === null) return null;
          if (r.frontmatter.type !== type) return null;
          const efm = r.frontmatter as EntityFrontmatter;
          const overlap = efm.sources.filter((s) => targetSources.has(s)).length;
          if (overlap === 0) return null;
          return {
            id: efm.id,
            type: efm.type,
            name: efm.name,
            sharedSourceCount: overlap,
            sourceCount: efm.sources.length,
          } satisfies EntityCoMention;
        }),
      );
      for (const c of reads) if (c !== null) out.push(c);
    }),
  );
  return out
    .sort((a, b) => {
      if (b.sharedSourceCount !== a.sharedSourceCount) {
        return b.sharedSourceCount - a.sharedSourceCount;
      }
      return b.sourceCount - a.sourceCount;
    })
    .slice(0, 20);
};
