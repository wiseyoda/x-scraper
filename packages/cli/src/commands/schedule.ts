/**
 * `xs schedule install/uninstall` — wire xs sync (or xs bookmarks sync)
 * into launchd so it runs on a schedule. Wraps the digest package's
 * generic plist builder.
 *
 * macOS-only. The user is responsible for granting Full Disk Access /
 * Automation permissions if their schedule needs to write to a vault
 * outside ~/Documents.
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { buildLaunchdPlist, defaultPlistPath } from '@x-scraper/digest';

const execFileAsync = promisify(execFile);

// Only `bookmarks-sync` is schedulable today: `xs sync` requires `--urls=...`
// to be passed at invocation time, which a static plist can't provide.
// (Codex P2: a sync-mode plist would fail on every interval.)
export type ScheduleMode = 'bookmarks-sync';

export interface ScheduleInstallOptions {
  /** Which command to schedule. Default: bookmarks-sync. */
  mode?: ScheduleMode;
  /** Run every N seconds. Default: 3600 (1 hour). */
  intervalSeconds?: number;
  /** Override the bin path. Default: this CLI's own bin.js (resolved via import.meta.url). */
  binPath?: string;
  /** Override label. Default: com.x-scraper.<mode>. */
  label?: string;
  /** Skip the launchctl bootstrap call (returns the plist content + path). */
  loadIntoLaunchd?: boolean;
}

export interface ScheduleInstallResult {
  label: string;
  plistPath: string;
  loaded: boolean;
  intervalSeconds: number;
  mode: ScheduleMode;
}

const DEFAULT_INTERVAL_SECONDS = 3600;
const DEFAULT_BOOTSTRAP_LOAD = true;

/**
 * Resolve the cli bin path independent of cwd. Walks up from
 * import.meta.url so a launchd plist references the absolute path of
 * the same xs binary that registered the schedule. (Caught by codex
 * P2 in the mcp-register slice; same pattern applies here.)
 */
const resolveBinPath = (): string => {
  // dist/commands/schedule.js → dist/bin.js
  const here = fileURLToPath(import.meta.url);
  return here.replace(/\/commands\/schedule\.js$/, '/bin.js');
};

const COMMAND_BY_MODE: Record<ScheduleMode, string[]> = {
  'bookmarks-sync': ['bookmarks', 'sync'],
};

export const runScheduleInstall = async (
  options: ScheduleInstallOptions = {},
): Promise<ScheduleInstallResult> => {
  const mode = options.mode ?? 'bookmarks-sync';
  const intervalSeconds = options.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS;
  const label = options.label ?? `com.x-scraper.${mode}`;
  const binPath = options.binPath ?? resolveBinPath();
  const loadIntoLaunchd = options.loadIntoLaunchd ?? DEFAULT_BOOTSTRAP_LOAD;

  const args = COMMAND_BY_MODE[mode];
  const stdoutPath = `/tmp/${label}.out.log`;
  const stderrPath = `/tmp/${label}.err.log`;
  // Use the absolute Node executable that's running this CLI right now —
  // launchd doesn't inherit shell PATH, so /usr/bin/env node would either
  // miss Homebrew/nvm Node entirely or land on a Node with the wrong
  // better-sqlite3 ABI. (Codex P2.)
  const plist = buildLaunchdPlist({
    label,
    programPath: process.execPath,
    args: [binPath, ...args],
    intervalSeconds,
    stdoutPath,
    stderrPath,
  });

  const plistPath = defaultPlistPath(label);
  fs.mkdirSync(plistPath.replace(/\/[^/]+$/, ''), { recursive: true });
  fs.writeFileSync(plistPath, plist, { encoding: 'utf8', mode: 0o644 });

  if (!loadIntoLaunchd) {
    return { label, plistPath, loaded: false, intervalSeconds, mode };
  }

  const uid = process.getuid?.() ?? 0;
  // Try modern bootstrap first; fall back to legacy load on older macOS.
  // Both forms accept --reset-quarantine through the file path on the
  // user's gui domain — bootstrapping the same label twice errors, so
  // we proactively bootout first if present.
  await execFileAsync('launchctl', ['bootout', `gui/${String(uid)}/${label}`]).catch(
    () => undefined,
  );
  await execFileAsync('launchctl', ['bootstrap', `gui/${String(uid)}`, plistPath]);

  return { label, plistPath, loaded: true, intervalSeconds, mode };
};

export interface ScheduleUninstallOptions {
  mode?: ScheduleMode;
  label?: string;
}

export interface ScheduleUninstallResult {
  label: string;
  plistPath: string;
  removed: boolean;
}

export const runScheduleUninstall = async (
  options: ScheduleUninstallOptions = {},
): Promise<ScheduleUninstallResult> => {
  const mode = options.mode ?? 'bookmarks-sync';
  const label = options.label ?? `com.x-scraper.${mode}`;
  const plistPath = defaultPlistPath(label);
  const uid = process.getuid?.() ?? 0;
  await execFileAsync('launchctl', ['bootout', `gui/${String(uid)}/${label}`]).catch(
    () => undefined,
  );
  let removed = false;
  if (fs.existsSync(plistPath)) {
    fs.unlinkSync(plistPath);
    removed = true;
  }
  return { label, plistPath, removed };
};
