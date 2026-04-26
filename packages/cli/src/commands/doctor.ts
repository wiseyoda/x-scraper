/**
 * `xs doctor` — sanity-checks the local environment.
 *
 * Returns a list of checks with PASS/FAIL/WARN. Pure: takes a config,
 * does fs/network probes, returns a structured report.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { CliConfig } from '../config.js';
import { ENV_FILE_PATH } from '../constants.js';

export type CheckStatus = 'PASS' | 'FAIL' | 'WARN';

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

const REQUIRED_KEYS = [
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'NEO4J_URI',
  'NEO4J_USER',
  'NEO4J_PASSWORD',
];
const OPTIONAL_KEYS = ['OPENAI_API_KEY', 'EXA_API_KEY', 'TAVILY_API_KEY', 'BRAVE_API_KEY'];
const ENV_FILE_PERMS_MASK = 0o077;

const fileExists = async (p: string): Promise<boolean> => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

const parseEnvFile = async (envPath: string): Promise<Map<string, string>> => {
  const out = new Map<string, string>();
  if (!(await fileExists(envPath))) return out;
  const text = await fs.readFile(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#') || t.length === 0) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const name = t.slice(0, eq).trim();
    const value = t.slice(eq + 1).trim();
    if (value.length > 0) out.set(name, value);
  }
  return out;
};

const checkVault = async (config: CliConfig): Promise<Check> => {
  const gitignore = path.join(config.vaultDir, '.gitignore');
  if (await fileExists(gitignore)) {
    return { name: 'vault', status: 'PASS', detail: `${config.vaultDir} initialized` };
  }
  return {
    name: 'vault',
    status: 'WARN',
    detail: `${config.vaultDir} not initialized — run \`xs init\``,
  };
};

const checkQueue = async (config: CliConfig): Promise<Check> => {
  if (await fileExists(config.queuePath)) {
    return { name: 'queue', status: 'PASS', detail: `${config.queuePath} present` };
  }
  return {
    name: 'queue',
    status: 'WARN',
    detail: `${config.queuePath} not present — run \`xs init\``,
  };
};

const checkEnvFile = async (): Promise<Check[]> => {
  const out: Check[] = [];
  const envPresent = await fileExists(ENV_FILE_PATH);
  if (!envPresent) {
    out.push({
      name: 'env-file',
      status: 'FAIL',
      detail: `${ENV_FILE_PATH} not found — create it (chmod 600) with the required keys`,
    });
  } else {
    const stat = await fs.stat(ENV_FILE_PATH);
    // eslint-disable-next-line no-bitwise
    if ((stat.mode & ENV_FILE_PERMS_MASK) !== 0) {
      out.push({
        name: 'env-perms',
        status: 'WARN',
        detail: `${ENV_FILE_PATH} should be chmod 600 (group/other readable)`,
      });
    } else {
      out.push({ name: 'env-perms', status: 'PASS', detail: `${ENV_FILE_PATH} is chmod 600` });
    }
  }
  // Always emit a row per required key, regardless of whether the env
  // file is present, so a missing key surfaces as FAIL rather than as
  // a silent skip.
  const env = envPresent ? await parseEnvFile(ENV_FILE_PATH) : new Map<string, string>();
  for (const key of REQUIRED_KEYS) {
    out.push(
      env.has(key)
        ? { name: `env:${key}`, status: 'PASS', detail: 'present' }
        : { name: `env:${key}`, status: 'FAIL', detail: 'missing required key' },
    );
  }
  for (const key of OPTIONAL_KEYS) {
    out.push(
      env.has(key)
        ? { name: `env:${key}`, status: 'PASS', detail: 'present' }
        : { name: `env:${key}`, status: 'WARN', detail: 'optional key absent' },
    );
  }
  return out;
};

export const runDoctor = async (config: CliConfig): Promise<Check[]> => {
  const checks: Check[] = [];
  checks.push(await checkVault(config));
  checks.push(await checkQueue(config));
  checks.push(...(await checkEnvFile()));
  return checks;
};
