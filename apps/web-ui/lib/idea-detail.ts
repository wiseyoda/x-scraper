/**
 * Idea detail data layer. Hydrates an Idea's flat id arrays
 * (`sources`, `derived_from`) into rich navigable summaries, plus finds
 * the anchor entity (whose name matches the idea's subject) and other
 * ideas that overlap on entities/sources.
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

export interface IdeaSourceRef {
  id: string;
  url: string;
  contentType: SourceFrontmatter['content_type'];
  capturedAt: string;
}

export interface IdeaClaimRef {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  body: string;
  sourceId: string;
}

export interface IdeaAnchorEntity {
  id: string;
  type: EntityType;
  name: string;
  sourceCount: number;
}

export interface IdeaRelatedIdea {
  id: string;
  subject: string;
  status: 'draft' | 'confirmed' | 'rejected';
  autoConfirmed: boolean;
  sourceCount: number;
  /** How many sources this related idea shares with the current one. */
  overlap: number;
}

export interface IdeaDetailData {
  frontmatter: IdeaFrontmatter;
  body: string;
  sources: IdeaSourceRef[];
  claims: IdeaClaimRef[];
  /** The anchor entity (matched by name === idea.subject), or null. */
  anchor: IdeaAnchorEntity | null;
  related: IdeaRelatedIdea[];
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

export const loadIdeaDetail = async (id: string): Promise<IdeaDetailData | null> => {
  const vault = await getVault();
  const record = await safeRead(vault, id, 'Idea');
  if (record === null) return null;
  if (record.frontmatter.type !== 'Idea') return null;
  const fm = record.frontmatter as IdeaFrontmatter;

  const [sources, claims, anchor, related] = await Promise.all([
    hydrateSources(vault, fm.sources),
    hydrateClaims(vault, fm.derived_from),
    findAnchorEntity(vault, fm.subject),
    findRelatedIdeas(vault, fm),
  ]);

  return {
    frontmatter: fm,
    body: record.body,
    sources,
    claims,
    anchor,
    related,
  };
};

const hydrateSources = async (
  vault: VaultStore,
  ids: readonly string[],
): Promise<IdeaSourceRef[]> => {
  const reads = await Promise.all(
    ids.map(async (sid) => {
      const r = await safeRead(vault, sid, 'Source');
      if (r === null) return null;
      if (r.frontmatter.type !== 'Source') return null;
      const sfm = r.frontmatter as SourceFrontmatter;
      return {
        id: sfm.id,
        url: sfm.canonical_url,
        contentType: sfm.content_type,
        capturedAt: sfm.captured_at,
      } satisfies IdeaSourceRef;
    }),
  );
  return reads
    .filter((s): s is IdeaSourceRef => s !== null)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
};

const hydrateClaims = async (
  vault: VaultStore,
  ids: readonly string[],
): Promise<IdeaClaimRef[]> => {
  const reads = await Promise.all(
    ids.map(async (cid) => {
      const r = await safeRead(vault, cid, 'Claim');
      if (r === null) return null;
      if (r.frontmatter.type !== 'Claim') return null;
      const cfm = r.frontmatter as ClaimFrontmatter;
      const sourceId = cfm.sources[0];
      if (sourceId === undefined) return null;
      return {
        id: cfm.id,
        subject: cfm.subject,
        predicate: cfm.predicate,
        object: cfm.object,
        body: r.body.trim(),
        sourceId,
      } satisfies IdeaClaimRef;
    }),
  );
  return reads.filter((c): c is IdeaClaimRef => c !== null);
};

const findAnchorEntity = async (
  vault: VaultStore,
  subject: string,
): Promise<IdeaAnchorEntity | null> => {
  for (const type of ENTITY_TYPES) {
    let list;
    try {
      list = await vault.list(type);
    } catch {
      continue;
    }
    const reads = await Promise.all(
      list.map(async (entry) => {
        const r = await safeRead(vault, entry.id, type);
        if (r === null) return null;
        if (r.frontmatter.type !== type) return null;
        const efm = r.frontmatter as EntityFrontmatter;
        const matches =
          looseEqual(efm.name, subject) || efm.aliases.some((a) => looseEqual(a, subject));
        if (!matches) return null;
        return {
          id: efm.id,
          type: efm.type,
          name: efm.name,
          sourceCount: efm.sources.length,
        } satisfies IdeaAnchorEntity;
      }),
    );
    const hit = reads.find((r) => r !== null);
    if (hit !== undefined && hit !== null) return hit;
  }
  return null;
};

const findRelatedIdeas = async (
  vault: VaultStore,
  thisIdea: IdeaFrontmatter,
): Promise<IdeaRelatedIdea[]> => {
  const list = await vault.list('Idea');
  const reads = await Promise.all(
    list.map(async (entry) => {
      if (entry.id === thisIdea.id) return null;
      const r = await safeRead(vault, entry.id, 'Idea');
      if (r === null) return null;
      if (r.frontmatter.type !== 'Idea') return null;
      const ifm = r.frontmatter as IdeaFrontmatter;
      const overlap = ifm.sources.filter((s) => thisIdea.sources.includes(s)).length;
      if (overlap === 0) return null;
      return {
        id: ifm.id,
        subject: ifm.subject,
        status: ifm.status,
        autoConfirmed: ifm.auto_confirmed,
        sourceCount: ifm.sources.length,
        overlap,
      } satisfies IdeaRelatedIdea;
    }),
  );
  return reads
    .filter((i): i is IdeaRelatedIdea => i !== null)
    .sort((a, b) => b.overlap - a.overlap);
};
