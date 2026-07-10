/**
 * Assemble Idea vault markdown from the structured research-thread contract.
 * Shared by synthesize (LLM path) and tests (fixture drafts).
 */

export interface ResearchThreadDraft {
  title: string;
  thesis: string;
  evidence: string[];
  openQuestions: string[];
  watchFors: string[];
  confidence: number;
  caveat: string | null;
}

/**
 * Format structured fields into the canonical Idea body markdown.
 * Sections are fixed so UI can parse open questions / evidence reliably.
 */
export const formatResearchThreadBody = (draft: ResearchThreadDraft): string => {
  // No H1 — persistIdea prefixes `# ${title}` and Derived from section.
  const lines: string[] = [];
  lines.push('## Thesis', '', draft.thesis.trim(), '');
  lines.push('## Evidence', '');
  if (draft.evidence.length === 0) {
    lines.push('- (none extracted)', '');
  } else {
    for (const e of draft.evidence) {
      lines.push(`- ${e.trim()}`);
    }
    lines.push('');
  }
  lines.push('## Open questions', '');
  if (draft.openQuestions.length === 0) {
    lines.push('- (none)', '');
  } else {
    for (const q of draft.openQuestions) {
      lines.push(`- ${q.trim()}`);
    }
    lines.push('');
  }
  lines.push('## Watch for', '');
  if (draft.watchFors.length === 0) {
    lines.push('- (none)', '');
  } else {
    for (const w of draft.watchFors) {
      lines.push(`- ${w.trim()}`);
    }
    lines.push('');
  }
  // Caveat is appended by persistIdea when non-null — avoid double section.
  return lines.join('\n');
};

/**
 * Parse research-thread sections from an Idea body (best-effort).
 * Used by web-ui idea detail to surface open questions without LLM.
 */
export const parseResearchThreadBody = (
  body: string,
): {
  thesis: string | null;
  evidence: string[];
  openQuestions: string[];
  watchFors: string[];
  caveat: string | null;
} => {
  const section = (name: string): string | null => {
    const re = new RegExp(`## ${name}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'i');
    const m = body.match(re);
    if (m?.[1] === undefined) return null;
    return m[1].trim();
  };
  const bullets = (text: string | null): string[] => {
    if (text === null || text.length === 0) return [];
    return text
      .split('\n')
      .map((l) => l.replace(/^[-*]\s+/, '').trim())
      .filter((l) => l.length > 0 && l !== '(none)' && l !== '(none extracted)');
  };
  return {
    thesis: section('Thesis'),
    evidence: bullets(section('Evidence')),
    openQuestions: bullets(section('Open questions')),
    watchFors: bullets(section('Watch for')),
    caveat: section('Caveat'),
  };
};
