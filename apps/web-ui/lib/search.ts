/**
 * Substring search across the vault. Walks frontmatter AND body text
 * for ideas, entities, and sources — finds phrases buried inside
 * synthesized bodies, captured tweet text, etc. Embeddings-based
 * semantic search comes later; this is the deterministic baseline.
 */

import 'server-only';

import type { EntityType, IdeaFrontmatter, SourceFrontmatter } from '@x-scraper/core';

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

export type SearchHitKind = 'idea' | 'entity' | 'source';

export interface SearchHit {
  kind: SearchHitKind;
  id: string;
  /** Display string. */
  label: string;
  /** Sub-label — context to disambiguate. */
  meta: string;
  /** Where to navigate on click. */
  href: string;
  /** Score — higher is better. Used for ranking. */
  score: number;
  /** Optional snippet around the matched body phrase. */
  snippet?: string;
}

const RESULT_LIMIT = 40;

const normalize = (s: string): string => s.toLowerCase().normalize('NFKC');

const score = (haystack: string, needle: string): number => {
  const h = normalize(haystack);
  const n = normalize(needle);
  if (h === n) return 100;
  if (h.startsWith(n)) return 80;
  const idx = h.indexOf(n);
  if (idx === -1) return 0;
  return Math.max(1, 60 - idx - Math.floor(h.length / 10));
};

/**
 * Score a body for needle hits + return a snippet around the first
 * occurrence so search results show context. Word-boundary hits get a
 * small boost over substring-only matches (e.g. "agent" in "agentic"
 * scores lower than "agent" in "the agent walked").
 */
const scoreBody = (body: string, needle: string): { score: number; snippet: string | null } => {
  const h = normalize(body);
  const n = normalize(needle);
  const idx = h.indexOf(n);
  if (idx === -1) return { score: 0, snippet: null };
  const before = h[idx - 1];
  const after = h[idx + n.length];
  const wordBoundary =
    (before === undefined || /[^a-z0-9]/.test(before)) &&
    (after === undefined || /[^a-z0-9]/.test(after));
  // Body hits cap at ~40 — names matter more than phrase mentions.
  const baseScore = wordBoundary ? 36 : 22;
  const earlyBonus = Math.max(0, 4 - Math.floor(idx / 200));
  // Build a snippet around the match (~120 chars total).
  const start = Math.max(0, idx - 50);
  const end = Math.min(body.length, idx + n.length + 70);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < body.length ? '…' : '';
  const snippet = `${prefix}${body.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
  return { score: baseScore + earlyBonus, snippet };
};

export const runSearch = async (rawQuery: string): Promise<SearchHit[]> => {
  const query = rawQuery.trim();
  if (query.length === 0) return [];
  const vault = await getVault();
  const hits: SearchHit[] = [];

  // ---- Ideas: subject + id + body
  try {
    const list = await vault.list('Idea');
    const reads = await Promise.all(
      list.map(async (entry) => {
        try {
          const r = await vault.read(entry.id, 'Idea');
          return r.frontmatter.type === 'Idea'
            ? { fm: r.frontmatter as IdeaFrontmatter, body: r.body }
            : null;
        } catch {
          return null;
        }
      }),
    );
    for (const rec of reads) {
      if (rec === null) continue;
      const idea = rec.fm;
      const subjectScore = Math.max(score(idea.subject, query), score(idea.id, query));
      const bodyHit = scoreBody(rec.body, query);
      const finalScore = Math.max(subjectScore, bodyHit.score);
      if (finalScore > 0) {
        hits.push({
          kind: 'idea',
          id: idea.id,
          label: idea.subject,
          meta: `${idea.status} · conf ${idea.synthesizer_confidence.toFixed(2)} · ${String(idea.sources.length)} sources`,
          href: `/ideas/${idea.id}`,
          score: finalScore + 5, // small boost — Ideas are the most synthesized layer
          ...(subjectScore < bodyHit.score && bodyHit.snippet !== null
            ? { snippet: bodyHit.snippet }
            : {}),
        });
      }
    }
  } catch {
    /* skip */
  }

  // ---- Entities: name + aliases + id (entity bodies are mostly chrome — skip body scan)
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
          try {
            const r = await vault.read(entry.id, type);
            return r.frontmatter.type === type ? r.frontmatter : null;
          } catch {
            return null;
          }
        }),
      );
      for (const fm of reads) {
        if (fm === null) continue;
        if (
          fm.type === 'Source' ||
          fm.type === 'Claim' ||
          fm.type === 'Idea' ||
          fm.type === 'Topic'
        )
          continue;
        const nameScore = score(fm.name, query);
        const aliasScore = Math.max(0, ...fm.aliases.map((a) => score(a, query)));
        const idScore = score(fm.id, query) * 0.5;
        const s = Math.max(nameScore, aliasScore, idScore);
        if (s > 0) {
          hits.push({
            kind: 'entity',
            id: fm.id,
            label: fm.name,
            meta: `${fm.type.toLowerCase()} · ${String(fm.sources.length)} sources`,
            href: `/entities/${fm.id}`,
            score: s,
          });
        }
      }
    }),
  );

  // ---- Sources: url + id + body. Bounded scan to keep latency reasonable;
  // we read newest-first up to a cap then full-text the body.
  try {
    const list = await vault.list('Source');
    const recent = list
      .slice()
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
      .slice(0, 200);
    const reads = await Promise.all(
      recent.map(async (entry) => {
        try {
          const r = await vault.read(entry.id, 'Source');
          return r.frontmatter.type === 'Source'
            ? { fm: r.frontmatter as SourceFrontmatter, body: r.body }
            : null;
        } catch {
          return null;
        }
      }),
    );
    for (const rec of reads) {
      if (rec === null) continue;
      const fm = rec.fm;
      const urlScore = Math.max(score(fm.canonical_url, query), score(fm.id, query) * 0.5);
      const bodyHit = scoreBody(rec.body, query);
      const finalScore = Math.max(urlScore, bodyHit.score);
      if (finalScore > 0) {
        hits.push({
          kind: 'source',
          id: fm.id,
          label: fm.canonical_url,
          meta: `${fm.content_type} · ${new Date(fm.captured_at).toLocaleDateString()}`,
          href: `/sources/${fm.id}`,
          score: finalScore - 8, // small penalty — sources are noisier hits
          ...(urlScore < bodyHit.score && bodyHit.snippet !== null
            ? { snippet: bodyHit.snippet }
            : {}),
        });
      }
    }
  } catch {
    /* skip */
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, RESULT_LIMIT);
};
