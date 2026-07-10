'use server';

import { revalidatePath } from 'next/cache';

import { latestSyncState, readSyncState, startSync, type SyncRunState } from '@/lib/sync-runner';

export async function startSyncAction(): Promise<{
  runId: string;
  alreadyRunning: boolean;
}> {
  const r = await startSync();
  return r;
}

export async function getSyncStatusAction(runId: string): Promise<SyncRunState | null> {
  return readSyncState(runId);
}

export async function getLatestSyncAction(): Promise<SyncRunState | null> {
  return latestSyncState();
}

/** Force a server re-render after a successful sync so dashboards reflect new state. */
export async function refreshAfterSyncAction(): Promise<void> {
  revalidatePath('/');
  revalidatePath('/inbox');
  revalidatePath('/digest');
}
