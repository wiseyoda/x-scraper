/**
 * Pure parsing helpers for X.com Bookmarks GraphQL responses.
 *
 * Kept side-effect-free so they can be exhaustively tested with golden
 * fixtures captured during spike 2. The fetcher modules are responsible
 * for issuing requests; this module is responsible only for turning the
 * raw response into our internal record shape.
 */

import { z } from 'zod';

import type { BookmarkRecord } from './types.js';
import { ScraperError } from './types.js';

/**
 * Per-entry shape extractor — a minimal Zod schema that pulls out only
 * the keys we need (entryId, optional cursor fields, optional tweet
 * rest_id). The `entries` array in the outer schema is intentionally
 * `z.unknown()` so the original raw object survives intact and can be
 * passed downstream to extractTweetPayload.
 */
const TimelineEntrySchema = z.object({
  entryId: z.string().min(1),
  content: z
    .object({
      cursorType: z.string().optional(),
      value: z.string().optional(),
      itemContent: z
        .object({
          tweet_results: z
            .object({ result: z.object({ rest_id: z.string() }).partial().optional() })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

const TimelineInstructionSchema = z.object({
  type: z.string().optional(),
  entries: z.array(z.unknown()).optional(),
});

const BookmarksResponseSchema = z.object({
  data: z
    .object({
      bookmark_timeline_v2: z
        .object({
          timeline: z.object({ instructions: z.array(TimelineInstructionSchema) }).partial(),
        })
        .partial(),
    })
    .partial(),
});

export type RawBookmarksResponse = z.infer<typeof BookmarksResponseSchema>;

/**
 * Likes and own-Tweets endpoints both nest the same TimelineAddEntries
 * shape under `data.user.result.timeline.timeline.instructions`. The
 * outer wrapper differs only in path; the entries themselves carry the
 * same `entryId` + `tweet_results.result.rest_id` we already parse.
 */
const UserTimelineResponseSchema = z.object({
  data: z
    .object({
      user: z
        .object({
          result: z
            .object({
              timeline: z
                .object({
                  timeline: z
                    .object({ instructions: z.array(TimelineInstructionSchema) })
                    .partial(),
                })
                .partial(),
            })
            .partial(),
        })
        .partial(),
    })
    .partial(),
});

/** Minimal per-entry parser used inside the loop. Skips silently when an
 *  entry doesn't match — entries can be ads/tombstones/cursor markers. */
const parseEntry = (raw: unknown): z.infer<typeof TimelineEntrySchema> | null => {
  const result = TimelineEntrySchema.safeParse(raw);
  return result.success ? result.data : null;
};

export type RawUserTimelineResponse = z.infer<typeof UserTimelineResponseSchema>;

const TIMELINE_ADD_ENTRIES = 'TimelineAddEntries';
const CURSOR_TYPE_BOTTOM = 'Bottom';
const CURSOR_PREFIX = 'cursor-';
const MAX_REPORTED_ISSUES = 3;

export interface ParsedPage {
  records: BookmarkRecord[];
  bottomCursor: string | null;
}

const isCursorEntry = (entryId: string): boolean => entryId.startsWith(CURSOR_PREFIX);

const tweetIdFromEntry = (entry: z.infer<typeof TimelineEntrySchema>): string | null => {
  const restId = entry.content?.itemContent?.tweet_results?.result?.rest_id;
  if (typeof restId === 'string' && restId.length > 0) return restId;
  // Fallback: entryIds for tweet entries are typically `tweet-<id>`.
  const match = /^tweet-(\d+)$/.exec(entry.entryId);
  return match?.[1] ?? null;
};

/**
 * Parse one Bookmarks GraphQL response into our internal record shape.
 *
 * Throws ScraperError('PARSE') if the response shape doesn't match what
 * the X frontend was returning at the time of spike 2 (queryIds rotate;
 * shape changes are rarer but possible).
 */
export const parseBookmarksPage = (
  raw: unknown,
  source: 'bookmarks' | 'likes' | 'posts',
  capturedAt: string = new Date().toISOString(),
): ParsedPage => {
  const result = BookmarksResponseSchema.safeParse(raw);
  if (!result.success) {
    throw new ScraperError(
      `Bookmarks response failed schema validation: ${result.error.issues
        .slice(0, MAX_REPORTED_ISSUES)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
      'PARSE',
      result.error,
    );
  }
  const instructions = result.data.data.bookmark_timeline_v2?.timeline?.instructions ?? [];
  // First pass: walk every entry to collect tweet rows + the bottom
  // cursor. The bottom-cursor entry typically arrives AFTER the tweet
  // entries, so we backfill `cursor` after the loop rather than
  // emitting null cursors for the whole page.
  const partials: { entryId: string; tweetId: string; raw: unknown }[] = [];
  let bottomCursor: string | null = null;

  for (const ins of instructions) {
    if (ins.type !== TIMELINE_ADD_ENTRIES) continue;
    for (const rawEntry of ins.entries ?? []) {
      const entry = parseEntry(rawEntry);
      if (entry === null) continue;
      if (isCursorEntry(entry.entryId)) {
        const content = entry.content;
        if (content?.cursorType === CURSOR_TYPE_BOTTOM && content.value !== undefined) {
          bottomCursor = content.value;
        }
        continue;
      }
      const tweetId = tweetIdFromEntry(entry);
      if (tweetId === null) continue;
      // Push the ORIGINAL raw entry (not the parsed/stripped one) so
      // extractTweetPayload downstream can read every field — including
      // legacy.full_text, core.user_results, note_tweet, etc — that we
      // intentionally omitted from TimelineEntrySchema.
      partials.push({ entryId: entry.entryId, tweetId, raw: rawEntry });
    }
  }

  const records: BookmarkRecord[] = partials.map((p) => ({
    entryId: p.entryId,
    tweetId: p.tweetId,
    capturedAt,
    cursor: bottomCursor,
    source,
    raw: p.raw,
  }));

  return { records, bottomCursor };
};

/**
 * Build a replay URL by mutating the `variables.cursor` field of a
 * captured GraphQL request URL. Drops the cursor entirely if `cursor`
 * is undefined.
 *
 * Returns the original URL unchanged if no `variables` query param is
 * present (defensive: should never happen against a real X URL).
 */
export const buildCursorReplayUrl = (capturedUrl: string, cursor: string | undefined): string => {
  const url = new URL(capturedUrl);
  const variablesStr = url.searchParams.get('variables');
  if (variablesStr === null) return capturedUrl;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(variablesStr) as Record<string, unknown>;
  } catch (err) {
    throw new ScraperError('captured URL has invalid variables JSON', 'PARSE', err);
  }

  const { cursor: _drop, ...rest } = parsed;
  void _drop;
  const next = cursor === undefined ? rest : { ...rest, cursor };
  url.searchParams.set('variables', JSON.stringify(next));
  return url.toString();
};

/**
 * Drop HTTP/2 pseudo-headers (`:authority`, `:path`, etc.) from a
 * captured header map. Replaying via context.request rejects them.
 */
export const stripHttp2PseudoHeaders = (headers: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).filter(([k]) => !k.startsWith(':')));

/**
 * Parse a Likes or own-UserTweets GraphQL response. Same entry shape as
 * bookmarks, different outer wrapper (under data.user.result.timeline).
 */
export const parseUserTimelinePage = (
  raw: unknown,
  source: 'likes' | 'posts',
  capturedAt: string = new Date().toISOString(),
): ParsedPage => {
  const result = UserTimelineResponseSchema.safeParse(raw);
  if (!result.success) {
    throw new ScraperError(
      `${source} response failed schema validation: ${result.error.issues
        .slice(0, MAX_REPORTED_ISSUES)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
      'PARSE',
      result.error,
    );
  }
  const instructions = result.data.data.user?.result?.timeline?.timeline?.instructions ?? [];
  const partials: { entryId: string; tweetId: string; raw: unknown }[] = [];
  let bottomCursor: string | null = null;
  for (const ins of instructions) {
    if (ins.type !== TIMELINE_ADD_ENTRIES) continue;
    for (const rawEntry of ins.entries ?? []) {
      const entry = parseEntry(rawEntry);
      if (entry === null) continue;
      if (isCursorEntry(entry.entryId)) {
        const content = entry.content;
        if (content?.cursorType === CURSOR_TYPE_BOTTOM && content.value !== undefined) {
          bottomCursor = content.value;
        }
        continue;
      }
      const tweetId = tweetIdFromEntry(entry);
      if (tweetId === null) continue;
      partials.push({ entryId: entry.entryId, tweetId, raw: rawEntry });
    }
  }
  const records: BookmarkRecord[] = partials.map((p) => ({
    entryId: p.entryId,
    tweetId: p.tweetId,
    capturedAt,
    cursor: bottomCursor,
    source,
    raw: p.raw,
  }));
  return { records, bottomCursor };
};
