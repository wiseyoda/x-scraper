/**
 * Performance timing helpers.
 *
 * `time(label, fn)` records elapsed milliseconds and emits an info-level
 * log entry on completion. Successful calls log msg='duration' with
 * fields { label, ms }; throws are logged at warn with the error message
 * AND rethrow so callers don't change semantics.
 */

import { performance } from 'node:perf_hooks';

import type { LogBindings, Logger } from './logger.js';

const FRACTIONAL_DIGITS = 3;

export interface TimerOptions {
  /** Extra fields to merge into the duration log. */
  fields?: LogBindings;
  /** Threshold below which the duration is logged at debug instead of info. */
  debugBelowMs?: number;
}

export const time = async <T>(
  logger: Logger,
  label: string,
  fn: () => Promise<T>,
  options: TimerOptions = {},
): Promise<T> => {
  const start = performance.now();
  try {
    const result = await fn();
    const ms = Number((performance.now() - start).toFixed(FRACTIONAL_DIGITS));
    const level =
      options.debugBelowMs !== undefined && ms < options.debugBelowMs ? 'debug' : 'info';
    // Reserved measurement fields (label, ms) come AFTER caller-supplied
    // options.fields so a stray { ms: 0 } can't replace the real timing.
    logger.emit(level, 'duration', { ...options.fields, label, ms });
    return result;
  } catch (err) {
    const ms = Number((performance.now() - start).toFixed(FRACTIONAL_DIGITS));
    logger.warn('duration_failed', {
      ...options.fields,
      label,
      ms,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
};

export const timeSync = <T>(
  logger: Logger,
  label: string,
  fn: () => T,
  options: TimerOptions = {},
): T => {
  const start = performance.now();
  try {
    const result = fn();
    const ms = Number((performance.now() - start).toFixed(FRACTIONAL_DIGITS));
    const level =
      options.debugBelowMs !== undefined && ms < options.debugBelowMs ? 'debug' : 'info';
    // Reserved measurement fields (label, ms) come AFTER caller-supplied
    // options.fields so a stray { ms: 0 } can't replace the real timing.
    logger.emit(level, 'duration', { ...options.fields, label, ms });
    return result;
  } catch (err) {
    const ms = Number((performance.now() - start).toFixed(FRACTIONAL_DIGITS));
    logger.warn('duration_failed', {
      ...options.fields,
      label,
      ms,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
};
