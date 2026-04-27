/**
 * High-level runner: read claims from vault → cluster → synthesize via
 * LLM → persist. The CLI command thin-wraps this.
 */

import type { ClaimFrontmatter } from '@x-scraper/core';
import type { GraphStore } from '@x-scraper/graph';
import type { LlmProvider } from '@x-scraper/llm';
import type { Logger } from '@x-scraper/observability';
import type { VaultStore } from '@x-scraper/vault';

import { clusterClaims } from './cluster.js';
import { ideaIdForCluster, persistIdea } from './persist.js';
import { synthesizeCluster, SynthesizerError } from './synthesize.js';
import type { ClaimRef, SynthesisResult } from './types.js';

export interface SynthesizeAllInput {
  vault: VaultStore;
  graph: GraphStore | null;
  llm: LlmProvider;
  logger: Logger;
  /** Cap how many clusters to synthesize this run. */
  limit?: number;
  /** Re-synthesize even when an Idea already exists for the cluster. */
  force?: boolean;
  /** Override clock for tests. */
  now?: () => Date;
}

export const loadClaimsFromVault = async (vault: VaultStore): Promise<ClaimRef[]> => {
  const list = await vault.list('Claim');
  const claims: ClaimRef[] = [];
  for (const entry of list) {
    let record;
    try {
      record = await vault.read(entry.id, 'Claim');
    } catch {
      continue;
    }
    if (record.frontmatter.type !== 'Claim') continue;
    const fm: ClaimFrontmatter = record.frontmatter;
    if (fm.invalid_at !== null) continue; // skip superseded
    const sourceId = fm.sources[0];
    if (sourceId === undefined) continue;
    claims.push({
      id: fm.id,
      subject: fm.subject,
      predicate: fm.predicate,
      object: fm.object,
      text: record.body.trim(),
      confidence: fm.confidence ?? 0,
      sourceId,
    });
  }
  return claims;
};

export const synthesizeAll = async (input: SynthesizeAllInput): Promise<SynthesisResult> => {
  const log = input.logger;
  const allClaims = await loadClaimsFromVault(input.vault);
  log.info('synthesize.claims_loaded', { count: allClaims.length });

  const { admitted, belowThreshold } = clusterClaims(allClaims);
  log.info('synthesize.clusters_admitted', {
    admitted: admitted.length,
    belowThreshold,
  });

  let cap = input.limit ?? admitted.length;
  let costUsd = 0;
  let skippedExisting = 0;
  const ideaIdsWritten: string[] = [];

  for (const cluster of admitted) {
    if (cap <= 0) break;

    if (input.force !== true) {
      // Skip when an Idea for this exact (anchor, sources, prompt v)
      // already exists.
      const expectedId = ideaIdForCluster(cluster, 1);
      try {
        await input.vault.read(expectedId, 'Idea');
        skippedExisting += 1;
        continue;
      } catch {
        // Not present — proceed to synthesize.
      }
    }

    let result;
    try {
      result = await synthesizeCluster(input.llm, { cluster });
    } catch (err) {
      log.warn('synthesize.cluster_failed', {
        anchor: cluster.anchor,
        claims: cluster.claims.length,
        error: err instanceof SynthesizerError ? err.message : String(err),
      });
      continue;
    }
    costUsd += result.meta.costUsd;

    const persisted = await persistIdea(input.vault, input.graph, {
      cluster,
      draft: result.draft,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    ideaIdsWritten.push(persisted.id);
    log.info('synthesize.idea_written', {
      id: persisted.id,
      anchor: cluster.anchor,
      claims: cluster.claims.length,
      sources: cluster.sourceIds.length,
      confidence: result.draft.confidence,
      costUsd: result.meta.costUsd,
    });
    cap -= 1;
  }

  log.info('synthesize.finished', {
    written: ideaIdsWritten.length,
    skippedExisting,
    belowThreshold,
    costUsd,
  });

  return {
    ideaIdsWritten,
    skippedExisting,
    belowThreshold,
    costUsd,
  };
};
