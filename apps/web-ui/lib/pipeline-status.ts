/**
 * Progressive pipeline status + fast primary text for inbox rows.
 * Pure — unit-tested without network.
 */

export type PipelineStage =
  | 'captured'
  | 'extracted'
  | 'synthesized'
  | 'synced'
  | 'failed'
  | 'unknown';

export interface PipelineStatusInput {
  /** Ledger status when known: new | synced | failed. */
  ledgerStatus?: string | null;
  /** Claims extracted for this source. */
  claimCount?: number;
  /** Ideas that list this source. */
  ideaCount?: number;
}

/**
 * Derive a progressive stage for UI chips.
 * captured → extracted → synthesized (or failed / synced as terminal).
 */
export const derivePipelineStage = (input: PipelineStatusInput): PipelineStage => {
  const ledger = input.ledgerStatus ?? null;
  if (ledger === 'failed') return 'failed';
  const claims = input.claimCount ?? 0;
  const ideas = input.ideaCount ?? 0;
  if (ideas > 0) return 'synthesized';
  // Claims or a finished ledger sync both mean extract has run (or the
  // source is past capture). Prefer "extracted" over bare "synced".
  if (claims > 0 || ledger === 'synced') return 'extracted';
  if (ledger === 'new') return 'captured';
  return 'unknown';
};

export const PIPELINE_STAGE_LABEL: Record<PipelineStage, string> = {
  captured: 'captured',
  extracted: 'extracted',
  synthesized: 'in ideas',
  synced: 'synced',
  failed: 'failed',
  unknown: 'unknown',
};

/**
 * Fast primary line from bookmark payload before vault extract finishes.
 * Prefers tweet text, then byline, then short URL — never requires claims.
 */
export const fastPrimaryFromBookmark = (input: {
  text?: string | null;
  byline?: string | null;
  url: string;
}): { primary: string; secondary: string; fromPayload: boolean } => {
  const text = input.text?.trim() ?? '';
  const byline = input.byline?.trim().replace(/^@/, '') ?? '';
  const secondary = input.url;
  if (text.length > 0 && !/^https?:\/\//i.test(text)) {
    const primary = text.length > 280 ? `${text.slice(0, 280).trimEnd()}…` : text;
    return { primary, secondary, fromPayload: true };
  }
  if (byline.length > 0) {
    return { primary: `@${byline}`, secondary, fromPayload: true };
  }
  try {
    const u = new URL(input.url);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    const label = `${host}${path}`;
    return {
      primary: label.length > 80 ? `${label.slice(0, 80)}…` : label,
      secondary,
      fromPayload: false,
    };
  } catch {
    return { primary: input.url, secondary: input.url, fromPayload: false };
  }
};
