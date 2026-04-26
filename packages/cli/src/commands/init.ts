/**
 * `xs init` — create the vault and the queue.
 *
 * Idempotent: running it again is a no-op for already-initialized
 * directories.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { createSqliteQueue } from '@x-scraper/queue';
import { createMarkdownVault } from '@x-scraper/vault';

import type { CliConfig } from '../config.js';

export interface InitResult {
  vaultDir: string;
  queuePath: string;
  vaultCreated: boolean;
  queueCreated: boolean;
}

const exists = async (p: string): Promise<boolean> => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

export const runInit = async (config: CliConfig): Promise<InitResult> => {
  const vaultExisted = await exists(path.join(config.vaultDir, '.gitignore'));
  const vault = createMarkdownVault(config.vaultDir);
  await vault.init();

  const queueExisted = await exists(config.queuePath);
  await fs.mkdir(path.dirname(config.queuePath), { recursive: true });
  // createSqliteQueue creates the file if missing; closing it cleanly
  // releases the WAL handle.
  const queue = createSqliteQueue(config.queuePath);
  queue.close();

  return {
    vaultDir: config.vaultDir,
    queuePath: config.queuePath,
    vaultCreated: !vaultExisted,
    queueCreated: !queueExisted,
  };
};
