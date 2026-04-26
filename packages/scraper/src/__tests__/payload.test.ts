import { describe, expect, it } from 'vitest';

import { extractTweetPayload, tweetPermalink } from '../payload.js';
import type { BookmarkRecord } from '../types.js';

const buildRecord = (raw: unknown): BookmarkRecord => ({
  entryId: 'tweet-1',
  tweetId: '1',
  capturedAt: '2026-01-01T00:00:00.000Z',
  cursor: null,
  source: 'bookmarks',
  raw,
});

describe('extractTweetPayload', () => {
  it('extracts text, author (core.screen_name), createdAt, urls from a Tweet result', () => {
    const raw = {
      content: {
        itemContent: {
          tweet_results: {
            result: {
              __typename: 'Tweet',
              rest_id: '1',
              core: {
                user_results: {
                  result: {
                    core: { screen_name: 'krishnanrohit' },
                  },
                },
              },
              legacy: {
                full_text: 'hello world https://t.co/abc',
                created_at: 'Sat Apr 26 14:30:00 +0000 2026',
                entities: {
                  urls: [
                    { url: 'https://t.co/abc', expanded_url: 'https://example.com/article' },
                  ],
                },
              },
            },
          },
        },
      },
    };
    const payload = extractTweetPayload(buildRecord(raw));
    expect(payload).toEqual({
      text: 'hello world https://t.co/abc',
      author: 'krishnanrohit',
      createdAt: '2026-04-26T14:30:00.000Z',
      urls: ['https://example.com/article'],
    });
  });

  it('prefers note_tweet text over truncated legacy.full_text for long tweets', () => {
    const raw = {
      content: {
        itemContent: {
          tweet_results: {
            result: {
              core: { user_results: { result: { core: { screen_name: 'a' } } } },
              legacy: { full_text: 'truncated… https://t.co/xyz' },
              note_tweet: {
                note_tweet_results: {
                  result: {
                    text: 'the full long body of the tweet beyond 280 chars',
                    entity_set: {
                      urls: [{ expanded_url: 'https://example.com/long' }],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const payload = extractTweetPayload(buildRecord(raw));
    expect(payload?.text).toBe('the full long body of the tweet beyond 280 chars');
    expect(payload?.urls).toEqual(['https://example.com/long']);
  });

  it('unwraps TweetWithVisibilityResults', () => {
    const raw = {
      content: {
        itemContent: {
          tweet_results: {
            result: {
              __typename: 'TweetWithVisibilityResults',
              tweet: {
                core: { user_results: { result: { core: { screen_name: 'u' } } } },
                legacy: { full_text: 'visible body' },
              },
            },
          },
        },
      },
    };
    const payload = extractTweetPayload(buildRecord(raw));
    expect(payload?.text).toBe('visible body');
    expect(payload?.author).toBe('u');
  });

  it('returns null for tombstone-style entries with no readable fields', () => {
    const raw = {
      content: {
        itemContent: {
          tweet_results: {
            result: { __typename: 'TweetTombstone' },
          },
        },
      },
    };
    expect(extractTweetPayload(buildRecord(raw))).toBeNull();
  });

  it('dedupes urls preserving order, falls back to legacy.screen_name when core.screen_name absent', () => {
    const raw = {
      content: {
        itemContent: {
          tweet_results: {
            result: {
              core: {
                user_results: {
                  result: {
                    legacy: { screen_name: 'older_path_user' },
                  },
                },
              },
              legacy: {
                full_text: 'a',
                entities: {
                  urls: [
                    { expanded_url: 'https://x.example/1' },
                    { expanded_url: 'https://x.example/1' },
                    { expanded_url: 'https://x.example/2' },
                  ],
                },
              },
            },
          },
        },
      },
    };
    const payload = extractTweetPayload(buildRecord(raw));
    expect(payload?.author).toBe('older_path_user');
    expect(payload?.urls).toEqual(['https://x.example/1', 'https://x.example/2']);
  });

  it('handles malformed input by returning null without throwing', () => {
    expect(extractTweetPayload(buildRecord(null))).toBeNull();
    expect(extractTweetPayload(buildRecord('not an object'))).toBeNull();
  });
});

describe('tweetPermalink', () => {
  it('uses the canonical /<author>/status/<id> form when author is known', () => {
    expect(tweetPermalink('123', 'foo')).toBe('https://x.com/foo/status/123');
  });
  it('falls back to /i/web/status/<id> when author is null', () => {
    expect(tweetPermalink('123', null)).toBe('https://x.com/i/web/status/123');
  });
});
