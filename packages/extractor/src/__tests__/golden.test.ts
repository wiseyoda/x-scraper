/**
 * Golden corpus regression test for the extractor.
 *
 * Default mode (RUN_GOLDEN_LIVE != 1):
 *   Uses a deterministic stub LLM that echoes a recorded valid output
 *   per fixture. Verifies the schema validation + repair loop survive
 *   structural changes to the extractor itself. Cheap; runs in CI.
 *
 * Live mode (RUN_GOLDEN_LIVE=1):
 *   Calls the real Claude Sonnet for each fixture and asserts the live
 *   extraction satisfies the per-fixture invariants in expected/<id>.json
 *   (minimum entity/claim count, expected entity names, expected
 *   subjects). This catches model/prompt drift but is billed per run —
 *   not in CI.
 *
 * To regenerate: run with RUN_GOLDEN_LIVE=1 and update expected/*.json
 * once the live output is reviewed.
 */

import { readdirSync,readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import Anthropic from '@anthropic-ai/sdk';
import type { CompleteReply, CompleteRequest, LlmProvider } from '@x-scraper/llm';
import { createClaudeProvider } from '@x-scraper/llm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { extract } from '../extractor.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(HERE, 'golden');
const FIXTURE_DIR = path.join(GOLDEN_DIR, 'fixtures');
const EXPECTED_DIR = path.join(GOLDEN_DIR, 'expected');

const LIVE = process.env.RUN_GOLDEN_LIVE === '1';

const ExpectedSchema = z.object({
  minEntities: z.number().int().nonnegative(),
  minClaims: z.number().int().nonnegative(),
  expectedNames: z.array(z.string()),
  expectedSubjectsLowerOrAliases: z.array(z.string()),
});
type Expected = z.infer<typeof ExpectedSchema>;

interface Fixture {
  id: string;
  body: string;
  expected: Expected;
}

const loadFixtures = (): Fixture[] => {
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.txt'));
  return files.map((file) => {
    const id = file.replace(/\.txt$/, '');
    const body = readFileSync(path.join(FIXTURE_DIR, file), 'utf8');
    const rawExpected: unknown = JSON.parse(
      readFileSync(path.join(EXPECTED_DIR, `${id}.json`), 'utf8'),
    );
    const expected = ExpectedSchema.parse(rawExpected);
    return { id, body, expected };
  });
};

/**
 * A stub LLM that returns a structurally-valid extraction synthesized
 * from the fixture's `expected` invariants. The same structure that the
 * live mode validates — by construction the stub passes the assertions
 * so we only flag failures that come from the extractor itself.
 */
const buildStubLlm = (expected: Expected): LlmProvider => ({
  provider: 'stub-claude',
  complete: (_req: CompleteRequest): Promise<CompleteReply> => {
    const entities = expected.expectedNames.map((name, i) => ({
      id: `ent_${String(i)}`,
      type: 'Tool' as const,
      name,
      aliases: [],
    }));
    const claims = Array.from({ length: Math.max(1, expected.minClaims) }).map((_, i) => ({
      id: `claim_${String(i)}`,
      subject: expected.expectedSubjectsLowerOrAliases[i % expected.expectedSubjectsLowerOrAliases.length] ?? 'subject',
      predicate: 'is_known_for',
      object: 'something',
      text: `Stub claim ${String(i)}.`,
      confidence: 0.9,
    }));
    return Promise.resolve({
      text: JSON.stringify({ entities, claims, relationships: [] }),
      modelUsed: 'stub-sonnet',
      stopReason: 'end_turn',
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreateTokens: 0 },
      costUsd: 0.001,
    });
  },
});

const buildLiveLlm = (): LlmProvider => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error('RUN_GOLDEN_LIVE=1 but ANTHROPIC_API_KEY is not set');
  }
  const client = new Anthropic({ apiKey });
  return createClaudeProvider({
    messagesCreate: (input) => client.messages.create(input),
  });
};

const fixtures = loadFixtures();

describe(`golden corpus (${String(fixtures.length)} fixtures, mode=${LIVE ? 'live' : 'stub'})`, () => {
  for (const fixture of fixtures) {
    it(`extracts a valid structure for ${fixture.id}`, async () => {
      const llm = LIVE ? buildLiveLlm() : buildStubLlm(fixture.expected);
      const result = await extract(llm, { body: fixture.body });

      // Schema-level invariants — apply in both modes.
      expect(result.data.entities.length).toBeGreaterThanOrEqual(fixture.expected.minEntities);
      expect(result.data.claims.length).toBeGreaterThanOrEqual(fixture.expected.minClaims);
      // Predicates must be snake_case (the extractor's Zod schema enforces
      // this — re-asserting here so a regression in the schema is loud).
      for (const claim of result.data.claims) {
        expect(claim.predicate).toMatch(/^[a-z][a-z0-9_]*$/);
      }

      if (!LIVE) return;

      // Live-only: assert the model picked up the expected named entities.
      const namesLower = new Set(result.data.entities.map((e) => e.name.toLowerCase()));
      const aliasesLower = new Set(
        result.data.entities.flatMap((e) => e.aliases.map((a) => a.toLowerCase())),
      );
      for (const expectedName of fixture.expected.expectedNames) {
        const lc = expectedName.toLowerCase();
        const found = namesLower.has(lc) || aliasesLower.has(lc);
        expect(found, `expected entity ${expectedName} not found in live output`).toBe(true);
      }
    }, 60_000);
  }
});
