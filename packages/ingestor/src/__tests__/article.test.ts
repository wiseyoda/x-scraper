import { describe, expect, it, vi } from 'vitest';

import { createArticleIngestor, parseArticleHtml } from '../article.js';
import type { FetchLike } from '../http.js';
import { IngestorError } from '../types.js';

const ARTICLE_HTML = `<!doctype html><html><head><title>The Knowledge Graph</title></head>
<body>
<article>
<h1>Knowledge Graphs</h1>
<p>By <span class="author">Jane Doe</span></p>
<p>${'A knowledge graph encodes facts as nodes and relationships. '.repeat(20)}</p>
<p>${'Bi-temporal models track when a fact was true and when we learned it. '.repeat(10)}</p>
</article>
</body></html>`;

const ok =
  (body: string, status = 200): FetchLike =>
  () =>
    Promise.resolve(new Response(body, { status, headers: { 'content-type': 'text/html' } }));

describe('parseArticleHtml', () => {
  it('extracts title, body, and byline from a normal article page', () => {
    const result = parseArticleHtml(ARTICLE_HTML, 'https://example.com/a');
    expect(result.title).toBe('The Knowledge Graph');
    expect(result.body.length).toBeGreaterThan(300);
    expect(result.body).toContain('knowledge graph');
  });

  it('throws EMPTY_BODY when extracted text is below the minimum', () => {
    const tinyHtml = '<html><body><article><p>Too short.</p></article></body></html>';
    expect(() => parseArticleHtml(tinyHtml, 'https://example.com/short')).toThrow(IngestorError);
  });
});

describe('createArticleIngestor', () => {
  it('returns an IngestedSource with kind=article', async () => {
    const ingestor = createArticleIngestor({
      fetchImpl: ok(ARTICLE_HTML),
      now: () => new Date('2026-04-26T00:00:00.000Z'),
    });
    const source = await ingestor.ingest('https://example.com/a');
    expect(source.kind).toBe('article');
    expect(source.url).toBe('https://example.com/a');
    expect(source.title).toBe('The Knowledge Graph');
    expect(source.capturedAt).toBe('2026-04-26T00:00:00.000Z');
  });

  it('throws UNSUPPORTED_URL for non-http URLs', async () => {
    const ingestor = createArticleIngestor({ fetchImpl: vi.fn() });
    await expect(ingestor.ingest('file:///etc/passwd')).rejects.toMatchObject({
      code: 'UNSUPPORTED_URL',
    });
  });

  it('throws on HTTP non-2xx', async () => {
    const ingestor = createArticleIngestor({
      fetchImpl: () => Promise.resolve(new Response('nope', { status: 404 })),
    });
    await expect(ingestor.ingest('https://example.com/missing')).rejects.toMatchObject({
      code: 'PROVIDER',
    });
  });
});
