/**
 * Tweet payload extraction. Pulls the human-readable fields out of the
 * raw timeline entry the GraphQL endpoint returns, so downstream callers
 * (the bookmark ledger, xs sync) can work with `{text, author, urls}`
 * without re-implementing the X.com schema gymnastics.
 *
 * X returns several variants of the tweet result object:
 *   - `Tweet` — the common case
 *   - `TweetWithVisibilityResults.tweet` — wrapped when the tweet has a
 *     visibility/sensitivity warning
 *   - `TweetTombstone` — deleted/withheld tweets, no useful payload
 *
 * Long tweets (>280 chars) carry the full body under `note_tweet`; the
 * `legacy.full_text` is truncated for them. Always prefer note_tweet text
 * when present.
 */

import { z } from 'zod';

import type { BookmarkRecord } from './types.js';

const UrlEntitySchema = z.object({
  expanded_url: z.string().min(1).optional(),
  url: z.string().optional(),
});

const LegacySchema = z
  .object({
    full_text: z.string().optional(),
    created_at: z.string().optional(),
    entities: z
      .object({
        urls: z.array(UrlEntitySchema).optional(),
      })
      .optional(),
  })
  .partial();

const NoteTweetSchema = z
  .object({
    note_tweet_results: z
      .object({
        result: z
          .object({
            text: z.string().optional(),
            entity_set: z
              .object({
                urls: z.array(UrlEntitySchema).optional(),
              })
              .optional(),
          })
          .partial(),
      })
      .partial(),
  })
  .partial();

const UserResultSchema = z
  .object({
    result: z
      .object({
        legacy: z
          .object({
            screen_name: z.string().optional(),
            name: z.string().optional(),
          })
          .partial()
          .optional(),
        // Newer payloads moved screen_name out of legacy; check both.
        core: z
          .object({
            screen_name: z.string().optional(),
          })
          .optional(),
      })
      .partial(),
  })
  .partial();

const CoreSchema = z
  .object({
    user_results: UserResultSchema.optional(),
  })
  .partial();

/** A "real" tweet result (not a tombstone). */
const TweetResultSchema = z
  .object({
    rest_id: z.string().optional(),
    legacy: LegacySchema.optional(),
    note_tweet: NoteTweetSchema.optional(),
    core: CoreSchema.optional(),
  })
  .partial();

/** TweetWithVisibilityResults wraps the real tweet under `.tweet`. */
const TweetWithVisibilitySchema = z
  .object({
    tweet: TweetResultSchema.optional(),
  })
  .partial();

// Outer entry shape: drill down to `tweet_results.result` and keep the
// nested object intact (passthrough) so the unwrap step below can decide
// which inner schema applies. Validating the result against
// TweetResultSchema at this layer would strip the `tweet` wrapper key.
const EntrySchema = z
  .object({
    content: z
      .object({
        itemContent: z
          .object({
            tweet_results: z
              .object({
                result: z.unknown().optional(),
              })
              .optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .partial();

export interface TweetPayload {
  /** Tweet body text. Falls back to "" when no text could be extracted
   *  (tombstone, schema drift, etc.) — caller decides whether that's an
   *  error or a valid skip. */
  text: string;
  /** Author screen_name without leading @. Null when not present. */
  author: string | null;
  /** Tweet creation time in ISO-8601, or null when not parseable. */
  createdAt: string | null;
  /** Expanded URLs embedded in the tweet, deduped + ordered as they appear. */
  urls: string[];
}

/** Parse Twitter's `created_at` ("Mon Apr 26 14:30:00 +0000 2026") to ISO. */
const parseTwitterDate = (raw: string | undefined): string | null => {
  if (raw === undefined) return null;
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return null;
  return new Date(ts).toISOString();
};

const dedupePreserveOrder = (xs: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
};

/**
 * Extract the readable payload from a BookmarkRecord's `raw` entry.
 * Returns null when the entry is a tombstone or unrecognized — the caller
 * should treat that as a skip-able row rather than a failure (X does
 * occasionally return non-tweet entries we already filter out at parse,
 * but we're defensive against future shapes).
 */
export const extractTweetPayload = (record: BookmarkRecord): TweetPayload | null => {
  const entry = EntrySchema.safeParse(record.raw);
  if (!entry.success) return null;
  const rawResult = entry.data.content?.itemContent?.tweet_results?.result;
  if (rawResult === undefined) return null;

  // Unwrap TweetWithVisibilityResults if present.
  const tweetResult: z.infer<typeof TweetResultSchema> = (() => {
    const wrapped = TweetWithVisibilitySchema.safeParse(rawResult);
    if (wrapped.success && wrapped.data.tweet !== undefined) return wrapped.data.tweet;
    const direct = TweetResultSchema.safeParse(rawResult);
    return direct.success ? direct.data : {};
  })();

  const noteText = tweetResult.note_tweet?.note_tweet_results?.result?.text;
  const legacyText = tweetResult.legacy?.full_text;
  const text = (noteText !== undefined && noteText.length > 0 ? noteText : legacyText) ?? '';

  const screenNameLegacy = tweetResult.core?.user_results?.result?.legacy?.screen_name;
  const screenNameCore = tweetResult.core?.user_results?.result?.core?.screen_name;
  const author = screenNameLegacy ?? screenNameCore ?? null;

  const createdAt = parseTwitterDate(tweetResult.legacy?.created_at);

  const noteUrls =
    tweetResult.note_tweet?.note_tweet_results?.result?.entity_set?.urls
      ?.map((u) => u.expanded_url)
      .filter((u): u is string => typeof u === 'string') ?? [];
  const legacyUrls =
    tweetResult.legacy?.entities?.urls
      ?.map((u) => u.expanded_url)
      .filter((u): u is string => typeof u === 'string') ?? [];
  const urls = dedupePreserveOrder([...noteUrls, ...legacyUrls]);

  if (text.length === 0 && author === null && urls.length === 0) {
    // Tombstone or unrecognized variant.
    return null;
  }

  return { text, author, createdAt, urls };
};

/**
 * Build the canonical permalink for a tweet. Prefers the `https://x.com/{author}/status/{id}`
 * form when author is known, falls back to the author-less form which X
 * accepts and redirects from.
 */
export const tweetPermalink = (tweetId: string, author: string | null): string =>
  author === null
    ? `https://x.com/i/web/status/${tweetId}`
    : `https://x.com/${author}/status/${tweetId}`;
