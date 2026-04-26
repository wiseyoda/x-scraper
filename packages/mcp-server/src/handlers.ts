/**
 * Pure tool handlers. Each takes a ServerContext + validated input and
 * returns plain data. The MCP server layer wraps these in CallToolResult.
 */

import { ENTITY_TYPES, type EntityType } from '@x-scraper/core';

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
