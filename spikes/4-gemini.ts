/**
 * Spike 4 — Gemini embedding-2-preview.
 *
 * Goal: confirm we can embed 100 short texts via batchEmbedContents at
 * 1536 dims (Matryoshka truncation) under 5s, and that cosine similarity
 * passes a sanity check (related strings closer than unrelated).
 *
 * Run:  pnpm spike spikes/4-gemini.ts
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ENV_PATH = path.join(os.homedir(), '.config', 'x-scraper', '.env');
const MODEL = 'gemini-embedding-2-preview';
const FALLBACK_MODEL = 'gemini-embedding-001';
const BATCH_URL_FOR = (model: string, key: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${encodeURIComponent(key)}`;
const TARGET_DIMS = 1536;
const N_DOCS = 100;
const LATENCY_BUDGET_MS = 5_000;
const REQ_TIMEOUT_MS = 30_000;

interface EmbedReply {
  embeddings: { values: number[] }[];
}

const loadEnvKey = (envKey: string): string => {
  const text = fs.readFileSync(ENV_PATH, 'utf8');
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#') || t.length === 0) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    if (t.slice(0, eq).trim() === envKey) {
      const v = t.slice(eq + 1).trim();
      if (v.length > 0) return v;
    }
  }
  throw new Error(`${envKey} missing in ${ENV_PATH}`);
};

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

const cosine = (a: number[], b: number[]): number => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

const generateInputs = (n: number): string[] => {
  const topics = [
    'distributed systems consistency models',
    'rust ownership and lifetimes',
    'typescript structural typing',
    'graph databases and cypher queries',
    'embedded vector indexes hnsw',
    'pasta carbonara recipe',
    'sourdough hydration ratios',
    'rock climbing knots',
    'jazz harmony chord substitutions',
    'electric guitar pickup wiring',
  ];
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = topics[i % topics.length] ?? 'general knowledge';
    out.push(`Document ${String(i)}: notes on ${t}`);
  }
  return out;
};

const embedBatch = async (
  apiKey: string,
  inputs: string[],
  model: string,
): Promise<{ embeddings: number[][]; modelUsed: string }> => {
  const body = {
    requests: inputs.map((text) => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      outputDimensionality: TARGET_DIMS,
    })),
  };
  const resp = await fetchWithTimeout(BATCH_URL_FOR(model, apiKey), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gemini ${model} HTTP ${String(resp.status)}: ${text.slice(0, 300)}`);
  }
  const data = (await resp.json()) as EmbedReply;
  if (!Array.isArray(data.embeddings) || data.embeddings.length !== inputs.length) {
    throw new Error(`expected ${String(inputs.length)} embeddings, got ${String(data.embeddings.length)}`);
  }
  return { embeddings: data.embeddings.map((e) => e.values), modelUsed: model };
};

const tryEmbedWithFallback = async (
  apiKey: string,
  inputs: string[],
): Promise<{ embeddings: number[][]; modelUsed: string }> => {
  try {
    return await embedBatch(apiKey, inputs, MODEL);
  } catch (err) {
    console.log(`primary model failed: ${err instanceof Error ? err.message : String(err)}`);
    console.log(`falling back to ${FALLBACK_MODEL}`);
    return await embedBatch(apiKey, inputs, FALLBACK_MODEL);
  }
};

const main = async (): Promise<void> => {
  const apiKey = loadEnvKey('GEMINI_API_KEY');
  const inputs = generateInputs(N_DOCS);
  console.log(`embedding ${String(N_DOCS)} docs with ${MODEL} (output_dim=${String(TARGET_DIMS)})`);

  const start = performance.now();
  const { embeddings, modelUsed } = await tryEmbedWithFallback(apiKey, inputs);
  const ms = performance.now() - start;
  console.log(`got ${String(embeddings.length)} embeddings in ${ms.toFixed(0)} ms (model=${modelUsed})`);

  const dims = embeddings[0]?.length ?? 0;
  console.log(`dims: ${String(dims)} (target ${String(TARGET_DIMS)})`);

  // Sanity: same-topic docs should be more similar than different-topic docs.
  // Inputs alternate through 10 topics, so doc 0 and doc 10 share a topic, doc 0 and doc 1 do not.
  const sameTopic = cosine(embeddings[0] ?? [], embeddings[10] ?? []);
  const diffTopic = cosine(embeddings[0] ?? [], embeddings[1] ?? []);
  console.log(`cosine same-topic (doc0 vs doc10): ${sameTopic.toFixed(4)}`);
  console.log(`cosine diff-topic (doc0 vs doc1):  ${diffTopic.toFixed(4)}`);

  const dimsOk = dims === TARGET_DIMS;
  const latencyOk = ms < LATENCY_BUDGET_MS;
  const sanityOk = sameTopic > diffTopic;

  console.log('\n=== Spike 4 result ===');
  console.log(`dims == ${String(TARGET_DIMS)}: ${dimsOk ? 'PASS' : 'FAIL'}`);
  console.log(`latency < ${String(LATENCY_BUDGET_MS)}ms: ${latencyOk ? 'PASS' : 'FAIL'}`);
  console.log(`same-topic cosine > diff-topic cosine: ${sanityOk ? 'PASS' : 'FAIL'}`);

  const ok = dimsOk && latencyOk && sanityOk;
  console.log(`\nspike 4 ${ok ? 'PASSED' : 'FAILED'}`);
  if (!ok) process.exit(1);
};

main().catch((err: unknown) => {
  console.error('spike 4 failed:', err);
  process.exit(1);
});
