#!/usr/bin/env node
/**
 * `xs-mcp` entrypoint: a stdio MCP server that talks to a local vault
 * and queue. Wire it into Claude Code / Codex / Gemini CLI by adding
 * an MCP server entry that runs this binary with the appropriate env
 * vars (XSCRAPER_VAULT, XSCRAPER_QUEUE).
 */

import * as os from 'node:os';
import * as path from 'node:path';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSqliteQueue } from '@x-scraper/queue';
import { createMarkdownVault } from '@x-scraper/vault';

import { buildMcpServer } from './server.js';

const DEFAULT_VAULT = path.join(os.homedir(), 'Documents', 'x-scraper-vault');
const DEFAULT_QUEUE = path.join(os.homedir(), '.config', 'x-scraper', 'queue.sqlite');

const main = async (): Promise<void> => {
  const vaultDir = process.env.XSCRAPER_VAULT ?? DEFAULT_VAULT;
  const queuePath = process.env.XSCRAPER_QUEUE ?? DEFAULT_QUEUE;
  const vault = createMarkdownVault(vaultDir);
  const queue = createSqliteQueue(queuePath);
  const server = buildMcpServer({ vault, queue });
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((err: unknown) => {
  console.error('xs-mcp:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
