import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runMcpRegister } from '../commands/mcp-register.js';

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'xs-mcp-test-'));
  // os.homedir() consults $HOME on POSIX. Stubbing the env var is the
  // ESM-safe way to redirect it; vi.spyOn(os, 'homedir') fails because
  // the os namespace export is non-configurable under Node ESM.
  vi.stubEnv('HOME', tmpHome);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe('runMcpRegister', () => {
  it('writes a Claude desktop config when none exists', async () => {
    const result = await runMcpRegister('claude', { binPath: '/abs/xs-mcp.js' });
    expect(result.changed).toBe(true);
    expect(result.client).toBe('claude');
    const text = await fs.readFile(result.configPath, 'utf8');
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const servers = parsed.mcpServers as Record<string, { command: string; args: string[] }>;
    expect(servers['xs-scraper']?.command).toBe('node');
    expect(servers['xs-scraper']?.args).toEqual(['/abs/xs-mcp.js']);
  });

  it('merges into an existing config without dropping other servers', async () => {
    const claudeConfig = path.join(
      tmpHome,
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    );
    await fs.mkdir(path.dirname(claudeConfig), { recursive: true });
    await fs.writeFile(
      claudeConfig,
      JSON.stringify({ mcpServers: { existing: { command: 'echo' } } }),
      'utf8',
    );
    await runMcpRegister('claude', { binPath: '/abs/xs-mcp.js' });
    const after = JSON.parse(await fs.readFile(claudeConfig, 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(after.mcpServers.existing).toBeDefined();
    expect(after.mcpServers['xs-scraper']).toBeDefined();
  });

  it('reports "unchanged" when our entry already matches', async () => {
    await runMcpRegister('claude', { binPath: '/abs/xs-mcp.js' });
    const second = await runMcpRegister('claude', { binPath: '/abs/xs-mcp.js' });
    expect(second.changed).toBe(false);
  });

  it('writes a Codex config under ~/.codex', async () => {
    const result = await runMcpRegister('codex', { binPath: '/abs/xs-mcp.js' });
    expect(result.configPath).toBe(path.join(tmpHome, '.codex', 'mcp_config.json'));
    expect(result.changed).toBe(true);
  });

  it('writes a Gemini config under ~/.config/gemini-cli', async () => {
    const result = await runMcpRegister('gemini', { binPath: '/abs/xs-mcp.js' });
    expect(result.configPath).toBe(path.join(tmpHome, '.config', 'gemini-cli', 'mcp.json'));
    expect(result.changed).toBe(true);
  });
});
