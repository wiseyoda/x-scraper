/**
 * Sync-run log retention (P4.4).
 *
 * Pure selection + filesystem prune for `<vault>/.xscraper/sync-runs/`.
 * Keeps recent finished runs; never prunes pending/running.
 */

export const SYNC_RUN_MAX_KEEP = 20;
/** Drop finished runs older than this even if under maxKeep. */
export const SYNC_RUN_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface RunRetentionInput {
  runId: string;
  startedAt: string;
  stage: 'pending' | 'running' | 'success' | 'failed';
}

export interface PruneSelectOptions {
  nowMs: number;
  maxKeep?: number;
  maxAgeMs?: number;
}

/**
 * Decide which runIds to delete.
 * 1. Never touch pending/running.
 * 2. Drop finished runs older than maxAgeMs.
 * 3. Among remaining finished runs, keep the newest maxKeep; prune the rest.
 */
export const selectRunIdsToPrune = (
  runs: RunRetentionInput[],
  opts: PruneSelectOptions,
): string[] => {
  const maxKeep = opts.maxKeep ?? SYNC_RUN_MAX_KEEP;
  const maxAgeMs = opts.maxAgeMs ?? SYNC_RUN_MAX_AGE_MS;
  const nowMs = opts.nowMs;

  const protectedIds = new Set(
    runs.filter((r) => r.stage === 'pending' || r.stage === 'running').map((r) => r.runId),
  );

  const finished = runs
    .filter((r) => !protectedIds.has(r.runId))
    .slice()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const toPrune = new Set<string>();

  for (const r of finished) {
    const age = nowMs - Date.parse(r.startedAt);
    if (Number.isFinite(age) && age > maxAgeMs) {
      toPrune.add(r.runId);
    }
  }

  const survivors = finished.filter((r) => !toPrune.has(r.runId));
  if (survivors.length > maxKeep) {
    for (const r of survivors.slice(maxKeep)) {
      toPrune.add(r.runId);
    }
  }

  return [...toPrune];
};

/**
 * Orphan log basenames (runId) that have a .log but no matching .json.
 * Safe to delete always — no state file means the UI cannot attach them.
 */
export const selectOrphanLogRunIds = (
  fileNames: string[],
): string[] => {
  const jsonIds = new Set(
    fileNames.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length)),
  );
  const out: string[] = [];
  for (const f of fileNames) {
    if (!f.endsWith('.log')) continue;
    const id = f.slice(0, -'.log'.length);
    if (id.length === 0) continue;
    if (!jsonIds.has(id)) out.push(id);
  }
  return out;
};
