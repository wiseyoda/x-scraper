/**
 * Stable, content-addressable IDs.
 *
 * - `entityId(type, key)` deterministic — same key always produces the
 *   same id. Used for any entity whose identity is naturally derived
 *   from its content (Source URL, tweet id, claim text+subject).
 * - `randomId(type)` non-deterministic — used only when there's no
 *   natural key (e.g. Topic clusters discovered by Leiden).
 */

import { createHash, randomBytes } from 'node:crypto';

import type { EntityType } from './constants.js';
import { ID_PREFIXES } from './constants.js';

const ID_HASH_LENGTH = 8;
const ID_RANDOM_BYTES = 6;

const prefixFor = (type: EntityType): string =>
  type in ID_PREFIXES ? ID_PREFIXES[type] : type.toLowerCase();

export const entityId = (type: EntityType, key: string): string => {
  const hash = createHash('sha256').update(key).digest('hex').slice(0, ID_HASH_LENGTH);
  return `${prefixFor(type)}_${hash}`;
};

export const randomId = (type: EntityType): string => {
  const random = randomBytes(ID_RANDOM_BYTES).toString('hex');
  return `${prefixFor(type)}_${random}`;
};

export const isValidId = (id: string): boolean => /^[a-z]+(_[a-z0-9]+)+$/i.test(id);
