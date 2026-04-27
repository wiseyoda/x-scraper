/**
 * `xs bookmarks` family — durable bookmark backlog management on top of
 * the existing scraper + queue. Two commands:
 *
 *   xs bookmarks pull [--source=bookmarks|likes|posts] [--max=N]
 *     Drives passive+active capture against X.com, extracts tweet text +
 *     embedded URLs, upserts each row into the `bookmark_ledger` table
 *     with status='new'. Idempotent on entry_id — re-running picks up
 *     newly-discovered rows without disturbing already-synced ones.
 *
 *   xs bookmarks sync [--order=oldest|newest] [--limit=N] [--pause-on-fail]
 *     Picks ledger rows where status='new', oldest-first by default, and
 *     runs them through the existing xs sync pipeline one at a time.
 *     Each bookmark gets its own queue run so vault commits are atomic
 *     per-source. Marks rows as 'synced' or 'failed' as it goes; with
 *     --pause-on-fail, halts on the first failure so the operator can
 *     inspect the resulting Source.md / claims and decide whether to
 *     retry, skip, or fix-and-resume.
 */

import { canonicalizeUrl, contentHash, entityId, type SourceFrontmatter } from '@x-scraper/core';
import type { Logger } from '@x-scraper/observability';
import { createLogger, jsonLineSink } from '@x-scraper/observability';
import type { BookmarkSource, JobQueue } from '@x-scraper/queue';
import { createSqliteQueue } from '@x-scraper/queue';
import type { BookmarkRecord, OpenedSession, SyncOptions } from '@x-scraper/scraper';
import {
  closeSession,
  extractTweetPayload,
  fetchBookmarks,
  fetchLikes,
  fetchPosts,
  openAuthenticatedSession,
  ScraperError,
  TCO_ONLY_TWEET_RE,
  tweetPermalink,
} from '@x-scraper/scraper';
import type { VaultStore } from '@x-scraper/vault';
import { createMarkdownVault } from '@x-scraper/vault';

import type { CliConfig } from '../config.js';
import { ENV_FILE_PATH } from '../constants.js';
import { DEFAULT_PROFILE_DIR } from './auth.js';
import { runSync } from './sync/index.js';
import type { SourceItem } from './sync/types.js';
import { wireSyncDeps } from './sync/wire.js';

export interface BookmarksPullOptions {
  source?: BookmarkSource;
  max?: number;
  profileDir?: string;
  /** Test seam: inject a logger; defaults to a stdout NDJSON logger. */
  logger?: Logger;
  /** Test seam: replace the live scraper. Default opens a real session. */
  fetcher?: (
    source: BookmarkSource,
    options: { max: number; profileDir: string },
  ) => Promise<BookmarkRecord[]>;
}

export interface BookmarksPullResult {
  source: BookmarkSource;
  fetched: number;
  inserted: number;
  unchanged: number;
  skipped: number;
  ledgerTotal: number;
}

const sourceFetcher = async (
  source: BookmarkSource,
  options: { max: number; profileDir: string },
): Promise<BookmarkRecord[]> => {
  // Try headless first — re-uses cookies from a prior `xs auth login`. The
  // scraper auth fallback opens a headed window only if the persistent
  // profile has no live session cookies.
  const session: OpenedSession = await openAuthenticatedSession({
    profileDir: options.profileDir,
  });
  try {
    const syncOptions: SyncOptions = { source, maxBookmarks: options.max };
    if (source === 'bookmarks') {
      const result = await fetchBookmarks(session, syncOptions);
      return result.records;
    }
    if (source === 'likes') {
      const result = await fetchLikes(session, { maxBookmarks: options.max });
      return result.records;
    }
    const result = await fetchPosts(session, { maxBookmarks: options.max });
    return result.records;
  } finally {
    await closeSession(session);
  }
};

const stdoutLogger = (): Logger =>
  createLogger({
    level: 'info',
    sink: jsonLineSink((line) => {
      process.stdout.write(line);
    }),
  });

export const runBookmarksPull = async (
  config: CliConfig,
  options: BookmarksPullOptions = {},
): Promise<BookmarksPullResult> => {
  const source: BookmarkSource = options.source ?? 'bookmarks';
  const max = options.max ?? 200;
  const profileDir = options.profileDir ?? DEFAULT_PROFILE_DIR;
  const logger = options.logger ?? stdoutLogger();
  const fetch = options.fetcher ?? sourceFetcher;

  logger.info('bookmarks.pull.started', { source, max });
  const records = await fetch(source, { max, profileDir });
  logger.info('bookmarks.pull.fetched', { count: records.length });

  const queue: JobQueue = createSqliteQueue(config.queuePath);
  let inserted = 0;
  let unchanged = 0;
  let skipped = 0;
  try {
    for (const record of records) {
      const payload = extractTweetPayload(record);
      if (payload === null) {
        skipped += 1;
        logger.warn('bookmarks.pull.skipped_unparseable', {
          entryId: record.entryId,
          tweetId: record.tweetId,
        });
        continue;
      }
      const url = canonicalizeUrl(tweetPermalink(record.tweetId, payload.author));
      // T21: detect tweet edits by comparing the new text_hash against
      // the LATEST non-superseded row's hash for this tweet. We must
      // NOT key on record.entryId alone — for tweets edited more than
      // once, the original row's textHash is stale and using it as the
      // "prior" hash, plus its unchanging attempts counter as the
      // version suffix, would generate colliding _vN ids. Look up by
      // tweet_id instead so successive edits each supersede the actual
      // current row and pick a fresh _vN.
      const newHash = contentHash(payload.text);
      const chain = queue.bookmarkChainStatus(record.tweetId);
      const current = chain.current;
      if (current !== null && current.textHash !== null && current.textHash !== newHash) {
        // Edit detected. Supersede the current latest, insert a new row
        // pointing back to it so the chain's audit trail stays intact.
        // Version suffix derives from the chain length so it's stable
        // and non-colliding regardless of which row we superseded.
        queue.markBookmarkSuperseded(current.entryId);
        const supersededId = `${record.entryId}_v${chain.totalVersions.toString()}`;
        queue.upsertBookmark({
          entryId: supersededId,
          tweetId: record.tweetId,
          source,
          sourceUrl: url,
          author: payload.author,
          text: payload.text,
          urls: payload.urls,
          capturedAt: record.capturedAt,
          tweetCreatedAt: payload.createdAt,
          parentEntryId: current.entryId,
          textHash: newHash,
        });
        inserted += 1;
        continue;
      }
      const result = queue.upsertBookmark({
        entryId: record.entryId,
        tweetId: record.tweetId,
        source,
        sourceUrl: url,
        author: payload.author,
        text: payload.text,
        urls: payload.urls,
        capturedAt: record.capturedAt,
        tweetCreatedAt: payload.createdAt,
        textHash: newHash,
      });
      if (result === 'inserted') inserted += 1;
      else unchanged += 1;
    }
    const stats = queue.bookmarkStats({ source });
    logger.info('bookmarks.pull.finished', {
      source,
      inserted,
      unchanged,
      skipped,
      ledgerTotal: stats.total,
    });
    return {
      source,
      fetched: records.length,
      inserted,
      unchanged,
      skipped,
      ledgerTotal: stats.total,
    };
  } finally {
    queue.close();
  }
};

// ─── xs bookmarks sync ──────────────────────────────────────────────────

export interface BookmarksSyncOptions {
  order?: 'oldest' | 'newest';
  limit?: number;
  pauseOnFail?: boolean;
  source?: BookmarkSource;
  /** Skip the actual graph write — useful when dogfooding the parser. */
  dryRun?: boolean;
  logger?: Logger;
  /** Test seam: stub the per-bookmark sync runner. */
  syncOne?: (item: BookmarkSyncItem) => Promise<BookmarkSyncOutcome>;
  /** Test seam: inject the vault writer used for link-only stub Source.md files. */
  vault?: VaultStore;
}

export interface BookmarkSyncItem {
  entryId: string;
  source: SourceItem;
  /**
   * X.com's resolved t.co targets from the ledger row. Used by the
   * link-only short-circuit so derived rows still get enqueued for the
   * actual article URL even when extraction is skipped.
   */
  expandedUrls: string[];
}

export interface BookmarkSyncOutcome {
  entryId: string;
  status: 'synced' | 'failed';
  runId: string;
  jobId: string | null;
  jobStatus: 'done' | 'failed' | 'dead' | null;
  error: string | null;
  durationMs: number;
  costUsd: number;
}

export interface BookmarksSyncResult {
  attempted: number;
  succeeded: number;
  failed: number;
  haltedOnFail: boolean;
  totalCostUsd: number;
  outcomes: BookmarkSyncOutcome[];
}

export const buildSyncItemFromLedger = (entry: {
  entryId: string;
  source: BookmarkSource;
  sourceUrl: string;
  author: string | null;
  text: string;
  capturedAt: string;
  urls?: string[];
}): BookmarkSyncItem => {
  const url = canonicalizeUrl(entry.sourceUrl);
  const expanded = entry.urls ?? [];
  const sourceItem: SourceItem = {
    sourceId: entityId('Source', url),
    sourceKind: entry.source,
    url,
    body: entry.text,
    discoveredAt: entry.capturedAt,
    entryId: entry.entryId,
    ...(entry.author === null ? {} : { byline: entry.author }),
    // Pipe the ledger's X-resolved expanded URLs onto SourceItem so
    // fetchLinksStage (hard auto-expand) enqueues derived rows for
    // the resolved destinations rather than the raw t.co shortlinks
    // the body still contains. Without this, derived rows dedupe by
    // t.co and miss repo/video/pdf/X-Article ingestor routing.
    ...(expanded.length === 0 ? {} : { expandedUrls: expanded }),
  };
  // Also stash on the wrapper so the link-only short-circuit (which
  // bypasses fetchLinksStage entirely) can still enqueue derived rows.
  return { entryId: entry.entryId, source: sourceItem, expandedUrls: expanded };
};

const PROMPT_VERSION_DEFAULT = { extraction: 1, reconciliation: 1, embedding: 1 };

/**
 * Pre-flight: a tweet whose body is just a t.co shortlink (image-only,
 * video-only, or quote tweet) has no extractable claims. Run extraction
 * anyway and we burn ~$0.014 in Sonnet+Gemini for nothing — and the
 * useful content lives at the t.co target, recovered separately by hard
 * auto-expand. Write a stub Source.md so the audit trail is preserved
 * (entry_id ↔ source_id) and short-circuit the queue.
 */
const writeLinkOnlyStub = async (
  vault: VaultStore,
  item: BookmarkSyncItem,
  now: string,
): Promise<string> => {
  const body = item.source.body ?? '';
  const fm: SourceFrontmatter = {
    id: item.source.sourceId,
    type: 'Source',
    created_at: now,
    updated_at: now,
    prompt_version: PROMPT_VERSION_DEFAULT,
    sources: [],
    aliases: [],
    tags: [],
    topics: [],
    url: item.source.url,
    canonical_url: item.source.url,
    captured_at: item.source.discoveredAt ?? now,
    content_type: 'tweet',
    host_metadata: {
      sourceKind: item.source.sourceKind,
      skipReason: 'link_only_tweet',
      ...(item.source.byline === undefined ? {} : { byline: item.source.byline }),
    },
    content_hash: contentHash(body),
    embedding_model: 'none',
  };
  return vault.write({ frontmatter: fm, body });
};

const isLinkOnly = (item: BookmarkSyncItem): boolean => {
  const body = item.source.body;
  return body !== undefined && TCO_ONLY_TWEET_RE.test(body);
};

export const runBookmarksSync = async (
  config: CliConfig,
  options: BookmarksSyncOptions = {},
): Promise<BookmarksSyncResult> => {
  const order = options.order ?? 'oldest';
  const logger = options.logger ?? stdoutLogger();
  const queue = createSqliteQueue(config.queuePath);

  const filter: {
    status: 'new';
    order: 'oldest' | 'newest';
    limit?: number;
    source?: BookmarkSource;
  } = { status: 'new', order };
  if (options.limit !== undefined) filter.limit = options.limit;
  if (options.source !== undefined) filter.source = options.source;
  const candidates = queue.listBookmarks(filter);
  queue.close();

  logger.info('bookmarks.sync.started', {
    order,
    candidates: candidates.length,
    pauseOnFail: options.pauseOnFail === true,
  });

  if (candidates.length === 0) {
    return {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      haltedOnFail: false,
      totalCostUsd: 0,
      outcomes: [],
    };
  }

  const items = candidates.map((c) =>
    buildSyncItemFromLedger({
      entryId: c.entryId,
      source: c.source,
      sourceUrl: c.sourceUrl,
      author: c.author,
      text: c.text,
      capturedAt: c.capturedAt,
      urls: c.urls,
    }),
  );

  const syncOne =
    options.syncOne ??
    ((item: BookmarkSyncItem): Promise<BookmarkSyncOutcome> =>
      runOnePerLedgerItem(config, item, options.dryRun === true));

  // Lazily resolve the vault writer used for link-only stub Source.md
  // files — only built when we actually have a link-only candidate, so
  // tests that stub `syncOne` without supplying `vault` still work.
  const vault: VaultStore =
    options.vault ??
    (items.some(isLinkOnly)
      ? createMarkdownVault(config.vaultDir)
      : (null as unknown as VaultStore));
  if (options.vault === undefined && items.some(isLinkOnly)) await vault.init();

  const outcomes: BookmarkSyncOutcome[] = [];
  let totalCost = 0;
  let halted = false;
  for (const item of items) {
    if (isLinkOnly(item)) {
      const start = Date.now();
      const now = new Date().toISOString();
      let derivedEnqueued = 0;
      try {
        await writeLinkOnlyStub(vault, item, now);
        // Preserve the linked target URL by enqueueing a derived ledger
        // row for each X-resolved expanded URL on this bookmark. Without
        // this the linked article would be lost — link-only short-circuit
        // bypasses fetch_links, so hard auto-expand never sees it. (Codex
        // v2 P2.) The next `xs bookmarks sync` pass picks up the derived
        // rows and runs them through the full ingestor pipeline.
        if (item.expandedUrls.length > 0) {
          const expandQueue = createSqliteQueue(config.queuePath);
          try {
            const ledgerSource: 'bookmarks' | 'likes' | 'posts' =
              item.source.sourceKind === 'likes' || item.source.sourceKind === 'posts'
                ? item.source.sourceKind
                : 'bookmarks';
            for (const rawUrl of item.expandedUrls) {
              let canonical: string;
              try {
                canonical = canonicalizeUrl(rawUrl);
              } catch {
                continue;
              }
              if (canonical === item.source.url) continue;
              if (expandQueue.findBookmarkBySourceUrl(canonical) !== null) continue;
              const result = expandQueue.upsertBookmark({
                entryId: `derived_${entityId('Source', canonical)}`,
                tweetId: 'derived',
                source: ledgerSource,
                sourceUrl: canonical,
                text: '',
                capturedAt: now,
                parentEntryId: item.entryId,
                sourceKind: 'derived',
              });
              if (result === 'inserted') derivedEnqueued += 1;
            }
          } finally {
            expandQueue.close();
          }
        }
        outcomes.push({
          entryId: item.entryId,
          runId: 'skip-link-only',
          jobId: null,
          jobStatus: null,
          status: 'synced',
          error: null,
          durationMs: Date.now() - start,
          costUsd: 0,
        });
        logger.info('bookmarks.sync.skipped_link_only', {
          entryId: item.entryId,
          derivedEnqueued,
        });
      } catch (err) {
        outcomes.push({
          entryId: item.entryId,
          runId: 'skip-link-only',
          jobId: null,
          jobStatus: null,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
          costUsd: 0,
        });
      }

      const writebackQueue = createSqliteQueue(config.queuePath);
      try {
        const last = outcomes[outcomes.length - 1];
        if (last !== undefined) {
          writebackQueue.updateBookmark(item.entryId, {
            status: last.status,
            runId: last.runId,
            jobId: last.jobId,
            ...(last.status === 'synced'
              ? { syncedAt: now, lastError: null }
              : { lastError: last.error ?? 'unknown' }),
            bumpAttempts: true,
          });
        }
      } finally {
        writebackQueue.close();
      }
      continue;
    }

    const outcome = await syncOne(item);
    outcomes.push(outcome);
    totalCost += outcome.costUsd;

    // Reflect the outcome in the ledger.
    const writebackQueue = createSqliteQueue(config.queuePath);
    try {
      writebackQueue.updateBookmark(item.entryId, {
        status: outcome.status,
        runId: outcome.runId,
        jobId: outcome.jobId,
        ...(outcome.status === 'synced'
          ? { syncedAt: new Date().toISOString(), lastError: null }
          : { lastError: outcome.error ?? 'unknown' }),
        bumpAttempts: true,
      });
    } finally {
      writebackQueue.close();
    }

    logger.info('bookmarks.sync.item.done', {
      entryId: item.entryId,
      status: outcome.status,
      durationMs: outcome.durationMs,
      costUsd: outcome.costUsd,
    });

    if (outcome.status === 'failed' && options.pauseOnFail === true) {
      halted = true;
      break;
    }
  }

  const succeeded = outcomes.filter((o) => o.status === 'synced').length;
  const failed = outcomes.filter((o) => o.status === 'failed').length;
  logger.info('bookmarks.sync.finished', {
    attempted: outcomes.length,
    succeeded,
    failed,
    haltedOnFail: halted,
    totalCostUsd: totalCost,
  });

  return {
    attempted: outcomes.length,
    succeeded,
    failed,
    haltedOnFail: halted,
    totalCostUsd: totalCost,
    outcomes,
  };
};

const runOnePerLedgerItem = async (
  config: CliConfig,
  item: BookmarkSyncItem,
  dryRun: boolean,
): Promise<BookmarkSyncOutcome> => {
  const start = Date.now();
  // Each bookmark gets its own SyncDeps so the dispatcher's loadSources
  // returns exactly that one item. The queue is opened fresh inside
  // wireSyncDeps and closed in cleanup so concurrent reads from the
  // ledger writeback don't deadlock with WAL writers.
  //
  // wireSyncDeps must be inside the try so a wire-time failure (missing
  // env, Neo4j down, vault init failure) is recorded as a per-bookmark
  // failure instead of aborting the whole batch. (Codex P2.)
  let wired: Awaited<ReturnType<typeof wireSyncDeps>> | null = null;
  try {
    wired = await wireSyncDeps(
      {
        envFilePath: ENV_FILE_PATH,
        vaultDir: config.vaultDir,
        queuePath: config.queuePath,
      },
      [item.source],
    );
    const result = await runSync(wired.deps, {
      source: item.source.sourceKind,
      ...(dryRun ? { skipGraph: true } : {}),
    });
    const job = result.jobs[0];
    const jobStatus: 'done' | 'failed' | 'dead' | null = job?.status ?? null;
    const errStage = job?.stages.find((s) => !s.ok);
    return {
      entryId: item.entryId,
      runId: result.runId,
      jobId: job?.jobId ?? null,
      jobStatus,
      status: result.jobsCompleted > 0 ? 'synced' : 'failed',
      error: errStage === undefined ? null : `${errStage.stage}: ${errStage.errorMsg ?? 'unknown'}`,
      durationMs: Date.now() - start,
      costUsd: result.totalCostUsd,
    };
  } catch (err) {
    return {
      entryId: item.entryId,
      runId: 'wire-failure',
      jobId: null,
      jobStatus: null,
      status: 'failed',
      error:
        err instanceof ScraperError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err),
      durationMs: Date.now() - start,
      costUsd: 0,
    };
  } finally {
    if (wired !== null) await wired.cleanup();
  }
};
