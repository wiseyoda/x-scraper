/**
 * Tiny structured logger.
 *
 * Emits one JSON object per line — pino-compatible enough that downstream
 * tooling (e.g. `pino-pretty`) can consume it. We don't take a runtime
 * dependency on pino itself: every external dep we add is one more
 * thing to monitor for compromise. The footprint is small (under 100
 * lines) so owning it is cheap.
 *
 * Use `child(bindings)` to attach run/job/stage/trace ids; child loggers
 * inherit and merge bindings on every emit.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogBindings = Record<string, unknown>;

export interface LogRecord {
  time: string;
  level: LogLevel;
  msg: string;
  bindings: LogBindings;
}

export type Sink = (record: LogRecord) => void;

export interface Logger {
  level: LogLevel;
  child: (bindings: LogBindings) => Logger;
  debug: (msg: string, fields?: LogBindings) => void;
  info: (msg: string, fields?: LogBindings) => void;
  warn: (msg: string, fields?: LogBindings) => void;
  error: (msg: string, fields?: LogBindings) => void;
  /** Emit at an explicit level. */
  emit: (level: LogLevel, msg: string, fields?: LogBindings) => void;
}

export interface LoggerOptions {
  level?: LogLevel;
  sink?: Sink;
  bindings?: LogBindings;
  /** Override Date.now(); useful for deterministic tests. */
  now?: () => Date;
}

export const jsonLineSink = (write: (line: string) => void): Sink => {
  return (record) => {
    // Reserved fields (time, level, msg) MUST stay authoritative; spread
    // caller bindings first so a stray `level: 'error'` on the bindings
    // can't replace the actual log level.
    const merged = {
      ...record.bindings,
      time: record.time,
      level: record.level,
      msg: record.msg,
    };
    write(`${JSON.stringify(merged)}\n`);
  };
};

const stdoutSink: Sink = jsonLineSink((line) => {
  process.stdout.write(line);
});

export const createLogger = (options: LoggerOptions = {}): Logger => {
  const level: LogLevel = options.level ?? 'info';
  const sink = options.sink ?? stdoutSink;
  const baseBindings: LogBindings = options.bindings ?? {};
  const now = options.now ?? ((): Date => new Date());

  const emit = (recordLevel: LogLevel, msg: string, fields: LogBindings = {}): void => {
    if (LEVEL_RANK[recordLevel] < LEVEL_RANK[level]) return;
    sink({
      time: now().toISOString(),
      level: recordLevel,
      msg,
      bindings: { ...baseBindings, ...fields },
    });
  };

  return {
    level,
    child: (bindings) =>
      createLogger({
        ...options,
        level,
        sink,
        bindings: { ...baseBindings, ...bindings },
      }),
    debug: (msg, fields) => {
      emit('debug', msg, fields);
    },
    info: (msg, fields) => {
      emit('info', msg, fields);
    },
    warn: (msg, fields) => {
      emit('warn', msg, fields);
    },
    error: (msg, fields) => {
      emit('error', msg, fields);
    },
    emit,
  };
};
