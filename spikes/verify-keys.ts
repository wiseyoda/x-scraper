/**
 * Verify every API key in ~/.config/x-scraper/.env with the cheapest
 * possible call per provider. Reports per-key pass/fail and brief error.
 *
 * Run:  pnpm spike spikes/verify-keys.ts
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ENV_PATH = path.join(os.homedir(), '.config', 'x-scraper', '.env');
const REQ_TIMEOUT_MS = 15_000;

const loadEnv = (): Record<string, string> => {
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error(`env file not found at ${ENV_PATH}`);
  }
  const out: Record<string, string> = {};
  const text = fs.readFileSync(ENV_PATH, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (value.length > 0) out[key] = value;
  }
  return out;
};

interface Check {
  name: string;
  envKey: string;
  required: boolean;
  run: (key: string) => Promise<{ ok: boolean; detail: string }>;
}

const fetchWithTimeout = async (url: string, init: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REQ_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const checks: Check[] = [
  {
    name: 'Anthropic Claude',
    envKey: 'ANTHROPIC_API_KEY',
    required: true,
    run: async (key) => {
      const resp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 5,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        return { ok: false, detail: `HTTP ${String(resp.status)}: ${body.slice(0, 200)}` };
      }
      const data = (await resp.json()) as { model?: string; usage?: { input_tokens?: number } };
      return {
        ok: true,
        detail: `model=${data.model ?? '?'} input_tokens=${String(data.usage?.input_tokens ?? '?')}`,
      };
    },
  },
  {
    name: 'Google Gemini',
    envKey: 'GEMINI_API_KEY',
    required: true,
    run: async (key) => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${encodeURIComponent(key)}`;
      const resp = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text: 'ping' }] },
        }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        return { ok: false, detail: `HTTP ${String(resp.status)}: ${body.slice(0, 200)}` };
      }
      const data = (await resp.json()) as { embedding?: { values?: number[] } };
      const dims = data.embedding?.values?.length ?? 0;
      return { ok: dims > 0, detail: `dims=${String(dims)}` };
    },
  },
  {
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    required: false,
    run: async (key) => {
      const resp = await fetchWithTimeout('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: 'ping' }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        return { ok: false, detail: `HTTP ${String(resp.status)}: ${body.slice(0, 200)}` };
      }
      const data = (await resp.json()) as { data?: { embedding?: number[] }[] };
      const dims = data.data?.[0]?.embedding?.length ?? 0;
      return { ok: dims > 0, detail: `dims=${String(dims)}` };
    },
  },
  {
    name: 'Exa',
    envKey: 'EXA_API_KEY',
    required: false,
    run: async (key) => {
      const resp = await fetchWithTimeout('https://api.exa.ai/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ query: 'site:anthropic.com', numResults: 1 }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        return { ok: false, detail: `HTTP ${String(resp.status)}: ${body.slice(0, 200)}` };
      }
      const data = (await resp.json()) as { results?: unknown[] };
      return { ok: true, detail: `results=${String(data.results?.length ?? 0)}` };
    },
  },
  {
    name: 'Tavily',
    envKey: 'TAVILY_API_KEY',
    required: false,
    run: async (key) => {
      const resp = await fetchWithTimeout('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: key, query: 'anthropic claude', max_results: 1 }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        return { ok: false, detail: `HTTP ${String(resp.status)}: ${body.slice(0, 200)}` };
      }
      const data = (await resp.json()) as { results?: unknown[] };
      return { ok: true, detail: `results=${String(data.results?.length ?? 0)}` };
    },
  },
  {
    name: 'Brave Search',
    envKey: 'BRAVE_SEARCH_API_KEY',
    required: false,
    run: async (key) => {
      const url = 'https://api.search.brave.com/res/v1/web/search?q=anthropic&count=1';
      const resp = await fetchWithTimeout(url, {
        headers: { accept: 'application/json', 'X-Subscription-Token': key },
      });
      if (!resp.ok) {
        const body = await resp.text();
        return { ok: false, detail: `HTTP ${String(resp.status)}: ${body.slice(0, 200)}` };
      }
      const data = (await resp.json()) as { web?: { results?: unknown[] } };
      return { ok: true, detail: `results=${String(data.web?.results?.length ?? 0)}` };
    },
  },
];

const main = async (): Promise<void> => {
  const env = loadEnv();
  console.log(`env loaded from ${ENV_PATH}\n`);
  const results = await Promise.all(
    checks.map(async (check) => {
      const key = env[check.envKey];
      if (!key) {
        return {
          name: check.name,
          envKey: check.envKey,
          required: check.required,
          status: 'missing' as const,
          detail: '',
        };
      }
      try {
        const { ok, detail } = await check.run(key);
        return {
          name: check.name,
          envKey: check.envKey,
          required: check.required,
          status: ok ? ('pass' as const) : ('fail' as const),
          detail,
        };
      } catch (err) {
        return {
          name: check.name,
          envKey: check.envKey,
          required: check.required,
          status: 'error' as const,
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  const padName = Math.max(...results.map((r) => r.name.length));
  const padKey = Math.max(...results.map((r) => r.envKey.length));
  for (const r of results) {
    const icon = r.status === 'pass' ? 'OK ' : r.status === 'missing' ? '-- ' : 'FAIL';
    const flag = r.required ? 'required' : 'optional';
    console.log(
      `[${icon}] ${r.name.padEnd(padName)}  ${r.envKey.padEnd(padKey)}  (${flag})  ${r.detail}`,
    );
  }

  const requiredFailed = results.filter((r) => r.required && r.status !== 'pass');
  if (requiredFailed.length > 0) {
    console.log('\nRequired keys with problems:');
    for (const r of requiredFailed) {
      console.log(`  - ${r.envKey}: ${r.status} ${r.detail}`);
    }
    process.exit(1);
  }
  console.log('\nAll required keys verified.');
};

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
