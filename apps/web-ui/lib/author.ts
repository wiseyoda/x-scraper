/**
 * Author derivation. Authors aren't first-class entities in the vault
 * yet — we synthesize them from URL patterns + capture-cache bylines.
 * That's enough for the dashboard to group bookmarks by who posted
 * them ("From @karpathy: 12 bookmarks") without changing the corpus.
 */

import 'server-only';

export interface AuthorRef {
  /** Lowercase handle, no @. */
  handle: string;
  /** Display form (preserves any case from the original). */
  display: string;
  /** Where we derived it. */
  source: 'x.com' | 'github.com' | 'capture' | 'unknown';
}

/**
 * Pull the author from a URL when the host is a platform with a clear
 * /HANDLE/ convention. Returns null for hosts that don't have one
 * (most articles).
 */
export const authorFromUrl = (url: string): AuthorRef | null => {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const segments = u.pathname.split('/').filter((s) => s.length > 0);
    const first = segments[0];
    if (first === undefined || first.length === 0) return null;
    if (host === 'x.com' || host === 'twitter.com') {
      // /HANDLE/status/...
      if (first === 'i' || first === 'home' || first === 'search') return null;
      return { handle: first.toLowerCase(), display: first, source: 'x.com' };
    }
    if (host === 'github.com') {
      // /OWNER/REPO
      if (first === 'orgs' || first === 'topics' || first === 'search') return null;
      return { handle: first.toLowerCase(), display: first, source: 'github.com' };
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Strict handle slug for routing — lowercase + alnum/dash/underscore.
 * Anything stranger gets URI-encoded.
 */
export const handleSlug = (handle: string): string => {
  const lower = handle.toLowerCase();
  if (/^[a-z0-9_-]+$/.test(lower)) return lower;
  return encodeURIComponent(lower);
};
