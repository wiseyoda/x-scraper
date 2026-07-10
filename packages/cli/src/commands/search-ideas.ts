/**
 * `xs search-ideas [--query=...] [--status=...] [--limit=N]` — CLI mirror of MCP search_ideas.
 */

import { createMarkdownVault } from '@x-scraper/vault';

import type { CliConfig } from '../config.js';

export interface SearchIdeasOptions {
  query?: string;
  status?: 'draft' | 'confirmed' | 'rejected';
  limit?: number;
}

export const runSearchIdeas = async (config: CliConfig, options: SearchIdeasOptions = {}) => {
  const vault = createMarkdownVault(config.vaultDir);
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const q = options.query?.toLowerCase().trim() ?? '';
  const entries = await vault.list('Idea');
  const hits: {
    id: string;
    subject: string;
    status: string;
    sourceCount: number;
  }[] = [];
  for (const e of entries) {
    if (hits.length >= limit) break;
    try {
      const rec = await vault.read(e.id, 'Idea');
      if (rec.frontmatter.type !== 'Idea') continue;
      const fm = rec.frontmatter;
      if (options.status !== undefined && fm.status !== options.status) continue;
      const hay = `${fm.id} ${fm.subject} ${rec.body}`.toLowerCase();
      if (q.length > 0 && !hay.includes(q)) continue;
      hits.push({
        id: fm.id,
        subject: fm.subject,
        status: fm.status,
        sourceCount: fm.sources.length,
      });
    } catch {
      /* skip */
    }
  }
  return { hits };
};
