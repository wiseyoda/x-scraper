/**
 * Drive the LLM against a cluster of claims to produce an IdeaDraft.
 *
 * Same shape as @x-scraper/extractor — versioned system prompt, JSON
 * output validated by Zod, repair budget for malformed output.
 */

import type { LlmProvider } from '@x-scraper/llm';

import { DEFAULT_SYNTHESIS_MAX_TOKENS, SYNTHESIS_PROMPT_VERSION } from './constants.js';
import { SYNTHESIS_REPAIR_HINT_V1, SYNTHESIS_SYSTEM_V1 } from './prompts.js';
import { IdeaDraftSchema, type IdeaDraftValidated } from './schemas.js';
import type { ClaimCluster, IdeaDraft } from './types.js';

const DEFAULT_MAX_REPAIR_ATTEMPTS = 2;
const MAX_REPORTED_VALIDATION_ISSUES = 5;

export class SynthesizerError extends Error {
  public readonly code: 'VALIDATION_FAILED' | 'JSON_PARSE' | 'PROVIDER';
  public readonly attempts: number;
  public readonly anchor: string;

  constructor(
    message: string,
    code: 'VALIDATION_FAILED' | 'JSON_PARSE' | 'PROVIDER',
    attempts: number,
    anchor: string,
  ) {
    super(message);
    this.name = 'SynthesizerError';
    this.code = code;
    this.attempts = attempts;
    this.anchor = anchor;
  }
}

const stripFences = (raw: string): string =>
  raw
    .trim()
    .replace(/^```(?:json)?\n?/i, '')
    .replace(/\n?```$/i, '');

const buildUserContent = (cluster: ClaimCluster): string => {
  const lines: string[] = [];
  lines.push(`Subject anchor: ${cluster.anchor}`);
  lines.push(`Sources: ${cluster.sourceIds.length.toString()}`);
  lines.push('');
  lines.push('Claims (from L0 atoms):');
  for (let i = 0; i < cluster.claims.length; i += 1) {
    const c = cluster.claims[i];
    if (c === undefined) continue;
    lines.push(
      `${(i + 1).toString()}. [${c.sourceId}] subject="${c.subject}" predicate=${c.predicate} object="${c.object}" confidence=${c.confidence.toFixed(2)} text="${c.text}"`,
    );
  }
  lines.push('');
  lines.push('Synthesize a single L1 idea. Return JSON only.');
  return lines.join('\n');
};

export interface SynthesizeInput {
  cluster: ClaimCluster;
  model?: string;
  maxTokens?: number;
  maxRepairAttempts?: number;
  cost?: { runId?: string };
}

export interface SynthesizeMeta {
  promptVersion: number;
  modelUsed: string;
  attempts: number;
  costUsd: number;
}

export interface SynthesizeOutput {
  draft: IdeaDraft;
  meta: SynthesizeMeta;
}

const summarizeIssues = (errorMessage: string): string =>
  errorMessage.split('\n').slice(0, MAX_REPORTED_VALIDATION_ISSUES).join('; ');

export const synthesizeCluster = async (
  llm: LlmProvider,
  input: SynthesizeInput,
): Promise<SynthesizeOutput> => {
  const userContent = buildUserContent(input.cluster);
  const maxAttempts = (input.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS) + 1;
  let lastError = '';
  let totalCost = 0;
  let modelUsed = '';

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const messages: { role: 'user' | 'assistant'; content: string }[] = [
      { role: 'user', content: userContent },
    ];
    if (attempt > 0) {
      messages.push({ role: 'user', content: SYNTHESIS_REPAIR_HINT_V1(lastError) });
    }
    const reply = await llm.complete({
      ...(input.model === undefined ? {} : { model: input.model }),
      maxTokens: input.maxTokens ?? DEFAULT_SYNTHESIS_MAX_TOKENS,
      system: [{ text: SYNTHESIS_SYSTEM_V1 }],
      messages,
    });
    totalCost += reply.costUsd;
    modelUsed = reply.modelUsed;

    const cleaned = stripFences(reply.text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      lastError = `JSON.parse: ${err instanceof Error ? err.message : String(err)}`;
      continue;
    }
    const result = IdeaDraftSchema.safeParse(parsed);
    if (result.success) {
      const validated: IdeaDraftValidated = result.data;
      return {
        draft: {
          title: validated.title,
          body: validated.body,
          confidence: validated.confidence,
          caveat: validated.caveat,
        },
        meta: {
          promptVersion: SYNTHESIS_PROMPT_VERSION,
          modelUsed,
          attempts: attempt + 1,
          costUsd: totalCost,
        },
      };
    }
    lastError = summarizeIssues(
      result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'),
    );
  }

  throw new SynthesizerError(
    `synthesis failed after ${String(maxAttempts)} attempts: ${lastError}`,
    'VALIDATION_FAILED',
    maxAttempts,
    input.cluster.anchor,
  );
};
