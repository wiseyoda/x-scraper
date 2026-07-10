/**
 * `xs whats-new [--since=ISO] [--limit=N]` — CLI mirror of MCP whats_new.
 */

import { attachmentsSince } from '@x-scraper/related';
import { createMarkdownVault } from '@x-scraper/vault';

import type { CliConfig } from '../config.js';

export interface WhatsNewOptions {
  since?: string;
  limit?: number;
}

export const runWhatsNew = async (config: CliConfig, options: WhatsNewOptions = {}) => {
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const since =
    options.since !== undefined && options.since.length > 0
      ? options.since
      : new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const limit = options.limit ?? 25;
  const vault = createMarkdownVault(config.vaultDir);
  const events = await attachmentsSince(
    { vault, graph: null },
    since,
    { sourceLimit: limit, relatedLimit: 4 },
  );
  return { since, events: events.slice(0, limit) };
};
