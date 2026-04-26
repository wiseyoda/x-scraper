/**
 * Extractor — runs the LLM with the versioned extraction prompt and
 * validates the output against the Zod schema.
 *
 * Failure modes:
 *   - LLM throws TRUNCATED → bubble up. Caller bumps max_tokens.
 *   - JSON parse fails → repair attempt with the error text appended.
 *   - Schema validation fails → repair attempt with the validation issues.
 *   - Repair budget exhausted → throw ExtractorError('VALIDATION_FAILED').
 */

import type { LlmProvider } from '@x-scraper/llm';

import {
  DEFAULT_MAX_REPAIR_ATTEMPTS,
  EXTRACTION_PROMPT_VERSION,
  MAX_REPORTED_VALIDATION_ISSUES,
} from './constants.js';
import { EXTRACTION_REPAIR_HINT, EXTRACTION_SYSTEM_V1 } from './prompts/extraction-v1.js';
import { type ExtractionResult, ExtractionResultSchema } from './schemas.js';

export interface ExtractInput {
  /** Raw source body (already cleaned/Readability-ed by the ingestor). */
  body: string;
  /** Optional title to give the model context. */
  title?: string;
  /** Optional source URL. */
  sourceUrl?: string;
  /** Override the default model (Sonnet) or max_tokens (16k). */
  model?: string;
  maxTokens?: number;
  /** Cost-ledger attribution. */
  cost?: {
    runId?: string;
    jobId?: string;
    stage?: string;
  };
  /** Override the repair budget (default 2). */
  maxRepairAttempts?: number;
}

export interface ExtractMeta {
  promptVersion: number;
  modelUsed: string;
  attempts: number;
  costUsd: number;
}

export interface ExtractResult {
  data: ExtractionResult;
  meta: ExtractMeta;
}

export type ExtractorErrorCode = 'VALIDATION_FAILED' | 'JSON_PARSE' | 'PROVIDER' | 'UNKNOWN';

export class ExtractorError extends Error {
  public readonly code: ExtractorErrorCode;
  public override readonly cause: unknown;
  public readonly attempts: number;

  constructor(message: string, code: ExtractorErrorCode, attempts: number, cause?: unknown) {
    super(message);
    this.name = 'ExtractorError';
    this.code = code;
    this.cause = cause;
    this.attempts = attempts;
  }
}

const stripFences = (raw: string): string =>
  raw
    .trim()
    .replace(/^```(?:json)?\n?/i, '')
    .replace(/\n?```$/i, '');

const buildUserContent = (input: ExtractInput): string => {
  const lines: string[] = [];
  if (input.title !== undefined) lines.push(`# ${input.title}\n`);
  if (input.sourceUrl !== undefined) lines.push(`Source: ${input.sourceUrl}\n`);
  lines.push(input.body);
  return lines.join('\n');
};

const summarizeIssues = (errorMessage: string): string =>
  errorMessage.split('\n').slice(0, MAX_REPORTED_VALIDATION_ISSUES).join('; ');

export const extract = async (llm: LlmProvider, input: ExtractInput): Promise<ExtractResult> => {
  const userContent = buildUserContent(input);
  const maxAttempts = (input.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS) + 1;
  let lastError = '';
  let totalCost = 0;
  let modelUsed = '';

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const messages: { role: 'user' | 'assistant'; content: string }[] = [
      { role: 'user', content: userContent },
    ];
    if (attempt > 0) {
      messages.push({ role: 'user', content: EXTRACTION_REPAIR_HINT(lastError) });
    }

    const reply = await llm.complete({
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
      system: [{ text: EXTRACTION_SYSTEM_V1 }],
      messages,
      ...(input.cost === undefined ? {} : { cost: input.cost }),
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

    const result = ExtractionResultSchema.safeParse(parsed);
    if (result.success) {
      return {
        data: result.data,
        meta: {
          promptVersion: EXTRACTION_PROMPT_VERSION,
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

  throw new ExtractorError(
    `extraction failed after ${String(maxAttempts)} attempts: ${lastError}`,
    'VALIDATION_FAILED',
    maxAttempts,
  );
};
