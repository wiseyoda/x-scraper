/**
 * Builds a launchd plist that runs `xs sync` (or any other binary) on
 * a schedule. Pure — returns a string + a recommended file path.
 *
 * The caller (CLI's `xs schedule install`) is responsible for actually
 * writing the plist and calling `launchctl load`.
 */

import * as os from 'node:os';
import * as path from 'node:path';

export interface LaunchdInput {
  /** Reverse-DNS-style identifier — e.g. `com.x-scraper.sync`. */
  label: string;
  /** Absolute path to the binary to run. */
  programPath: string;
  /** Optional argv tail. */
  args?: string[];
  /** Run every N seconds (StartInterval). */
  intervalSeconds: number;
  /** Optional working directory. */
  workingDirectory?: string;
  /** Optional env vars. */
  env?: Record<string, string>;
  /** Default stdout log path. */
  stdoutPath?: string;
  /** Default stderr log path. */
  stderrPath?: string;
}

const escapeXml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export const buildLaunchdPlist = (input: LaunchdInput): string => {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyManifest-1.0.dtd">',
  );
  lines.push('<plist version="1.0">', '<dict>');
  lines.push('  <key>Label</key>');
  lines.push(`  <string>${escapeXml(input.label)}</string>`);
  lines.push('  <key>ProgramArguments</key>', '  <array>');
  lines.push(`    <string>${escapeXml(input.programPath)}</string>`);
  for (const a of input.args ?? []) lines.push(`    <string>${escapeXml(a)}</string>`);
  lines.push('  </array>');
  lines.push('  <key>StartInterval</key>');
  lines.push(`  <integer>${String(Math.max(1, Math.floor(input.intervalSeconds)))}</integer>`);
  lines.push('  <key>RunAtLoad</key>', '  <true/>');
  if (input.workingDirectory !== undefined) {
    lines.push('  <key>WorkingDirectory</key>');
    lines.push(`  <string>${escapeXml(input.workingDirectory)}</string>`);
  }
  if (input.env !== undefined && Object.keys(input.env).length > 0) {
    lines.push('  <key>EnvironmentVariables</key>', '  <dict>');
    for (const [k, v] of Object.entries(input.env)) {
      lines.push(`    <key>${escapeXml(k)}</key>`);
      lines.push(`    <string>${escapeXml(v)}</string>`);
    }
    lines.push('  </dict>');
  }
  if (input.stdoutPath !== undefined) {
    lines.push('  <key>StandardOutPath</key>');
    lines.push(`  <string>${escapeXml(input.stdoutPath)}</string>`);
  }
  if (input.stderrPath !== undefined) {
    lines.push('  <key>StandardErrorPath</key>');
    lines.push(`  <string>${escapeXml(input.stderrPath)}</string>`);
  }
  lines.push('</dict>', '</plist>', '');
  return lines.join('\n');
};

export const defaultPlistPath = (label: string): string =>
  path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
