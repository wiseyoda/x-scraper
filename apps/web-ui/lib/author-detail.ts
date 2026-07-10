/**
 * Author detail data layer. Walks every Source in the vault, projects
 * each to its derived author handle, and groups by handle. The "author"
 * isn't a vault entity — it's synthesized at read time. We accept the
 * O(N) source scan because authors are visited rarely; cache later if
 * the corpus grows past 10k.
 */

import 'server-only';

import type { SourceFrontmatter } from '@x-scraper/core';

import { authorFromUrl, type AuthorRef } from './author';
import { getVault } from './vault';

export interface AuthorBookmark {
  id: string;
  url: string;
  contentType: SourceFrontmatter['content_type'];
  capturedAt: string;
  /** First non-trivial line of the body (tweet text or article first sentence). */
  snippet: string | null;
}

export interface AuthorSummary {
  handle: string;
  display: string;
  source: AuthorRef['source'];
  bookmarkCount: number;
  byContentType: Record<string, number>;
  firstCapturedAt: string;
  lastCapturedAt: string;
}

export interface AuthorDetail {
  handle: string;
  display: string;
  source: AuthorRef['source'];
  bookmarks: AuthorBookmark[];
  byContentType: Record<string, number>;
}

const firstLine = (body: string): string | null => {
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !l.startsWith('#') &&
        !l.startsWith('---') &&
        !l.startsWith('-') &&
        !l.startsWith('Aliases:') &&
        !l.startsWith('[[') &&
        !/^https?:\/\//.test(l),
    );
  if (lines.length === 0) return null;
  const line = lines[0];
  if (line === undefined) return null;
  return line.length > 200 ? `${line.slice(0, 200).trimEnd()}…` : line;
};

const loadAllSourceFms = async (): Promise<Array<{ fm: SourceFrontmatter; body: string }>> => {
  const vault = await getVault();
  const list = await vault.list('Source');
  const reads = await Promise.all(
    list.map(async (entry) => {
      try {
        const r = await vault.read(entry.id, 'Source');
        if (r.frontmatter.type !== 'Source') return null;
        return { fm: r.frontmatter as SourceFrontmatter, body: r.body };
      } catch {
        return null;
      }
    }),
  );
  return reads.filter((x): x is { fm: SourceFrontmatter; body: string } => x !== null);
};

/**
 * Top authors sorted by bookmark count desc. Used by the dashboard
 * "Top authors you bookmark" widget.
 */
export const topAuthors = async (limit = 8): Promise<AuthorSummary[]> => {
  const sources = await loadAllSourceFms();
  const byHandle = new Map<string, AuthorSummary>();
  for (const { fm } of sources) {
    const a = authorFromUrl(fm.canonical_url);
    if (a === null) continue;
    let cur = byHandle.get(a.handle);
    if (cur === undefined) {
      cur = {
        handle: a.handle,
        display: a.display,
        source: a.source,
        bookmarkCount: 0,
        byContentType: {},
        firstCapturedAt: fm.captured_at,
        lastCapturedAt: fm.captured_at,
      };
      byHandle.set(a.handle, cur);
    }
    cur.bookmarkCount += 1;
    cur.byContentType[fm.content_type] = (cur.byContentType[fm.content_type] ?? 0) + 1;
    if (fm.captured_at < cur.firstCapturedAt) cur.firstCapturedAt = fm.captured_at;
    if (fm.captured_at > cur.lastCapturedAt) cur.lastCapturedAt = fm.captured_at;
  }
  return [...byHandle.values()]
    .sort((a, b) => {
      if (b.bookmarkCount !== a.bookmarkCount) return b.bookmarkCount - a.bookmarkCount;
      return b.lastCapturedAt.localeCompare(a.lastCapturedAt);
    })
    .slice(0, limit);
};

export const loadAuthorDetail = async (handleParam: string): Promise<AuthorDetail | null> => {
  const handle = decodeURIComponent(handleParam).toLowerCase();
  const sources = await loadAllSourceFms();
  const matches: AuthorBookmark[] = [];
  let display = handle;
  let source: AuthorRef['source'] = 'unknown';
  for (const { fm, body } of sources) {
    const a = authorFromUrl(fm.canonical_url);
    if (a === null) continue;
    if (a.handle !== handle) continue;
    display = a.display;
    source = a.source;
    matches.push({
      id: fm.id,
      url: fm.canonical_url,
      contentType: fm.content_type,
      capturedAt: fm.captured_at,
      snippet: firstLine(body),
    });
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  const byContentType: Record<string, number> = {};
  for (const m of matches) byContentType[m.contentType] = (byContentType[m.contentType] ?? 0) + 1;
  return {
    handle,
    display,
    source,
    bookmarks: matches,
    byContentType,
  };
};
