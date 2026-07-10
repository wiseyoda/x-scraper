/**
 * Per-source user state — read/unread, plus tags. Stored at
 * <vault>/.xscraper/source-state.json so it lives alongside pins but
 * stays separate from corpus state.
 *
 * Single-user, low-write-frequency, atomic-via-rename. Same trade-offs
 * as pins.ts.
 */

import 'server-only';

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { resolveWebUiConfig } from './config';

export interface SourceState {
  /** ISO timestamp the user opened this source's detail page. */
  readAt: string | null;
  /** Free-form tags. */
  tags: string[];
}

interface StateFile {
  version: 1;
  /** Map keyed by source id. */
  state: Record<string, SourceState>;
}

const FILE_VERSION = 1;
const STATE_DIR = '.xscraper';
const STATE_FILE = 'source-state.json';
const MAX_TAG_LEN = 40;
const MAX_TAGS_PER_SOURCE = 20;

const statePath = (): string => path.join(resolveWebUiConfig().vaultDir, STATE_DIR, STATE_FILE);

const ensureDir = async (file: string): Promise<void> => {
  await fs.mkdir(path.dirname(file), { recursive: true });
};

const readFile = async (): Promise<StateFile> => {
  try {
    const raw = await fs.readFile(statePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<StateFile>;
    if (parsed.version !== FILE_VERSION) {
      return { version: FILE_VERSION, state: {} };
    }
    return {
      version: FILE_VERSION,
      state:
        parsed.state !== undefined && typeof parsed.state === 'object' && parsed.state !== null
          ? (parsed.state as Record<string, SourceState>)
          : {},
    };
  } catch {
    return { version: FILE_VERSION, state: {} };
  }
};

const writeFile = async (data: StateFile): Promise<void> => {
  const target = statePath();
  await ensureDir(target);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, target);
};

const ensureRecord = (data: StateFile, id: string): SourceState => {
  let s = data.state[id];
  if (s === undefined) {
    s = { readAt: null, tags: [] };
    data.state[id] = s;
  }
  return s;
};

export const getSourceState = async (id: string): Promise<SourceState> => {
  const data = await readFile();
  return data.state[id] ?? { readAt: null, tags: [] };
};

export const allSourceState = async (): Promise<Record<string, SourceState>> => {
  const data = await readFile();
  return data.state;
};

export const markRead = async (id: string): Promise<void> => {
  const data = await readFile();
  const s = ensureRecord(data, id);
  s.readAt = new Date().toISOString();
  await writeFile(data);
};

export const markUnread = async (id: string): Promise<void> => {
  const data = await readFile();
  const s = data.state[id];
  if (s === undefined) return;
  s.readAt = null;
  await writeFile(data);
};

export const toggleRead = async (id: string): Promise<{ readAt: string | null }> => {
  const data = await readFile();
  const s = ensureRecord(data, id);
  s.readAt = s.readAt === null ? new Date().toISOString() : null;
  await writeFile(data);
  return { readAt: s.readAt };
};

const sanitizeTag = (raw: string): string => raw.trim().slice(0, MAX_TAG_LEN).replace(/\s+/g, ' ');

export const setTags = async (id: string, tags: string[]): Promise<string[]> => {
  const data = await readFile();
  const s = ensureRecord(data, id);
  const cleaned = Array.from(
    new Set(
      tags
        .map(sanitizeTag)
        .filter((t) => t.length > 0)
        .slice(0, MAX_TAGS_PER_SOURCE),
    ),
  );
  s.tags = cleaned;
  await writeFile(data);
  return cleaned;
};

export const addTag = async (id: string, tag: string): Promise<string[]> => {
  const cur = await getSourceState(id);
  return setTags(id, [...cur.tags, tag]);
};

export const removeTag = async (id: string, tag: string): Promise<string[]> => {
  const cur = await getSourceState(id);
  return setTags(
    id,
    cur.tags.filter((t) => t !== tag),
  );
};

/**
 * Distinct sorted set of every tag the user has ever applied. Useful
 * for the inbox tag-filter dropdown.
 */
export const allTags = async (): Promise<string[]> => {
  const data = await readFile();
  const set = new Set<string>();
  for (const v of Object.values(data.state)) {
    for (const t of v.tags) set.add(t);
  }
  return [...set].sort();
};
