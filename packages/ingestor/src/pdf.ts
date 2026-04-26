/**
 * PDF ingestor — pdfjs-dist over fetched bytes.
 *
 * Heuristics: matches on .pdf path or application/pdf content-type. We fetch
 * once, sniff the type, then hand the buffer to pdfjs's getDocument and
 * concatenate the text content of every page.
 *
 * Like the article ingestor, this is dependency-light and runs without a
 * browser — pdfjs's legacy build provides a Node-friendly entry that does
 * not pull in DOM-only APIs.
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
  MAX_BODY_CHARS,
  MIN_BODY_CHARS,
} from './constants.js';
import { type FetchLike, type FetchOptions } from './http.js';
import { type IngestedSource, type Ingestor, IngestorError } from './types.js';

export interface PdfConfig extends FetchOptions {
  /** Override the now() fn for deterministic tests. */
  now?: () => Date;
  /** Cap the number of pages we read; protects against pathological inputs. */
  maxPages?: number;
}

export const DEFAULT_PDF_MAX_PAGES = 200;

const PDF_PATH_SUFFIX = '.pdf';
const PDF_CONTENT_TYPE = 'application/pdf';

const isHttpPdfUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const lowerPath = parsed.pathname.toLowerCase();
    return lowerPath.endsWith(PDF_PATH_SUFFIX);
  } catch {
    return false;
  }
};

const clamp = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

const fetchPdfBytes = async (
  url: string,
  options: FetchOptions = {},
): Promise<{ bytes: Uint8Array; contentType: string | null }> => {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((u, i) => fetch(u, i));
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
        'user-agent': DEFAULT_USER_AGENT,
        accept: options.accept ?? 'application/pdf,*/*',
        ...options.headers,
      },
    });
    if (!resp.ok) {
      throw new IngestorError(`HTTP ${String(resp.status)} fetching ${url}`, 'PROVIDER', {
        url,
        httpStatus: resp.status,
      });
    }
    const buf = await resp.arrayBuffer();
    clearTimeout(timer);
    return { bytes: new Uint8Array(buf), contentType: resp.headers.get('content-type') };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof IngestorError) throw err;
    const isAbort = err instanceof Error && err.name === 'AbortError';
    throw new IngestorError(
      isAbort ? `fetch timed out after ${String(timeoutMs)}ms: ${url}` : `fetch failed: ${url}`,
      isAbort ? 'TIMEOUT' : 'UNKNOWN',
      { cause: err, url },
    );
  }
};

interface PdfTextItem {
  str?: unknown;
}
interface PdfTextContent {
  items?: PdfTextItem[];
}
interface PdfPage {
  getTextContent: () => Promise<PdfTextContent>;
  cleanup?: () => void;
}
interface PdfDocument {
  numPages: number;
  getPage: (i: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
}

const itemText = (item: PdfTextItem): string => (typeof item.str === 'string' ? item.str : '');

export const extractPdfText = async (
  bytes: Uint8Array,
  url: string,
  maxPages: number = DEFAULT_PDF_MAX_PAGES,
): Promise<{ title: string | null; body: string; pageCount: number }> => {
  let doc: PdfDocument | undefined;
  try {
    // pdfjs's TS definitions for the legacy build aren't ideal under Node ESM;
    // the runtime contract (numPages, getPage, getTextContent) is what we
    // actually depend on, so we narrow with our own minimal interface above.
    const loadingTask = getDocument({ data: bytes, useSystemFonts: false }) as unknown as {
      promise: Promise<PdfDocument>;
    };
    doc = await loadingTask.promise;
    const pages: string[] = [];
    const limit = Math.min(doc.numPages, maxPages);
    for (let i = 1; i <= limit; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const items = content.items ?? [];
      const pageText = items
        .map((it) => itemText(it))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      pages.push(pageText);
      page.cleanup?.();
    }
    const body = pages.join('\n\n').trim();
    if (body.length < MIN_BODY_CHARS) {
      throw new IngestorError(
        `extracted PDF body too short (${String(body.length)} < ${String(MIN_BODY_CHARS)}) for ${url}`,
        'EMPTY_BODY',
        { url },
      );
    }
    // PDF metadata titles are unreliable; extractor uses h1-ish heuristics
    // off the body anyway. Leave title null and let downstream prompt-based
    // titling fill it in.
    return { title: null, body: clamp(body, MAX_BODY_CHARS), pageCount: limit };
  } catch (err) {
    if (err instanceof IngestorError) throw err;
    throw new IngestorError(`PDF parse failed for ${url}`, 'PARSE', { cause: err, url });
  } finally {
    await doc?.destroy().catch(() => undefined);
  }
};

export const createPdfIngestor = (config: PdfConfig = {}): Ingestor => {
  const now = config.now ?? ((): Date => new Date());
  const maxPages = config.maxPages ?? DEFAULT_PDF_MAX_PAGES;

  // matches() only returns true for .pdf paths so the dispatcher routes them
  // to us before the catch-all article ingestor. ingest() is more permissive:
  // it accepts any http(s) URL and confirms via Content-Type sniffing, which
  // lets callers explicitly route signed download URLs and CDN-hashed paths
  // that don't end in .pdf but actually serve application/pdf.
  const matches = (url: string): boolean => isHttpPdfUrl(url);

  const isHttpUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  };

  const ingest = async (url: string): Promise<IngestedSource> => {
    if (!isHttpUrl(url)) {
      throw new IngestorError(`unsupported URL: ${url}`, 'UNSUPPORTED_URL', { url });
    }
    const { bytes, contentType } = await fetchPdfBytes(url, config);
    if (
      contentType !== null &&
      !contentType.toLowerCase().includes(PDF_CONTENT_TYPE) &&
      !contentType.toLowerCase().includes('octet-stream')
    ) {
      throw new IngestorError(
        `expected application/pdf, got ${contentType} from ${url}`,
        'PROVIDER',
        { url },
      );
    }
    const parsed = await extractPdfText(bytes, url, maxPages);
    return {
      url,
      kind: 'pdf',
      title: parsed.title,
      body: parsed.body,
      byline: null,
      capturedAt: now().toISOString(),
      metadata: {
        pageCount: parsed.pageCount,
        contentType: contentType ?? null,
      },
    };
  };

  return { kind: 'pdf', matches, ingest };
};
