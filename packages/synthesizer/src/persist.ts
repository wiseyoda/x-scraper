/**
 * Persist a synthesized IdeaDraft to the vault and graph.
 *
 * Idempotent on (anchor, sources, prompt_version): the Idea id is
 * derived from those, so re-running synthesize over the same cluster
 * with the same prompt version produces the same id. Existing drafts
 * are preserved (status / edited_body / created_at all carry forward).
 */

import { entityId, type Frontmatter, type IdeaFrontmatter } from '@x-scraper/core';
import type { GraphStore } from '@x-scraper/graph';
import type { VaultStore } from '@x-scraper/vault';

import { SYNTHESIS_PROMPT_VERSION } from './constants.js';
import type { ClaimCluster, IdeaDraft } from './types.js';

const PROMPT_VERSION_DEFAULT = {
  extraction: 0,
  reconciliation: 0,
  embedding: 0,
};

export const ideaIdForCluster = (cluster: ClaimCluster, promptVersion: number): string => {
  const sortedSources = [...cluster.sourceIds].sort();
  const key = `${cluster.anchor}|v${promptVersion.toString()}|${sortedSources.join(',')}`;
  return entityId('Idea', key);
};

export interface PersistIdeaInput {
  cluster: ClaimCluster;
  draft: IdeaDraft;
  /** Override clock for tests. */
  now?: () => Date;
}

export interface PersistedIdea {
  id: string;
  vaultPath: string;
  /** True when the Idea didn't exist before this call. */
  created: boolean;
}

const buildIdeaBody = (cluster: ClaimCluster, draft: IdeaDraft): string => {
  const lines: string[] = [];
  lines.push(`# ${draft.title}`);
  lines.push('');
  lines.push(draft.body.trim());
  if (draft.caveat !== null && draft.caveat.length > 0) {
    lines.push('');
    lines.push('## Caveat');
    lines.push(draft.caveat.trim());
  }
  lines.push('');
  lines.push('## Derived from');
  for (const c of cluster.claims) {
    lines.push(`- [[${c.id}]] (${c.sourceId})`);
  }
  return `${lines.join('\n')}\n`;
};

export const persistIdea = async (
  vault: VaultStore,
  graph: GraphStore | null,
  input: PersistIdeaInput,
): Promise<PersistedIdea> => {
  const now = (input.now ?? ((): Date => new Date()))().toISOString();
  const ideaId = ideaIdForCluster(input.cluster, SYNTHESIS_PROMPT_VERSION);

  // Preserve workflow state across re-syntheses.
  let createdAt = now;
  let status: 'draft' | 'confirmed' | 'rejected' = 'draft';
  let editedBody = false;
  let bodyToWrite = buildIdeaBody(input.cluster, input.draft);
  try {
    const existing = await vault.read(ideaId, 'Idea');
    if (existing.frontmatter.type === 'Idea') {
      const fm: IdeaFrontmatter = existing.frontmatter;
      createdAt = fm.created_at;
      status = fm.status;
      editedBody = fm.edited_body;
      // If the user has manually edited the body, never overwrite it on
      // re-synthesis. They can opt back in by resetting edited_body.
      if (editedBody) bodyToWrite = existing.body;
    }
  } catch {
    // First write — leave defaults.
  }

  const fm: IdeaFrontmatter = {
    id: ideaId,
    type: 'Idea',
    created_at: createdAt,
    updated_at: now,
    prompt_version: PROMPT_VERSION_DEFAULT,
    sources: [...input.cluster.sourceIds].sort(),
    aliases: [],
    tags: [],
    topics: [],
    tier: 1,
    status,
    subject: input.cluster.anchor,
    synthesizer_confidence: input.draft.confidence,
    synthesizer_version: SYNTHESIS_PROMPT_VERSION,
    synthesized_at: now,
    derived_from: input.cluster.claims.map((c) => c.id),
    edited_body: editedBody,
  };

  const frontmatter: Frontmatter = fm;
  const path = await vault.write({ frontmatter, body: bodyToWrite });

  if (graph !== null) {
    await graph.upsertNode({
      id: ideaId,
      type: 'Idea',
      props: {
        title: input.draft.title,
        subject: input.cluster.anchor,
        confidence: input.draft.confidence,
        status,
        synthesizer_version: SYNTHESIS_PROMPT_VERSION,
      },
    });
    // SYNTHESIZED_FROM edges link the Idea back to each L0 claim it was
    // drafted from. Lets graph queries answer "what ideas does this
    // claim feed into?" and "which ideas have lost evidence?" (when a
    // claim is later invalidated).
    for (const c of input.cluster.claims) {
      await graph.upsertEdge({
        from: ideaId,
        to: c.id,
        type: 'SYNTHESIZED_FROM',
        validAt: now,
        confidence: input.draft.confidence,
      });
    }
  }

  return { id: ideaId, vaultPath: path, created: createdAt === now };
};
