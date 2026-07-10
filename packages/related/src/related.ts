/**
 * Public related() entry — shared by CLI, web-ui, and future MCP.
 */

import type { GraphStore } from '@x-scraper/graph';
import type { VaultStore } from '@x-scraper/vault';

import {
  DEFAULT_ATTACHMENT_RELATED_LIMIT,
  DEFAULT_ATTACHMENT_SOURCE_LIMIT,
  DEFAULT_RELATED_LIMIT,
} from './constants.js';
import { buildCorpusFromVault } from './from-vault.js';
import { attachmentEventsSince, rankRelated } from './score.js';
import type { AttachmentEvent, RelatedCorpus, RelatedHit, RelatedQuery } from './types.js';

export interface RelatedDeps {
  vault: VaultStore;
  /** Optional; when null/undefined, vault-only scorers run (no embed neighbors). */
  graph?: GraphStore | null;
}

export interface RelatedResult {
  id: string;
  hits: RelatedHit[];
  /** How the corpus was built. */
  mode: 'vault' | 'vault+graph';
  /** True when graph was requested but unavailable / skipped. */
  graphDegraded: boolean;
}

/** Cache corpus per vault path for a short process lifetime (CLI one-shot). */
let cached: { vaultRoot: string; corpus: RelatedCorpus; at: number } | null = null;
const CACHE_TTL_MS = 30_000;

const vaultRootOf = (vault: VaultStore): string => {
  // VaultStore may expose root; fall back to identity of object.
  const v = vault as { root?: string };
  return typeof v.root === 'string' ? v.root : 'default';
};

export const invalidateRelatedCache = (): void => {
  cached = null;
};

export const loadRelatedCorpus = async (deps: RelatedDeps): Promise<RelatedCorpus> => {
  const root = vaultRootOf(deps.vault);
  const now = Date.now();
  if (cached !== null && cached.vaultRoot === root && now - cached.at < CACHE_TTL_MS) {
    return cached.corpus;
  }
  const corpus = await buildCorpusFromVault(deps.vault, { graph: deps.graph ?? null });
  cached = { vaultRoot: root, corpus, at: now };
  return corpus;
};

/**
 * Rank related nodes for `id`. Pure scoring over a vault-built corpus.
 */
export const related = async (
  deps: RelatedDeps,
  query: RelatedQuery,
): Promise<RelatedResult> => {
  const corpus = await loadRelatedCorpus(deps);
  const limit = query.limit ?? DEFAULT_RELATED_LIMIT;
  const graphDegraded = deps.graph === null || deps.graph === undefined;
  const hits = rankRelated(corpus, query.id, { limit });
  return {
    id: query.id,
    hits,
    mode: graphDegraded ? 'vault' : 'vault+graph',
    graphDegraded,
  };
};

/**
 * Pure entry for tests / pre-built corpora (no vault I/O).
 */
export const relatedFromCorpus = (
  corpus: RelatedCorpus,
  id: string,
  limit: number = DEFAULT_RELATED_LIMIT,
): RelatedHit[] => rankRelated(corpus, id, { limit });

export const attachmentsSince = async (
  deps: RelatedDeps,
  sinceIso: string,
  options: { sourceLimit?: number; relatedLimit?: number } = {},
): Promise<AttachmentEvent[]> => {
  const corpus = await loadRelatedCorpus(deps);
  return attachmentEventsSince(corpus, sinceIso, {
    sourceLimit: options.sourceLimit ?? DEFAULT_ATTACHMENT_SOURCE_LIMIT,
    relatedLimit: options.relatedLimit ?? DEFAULT_ATTACHMENT_RELATED_LIMIT,
  });
};
