/**
 * Spike 6 — MCP server roundtrip.
 *
 * Spawns spikes/6-mcp-server.ts as a child process over stdio,
 * lists tools, calls search_test with a query, validates the
 * response, and prints the result.
 *
 * Run:  pnpm spike spikes/6-mcp.ts
 */

import * as path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER_ENTRY = path.resolve('spikes/6-mcp-server.ts');

const main = async (): Promise<void> => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['--import=tsx', SERVER_ENTRY],
  });
  const client = new Client({ name: 'spike-6-client', version: '0.0.1' }, { capabilities: {} });

  console.log('connecting to MCP server (stdio)...');
  await client.connect(transport);
  console.log('connected.');

  console.log('\n=== listTools ===');
  const tools = await client.listTools();
  console.log(JSON.stringify(tools, null, 2));

  console.log('\n=== callTool search_test ===');
  const callResult = await client.callTool({
    name: 'search_test',
    arguments: { query: 'graph kuzu vector', limit: 5 },
  });
  console.log(JSON.stringify(callResult, null, 2));

  await client.close();

  const toolFound = tools.tools.some((t) => t.name === 'search_test');
  const contentArr = (callResult as { content?: unknown[] }).content ?? [];
  const firstContent = contentArr[0] as { type?: string; text?: string } | undefined;
  const callOk = firstContent?.type === 'text' && (firstContent.text?.includes('"hits"') ?? false);

  console.log('\n=== Spike 6 result ===');
  console.log(`tool listed: ${toolFound ? 'PASS' : 'FAIL'}`);
  console.log(`tool call returned hits: ${callOk ? 'PASS' : 'FAIL'}`);

  const ok = toolFound && callOk;
  console.log(`\nspike 6 ${ok ? 'PASSED' : 'FAILED'}`);
  if (!ok) process.exit(1);
};

main().catch((err: unknown) => {
  console.error('spike 6 failed:', err);
  process.exit(1);
});
