#!/usr/bin/env node
/**
 * `xs-rest` entrypoint. Listens on localhost by default; bearer token
 * read from XSCRAPER_REST_TOKEN (when set, all routes except /health
 * require Authorization: Bearer <token>).
 */

import * as os from 'node:os';
import * as path from 'node:path';

import { serve } from '@hono/node-server';
import { createSqliteQueue } from '@x-scraper/queue';
import { createMarkdownVault } from '@x-scraper/vault';

import { buildRestApp } from './app.js';
import { DEFAULT_HOST, DEFAULT_PORT, ENV_BEARER } from './constants.js';

const DEFAULT_VAULT = path.join(os.homedir(), 'Documents', 'x-scraper-vault');
const DEFAULT_QUEUE = path.join(os.homedir(), '.config', 'x-scraper', 'queue.sqlite');

const main = (): void => {
  const vaultDir = process.env.XSCRAPER_VAULT ?? DEFAULT_VAULT;
  const queuePath = process.env.XSCRAPER_QUEUE ?? DEFAULT_QUEUE;
  const port = process.env.XSCRAPER_REST_PORT
    ? Number(process.env.XSCRAPER_REST_PORT)
    : DEFAULT_PORT;
  const bearerToken = process.env[ENV_BEARER] ?? null;

  const vault = createMarkdownVault(vaultDir);
  const queue = createSqliteQueue(queuePath);
  const app = buildRestApp({ ctx: { vault, queue }, bearerToken });
  serve({ fetch: app.fetch, port, hostname: DEFAULT_HOST });
  console.log(`xs-rest listening on http://${DEFAULT_HOST}:${String(port)}`);
};

main();
