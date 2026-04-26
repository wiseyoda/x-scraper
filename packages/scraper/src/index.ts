export type { OpenedSession } from './auth.js';
export { closeSession, openAuthenticatedSession } from './auth.js';
export {
  fetchBookmarks,
  fetchLikes,
  fetchPosts,
  passiveCaptureBookmarks,
  passiveCaptureTimeline,
} from './bookmarks.js';
export type {
  JitterOptions,
  QueryIdRegistry,
  SessionCap,
  SessionCapInput,
} from './bot-mitigation.js';
export { createQueryIdRegistry, createSessionCap, jitteredDelay } from './bot-mitigation.js';
export type { ParsedPage, RawBookmarksResponse, RawUserTimelineResponse } from './parsing.js';
export {
  buildCursorReplayUrl,
  parseBookmarksPage,
  parseUserTimelinePage,
  stripHttp2PseudoHeaders,
} from './parsing.js';
export type { TweetPayload } from './payload.js';
export { extractTweetPayload, tweetPermalink } from './payload.js';
export type { AuthOptions, BookmarkRecord, PageCursor, SessionInfo, SyncOptions } from './types.js';
export { BookmarkRecordSchema, ScraperError } from './types.js';
