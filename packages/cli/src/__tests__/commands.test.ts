import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCost } from '../commands/cost.js';
import { runDoctor } from '../commands/doctor.js';
import { runInit } from '../commands/init.js';
import { runStatus } from '../commands/status.js';
import type { CliConfig } from '../config.js';

let workDir = '';
let config: CliConfig;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xscraper-cli-test-'));
  config = {
    vaultDir: path.join(workDir, 'vault'),
    queuePath: path.join(workDir, 'q.sqlite'),
  };
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('runInit', () => {
  it('creates a fresh vault and queue, and is idempotent', async () => {
    const first = await runInit(config);
    expect(first.vaultCreated).toBe(true);
    expect(first.queueCreated).toBe(true);
    const second = await runInit(config);
    expect(second.vaultCreated).toBe(false);
    expect(second.queueCreated).toBe(false);
  });
});

describe('runStatus', () => {
  it('reports zero pending after init', async () => {
    await runInit(config);
    const result = runStatus(config);
    expect(result.stats.pending).toBe(0);
    expect(result.dlqCount).toBe(0);
  });
});

describe('runCost', () => {
  it('returns zero for a fresh queue', async () => {
    await runInit(config);
    const result = runCost(config);
    expect(result.totalUsd).toBe(0);
  });

  it('respects an explicit --since', async () => {
    await runInit(config);
    const result = runCost(config, '2030-01-01T00:00:00.000Z');
    expect(result.totalUsd).toBe(0);
    expect(result.sinceIso).toBe('2030-01-01T00:00:00.000Z');
  });
});

describe('runDoctor', () => {
  it('reports vault PASS and queue PASS after init', async () => {
    await runInit(config);
    const checks = await runDoctor(config);
    const vault = checks.find((c) => c.name === 'vault');
    const queue = checks.find((c) => c.name === 'queue');
    expect(vault?.status).toBe('PASS');
    expect(queue?.status).toBe('PASS');
  });

  it('reports vault WARN before init', async () => {
    const checks = await runDoctor(config);
    const vault = checks.find((c) => c.name === 'vault');
    expect(vault?.status).toBe('WARN');
  });
});
