/**
 * Auto-expand: given a low-corroboration claim and one or more
 * SearchProviders, fan out, deduplicate, and return URL candidates.
 *
 * The decision of WHICH claims to expand lives upstream (the
 * reconciler / extractor); this module just executes a fan-out and
 * returns a normalized hit set with the strongest provider score per
 * URL preserved. The CLI / ingestor will dedupe these against the
 * vault before enqueueing.
 */

import { canonicalizeUrl } from '@x-scraper/core';

import { DEFAULT_LOW_CONFIDENCE_THRESHOLD, DEFAULT_NUM_RESULTS } from './constants.js';
import { SearchError, type SearchHit, type SearchProvider } from './types.js';

export interface ClaimContext {
  /** Low-confidence claim that triggered the expand. */
  subject: string;
  predicate: string;
  object: string;
  /** Original supporting text — used to add specificity to the query. */
  text: string;
  /** Confidence on the claim from the extractor; lower means more eligible. */
  confidence: number;
}

export interface AutoExpandOptions {
  providers: SearchProvider[];
  numResults?: number;
  /** Skip claims whose confidence is at or above this threshold. */
  minConfidenceThreshold?: number;
  /** Already-known URLs to drop from the candidate set. */
  skip?: Iterable<string>;
}

export interface AutoExpandResult {
  /** Whether the claim was eligible (false → no fan-out happened). */
  expanded: boolean;
  /** Aggregated, deduped, canonicalized hits across providers. */
  hits: (SearchHit & { providers: string[] })[];
  /** Per-provider error details (one entry per failure). */
  errors: { provider: string; message: string }[];
}

export const buildExpandQuery = (claim: ClaimContext): string => {
  // Subject + a short slice of supporting text gives the search engines
  // both the "what" and concrete-enough phrasing to narrow recall.
  const TEXT_SLICE = 160;
  const head = `${claim.subject} ${claim.predicate.replace(/_/g, ' ')} ${claim.object}`;
  const tail = claim.text.length > TEXT_SLICE ? claim.text.slice(0, TEXT_SLICE) : claim.text;
  return `${head} ${tail}`.trim();
};

export const autoExpandClaim = async (
  claim: ClaimContext,
  options: AutoExpandOptions,
): Promise<AutoExpandResult> => {
  const threshold = options.minConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  if (claim.confidence >= threshold) {
    return { expanded: false, hits: [], errors: [] };
  }
  if (options.providers.length === 0) {
    return { expanded: true, hits: [], errors: [] };
  }
  const skip = new Set<string>();
  for (const u of options.skip ?? []) skip.add(canonicalizeUrl(u));
  const query = buildExpandQuery(claim);
  const numResults = options.numResults ?? DEFAULT_NUM_RESULTS;

  const settled = await Promise.allSettled(
    options.providers.map((p) => p.search(query, { numResults })),
  );
  const errors: { provider: string; message: string }[] = [];
  const merged = new Map<string, SearchHit & { providers: string[] }>();
  for (let i = 0; i < settled.length; i += 1) {
    const provider = options.providers[i];
    const outcome = settled[i];
    if (provider === undefined || outcome === undefined) continue;
    if (outcome.status === 'rejected') {
      const message =
        outcome.reason instanceof SearchError
          ? `${outcome.reason.code}: ${outcome.reason.message}`
          : String(outcome.reason);
      errors.push({ provider: provider.provider, message });
      continue;
    }
    for (const hit of outcome.value.hits) {
      const canon = canonicalizeUrl(hit.url);
      if (skip.has(canon)) continue;
      const existing = merged.get(canon);
      if (existing === undefined) {
        merged.set(canon, { ...hit, url: canon, providers: [provider.provider] });
      } else {
        if (!existing.providers.includes(provider.provider)) {
          existing.providers.push(provider.provider);
        }
        // Keep the strongest score, the first non-null title/snippet.
        if (hit.score !== null && (existing.score === null || existing.score < hit.score)) {
          existing.score = hit.score;
        }
        existing.title ??= hit.title;
        existing.snippet ??= hit.snippet;
        existing.publishedAt ??= hit.publishedAt;
      }
    }
  }
  return { expanded: true, hits: [...merged.values()], errors };
};
