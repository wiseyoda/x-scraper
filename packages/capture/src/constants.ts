/**
 * Capture-package constants.
 *
 * The capture cache lives at <vaultDir>/.cache/raw/<sha256>.json. Putting
 * it under the vault keeps it on the same volume as everything else (so
 * a vault tarball includes captures), and the .cache/ subdir is in
 * .gitignore so checkouts stay light.
 */

export const CAPTURE_CACHE_SUBDIR = '.cache/raw';

/** Capture format version. Bump when CapturedSource shape changes incompatibly. */
export const CAPTURE_SCHEMA_VERSION = 1;

/** Default cap on how many bytes of raw HTML we keep per article. Higher than
 *  ingestor's MAX_BODY_CHARS because raw includes wrapper markup. */
export const MAX_RAW_HTML_BYTES = 2_000_000;

/** PDF capture cap — most academic papers are well under this. */
export const MAX_PDF_BYTES = 25_000_000;
