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

import { formatIsoWeek } from './iso-week.js';
import { assembleThemes, formatThemeForwardBody, type IdeaThemeInput } from './themes.js';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1_000;
const SUMMARY_MAX_TOKENS = 4_000;
/** Hard cap to keep the LLM prompt under sane token budget. */
const PROMPT_BUDGET_CHARS = 24_000;
const PER_RECORD_BUDGET_CHARS = 800;

const DIGEST_SYSTEM = `You write a theme-forward personal research briefing for someone who bookmarks technical posts on X.
Given themes (ideas), sources, and claims from the past week, write 200-400 words of markdown that:
  - opens with 3-7 named themes (use idea subjects) and why they matter
  - links each theme to idea ids and source ids when provided (use backticks like \`idea_abc\`)
  - notes open tensions or contradictions
  - ends with a one-line "what to read first"
Do NOT only list counts. Prefer narrative themes over tallies.
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
  /** Window start (UTC; exactly 7 days before windowEnd). */
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

const clamp = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, max).trim()}…` : s;

interface RecordPreview {
  id: string;
  type: string;
  preview: string;
}

const readPreviews = async (
  vault: VaultStore,
  entries: VaultListEntry[],
): Promise<RecordPreview[]> => {
  const out: RecordPreview[] = [];
  for (const e of entries) {
    try {
      const record = await vault.read(e.id, e.type);
      const fm = record.frontmatter as Record<string, unknown>;
      // For Claim records, the (subject, predicate, object) triple is the
      // semantic content. For everything else, the body excerpt is.
      let semantic = '';
      if (e.type === 'Claim') {
        const s = typeof fm.subject === 'string' ? fm.subject : '';
        const p = typeof fm.predicate === 'string' ? fm.predicate : '';
        const o = typeof fm.object === 'string' ? fm.object : '';
        semantic = `${s} ${p} ${o}`.trim();
      }
      const url = typeof fm.canonical_url === 'string' ? fm.canonical_url : null;
      const title = typeof fm.title === 'string' ? fm.title : null;
      const head = [url, title, semantic].filter((s) => s !== null && s.length > 0).join(' · ');
      const preview = clamp(`${head}\n${record.body.trim()}`.trim(), PER_RECORD_BUDGET_CHARS);
      out.push({ id: e.id, type: e.type, preview });
    } catch {
      // Skip records that won't parse; they shouldn't break the digest.
      continue;
    }
  }
  return out;
};

const summarizeViaLlm = async (
  llm: LlmProvider,
  weekLabel: string,
  sources: RecordPreview[],
  claims: RecordPreview[],
  themeLines: string,
): Promise<string> => {
  const lines: string[] = [`Week: ${weekLabel}`, '', 'Themes:', themeLines, ''];
  lines.push(`Sources (${String(sources.length)}):`);
  for (const s of sources) {
    lines.push(`- [${s.id}]`);
    lines.push(s.preview);
    lines.push('');
  }
  lines.push(`Claims (${String(claims.length)}):`);
  for (const c of claims) {
    lines.push(`- [${c.id}]`);
    lines.push(c.preview);
    lines.push('');
  }
  const userContent = clamp(lines.join('\n'), PROMPT_BUDGET_CHARS);
  const reply = await llm.complete({
    maxTokens: SUMMARY_MAX_TOKENS,
    system: [{ text: DIGEST_SYSTEM }],
    messages: [{ role: 'user', content: userContent }],
  });
  return `# Digest ${weekLabel}\n\n${reply.text.trim()}\n`;
};

export const buildDigest = async (
  vault: VaultStore,
  input: BuildDigestInput,
): Promise<DigestArtifact> => {
  // The window is exactly 7 days ending at `now` — not "the previous
  // ISO week", which can stretch up to 13 days depending on the day of
  // the week we run on.
  const start = new Date(input.now.getTime() - ONE_WEEK_MS);
  const sources = (await vault.list('Source')).filter((e) => e.mtime >= start);
  const claims = (await vault.list('Claim')).filter((e) => e.mtime >= start);
  const recentSourceIds = new Set(sources.map((s) => s.id));
  const ideaEntries = await vault.list('Idea').catch(() => [] as VaultListEntry[]);
  const ideaInputs: IdeaThemeInput[] = [];
  const recentIdeaIds = new Set<string>();
  for (const e of ideaEntries) {
    try {
      const rec = await vault.read(e.id, 'Idea');
      if (rec.frontmatter.type !== 'Idea') continue;
      const fm = rec.frontmatter;
      ideaInputs.push({
        id: fm.id,
        subject: fm.subject,
        status: fm.status,
        sourceIds: fm.sources,
        updatedAt: fm.updated_at,
      });
      if (e.mtime >= start) recentIdeaIds.add(fm.id);
    } catch {
      /* skip */
    }
  }
  const themes = assembleThemes(ideaInputs, recentSourceIds, recentIdeaIds);
  const weekLabel = formatIsoWeek(input.now);
  let body: string;
  if (input.llm === undefined) {
    body = formatThemeForwardBody(
      weekLabel,
      themes,
      sources.map((s) => s.id),
      claims.map((c) => c.id),
    );
  } else {
    const sourcePreviews = await readPreviews(vault, sources);
    const claimPreviews = await readPreviews(vault, claims);
    const themeLines = themes
      .map(
        (t) =>
          `- Theme "${t.subject}" idea=${t.ideaId} status=${t.status} sources_this_window=${t.linkedSourceIds.join(',') || 'none'}`,
      )
      .join('\n');
    body = await summarizeViaLlm(
      input.llm,
      weekLabel,
      sourcePreviews,
      claimPreviews,
      themeLines,
    );
  }
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
