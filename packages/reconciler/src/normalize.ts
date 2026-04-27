/**
 * Entity name normalization for the reconciler's pre-flight match pass.
 *
 * Vector ER alone misses trivial alias collisions like `AI Agents` /
 * `AI Agent` and `MCP` / `Model Context Protocol`. Cheap exact matching
 * on a normalized form catches these before we burn HNSW lookups + the
 * LLM judge on cases that don't need either.
 *
 * Three layers, applied in order:
 *   1. NFKC unicode normalization (handles full-width / combined chars).
 *   2. Lowercase, strip leading articles (`the `, `a `, `an `), collapse
 *      whitespace, strip punctuation outside the inner word boundary.
 *   3. Heuristic singularization for the common English plural endings.
 *      No external `inflection` package — the four rules below cover
 *      the long tail Pat saw in the live graph (Agents → Agent,
 *      Repositories → Repository, etc).
 *
 * Singularization is HEURISTIC. Words like "news", "series", "data"
 * shouldn't be touched. We err on the side of NOT singularizing if the
 * stripped form would be implausibly short (< 3 chars).
 */

const LEADING_ARTICLE_RE = /^(?:the|a|an)\s+/i;
const PUNCT_BOUNDARY_RE = /[^\p{L}\p{N}\s_-]+/gu;
const WHITESPACE_COLLAPSE_RE = /\s+/g;

const MIN_SINGULARIZED_LENGTH = 3;

const singularize = (word: string): string => {
  if (word.length < MIN_SINGULARIZED_LENGTH + 1) return word;
  // -ies → -y (libraries → library, repositories → repository)
  if (/[^aeiou]ies$/i.test(word)) {
    return `${word.slice(0, -3)}y`;
  }
  // -ses, -xes, -zes, -ches, -shes → strip 'es' (boxes → box, witches → witch)
  if (/(s|x|z|ch|sh)es$/i.test(word)) {
    return word.slice(0, -2);
  }
  // -ves → -f (knives → knife, leaves → leaf) — narrow rule
  if (/[aeiou]ves$/i.test(word) && word.length >= 5) {
    return `${word.slice(0, -3)}fe`;
  }
  // -s (default plural) — but not -ss (class), -us (status), -is (basis), -os (logos)
  if (/[^suo]s$/i.test(word) && !word.endsWith('is')) {
    return word.slice(0, -1);
  }
  return word;
};

/**
 * Cheap, deterministic, lossy. Use for matching — not display.
 *
 * Returns the empty string when the input has no letters/digits after
 * normalization (caller should treat empty as "don't match anything").
 */
export const normalizeEntityName = (raw: string): string => {
  if (raw.length === 0) return '';
  const nfkc = raw.normalize('NFKC');
  const lower = nfkc.toLowerCase();
  const dearticled = lower.replace(LEADING_ARTICLE_RE, '');
  const depuncted = dearticled.replace(PUNCT_BOUNDARY_RE, ' ');
  const collapsed = depuncted.replace(WHITESPACE_COLLAPSE_RE, ' ').trim();
  if (collapsed.length === 0) return '';
  // Singularize each token; preserves multi-word names like "ai agents" → "ai agent".
  const singularized = collapsed
    .split(' ')
    .map((tok) => (tok.length === 0 ? tok : singularize(tok)))
    .join(' ');
  return singularized;
};

/**
 * Convenience: normalize a name and a list of aliases to a deduped set
 * of normalized strings, suitable for indexed exact-match lookup.
 */
export const normalizedSurfaceForms = (name: string, aliases: string[] = []): string[] => {
  const out = new Set<string>();
  const primary = normalizeEntityName(name);
  if (primary.length > 0) out.add(primary);
  for (const a of aliases) {
    const n = normalizeEntityName(a);
    if (n.length > 0) out.add(n);
  }
  return Array.from(out);
};
