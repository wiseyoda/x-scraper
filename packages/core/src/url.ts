/**
 * URL canonicalization for dedup. Two URLs that differ only by tracking
 * params or trailing slashes should produce the same canonical form.
 */

const TRACKING_PARAM_PREFIXES = ['utm_', 'ref_', 'fbclid', 'gclid', '_ga', 'mc_', 'mkt_'];

const isTrackingParam = (name: string): boolean => {
  const lower = name.toLowerCase();
  return TRACKING_PARAM_PREFIXES.some((p) => lower === p || lower.startsWith(p));
};

export const canonicalizeUrl = (input: string): string => {
  const url = new URL(input);
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (isTrackingParam(key)) url.searchParams.delete(key);
  }
  // Sort remaining params for stable output.
  const sorted = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  url.search = '';
  for (const [k, v] of sorted) url.searchParams.append(k, v);
  // Strip a trailing slash on the path unless it's the root.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
};
