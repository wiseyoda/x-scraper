/**
 * `xs run-cycle` — autonomous pipeline tick.
 *
 * Three steps in sequence: pull bookmarks → drain N ledger rows →
 * re-synthesize ideas with --force so the auto-confirm policy reapplies.
 * Each step is best-effort: a failure in pull doesn't block sync, and a
 * failure in sync doesn't block synthesize. The whole cycle is idempotent
 * (pull is upsert; sync skips already-synced; synthesize is content-keyed)
 * so it's safe to run from launchd at any cadence.
 *
 * Designed to be the only command a scheduled run needs. The CLI's
 * `xs schedule install --mode=run-cycle` wires it into launchd.
 */

import type { SynthesisResult } from '@x-scraper/synthesizer';

import type { CliConfig } from '../config.js';
import { ENV_FILE_PATH } from '../constants.js';
import type { BookmarksPullResult, BookmarksSyncResult } from './bookmarks.js';
import { runBookmarksPull, runBookmarksSync } from './bookmarks.js';
import { runIdeasSynthesize } from './ideas.js';
import { wireSyncDeps } from './sync/wire.js';

const DEFAULT_PULL_MAX = 200;
const DEFAULT_SYNC_LIMIT = 64;

export interface RunCycleOptions {
  /** Max bookmarks to pull from x.com per cycle. */
  pullMax?: number;
  /** Max ledger rows to drain through the pipeline per cycle. */
  syncLimit?: number;
  /** Order to drain rows. Default 'oldest' so backlog doesn't starve. */
  syncOrder?: 'oldest' | 'newest';
  /** Skip the pull step (e.g. if you only want to drain existing rows). */
  skipPull?: boolean;
  /** Skip the synthesize step. */
  skipSynthesize?: boolean;
}

export interface RunCycleResult {
  pull: BookmarksPullResult | null;
  pullError: string | null;
  sync: BookmarksSyncResult | null;
  syncError: string | null;
  synthesis: SynthesisResult | null;
  synthesisError: string | null;
}

export const runCycle = async (
  config: CliConfig,
  options: RunCycleOptions = {},
): Promise<RunCycleResult> => {
  const result: RunCycleResult = {
    pull: null,
    pullError: null,
    sync: null,
    syncError: null,
    synthesis: null,
    synthesisError: null,
  };

  // Step 1: pull. Failure here usually means stale auth cookies; downstream
  // steps still have value (existing ledger rows + claims) so we keep going.
  if (options.skipPull !== true) {
    try {
      result.pull = await runBookmarksPull(config, {
        max: options.pullMax ?? DEFAULT_PULL_MAX,
      });
    } catch (err) {
      result.pullError = err instanceof Error ? err.message : String(err);
    }
  }

  // Step 2: sync. Drains oldest-first to avoid starving the backlog.
  try {
    result.sync = await runBookmarksSync(config, {
      order: options.syncOrder ?? 'oldest',
      limit: options.syncLimit ?? DEFAULT_SYNC_LIMIT,
    });
  } catch (err) {
    result.syncError = err instanceof Error ? err.message : String(err);
  }

  // Step 3: synthesize with --force so the auto-confirm policy is applied
  // to existing drafts as the corpus grows. Cost is bounded — synthesize
  // skips clusters whose anchor already produced an Idea this prompt
  // version unless force is set; the cost ($0.18 across 16 ideas at session
  // close) is the worst case for a fully-replayed cycle.
  if (options.skipSynthesize !== true) {
    const wired = await wireSyncDeps(
      {
        envFilePath: ENV_FILE_PATH,
        vaultDir: config.vaultDir,
        queuePath: config.queuePath,
      },
      [],
    );
    try {
      result.synthesis = await runIdeasSynthesize({
        vault: wired.deps.vault,
        graph: wired.deps.graph,
        llm: wired.deps.llm,
        logger: wired.deps.logger,
        force: true,
      });
    } catch (err) {
      result.synthesisError = err instanceof Error ? err.message : String(err);
    } finally {
      await wired.cleanup();
    }
  }

  return result;
};
