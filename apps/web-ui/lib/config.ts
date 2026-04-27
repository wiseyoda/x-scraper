/**
 * Server-only config resolver. Mirrors the CLI's resolveConfig() rules.
 *
 * Vault path priority:
 *   1. XSCRAPER_VAULT env var
 *   2. ~/x-scraper-vault (the iCloud-safe default — see CLAUDE.md)
 */

import * as os from 'node:os';
import * as path from 'node:path';

export interface WebUiConfig {
  vaultDir: string;
}

export const resolveWebUiConfig = (): WebUiConfig => {
  const home = os.homedir();
  const vaultDir = process.env.XSCRAPER_VAULT ?? path.join(home, 'x-scraper-vault');
  return { vaultDir };
};
