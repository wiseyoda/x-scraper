import { describe, expect, it } from 'vitest';

import { formatIsoWeek, isoWeek, isoWeekStart } from '../iso-week.js';

describe('isoWeek', () => {
  it('week 1 contains Jan 4', () => {
    expect(isoWeek(new Date('2026-01-04T12:00:00Z'))).toEqual({ year: 2026, week: 1 });
  });

  it('Dec 31 2024 is week 1 of 2025 (ISO rollover)', () => {
    expect(isoWeek(new Date('2024-12-31T12:00:00Z'))).toEqual({ year: 2025, week: 1 });
  });

  it('mid-year week is straightforward', () => {
    expect(isoWeek(new Date('2026-04-26T12:00:00Z'))).toEqual({ year: 2026, week: 17 });
  });
});

describe('formatIsoWeek', () => {
  it('zero-pads single-digit weeks', () => {
    expect(formatIsoWeek(new Date('2026-01-04T12:00:00Z'))).toBe('2026-W01');
  });

  it('does not zero-pad two-digit weeks', () => {
    expect(formatIsoWeek(new Date('2026-04-26T12:00:00Z'))).toBe('2026-W17');
  });
});

describe('isoWeekStart', () => {
  it('returns the Monday of the supplied date in UTC', () => {
    const start = isoWeekStart(new Date('2026-04-26T18:30:00Z'));
    expect(start.toISOString()).toBe('2026-04-20T00:00:00.000Z');
  });
});
