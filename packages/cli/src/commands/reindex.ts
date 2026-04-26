/**
 * `xs reindex --from-vault` — rebuild the graph from existing markdown.
 *
 * The vault is the canonical store; the graph is a derivable index. When
 * the graph is dropped, migrated, or the extraction logic changes, this
 * command re-runs the dispatcher pipeline against every Source.md in the
 * vault, with the write_vault stage substituted for a no-op so we don't
 * rewrite the files we just read.
 *
 * Implementation: load every Source from the vault → produce SourceItems
 * with body= already populated → call runSync with skipVault=true. The
 * extract_text stage's pre-fetched-body short-circuit means we don't
 * re-fetch any URLs.
 */

import type { VaultStore } from '@x-scraper/vault';

import type { SourceItem, SyncDeps, SyncResult } from './sync/index.js';
import { runSync } from './sync/index.js';

export interface ReindexResult extends SyncResult {
  sourcesLoaded: number;
}

/**
 * Read every Source markdown from the vault and shape it as a SourceItem
 * with body pre-populated. The dispatcher's extract_text stage will skip
 * its fetch path when the body is already present.
 */
export const loadSourcesFromVault = async (vault: VaultStore): Promise<SourceItem[]> => {
  const list = await vault.list('Source');
  const items: SourceItem[] = [];
  for (const entry of list) {
    const record = await vault.read(entry.id, 'Source');
    if (record.frontmatter.type !== 'Source') continue;
    items.push({
      sourceId: record.frontmatter.id,
      sourceKind: 'bookmarks',
      url: record.frontmatter.canonical_url,
      body: record.body,
      discoveredAt: record.frontmatter.captured_at,
    });
  }
  return items;
};

export interface ReindexOptions {
  limit?: number;
  maxAttempts?: number;
}

export const runReindex = async (
  deps: Omit<SyncDeps, 'loadSources'>,
  options: ReindexOptions = {},
): Promise<ReindexResult> => {
  const sources = await loadSourcesFromVault(deps.vault);
  const syncDeps: SyncDeps = {
    ...deps,
    loadSources: () => Promise.resolve(sources),
  };
  const syncResult = await runSync(syncDeps, {
    source: 'bookmarks',
    skipVault: true,
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
  });
  return { ...syncResult, sourcesLoaded: sources.length };
};
