#!/usr/bin/env node
/**
 * `xs` entrypoint. Routes the parsed argv to a command handler and
 * formats its result for the terminal. Each command is a pure-ish
 * function exported from src/commands/, so unit tests don't have to
 * exercise this dispatcher.
 */

import { parseArgs } from './argparse.js';
import { runCost } from './commands/cost.js';
import { type CheckStatus, runDoctor } from './commands/doctor.js';
import { runInit } from './commands/init.js';
import { runReindex } from './commands/reindex.js';
import { runStatus } from './commands/status.js';
import { runSync } from './commands/sync/index.js';
import { buildCuratedSources, wireSyncDeps } from './commands/sync/wire.js';
import { resolveConfig } from './config.js';
import { ENV_FILE_PATH, EXIT_FAIL, EXIT_OK, EXIT_USAGE } from './constants.js';

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
