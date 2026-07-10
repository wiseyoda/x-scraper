/**
 * Pure inbox row display derivation.
 *
 * No I/O, no server-only — unit-tested so the primary line is never a
 * raw URL when title, author, or body gist is available.
 */

export interface InboxDisplayInput {
  url: string;
  contentType: string;
  body: string;
  /**
   * Capture/host byline when present (e.g. tweet author from
   * host_metadata.byline). Preferred over URL-derived handle when set.
   */
  byline?: string | null;
}

export interface InboxDisplay {
  /**
   * Primary line for the list card. Prefer title → gist → author cue →
   * host path. Only falls back to the full URL when nothing else exists.
   */
  primary: string;
  /** Always the canonical URL (secondary / mono line). */
  secondary: string;
  /** Body gist for multi-line preview; null when empty or URL-only body. */
  snippet: string | null;
  /** Distinct short title when available (H1, repo name, etc.). */
  title: string | null;
  /** Lowercase handle without @, if known. */
  authorHandle: string | null;
  /** Display form for the author chip. */
  authorDisplay: string | null;
}

const URL_ONLY_LINE = /^https?:\/\/\S+$/i;

const isJunkLine = (l: string): boolean =>
  l.length === 0 ||
  l.startsWith('#') ||
  l.startsWith('---') ||
  l.startsWith('-') ||
  l.startsWith('|') ||
  l.startsWith('Aliases:') ||
  l.startsWith('[[') ||
  l.startsWith('<!--') ||
  l.startsWith('<') ||
  URL_ONLY_LINE.test(l);

/** First non-junk body line suitable as a human gist. */
export const firstBodyLine = (body: string): string | null => {
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !isJunkLine(l));
  if (lines.length === 0) return null;
  const meaty = lines.find((l) => l.length >= 40) ?? lines[0];
  if (meaty === undefined) return null;
  const cleaned = meaty
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/^&gt;\s?/g, '')
    .replace(/^>\s?/g, '')
    .trim();
  if (cleaned.length === 0 || URL_ONLY_LINE.test(cleaned)) return null;
  return cleaned.length > 280 ? `${cleaned.slice(0, 280).trimEnd()}…` : cleaned;
};

const JUNK_HEADINGS = new Set([
  'urls',
  'aliases',
  'mentioned in',
  'contents',
  'table of contents',
  'toc',
  'links',
  'references',
  'see also',
]);

/** First markdown ATX heading (# Title), if any. Skips boilerplate section names. */
export const firstHeading = (body: string): string | null => {
  for (const raw of body.split('\n')) {
    const m = raw.trim().match(/^#{1,3}\s+(.+)$/);
    if (m?.[1] === undefined) continue;
    const title = m[1]
      .replace(/[*_`]+/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .trim();
    if (title.length === 0 || URL_ONLY_LINE.test(title)) continue;
    if (JUNK_HEADINGS.has(title.toLowerCase())) continue;
    return title.length > 120 ? `${title.slice(0, 120).trimEnd()}…` : title;
  }
  return null;
};

export const authorFromSourceUrl = (url: string): { handle: string; display: string } | null => {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const segments = u.pathname.split('/').filter((s) => s.length > 0);
    const first = segments[0];
    if (first === undefined || first.length === 0) return null;
    if (host === 'x.com' || host === 'twitter.com') {
      if (first === 'i' || first === 'home' || first === 'search') return null;
      return { handle: first.toLowerCase(), display: first };
    }
    if (host === 'github.com') {
      if (first === 'orgs' || first === 'topics' || first === 'search') return null;
      return { handle: first.toLowerCase(), display: first };
    }
    return null;
  } catch {
    return null;
  }
};

/** github.com/owner/repo → "owner/repo" */
export const githubRepoTitle = (url: string): string | null => {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host !== 'github.com') return null;
    const segments = u.pathname.split('/').filter((s) => s.length > 0);
    if (segments.length < 2) return null;
    const owner = segments[0];
    const repo = segments[1];
    if (owner === undefined || repo === undefined) return null;
    if (owner === 'orgs' || owner === 'topics' || owner === 'search') return null;
    return `${owner}/${repo}`;
  } catch {
    return null;
  }
};

/** Compact secondary host+path when we must avoid dumping a huge querystring. */
export const shortUrlLabel = (url: string): string => {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    const label = `${host}${path}`;
    return label.length > 80 ? `${label.slice(0, 80)}…` : label;
  } catch {
    return url.length > 80 ? `${url.slice(0, 80)}…` : url;
  }
};

const normalizeByline = (byline: string | null | undefined): string | null => {
  if (byline === null || byline === undefined) return null;
  const t = byline.trim().replace(/^@/, '');
  return t.length > 0 ? t : null;
};

/**
 * Derive human-readable inbox card fields from source frontmatter/body.
 * Network-free; safe for unit tests and RSC loaders.
 */
export const deriveInboxDisplay = (input: InboxDisplayInput): InboxDisplay => {
  const byline = normalizeByline(input.byline ?? null);
  const fromUrl = authorFromSourceUrl(input.url);
  const authorDisplay = byline ?? fromUrl?.display ?? null;
  const authorHandle = byline !== null ? byline.toLowerCase() : (fromUrl?.handle ?? null);

  const heading = firstHeading(input.body);
  const snippet = firstBodyLine(input.body);
  const repoTitle = input.contentType === 'repo' ? githubRepoTitle(input.url) : null;

  // Repos: prefer owner/repo from the URL over boilerplate vault headings.
  let title: string | null = repoTitle ?? heading;
  // Articles often have no H1 in body; use first meaty line as title when short.
  if (title === null && input.contentType === 'article' && snippet !== null) {
    title = snippet.length <= 120 ? snippet : `${snippet.slice(0, 120).trimEnd()}…`;
  }

  const secondary = input.url;

  let primary: string;
  if (title !== null && title.length > 0) {
    primary = title;
  } else if (snippet !== null && snippet.length > 0) {
    primary = snippet;
  } else if (authorDisplay !== null) {
    primary = `@${authorDisplay}`;
  } else {
    // Last resort: short host/path — never ideal, but better than blank.
    primary = shortUrlLabel(input.url);
  }

  // When primary collapsed to the same as the full URL, still try short form.
  if (primary === input.url) {
    primary = shortUrlLabel(input.url);
  }

  return {
    primary,
    secondary,
    snippet:
      // Avoid duplicating the primary line as the only snippet when identical.
      snippet !== null && snippet !== primary ? snippet : snippet,
    title,
    authorHandle,
    authorDisplay,
  };
};
