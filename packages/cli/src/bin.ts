#!/usr/bin/env node
/**
 * `xs` entrypoint. Routes the parsed argv to a command handler and
 * formats its result for the terminal. Each command is a pure-ish
 * function exported from src/commands/, so unit tests don't have to
 * exercise this dispatcher.
 */

import type { BookmarkSource } from '@x-scraper/queue';
import { createMarkdownVault } from '@x-scraper/vault';

import { parseArgs } from './argparse.js';
import { runAuthLogin } from './commands/auth.js';
import { runBookmarksPull, runBookmarksSync } from './commands/bookmarks.js';
import { runCost } from './commands/cost.js';
import { type CheckStatus, runDoctor } from './commands/doctor.js';
import { runInit } from './commands/init.js';
import { MCP_CLIENTS, type McpClient, runMcpRegister } from './commands/mcp-register.js';
import { runReindex } from './commands/reindex.js';
import { runReview } from './commands/review.js';
import {
  runScheduleInstall,
  runScheduleUninstall,
  type ScheduleMode,
} from './commands/schedule.js';
import { runStatus } from './commands/status.js';
import { runSync } from './commands/sync/index.js';
import { buildCuratedSources, wireSyncDeps } from './commands/sync/wire.js';
import { runTopicDetect } from './commands/topic.js';
import { resolveConfig } from './config.js';
import { ENV_FILE_PATH, EXIT_FAIL, EXIT_OK, EXIT_USAGE } from './constants.js';

const BOOKMARK_SOURCES: readonly BookmarkSource[] = ['bookmarks', 'likes', 'posts'];
const isBookmarkSource = (s: string): s is BookmarkSource =>
  (BOOKMARK_SOURCES as readonly string[]).includes(s);

const HELP = `xs — local-first knowledge graph from X.com bookmarks/likes/posts

Usage:
  xs <command> [options]

Commands:
  init                              Create the vault and the SQLite queue
  status [--run=ID]                 Per-status job counts (optionally scoped to a run)
  cost [--since=ISO]                Total USD spent on LLM/embedding calls since a date
  doctor                            Sanity-check the local environment
  sync --urls=<a,b,c> [--limit=N]   Run the ingest pipeline against a list of URLs
       [--source=bookmarks]         Source kind tag for the ingested items
       [--max-attempts=N]           Per-job retry budget (default 3)
       [--dry-run]                  Skip the update_graph stage
  reindex --from-vault [--limit=N]  Rebuild the graph from existing vault markdown
       [--max-attempts=N]
  auth login [--profile-dir=DIR]    Open an authenticated x.com session (Patchright)
  bookmarks pull                    Pull bookmarks/likes/posts from x.com into the ledger
       [--source=bookmarks|likes|posts]
       [--max=N] [--profile-dir=DIR]
  bookmarks sync                    Run pipeline against ledger rows one-at-a-time
       [--order=oldest|newest]      Default oldest-first
       [--limit=N] [--source=bookmarks|likes|posts]
       [--pause-on-fail] [--dry-run]
  mcp register --client=CLIENT      Wire xs-mcp into a client config
                                    (CLIENT: claude|codex|gemini)
  topic detect                      Run community detection over Concept-RELATED_TO-Concept
       [--synthesize]                Use Sonnet to title each topic (billed)
       [--min-size=N]                Drop communities smaller than N (default 5)
       [--dry-run]                   Skip vault + graph writes
  schedule install                  Install a launchd plist that runs xs on a schedule
       [--mode=bookmarks-sync|sync] Default: bookmarks-sync
       [--interval=SECONDS]         Default: 3600 (1h)
  schedule uninstall                Remove the launchd plist + bootout the agent
       [--mode=bookmarks-sync|sync]
  review                            List entity records that need human triage
  help                              Show this message

Environment:
  XSCRAPER_VAULT      Vault directory (default: ~/Documents/x-scraper-vault)
  XSCRAPER_QUEUE      Queue SQLite path (default: ~/.config/x-scraper/queue.sqlite)
`;

const STATUS_GLYPH: Record<CheckStatus, string> = {
  PASS: '[ok] ',
  WARN: '[!]  ',
  FAIL: '[x]  ',
};

const printHelp = (): void => {
  console.log(HELP);
};

const runMain = async (): Promise<number> => {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === null || args.command === 'help' || args.flags.has('help')) {
    printHelp();
    return EXIT_OK;
  }
  const config = resolveConfig();

  switch (args.command) {
    case 'init': {
      const result = await runInit(config);
      console.log(`vault: ${result.vaultDir} (${result.vaultCreated ? 'created' : 'present'})`);
      console.log(`queue: ${result.queuePath} (${result.queueCreated ? 'created' : 'present'})`);
      return EXIT_OK;
    }
    case 'status': {
      const runId = args.options.get('run') ?? null;
      const result = runStatus(config, runId);
      const scope = result.runId === null ? 'all runs' : `run=${result.runId}`;
      console.log(`status (${scope}):`);
      for (const [k, v] of Object.entries(result.stats)) {
        console.log(`  ${k.padEnd(8)} ${String(v)}`);
      }
      console.log(`  dlq      ${String(result.dlqCount)}`);
      return EXIT_OK;
    }
    case 'cost': {
      const since = args.options.get('since');
      const result = since === undefined ? runCost(config) : runCost(config, since);
      console.log(`since ${result.sinceIso}: $${result.totalUsd.toFixed(4)}`);
      return EXIT_OK;
    }
    case 'doctor': {
      const checks = await runDoctor(config);
      let anyFail = false;
      for (const check of checks) {
        if (check.status === 'FAIL') anyFail = true;
        console.log(`${STATUS_GLYPH[check.status]} ${check.name.padEnd(24)} ${check.detail}`);
      }
      return anyFail ? EXIT_FAIL : EXIT_OK;
    }
    case 'auth': {
      const sub = args.positionals[0];
      if (sub !== 'login') {
        console.error(`xs auth: unknown subcommand "${sub ?? ''}" — only 'login' is supported`);
        return EXIT_USAGE;
      }
      const profileDir = args.options.get('profile-dir');
      const result = await runAuthLogin({
        ...(profileDir === undefined ? {} : { profileDir }),
      });
      console.log(
        `auth: ${result.screenName} (id ${result.userId}) via ${result.pathTaken}; profile=${result.profileDir}`,
      );
      return EXIT_OK;
    }
    case 'bookmarks': {
      const sub = args.positionals[0];
      if (sub !== 'pull' && sub !== 'sync') {
        console.error(`xs bookmarks: unknown subcommand "${sub ?? ''}" — use 'pull' or 'sync'`);
        return EXIT_USAGE;
      }
      const sourceArg = args.options.get('source');
      if (sourceArg !== undefined && !isBookmarkSource(sourceArg)) {
        console.error(`xs bookmarks: --source must be bookmarks|likes|posts (got ${sourceArg})`);
        return EXIT_USAGE;
      }
      if (sub === 'pull') {
        const maxStr = args.options.get('max');
        const profileDir = args.options.get('profile-dir');
        const result = await runBookmarksPull(config, {
          ...(sourceArg === undefined ? {} : { source: sourceArg }),
          ...(maxStr === undefined ? {} : { max: Number(maxStr) }),
          ...(profileDir === undefined ? {} : { profileDir }),
        });
        console.log(
          `bookmarks pull (${result.source}): fetched=${String(result.fetched)} inserted=${String(result.inserted)} unchanged=${String(result.unchanged)} skipped=${String(result.skipped)} ledger=${String(result.ledgerTotal)}`,
        );
        return EXIT_OK;
      }
      // sync
      const orderArg = args.options.get('order') ?? 'oldest';
      if (orderArg !== 'oldest' && orderArg !== 'newest') {
        console.error(`xs bookmarks sync: --order must be oldest|newest (got ${orderArg})`);
        return EXIT_USAGE;
      }
      const limitStr = args.options.get('limit');
      const result = await runBookmarksSync(config, {
        order: orderArg,
        ...(sourceArg === undefined ? {} : { source: sourceArg }),
        ...(limitStr === undefined ? {} : { limit: Number(limitStr) }),
        ...(args.flags.has('pause-on-fail') ? { pauseOnFail: true } : {}),
        ...(args.flags.has('dry-run') ? { dryRun: true } : {}),
      });
      console.log(
        `bookmarks sync: attempted=${String(result.attempted)} succeeded=${String(result.succeeded)} failed=${String(result.failed)}${result.haltedOnFail ? ' (halted on fail)' : ''} cost=$${result.totalCostUsd.toFixed(4)}`,
      );
      return result.failed > 0 ? EXIT_FAIL : EXIT_OK;
    }
    case 'mcp': {
      const sub = args.positionals[0];
      if (sub !== 'register') {
        console.error(`xs mcp: unknown subcommand "${sub ?? ''}" — only 'register' is supported`);
        return EXIT_USAGE;
      }
      const clientArg = args.options.get('client');
      if (clientArg === undefined || !(MCP_CLIENTS as string[]).includes(clientArg)) {
        console.error(
          `xs mcp register: --client must be one of ${MCP_CLIENTS.join('|')} (got ${clientArg ?? 'nothing'})`,
        );
        return EXIT_USAGE;
      }
      const binPath = args.options.get('bin');
      const result = await runMcpRegister(clientArg as McpClient, {
        ...(binPath === undefined ? {} : { binPath }),
      });
      console.log(
        `mcp register ${result.client}: ${result.changed ? 'wrote' : 'unchanged'} ${result.configPath}`,
      );
      return EXIT_OK;
    }
    case 'topic': {
      const sub = args.positionals[0];
      if (sub !== 'detect') {
        console.error(`xs topic: unknown subcommand "${sub ?? ''}" — only 'detect' is supported`);
        return EXIT_USAGE;
      }
      const minSizeStr = args.options.get('min-size');
      const result = await runTopicDetect(config, {
        synthesize: args.flags.has('synthesize'),
        ...(args.flags.has('dry-run') ? { dryRun: true } : {}),
        ...(minSizeStr === undefined ? {} : { minCommunitySize: Number(minSizeStr) }),
      });
      console.log(
        `topic detect: nodes=${String(result.totalNodes)} edges=${String(result.totalEdges)} communities=${String(result.communitiesFound)} written=${String(result.topicsWritten)} cost=$${result.costUsd.toFixed(4)}`,
      );
      return EXIT_OK;
    }
    case 'schedule': {
      const sub = args.positionals[0];
      if (sub !== 'install' && sub !== 'uninstall') {
        console.error(
          `xs schedule: unknown subcommand "${sub ?? ''}" — use 'install' or 'uninstall'`,
        );
        return EXIT_USAGE;
      }
      const modeArg = args.options.get('mode') ?? 'bookmarks-sync';
      if (modeArg !== 'bookmarks-sync' && modeArg !== 'sync') {
        console.error(`xs schedule: --mode must be bookmarks-sync|sync (got ${modeArg})`);
        return EXIT_USAGE;
      }
      const mode: ScheduleMode = modeArg;
      if (sub === 'install') {
        const intervalStr = args.options.get('interval');
        const result = await runScheduleInstall({
          mode,
          ...(intervalStr === undefined ? {} : { intervalSeconds: Number(intervalStr) }),
        });
        console.log(
          `schedule install (${result.mode}): ${result.loaded ? 'loaded' : 'wrote'} ${result.plistPath} every ${String(result.intervalSeconds)}s`,
        );
        return EXIT_OK;
      }
      const result = await runScheduleUninstall({ mode });
      console.log(
        `schedule uninstall (${result.label}): ${result.removed ? 'removed' : 'no plist found at'} ${result.plistPath}`,
      );
      return EXIT_OK;
    }
    case 'review': {
      const vault = createMarkdownVault(config.vaultDir);
      const result = await runReview(vault);
      console.log(`review: scanned ${String(result.scanned)} entity records`);
      if (result.candidates.length === 0) {
        console.log('  no duplicate-name candidates found');
        return EXIT_OK;
      }
      for (const c of result.candidates) {
        console.log(`  [${c.type}] ${c.name} — ${String(c.ids.length)} duplicates`);
        for (const p of c.paths) console.log(`    ${p}`);
      }
      return EXIT_OK;
    }
    case 'reindex': {
      if (!args.flags.has('from-vault')) {
        console.error('xs reindex: --from-vault is required (no other source supported yet)');
        return EXIT_USAGE;
      }
      const limitStr = args.options.get('limit');
      const maxAttemptsStr = args.options.get('max-attempts');
      const wired = await wireSyncDeps(
        {
          envFilePath: ENV_FILE_PATH,
          vaultDir: config.vaultDir,
          queuePath: config.queuePath,
        },
        [],
      );
      try {
        const result = await runReindex(wired.deps, {
          ...(limitStr === undefined ? {} : { limit: Number(limitStr) }),
          ...(maxAttemptsStr === undefined ? {} : { maxAttempts: Number(maxAttemptsStr) }),
        });
        console.log(
          `reindex ${result.runId}: loaded=${String(result.sourcesLoaded)} done=${String(result.jobsCompleted)} dead=${String(result.jobsDead)} failed=${String(result.jobsFailed)} cost=$${result.totalCostUsd.toFixed(4)} duration=${String(result.durationMs)}ms`,
        );
        return result.jobsDead > 0 ? EXIT_FAIL : EXIT_OK;
      } finally {
        await wired.cleanup();
      }
    }
    case 'sync': {
      const urlsArg = args.options.get('urls');
      if (urlsArg === undefined || urlsArg.length === 0) {
        console.error('xs sync: --urls is required (comma-separated list of URLs to ingest)');
        return EXIT_USAGE;
      }
      const urls = urlsArg
        .split(',')
        .map((u) => u.trim())
        .filter((u) => u.length > 0);
      const curated = buildCuratedSources(urls);
      const limitStr = args.options.get('limit');
      const maxAttemptsStr = args.options.get('max-attempts');
      const sourceKind = args.options.get('source') ?? 'bookmarks';
      if (sourceKind !== 'bookmarks' && sourceKind !== 'likes' && sourceKind !== 'posts') {
        console.error(`xs sync: --source must be bookmarks|likes|posts (got ${sourceKind})`);
        return EXIT_USAGE;
      }
      const wired = await wireSyncDeps(
        {
          envFilePath: ENV_FILE_PATH,
          vaultDir: config.vaultDir,
          queuePath: config.queuePath,
        },
        curated.map((c) => ({ ...c, sourceKind })),
      );
      try {
        const result = await runSync(wired.deps, {
          source: sourceKind,
          ...(limitStr === undefined ? {} : { limit: Number(limitStr) }),
          ...(maxAttemptsStr === undefined ? {} : { maxAttempts: Number(maxAttemptsStr) }),
          ...(args.flags.has('dry-run') ? { skipGraph: true } : {}),
        });
        console.log(
          `sync ${result.runId}: enqueued=${String(result.jobsEnqueued)} done=${String(result.jobsCompleted)} dead=${String(result.jobsDead)} failed=${String(result.jobsFailed)} cost=$${result.totalCostUsd.toFixed(4)} duration=${String(result.durationMs)}ms`,
        );
        return result.jobsDead > 0 ? EXIT_FAIL : EXIT_OK;
      } finally {
        await wired.cleanup();
      }
    }
    default:
      console.error(`unknown command: ${args.command}`);
      printHelp();
      return EXIT_USAGE;
  }
};

runMain()
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    console.error('xs:', err instanceof Error ? err.message : String(err));
    process.exit(EXIT_FAIL);
  });
