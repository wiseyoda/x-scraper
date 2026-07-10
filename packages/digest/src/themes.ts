/**
 * Theme-forward digest assembly — pure functions for tests + offline mode.
 */

export interface IdeaThemeInput {
  id: string;
  subject: string;
  status: string;
  sourceIds: string[];
  updatedAt: string;
}

export interface DigestTheme {
  /** Theme label (idea subject). */
  subject: string;
  ideaId: string;
  status: string;
  /** Sources in window that attach to this idea. */
  linkedSourceIds: string[];
  /** All sources on the idea (may include older). */
  sourceIds: string[];
}

/**
 * Group recent activity into themes keyed by Idea subjects that touch
 * the window's source set (or were updated in-window).
 */
export const assembleThemes = (
  ideas: IdeaThemeInput[],
  recentSourceIds: Set<string>,
  recentIdeaIds: Set<string>,
): DigestTheme[] => {
  const themes: DigestTheme[] = [];
  for (const idea of ideas) {
    if (idea.status === 'rejected') continue;
    const linked = idea.sourceIds.filter((s) => recentSourceIds.has(s));
    const touched = linked.length > 0 || recentIdeaIds.has(idea.id);
    if (!touched) continue;
    themes.push({
      subject: idea.subject,
      ideaId: idea.id,
      status: idea.status,
      linkedSourceIds: linked,
      sourceIds: idea.sourceIds,
    });
  }
  themes.sort((a, b) => {
    if (b.linkedSourceIds.length !== a.linkedSourceIds.length) {
      return b.linkedSourceIds.length - a.linkedSourceIds.length;
    }
    return a.subject.localeCompare(b.subject);
  });
  return themes;
};

export const formatThemeForwardBody = (
  weekLabel: string,
  themes: DigestTheme[],
  sourceIds: string[],
  claimIds: string[],
): string => {
  const lines: string[] = [`# Digest ${weekLabel}`, ''];
  lines.push(
    `Theme-forward briefing: **${String(themes.length)} themes**, **${String(sourceIds.length)} sources**, **${String(claimIds.length)} claims**.`,
    '',
  );
  lines.push('## Themes', '');
  if (themes.length === 0) {
    lines.push('_No idea themes touched this window — raw inventory below._', '');
  } else {
    for (const t of themes) {
      lines.push(`### ${t.subject}`);
      lines.push(`- Idea: \`${t.ideaId}\` (${t.status})`);
      if (t.linkedSourceIds.length > 0) {
        lines.push(
          `- Linked sources this window: ${t.linkedSourceIds.map((id) => `\`${id}\``).join(', ')}`,
        );
      } else {
        lines.push(`- Updated this window (sources: ${String(t.sourceIds.length)} total)`);
      }
      lines.push('');
    }
  }
  lines.push('## Sources', '');
  for (const id of sourceIds) lines.push(`- \`${id}\``);
  if (sourceIds.length === 0) lines.push('- (none)');
  lines.push('', '## Claims', '');
  for (const id of claimIds.slice(0, 40)) lines.push(`- \`${id}\``);
  if (claimIds.length === 0) lines.push('- (none)');
  if (claimIds.length > 40) lines.push(`- … +${String(claimIds.length - 40)} more`);
  lines.push('');
  return lines.join('\n');
};
