import { describe, expect, it, vi } from 'vitest';

import type { FetchLike } from '../http.js';
import {
  captionsXmlToText,
  createYouTubeIngestor,
  extractPlayerResponse,
  parseYouTubeUrl,
} from '../youtube.js';

const PLAYER_JSON = {
  videoDetails: { title: 'Knowledge Graphs Explained', author: 'Jane Doe', lengthSeconds: '600' },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        { baseUrl: 'https://example.com/captions.xml', languageCode: 'en' },
        { baseUrl: 'https://example.com/captions-asr.xml', languageCode: 'en', kind: 'asr' },
      ],
    },
  },
};

const HTML_PAGE = `<!doctype html><html><body>
<script>
var ytInitialPlayerResponse = ${JSON.stringify(PLAYER_JSON)};
</script>
</body></html>`;

const CAPTIONS_XML = `<?xml version="1.0"?><transcript>
<text start="0">${'A knowledge graph encodes facts as nodes and relationships. '.repeat(8)}</text>
<text start="10">${'Entities are nodes; relationships are typed edges. '.repeat(8)}</text>
</transcript>`;

describe('parseYouTubeUrl', () => {
  it('parses /watch?v= URLs', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      videoId: 'dQw4w9WgXcQ',
    });
  });

  it('parses youtu.be URLs', () => {
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toEqual({ videoId: 'dQw4w9WgXcQ' });
  });

  it('returns null for non-YouTube hosts', () => {
    expect(parseYouTubeUrl('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });
});

describe('extractPlayerResponse', () => {
  it('finds and parses the embedded ytInitialPlayerResponse object', () => {
    const result = extractPlayerResponse(HTML_PAGE);
    expect(result?.videoDetails?.title).toBe('Knowledge Graphs Explained');
  });

  it('returns null when the marker is absent', () => {
    expect(extractPlayerResponse('<html></html>')).toBeNull();
  });
});

describe('captionsXmlToText', () => {
  it('strips XML tags and decodes basic entities', () => {
    const xml =
      '<transcript><text start="0">hello &amp; world</text><text start="1">&quot;quoted&quot;</text></transcript>';
    const text = captionsXmlToText(xml);
    expect(text).toContain('hello & world');
    expect(text).toContain('"quoted"');
  });
});

describe('createYouTubeIngestor', () => {
  it('returns a transcript-backed IngestedSource', async () => {
    const fetchImpl: FetchLike = vi.fn((url: string) => {
      if (url.endsWith('captions.xml')) {
        return Promise.resolve(
          new Response(CAPTIONS_XML, { status: 200, headers: { 'content-type': 'text/xml' } }),
        );
      }
      return Promise.resolve(
        new Response(HTML_PAGE, { status: 200, headers: { 'content-type': 'text/html' } }),
      );
    });
    const ingestor = createYouTubeIngestor({
      fetchImpl,
      now: () => new Date('2026-04-26T00:00:00.000Z'),
    });
    const source = await ingestor.ingest('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(source.kind).toBe('youtube');
    expect(source.title).toBe('Knowledge Graphs Explained');
    expect(source.byline).toBe('Jane Doe');
    expect(source.body.length).toBeGreaterThan(300);
    expect(source.metadata.videoId).toBe('dQw4w9WgXcQ');
    expect(source.metadata.durationSec).toBe(600);
  });

  it('throws EMPTY_BODY when the video has no captions', async () => {
    const playerNoCaps = JSON.stringify({ videoDetails: { title: 'X' }, captions: {} });
    const html = `<script>var ytInitialPlayerResponse = ${playerNoCaps};</script>`;
    const ingestor = createYouTubeIngestor({
      fetchImpl: () =>
        Promise.resolve(
          new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
        ),
    });
    await expect(
      ingestor.ingest('https://www.youtube.com/watch?v=AAAAAAAAAAA'),
    ).rejects.toMatchObject({ code: 'EMPTY_BODY' });
  });
});
