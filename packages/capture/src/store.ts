/**
 * Content-addressed cache for CapturedSource.
 *
 * Key: sha256 hex of the canonical URL. Stable, collision-resistant,
 * filesystem-safe.
 *
 * On-disk layout:
 *   <vaultDir>/.cache/raw/<sha256>.json
 *
 * Why a single JSON file per source?
 *  - Atomic writes (rename) keep concurrent captures from observing
 *    half-written files.
 *  - Easy to inspect by hand: `jq` over a hash gives you everything we
 *    captured for that URL.
 *  - No SQLite second copy of state — captures live on the same volume
 *    as the vault and ride along in any vault tarball backup.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { canonicalizeUrl } from '@x-scraper/core';

import { CAPTURE_CACHE_SUBDIR } from './constants.js';
import { type CapturedSource, CapturedSourceSchema, CaptureError } from './types.js';

const KEY_HEX_LEN = 64;

const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

export const captureKeyForUrl = (url: string): string => {
  let canonical: string;
  try {
    canonical = canonicalizeUrl(url);
  } catch {
    // Fall back to raw URL when canonicalization fails (bad URL strings
    // get the same key as themselves rather than throwing — the captor
    // will reject them at fetch time).
    canonical = url;
  }
  return sha256Hex(canonical);
};

export interface CaptureRecord {
  key: string;
  canonical_url: string;
  content_type: CapturedSource['content_type'];
  fetched_at: string;
  /** Absolute filesystem path of the cache entry. */
  path: string;
}

export interface CaptureStore {
  /** Returns the absolute path the cache would use for a URL. */
  pathFor: (canonicalUrl: string) => string;
  /** True iff a capture exists for this canonical URL. */
  has: (canonicalUrl: string) => Promise<boolean>;
  /** Read a cached capture, or null if not present. Validates with Zod. */
  read: (canonicalUrl: string) => Promise<CapturedSource | null>;
  /** Atomically write a capture. Overwrites prior content. */
  write: (captured: CapturedSource) => Promise<string>;
  /** List every cached entry. Lightweight — does not parse the body. */
  list: () => Promise<CaptureRecord[]>;
  /** Delete a single capture (used by tests / forced re-capture). */
  remove: (canonicalUrl: string) => Promise<boolean>;
}

export interface CaptureStoreOptions {
  /** Vault root. Cache lands at <vaultDir>/.cache/raw/. */
  vaultDir: string;
}

export const createCaptureStore = (options: CaptureStoreOptions): CaptureStore => {
  const root = path.join(options.vaultDir, CAPTURE_CACHE_SUBDIR);

  const pathFor = (canonicalUrl: string): string => {
    const key = sha256Hex(canonicalUrl);
    return path.join(root, `${key}.json`);
  };

  const has = async (canonicalUrl: string): Promise<boolean> => {
    try {
      await fs.stat(pathFor(canonicalUrl));
      return true;
    } catch {
      return false;
    }
  };

  const read = async (canonicalUrl: string): Promise<CapturedSource | null> => {
    let text: string;
    try {
      text = await fs.readFile(pathFor(canonicalUrl), 'utf8');
    } catch (err) {
      if (
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'ENOENT'
      ) {
        return null;
      }
      throw new CaptureError(`failed reading capture for ${canonicalUrl}`, 'CACHE_IO', {
        cause: err,
        url: canonicalUrl,
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new CaptureError(`malformed capture JSON for ${canonicalUrl}`, 'CACHE_IO', {
        cause: err,
        url: canonicalUrl,
      });
    }
    const result = CapturedSourceSchema.safeParse(parsed);
    if (!result.success) {
      throw new CaptureError(`capture failed schema for ${canonicalUrl}`, 'CACHE_IO', {
        cause: result.error,
        url: canonicalUrl,
      });
    }
    return result.data;
  };

  const write = async (captured: CapturedSource): Promise<string> => {
    const validated = CapturedSourceSchema.parse(captured);
    await fs.mkdir(root, { recursive: true });
    const target = pathFor(validated.canonical_url);
    const tmp = `${target}.tmp.${process.pid.toString()}.${Date.now().toString()}`;
    await fs.writeFile(tmp, JSON.stringify(validated, null, 2), 'utf8');
    await fs.rename(tmp, target);
    return target;
  };

  const list = async (): Promise<CaptureRecord[]> => {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(root);
    } catch (err) {
      if (
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'ENOENT'
      ) {
        return [];
      }
      throw err;
    }
    const records: CaptureRecord[] = [];
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const key = name.slice(0, -'.json'.length);
      if (key.length !== KEY_HEX_LEN) continue;
      const filePath = path.join(root, name);
      let text: string;
      try {
        text = await fs.readFile(filePath, 'utf8');
      } catch {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      // Pull just the cheap fields without running the full Zod parse — list()
      // is meant for indexing, not loading. Callers use read() when they
      // want validation.
      if (parsed === null || typeof parsed !== 'object') continue;
      const obj = parsed as Record<string, unknown>;
      const canonical = typeof obj.canonical_url === 'string' ? obj.canonical_url : null;
      const ct = typeof obj.content_type === 'string' ? obj.content_type : null;
      const fa = typeof obj.fetched_at === 'string' ? obj.fetched_at : null;
      if (canonical === null || ct === null || fa === null) continue;
      records.push({
        key,
        canonical_url: canonical,
        content_type: ct as CapturedSource['content_type'],
        fetched_at: fa,
        path: filePath,
      });
    }
    return records;
  };

  const remove = async (canonicalUrl: string): Promise<boolean> => {
    try {
      await fs.unlink(pathFor(canonicalUrl));
      return true;
    } catch (err) {
      if (
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'ENOENT'
      ) {
        return false;
      }
      throw err;
    }
  };

  return { pathFor, has, read, write, list, remove };
};
