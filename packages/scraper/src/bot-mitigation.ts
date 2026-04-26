/**
 * Bot-mitigation primitives.
 *
 * Pure-ish helpers used by the scraper to stay under per-account
 * rate ceilings and to look more like a human session:
 *
 *   - jitteredDelay: pause for [min..max] ms, deterministic in tests
 *     when an `rng` is injected.
 *   - SessionCap: hard cap on requests-per-window with a small surplus
 *     check so the caller can decide to pause vs. abort.
 *   - QueryIdRegistry: hot-reload swap of the GraphQL queryId so an
 *     `xs sync` invocation can swap in a new id without a restart.
 *
 * No network calls. No timers in tests — `delay` is injectable.
 */

const DEFAULT_RNG = (): number => Math.random();
const REAL_DELAY = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export interface JitterOptions {
  minMs: number;
  maxMs: number;
  rng?: () => number;
  delay?: (ms: number) => Promise<void>;
}

export const jitteredDelay = async (options: JitterOptions): Promise<number> => {
  if (options.minMs > options.maxMs) {
    throw new Error(`minMs ${String(options.minMs)} > maxMs ${String(options.maxMs)}`);
  }
  const rng = options.rng ?? DEFAULT_RNG;
  const delay = options.delay ?? REAL_DELAY;
  const range = options.maxMs - options.minMs;
  const ms = Math.floor(options.minMs + rng() * range);
  await delay(ms);
  return ms;
};

export interface SessionCapInput {
  windowMs: number;
  maxRequests: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

export interface SessionCap {
  /** Record a successful request; returns the consumed count in window. */
  record: () => number;
  /** Number of remaining requests inside the current window. */
  remaining: () => number;
  /** True if recording one more request would exceed the cap. */
  wouldExceed: () => boolean;
  /** Reset state; useful between runs. */
  reset: () => void;
}

export const createSessionCap = (input: SessionCapInput): SessionCap => {
  const now = input.now ?? Date.now;
  let timestamps: number[] = [];

  const prune = (t: number): void => {
    const cutoff = t - input.windowMs;
    timestamps = timestamps.filter((ts) => ts > cutoff);
  };

  return {
    record: (): number => {
      const t = now();
      prune(t);
      timestamps.push(t);
      return timestamps.length;
    },
    remaining: (): number => {
      prune(now());
      return Math.max(0, input.maxRequests - timestamps.length);
    },
    wouldExceed: (): boolean => {
      prune(now());
      return timestamps.length >= input.maxRequests;
    },
    reset: (): void => {
      timestamps = [];
    },
  };
};

/**
 * GraphQL queryIds rotate on the X.com side. The registry holds the
 * "live" id per logical query name; callers rebuild URLs against it.
 * `set()` returns the previous id (or null) so the caller can log a
 * rotation event.
 */
export interface QueryIdRegistry {
  get: (name: string) => string | null;
  set: (name: string, id: string) => string | null;
  snapshot: () => Record<string, string>;
}

export const createQueryIdRegistry = (initial: Record<string, string> = {}): QueryIdRegistry => {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get: (name) => map.get(name) ?? null,
    set: (name, id) => {
      const prev = map.get(name) ?? null;
      map.set(name, id);
      return prev;
    },
    snapshot: () => Object.fromEntries(map.entries()),
  };
};
