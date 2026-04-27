/**
 * Server-only vault accessor. Lazy-initialized once per process.
 *
 * The web-ui talks to the vault directly (not through xs-rest or
 * xs-mcp) so server actions are sub-millisecond instead of incurring
 * a localhost HTTP round-trip on every confirm/reject.
 */

import 'server-only';

import { createMarkdownVault, type VaultStore } from '@x-scraper/vault';

import { resolveWebUiConfig } from './config';

let cached: VaultStore | null = null;

export const getVault = async (): Promise<VaultStore> => {
  if (cached !== null) return cached;
  const config = resolveWebUiConfig();
  const vault = createMarkdownVault(config.vaultDir);
  await vault.init();
  cached = vault;
  return cached;
};
