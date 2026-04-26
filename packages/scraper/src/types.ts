import { z } from 'zod';

/**
 * What we extract from one bookmark entry. The shape is intentionally
 * minimal — full tweet enrichment happens in the ingestor stage.
 */
export const BookmarkRecordSchema = z.object({
  entryId: z.string().min(1),
  tweetId: z.string().min(1),
  capturedAt: z.iso.datetime(),
  cursor: z.string().min(1).nullable(),
  source: z.enum(['bookmarks', 'likes', 'posts']),
  raw: z.unknown(),
});
export type BookmarkRecord = z.infer<typeof BookmarkRecordSchema>;

export const PageCursorSchema = z.object({
  next: z.string().min(1).nullable(),
});
export type PageCursor = z.infer<typeof PageCursorSchema>;

export const SessionInfoSchema = z.object({
  screenName: z.string().min(1),
  userId: z.string().regex(/^\d+$/),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export interface AuthOptions {
  profileDir: string;
  channel?: string | undefined;
  headless?: boolean | undefined;
}

export interface SyncOptions {
  source: 'bookmarks' | 'likes' | 'posts';
  maxPages?: number | undefined;
  maxBookmarks?: number | undefined;
  cursorFrom?: string | undefined;
}

export type ScraperErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'ENDPOINT_CHANGED'
  | 'NETWORK'
  | 'PARSE'
  | 'UNKNOWN';

export class ScraperError extends Error {
  public readonly code: ScraperErrorCode;
  public override readonly cause: unknown;

  constructor(message: string, code: ScraperErrorCode, cause?: unknown) {
    super(message);
    this.name = 'ScraperError';
    this.code = code;
    this.cause = cause;
  }
}
