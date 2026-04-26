import { describe, expect, it } from 'vitest';

import { entityId, isValidId, randomId } from '../ids.js';

describe('entityId', () => {
  it('is deterministic for a given (type, key)', () => {
    expect(entityId('Source', 'https://example.com/a')).toBe(
      entityId('Source', 'https://example.com/a'),
    );
  });

  it('produces different ids for different keys', () => {
    expect(entityId('Source', 'https://a')).not.toBe(entityId('Source', 'https://b'));
  });

  it('uses the per-type prefix', () => {
    expect(entityId('Source', 'k').startsWith('src_')).toBe(true);
    expect(entityId('Claim', 'k').startsWith('claim_')).toBe(true);
    expect(entityId('Topic', 'k').startsWith('topic_')).toBe(true);
    expect(entityId('Tool', 'k').startsWith('tool_')).toBe(true);
  });
});

describe('randomId', () => {
  it('produces unique ids each call', () => {
    expect(randomId('Topic')).not.toBe(randomId('Topic'));
  });

  it('uses the per-type prefix', () => {
    expect(randomId('Topic').startsWith('topic_')).toBe(true);
  });
});

describe('isValidId', () => {
  it('accepts well-formed ids', () => {
    expect(isValidId('src_abcdef12')).toBe(true);
    expect(isValidId('claim_8f2a')).toBe(true);
  });

  it('rejects malformed ids', () => {
    expect(isValidId('no-prefix')).toBe(false);
    expect(isValidId('src ')).toBe(false);
    expect(isValidId('')).toBe(false);
  });
});
