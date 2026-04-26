import { describe, expect, it, vi } from 'vitest';

import { createLogger, type LogRecord } from '../logger.js';

const fixedNow = (): Date => new Date('2026-04-26T18:00:00.000Z');

describe('createLogger', () => {
  it('emits info-level by default', () => {
    const sink = vi.fn();
    const log = createLogger({ sink, now: fixedNow });
    log.info('hello', { a: 1 });
    expect(sink).toHaveBeenCalledOnce();
    const record = (sink.mock.calls[0]?.[0] ?? null) as LogRecord | null;
    expect(record?.msg).toBe('hello');
    expect(record?.level).toBe('info');
    expect(record?.bindings.a).toBe(1);
    expect(record?.time).toBe('2026-04-26T18:00:00.000Z');
  });

  it('drops records below the configured level', () => {
    const sink = vi.fn();
    const log = createLogger({ sink, level: 'warn', now: fixedNow });
    log.info('quiet');
    log.debug('also quiet');
    expect(sink).not.toHaveBeenCalled();
    log.warn('loud');
    expect(sink).toHaveBeenCalledOnce();
  });

  it('child loggers inherit and merge bindings', () => {
    const sink = vi.fn();
    const parent = createLogger({ sink, bindings: { service: 'queue' }, now: fixedNow });
    const child = parent.child({ runId: 'run_x' });
    child.info('hi', { jobId: 'job_y' });
    const record = (sink.mock.calls[0]?.[0] ?? null) as LogRecord | null;
    expect(record?.bindings).toEqual({ service: 'queue', runId: 'run_x', jobId: 'job_y' });
  });

  it('child binding for the same key overrides the parent', () => {
    const sink = vi.fn();
    const parent = createLogger({ sink, bindings: { stage: 'fetch' }, now: fixedNow });
    parent.child({ stage: 'embed' }).info('overridden');
    const record = (sink.mock.calls[0]?.[0] ?? null) as LogRecord | null;
    expect(record?.bindings.stage).toBe('embed');
  });
});
