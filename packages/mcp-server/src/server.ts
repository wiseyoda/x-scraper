/**
 * MCP server wiring.
 *
 * Builds an `McpServer` with three tools:
 *   - search_vault   { query?, type?, limit? }   → list of hits
 *   - read_source    { id, type }                → frontmatter url + body
 *   - queue_status   {}                          → per-status counts + dlq
 *
 * Tools call the pure handlers in handlers.ts; this module only wraps
 * them in MCP request/result framing.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ENTITY_TYPES } from '@x-scraper/core';
import { z } from 'zod';

import { getStatus, readSource, searchVault } from './handlers.js';
import type { ServerContext } from './types.js';

const SERVER_NAME = 'x-scraper';
const SERVER_VERSION = '0.0.0';

const MAX_LIMIT = 100;

const searchInput = {
  query: z.string().optional().describe('Substring to match against entry ids'),
  type: z
    .enum(ENTITY_TYPES as unknown as readonly [string, ...string[]])
    .optional()
    .describe('Restrict to one entity type'),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe('Max hits (default 25)'),
};

const readSourceInput = {
  id: z.string().min(1),
  type: z.enum(ENTITY_TYPES as unknown as readonly [string, ...string[]]),
};

const queueStatusInput = {};

export const buildMcpServer = (ctx: ServerContext): McpServer => {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    'search_vault',
    {
      title: 'Search the local vault',
      description:
        'List vault entries matching an id-substring query, optionally restricted to one entity type.',
      inputSchema: searchInput,
    },
    async (input) => {
      const args: Parameters<typeof searchVault>[1] = {};
      if (typeof input.query === 'string') args.query = input.query;
      if (typeof input.type === 'string') args.type = input.type;
      if (typeof input.limit === 'number') args.limit = input.limit;
      const hits = await searchVault(ctx, args);
      return {
        content: [{ type: 'text', text: JSON.stringify({ hits }, null, 2) }],
      };
    },
  );

  server.registerTool(
    'read_source',
    {
      title: 'Read a source by id',
      description: 'Returns the canonical URL and the raw markdown body of the requested record.',
      inputSchema: readSourceInput,
    },
    async (input) => {
      const id = typeof input.id === 'string' ? input.id : '';
      const type = typeof input.type === 'string' ? input.type : '';
      const payload = await readSource(ctx, { id, type });
      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  server.registerTool(
    'queue_status',
    {
      title: 'Queue status',
      description: 'Per-status job counts plus the dead-letter-queue count.',
      inputSchema: queueStatusInput,
    },
    () => {
      const report = getStatus(ctx);
      return {
        content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
      };
    },
  );

  return server;
};
