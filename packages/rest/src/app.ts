/**
 * Hono app factory. Mirrors the MCP server's tool surface as REST routes:
 *
 *   GET  /health
 *   POST /search        body: { query?, type?, limit? }
 *   POST /read          body: { id, type }
 *   GET  /status
 *
 * Auth: when `bearerToken` is supplied, every route except /health
 *       requires `Authorization: Bearer <token>`.
 *
 * The Hono app is returned as a value so tests can call `app.request(...)`
 * directly without a network listener.
 */

import { ENTITY_TYPES } from '@x-scraper/core';
import {
  getStatus,
  readSource,
  searchVault,
  type ServerContext,
  ToolError,
} from '@x-scraper/mcp-server';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  AUTH_HEADER,
  HTTP_BAD_REQUEST,
  HTTP_INTERNAL,
  HTTP_NOT_FOUND,
  HTTP_UNAUTHORIZED,
} from './constants.js';

export interface RestAppConfig {
  ctx: ServerContext;
  /** When set, all non-/health routes require Bearer <token>. */
  bearerToken?: string | null;
}

const SearchBodySchema = z.object({
  query: z.string().optional(),
  type: z.string().optional(),
  limit: z.number().int().min(1).optional(),
});

const ReadBodySchema = z.object({
  id: z.string().min(1),
  type: z.enum(ENTITY_TYPES as unknown as readonly [string, ...string[]]),
});

const errorBody = (
  code: string,
  message: string,
): { error: { code: string; message: string } } => ({
  error: { code, message },
});

export const buildRestApp = (config: RestAppConfig): Hono => {
  const app = new Hono();
  const requireAuth = config.bearerToken !== null && config.bearerToken !== undefined;

  app.use('*', async (c, next) => {
    if (!requireAuth) return next();
    if (c.req.path === '/health') return next();
    const header = c.req.header(AUTH_HEADER) ?? '';
    if (header !== `Bearer ${String(config.bearerToken)}`) {
      return c.json(
        errorBody('UNAUTHORIZED', 'missing or invalid bearer token'),
        HTTP_UNAUTHORIZED,
      );
    }
    return next();
  });

  app.get('/health', (c) => c.json({ ok: true }));

  const runSearch = async (c: Context, raw: unknown): Promise<Response> => {
    const parsed = SearchBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(errorBody('INVALID_INPUT', parsed.error.message), HTTP_BAD_REQUEST);
    }
    try {
      const args: Parameters<typeof searchVault>[1] = {};
      if (parsed.data.query !== undefined) args.query = parsed.data.query;
      if (parsed.data.type !== undefined) args.type = parsed.data.type;
      if (parsed.data.limit !== undefined) args.limit = parsed.data.limit;
      const hits = await searchVault(config.ctx, args);
      return c.json({ hits });
    } catch (err) {
      if (err instanceof ToolError) {
        return c.json(errorBody(err.code, err.message), HTTP_BAD_REQUEST);
      }
      return c.json(errorBody('INTERNAL', 'search failed'), HTTP_INTERNAL);
    }
  };

  app.post('/search', async (c) => runSearch(c, await c.req.json().catch(() => ({}))));

  // GET form documented in the roadmap (`curl localhost:7777/search?q=foo`).
  // Maps q→query, type→type, limit→limit.
  app.get('/search', async (c) => {
    const url = new URL(c.req.url);
    const body: Record<string, string | number> = {};
    const q = url.searchParams.get('q') ?? url.searchParams.get('query');
    if (q !== null) body.query = q;
    const type = url.searchParams.get('type');
    if (type !== null) body.type = type;
    const limitStr = url.searchParams.get('limit');
    if (limitStr !== null) {
      const n = Number(limitStr);
      if (Number.isFinite(n)) body.limit = n;
    }
    return runSearch(c, body);
  });

  app.post('/read', async (c) => {
    const raw: unknown = await c.req.json().catch(() => ({}));
    const parsed = ReadBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(errorBody('INVALID_INPUT', parsed.error.message), HTTP_BAD_REQUEST);
    }
    try {
      const result = await readSource(config.ctx, parsed.data);
      return c.json(result);
    } catch (err) {
      if (err instanceof ToolError) {
        const status = err.code === 'INVALID_INPUT' ? HTTP_BAD_REQUEST : HTTP_INTERNAL;
        return c.json(errorBody(err.code, err.message), status);
      }
      const message = err instanceof Error ? err.message : String(err);
      const isMissing = message.toLowerCase().includes('not found');
      return c.json(
        errorBody(isMissing ? 'NOT_FOUND' : 'INTERNAL', message),
        isMissing ? HTTP_NOT_FOUND : HTTP_INTERNAL,
      );
    }
  });

  app.get('/status', (c) => c.json(getStatus(config.ctx)));

  return app;
};
