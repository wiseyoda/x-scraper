/**
 * Pure tool handlers. Each takes a ServerContext + validated input and
 * returns plain data. The MCP server layer wraps these in CallToolResult.
 */

import { ENTITY_TYPES, type EntityType } from '@x-scraper/core';
import { attachmentsSince, related } from '@x-scraper/related';

import {
  type SearchHit,
  type ServerContext,
  type SourcePayload,
  type StatusReport,
  ToolError,
} from './types.js';

const MATCH_PREVIEW_CHARS = 200;
const MAX_HITS_DEFAULT = 25;
const MAX_HITS_CEILING = 100;

const isEntityType = (s: string): s is EntityType =>
  (ENTITY_TYPES as readonly string[]).includes(s);

export interface SearchInput {
  query?: string;
  type?: string;
  limit?: number;
}

/** Substring search across the vault. The vault store is the source of truth. */
export const searchVault = async (ctx: ServerContext, input: SearchInput): Promise<SearchHit[]> => {
  const limitRaw = input.limit ?? MAX_HITS_DEFAULT;
  const limit = Math.max(1, Math.min(limitRaw, MAX_HITS_CEILING));
  const filter = input.type !== undefined && input.type.length > 0 ? input.type : undefined;
  if (filter !== undefined && !isEntityType(filter)) {
    throw new ToolError(`unknown entity type: ${filter}`, 'INVALID_INPUT');
  }
  const entries = await ctx.vault.list(filter);
  const queryLower = input.query?.toLowerCase().trim() ?? '';
  let filtered = entries;
  if (queryLower.length > 0) {
    filtered = entries.filter((e) => e.id.toLowerCase().includes(queryLower));
  }
  return filtered.slice(0, limit).map((e) => ({
    id: e.id,
    type: e.type,
    relativePath: e.relativePath,
    mtime: e.mtime.toISOString(),
  }));
};

export interface ReadSourceInput {
  id: string;
  type: string;
}

export const readSource = async (
  ctx: ServerContext,
  input: ReadSourceInput,
): Promise<SourcePayload> => {
  if (!isEntityType(input.type)) {
    throw new ToolError(`unknown entity type: ${input.type}`, 'INVALID_INPUT');
  }
  const record = await ctx.vault.read(input.id, input.type);
  const fm = record.frontmatter as { url?: string; canonical_url?: string };
  return {
    id: input.id,
    type: input.type,
    url: fm.canonical_url ?? fm.url ?? null,
    body: record.body,
  };
};

export const getStatus = (ctx: ServerContext): StatusReport => {
  const stats = ctx.queue.stats();
  return {
    pending: stats.pending,
    running: stats.running,
    done: stats.done,
    failed: stats.failed,
    dead: stats.dead,
    dlqCount: ctx.queue.listDlq().length,
  };
};

export const summarizeHit = (body: string): string =>
  body.length > MATCH_PREVIEW_CHARS ? `${body.slice(0, MATCH_PREVIEW_CHARS).trim()}…` : body;

export interface RelatedToInput {
  id: string;
  limit?: number;
}

/** Rank related vault nodes — shared @x-scraper/related engine. */
export const relatedTo = async (ctx: ServerContext, input: RelatedToInput) => {
  if (input.id.trim().length === 0) {
    throw new ToolError('id is required', 'INVALID_INPUT');
  }
  const result = await related(
    { vault: ctx.vault, graph: null },
    { id: input.id, ...(input.limit === undefined ? {} : { limit: input.limit }) },
  );
  return {
    id: result.id,
    mode: result.mode,
    hits: result.hits.map((h) => ({
      targetId: h.targetId,
      targetKind: h.targetKind,
      reason: h.reason,
      score: h.score,
      evidenceIds: h.evidenceIds,
    })),
  };
};

export interface WhatsNewInput {
  /** ISO timestamp; default last 7 days. */
  since?: string;
  limit?: number;
}

/** Attachment events + recent sources/ideas since a cutoff. */
export const whatsNew = async (ctx: ServerContext, input: WhatsNewInput = {}) => {
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const since =
    input.since !== undefined && input.since.length > 0
      ? input.since
      : new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const limit = Math.max(1, Math.min(input.limit ?? 25, MAX_HITS_CEILING));
  const events = await attachmentsSince(
    { vault: ctx.vault, graph: null },
    since,
    { sourceLimit: limit, relatedLimit: 4 },
  );
  const ideaHits = await searchVault(ctx, { type: 'Idea', limit });
  const recentIdeas = ideaHits.filter((h) => Date.parse(h.mtime) >= Date.parse(since));
  return {
    since,
    attachments: events.slice(0, limit),
    recentIdeas: recentIdeas.slice(0, limit),
  };
};

export interface SearchIdeasInput {
  query?: string;
  limit?: number;
  status?: 'draft' | 'confirmed' | 'rejected';
}

/** Search Idea records by id/subject/body substring. */
export const searchIdeas = async (ctx: ServerContext, input: SearchIdeasInput = {}) => {
  const limit = Math.max(1, Math.min(input.limit ?? MAX_HITS_DEFAULT, MAX_HITS_CEILING));
  const entries = await ctx.vault.list('Idea');
  const q = input.query?.toLowerCase().trim() ?? '';
  const hits: {
    id: string;
    subject: string;
    status: string;
    sourceCount: number;
    snippet: string | null;
  }[] = [];
  for (const e of entries) {
    if (hits.length >= limit) break;
    try {
      const rec = await ctx.vault.read(e.id, 'Idea');
      if (rec.frontmatter.type !== 'Idea') continue;
      const fm = rec.frontmatter;
      if (input.status !== undefined && fm.status !== input.status) continue;
      const hay = `${fm.id} ${fm.subject} ${rec.body}`.toLowerCase();
      if (q.length > 0 && !hay.includes(q)) continue;
      hits.push({
        id: fm.id,
        subject: fm.subject,
        status: fm.status,
        sourceCount: fm.sources.length,
        snippet: summarizeHit(rec.body.replace(/^#.*\n+/, '').trim()),
      });
    } catch {
      /* skip */
    }
  }
  return { hits };
};
