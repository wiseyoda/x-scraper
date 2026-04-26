/**
 * Resolves runtime config from env vars (with sensible defaults).
 *
 * Pure function: takes an env map (process.env or a test stub) and
 * returns a frozen config. No side effects.
 */

import { DEFAULT_QUEUE_PATH, DEFAULT_VAULT_DIR, ENV_QUEUE, ENV_VAULT } from './constants.js';

export interface CliConfig {
  vaultDir: string;
  queuePath: string;
}

export const resolveConfig = (env: NodeJS.ProcessEnv = process.env): CliConfig => {
  return Object.freeze({
    vaultDir: env[ENV_VAULT] ?? DEFAULT_VAULT_DIR,
    queuePath: env[ENV_QUEUE] ?? DEFAULT_QUEUE_PATH,
  });
};
