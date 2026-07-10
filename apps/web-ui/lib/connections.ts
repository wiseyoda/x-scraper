/**
 * Homepage connection activity — attachments since last visit.
 * Uses shared @x-scraper/related aggregation (not a local ranker).
 */

import 'server-only';

import { attachmentsSince, type AttachmentEvent } from '@x-scraper/related';

import { getVault } from './vault';

export type { AttachmentEvent };

export const loadConnectionsSince = async (
  sinceIso: string | null,
): Promise<{ since: string; defaulted: boolean; events: AttachmentEvent[] }> => {
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const defaulted = sinceIso === null;
  const sinceMs = sinceIso !== null ? Date.parse(sinceIso) : Date.now() - SEVEN_DAYS_MS;
  const since = new Date(Number.isFinite(sinceMs) ? sinceMs : Date.now() - SEVEN_DAYS_MS);
  const vault = await getVault();
  const events = await attachmentsSince(
    { vault, graph: null },
    since.toISOString(),
    { sourceLimit: 24, relatedLimit: 4 },
  );
  return { since: since.toISOString(), defaulted, events: events.slice(0, 20) };
};
