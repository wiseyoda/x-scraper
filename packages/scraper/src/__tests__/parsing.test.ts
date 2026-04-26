import { describe, expect, it } from 'vitest';

import { buildCursorReplayUrl, parseBookmarksPage, stripHttp2PseudoHeaders } from '../parsing.js';
import { ScraperError } from '../types.js';

const FIXED_NOW = '2026-04-26T00:00:00.000Z';
const EXPECTED_COUNT = 20;

const makeBookmarksResponse = (
  entries: {
    entryId: string;
    restId?: string;
    cursorType?: 'Top' | 'Bottom';
    cursorValue?: string;
  }[],
): unknown => ({
  data: {
    bookmark_timeline_v2: {
      timeline: {
        instructions: [
          {
            type: 'TimelineAddEntries',
            entries: entries.map((e) => ({
              entryId: e.entryId,
              content: e.cursorType
                ? { cursorType: e.cursorType, value: e.cursorValue }
                : e.restId
                  ? { itemContent: { tweet_results: { result: { rest_id: e.restId } } } }
                  : {},
            })),
          },
        ],
      },
    },
  },
});

describe('parseBookmarksPage', () => {
  it('extracts tweet records and the bottom cursor', () => {
    const raw = makeBookmarksResponse([
      { entryId: 'tweet-100', restId: '100' },
      { entryId: 'tweet-200', restId: '200' },
      { entryId: 'cursor-bottom-x', cursorType: 'Bottom', cursorValue: 'NEXT' },
    ]);
    const out = parseBookmarksPage(raw, 'bookmarks', FIXED_NOW);
    expect(out.records).toHaveLength(2);
    expect(out.records[0]?.tweetId).toBe('100');
    expect(out.records[0]?.entryId).toBe('tweet-100');
    expect(out.records[0]?.capturedAt).toBe(FIXED_NOW);
    expect(out.bottomCursor).toBe('NEXT');
  });

  it('falls back to entryId regex when rest_id is missing', () => {
    const raw = makeBookmarksResponse([{ entryId: 'tweet-42' }]);
    const out = parseBookmarksPage(raw, 'bookmarks', FIXED_NOW);
    expect(out.records).toHaveLength(1);
    expect(out.records[0]?.tweetId).toBe('42');
  });

  it('skips entries that have no extractable tweet id', () => {
    const raw = makeBookmarksResponse([
      { entryId: 'promotedTweet-foo' },
      { entryId: 'tweet-7', restId: '7' },
    ]);
    const out = parseBookmarksPage(raw, 'bookmarks', FIXED_NOW);
    expect(out.records).toHaveLength(1);
    expect(out.records[0]?.tweetId).toBe('7');
  });

  it('returns null cursor when no Bottom cursor entry is present', () => {
    const raw = makeBookmarksResponse([
      { entryId: 'cursor-top-x', cursorType: 'Top', cursorValue: 'TOP' },
      { entryId: 'tweet-1', restId: '1' },
    ]);
    const out = parseBookmarksPage(raw, 'bookmarks', FIXED_NOW);
    expect(out.bottomCursor).toBeNull();
  });

  it('throws ScraperError(PARSE) on shape mismatch', () => {
    expect(() => parseBookmarksPage({ data: 'not-an-object' }, 'bookmarks', FIXED_NOW)).toThrow(
      ScraperError,
    );
  });

  it('handles an empty instructions array', () => {
    const raw = { data: { bookmark_timeline_v2: { timeline: { instructions: [] } } } };
    const out = parseBookmarksPage(raw, 'bookmarks', FIXED_NOW);
    expect(out.records).toHaveLength(0);
    expect(out.bottomCursor).toBeNull();
  });

  it('ignores instruction types other than TimelineAddEntries', () => {
    const raw = {
      data: {
        bookmark_timeline_v2: {
          timeline: {
            instructions: [
              { type: 'TimelineClearCache', entries: [] },
              {
                type: 'TimelineAddEntries',
                entries: [
                  {
                    entryId: 'tweet-9',
                    content: { itemContent: { tweet_results: { result: { rest_id: '9' } } } },
                  },
                ],
              },
            ],
          },
        },
      },
    };
    const out = parseBookmarksPage(raw, 'bookmarks', FIXED_NOW);
    expect(out.records).toHaveLength(1);
  });
});

describe('buildCursorReplayUrl', () => {
  const base =
    'https://x.com/i/api/graphql/abc123/Bookmarks?variables=' +
    encodeURIComponent(JSON.stringify({ count: 20, includePromotedContent: false }));

  it('adds a cursor when one is provided', () => {
    const out = buildCursorReplayUrl(base, 'CURSOR_X');
    const variables = JSON.parse(
      decodeURIComponent(new URL(out).searchParams.get('variables') ?? '{}'),
    ) as {
      cursor?: string;
      count?: number;
    };
    expect(variables.cursor).toBe('CURSOR_X');
    expect(variables.count).toBe(EXPECTED_COUNT);
  });

  it('replaces an existing cursor', () => {
    const seeded =
      'https://x.com/i/api/graphql/abc123/Bookmarks?variables=' +
      encodeURIComponent(JSON.stringify({ count: 20, cursor: 'OLD' }));
    const out = buildCursorReplayUrl(seeded, 'NEW');
    const variables = JSON.parse(
      decodeURIComponent(new URL(out).searchParams.get('variables') ?? '{}'),
    ) as { cursor?: string };
    expect(variables.cursor).toBe('NEW');
  });

  it('drops the cursor when undefined is passed', () => {
    const seeded =
      'https://x.com/i/api/graphql/abc123/Bookmarks?variables=' +
      encodeURIComponent(JSON.stringify({ count: 20, cursor: 'OLD' }));
    const out = buildCursorReplayUrl(seeded, undefined);
    const variables = JSON.parse(
      decodeURIComponent(new URL(out).searchParams.get('variables') ?? '{}'),
    ) as { cursor?: string };
    expect(variables.cursor).toBeUndefined();
  });

  it('returns the URL unchanged when there is no variables param', () => {
    const noVars = 'https://x.com/i/api/graphql/abc123/Bookmarks';
    expect(buildCursorReplayUrl(noVars, 'CURSOR')).toBe(noVars);
  });

  it('throws ScraperError(PARSE) on invalid variables JSON', () => {
    const bad =
      'https://x.com/i/api/graphql/abc123/Bookmarks?variables=' + encodeURIComponent('not-json');
    expect(() => buildCursorReplayUrl(bad, 'CURSOR')).toThrow(ScraperError);
  });
});

describe('stripHttp2PseudoHeaders', () => {
  it('removes only headers starting with a colon', () => {
    const input = {
      ':authority': 'x.com',
      ':method': 'GET',
      'user-agent': 'foo',
      cookie: 'bar',
    };
    const out = stripHttp2PseudoHeaders(input);
    expect(out).toEqual({ 'user-agent': 'foo', cookie: 'bar' });
  });
});
