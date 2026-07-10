/**
 * Personal pin layer.
 *
 * Pins are the user's "save for later" / "this matters to me" signal —
 * separate from auto-confirm (which is the system's judgment). Stored
 * at <vault>/.xscraper/pins.json so they live alongside the corpus
 * but don't pollute the markdown frontmatter or get committed by the
 * vault auto-commit (.xscraper/ is in the default vault gitignore).
 *
 * The file is never large — single user, low write frequency. We use
 * read/parse/rewrite atomic-via-rename, no locking. Concurrent writes
 * are accepted as last-writer-wins; this is a single-tab personal app.
 */

import 'server-only';

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { EntityType } from '@x-scraper/core';

import { resolveWebUiConfig } from './config';

export interface Pin {
  id: string;
  kind: EntityType;
  pinnedAt: string;
  /** Free-form note. Kept short (<=500 chars). */
  note: string | null;
  /** Last time the user opened this item's detail page. */
  lastVisitedAt: string | null;
}

interface PinsFile {
  version: 1;
  pins: Pin[];
}

const FILE_VERSION = 1;
const PINS_DIR = '.xscraper';
const PINS_FILE = 'pins.json';
const MAX_NOTE_CHARS = 500;
const STALE_DAYS = 14;

const pinsPath = (): string => path.join(resolveWebUiConfig().vaultDir, PINS_DIR, PINS_FILE);

const ensureDir = async (file: string): Promise<void> => {
  await fs.mkdir(path.dirname(file), { recursive: true });
};

const readFile = async (): Promise<PinsFile> => {
  try {
    const raw = await fs.readFile(pinsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<PinsFile>;
    if (parsed.version !== FILE_VERSION) {
      // Future migrations land here. For now we only have v1.
      return { version: FILE_VERSION, pins: [] };
    }
    return {
      version: FILE_VERSION,
      pins: Array.isArray(parsed.pins) ? parsed.pins : [],
    };
  } catch {
    return { version: FILE_VERSION, pins: [] };
  }
};

const writeFile = async (data: PinsFile): Promise<void> => {
  const target = pinsPath();
  await ensureDir(target);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, target);
};

export const listPins = async (): Promise<Pin[]> => {
  const data = await readFile();
  return data.pins.slice().sort((a, b) => b.pinnedAt.localeCompare(a.pinnedAt));
};

export const isPinned = async (id: string): Promise<boolean> => {
  const data = await readFile();
  return data.pins.some((p) => p.id === id);
};

export const getPin = async (id: string): Promise<Pin | null> => {
  const data = await readFile();
  return data.pins.find((p) => p.id === id) ?? null;
};

export const isStalePin = (pin: Pin, nowIso: string = new Date().toISOString()): boolean => {
  const reference = pin.lastVisitedAt ?? pin.pinnedAt;
  const ageMs = Date.parse(nowIso) - Date.parse(reference);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays >= STALE_DAYS;
};

export const togglePin = async (
  id: string,
  kind: EntityType,
  options: { note?: string } = {},
): Promise<{ pinned: boolean; pin: Pin | null }> => {
  const data = await readFile();
  const idx = data.pins.findIndex((p) => p.id === id);
  if (idx >= 0) {
    data.pins.splice(idx, 1);
    await writeFile(data);
    return { pinned: false, pin: null };
  }
  const note =
    options.note !== undefined && options.note.length > 0
      ? options.note.slice(0, MAX_NOTE_CHARS)
      : null;
  const pin: Pin = {
    id,
    kind,
    pinnedAt: new Date().toISOString(),
    note,
    lastVisitedAt: null,
  };
  data.pins.push(pin);
  await writeFile(data);
  return { pinned: true, pin };
};

export const updateNote = async (id: string, note: string): Promise<Pin | null> => {
  const data = await readFile();
  const pin = data.pins.find((p) => p.id === id);
  if (pin === undefined) return null;
  pin.note = note.length > 0 ? note.slice(0, MAX_NOTE_CHARS) : null;
  await writeFile(data);
  return pin;
};

export const markVisited = async (id: string): Promise<void> => {
  const data = await readFile();
  const pin = data.pins.find((p) => p.id === id);
  if (pin === undefined) return;
  pin.lastVisitedAt = new Date().toISOString();
  await writeFile(data);
};

/** Set of pinned ids. Cheaper than calling isPinned in a loop. */
export const pinnedIdSet = async (): Promise<Set<string>> => {
  const data = await readFile();
  return new Set(data.pins.map((p) => p.id));
};
