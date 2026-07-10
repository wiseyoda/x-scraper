'use server';

import { revalidatePath } from 'next/cache';

import { addTag, removeTag, setTags, toggleRead } from '@/lib/source-state';

export async function toggleReadAction(id: string): Promise<{ readAt: string | null }> {
  const r = await toggleRead(id);
  revalidatePath('/');
  revalidatePath('/inbox');
  revalidatePath(`/sources/${id}`);
  return r;
}

export async function addTagAction(id: string, tag: string): Promise<{ tags: string[] }> {
  const tags = await addTag(id, tag);
  revalidatePath('/inbox');
  revalidatePath(`/sources/${id}`);
  return { tags };
}

export async function removeTagAction(id: string, tag: string): Promise<{ tags: string[] }> {
  const tags = await removeTag(id, tag);
  revalidatePath('/inbox');
  revalidatePath(`/sources/${id}`);
  return { tags };
}

export async function setTagsAction(id: string, tags: string[]): Promise<{ tags: string[] }> {
  const out = await setTags(id, tags);
  revalidatePath('/inbox');
  revalidatePath(`/sources/${id}`);
  return { tags: out };
}
