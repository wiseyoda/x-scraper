#!/usr/bin/env node
/**
 * `xs-rest` entrypoint. Listens on localhost; bearer token loaded from
 * `~/.config/x-scraper/.env` (XSCRAPER_REST_TOKEN) or the surrounding
 * shell environment. The server FAILS CLOSED when no token is found —
 * use XSCRAPER_REST_ALLOW_UNAUTH=1 to opt in to an unauth'd local
 * instance (e.g. for one-off CLI hacking).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { serve } from '@hono/node-server';
import { createSqliteQueue } from '@x-scraper/queue';
import { createMarkdownVault } from '@x-scraper/vault';

import { buildRestApp } from './app.js';
import { DEFAULT_HOST, DEFAULT_PORT, ENV_BEARER } from './constants.js';

const DEFAULT_VAULT = path.join(os.homedir(), 'Documents', 'x-scraper-vault');
const DEFAULT_QUEUE = path.join(os.homedir(), '.config', 'x-scraper', 'queue.sqlite');
const ENV_FILE = path.join(os.homedir(), '.config', 'x-scraper', '.env');
const ENV_ALLOW_UNAUTH = 'XSCRAPER_REST_ALLOW_UNAUTH';

const parseEnvFile = (envPath: string): Record<string, string> => {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#') || t.length === 0) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const v = t.slice(eq + 1).trim();
    if (v.length > 0) out[t.slice(0, eq).trim()] = v;
  }
  return out;
};

const main = (): void => {
  const fileEnv = parseEnvFile(ENV_FILE);
  const vaultDir = process.env.XSCRAPER_VAULT ?? fileEnv.XSCRAPER_VAULT ?? DEFAULT_VAULT;
  const queuePath = process.env.XSCRAPER_QUEUE ?? fileEnv.XSCRAPER_QUEUE ?? DEFAULT_QUEUE;
  const portStr = process.env.XSCRAPER_REST_PORT ?? fileEnv.XSCRAPER_REST_PORT;
  const port = portStr !== undefined ? Number(portStr) : DEFAULT_PORT;
  const bearerToken = process.env[ENV_BEARER] ?? fileEnv[ENV_BEARER] ?? null;
  const allowUnauth = (process.env[ENV_ALLOW_UNAUTH] ?? fileEnv[ENV_ALLOW_UNAUTH] ?? '0') === '1';

  if (bearerToken === null && !allowUnauth) {
    console.error(
      `xs-rest: ${ENV_BEARER} is not set in ${ENV_FILE} or the environment.\n` +
        `Set ${ENV_BEARER} to enable bearer auth, or set ${ENV_ALLOW_UNAUTH}=1 to ` +
        `start the server unauthenticated. Refusing to start.`,
    );
    process.exit(1);
  }

  const vault = createMarkdownVault(vaultDir);
  const queue = createSqliteQueue(queuePath);
  const app = buildRestApp({ ctx: { vault, queue }, bearerToken });
  serve({ fetch: app.fetch, port, hostname: DEFAULT_HOST });
  console.log(`xs-rest listening on http://${DEFAULT_HOST}:${String(port)}`);
};

main();
