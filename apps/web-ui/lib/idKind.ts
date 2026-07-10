/**
 * Derive entity kind from an x-scraper ID prefix. Pins reference items
 * by id only, so any code that needs to navigate to a detail page or
 * read frontmatter has to resolve the type first.
 */

import type { EntityType } from '@x-scraper/core';

const ID_PREFIX_TO_KIND: Record<string, EntityType> = {
  src: 'Source',
  claim: 'Claim',
  topic: 'Topic',
  p: 'Person',
  tool: 'Tool',
  c: 'Concept',
  repo: 'Repo',
  art: 'Article',
  tw: 'Tweet',
  vid: 'Video',
  pdf: 'PDF',
  idea: 'Idea',
};

export const kindFromId = (id: string): EntityType | null => {
  const idx = id.indexOf('_');
  if (idx < 1) return null;
  const prefix = id.slice(0, idx);
  return ID_PREFIX_TO_KIND[prefix] ?? null;
};

const KIND_TO_VAULT_ROUTE: Partial<Record<EntityType, string>> = {
  Idea: '/ideas',
  Source: '/sources',
  Person: '/entities',
  Tool: '/entities',
  Concept: '/entities',
  Repo: '/entities',
  Article: '/entities',
  Tweet: '/entities',
  Video: '/entities',
  PDF: '/entities',
};

/** Internal href for a vault item id. Returns null for unsupported kinds. */
export const hrefForId = (id: string): string | null => {
  const kind = kindFromId(id);
  if (kind === null) return null;
  const base = KIND_TO_VAULT_ROUTE[kind];
  if (base === undefined) return null;
  return `${base}/${id}`;
};
