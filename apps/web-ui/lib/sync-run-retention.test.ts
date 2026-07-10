import { describe, expect, it } from 'vitest';

import {
  selectOrphanLogRunIds,
  selectRunIdsToPrune,
  SYNC_RUN_MAX_AGE_MS,
  SYNC_RUN_MAX_KEEP,
  type RunRetentionInput,
} from './sync-run-retention.js';

const day = (n: number): number => n * 24 * 60 * 60 * 1000;

const run = (
  id: string,
  startedAt: string,
  stage: RunRetentionInput['stage'] = 'success',
): RunRetentionInput => ({ runId: id, startedAt, stage });

describe('selectRunIdsToPrune', () => {
  const nowMs = Date.parse('2026-07-10T12:00:00.000Z');

  it('never prunes pending or running runs', () => {
    const old = new Date(nowMs - day(30)).toISOString();
    const pruned = selectRunIdsToPrune(
      [run('a', old, 'running'), run('b', old, 'pending'), run('c', old, 'success')],
      { nowMs, maxKeep: 1, maxAgeMs: day(7) },
    );
    expect(pruned).toEqual(['c']);
    expect(pruned).not.toContain('a');
    expect(pruned).not.toContain('b');
  });

  it('drops finished runs past max age', () => {
    const recent = new Date(nowMs - day(2)).toISOString();
    const stale = new Date(nowMs - day(20)).toISOString();
    const pruned = selectRunIdsToPrune(
      [run('new', recent), run('old', stale)],
      { nowMs, maxKeep: 20, maxAgeMs: day(14) },
    );
    expect(pruned).toEqual(['old']);
  });

  it('keeps only the newest maxKeep finished runs', () => {
    const runs = Array.from({ length: 5 }, (_, i) =>
      run(`r${String(i)}`, new Date(nowMs - day(i)).toISOString()),
    );
    const pruned = selectRunIdsToPrune(runs, { nowMs, maxKeep: 2, maxAgeMs: day(100) });
    expect(pruned.sort()).toEqual(['r2', 'r3', 'r4'].sort());
  });

  it('defaults match exported constants', () => {
    expect(SYNC_RUN_MAX_KEEP).toBe(20);
    expect(SYNC_RUN_MAX_AGE_MS).toBe(14 * 24 * 60 * 60 * 1000);
    const many = Array.from({ length: 25 }, (_, i) =>
      run(`x${String(i)}`, new Date(nowMs - i * 60_000).toISOString()),
    );
    const pruned = selectRunIdsToPrune(many, { nowMs });
    expect(pruned).toHaveLength(5);
  });
});

describe('selectOrphanLogRunIds', () => {
  it('returns log basenames with no matching json', () => {
    expect(
      selectOrphanLogRunIds(['a.json', 'a.log', 'b.log', 'c.json', 'notes.txt']),
    ).toEqual(['b']);
  });
});
