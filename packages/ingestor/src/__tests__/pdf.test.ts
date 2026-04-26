import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import { createPdfIngestor, extractPdfText } from '../pdf.js';

const PAGE_TEXT_REPEAT = 30;

// Each call returns a fresh, untouched buffer. pdfjs's getDocument takes
// ownership of and detaches the underlying ArrayBuffer, so any shared
// fixture would become unusable after the first test consumes it.
const buildSamplePdf = async (sentences: number = PAGE_TEXT_REPEAT): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const sentence =
    'This is a synthetic test PDF used to verify the ingestor extracts plain text from the page content stream. ';
  let y = 750;
  for (let i = 0; i < sentences; i += 1) {
    page.drawText(sentence, { x: 40, y, size: 10, font });
    y -= 14;
  }
  return doc.save();
};

const buildEmptyPdf = async (): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText('tiny', { x: 50, y: 750, size: 12 });
  return doc.save();
};

const okPdf =
  (bytes: Uint8Array, status = 200, contentType = 'application/pdf'): typeof fetch =>
  () =>
    Promise.resolve(
      new Response(bytes as unknown as BodyInit, {
        status,
        headers: { 'content-type': contentType },
      }),
    );

describe('extractPdfText', () => {
  it('reads text content from a synthetic PDF', async () => {
    const result = await extractPdfText(await buildSamplePdf(), 'https://example.com/x.pdf');
    expect(result.body.length).toBeGreaterThan(300);
    expect(result.body).toContain('synthetic test PDF');
    expect(result.pageCount).toBe(1);
  });

  it('accepts a Node Buffer (which extends Uint8Array)', async () => {
    const buf = Buffer.from(await buildSamplePdf());
    const result = await extractPdfText(buf, 'https://example.com/buf.pdf');
    expect(result.body).toContain('synthetic test PDF');
  });

  it("does not detach the caller's buffer (re-usable across calls)", async () => {
    const bytes = await buildSamplePdf();
    await extractPdfText(bytes, 'https://example.com/once.pdf');
    // Without the internal copy this would throw "detached ArrayBuffer".
    const second = await extractPdfText(bytes, 'https://example.com/twice.pdf');
    expect(second.body).toContain('synthetic test PDF');
  });

  it('throws EMPTY_BODY when the PDF has too little extractable text', async () => {
    await expect(
      extractPdfText(await buildEmptyPdf(), 'https://example.com/tiny.pdf'),
    ).rejects.toMatchObject({ code: 'EMPTY_BODY' });
  });

  it('throws PARSE on a non-PDF buffer', async () => {
    const garbage = new Uint8Array([0x68, 0x69]);
    await expect(extractPdfText(garbage, 'https://example.com/junk.pdf')).rejects.toMatchObject({
      code: 'PARSE',
    });
  });
});

describe('createPdfIngestor', () => {
  it('matches .pdf URLs and rejects non-pdf URLs', () => {
    const ingestor = createPdfIngestor();
    expect(ingestor.matches('https://example.com/foo.pdf')).toBe(true);
    expect(ingestor.matches('https://example.com/foo.html')).toBe(false);
    expect(ingestor.matches('file:///etc/passwd.pdf')).toBe(false);
  });

  it('returns an IngestedSource with kind=pdf', async () => {
    const ingestor = createPdfIngestor({
      fetchImpl: okPdf(await buildSamplePdf()),
      now: () => new Date('2026-04-26T00:00:00.000Z'),
    });
    const source = await ingestor.ingest('https://example.com/x.pdf');
    expect(source.kind).toBe('pdf');
    expect(source.url).toBe('https://example.com/x.pdf');
    expect(source.body).toContain('synthetic test PDF');
    expect(source.capturedAt).toBe('2026-04-26T00:00:00.000Z');
    expect(source.metadata.pageCount).toBe(1);
  });

  it('throws UNSUPPORTED_URL for non-http URLs', async () => {
    const ingestor = createPdfIngestor({ fetchImpl: vi.fn() });
    await expect(ingestor.ingest('file:///etc/passwd.pdf')).rejects.toMatchObject({
      code: 'UNSUPPORTED_URL',
    });
  });

  it('accepts an explicitly-routed http URL with no .pdf suffix when the response is application/pdf', async () => {
    const ingestor = createPdfIngestor({
      fetchImpl: okPdf(await buildSamplePdf()),
      now: () => new Date('2026-04-26T00:00:00.000Z'),
    });
    const source = await ingestor.ingest('https://files.example.com/download?id=42');
    expect(source.kind).toBe('pdf');
    expect(source.body).toContain('synthetic test PDF');
  });

  it('throws PROVIDER on HTTP non-2xx', async () => {
    const ingestor = createPdfIngestor({
      fetchImpl: () => Promise.resolve(new Response('nope', { status: 404 })),
    });
    await expect(ingestor.ingest('https://example.com/missing.pdf')).rejects.toMatchObject({
      code: 'PROVIDER',
    });
  });

  it('throws PROVIDER when content-type is clearly wrong', async () => {
    const ingestor = createPdfIngestor({
      fetchImpl: okPdf(await buildSamplePdf(), 200, 'text/html'),
    });
    await expect(ingestor.ingest('https://example.com/x.pdf')).rejects.toMatchObject({
      code: 'PROVIDER',
    });
  });
});
