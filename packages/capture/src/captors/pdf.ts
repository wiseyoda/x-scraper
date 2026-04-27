/**
 * PDF captor — fetch bytes once, store them base64-encoded, and keep
 * per-page extracted text alongside. Re-OCR / re-extraction can run
 * against the stored bytes without re-downloading.
 */

import { Buffer } from 'node:buffer';

import { canonicalizeUrl } from '@x-scraper/core';
import type { FetchOptions } from '@x-scraper/ingestor';
import { DEFAULT_PDF_MAX_PAGES, extractPdfPagesText, extractPdfText } from '@x-scraper/ingestor';

import { CAPTURE_SCHEMA_VERSION, MAX_PDF_BYTES } from '../constants.js';
import { type Captor, CaptureError, type PdfCaptured } from '../types.js';

const PDF_PATH_SUFFIX = '.pdf';

const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

export interface PdfCaptorConfig extends FetchOptions {
  now?: () => Date;
  maxPages?: number;
}

const isHttpPdfUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return parsed.pathname.toLowerCase().endsWith(PDF_PATH_SUFFIX);
  } catch {
    return false;
  }
};

const fetchPdfBytes = async (url: string, options: PdfCaptorConfig): Promise<Uint8Array> => {
  const fetchImpl = options.fetchImpl ?? ((u: string, i?: RequestInit) => fetch(u, i));
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const resp = await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        accept: options.accept ?? 'application/pdf,*/*',
        ...options.headers,
      },
    });
    if (!resp.ok) {
      throw new CaptureError(`HTTP ${String(resp.status)} fetching ${url}`, 'PROVIDER', {
        url,
        httpStatus: resp.status,
      });
    }
    const buf = await resp.arrayBuffer();
    return new Uint8Array(buf);
  } catch (err) {
    if (err instanceof CaptureError) throw err;
    const isAbort = err instanceof Error && err.name === 'AbortError';
    throw new CaptureError(
      isAbort ? `fetch timed out after ${String(timeoutMs)}ms: ${url}` : `fetch failed: ${url}`,
      isAbort ? 'TIMEOUT' : 'UNKNOWN',
      { cause: err, url },
    );
  } finally {
    clearTimeout(timer);
  }
};

export const createPdfCaptor = (config: PdfCaptorConfig = {}): Captor => {
  const now = config.now ?? ((): Date => new Date());
  const maxPages = config.maxPages ?? DEFAULT_PDF_MAX_PAGES;

  const matches = (url: string): boolean => isHttpPdfUrl(url);

  const capture = async (url: string): Promise<PdfCaptured> => {
    if (!isHttpPdfUrl(url)) {
      throw new CaptureError(`unsupported URL: ${url}`, 'UNSUPPORTED_URL', { url });
    }
    const bytes = await fetchPdfBytes(url, config);
    if (bytes.byteLength > MAX_PDF_BYTES) {
      throw new CaptureError(
        `PDF too large (${String(bytes.byteLength)} > ${String(MAX_PDF_BYTES)} bytes) for ${url}`,
        'PROVIDER',
        { url },
      );
    }
    let pages: string[];
    try {
      pages = await extractPdfPagesText(bytes, url, maxPages);
    } catch (err) {
      throw new CaptureError(`PDF parse failed for ${url}`, 'PARSE', { url, cause: err });
    }
    // Reuse the ingestor's title/body extraction so the parsed shape
    // is identical to legacy IngestedSource.
    const parsed = await extractPdfText(bytes, url, maxPages);
    return {
      schema_version: CAPTURE_SCHEMA_VERSION,
      url,
      canonical_url: canonicalizeUrl(url),
      fetched_at: now().toISOString(),
      http_status: 200,
      captor: 'pdf',
      content_type: 'pdf',
      raw_pdf_b64: Buffer.from(bytes).toString('base64'),
      raw_text_per_page: pages,
      page_count: parsed.pageCount,
      parsed: {
        title: parsed.title,
        byline: null,
        body: parsed.body,
      },
    };
  };

  return { id: 'pdf', matches, capture };
};
