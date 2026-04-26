import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { CoreError } from '@x-scraper/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dirForEntityType, fileBasename, safeJoin } from '../paths.js';

let root = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'xscraper-paths-test-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('safeJoin', () => {
  it('joins paths under the root', () => {
    expect(safeJoin(root, 'sources', 'a.md')).toBe(path.resolve(root, 'sources/a.md'));
  });

  it('rejects parent-directory traversal', () => {
    expect(() => safeJoin(root, '..', 'evil')).toThrow(CoreError);
  });

  it('rejects absolute paths that escape the root', () => {
    expect(() => safeJoin(root, '/etc/passwd')).toThrow(CoreError);
  });

  it('rejects symlinks that escape the root', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'outside-'));
    const linkPath = path.join(root, 'link');
    await fs.symlink(outside, linkPath);
    try {
      expect(() => safeJoin(root, 'link', 'inside-target')).toThrow(CoreError);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

describe('fileBasename', () => {
  it('appends .md', () => {
    expect(fileBasename('src_abc')).toBe('src_abc.md');
  });

  it('rejects ids with path separators or .. tokens', () => {
    expect(() => fileBasename('src/../escape')).toThrow(CoreError);
    expect(() => fileBasename('src\\backslash')).toThrow(CoreError);
  });
});

describe('dirForEntityType', () => {
  it('routes types to their canonical directories', () => {
    expect(dirForEntityType('Source')).toBe('sources');
    expect(dirForEntityType('Tweet')).toBe('sources/tweets');
    expect(dirForEntityType('Article')).toBe('sources/articles');
    expect(dirForEntityType('Claim')).toBe('claims');
    expect(dirForEntityType('Topic')).toBe('topics');
    expect(dirForEntityType('Tool')).toBe('entities');
  });
});
