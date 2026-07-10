/**
 * Sonnet/Haiku-powered TL;DR for source bodies. Briefs are cached at
 * <vault>/.xscraper/briefs/<source_id>.txt so re-rendering a source
 * detail page doesn't re-bill the API.
 *
 * Auth: reads ANTHROPIC_API_KEY from env. The CLI loads it from
 * ~/.config/x-scraper/.env at startup; this lib expects the env var
 * already in process.env (set by next.config or shell).
 */

import 'server-only';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import Anthropic from '@anthropic-ai/sdk';

import { resolveWebUiConfig } from './config';

const BRIEF_DIR = path.join('.xscraper', 'briefs');
const BRIEF_MODEL = 'claude-haiku-4-5-20251001';
const BRIEF_MAX_TOKENS = 350;
const BRIEF_BODY_INPUT_CAP = 8_000;

const briefPath = (sourceId: string): string =>
  path.join(resolveWebUiConfig().vaultDir, BRIEF_DIR, `${sourceId}.txt`);

const ensureDir = async (file: string): Promise<void> => {
  await fs.mkdir(path.dirname(file), { recursive: true });
};

/** Lazy-load the Anthropic key from process.env or the CLI's .env file. */
let cachedKey: string | undefined;
const resolveAnthropicKey = async (): Promise<string | null> => {
  if (cachedKey !== undefined) return cachedKey;
  if (process.env.ANTHROPIC_API_KEY !== undefined) {
    cachedKey = process.env.ANTHROPIC_API_KEY;
    return cachedKey;
  }
  // Fallback: read the CLI's env file directly. Single-user app, the
  // file is chmod 600 anyway.
  try {
    const envPath = path.join(os.homedir(), '.config', 'x-scraper', '.env');
    const raw = await fs.readFile(envPath, 'utf8');
    const match = raw.match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (match !== null && match[1] !== undefined) {
      cachedKey = match[1].trim().replace(/^"|"$/g, '');
      return cachedKey;
    }
  } catch {
    /* skip */
  }
  return null;
};

export const readBrief = async (sourceId: string): Promise<string | null> => {
  try {
    const raw = await fs.readFile(briefPath(sourceId), 'utf8');
    return raw.trim();
  } catch {
    return null;
  }
};

export interface GenerateBriefInput {
  sourceId: string;
  contentType: 'tweet' | 'article' | 'repo' | 'video' | 'pdf';
  body: string;
  url: string;
  /** Optional override — defaults to claude-haiku-4-5 (cheap). */
  model?: string;
}

const buildPrompt = (input: GenerateBriefInput): string => {
  const trimmed =
    input.body.length > BRIEF_BODY_INPUT_CAP
      ? `${input.body.slice(0, BRIEF_BODY_INPUT_CAP)}\n\n[…truncated]`
      : input.body;
  if (input.contentType === 'tweet') {
    return `The user bookmarked this tweet. Summarize what's worth remembering in 1–2 short sentences. No fluff, no preamble. Just the takeaway.\n\nTweet:\n${trimmed}`;
  }
  if (input.contentType === 'repo') {
    return `The user bookmarked this GitHub repo. In 2–3 bullets, summarize: what it does, who it's for, and one notable thing about its approach. Plain text, no preamble.\n\nREADME:\n${trimmed}`;
  }
  return `The user bookmarked this article. Summarize in 3 bullets: (1) the core thesis or finding, (2) the most useful concrete point, (3) why it might matter to a software/AI builder. Plain text, no preamble.\n\nArticle:\n${trimmed}`;
};

export const generateBrief = async (
  input: GenerateBriefInput,
): Promise<{ brief: string; cached: boolean }> => {
  const cached = await readBrief(input.sourceId);
  if (cached !== null) return { brief: cached, cached: true };

  const apiKey = await resolveAnthropicKey();
  if (apiKey === null) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: input.model ?? BRIEF_MODEL,
    max_tokens: BRIEF_MAX_TOKENS,
    messages: [{ role: 'user', content: buildPrompt(input) }],
  });

  const text = result.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  if (text.length === 0) {
    throw new Error(
      `brief: model returned empty response (stop_reason=${result.stop_reason ?? 'unknown'})`,
    );
  }

  const target = briefPath(input.sourceId);
  await ensureDir(target);
  await fs.writeFile(target, text, 'utf8');

  return { brief: text, cached: false };
};
