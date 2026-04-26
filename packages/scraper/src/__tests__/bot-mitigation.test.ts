import { describe, expect, it } from 'vitest';

import { createQueryIdRegistry, createSessionCap, jitteredDelay } from '../bot-mitigation.js';

describe('jitteredDelay', () => {
  it('returns a value in [minMs, maxMs)', async () => {
    const recorded: number[] = [];
    const ms = await jitteredDelay({
      minMs: 100,
      maxMs: 200,
      rng: () => 0.5,
      delay: (n) => {
        recorded.push(n);
        return Promise.resolve();
      },
    });
    expect(ms).toBe(150);
    expect(recorded).toEqual([150]);
  });

  it('rejects min > max', async () => {
    await expect(
      jitteredDelay({ minMs: 100, maxMs: 50, delay: () => Promise.resolve() }),
    ).rejects.toThrow();
  });

  it('hits the floor when rng returns 0', async () => {
    const ms = await jitteredDelay({
      minMs: 50,
      maxMs: 100,
      rng: () => 0,
      delay: () => Promise.resolve(),
    });
    expect(ms).toBe(50);
  });
});

describe('SessionCap', () => {
  it('counts requests within the rolling window', () => {
    const now = 1_000_000;
    const cap = createSessionCap({ windowMs: 1_000, maxRequests: 3, now: () => now });
    expect(cap.record()).toBe(1);
    expect(cap.record()).toBe(2);
    expect(cap.remaining()).toBe(1);
    expect(cap.wouldExceed()).toBe(false);
    expect(cap.record()).toBe(3);
    expect(cap.wouldExceed()).toBe(true);
  });

  it('drops requests older than the window', () => {
    let now = 1_000_000;
    const cap = createSessionCap({ windowMs: 1_000, maxRequests: 3, now: () => now });
    cap.record();
    cap.record();
    cap.record();
    expect(cap.wouldExceed()).toBe(true);
    now += 2_000;
    expect(cap.wouldExceed()).toBe(false);
    expect(cap.remaining()).toBe(3);
  });

  it('reset clears the window', () => {
    const cap = createSessionCap({ windowMs: 1_000, maxRequests: 1 });
    cap.record();
    expect(cap.wouldExceed()).toBe(true);
    cap.reset();
    expect(cap.wouldExceed()).toBe(false);
  });
});

describe('QueryIdRegistry', () => {
  it('round-trips queryIds and reports prior values on set', () => {
    const reg = createQueryIdRegistry({ Bookmarks: 'q1' });
    expect(reg.get('Bookmarks')).toBe('q1');
    expect(reg.set('Bookmarks', 'q2')).toBe('q1');
    expect(reg.get('Bookmarks')).toBe('q2');
    expect(reg.set('Likes', 'q3')).toBeNull();
    expect(reg.snapshot()).toEqual({ Bookmarks: 'q2', Likes: 'q3' });
  });
});
