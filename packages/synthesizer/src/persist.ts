/**
 * Persist a synthesized IdeaDraft to the vault and graph.
 *
 * Idempotent on (anchor, prompt_version): the Idea id is derived from
 * those, so re-running synthesize over the same cluster with the same
 * prompt version produces the same id. created_at and edited_body
 * always carry forward.
 *
 * Status policy:
 *   - Manual confirm/reject is sticky: if the existing record has a
 *     non-draft status AND was NOT auto-confirmed by us, we preserve it.
 *   - Otherwise (new record, was auto-confirmed by us, or still a
 *     draft), status is recomputed from current evidence. Crossing the
 *     auto-confirm bar (≥ AUTO_CONFIRM_SOURCES sources AND
 *     ≥ AUTO_CONFIRM_CONFIDENCE confidence) sets status='confirmed' with
 *     auto_confirmed=true. Falling back below the bar downgrades a
 *     prior auto-confirm to 'draft'.
 */

import { entityId, type Frontmatter, type IdeaFrontmatter } from '@x-scraper/core';
import type { GraphStore } from '@x-scraper/graph';
import type { VaultStore } from '@x-scraper/vault';

import {
  AUTO_CONFIRM_CONFIDENCE,
  AUTO_CONFIRM_SOURCES,
  SYNTHESIS_PROMPT_VERSION,
} from './constants.js';
import type { ClaimCluster, IdeaDraft } from './types.js';

const PROMPT_VERSION_DEFAULT = {
  extraction: 0,
  reconciliation: 0,
  embedding: 0,
};

/**
 * Idea id derivation.
 *
 * Stable on (anchor, prompt-version) — adding new sources / claims to
 * the cluster updates the existing Idea rather than minting a new one.
 * This way, evidence growing over time strengthens an Idea instead of
 * spawning a parallel draft for every new source mention.
 *
 * The promptVersion bump is the explicit way to fork: bumping it
 * produces a new id and the previous draft stays on disk for audit.
 */
export const ideaIdForCluster = (cluster: ClaimCluster, promptVersion: number): string => {
  const key = `${cluster.anchor}|v${promptVersion.toString()}`;
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
  /** Final status written to disk. */
  status: 'draft' | 'confirmed' | 'rejected';
  /** True when the synthesizer set status (vs preserving a manual decision). */
  autoConfirmed: boolean;
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

  // Auto-confirm bar: broad evidence AND strong synthesizer agreement.
  // Single-source-narrative clusters (high conf, low source count) stay
  // in the manual queue.
  const sourceCount = input.cluster.sourceIds.length;
  const meetsAutoBar =
    input.draft.confidence >= AUTO_CONFIRM_CONFIDENCE && sourceCount >= AUTO_CONFIRM_SOURCES;

  // Defaults for a new record: auto-confirm if it crosses the bar.
  let createdAt = now;
  let status: 'draft' | 'confirmed' | 'rejected' = meetsAutoBar ? 'confirmed' : 'draft';
  let autoConfirmed = meetsAutoBar;
  let editedBody = false;
  let bodyToWrite = buildIdeaBody(input.cluster, input.draft);
  try {
    const existing = await vault.read(ideaId, 'Idea');
    if (existing.frontmatter.type === 'Idea') {
      const fm: IdeaFrontmatter = existing.frontmatter;
      createdAt = fm.created_at;
      editedBody = fm.edited_body;
      // If the user has manually edited the body, never overwrite it on
      // re-synthesis. They can opt back in by resetting edited_body.
      if (editedBody) bodyToWrite = existing.body;

      // Manual confirm/reject is sticky. We treat status as user-touched
      // when the existing record is non-draft and was NOT auto-confirmed
      // by us — that combination means a human ran `xs ideas confirm` /
      // `reject` (or the web-ui equivalent).
      const userTouched = !fm.auto_confirmed && fm.status !== 'draft';
      if (userTouched) {
        status = fm.status;
        autoConfirmed = fm.auto_confirmed;
      }
      // Otherwise (was auto-confirmed by us, or still a draft), recompute
      // from current evidence — which may upgrade a stale draft OR
      // downgrade an auto-confirm whose evidence weakened.
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
    // Prefer the entity's display form (proper case) when the cluster
    // was entity-anchored; fall back to the normalized anchor.
    subject: input.cluster.anchorDisplay ?? input.cluster.anchor,
    synthesizer_confidence: input.draft.confidence,
    synthesizer_version: SYNTHESIS_PROMPT_VERSION,
    synthesized_at: now,
    derived_from: input.cluster.claims.map((c) => c.id),
    edited_body: editedBody,
    auto_confirmed: autoConfirmed,
  };

  const frontmatter: Frontmatter = fm;
  const path = await vault.write({ frontmatter, body: bodyToWrite });

  if (graph !== null) {
    await graph.upsertNode({
      id: ideaId,
      type: 'Idea',
      props: {
        title: input.draft.title,
        subject: input.cluster.anchorDisplay ?? input.cluster.anchor,
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
    // PROMOTES edge: when the cluster was anchored on an entity, link
    // entity → idea so navigating from the entity's page surfaces the
    // ideas it underwrites. The reverse direction matches the semantic
    // ("Anthropic" promotes the idea about Anthropic).
    if (input.cluster.entityId !== undefined) {
      await graph.upsertEdge({
        from: input.cluster.entityId,
        to: ideaId,
        type: 'PROMOTES',
        validAt: now,
        confidence: input.draft.confidence,
      });
    }
  }

  return {
    id: ideaId,
    vaultPath: path,
    created: createdAt === now,
    status,
    autoConfirmed,
  };
};
