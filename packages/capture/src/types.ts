/**
 * CapturedSource — the durable raw-artifact shape stored in the capture
 * cache. Discriminated union by content_type. Each variant keeps both
 * the raw bytes/text we fetched AND the lightweight parsed view that
 * the extractor pipeline consumes.
 *
 * Why both?
 *  - raw_*: source of truth. Lets us re-run a better parser without
 *    re-hitting the network. PDF re-OCR, video re-transcription, HTML
 *    re-Readability — all become offline operations.
 *  - parsed.*: cheap to materialize back into the IngestedSource shape
 *    the existing extractor wants. Also lets older callers read cached
 *    data without knowing how to parse the raw form themselves.
 */

import { z } from 'zod';

const CommonShape = {
  /** Capture-format version; bump on shape-incompatible changes. */
  schema_version: z.number().int().nonnegative(),
  /** URL as the user / scraper provided it (pre-canonicalization). */
  url: z.string().min(1),
  /** Canonical form used as the cache key. */
  canonical_url: z.string().min(1),
  /** ISO timestamp the capture completed. */
  fetched_at: z.iso.datetime(),
  /** HTTP status of the primary fetch (or 0 for ingestor-internal). */
  http_status: z.number().int(),
  /** Captor id that produced this entry — useful for observability. */
  captor: z.string().min(1),
} as const;

const ParsedCommonShape = {
  title: z.string().nullable(),
  byline: z.string().nullable(),
  /** Cleaned plain-text body for the LLM. Always populated; clamped. */
  body: z.string(),
} as const;

export const ArticleCapturedSchema = z.object({
  ...CommonShape,
  content_type: z.literal('article'),
  raw_html: z.string(),
  parsed: z.object({
    ...ParsedCommonShape,
  }),
});
export type ArticleCaptured = z.infer<typeof ArticleCapturedSchema>;

export const RepoCapturedSchema = z.object({
  ...CommonShape,
  content_type: z.literal('repo'),
  /** GitHub /repos response, raw JSON text. */
  raw_repo_json: z.string(),
  /** GitHub /readme decoded markdown text (empty when no README). */
  raw_readme_md: z.string(),
  parsed: z.object({
    ...ParsedCommonShape,
    metadata: z.object({
      owner: z.string(),
      repo: z.string(),
      default_branch: z.string(),
      stars: z.number().int().nullable(),
      language: z.string().nullable(),
    }),
  }),
});
export type RepoCaptured = z.infer<typeof RepoCapturedSchema>;

export const YouTubeCapturedSchema = z.object({
  ...CommonShape,
  content_type: z.literal('youtube'),
  /** Raw watch-page HTML (player response embedded inside). */
  raw_watch_html: z.string(),
  /** Raw caption XML (the timed-text form YouTube serves). */
  raw_caption_xml: z.string(),
  /** Per-segment transcript with timing. */
  transcript_segments: z.array(
    z.object({
      start_sec: z.number(),
      duration_sec: z.number(),
      text: z.string(),
    }),
  ),
  parsed: z.object({
    ...ParsedCommonShape,
    metadata: z.object({
      video_id: z.string(),
      language: z.string(),
      duration_sec: z.number().nullable(),
    }),
  }),
});
export type YouTubeCaptured = z.infer<typeof YouTubeCapturedSchema>;

export const PdfCapturedSchema = z.object({
  ...CommonShape,
  content_type: z.literal('pdf'),
  /** Base64-encoded PDF bytes. */
  raw_pdf_b64: z.string(),
  /** Per-page extracted text (may be empty for image-only pages). */
  raw_text_per_page: z.array(z.string()),
  page_count: z.number().int().nonnegative(),
  parsed: z.object({
    ...ParsedCommonShape,
  }),
});
export type PdfCaptured = z.infer<typeof PdfCapturedSchema>;

export const XArticleCapturedSchema = z.object({
  ...CommonShape,
  content_type: z.literal('x_article'),
  /** Patchright-rendered DOM HTML at capture time. */
  raw_html: z.string(),
  /** Article blocks the X Article ingestor split out
   *  (paragraphs / headings / blockquotes / images). */
  blocks: z.array(
    z.object({
      kind: z.string(),
      text: z.string(),
    }),
  ),
  parsed: z.object({
    ...ParsedCommonShape,
    metadata: z.object({
      tweet_id: z.string().nullable(),
    }),
  }),
});
export type XArticleCaptured = z.infer<typeof XArticleCapturedSchema>;

export const TweetCapturedSchema = z.object({
  ...CommonShape,
  content_type: z.literal('tweet'),
  /** Pre-fetched tweet text from the bookmark scraper. No network step. */
  raw_text: z.string(),
  parsed: z.object({
    ...ParsedCommonShape,
    metadata: z.object({
      tweet_id: z.string().nullable(),
    }),
  }),
});
export type TweetCaptured = z.infer<typeof TweetCapturedSchema>;

export const CapturedSourceSchema = z.discriminatedUnion('content_type', [
  ArticleCapturedSchema,
  RepoCapturedSchema,
  YouTubeCapturedSchema,
  PdfCapturedSchema,
  XArticleCapturedSchema,
  TweetCapturedSchema,
]);
export type CapturedSource = z.infer<typeof CapturedSourceSchema>;

export type CaptureContentType = CapturedSource['content_type'];

export interface Captor {
  /** Captor id for logging / cache attribution. */
  readonly id: string;
  /** Cheap-ish predicate: does this URL belong to me? */
  matches: (url: string) => boolean;
  /** Pull the raw artifact + lightweight parsed view. */
  capture: (url: string) => Promise<CapturedSource>;
  /** Optional: release any held resources (browser sessions, sockets). */
  dispose?: () => Promise<void>;
}

export type CaptureErrorCode =
  | 'CONFIG'
  | 'NOT_FOUND'
  | 'TIMEOUT'
  | 'PROVIDER'
  | 'PARSE'
  | 'EMPTY_BODY'
  | 'UNSUPPORTED_URL'
  | 'CACHE_IO'
  | 'UNKNOWN';

export class CaptureError extends Error {
  public readonly code: CaptureErrorCode;
  public override readonly cause: unknown;
  public readonly url: string | null;
  public readonly httpStatus: number | null;

  constructor(
    message: string,
    code: CaptureErrorCode,
    options: { cause?: unknown; url?: string | null; httpStatus?: number | null } = {},
  ) {
    super(message);
    this.name = 'CaptureError';
    this.code = code;
    this.cause = options.cause;
    this.url = options.url ?? null;
    this.httpStatus = options.httpStatus ?? null;
  }
}
