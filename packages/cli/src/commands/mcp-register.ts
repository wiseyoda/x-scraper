/**
 * `xs mcp register --client=<claude|codex|gemini>` — wire xs-mcp into a
 * client's MCP config.
 *
 * Each client expects MCP servers to be registered in its own JSON file
 * (paths below). We merge our entry rather than rewriting the file so
 * existing user-configured servers survive.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export type McpClient = 'claude' | 'codex' | 'gemini';

export const MCP_CLIENTS: McpClient[] = ['claude', 'codex', 'gemini'];

interface ClientConfigPath {
  /** Absolute path to the JSON config file. */
  file: string;
  /** Top-level JSON key under which MCP servers are nested. */
  serversKey: string;
}

// Resolve paths at call time, not at module load — tests stub os.homedir()
// per-test, and a module-load capture would freeze the real home dir into
// every later call.
const pathFor = (client: McpClient): ClientConfigPath => {
  const home = os.homedir();
  switch (client) {
    case 'claude':
      return {
        file: path.join(
          home,
          'Library',
          'Application Support',
          'Claude',
          'claude_desktop_config.json',
        ),
        serversKey: 'mcpServers',
      };
    case 'codex':
      return { file: path.join(home, '.codex', 'mcp_config.json'), serversKey: 'mcpServers' };
    case 'gemini':
      return {
        file: path.join(home, '.config', 'gemini-cli', 'mcp.json'),
        serversKey: 'mcpServers',
      };
  }
};

interface ServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface RegisterResult {
  client: McpClient;
  configPath: string;
  /** True if our entry was added; false if it already matched. */
  changed: boolean;
}

const readJsonOrEmpty = async (file: string): Promise<Record<string, unknown>> => {
  try {
    const text = await fs.readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw err;
  }
};

/**
 * Resolve the path to the bundled xs-mcp bin relative to THIS module's
 * file location, not the caller's cwd. Without this, running
 * `xs mcp register` from anywhere other than the repo root would write
 * a config pointing at a non-existent server binary.
 */
const resolveDefaultMcpBin = (): string => {
  // This file lives at .../packages/cli/{src or dist}/commands/mcp-register.ts
  // The mcp-server bin is at .../packages/mcp-server/dist/bin.js. Walk up
  // 3 levels to packages/, then into mcp-server/dist/bin.js.
  const here = fileURLToPath(import.meta.url);
  const packagesDir = path.resolve(path.dirname(here), '..', '..', '..');
  return path.join(packagesDir, 'mcp-server', 'dist', 'bin.js');
};

export const runMcpRegister = async (
  client: McpClient,
  options: { binPath?: string; serverName?: string } = {},
): Promise<RegisterResult> => {
  // Default to the workspace-shipped xs-mcp bin, resolved relative to
  // this module's file path so the resolved path is independent of cwd.
  const binPath = options.binPath ?? resolveDefaultMcpBin();
  const serverName = options.serverName ?? 'xs-scraper';
  const target = pathFor(client);
  await fs.mkdir(path.dirname(target.file), { recursive: true });

  const config = await readJsonOrEmpty(target.file);
  const serversRaw = config[target.serversKey];
  const servers: Record<string, ServerEntry> =
    serversRaw !== null && typeof serversRaw === 'object'
      ? (serversRaw as Record<string, ServerEntry>)
      : {};

  const desired: ServerEntry = { command: 'node', args: [binPath] };
  const existing = servers[serverName];
  const equal =
    existing?.command === desired.command &&
    JSON.stringify(existing.args ?? []) === JSON.stringify(desired.args ?? []);

  if (equal) {
    return { client, configPath: target.file, changed: false };
  }

  servers[serverName] = desired;
  config[target.serversKey] = servers;
  // Pretty-print so a human can edit the file later without it becoming
  // a single unreadable line.
  await fs.writeFile(target.file, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return { client, configPath: target.file, changed: true };
};
