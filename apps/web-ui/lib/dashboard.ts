/**
 * Dashboard data layer. One pass over the vault, returns everything the
 * homepage renders. Parallelized file reads — about 400ms on a 300-source
 * vault on Apple Silicon. Adequate without a cache layer at this scale;
 * revisit when the corpus grows past ~10k records.
 */

import 'server-only';

import type {
  EntityFrontmatter,
  EntityType,
  IdeaFrontmatter,
  SourceFrontmatter,
} from '@x-scraper/core';
import type { VaultStore } from '@x-scraper/vault';

import { loadLedgerOverlay } from './bookmark-ledger';
import { deriveInboxDisplay } from './inbox-display';
import { allSourceState } from './source-state';
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

export interface DashboardStats {
  sourceCount: number;
  claimCount: number;
  entityCount: number;
  ideaCount: number;
  ideaConfirmedCount: number;
  ideaDraftCount: number;
  ideaRejectedCount: number;
  /** Drafts that haven't been auto-confirmed — the manual review queue. */
  needsReviewCount: number;
  /** Sources without a readAt timestamp. */
  unreadSourceCount: number;
}

export interface IdeaSummary {
  id: string;
  status: 'draft' | 'confirmed' | 'rejected';
  autoConfirmed: boolean;
  subject: string;
  confidence: number;
  sourceCount: number;
  derivedFromCount: number;
  updatedAt: string;
  synthesizedAt: string;
  /** First non-trivial paragraph of the body, capped. */
  snippet: string | null;
}

export interface EntitySummary {
  id: string;
  type: EntityType;
  name: string;
  sourceCount: number;
  updatedAt: string;
}

export interface SourceSummary {
  id: string;
  url: string;
  contentType: SourceFrontmatter['content_type'];
  capturedAt: string;
  /** When the original was posted on x.com (tweets only). */
  postedAt: string | null;
  /** When the user first saved it on x.com (ledger insert time). */
  bookmarkedAt: string | null;
  /** Effective sort timestamp — bookmarkedAt when known, else capturedAt. */
  sortAt: string;
  /** Human primary line (title/gist/@author) — never raw URL when better exists. */
  primary: string;
}

export interface WhatsNew {
  /** ISO timestamp of the cutoff used. */
  since: string;
  /** True when the cutoff was synthesized (no prior visit recorded). */
  defaulted: boolean;
  newSources: SourceSummary[];
  newClaimsCount: number;
  newConfirmedIdeas: IdeaSummary[];
  newAutoConfirmedIdeas: IdeaSummary[];
  newEntities: EntitySummary[];
}

export interface DashboardData {
  stats: DashboardStats;
  whatsNew: WhatsNew;
  topConfirmed: IdeaSummary[];
  topEntities: EntitySummary[];
  needsReview: IdeaSummary[];
  /** Latest captured sources (always-on, regardless of last-visit cutoff). */
  recentSources: SourceSummary[];
}

const ideaSummaryFromFm = (fm: IdeaFrontmatter, body?: string): IdeaSummary => ({
  id: fm.id,
  status: fm.status,
  autoConfirmed: fm.auto_confirmed,
  subject: fm.subject,
  confidence: fm.synthesizer_confidence,
  sourceCount: fm.sources.length,
  derivedFromCount: fm.derived_from.length,
  updatedAt: fm.updated_at,
  synthesizedAt: fm.synthesized_at,
  snippet: body !== undefined ? extractSnippet(body) : null,
});

/**
 * Extract the first non-trivial paragraph from an Idea body, stopping
 * before the auto-generated "## Derived from" section (which lists
 * claim references — boring as a preview).
 */
const extractSnippet = (body: string): string | null => {
  const stopAt = body.indexOf('## Derived from');
  const trimmed = stopAt > 0 ? body.slice(0, stopAt) : body;
  const lines = trimmed
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('---'));
  if (lines.length === 0) return null;
  // Prefer the first meaty paragraph (>= 60 chars), else the first line.
  const meaty = lines.find((l) => l.length >= 60) ?? lines[0];
  if (meaty === undefined) return null;
  return meaty.length > 220 ? `${meaty.slice(0, 220).trimEnd()}…` : meaty;
};

const entitySummaryFromFm = (fm: EntityFrontmatter): EntitySummary => ({
  id: fm.id,
  type: fm.type,
  name: fm.name,
  sourceCount: fm.sources.length,
  updatedAt: fm.updated_at,
});

interface IdeaRecord {
  fm: IdeaFrontmatter;
  body: string;
}

const loadAllIdeas = async (vault: VaultStore): Promise<IdeaRecord[]> => {
  const list = await vault.list('Idea');
  const reads = await Promise.all(
    list.map(async (entry) => {
      try {
        const r = await vault.read(entry.id, 'Idea');
        if (r.frontmatter.type !== 'Idea') return null;
        return { fm: r.frontmatter, body: r.body } satisfies IdeaRecord;
      } catch {
        return null;
      }
    }),
  );
  return reads.filter((x): x is IdeaRecord => x !== null);
};

const loadAllEntities = async (vault: VaultStore): Promise<EntityFrontmatter[]> => {
  const out: EntityFrontmatter[] = [];
  await Promise.all(
    ENTITY_TYPES_FOR_LISTING.map(async (type) => {
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
            return r.frontmatter.type === type ? (r.frontmatter as EntityFrontmatter) : null;
          } catch {
            return null;
          }
        }),
      );
      for (const fm of reads) if (fm !== null) out.push(fm);
    }),
  );
  return out;
};

const TOP_CONFIRMED_LIMIT = 6;
const TOP_ENTITIES_LIMIT = 8;
const NEEDS_REVIEW_LIMIT = 5;
const NEW_SOURCES_LIMIT = 8;
const NEW_IDEAS_LIMIT = 5;
const NEW_ENTITIES_LIMIT = 5;

export const computeDashboard = async (sinceIso: string | null): Promise<DashboardData> => {
  const vault = await getVault();

  // Cheap counts via list mtimes — no file reads needed for sources/claims.
  const [sourceList, claimList, ideaFms, entityFms, sourceStateMap, ledgerMap] = await Promise.all([
    vault.list('Source').catch(() => []),
    vault.list('Claim').catch(() => []),
    loadAllIdeas(vault),
    loadAllEntities(vault),
    allSourceState(),
    loadLedgerOverlay(),
  ]);

  let unreadSourceCount = 0;
  for (const e of sourceList) {
    if ((sourceStateMap[e.id]?.readAt ?? null) === null) unreadSourceCount += 1;
  }

  // ---- Stats
  const ideaConfirmedCount = ideaFms.filter((r) => r.fm.status === 'confirmed').length;
  const ideaDraftCount = ideaFms.filter((r) => r.fm.status === 'draft').length;
  const ideaRejectedCount = ideaFms.filter((r) => r.fm.status === 'rejected').length;
  const needsReviewCount = ideaFms.filter(
    (r) => r.fm.status === 'draft' && !r.fm.auto_confirmed,
  ).length;
  const stats: DashboardStats = {
    sourceCount: sourceList.length,
    claimCount: claimList.length,
    entityCount: entityFms.length,
    ideaCount: ideaFms.length,
    ideaConfirmedCount,
    ideaDraftCount,
    ideaRejectedCount,
    needsReviewCount,
    unreadSourceCount,
  };

  // ---- What's new
  // Default to 7 days when there's no prior visit cookie.
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const defaulted = sinceIso === null;
  const sinceMs = sinceIso !== null ? Date.parse(sinceIso) : Date.now() - SEVEN_DAYS_MS;
  const since = new Date(Number.isFinite(sinceMs) ? sinceMs : Date.now() - SEVEN_DAYS_MS);

  const newSourceListEntries = sourceList
    .filter((e) => e.mtime.getTime() > since.getTime())
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .slice(0, NEW_SOURCES_LIMIT);
  const newSourceReads = await Promise.all(
    newSourceListEntries.map(async (e) => {
      try {
        const r = await vault.read(e.id, 'Source');
        if (r.frontmatter.type !== 'Source') return null;
        return { fm: r.frontmatter as SourceFrontmatter, body: r.body };
      } catch {
        return null;
      }
    }),
  );
  const newSources: SourceSummary[] = newSourceReads
    .filter((x): x is { fm: SourceFrontmatter; body: string } => x !== null)
    .map(({ fm, body }): SourceSummary => {
      const ledger = ledgerMap.get(fm.canonical_url) ?? null;
      const postedAt = ledger?.postedAt ?? null;
      const bookmarkedAt = ledger?.bookmarkedAt ?? null;
      const bylineRaw = fm.host_metadata?.['byline'];
      const byline = typeof bylineRaw === 'string' ? bylineRaw : null;
      const display = deriveInboxDisplay({
        url: fm.canonical_url,
        contentType: fm.content_type,
        body,
        byline,
      });
      return {
        id: fm.id,
        url: fm.canonical_url,
        contentType: fm.content_type,
        capturedAt: fm.captured_at,
        postedAt,
        bookmarkedAt,
        sortAt: bookmarkedAt ?? fm.captured_at,
        primary: display.primary,
      };
    });

  const newClaimsCount = claimList.filter((e) => e.mtime.getTime() > since.getTime()).length;

  const recentIdeas = ideaFms.filter((r) => Date.parse(r.fm.updated_at) > since.getTime());
  const newConfirmedIdeas = recentIdeas
    .filter((r) => r.fm.status === 'confirmed')
    .sort((a, b) => b.fm.updated_at.localeCompare(a.fm.updated_at))
    .slice(0, NEW_IDEAS_LIMIT)
    .map((r) => ideaSummaryFromFm(r.fm, r.body));
  const newAutoConfirmedIdeas = recentIdeas
    .filter((r) => r.fm.status === 'confirmed' && r.fm.auto_confirmed)
    .sort((a, b) => b.fm.updated_at.localeCompare(a.fm.updated_at))
    .slice(0, NEW_IDEAS_LIMIT)
    .map((r) => ideaSummaryFromFm(r.fm, r.body));

  const newEntities = entityFms
    .filter((fm) => Date.parse(fm.created_at) > since.getTime())
    .sort((a, b) => b.sources.length - a.sources.length)
    .slice(0, NEW_ENTITIES_LIMIT)
    .map(entitySummaryFromFm);

  const whatsNew: WhatsNew = {
    since: since.toISOString(),
    defaulted,
    newSources,
    newClaimsCount,
    newConfirmedIdeas,
    newAutoConfirmedIdeas,
    newEntities,
  };

  // ---- Top confirmed Ideas (the actual KB index)
  // Order by source count descending, then by recency. Confidence is a
  // tiebreaker. Confirmed-by-evidence beats confirmed-by-recency.
  const topConfirmed: IdeaSummary[] = ideaFms
    .filter((r) => r.fm.status === 'confirmed')
    .sort((a, b) => {
      if (b.fm.sources.length !== a.fm.sources.length)
        return b.fm.sources.length - a.fm.sources.length;
      if (b.fm.synthesizer_confidence !== a.fm.synthesizer_confidence) {
        return b.fm.synthesizer_confidence - a.fm.synthesizer_confidence;
      }
      return b.fm.updated_at.localeCompare(a.fm.updated_at);
    })
    .slice(0, TOP_CONFIRMED_LIMIT)
    .map((r) => ideaSummaryFromFm(r.fm, r.body));

  // ---- Top entities (the corpus center of mass)
  const topEntities: EntitySummary[] = entityFms
    .map(entitySummaryFromFm)
    .sort((a, b) => b.sourceCount - a.sourceCount)
    .slice(0, TOP_ENTITIES_LIMIT);

  // ---- Manual review queue (drafts that didn't auto-confirm)
  const needsReview: IdeaSummary[] = ideaFms
    .filter((r) => r.fm.status === 'draft' && !r.fm.auto_confirmed)
    .sort((a, b) => {
      if (b.fm.sources.length !== a.fm.sources.length)
        return b.fm.sources.length - a.fm.sources.length;
      return b.fm.synthesizer_confidence - a.fm.synthesizer_confidence;
    })
    .slice(0, NEEDS_REVIEW_LIMIT)
    .map((r) => ideaSummaryFromFm(r.fm, r.body));

  // ---- Recent bookmarks (always-on, latest by post date when we have it).
  // Read every source frontmatter so we can sort by ledger-derived
  // postedAt. ~500ms on the live corpus — acceptable for a homepage
  // section that surfaces re-entry points.
  const RECENT_LIMIT = 10;
  const allSourceReads = await Promise.all(
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
  const recentSources: SourceSummary[] = allSourceReads
    .filter((x): x is { fm: SourceFrontmatter; body: string } => x !== null)
    .map(({ fm, body }): SourceSummary => {
      const ledger = ledgerMap.get(fm.canonical_url) ?? null;
      const postedAt = ledger?.postedAt ?? null;
      const bookmarkedAt = ledger?.bookmarkedAt ?? null;
      const bylineRaw = fm.host_metadata?.['byline'];
      const byline = typeof bylineRaw === 'string' ? bylineRaw : null;
      const display = deriveInboxDisplay({
        url: fm.canonical_url,
        contentType: fm.content_type,
        body,
        byline,
      });
      return {
        id: fm.id,
        url: fm.canonical_url,
        contentType: fm.content_type,
        capturedAt: fm.captured_at,
        postedAt,
        bookmarkedAt,
        sortAt: bookmarkedAt ?? fm.captured_at,
        primary: display.primary,
      };
    })
    .sort((a, b) => b.sortAt.localeCompare(a.sortAt))
    .slice(0, RECENT_LIMIT);

  return { stats, whatsNew, topConfirmed, topEntities, needsReview, recentSources };
};
