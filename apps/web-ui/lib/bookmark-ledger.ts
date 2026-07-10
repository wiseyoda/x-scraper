/**
 * Bookmark-ledger reader. The queue's SQLite has the X.com-side post
 * timestamp (`tweet_created_at`) and the user-bookmarked time we never
 * stored on the source frontmatter. Reading it here lets the inbox
 * show "saved 9d ago" instead of "imported 9d ago" — and preserves
 * x.com's "most-recently-bookmarked first" ordering from the pull.
 *
 * **Why subprocess:** Next.js webpack bundling breaks better-sqlite3's
 * `bindings` package (it walks Error.stack to find the .node binary
 * and webpack rewrites the path). The cleanest workaround is to spawn
 * the `sqlite3` CLI (ships with macOS) and parse the JSON it emits.
 * Latency is fine — the query is one shot per dashboard render.
 */

import 'server-only';

import { execFile } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const queuePath = (): string => {
  if (process.env.XSCRAPER_QUEUE !== undefined) return process.env.XSCRAPER_QUEUE;
  return path.join(os.homedir(), '.config', 'x-scraper', 'queue.sqlite');
};

interface LedgerRow {
  source_url: string;
  author: string | null;
  tweet_created_at: string | null;
  created_at: string;
  source_kind: string;
  status: string | null;
  text: string | null;
}

const querySqlite = async (sql: string): Promise<LedgerRow[]> => {
  // -json emits an array of {col: val} objects.
  // Prefer URI mode=ro over CLI `-readonly`: on WAL databases, macOS
  // sqlite3 -readonly often fails with "unable to open database file"
  // when the process cannot create/lock the shared -shm (common under
  // Next and some sandboxes). mode=ro still refuses writes.
  const dbUri = `file:${queuePath()}?mode=ro`;
  const { stdout } = await execFileAsync(
    '/usr/bin/sqlite3',
    ['-json', dbUri, sql],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  if (stdout.trim().length === 0) return [];
  return JSON.parse(stdout) as LedgerRow[];
};

export interface LedgerOverlay {
  postedAt: string | null;
  author: string | null;
  /** When the user first saved it on x.com (ledger insert time). */
  bookmarkedAt: string | null;
  /**
   * 'organic' = a tweet the user actually bookmarked on x.com.
   * 'derived' = a URL the sync pipeline extracted from a bookmarked tweet
   * (e.g. a github.com link inside a tweet body). The inbox should
   * filter to organic by default since derived URLs are noise.
   */
  kind: 'organic' | 'derived';
  /** Ledger pipeline status: new | synced | failed (when known). */
  status: 'new' | 'synced' | 'failed' | null;
  /** Raw tweet/bookmark text from pull — enables pre-extract inbox primary. */
  text: string | null;
}

export interface LastSyncInfo {
  /** Most recent ledger insert time. */
  lastBookmarkedAt: string | null;
  /** Total organic bookmarks in the ledger. */
  organicCount: number;
}

export const lastSyncInfo = async (): Promise<LastSyncInfo> => {
  try {
    const rows = await querySqlite(
      `SELECT created_at, source_url, author, tweet_created_at, source_kind
       FROM bookmark_ledger
       WHERE source_kind = 'organic'
       ORDER BY created_at DESC LIMIT 1`,
    );
    const last = rows[0]?.created_at ?? null;
    const counts = await querySqlite(
      `SELECT COUNT(*) AS n, '' AS source_url, '' AS author, NULL AS tweet_created_at,
              '' AS created_at, 'organic' AS source_kind, NULL AS status, NULL AS text
         FROM bookmark_ledger WHERE source_kind = 'organic'`,
    );
    const n = (counts[0] as unknown as { n?: number })?.n ?? 0;
    return { lastBookmarkedAt: last, organicCount: n };
  } catch {
    return { lastBookmarkedAt: null, organicCount: 0 };
  }
};

let cachedMap: Map<string, LedgerOverlay> | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 30_000;

/**
 * Map every Source canonical_url → ledger overlay. Cached for 30s so
 * the inbox + dashboard don't pay the subprocess cost twice on the
 * same render burst.
 */
export const loadLedgerOverlay = async (): Promise<Map<string, LedgerOverlay>> => {
  const now = Date.now();
  if (cachedMap !== null && now - cachedAt < CACHE_TTL_MS) return cachedMap;
  try {
    const rows = await querySqlite(
      `SELECT source_url, author, tweet_created_at, created_at, source_kind, status, text
         FROM bookmark_ledger`,
    );
    const map = new Map<string, LedgerOverlay>();
    for (const r of rows) {
      const existing = map.get(r.source_url);
      // Prefer organic over derived when both exist for the same URL.
      if (existing !== undefined && existing.kind === 'organic' && r.source_kind === 'derived') {
        continue;
      }
      const st = r.status;
      const status: LedgerOverlay['status'] =
        st === 'new' || st === 'synced' || st === 'failed' ? st : null;
      map.set(r.source_url, {
        postedAt: r.tweet_created_at,
        author: r.author,
        bookmarkedAt: r.created_at,
        kind: r.source_kind === 'derived' ? 'derived' : 'organic',
        status,
        text: r.text,
      });
    }
    cachedMap = map;
    cachedAt = now;
    return map;
  } catch (err) {
    console.error(
      '[bookmark-ledger] query failed:',
      err instanceof Error ? err.message : String(err),
    );
    return new Map();
  }
};

export const lookupLedger = async (sourceUrl: string): Promise<LedgerOverlay | null> => {
  const map = await loadLedgerOverlay();
  return map.get(sourceUrl) ?? null;
};
