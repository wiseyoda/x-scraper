import { describe, expect, it, vi } from 'vitest';

import { createLogger, type LogRecord } from '../logger.js';
import { time, timeSync } from '../timing.js';

describe('time', () => {
  it('logs duration on success and returns the result', async () => {
    const sink = vi.fn();
    const log = createLogger({ sink });
    const result = await time(log, 'op', () => Promise.resolve(42));
    expect(result).toBe(42);
    const record = (sink.mock.calls[0]?.[0] ?? null) as LogRecord | null;
    expect(record?.msg).toBe('duration');
    expect(record?.bindings.label).toBe('op');
    expect(typeof record?.bindings.ms).toBe('number');
  });

  it('logs at debug when ms is below debugBelowMs', async () => {
    const sink = vi.fn();
    const log = createLogger({ sink, level: 'debug' });
    await time(log, 'fast', () => Promise.resolve('ok'), { debugBelowMs: 10_000_000 });
    const record = (sink.mock.calls[0]?.[0] ?? null) as LogRecord | null;
    expect(record?.level).toBe('debug');
  });

  it('logs duration_failed and rethrows on error', async () => {
    const sink = vi.fn();
    const log = createLogger({ sink });
    const boom = new Error('boom');
    await expect(time(log, 'op', () => Promise.reject(boom))).rejects.toBe(boom);
    const record = (sink.mock.calls[0]?.[0] ?? null) as LogRecord | null;
    expect(record?.msg).toBe('duration_failed');
    expect(record?.level).toBe('warn');
    expect(record?.bindings.error).toBe('boom');
  });

  it('reserved measurement fields beat user-supplied options.fields', async () => {
    const sink = vi.fn();
    const log = createLogger({ sink });
    await time(log, 'real-label', () => Promise.resolve('ok'), {
      fields: { label: 'spoofed', ms: 9999 },
    });
    const record = (sink.mock.calls[0]?.[0] ?? null) as LogRecord | null;
    expect(record?.bindings.label).toBe('real-label');
    expect(record?.bindings.ms).not.toBe(9999);
  });
});

describe('timeSync', () => {
  it('logs duration on success', () => {
    const sink = vi.fn();
    const log = createLogger({ sink });
    const result = timeSync(log, 'op', () => 7);
    expect(result).toBe(7);
    const record = (sink.mock.calls[0]?.[0] ?? null) as LogRecord | null;
    expect(record?.msg).toBe('duration');
  });

  it('logs duration_failed and rethrows on synchronous error', () => {
    const sink = vi.fn();
    const log = createLogger({ sink });
    expect(() =>
      timeSync(log, 'op', () => {
        throw new Error('nope');
      }),
    ).toThrow('nope');
    const record = (sink.mock.calls[0]?.[0] ?? null) as LogRecord | null;
    expect(record?.msg).toBe('duration_failed');
  });
});
