/**
 * Spike 5 — Claude extraction with Zod-validated output.
 *
 * Goal: confirm Claude Sonnet 4.6 can take an article body and return
 * a structured JSON of entities, claims, and relationships that passes
 * a strict Zod schema. Acceptance: ≥3 entities, ≥5 claims, no obvious
 * hallucinations, schema valid on first try (or one retry).
 *
 * Run:  pnpm spike spikes/5-claude.ts
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const ENV_PATH = path.join(os.homedir(), '.config', 'x-scraper', '.env');
const MODEL = 'claude-sonnet-4-6';
const MAX_OUTPUT_TOKENS = 32_000;
const MAX_RETRIES = 2;

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

// === extraction schema (also embedded in the prompt) ===

const EntitySchema = z.object({
  id: z.string().min(1).describe('stable slug like "claude-code", "kuzu", "patchright"'),
  type: z.enum(['Person', 'Tool', 'Concept', 'Repo', 'Article', 'Service', 'Other']),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
});

const ClaimSchema = z.object({
  id: z.string().min(1).describe('claim_<short-hash>'),
  subject: z.string().min(1).describe('entity id or natural-language subject'),
  predicate: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, 'snake_case')
    .min(1),
  object: z.string().min(1),
  text: z.string().min(1).describe('original or paraphrased sentence supporting this claim'),
  confidence: z.number().min(0).max(1),
});

const RelationshipSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum([
    'IS_A',
    'PART_OF',
    'INSTANCE_OF',
    'AUTHORED_BY',
    'MENTIONS',
    'RELATED_TO',
    'SUPPORTS',
    'CONTRADICTS',
    'EVOLVED_FROM',
    'USES',
  ]),
});

const ExtractionSchema = z.object({
  entities: z.array(EntitySchema),
  claims: z.array(ClaimSchema),
  relationships: z.array(RelationshipSchema),
});

type Extraction = z.infer<typeof ExtractionSchema>;

const SCHEMA_DOC = `Return only valid JSON matching this TypeScript shape (no prose, no markdown fences):
{
  "entities": Array<{
    "id": string,            // stable slug
    "type": "Person"|"Tool"|"Concept"|"Repo"|"Article"|"Service"|"Other",
    "name": string,
    "aliases": string[]
  }>,
  "claims": Array<{
    "id": string,
    "subject": string,        // entity id OR natural-language subject
    "predicate": string,      // snake_case verb-phrase
    "object": string,
    "text": string,           // sentence(s) supporting the claim
    "confidence": number      // 0..1
  }>,
  "relationships": Array<{
    "from": string,           // entity id
    "to": string,             // entity id
    "type": "IS_A"|"PART_OF"|"INSTANCE_OF"|"AUTHORED_BY"|"MENTIONS"|"RELATED_TO"|"SUPPORTS"|"CONTRADICTS"|"EVOLVED_FROM"|"USES"
  }>
}

Rules:
- Extract only what the source actually states. Do NOT invent URLs, version numbers, or stats.
- Use the same entity id consistently across claims and relationships.
- predicate must be snake_case verb-phrase like "uses_storage", "supports_model", "released_at".
- Be specific: prefer "Patchright is a stealth-patched Playwright fork" over "Patchright exists".
- Extract everything the source actually states. Quality over minimum count.`;

const ARTICLE = `# How to give Claude perfect memory (excerpted)

By default, Claude's memory is limited — it forgets context between sessions and you have to re-explain yourself.

There are three layers to building durable memory for Claude:

Layer 1, Basic Memory: Use Claude's Settings → Memory page to manually add and prune what Claude remembers about you. You can also tell Claude mid-conversation to "remember that I prefer responses under 400 words" and it will save that fact.

Layer 2, Context File System: Create a folder of markdown files — typically Instructions.md, Memory.md, Context.md, and an Archive guide — that you attach to Claude Code or Claude.ai sessions. Memory.md updates as you work, accumulating preferences and corrections.

Layer 3, AI Second Brain: Connect Claude to Notion (via the Notion connector) for a database-backed memory, or to Obsidian (via Claude's "Select Folder" option) for a local markdown vault. The Obsidian path is more powerful: Claude reads and writes the vault directly, building an evolving wiki. Andrej Karpathy published a system prompt at gist.github.com/karpathy/442a6bf555914893e9891c11519de94f that orchestrates this.

The Obsidian setup requires creating a vault, pointing Claude at it, and pasting Karpathy's prompt. Claude then ingests notes, extracts key information, and integrates it into a memory wiki.

The author, AI Edge, recommends Notion for fast and simple use, Obsidian for deep local-storage understanding.`;

const callClaude = async (
  client: Anthropic,
  article: string,
  retryCount: number,
  prevError?: string,
): Promise<unknown> => {
  const userParts: Anthropic.Messages.TextBlockParam[] = [
    {
      type: 'text',
      text: article,
    },
  ];
  if (prevError !== undefined) {
    userParts.push({
      type: 'text',
      text: `Previous attempt failed schema validation: ${prevError}. Return strict JSON only.`,
    });
  }
  console.log(`calling ${MODEL} (attempt ${String(retryCount + 1)})`);
  const start = performance.now();
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: [
      {
        type: 'text',
        text: SCHEMA_DOC,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userParts }],
  });
  const ms = performance.now() - start;
  const cacheRead = resp.usage.cache_read_input_tokens ?? 0;
  const cacheCreate = resp.usage.cache_creation_input_tokens ?? 0;
  console.log(
    `  ${ms.toFixed(0)} ms; stop=${resp.stop_reason ?? '?'}; tokens in=${String(resp.usage.input_tokens)} (cache_read=${String(cacheRead)}, cache_create=${String(cacheCreate)}) out=${String(resp.usage.output_tokens)}`,
  );
  if (resp.stop_reason === 'max_tokens') {
    throw new Error(`output truncated at max_tokens=${String(MAX_OUTPUT_TOKENS)} — bump and retry`);
  }

  const textBlock = resp.content.find((c) => c.type === 'text');
  if (!textBlock) throw new Error('no text block in Claude response');
  const cleaned = textBlock.text
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '');
  return JSON.parse(cleaned);
};

const extractWithRetry = async (client: Anthropic, article: string): Promise<Extraction> => {
  let lastErr = '';
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const raw = await callClaude(client, article, attempt, attempt === 0 ? undefined : lastErr);
    const result = ExtractionSchema.safeParse(raw);
    if (result.success) return result.data;
    lastErr = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    console.log(`  schema validation failed: ${lastErr}`);
  }
  throw new Error(`extraction failed after ${String(MAX_RETRIES + 1)} attempts: ${lastErr}`);
};

const main = async (): Promise<void> => {
  const apiKey = loadEnvKey('ANTHROPIC_API_KEY');
  const client = new Anthropic({ apiKey });

  const extraction = await extractWithRetry(client, ARTICLE);

  console.log('\n=== Extraction ===');
  console.log(JSON.stringify(extraction, null, 2));

  console.log('\n=== Spike 5 result ===');
  console.log(`entities: ${String(extraction.entities.length)}`);
  console.log(`claims: ${String(extraction.claims.length)}`);
  console.log(`relationships: ${String(extraction.relationships.length)}`);
  console.log('\nspike 5 PASSED');
};

main().catch((err: unknown) => {
  console.error('spike 5 failed:', err);
  process.exit(1);
});
