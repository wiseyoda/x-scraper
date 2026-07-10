'use server';

import type { EntityType } from '@x-scraper/core';
import { revalidatePath } from 'next/cache';

import {
  markVisited as markVisitedInner,
  togglePin as togglePinInner,
  updateNote as updateNoteInner,
} from '@/lib/pins';

export async function togglePinAction(id: string, kind: EntityType): Promise<{ pinned: boolean }> {
  const result = await togglePinInner(id, kind);
  // Refresh anywhere a pin badge might surface.
  revalidatePath('/');
  revalidatePath('/pinned');
  revalidatePath(`/ideas/${id}`);
  revalidatePath(`/sources/${id}`);
  revalidatePath(`/entities/${id}`);
  return { pinned: result.pinned };
}

export async function updateNoteAction(id: string, note: string): Promise<void> {
  await updateNoteInner(id, note);
  revalidatePath('/');
  revalidatePath('/pinned');
}

export async function markVisitedAction(id: string): Promise<void> {
  await markVisitedInner(id);
}
