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
import { runStatus } from './commands/status.js';
import { resolveConfig } from './config.js';
import { EXIT_FAIL, EXIT_OK, EXIT_USAGE } from './constants.js';

const HELP = `xs — local-first knowledge graph from X.com bookmarks/likes/posts

Usage:
  xs <command> [options]

Commands:
  init                Create the vault and the SQLite queue
  status [--run=ID]   Per-status job counts (optionally scoped to a run)
  cost [--since=ISO]  Total USD spent on LLM/embedding calls since a date
  doctor              Sanity-check the local environment
  help                Show this message

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
