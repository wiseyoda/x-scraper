/**
 * Hydrate a Pin (id+kind only) into a richer summary by reading the
 * current vault state. The Pin record never duplicates the item's data
 * — that way the corpus can change underneath (rename, re-synthesize,
 * re-extract) and pins automatically reflect it. Hydration tolerates
 * gone-missing items (returns kind='Missing').
 */

import 'server-only';

import type {
  ClaimFrontmatter,
  EntityFrontmatter,
  EntityType,
  IdeaFrontmatter,
  SourceFrontmatter,
} from '@x-scraper/core';

import { hrefForId } from './idKind';
import { isStalePin, listPins, type Pin } from './pins';
import { getVault } from './vault';

export interface HydratedPin {
  id: string;
  kind: EntityType | 'Missing';
  /** Display label. */
  label: string;
  /** Short context line — e.g. "concept · 23 sources" or "tweet captured 4d ago". */
  meta: string;
  /** Internal href, or null if the kind doesn't have a detail page. */
  href: string | null;
  /** External URL when available (Source X.com bookmark). */
  externalUrl: string | null;
  /** First non-trivial line of the body — null if no body. */
  snippet: string | null;
  pinnedAt: string;
  lastVisitedAt: string | null;
  /** True when the user hasn't opened it in 14+ days. */
  stale: boolean;
  note: string | null;
}

export const hydratePins = async (): Promise<HydratedPin[]> => {
  const pins = await listPins();
  if (pins.length === 0) return [];
  const vault = await getVault();
  const now = new Date().toISOString();

  const hydrated = await Promise.all(
    pins.map(async (pin: Pin): Promise<HydratedPin> => {
      const baseline: HydratedPin = {
        id: pin.id,
        kind: 'Missing',
        label: pin.id,
        meta: 'no longer in vault',
        href: null,
        externalUrl: null,
        snippet: null,
        pinnedAt: pin.pinnedAt,
        lastVisitedAt: pin.lastVisitedAt,
        stale: isStalePin(pin, now),
        note: pin.note,
      };
      try {
        const record = await vault.read(pin.id, pin.kind);
        const fm = record.frontmatter;
        if (fm.type === 'Idea') {
          const ifm = fm as IdeaFrontmatter;
          return {
            ...baseline,
            kind: 'Idea',
            label: ifm.subject,
            meta: `idea · ${ifm.status} · conf ${ifm.synthesizer_confidence.toFixed(2)} · ${String(ifm.sources.length)} sources`,
            href: hrefForId(ifm.id),
            snippet: firstLine(record.body),
          };
        }
        if (fm.type === 'Source') {
          const sfm = fm as SourceFrontmatter;
          return {
            ...baseline,
            kind: 'Source',
            label: sfm.canonical_url,
            meta: `${sfm.content_type} · captured ${formatRelativeShort(sfm.captured_at, now)}`,
            href: hrefForId(sfm.id),
            externalUrl: sfm.canonical_url,
            snippet: firstLine(record.body),
          };
        }
        if (fm.type === 'Claim') {
          const cfm = fm as ClaimFrontmatter;
          return {
            ...baseline,
            kind: 'Claim',
            label: `${cfm.subject} ${cfm.predicate} ${cfm.object}`,
            meta: `claim · from ${String(cfm.sources.length)} source${cfm.sources.length === 1 ? '' : 's'}`,
            href: null, // no claim detail page yet
            snippet: firstLine(record.body),
          };
        }
        // Entity-like (Person/Tool/Concept/Repo/Article/Tweet/Video/PDF)
        const efm = fm as EntityFrontmatter;
        return {
          ...baseline,
          kind: efm.type,
          label: efm.name,
          meta: `${efm.type.toLowerCase()} · ${String(efm.sources.length)} source${efm.sources.length === 1 ? '' : 's'}`,
          href: hrefForId(efm.id),
          snippet: firstLine(record.body),
        };
      } catch {
        return baseline;
      }
    }),
  );

  return hydrated;
};

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
        !l.match(/^https?:\/\//),
    );
  if (lines.length === 0) return null;
  const line = lines[0];
  if (line === undefined) return null;
  return line.length > 200 ? `${line.slice(0, 200).trimEnd()}…` : line;
};

const formatRelativeShort = (iso: string, nowIso: string): string => {
  const ms = Date.parse(nowIso) - Date.parse(iso);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${String(days)}d ago`;
  const months = Math.floor(days / 30);
  return `${String(months)}mo ago`;
};
