/**
 * Stages of the per-source ingestion pipeline. Run sequentially against
 * each source; each stage is idempotent and retryable. Order matters
 * because downstream stages depend on artifacts written by earlier
 * stages (e.g. `embed_source` requires `extract_text` output).
 */
export const STAGES = [
  'fetch_links',
  'extract_text',
  'embed_source',
  'extract_facts',
  'resolve_ents',
  'reconcile',
  'write_vault',
  'update_graph',
] as const;
export type Stage = (typeof STAGES)[number];

export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'dead';

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_INITIAL_BACKOFF_MS = 30_000;
export const DEFAULT_MAX_BACKOFF_MS = 30 * 60 * 1000;
export const DEFAULT_BACKOFF_MULTIPLIER = 2;
export const STALE_LEASE_MS = 5 * 60 * 1000;
