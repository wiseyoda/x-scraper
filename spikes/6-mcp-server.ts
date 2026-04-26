/**
 * Spike 6 — MCP server (stdio) using the high-level McpServer API.
 *
 * Standalone server exposing one `search_test` tool. Run as a child
 * process by spikes/6-mcp.ts (the test client). Also registerable in
 * Claude Code via:
 *
 *   claude mcp add x-scraper-spike \
 *     -- node --import=tsx /Users/ppatterson/Working/x-scraper/spikes/6-mcp-server.ts
 *
 * (or use the project-local entry point once the production package
 * lands).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

interface SearchHit {
  id: string;
  title: string;
  snippet: string;
  score: number;
}

const FAKE_CORPUS: { id: string; title: string; body: string }[] = [
  { id: 'doc-1', title: 'Kuzu graph database', body: 'embedded property graph with HNSW vector index' },
  { id: 'doc-2', title: 'Patchright stealth Playwright', body: 'browser automation that evades bot detection' },
  { id: 'doc-3', title: 'Graphiti temporal memory', body: 'bi-temporal entity reconciliation for AI agents' },
  { id: 'doc-4', title: 'Gemini embeddings', body: 'multimodal vector embeddings with Matryoshka truncation' },
  { id: 'doc-5', title: 'Claude extraction', body: 'structured entity and claim extraction from text' },
];

const fakeSearch = (query: string, limit: number): SearchHit[] => {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  return FAKE_CORPUS.map((doc) => {
    const haystack = `${doc.title} ${doc.body}`.toLowerCase();
    const hits = tokens.filter((t) => haystack.includes(t)).length;
    return { id: doc.id, title: doc.title, snippet: doc.body, score: hits };
  })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};

const server = new McpServer({ name: 'x-scraper-spike', version: '0.0.1' });

server.registerTool(
  'search_test',
  {
    title: 'search_test',
    description: 'Spike-only fake search over a 5-doc corpus. Returns matching hits with score.',
    inputSchema: {
      query: z.string().min(1).describe('whitespace-tokenized query'),
      limit: z.number().int().min(1).max(50).default(10),
    },
  },
  ({ query, limit }) => {
    const hits = fakeSearch(query, limit);
    return {
      content: [{ type: 'text', text: JSON.stringify({ hits }, null, 2) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
