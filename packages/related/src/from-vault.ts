/**
 * Build a RelatedCorpus by scanning the markdown vault.
 * Network-free. Optional GraphStore is accepted for future embed enrich;
 * vault scorers always run.
 */

import type { EntityFrontmatter, EntityType } from '@x-scraper/core';
import type { GraphStore } from '@x-scraper/graph';
import type { VaultStore } from '@x-scraper/vault';

import {
  createCorpus,
  linkAuthor,
  linkClaim,
  linkEntityMember,
  normalizeSubject,
  setKind,
  setSourceCapturedAt,
} from './corpus.js';
import type { RelatedCorpus } from './types.js';
import { RelatedKindSchema } from './types.js';

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

const authorFromUrl = (url: string): string | null => {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const segments = u.pathname.split('/').filter((s) => s.length > 0);
    const first = segments[0];
    if (first === undefined) return null;
    if (host === 'x.com' || host === 'twitter.com') {
      if (first === 'i' || first === 'home' || first === 'search') return null;
      return first.toLowerCase();
    }
    if (host === 'github.com') {
      if (first === 'orgs' || first === 'topics' || first === 'search') return null;
      return first.toLowerCase();
    }
    return null;
  } catch {
    return null;
  }
};

const safeRead = async (vault: VaultStore, id: string, type: EntityType) => {
  try {
    return await vault.read(id, type);
  } catch {
    return null;
  }
};

export interface BuildCorpusOptions {
  graph?: GraphStore | null;
}

/**
 * Full vault scan → RelatedCorpus (co-entity / co-claim / author).
 * Embeddings are filled by callers via setEmbeddingNeighbors when available.
 */
export const buildCorpusFromVault = async (
  vault: VaultStore,
  _options: BuildCorpusOptions = {},
): Promise<RelatedCorpus> => {
  const c = createCorpus();

  try {
    const sources = await vault.list('Source');
    await Promise.all(
      sources.map(async (entry) => {
        const r = await safeRead(vault, entry.id, 'Source');
        if (r?.frontmatter.type !== 'Source') return;
        const fm = r.frontmatter;
        setKind(c, fm.id, 'Source', fm.canonical_url);
        setSourceCapturedAt(c, fm.id, fm.captured_at);
        const bylineRaw = fm.host_metadata.byline;
        const author =
          typeof bylineRaw === 'string' && bylineRaw.length > 0
            ? bylineRaw.toLowerCase().replace(/^@/, '')
            : authorFromUrl(fm.canonical_url);
        if (author !== null) linkAuthor(c, fm.id, author);
      }),
    );
  } catch {
    /* empty vault ok */
  }

  for (const type of ENTITY_TYPES) {
    let list;
    try {
      list = await vault.list(type);
    } catch {
      continue;
    }
    await Promise.all(
      list.map(async (entry) => {
        const r = await safeRead(vault, entry.id, type);
        if (r?.frontmatter.type !== type) return;
        const fm = r.frontmatter as EntityFrontmatter;
        const kind = RelatedKindSchema.parse(type);
        setKind(c, fm.id, kind, fm.name);
        for (const sid of fm.sources) {
          linkEntityMember(c, fm.id, sid, fm.name, 'Source');
        }
      }),
    );
  }

  try {
    const claims = await vault.list('Claim');
    await Promise.all(
      claims.map(async (entry) => {
        const r = await safeRead(vault, entry.id, 'Claim');
        if (r?.frontmatter.type !== 'Claim') return;
        const fm = r.frontmatter;
        if (fm.invalid_at !== null) return;
        const subj = normalizeSubject(fm.subject);
        for (const sid of fm.sources) {
          linkClaim(c, fm.id, sid, subj);
        }
      }),
    );
  } catch {
    /* ok */
  }

  try {
    const ideas = await vault.list('Idea');
    await Promise.all(
      ideas.map(async (entry) => {
        const r = await safeRead(vault, entry.id, 'Idea');
        if (r?.frontmatter.type !== 'Idea') return;
        const fm = r.frontmatter;
        setKind(c, fm.id, 'Idea', fm.subject);
        for (const sid of fm.sources) {
          const ents = c.memberToEntities.get(sid);
          if (ents !== undefined) {
            for (const eid of ents) {
              linkEntityMember(c, eid, fm.id, c.names.get(eid), 'Idea');
            }
          }
        }
        const subjNorm = normalizeSubject(fm.subject);
        for (const [eid, name] of c.names) {
          if (normalizeSubject(name) === subjNorm && c.kinds.get(eid) !== 'Idea') {
            linkEntityMember(c, eid, fm.id, name, 'Idea');
          }
        }
      }),
    );
  } catch {
    /* ok */
  }

  return c;
};

/**
 * Placeholder for graph vector neighbors. GraphStore has no getEmbedding
 * yet — embedding scorer is covered by pure unit tests via setEmbeddingNeighbors.
 */
export const enrichWithEmbeddingNeighbors = (
  _corpus: RelatedCorpus,
  _seedId: string,
  _graph: GraphStore | null | undefined,
  _k = 8,
): void => {
  // no-op until GraphStore exposes node embeddings
};
