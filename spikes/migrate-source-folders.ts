/**
 * One-off: move flat sources/src_*.md files into the right
 * content_type subfolder (sources/tweets/, sources/articles/, etc.)
 * to match the new vault routing convention.
 *
 * Idempotent: a file already in a subfolder is left alone.
 *
 * Run:
 *   pnpm spike spikes/migrate-source-folders.ts
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { parseDocument } from '@x-scraper/core';

const VAULT_ROOT = path.join(os.homedir(), 'Documents', 'x-scraper-vault');
const SOURCES_DIR = path.join(VAULT_ROOT, 'sources');

const SUBFOLDER_FOR: Record<string, string> = {
  tweet: 'tweets',
  article: 'articles',
  repo: 'repos',
  video: 'videos',
  pdf: 'pdfs',
};

const main = (): void => {
  const entries = fs
    .readdirSync(SOURCES_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.startsWith('src_') && e.name.endsWith('.md'));
  console.log(`Found ${String(entries.length)} flat source files to inspect.`);
  let moved = 0;
  let skipped = 0;
  for (const entry of entries) {
    const src = path.join(SOURCES_DIR, entry.name);
    const raw = fs.readFileSync(src, 'utf8');
    const parsed = parseDocument(raw);
    const fm = parsed.frontmatter as { content_type?: unknown };
    const contentType = typeof fm.content_type === 'string' ? fm.content_type : null;
    if (contentType === null) {
      console.warn(`  skip ${entry.name}: no content_type in frontmatter`);
      skipped += 1;
      continue;
    }
    const sub = SUBFOLDER_FOR[contentType];
    if (sub === undefined) {
      console.warn(`  skip ${entry.name}: unknown content_type ${contentType}`);
      skipped += 1;
      continue;
    }
    const targetDir = path.join(SOURCES_DIR, sub);
    fs.mkdirSync(targetDir, { recursive: true });
    const dst = path.join(targetDir, entry.name);
    if (fs.existsSync(dst)) {
      // Already moved (or duplicate). Keep the subfolder copy, drop
      // the flat one.
      fs.unlinkSync(src);
      skipped += 1;
      continue;
    }
    fs.renameSync(src, dst);
    moved += 1;
  }
  console.log(`Migration done: moved=${String(moved)} skipped=${String(skipped)}`);
};

main();
