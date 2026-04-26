/**
 * `xs review` — list vault entries that need human triage.
 *
 * For v1: surfaces entities with SAME_AS_PROBABLE judgements that the
 * automatic resolver wasn't confident enough to MERGE. Future work:
 * interactive triage UI that lets the user choose MERGE/SPLIT/KEEP and
 * persists the decision back to the vault + graph.
 *
 * Implementation notes:
 *  - We read every Entity.md from the vault (Person/Tool/Concept/etc).
 *  - "SAME_AS_PROBABLE" judgements aren't stored on the Entity yet — the
 *    resolver decides at write-time and the dispatcher upserts the chosen
 *    graph id. To find pending reviews we'd need either a sidecar log or
 *    a graph query.
 *  - For v1 we surface duplicate-name candidates: same canonical name
 *    appearing in multiple Entity ids. These are the most likely cases
 *    where the resolver picked NEW when it should have picked MERGE.
 */

import type { EntityType } from '@x-scraper/core';
import type { VaultStore } from '@x-scraper/vault';

const DEFAULT_REVIEW_TYPES: EntityType[] = ['Person', 'Tool', 'Concept', 'Repo'];

export interface ReviewCandidate {
  type: EntityType;
  name: string;
  ids: string[];
  paths: string[];
}

export interface ReviewResult {
  scanned: number;
  candidates: ReviewCandidate[];
}

export const runReview = async (
  vault: VaultStore,
  options: { types?: EntityType[] } = {},
): Promise<ReviewResult> => {
  const types = options.types ?? DEFAULT_REVIEW_TYPES;
  const byNameKey = new Map<
    string,
    { entries: { id: string; path: string }[]; type: EntityType }
  >();
  let scanned = 0;
  for (const type of types) {
    const list = await vault.list(type);
    for (const entry of list) {
      scanned += 1;
      const record = await vault.read(entry.id, type);
      if (record.frontmatter.type !== type) continue;
      // Entity record schemas all include `name`; Source/Claim/Topic don't.
      // Type-narrow rather than indexing into a wider type with `as any`.
      const fm = record.frontmatter;
      if (!('name' in fm)) continue;
      const key = `${type}::${fm.name.toLowerCase()}`;
      const slot = byNameKey.get(key) ?? { entries: [], type };
      slot.entries.push({ id: entry.id, path: entry.relativePath });
      byNameKey.set(key, slot);
    }
  }
  const candidates: ReviewCandidate[] = [];
  for (const [key, slot] of byNameKey) {
    if (slot.entries.length < 2) continue;
    const namePart = key.split('::').slice(1).join('::');
    candidates.push({
      type: slot.type,
      name: namePart,
      ids: slot.entries.map((e) => e.id),
      paths: slot.entries.map((e) => e.path),
    });
  }
  return { scanned, candidates };
};
