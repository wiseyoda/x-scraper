/**
 * Vault — markdown is canonical, git is the audit log.
 *
 * Public surface:
 *   - init(rootDir, options?) -> creates dirs, runs git init, writes .gitignore
 *   - write(record) -> serialises frontmatter + body, writes the .md file,
 *     stages it
 *   - read(id) -> ParsedDocument with validated frontmatter (or throws)
 *   - list(filter) -> Iterable<{ id, type, mtime }>
 *   - commit(message) -> commits any staged changes
 *
 * The hexagonal port (`VaultStore`) lives in this file; the concrete
 * `MarkdownVault` is the only adapter we ship in v1. Other adapters
 * (e.g. an in-memory test fake) implement the same port.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { EntityType, Frontmatter } from '@x-scraper/core';
import {
  CoreError,
  formatDocument,
  FrontmatterSchema,
  parseDocument,
  VAULT_DIRS,
} from '@x-scraper/core';
import { type SimpleGit, simpleGit } from 'simple-git';

import { dirForEntityType, fileBasename, safeJoin } from './paths.js';

const MAX_REPORTED_ISSUES = 3;

const DEFAULT_GITIGNORE = `# x-scraper vault gitignore — keep secrets out
.xscraper/
.env
.env.*
*.log
.DS_Store
`;

export interface VaultRecord {
  frontmatter: Frontmatter;
  body: string;
}

export interface VaultListEntry {
  id: string;
  type: EntityType;
  relativePath: string;
  mtime: Date;
}

export interface VaultInitOptions {
  initialCommit?: boolean;
}

export interface VaultStore {
  root: string;
  init: (options?: VaultInitOptions) => Promise<void>;
  write: (record: VaultRecord) => Promise<string>;
  read: (id: string, type: EntityType) => Promise<VaultRecord>;
  list: (type?: EntityType) => Promise<VaultListEntry[]>;
  commit: (message: string) => Promise<string | null>;
}

const ensureDir = async (dir: string): Promise<void> => {
  await fs.mkdir(dir, { recursive: true });
};

const writeFileAtomic = async (target: string, content: string): Promise<void> => {
  await ensureDir(path.dirname(target));
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, target);
};

// T23: at ~8000 flat files in claims/ readdir + git start to feel slow.
// Once tripped, shard by id prefix (e.g. claims/c_/c_651ef3b1.md) like
// git loose-objects. Until then we just nag.
const CLAIMS_SHARD_WARN_AT = 8_000;
let claimsWarnedThisSession = false;
const maybeWarnClaimDirectorySize = async (claimsDir: string): Promise<void> => {
  if (claimsWarnedThisSession) return;
  try {
    const entries = await fs.readdir(claimsDir);
    if (entries.length >= CLAIMS_SHARD_WARN_AT) {
      claimsWarnedThisSession = true;
      // Plain console.warn — vault has no logger dep. Fine for an
      // operational nag that fires once per process.
      console.warn(
        `[vault] claims/ directory has ${entries.length.toString()} flat files; ` +
          `consider sharding by id prefix (see T23 in HANDOFF).`,
      );
    }
  } catch {
    // claims/ may not exist yet on a fresh init — nothing to warn about.
  }
};

const readJsonSafely = async (file: string): Promise<string | null> => {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
};

export const createMarkdownVault = (root: string): VaultStore => {
  let gitClient: SimpleGit | null = null;
  const git = (): SimpleGit => {
    gitClient ??= simpleGit({ baseDir: root });
    return gitClient;
  };

  const init = async (options: VaultInitOptions = {}): Promise<void> => {
    await ensureDir(root);
    const subdirs = Object.values(VAULT_DIRS) as string[];
    for (const sub of subdirs) {
      await ensureDir(path.join(root, sub));
    }

    const gitignorePath = path.join(root, '.gitignore');
    const wroteGitignore = (await readJsonSafely(gitignorePath)) === null;
    if (wroteGitignore) {
      await writeFileAtomic(gitignorePath, DEFAULT_GITIGNORE);
    }

    const isRepo = await git()
      .checkIsRepo()
      .catch(() => false);
    if (!isRepo) {
      await git().init();
      await git().addConfig('user.name', 'x-scraper');
      await git().addConfig('user.email', 'x-scraper@localhost');
    }

    if (options.initialCommit !== false && wroteGitignore) {
      await git().add(['.gitignore']);
      const status = await git().status();
      if (status.staged.includes('.gitignore')) {
        await git().commit('chore(vault): initial layout', ['.gitignore']);
      }
    }
  };

  const write = async (record: VaultRecord): Promise<string> => {
    const fm = FrontmatterSchema.parse(record.frontmatter);
    // For Source records, route by content_type into the matching
    // sources/<kind>/ subfolder so an article-typed source lands beside
    // its Article entity-stub neighbours instead of in the flat sources/.
    const contentType =
      fm.type === 'Source' && 'content_type' in fm && typeof fm.content_type === 'string'
        ? (fm.content_type)
        : undefined;
    const dir = dirForEntityType(fm.type, contentType);
    const file = safeJoin(root, dir, fileBasename(fm.id));
    const text = formatDocument({
      frontmatter: fm,
      body: record.body,
    });
    await writeFileAtomic(file, text);
    await git()
      .add([path.relative(root, file)])
      .catch(() => undefined);
    // T23 (deferred): warn when the claims/ directory grows past ~8000
    // flat files. At that point shard by id prefix (e.g. claims/c_/...)
    // like git's loose-object layout. Only fired for Claim writes to
    // keep the os.stat cost out of the hot path for other entity types.
    if (fm.type === 'Claim') {
      await maybeWarnClaimDirectorySize(safeJoin(root, dir));
    }
    return path.relative(root, file);
  };

  const read = async (id: string, type: EntityType): Promise<VaultRecord> => {
    // Source.md is sharded by content_type — probe routed subfolders
    // first so a re-written Source (now in sources/<kind>/) wins over
    // any legacy flat copy left from a pre-routing vault. Falling back
    // to the flat sources/ last keeps reindex working on legacy vaults
    // until they're migrated.
    const candidateDirs: string[] =
      type === 'Source'
        ? [
            VAULT_DIRS.sourcesArticles,
            VAULT_DIRS.sourcesTweets,
            VAULT_DIRS.sourcesRepos,
            VAULT_DIRS.sourcesVideos,
            VAULT_DIRS.sourcesPdfs,
            VAULT_DIRS.sources,
          ]
        : [dirForEntityType(type)];
    let raw: string | null = null;
    for (const dir of candidateDirs) {
      const file = safeJoin(root, dir, fileBasename(id));
      raw = await readJsonSafely(file);
      if (raw !== null) break;
    }
    if (raw === null) {
      throw new CoreError(`vault entry not found: ${type} ${id}`, 'NOT_FOUND');
    }
    const parsed = parseDocument(raw);
    const result = FrontmatterSchema.safeParse(parsed.frontmatter);
    if (!result.success) {
      const summary = result.error.issues
        .slice(0, MAX_REPORTED_ISSUES)
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      throw new CoreError(
        `invalid frontmatter for ${id}: ${summary}`,
        'INVALID_FRONTMATTER',
        result.error,
      );
    }
    return { frontmatter: result.data, body: parsed.body };
  };

  const listInDir = async (
    relDir: string,
    typeOverride?: EntityType,
  ): Promise<VaultListEntry[]> => {
    const abs = safeJoin(root, relDir);
    const exists = await fs
      .stat(abs)
      .then(() => true)
      .catch(() => false);
    if (!exists) return [];
    const out: VaultListEntry[] = [];
    const entries = await fs.readdir(abs, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const file = path.join(abs, entry.name);
      const raw = await readJsonSafely(file);
      if (raw === null) continue;
      const parsed = parseDocument(raw);
      const fmCandidate = parsed.frontmatter as { id?: unknown; type?: unknown };
      const id = typeof fmCandidate.id === 'string' ? fmCandidate.id : null;
      const fmType = typeof fmCandidate.type === 'string' ? (fmCandidate.type as EntityType) : null;
      if (id === null || fmType === null) continue;
      if (typeOverride !== undefined && fmType !== typeOverride) continue;
      const stat = await fs.stat(file);
      out.push({ id, type: fmType, relativePath: path.relative(root, file), mtime: stat.mtime });
    }
    return out;
  };

  const list = async (type?: EntityType): Promise<VaultListEntry[]> => {
    const allDirs = Object.values(VAULT_DIRS) as string[];
    const dirs =
      type === undefined
        ? new Set<string>(allDirs.filter((d) => !d.startsWith('.')))
        : type === 'Source'
          ? // Iterate routed subdirs first so the dedupe-by-id below
            // prefers the routed copy of any Source whose flat legacy
            // sibling still exists in sources/.
            new Set<string>([
              VAULT_DIRS.sourcesArticles,
              VAULT_DIRS.sourcesTweets,
              VAULT_DIRS.sourcesRepos,
              VAULT_DIRS.sourcesVideos,
              VAULT_DIRS.sourcesPdfs,
              VAULT_DIRS.sources,
            ])
          : new Set<string>([dirForEntityType(type)]);
    const all: VaultListEntry[] = [];
    const seenIds = new Set<string>();
    for (const d of dirs) {
      for (const entry of await listInDir(d, type)) {
        if (seenIds.has(entry.id)) continue;
        seenIds.add(entry.id);
        all.push(entry);
      }
    }
    return all.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  };

  const commit = async (message: string): Promise<string | null> => {
    const status = await git().status();
    if (status.staged.length === 0) return null;
    const result = await git().commit(message);
    return result.commit;
  };

  return { root, init, write, read, list, commit };
};
