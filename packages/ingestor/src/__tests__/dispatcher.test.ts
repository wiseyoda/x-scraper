import { describe, expect, it } from 'vitest';

import { selectIngestor } from '../dispatcher.js';
import { type Ingestor, IngestorError } from '../types.js';

const stub = (kind: 'article' | 'repo' | 'youtube' | 'pdf', host: string): Ingestor => ({
  kind,
  matches: (url: string) => {
    try {
      return new URL(url).host === host;
    } catch {
      return false;
    }
  },
  ingest: () =>
    Promise.resolve({
      url: '',
      kind,
      title: null,
      body: '',
      byline: null,
      capturedAt: '',
      metadata: {},
    }),
});

describe('selectIngestor', () => {
  it('picks the first matching ingestor', () => {
    const ingestors = [stub('repo', 'github.com'), stub('article', 'example.com')];
    expect(selectIngestor('https://github.com/x/y', ingestors).kind).toBe('repo');
    expect(selectIngestor('https://example.com/post', ingestors).kind).toBe('article');
  });

  it('throws UNSUPPORTED_URL when no ingestor matches', () => {
    const ingestors = [stub('repo', 'github.com')];
    expect(() => selectIngestor('https://example.com', ingestors)).toThrow(IngestorError);
  });
});
