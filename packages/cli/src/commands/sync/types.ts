/**
 * Public types for `xs sync` — the dispatcher port and the deps it needs.
 *
 * The dispatcher is fully dependency-injected so unit tests stub every
 * external adapter. `bin.ts` is where real adapters get wired (Patchright
 * for scraping, Anthropic SDK for Claude, fetch for Gemini, neo4j-driver
 * for the graph, simple-git via the vault, etc).
 */

import type { EntityType, SourceKind } from '@x-scraper/core';
import type { EmbeddingProvider } from '@x-scraper/embeddings';
import type { GraphStore } from '@x-scraper/graph';
import type { Ingestor } from '@x-scraper/ingestor';
import type { LlmProvider } from '@x-scraper/llm';
import type { Logger } from '@x-scraper/observability';
import type { JobQueue } from '@x-scraper/queue';
import type { ErCandidateFinder, ExistingClaim } from '@x-scraper/reconciler';
import type { VaultStore } from '@x-scraper/vault';

/**
 * One unit of work — what the source loader returns. The body and title
 * are optional: if absent, the extract_text stage will fetch the URL via
 * the matching ingestor. If present (e.g. tweet text already in hand from
 * the scraper), extract_text becomes a no-op for that source.
 */
export interface SourceItem {
  sourceId: string;
  sourceKind: SourceKind;
  /** Canonical URL of the source. */
  url: string;
  /** Pre-fetched body, when the loader already has it (e.g. tweet text). */
  body?: string;
  title?: string;
  byline?: string;
  /** ISO timestamp when the source was discovered. */
  discoveredAt?: string;
}

export interface ClaimFinder {
  /** Return the existing current claims for a given subject. */
  findClaimsForSubject: (subject: string) => Promise<ExistingClaim[]>;
}

export interface SyncDeps {
  queue: JobQueue;
  vault: VaultStore;
  graph: GraphStore;
  embeddings: EmbeddingProvider;
  llm: LlmProvider;
  ingestors: Ingestor[];
  logger: Logger;
  /** Wraps graph.vectorSearch so the reconciler can use it directly. */
  erFinder: ErCandidateFinder;
  /** Looks up existing claims to feed reconcileClaim. */
  claimFinder: ClaimFinder;
  /** Loads the next batch of sources to process. */
  loadSources: (options: SyncOptions) => Promise<SourceItem[]>;
  now?: () => Date;
}

export interface SyncOptions {
  /** 'bookmarks' (default), 'likes', or 'posts'. */
  source?: SourceKind;
  /** Cap how many sources to enqueue this run. */
  limit?: number;
  /** Per-job retry budget. Default 3. */
  maxAttempts?: number;
  /** Skip the actual update_graph stage (useful for dry-run dogfood). */
  skipGraph?: boolean;
  /** Skip the write_vault stage — used by `xs reindex` where the vault is
   *  the source of truth and we're only rebuilding the graph. */
  skipVault?: boolean;
}

export interface StageOutcome {
  stage: string;
  ok: boolean;
  errorCode?: string;
  errorMsg?: string;
  durationMs: number;
}

export interface JobOutcome {
  jobId: string;
  sourceId: string;
  status: 'done' | 'dead' | 'failed';
  stages: StageOutcome[];
}

export interface SyncResult {
  runId: string;
  jobsEnqueued: number;
  jobsCompleted: number;
  jobsDead: number;
  jobsFailed: number;
  totalCostUsd: number;
  durationMs: number;
  jobs: JobOutcome[];
}

/**
 * In-memory state carried across stages of a single job. Stage handlers
 * read what they need and write what they produce. On a crash we re-derive
 * earlier outputs (extract_text re-fetches, etc) — correctness over speed
 * for v1.
 */
export interface JobContext {
  jobId: string;
  source: SourceItem;
  ingested: {
    body: string;
    title: string | null;
    byline: string | null;
    capturedAt: string;
    contentType: 'tweet' | 'article' | 'repo' | 'video' | 'pdf';
    metadata: Record<string, string | number | null>;
  } | null;
  embedding: number[] | null;
  extraction: {
    entities: { id: string; type: EntityType; name: string; aliases: string[] }[];
    claims: {
      id: string;
      subject: string;
      predicate: string;
      object: string;
      text: string;
      confidence: number;
    }[];
    relationships: { from: string; to: string; type: string }[];
  } | null;
  /** Resolved entity decisions: client id → final graph id. */
  entityResolutions: Map<
    string,
    { graphId: string; decision: 'MERGE' | 'NEW' | 'SAME_AS_PROBABLE' }
  >;
  /** Per-claim reconciliation decisions. */
  claimDecisions: Map<
    string,
    { action: 'ADD' | 'UPDATE' | 'DELETE' | 'NONE'; existingId: string | null; reason: string }
  >;
  /** Vault-relative paths written so far. */
  vaultWrites: string[];
}
