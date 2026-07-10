/**
 * Weekly digest computation. Theme-forward via @x-scraper/digest
 * assembleThemes / formatThemeForwardBody, plus inventory tallies for
 * the UI chrome. Pure read, no LLM. Used by /digest.
 */

import 'server-only';

import type {
  ClaimFrontmatter,
  EntityFrontmatter,
  EntityType,
  IdeaFrontmatter,
  SourceFrontmatter,
} from '@x-scraper/core';
import {
  assembleThemes,
  formatThemeForwardBody,
  type DigestTheme,
  type IdeaThemeInput,
} from '@x-scraper/digest';

import { authorFromUrl } from './author';
import { allSourceState } from './source-state';
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

export interface DigestSourceRow {
  id: string;
  url: string;
  contentType: SourceFrontmatter['content_type'];
  capturedAt: string;
  /** Estimated reading time in minutes from body length (200 wpm). */
  readMins: number;
  read: boolean;
}

export interface DigestIdeaRow {
  id: string;
  subject: string;
  status: 'draft' | 'confirmed' | 'rejected';
  autoConfirmed: boolean;
  sourceCount: number;
  confidence: number;
}

export interface DigestEntityRow {
  id: string;
  type: EntityType;
  name: string;
  /** Number of NEW source mentions in window. */
  newMentions: number;
  totalSources: number;
}

export interface DigestAuthorRow {
  handle: string;
  display: string;
  newBookmarks: number;
}

export interface DigestData {
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  totalCaptures: number;
  byContentType: Record<string, number>;
  totalReadMins: number;
  recentSources: DigestSourceRow[];
  newConfirmedIdeas: DigestIdeaRow[];
  newDraftIdeas: DigestIdeaRow[];
  topAuthors: DigestAuthorRow[];
  topEntities: DigestEntityRow[];
  unreadCount: number;
  /** Theme rows from package assembleThemes (idea subjects touching window). */
  themes: DigestTheme[];
  /** Deterministic theme-forward body (same helper as offline digests). */
  themeBody: string;
  claimCountInWindow: number;
}

const estimateReadMins = (body: string): number => {
  const words = body.split(/\s+/).filter((w) => w.length > 0).length;
  return Math.max(1, Math.round(words / 200));
};

const weekLabelFor = (start: Date, end: Date): string => {
  const fmt = (d: Date): string => d.toISOString().slice(0, 10);
  return `${fmt(start)} → ${fmt(end)}`;
};

export const computeDigest = async (windowDays = 7): Promise<DigestData> => {
  const vault = await getVault();
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const [sourceList, ideaList, claimList, entityLists, stateMap] = await Promise.all([
    vault.list('Source').catch(() => []),
    vault.list('Idea').catch(() => []),
    vault.list('Claim').catch(() => []),
    Promise.all(
      ENTITY_TYPES.map(async (t) => {
        try {
          return await vault.list(t);
        } catch {
          return [];
        }
      }),
    ),
    allSourceState(),
  ]);

  // Sources: read each and filter by capturedAt window.
  const sourceFms = await Promise.all(
    sourceList.map(async (e) => {
      try {
        const r = await vault.read(e.id, 'Source');
        if (r.frontmatter.type !== 'Source') return null;
        return { fm: r.frontmatter as SourceFrontmatter, body: r.body };
      } catch {
        return null;
      }
    }),
  );
  const sourcesValid = sourceFms.filter(
    (x): x is { fm: SourceFrontmatter; body: string } => x !== null,
  );
  const inWindow = sourcesValid.filter(
    (r) => Date.parse(r.fm.captured_at) >= windowStart.getTime(),
  );

  const recentSources: DigestSourceRow[] = inWindow
    .map((r) => ({
      id: r.fm.id,
      url: r.fm.canonical_url,
      contentType: r.fm.content_type,
      capturedAt: r.fm.captured_at,
      readMins: estimateReadMins(r.body),
      read: (stateMap[r.fm.id]?.readAt ?? null) !== null,
    }))
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));

  const byContentType: Record<string, number> = {};
  for (const s of recentSources) {
    byContentType[s.contentType] = (byContentType[s.contentType] ?? 0) + 1;
  }
  const totalReadMins = recentSources.reduce((acc, s) => acc + s.readMins, 0);

  // Authors
  const authorCounts = new Map<string, { display: string; n: number }>();
  for (const r of inWindow) {
    const a = authorFromUrl(r.fm.canonical_url);
    if (a === null) continue;
    const cur = authorCounts.get(a.handle) ?? { display: a.display, n: 0 };
    cur.n += 1;
    authorCounts.set(a.handle, cur);
  }
  const topAuthors: DigestAuthorRow[] = [...authorCounts.entries()]
    .map(([handle, v]) => ({ handle, display: v.display, newBookmarks: v.n }))
    .sort((a, b) => b.newBookmarks - a.newBookmarks)
    .slice(0, 6);

  // Ideas: all valid + window filter for tallies / theme assembly
  const ideaFms = await Promise.all(
    ideaList.map(async (e) => {
      try {
        const r = await vault.read(e.id, 'Idea');
        if (r.frontmatter.type !== 'Idea') return null;
        return r.frontmatter as IdeaFrontmatter;
      } catch {
        return null;
      }
    }),
  );
  const ideasValid = ideaFms.filter((fm): fm is IdeaFrontmatter => fm !== null);
  const ideaInWindow = ideasValid.filter(
    (fm) => Date.parse(fm.updated_at) >= windowStart.getTime(),
  );

  const newConfirmedIdeas: DigestIdeaRow[] = ideaInWindow
    .filter((fm) => fm.status === 'confirmed')
    .sort((a, b) => b.sources.length - a.sources.length)
    .slice(0, 6)
    .map((fm) => ({
      id: fm.id,
      subject: fm.subject,
      status: fm.status,
      autoConfirmed: fm.auto_confirmed,
      sourceCount: fm.sources.length,
      confidence: fm.synthesizer_confidence,
    }));

  const newDraftIdeas: DigestIdeaRow[] = ideaInWindow
    .filter((fm) => fm.status === 'draft')
    .sort((a, b) => b.sources.length - a.sources.length)
    .slice(0, 6)
    .map((fm) => ({
      id: fm.id,
      subject: fm.subject,
      status: fm.status,
      autoConfirmed: fm.auto_confirmed,
      sourceCount: fm.sources.length,
      confidence: fm.synthesizer_confidence,
    }));

  // Claims in window (for theme body inventory)
  const claimIdsInWindow: string[] = [];
  await Promise.all(
    claimList.map(async (e) => {
      try {
        const r = await vault.read(e.id, 'Claim');
        if (r.frontmatter.type !== 'Claim') return;
        const fm = r.frontmatter as ClaimFrontmatter;
        if (fm.invalid_at !== null) return;
        const ts = fm.updated_at ?? fm.created_at;
        if (ts !== undefined && Date.parse(ts) >= windowStart.getTime()) {
          claimIdsInWindow.push(fm.id);
        }
      } catch {
        /* skip */
      }
    }),
  );

  // Theme-forward core — same package helpers as CLI digests
  const recentSourceIds = new Set(inWindow.map((r) => r.fm.id));
  const recentIdeaIds = new Set(ideaInWindow.map((fm) => fm.id));
  const ideaInputs: IdeaThemeInput[] = ideasValid.map((fm) => ({
    id: fm.id,
    subject: fm.subject,
    status: fm.status,
    sourceIds: fm.sources,
    updatedAt: fm.updated_at,
  }));
  const themes = assembleThemes(ideaInputs, recentSourceIds, recentIdeaIds);
  const sourceIdsForBody = recentSources.map((s) => s.id);
  const themeBody = formatThemeForwardBody(
    weekLabelFor(windowStart, now),
    themes,
    sourceIdsForBody,
    claimIdsInWindow,
  );

  // Top entities — entities mentioned in NEW sources this window.
  const newSourceIdSet = recentSourceIds;
  const entityRows: DigestEntityRow[] = [];
  for (let i = 0; i < ENTITY_TYPES.length; i += 1) {
    const type = ENTITY_TYPES[i];
    const list = entityLists[i];
    if (type === undefined || list === undefined) continue;
    for (const entry of list) {
      try {
        const r = await vault.read(entry.id, type);
        if (r.frontmatter.type !== type) continue;
        const fm = r.frontmatter as EntityFrontmatter;
        const newMentions = fm.sources.filter((s) => newSourceIdSet.has(s)).length;
        if (newMentions === 0) continue;
        entityRows.push({
          id: fm.id,
          type: fm.type,
          name: fm.name,
          newMentions,
          totalSources: fm.sources.length,
        });
      } catch {
        /* skip */
      }
    }
  }
  const topEntities = entityRows
    .sort((a, b) => {
      if (b.newMentions !== a.newMentions) return b.newMentions - a.newMentions;
      return b.totalSources - a.totalSources;
    })
    .slice(0, 10);

  // Unread count (across the whole corpus).
  let unreadCount = 0;
  for (const e of sourceList) {
    if ((stateMap[e.id]?.readAt ?? null) === null) unreadCount += 1;
  }

  return {
    windowDays,
    windowStart: windowStart.toISOString(),
    windowEnd: now.toISOString(),
    totalCaptures: recentSources.length,
    byContentType,
    totalReadMins,
    recentSources: recentSources.slice(0, 12),
    newConfirmedIdeas,
    newDraftIdeas,
    topAuthors,
    topEntities,
    unreadCount,
    themes,
    themeBody,
    claimCountInWindow: claimIdsInWindow.length,
  };
};
