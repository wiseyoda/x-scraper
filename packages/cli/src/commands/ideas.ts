/**
 * `xs ideas` — L1 idea management.
 *
 * Subcommands:
 *   synthesize          — find clusters, draft ideas, persist as drafts
 *   list [--status=...] — show ideas (defaults to draft)
 *   show <id>           — print a single idea (frontmatter + body)
 *   confirm <id>        — mark draft as confirmed
 *   reject <id>         — mark draft as rejected (kept on disk for audit)
 */

import type { Frontmatter, IdeaFrontmatter } from '@x-scraper/core';
import type { GraphStore } from '@x-scraper/graph';
import type { LlmProvider } from '@x-scraper/llm';
import type { Logger } from '@x-scraper/observability';
import type { SynthesisResult } from '@x-scraper/synthesizer';
import { synthesizeAll } from '@x-scraper/synthesizer';
import type { VaultStore } from '@x-scraper/vault';

export interface IdeaListEntry {
  id: string;
  status: 'draft' | 'confirmed' | 'rejected';
  subject: string;
  confidence: number;
  sourceCount: number;
  derivedFromCount: number;
  updatedAt: string;
}

export const runIdeasSynthesize = async (input: {
  vault: VaultStore;
  graph: GraphStore | null;
  llm: LlmProvider;
  logger: Logger;
  limit?: number;
  force?: boolean;
}): Promise<SynthesisResult> =>
  synthesizeAll({
    vault: input.vault,
    graph: input.graph,
    llm: input.llm,
    logger: input.logger,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.force === undefined ? {} : { force: input.force }),
  });

export const runIdeasList = async (
  vault: VaultStore,
  options: { status?: 'draft' | 'confirmed' | 'rejected' } = {},
): Promise<IdeaListEntry[]> => {
  const list = await vault.list('Idea');
  const entries: IdeaListEntry[] = [];
  for (const entry of list) {
    let record;
    try {
      record = await vault.read(entry.id, 'Idea');
    } catch {
      continue;
    }
    if (record.frontmatter.type !== 'Idea') continue;
    const fm: IdeaFrontmatter = record.frontmatter;
    if (options.status !== undefined && fm.status !== options.status) continue;
    entries.push({
      id: fm.id,
      status: fm.status,
      subject: fm.subject,
      confidence: fm.synthesizer_confidence,
      sourceCount: fm.sources.length,
      derivedFromCount: fm.derived_from.length,
      updatedAt: fm.updated_at,
    });
  }
  // Newest first; ties broken by id for determinism.
  entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  return entries;
};

export const runIdeasShow = async (
  vault: VaultStore,
  id: string,
): Promise<{ frontmatter: IdeaFrontmatter; body: string } | null> => {
  let record;
  try {
    record = await vault.read(id, 'Idea');
  } catch {
    return null;
  }
  if (record.frontmatter.type !== 'Idea') return null;
  return { frontmatter: record.frontmatter, body: record.body };
};

const setIdeaStatus = async (
  vault: VaultStore,
  id: string,
  status: 'confirmed' | 'rejected',
  now: () => Date = () => new Date(),
): Promise<{ id: string; previousStatus: string; newStatus: string } | null> => {
  let record;
  try {
    record = await vault.read(id, 'Idea');
  } catch {
    return null;
  }
  if (record.frontmatter.type !== 'Idea') return null;
  const fm: IdeaFrontmatter = record.frontmatter;
  const previousStatus = fm.status;
  if (previousStatus === status) {
    return { id, previousStatus, newStatus: status };
  }
  const next: IdeaFrontmatter = {
    ...fm,
    status,
    updated_at: now().toISOString(),
  };
  const frontmatter: Frontmatter = next;
  await vault.write({ frontmatter, body: record.body });
  return { id, previousStatus, newStatus: status };
};

export const runIdeasConfirm = async (
  vault: VaultStore,
  id: string,
): Promise<{ id: string; previousStatus: string; newStatus: string } | null> =>
  setIdeaStatus(vault, id, 'confirmed');

export const runIdeasReject = async (
  vault: VaultStore,
  id: string,
): Promise<{ id: string; previousStatus: string; newStatus: string } | null> =>
  setIdeaStatus(vault, id, 'rejected');
