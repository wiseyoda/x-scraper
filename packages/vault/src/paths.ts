/**
 * Path safety. The vault is the only place we write user data; any path
 * we accept from outside (CLI args, MCP/REST callers, frontmatter
 * cross-references) is normalised and confined to the vault root via
 * `safeJoin`. Symlinks that escape are rejected.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { CoreError, type EntityType, VAULT_DIRS } from '@x-scraper/core';

/** Source.content_type → subdirectory mapping inside sources/. */
export type SourceContentType = 'tweet' | 'article' | 'repo' | 'video' | 'pdf';
const SOURCE_CONTENT_DIR: Record<SourceContentType, string> = {
  tweet: VAULT_DIRS.sourcesTweets,
  article: VAULT_DIRS.sourcesArticles,
  repo: VAULT_DIRS.sourcesRepos,
  video: VAULT_DIRS.sourcesVideos,
  pdf: VAULT_DIRS.sourcesPdfs,
};

const PATH_RELATIVE_PREFIX = '..';
const FORBIDDEN_ID_CHARS = ['/', '\\', '\0'] as const;

const deepestExistingAncestor = (target: string): string => {
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
};

export const safeJoin = (root: string, ...parts: string[]): string => {
  // Reject any absolute path component — `path.join` would silently
  // anchor it to the supplied root.
  for (const p of parts) {
    if (path.isAbsolute(p)) {
      throw new CoreError(`absolute path component not allowed: ${p}`, 'PATH_TRAVERSAL');
    }
  }
  const joined = path.join(root, ...parts);
  const resolved = path.resolve(joined);
  const resolvedRoot = path.resolve(root);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new CoreError(`path escapes vault root: ${joined}`, 'PATH_TRAVERSAL');
  }
  // Reject symlinks that escape the root. We can't realpath() a path
  // whose tail doesn't exist yet, so realpath the deepest existing
  // ancestor — this catches a symlinked intermediate dir.
  const ancestor = deepestExistingAncestor(resolved);
  const realAncestor = fs.realpathSync(ancestor);
  const realRoot = fs.realpathSync(resolvedRoot);
  if (realAncestor !== realRoot && !realAncestor.startsWith(`${realRoot}${path.sep}`)) {
    throw new CoreError(`symlink escapes vault root: ${joined}`, 'PATH_TRAVERSAL');
  }
  return resolved;
};

export const fileBasename = (id: string): string => {
  for (const ch of FORBIDDEN_ID_CHARS) {
    if (id.includes(ch)) {
      throw new CoreError(`invalid id for filename: ${id}`, 'PATH_TRAVERSAL');
    }
  }
  if (id.includes(PATH_RELATIVE_PREFIX) || id.includes(path.sep)) {
    throw new CoreError(`invalid id for filename: ${id}`, 'PATH_TRAVERSAL');
  }
  return `${id}.md`;
};

export const dirForEntityType = (type: EntityType, contentType?: SourceContentType): string => {
  switch (type) {
    case 'Source':
      // Route by content_type so tweet/article/repo/video/pdf sources
      // land beside their Article/Tweet/etc. entity-stub neighbours
      // (sources/articles/, sources/tweets/, etc). Falls back to the
      // flat sources/ dir only when content_type is missing — every
      // production write supplies it.
      return contentType !== undefined ? SOURCE_CONTENT_DIR[contentType] : VAULT_DIRS.sources;
    case 'Tweet':
      return VAULT_DIRS.sourcesTweets;
    case 'Article':
      return VAULT_DIRS.sourcesArticles;
    case 'Repo':
      return VAULT_DIRS.sourcesRepos;
    case 'Video':
      return VAULT_DIRS.sourcesVideos;
    case 'PDF':
      return VAULT_DIRS.sourcesPdfs;
    case 'Claim':
      return VAULT_DIRS.claims;
    case 'Topic':
      return VAULT_DIRS.topics;
    case 'Person':
    case 'Tool':
    case 'Concept':
      return VAULT_DIRS.entities;
    default: {
      const exhaustive: never = type;
      throw new CoreError(`unknown entity type: ${String(exhaustive)}`, 'UNKNOWN');
    }
  }
};
