/**
 * One-off: hard-auto-expand the existing 210 organic bookmarks. T13's
 * fetchLinksStage only fires on NEW sync passes, so the historical
 * corpus never had its body URLs enqueued as derived rows. This spike
 * walks every organic ledger row, parses URLs out of the text, dedupes
 * against the live ledger, and inserts derived rows.
 *
 * The next `xs bookmarks sync` then drains the backlog through the
 * full ingestor → extractor → graph pipeline. (T14.)
 *
 * Idempotent: re-runs see the existing derived rows and skip.
 *
 * Run:
 *   pnpm spike spikes/backfill-derived-urls.ts
 */

import * as os from 'node:os';
import * as path from 'node:path';

import { canonicalizeUrl, entityId } from '@x-scraper/core';
import { createSqliteQueue } from '@x-scraper/queue';

const QUEUE_PATH = path.join(os.homedir(), '.config', 'x-scraper', 'queue.sqlite');
const URL_RE = /https?:\/\/[^\s)]+/g;
const TCO_HOST_RE = /^https?:\/\/t\.co\//i;
// Tweet permalinks on either x.com or the legacy twitter.com domain.
// We don't have a standalone-tweet ingestor; these would just fail at
// extract_text. Skip them at backfill time.
const TWEET_PERMALINK_RE = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[^/]+\/status\/\d+/i;
const RESOLVE_TIMEOUT_MS = 5_000;

const resolveTcoRedirect = async (url: string): Promise<string> => {
  if (!TCO_HOST_RE.test(url)) return url;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      ctrl.abort();
    }, RESOLVE_TIMEOUT_MS);
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal });
    clearTimeout(t);
    return res.url;
  } catch {
    return url;
  }
};

const main = async (): Promise<void> => {
  const queue = createSqliteQueue(QUEUE_PATH);
  let inserted = 0;
  let skipped = 0;
  let processed = 0;
  try {
    // All organic ledger rows (synced or not). Pull a wide net so the
    // spike doesn't depend on status — we want to enqueue derived rows
    // for the entire historical corpus.
    const rows = queue.listBookmarks({ sourceKind: 'organic', includeSuperseded: false });
    for (const row of rows) {
      processed += 1;
      const matches = row.text.match(URL_RE) ?? [];
      const sourceHost = ((): string => {
        try {
          return new URL(row.sourceUrl).host;
        } catch {
          return '';
        }
      })();
      const candidates: string[] = [];
      const seen = new Set<string>();
      for (const raw of matches) {
        const trimmed = raw.replace(/[.,;!?)\]]+$/, '');
        if (trimmed.length === 0) continue;
        if (trimmed === row.sourceUrl) continue;
        let canonical: string;
        try {
          canonical = canonicalizeUrl(trimmed);
        } catch {
          continue;
        }
        if (seen.has(canonical)) continue;
        seen.add(canonical);
        let host = '';
        try {
          host = new URL(canonical).host;
        } catch {
          continue;
        }
        if (host === sourceHost) continue;
        candidates.push(canonical);
      }
      // Also consider X.com-resolved expanded urls from the ledger row
      // (extractTweetPayload populates these from the tweet entities).
      for (const url of row.urls) {
        let canonical: string;
        try {
          canonical = canonicalizeUrl(url);
        } catch {
          continue;
        }
        if (canonical === row.sourceUrl) continue;
        if (seen.has(canonical)) continue;
        seen.add(canonical);
        candidates.push(canonical);
      }
      for (const candidate of candidates) {
        // Resolve t.co before insert so we know the real destination,
        // dedupe on the resolved URL, and route x.com articles to the
        // x-article ingestor on sync. Tweet permalinks are dropped —
        // we don't ingest standalone tweets.
        const resolved = await resolveTcoRedirect(candidate);
        let canonical: string;
        try {
          canonical = canonicalizeUrl(resolved);
        } catch {
          continue;
        }
        if (TWEET_PERMALINK_RE.test(canonical)) {
          skipped += 1;
          continue;
        }
        if (queue.findBookmarkBySourceUrl(canonical) !== null) {
          skipped += 1;
          continue;
        }
        const derivedEntryId = `derived_${entityId('Source', canonical)}`;
        const result = queue.upsertBookmark({
          entryId: derivedEntryId,
          tweetId: 'derived',
          source: row.source,
          sourceUrl: canonical,
          text: '',
          capturedAt: new Date().toISOString(),
          parentEntryId: row.entryId,
          sourceKind: 'derived',
        });
        if (result === 'inserted') inserted += 1;
        else skipped += 1;
      }
    }
    console.log(
      `\nBackfill: processed=${String(processed)} inserted=${String(inserted)} skipped=${String(skipped)}`,
    );
  } finally {
    queue.close();
  }
};

main().catch((err: unknown) => {
  console.error('backfill failed:', err);
  process.exit(1);
});
