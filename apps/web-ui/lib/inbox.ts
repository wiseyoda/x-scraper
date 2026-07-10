/**
 * Inbox data layer — every Source in the vault projected into a row,
 * enriched with author + state + pin + claim/entity counts. This is
 * the engine behind /inbox.
 *
 * Single pass over the vault. Cost on the live corpus (236 sources):
 * ~0.5–1s — fine for a navigated view, slow for a typeahead. Cache if
 * we ever wire this into search.
 */

import 'server-only';

import type {
  ClaimFrontmatter,
  EntityFrontmatter,
  EntityType,
  IdeaFrontmatter,
  SourceFrontmatter,
} from '@x-scraper/core';

import { authorFromUrl, type AuthorRef } from './author';
import { loadLedgerOverlay } from './bookmark-ledger';
import { deriveInboxDisplay } from './inbox-display';
import { pinnedIdSet } from './pins';
import { allSourceState, type SourceState } from './source-state';
import { getVault } from './vault';

const ENTITY_TYPES_FOR_LISTING: EntityType[] = [
  'Person',
  'Tool',
  'Concept',
  'Repo',
  'Article',
  'Tweet',
  'Video',
  'PDF',
];

export interface InboxRow {
  id: string;
  url: string;
  contentType: SourceFrontmatter['content_type'];
  /** When we imported the bookmark. Always present. */
  capturedAt: string;
  /** When the original was posted on x.com. Tweets only; null otherwise. */
  postedAt: string | null;
  /** When the user first bookmarked it on x.com (proxied by ledger insert time). */
  bookmarkedAt: string | null;
  /**
   * Effective sort timestamp — bookmarkedAt (when YOU saved it on x.com)
   * when known, falling back to capturedAt. This preserves x.com's
   * "most-recently-bookmarked first" order from the pull. We DON'T sort
   * by postedAt — an old tweet you just bookmarked should rank above
   * yesterday's tweet you bookmarked months ago.
   */
  sortAt: string;
  /**
   * 'organic' = a tweet you actually bookmarked. 'derived' = a URL the
   * pipeline extracted from a tweet body. The inbox filters to organic
   * by default; pass `includeDerived: true` to see everything.
   */
  kind: 'organic' | 'derived' | 'unknown';
  /**
   * Primary list line — title, body gist, or @author. Never the raw URL
   * when better fields exist (see deriveInboxDisplay).
   */
  primary: string;
  /** Canonical URL (always secondary in the UI). */
  secondary: string;
  /** Distinct title when available (H1 / repo path). */
  title: string | null;
  /** First non-trivial line of the body (tweet text or article first sentence). */
  snippet: string | null;
  author: AuthorRef | null;
  pinned: boolean;
  read: boolean;
  readAt: string | null;
  tags: string[];
  /** Number of claims extracted from this source. */
  claimCount: number;
  /** Number of entities mentioned in this source. */
  entityCount: number;
}

export interface InboxFilter {
  /** Filter to one content type. */
  contentType?: SourceFrontmatter['content_type'];
  /** Filter to one author handle. */
  author?: string;
  /** Filter to read or unread. */
  read?: 'read' | 'unread';
  /** Pinned only. */
  pinned?: boolean;
  /** Has tag (case-insensitive). */
  tag?: string;
  /** Substring match against url or snippet (case-insensitive). */
  q?: string;
  /** Include 'derived' rows (URLs extracted from tweets). Default: organic only. */
  includeDerived?: boolean;
  /** Pagination — default 50. */
  pageSize?: number;
  page?: number;
}

export interface InboxResult {
  rows: InboxRow[];
  /** Counts BEFORE filtering — used to render the filter chip badges. */
  totals: {
    all: number;
    organic: number;
    derived: number;
    unread: number;
    pinned: number;
    byContentType: Record<string, number>;
  };
  /** Number of rows that matched the filter, before pagination. */
  matchedCount: number;
  page: number;
  pageSize: number;
}

const loadClaimsBySource = async (): Promise<Map<string, number>> => {
  const vault = await getVault();
  const list = await vault.list('Claim');
  const out = new Map<string, number>();
  await Promise.all(
    list.map(async (e) => {
      try {
        const r = await vault.read(e.id, 'Claim');
        if (r.frontmatter.type !== 'Claim') return;
        const fm = r.frontmatter as ClaimFrontmatter;
        if (fm.invalid_at !== null) return;
        for (const sid of fm.sources) out.set(sid, (out.get(sid) ?? 0) + 1);
      } catch {
        /* skip */
      }
    }),
  );
  return out;
};

const loadEntitiesBySource = async (): Promise<Map<string, number>> => {
  const vault = await getVault();
  const out = new Map<string, number>();
  await Promise.all(
    ENTITY_TYPES_FOR_LISTING.map(async (type) => {
      let list;
      try {
        list = await vault.list(type);
      } catch {
        return;
      }
      await Promise.all(
        list.map(async (e) => {
          try {
            const r = await vault.read(e.id, type);
            if (r.frontmatter.type !== type) return;
            const fm = r.frontmatter as EntityFrontmatter;
            for (const sid of fm.sources) out.set(sid, (out.get(sid) ?? 0) + 1);
          } catch {
            /* skip */
          }
        }),
      );
    }),
  );
  return out;
};

export const loadInbox = async (filter: InboxFilter = {}): Promise<InboxResult> => {
  const vault = await getVault();
  const list = await vault.list('Source');

  const [pinned, stateMap, claimsBySource, entitiesBySource, ledgerMap] = await Promise.all([
    pinnedIdSet(),
    allSourceState(),
    loadClaimsBySource(),
    loadEntitiesBySource(),
    loadLedgerOverlay(),
  ]);

  const reads = await Promise.all(
    list.map(async (entry) => {
      try {
        const r = await vault.read(entry.id, 'Source');
        if (r.frontmatter.type !== 'Source') return null;
        const fm = r.frontmatter as SourceFrontmatter;
        const st: SourceState = stateMap[fm.id] ?? { readAt: null, tags: [] };
        const ledger = ledgerMap.get(fm.canonical_url) ?? null;
        const postedAt = ledger?.postedAt ?? null;
        const bookmarkedAt = ledger?.bookmarkedAt ?? null;
        const kind: InboxRow['kind'] = ledger === null ? 'unknown' : ledger.kind;
        const bylineRaw = fm.host_metadata?.['byline'];
        const byline = typeof bylineRaw === 'string' ? bylineRaw : null;
        const display = deriveInboxDisplay({
          url: fm.canonical_url,
          contentType: fm.content_type,
          body: r.body,
          byline,
        });
        const urlAuthor = authorFromUrl(fm.canonical_url);
        const author: AuthorRef | null =
          display.authorHandle !== null
            ? {
                handle: display.authorHandle,
                display: display.authorDisplay ?? display.authorHandle,
                source: urlAuthor?.source ?? (byline !== null ? 'capture' : 'unknown'),
              }
            : null;
        return {
          id: fm.id,
          url: fm.canonical_url,
          contentType: fm.content_type,
          capturedAt: fm.captured_at,
          postedAt,
          bookmarkedAt,
          // Sort by user-bookmark time (ledger insert preserves x.com's
          // "most-recently-bookmarked" order from the pull). Falls back to
          // import time for sources we can't trace to a ledger row.
          sortAt: bookmarkedAt ?? fm.captured_at,
          primary: display.primary,
          secondary: display.secondary,
          title: display.title,
          snippet: display.snippet,
          author,
          pinned: pinned.has(fm.id),
          read: st.readAt !== null,
          readAt: st.readAt,
          tags: st.tags,
          kind,
          claimCount: claimsBySource.get(fm.id) ?? 0,
          entityCount: entitiesBySource.get(fm.id) ?? 0,
        } satisfies InboxRow;
      } catch {
        return null;
      }
    }),
  );
  const all = reads.filter((r): r is InboxRow => r !== null);

  const totals = {
    all: all.length,
    organic: all.filter((r) => r.kind !== 'derived').length,
    derived: all.filter((r) => r.kind === 'derived').length,
    unread: all.filter((r) => !r.read).length,
    pinned: all.filter((r) => r.pinned).length,
    byContentType: all.reduce<Record<string, number>>((acc, r) => {
      acc[r.contentType] = (acc[r.contentType] ?? 0) + 1;
      return acc;
    }, {}),
  };

  let filtered = all;
  // Default: hide derived rows (URLs extracted from tweet bodies — not user bookmarks).
  if (filter.includeDerived !== true) {
    filtered = filtered.filter((r) => r.kind !== 'derived');
  }
  if (filter.contentType !== undefined) {
    filtered = filtered.filter((r) => r.contentType === filter.contentType);
  }
  if (filter.author !== undefined) {
    const a = filter.author.toLowerCase();
    filtered = filtered.filter((r) => r.author !== null && r.author.handle === a);
  }
  if (filter.read === 'unread') filtered = filtered.filter((r) => !r.read);
  if (filter.read === 'read') filtered = filtered.filter((r) => r.read);
  if (filter.pinned === true) filtered = filtered.filter((r) => r.pinned);
  if (filter.tag !== undefined) {
    const t = filter.tag.toLowerCase();
    filtered = filtered.filter((r) => r.tags.some((rt) => rt.toLowerCase() === t));
  }
  if (filter.q !== undefined && filter.q.length > 0) {
    const q = filter.q.toLowerCase();
    filtered = filtered.filter(
      (r) =>
        r.url.toLowerCase().includes(q) ||
        r.primary.toLowerCase().includes(q) ||
        (r.title !== null && r.title.toLowerCase().includes(q)) ||
        (r.snippet !== null && r.snippet.toLowerCase().includes(q)) ||
        (r.author !== null && r.author.handle.includes(q)),
    );
  }

  filtered.sort((a, b) => {
    if (b.sortAt !== a.sortAt) return b.sortAt.localeCompare(a.sortAt);
    // Tiebreaker for same-batch rows: newer post date first (tweets only).
    const ap = a.postedAt ?? '';
    const bp = b.postedAt ?? '';
    return bp.localeCompare(ap);
  });
  const matchedCount = filtered.length;
  const pageSize = Math.max(1, Math.min(filter.pageSize ?? 50, 200));
  const page = Math.max(1, filter.page ?? 1);
  const start = (page - 1) * pageSize;
  const paged = filtered.slice(start, start + pageSize);
  return { rows: paged, totals, matchedCount, page, pageSize };
};

export type TimeBin = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'older';

export const TIME_BIN_LABEL: Record<TimeBin, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  thisWeek: 'Earlier this week',
  thisMonth: 'Earlier this month',
  older: 'Older',
};

export const binFor = (iso: string, now: Date = new Date()): TimeBin => {
  const ms = now.getTime() - Date.parse(iso);
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const captured = new Date(iso);
  if (captured.getTime() >= startOfDay.getTime()) return 'today';
  const yesterdayStart = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000);
  if (captured.getTime() >= yesterdayStart.getTime()) return 'yesterday';
  if (ms <= 7 * 24 * 60 * 60 * 1000) return 'thisWeek';
  if (ms <= 30 * 24 * 60 * 60 * 1000) return 'thisMonth';
  return 'older';
};

export const groupByBin = (rows: InboxRow[]): Array<{ bin: TimeBin; rows: InboxRow[] }> => {
  const order: TimeBin[] = ['today', 'yesterday', 'thisWeek', 'thisMonth', 'older'];
  const groups = new Map<TimeBin, InboxRow[]>();
  for (const r of rows) {
    const b = binFor(r.sortAt);
    const list = groups.get(b) ?? [];
    list.push(r);
    groups.set(b, list);
  }
  return order.flatMap((b) => {
    const list = groups.get(b);
    return list !== undefined && list.length > 0 ? [{ bin: b, rows: list }] : [];
  });
};
