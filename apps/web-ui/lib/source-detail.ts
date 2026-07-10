/**
 * Build the rich data shape for /sources/[id] in one pass.
 *
 * Reads the Source frontmatter + body, then walks all claims to find
 * the ones extracted FROM this source, then walks all entities to find
 * the ones whose `sources` array includes this id. Plus related ideas
 * (ideas whose `sources` array includes this id). Plus related sources
 * (sources sharing entities — the closest thing to "more from this
 * topic" without a full graph traversal).
 *
 * On a 1k-claim, 500-entity vault this is ~1500 file reads parallelized
 * — sub-second. We accept that cost rather than caching since detail
 * pages are infrequent and the corpus mutates from outside.
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

export interface RelatedSource {
  id: string;
  url: string;
  contentType: SourceFrontmatter['content_type'];
  capturedAt: string;
  /** Why this source is related — shared entity names. */
  via: string[];
}

export interface SourceDetail {
  frontmatter: SourceFrontmatter;
  body: string;
  claims: SourceClaim[];
  entities: RelatedEntity[];
  ideas: RelatedIdea[];
  related: RelatedSource[];
}

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

  const [claims, entities, ideas] = await Promise.all([
    loadClaimsForSource(vault, id),
    loadEntitiesForSource(vault, id),
    loadIdeasForSource(vault, id),
  ]);

  // Compute related sources: those sharing any entity with this source,
  // excluding self. We already have the entity list — each entity's
  // `sources` array gives us neighbours.
  const neighbourScore = new Map<string, { score: number; via: Set<string> }>();
  for (const ent of entities) {
    const entRecord = await safeRead(vault, ent.id, ent.type);
    if (entRecord === null) continue;
    const efm = entRecord.frontmatter as EntityFrontmatter;
    for (const otherId of efm.sources) {
      if (otherId === id) continue;
      const cur = neighbourScore.get(otherId) ?? { score: 0, via: new Set() };
      cur.score += 1;
      cur.via.add(ent.name);
      neighbourScore.set(otherId, cur);
    }
  }
  const relatedTopIds = [...neighbourScore.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 8)
    .map(([nid, info]) => ({ id: nid, via: [...info.via].slice(0, 3) }));

  const relatedSources: RelatedSource[] = (
    await Promise.all(
      relatedTopIds.map(async ({ id: rid, via }) => {
        const sr = await safeRead(vault, rid, 'Source');
        if (sr === null) return null;
        const sfm = sr.frontmatter as SourceFrontmatter;
        return {
          id: sfm.id,
          url: sfm.canonical_url,
          contentType: sfm.content_type,
          capturedAt: sfm.captured_at,
          via,
        };
      }),
    )
  ).filter((r): r is RelatedSource => r !== null);

  return {
    frontmatter: fm,
    body: record.body,
    claims,
    entities,
    ideas,
    related: relatedSources,
  };
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
      const fm = r.frontmatter as ClaimFrontmatter;
      if (!fm.sources.includes(sourceId)) return null;
      if (fm.invalid_at !== null) return null;
      return {
        id: fm.id,
        subject: fm.subject,
        predicate: fm.predicate,
        object: fm.object,
        body: r.body.trim(),
        confidence: fm.confidence ?? 0,
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
          const fm = r.frontmatter as EntityFrontmatter;
          if (!fm.sources.includes(sourceId)) return null;
          return {
            id: fm.id,
            type: fm.type,
            name: fm.name,
            sourceCount: fm.sources.length,
          } satisfies RelatedEntity;
        }),
      );
      for (const e of reads) if (e !== null) out.push(e);
    }),
  );
  // Sort by source-count descending (most-cited entity first).
  return out.sort((a, b) => b.sourceCount - a.sourceCount);
};

const loadIdeasForSource = async (vault: VaultStore, sourceId: string): Promise<RelatedIdea[]> => {
  const list = await vault.list('Idea');
  const reads = await Promise.all(
    list.map(async (entry) => {
      const r = await safeRead(vault, entry.id, 'Idea');
      if (r === null) return null;
      if (r.frontmatter.type !== 'Idea') return null;
      const fm = r.frontmatter as IdeaFrontmatter;
      if (!fm.sources.includes(sourceId)) return null;
      return {
        id: fm.id,
        subject: fm.subject,
        status: fm.status,
        confidence: fm.synthesizer_confidence,
        sourceCount: fm.sources.length,
        autoConfirmed: fm.auto_confirmed,
      } satisfies RelatedIdea;
    }),
  );
  return reads
    .filter((i): i is RelatedIdea => i !== null)
    .sort((a, b) => b.sourceCount - a.sourceCount);
};
