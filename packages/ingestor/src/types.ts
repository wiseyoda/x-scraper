/**
 * Ingestor port + shared types.
 *
 * An Ingestor takes a URL and returns a normalized IngestedSource that
 * can flow straight into the extractor pipeline.
 */

import type { IngestorKind } from './constants.js';

export interface IngestedSource {
  /** Canonical URL of the source. */
  url: string;
  /** Source kind (article/repo/youtube/pdf). */
  kind: IngestorKind;
  /** Extracted title (when available). */
  title: string | null;
  /** Cleaned plain-text body, ready for extraction. */
  body: string;
  /** Author/byline when the source provides one. */
  byline: string | null;
  /** ISO timestamp the ingestor read the source. */
  capturedAt: string;
  /** Provider-specific metadata; keep small. */
  metadata: Record<string, string | number | null>;
}

export interface Ingestor {
  /** Provider id (e.g. 'article', 'repo'). Useful for metrics. */
  readonly kind: IngestorKind;
  /** Cheap-ish predicate: does this URL belong to me? */
  matches: (url: string) => boolean;
  /** Pull the source. May throw IngestorError on hard failures. */
  ingest: (url: string) => Promise<IngestedSource>;
}

export type IngestorErrorCode =
  | 'CONFIG'
  | 'NOT_FOUND'
  | 'TIMEOUT'
  | 'PROVIDER'
  | 'PARSE'
  | 'EMPTY_BODY'
  | 'UNSUPPORTED_URL'
  | 'UNKNOWN';

export class IngestorError extends Error {
  public readonly code: IngestorErrorCode;
  public override readonly cause: unknown;
  public readonly url: string | null;

  constructor(
    message: string,
    code: IngestorErrorCode,
    options: { cause?: unknown; url?: string | null } = {},
  ) {
    super(message);
    this.name = 'IngestorError';
    this.code = code;
    this.cause = options.cause;
    this.url = options.url ?? null;
  }
}
