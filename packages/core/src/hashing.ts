import { createHash } from 'node:crypto';

const HASH_LENGTH = 16;

/**
 * Content hash used to detect when a Source has materially changed and
 * needs re-extraction. Trims whitespace and normalizes line endings so
 * a re-fetch with cosmetic differences doesn't trigger a re-run.
 */
export const contentHash = (body: string): string => {
  const normalized = body.replace(/\r\n/g, '\n').trim();
  return createHash('sha256').update(normalized).digest('hex').slice(0, HASH_LENGTH);
};
