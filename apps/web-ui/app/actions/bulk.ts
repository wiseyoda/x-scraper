'use server';

import { revalidatePath } from 'next/cache';

import { togglePin } from '@/lib/pins';
import { addTag, markRead, markUnread } from '@/lib/source-state';

export interface BulkResult {
  applied: number;
}

export async function bulkPinSourcesAction(ids: string[]): Promise<BulkResult> {
  // togglePin returns the new state; for bulk we want "ensure pinned" semantics —
  // run toggle then re-toggle if already pinned. Simpler: read current via the
  // (kind, id) and pin only when not pinned. togglePin returns {pinned: boolean}.
  let applied = 0;
  for (const id of ids) {
    const r = await togglePin(id, 'Source');
    if (r.pinned) {
      applied += 1;
    } else {
      // It was already pinned — togglePin removed it. Re-add to satisfy bulk-pin semantics.
      await togglePin(id, 'Source');
      applied += 1;
    }
  }
  revalidatePath('/');
  revalidatePath('/inbox');
  revalidatePath('/pinned');
  return { applied };
}

export async function bulkMarkReadAction(ids: string[]): Promise<BulkResult> {
  await Promise.all(ids.map((id) => markRead(id)));
  revalidatePath('/');
  revalidatePath('/inbox');
  return { applied: ids.length };
}

export async function bulkMarkUnreadAction(ids: string[]): Promise<BulkResult> {
  await Promise.all(ids.map((id) => markUnread(id)));
  revalidatePath('/');
  revalidatePath('/inbox');
  return { applied: ids.length };
}

export async function bulkTagAction(ids: string[], tag: string): Promise<BulkResult> {
  const cleaned = tag.trim();
  if (cleaned.length === 0) return { applied: 0 };
  await Promise.all(ids.map((id) => addTag(id, cleaned)));
  revalidatePath('/inbox');
  return { applied: ids.length };
}
