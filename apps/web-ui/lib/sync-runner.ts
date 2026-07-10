/**
 * Run-cycle from the app.
 *
 * Spawns `/opt/homebrew/bin/node packages/cli/dist/bin.js run-cycle` as
 * a detached subprocess and writes progress to
 * `<vault>/.xscraper/sync-runs/<runId>.json` so the UI can poll.
 *
 * Why subprocess: better-sqlite3's ABI is tied to Homebrew Node (the
 * one the CLI builds against), not the pnpm Node Next dev runs on.
 * Calling the CLI in-process would crash on first queue access.
 *
 * One run at a time — concurrent invocations would race the queue and
 * the vault writer.
 */

import 'server-only';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { openSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveWebUiConfig } from './config';
import {
  selectOrphanLogRunIds,
  selectRunIdsToPrune,
  type RunRetentionInput,
} from './sync-run-retention';

const CLI_BIN_PATH =
  process.env.XSCRAPER_CLI_BIN ??
  path.join(process.cwd(), '..', '..', 'packages', 'cli', 'dist', 'bin.js');
const NODE_BIN = process.env.XSCRAPER_NODE_BIN ?? '/opt/homebrew/bin/node';

const runsDir = (): string => path.join(resolveWebUiConfig().vaultDir, '.xscraper', 'sync-runs');

const runStatePath = (runId: string): string => path.join(runsDir(), `${runId}.json`);

const runLogPath = (runId: string): string => path.join(runsDir(), `${runId}.log`);

/**
 * P4.4 — prune old sync-run state + logs under `.xscraper/sync-runs/`.
 * Best-effort; never throws into the sync path.
 */
export const pruneSyncRuns = async (): Promise<{ pruned: number }> => {
  try {
    const dir = runsDir();
    const entries = await fs.readdir(dir);
    const jsonFiles = entries.filter((f) => f.endsWith('.json'));
    const inputs: RunRetentionInput[] = [];
    for (const f of jsonFiles) {
      try {
        const raw = await fs.readFile(path.join(dir, f), 'utf8');
        const s = JSON.parse(raw) as SyncRunState;
        if (typeof s.runId !== 'string' || typeof s.startedAt !== 'string') continue;
        const stage = s.stage;
        if (
          stage !== 'pending' &&
          stage !== 'running' &&
          stage !== 'success' &&
          stage !== 'failed'
        ) {
          continue;
        }
        inputs.push({ runId: s.runId, startedAt: s.startedAt, stage });
      } catch {
        /* skip corrupt */
      }
    }
    const ids = new Set([
      ...selectRunIdsToPrune(inputs, { nowMs: Date.now() }),
      ...selectOrphanLogRunIds(entries),
    ]);
    let pruned = 0;
    for (const id of ids) {
      for (const ext of ['.json', '.log'] as const) {
        try {
          await fs.unlink(path.join(dir, `${id}${ext}`));
          pruned += 1;
        } catch {
          /* missing ok */
        }
      }
    }
    return { pruned };
  } catch {
    return { pruned: 0 };
  }
};

export type SyncStage = 'pending' | 'running' | 'success' | 'failed';

export interface SyncRunState {
  runId: string;
  stage: SyncStage;
  startedAt: string;
  finishedAt: string | null;
  /** Last ~64KB of stdout. Newer lines append; we trim from the head. */
  log: string;
  /** Exit code; null while running. */
  exitCode: number | null;
  /** Best-effort error message if stage='failed'. */
  error: string | null;
}

const LOG_MAX_BYTES = 64 * 1024;

const writeState = async (state: SyncRunState): Promise<void> => {
  await fs.mkdir(runsDir(), { recursive: true });
  const target = runStatePath(state.runId);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(tmp, target);
};

/**
 * Stitch the on-disk state with a fresh tail of the log file. The state
 * file is updated by the dev server when stdout flushes; the log file
 * is appended-to directly by the subprocess. If the dev server died,
 * the log file keeps growing but state.json freezes — so we always
 * prefer the log file's content + apply a liveness check.
 */
const enrichWithLog = async (state: SyncRunState): Promise<SyncRunState> => {
  let log = state.log;
  let lastWriteAt: Date | null = null;
  try {
    const raw = await fs.readFile(runLogPath(state.runId), 'utf8');
    log = raw.length > LOG_MAX_BYTES ? raw.slice(raw.length - LOG_MAX_BYTES) : raw;
    const stat = await fs.stat(runLogPath(state.runId));
    lastWriteAt = stat.mtime;
  } catch {
    /* no log file yet */
  }

  // Liveness check: if stage='running' but the log hasn't been written
  // to in 90 seconds AND the run started more than 60 seconds ago, the
  // subprocess is presumed dead.
  let stage = state.stage;
  let error = state.error;
  let finishedAt = state.finishedAt;
  if ((stage === 'running' || stage === 'pending') && lastWriteAt !== null) {
    const ageMs = Date.now() - lastWriteAt.getTime();
    const sinceStartMs = Date.now() - Date.parse(state.startedAt);
    if (ageMs > 90_000 && sinceStartMs > 60_000) {
      stage = 'failed';
      error = 'subprocess stopped writing logs (presumed dead)';
      finishedAt = lastWriteAt.toISOString();
    }
  }

  return { ...state, log, stage, error, finishedAt };
};

export const readSyncState = async (runId: string): Promise<SyncRunState | null> => {
  try {
    const raw = await fs.readFile(runStatePath(runId), 'utf8');
    const base = JSON.parse(raw) as SyncRunState;
    return await enrichWithLog(base);
  } catch {
    return null;
  }
};

export const latestSyncState = async (): Promise<SyncRunState | null> => {
  try {
    const entries = await fs.readdir(runsDir());
    const json = entries.filter((f) => f.endsWith('.json'));
    if (json.length === 0) return null;
    // Read all, return the most recently started.
    const states = await Promise.all(
      json.map(async (f) => {
        try {
          const raw = await fs.readFile(path.join(runsDir(), f), 'utf8');
          return JSON.parse(raw) as SyncRunState;
        } catch {
          return null;
        }
      }),
    );
    const valid = states.filter((s): s is SyncRunState => s !== null);
    valid.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const top = valid[0];
    if (top === undefined) return null;
    return await enrichWithLog(top);
  } catch {
    return null;
  }
};

export interface StartSyncOptions {
  pullMax?: number;
  syncLimit?: number;
  skipPull?: boolean;
}

const isCurrentlyRunning = async (): Promise<SyncRunState | null> => {
  const latest = await latestSyncState();
  if (latest === null) return null;
  // Stale-running guard: a run that hasn't been touched in 30 minutes is
  // assumed dead (process killed, machine slept, etc.). The next start
  // call clears it.
  if (latest.stage !== 'running' && latest.stage !== 'pending') return null;
  const ageMs = Date.now() - Date.parse(latest.startedAt);
  if (ageMs > 30 * 60 * 1000) return null;
  return latest;
};

export const startSync = async (
  options: StartSyncOptions = {},
): Promise<{ runId: string; alreadyRunning: boolean }> => {
  const inflight = await isCurrentlyRunning();
  if (inflight !== null) {
    return { runId: inflight.runId, alreadyRunning: true };
  }

  // Housekeeping before a new run so disk doesn't grow unbounded.
  await pruneSyncRuns();

  const runId = randomUUID();
  const state: SyncRunState = {
    runId,
    stage: 'pending',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    log: '',
    exitCode: null,
    error: null,
  };
  await writeState(state);

  const args = [
    CLI_BIN_PATH,
    'run-cycle',
    `--pull-max=${String(options.pullMax ?? 200)}`,
    `--sync-limit=${String(options.syncLimit ?? 64)}`,
  ];
  if (options.skipPull === true) args.push('--skip-pull');

  const env = {
    ...process.env,
    // Make sure the subprocess can find the CLI's env file even when
    // PATH/HOME are quirky under launchd/Next.
    HOME: process.env.HOME ?? os.homedir(),
  };

  // Open the log file BEFORE spawning so stdio can redirect into it.
  // Writing directly to a file (instead of piping to the parent) means
  // the subprocess survives parent death — no broken pipes, no EPIPE
  // crash. The dev server can restart freely while sync runs to
  // completion.
  await fs.mkdir(runsDir(), { recursive: true });
  const logFd = openSync(runLogPath(runId), 'a');

  const child = spawn(NODE_BIN, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env,
  });

  // Mark running ASAP so the UI flips even if the spawn is slow.
  await writeState({ ...state, stage: 'running' });

  // Best-effort exit handler — only fires while the dev server is still
  // alive. If the dev server dies first, the liveness check in
  // enrichWithLog (log mtime > 90s old → presumed dead) takes over.
  child.on('exit', (code, signal) => {
    void (async (): Promise<void> => {
      let log = '';
      try {
        const raw = await fs.readFile(runLogPath(runId), 'utf8');
        log = raw.length > LOG_MAX_BYTES ? raw.slice(raw.length - LOG_MAX_BYTES) : raw;
      } catch {
        /* skip */
      }
      const finished: SyncRunState = {
        ...state,
        stage: code === 0 ? 'success' : 'failed',
        finishedAt: new Date().toISOString(),
        log,
        exitCode: code,
        error:
          code === 0
            ? null
            : signal !== null
              ? `killed by signal ${signal}`
              : `exited with code ${String(code)}`,
      };
      await writeState(finished);
    })();
  });

  child.on('error', (err) => {
    void writeState({
      ...state,
      stage: 'failed',
      finishedAt: new Date().toISOString(),
      log: '',
      exitCode: null,
      error: err.message,
    });
  });

  // Detach so Next.js shutting down doesn't kill the run.
  child.unref();

  return { runId, alreadyRunning: false };
};
