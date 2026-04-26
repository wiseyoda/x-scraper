/**
 * Weekly digest generation.
 *
 * The digest is a markdown file at `digests/<iso-week>.md` summarizing
 * everything ingested in the prior 7 days. The summary itself is
 * produced by an LlmProvider; if the caller doesn't supply one, we emit
 * a deterministic plain-list digest (useful for tests and offline mode).
 */

import type { LlmProvider } from '@x-scraper/llm';
import type { VaultListEntry, VaultStore } from '@x-scraper/vault';

import { formatIsoWeek, isoWeekStart } from './iso-week.js';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1_000;
const SUMMARY_MAX_TOKENS = 4_000;

const DIGEST_SYSTEM = `You write a Monday-morning briefing on a knowledge graph.
Given a list of newly-ingested sources and claims from the past week,
write a 200-400-word markdown summary highlighting:
  - the most important new claims, grouped by topic
  - any contradictions worth investigating
  - a one-line "what to read first" pointer
Use plain markdown. No fences. No preamble.`;

export interface BuildDigestInput {
  /** "Now" — usually new Date(), injectable for tests. */
  now: Date;
  /** Optional LLM provider; without it we emit a deterministic listing. */
  llm?: LlmProvider;
}

export interface DigestArtifact {
  /** ISO week label for the file: e.g. 2026-W17. */
  weekLabel: string;
  /** Window start (Monday, UTC). */
  windowStart: string;
  /** Window end (now). */
  windowEnd: string;
  /** Sources written into the vault during the window. */
  sourceCount: number;
  /** Claims written into the vault during the window. */
  claimCount: number;
  /** Markdown body for the digest file. */
  body: string;
}

const DEFAULT_PREVIEW_CHARS = 200;

const formatDeterministicBody = (
  weekLabel: string,
  sources: VaultListEntry[],
  claims: VaultListEntry[],
): string => {
  const lines: string[] = [`# Digest ${weekLabel}`, ''];
  lines.push(`**Sources** (${String(sources.length)}):`, '');
  for (const s of sources) lines.push(`- \`${s.id}\` — ${s.relativePath}`);
  lines.push('', `**Claims** (${String(claims.length)}):`, '');
  for (const c of claims) lines.push(`- \`${c.id}\` — ${c.relativePath}`);
  lines.push('');
  return lines.join('\n');
};

const summarizeViaLlm = async (
  llm: LlmProvider,
  weekLabel: string,
  sources: VaultListEntry[],
  claims: VaultListEntry[],
): Promise<string> => {
  const userParts: string[] = [`Week: ${weekLabel}`, ''];
  userParts.push(`Sources (${String(sources.length)}):`);
  for (const s of sources) userParts.push(`- ${s.id} (${s.relativePath})`);
  userParts.push('', `Claims (${String(claims.length)}):`);
  for (const c of claims) userParts.push(`- ${c.id} (${c.relativePath})`);
  const reply = await llm.complete({
    maxTokens: SUMMARY_MAX_TOKENS,
    system: [{ text: DIGEST_SYSTEM }],
    messages: [{ role: 'user', content: userParts.join('\n').slice(0, 32_000) }],
  });
  return `# Digest ${weekLabel}\n\n${reply.text.trim()}\n`;
};

export const buildDigest = async (
  vault: VaultStore,
  input: BuildDigestInput,
): Promise<DigestArtifact> => {
  const start = isoWeekStart(new Date(input.now.getTime() - ONE_WEEK_MS));
  const sources = (await vault.list('Source')).filter((e) => e.mtime >= start);
  const claims = (await vault.list('Claim')).filter((e) => e.mtime >= start);
  const weekLabel = formatIsoWeek(input.now);
  const body =
    input.llm === undefined
      ? formatDeterministicBody(weekLabel, sources, claims)
      : await summarizeViaLlm(input.llm, weekLabel, sources, claims);
  return {
    weekLabel,
    windowStart: start.toISOString(),
    windowEnd: input.now.toISOString(),
    sourceCount: sources.length,
    claimCount: claims.length,
    body,
  };
};

/** Used for log/preview output. */
export const previewBody = (body: string): string =>
  body.length > DEFAULT_PREVIEW_CHARS ? `${body.slice(0, DEFAULT_PREVIEW_CHARS).trim()}…` : body;
