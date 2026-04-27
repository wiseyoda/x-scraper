'use server';

/**
 * Server actions for /ideas. Same code paths as the `xs ideas` CLI:
 * read the Idea record, mutate status, write back.
 */

import type { Frontmatter, IdeaFrontmatter } from '@x-scraper/core';
import { revalidatePath } from 'next/cache';

import { getVault } from '@/lib/vault';

const setStatus = async (id: string, status: 'confirmed' | 'rejected'): Promise<void> => {
  const vault = await getVault();
  const record = await vault.read(id, 'Idea');
  if (record.frontmatter.type !== 'Idea') {
    throw new Error(`Idea ${id} not found or wrong type`);
  }
  const fm: IdeaFrontmatter = record.frontmatter;
  if (fm.status === status) return;
  const next: IdeaFrontmatter = {
    ...fm,
    status,
    updated_at: new Date().toISOString(),
  };
  const frontmatter: Frontmatter = next;
  await vault.write({ frontmatter, body: record.body });
  revalidatePath('/ideas');
  revalidatePath(`/ideas/${id}`);
};

export async function confirmIdea(formData: FormData): Promise<void> {
  const id = formData.get('id');
  if (typeof id !== 'string' || id.length === 0) throw new Error('id required');
  await setStatus(id, 'confirmed');
}

export async function rejectIdea(formData: FormData): Promise<void> {
  const id = formData.get('id');
  if (typeof id !== 'string' || id.length === 0) throw new Error('id required');
  await setStatus(id, 'rejected');
}
