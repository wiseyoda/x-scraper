'use server';

import { runSearch, type SearchHit } from '@/lib/search';

export async function searchAction(query: string): Promise<SearchHit[]> {
  return runSearch(query);
}
