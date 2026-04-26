/**
 * Tiny dependency-free argv parser. We could pull in commander, but
 * the CLI surface is small and we'd rather not own that dependency.
 *
 * Supports: subcommands as the first positional arg, and flags of the
 * form `--name=value` or `--name value` or boolean `--flag`.
 *
 * Returns a discriminated parse result so the caller doesn't have to
 * pattern-match on string keys.
 */

export interface ParsedArgs {
  /** First positional argument (the subcommand). */
  command: string | null;
  /** Remaining positional arguments after the subcommand. */
  positionals: string[];
  /** Boolean flags. */
  flags: Set<string>;
  /** String options (`--name=value` or `--name value`). */
  options: Map<string, string>;
}

const FLAG_PREFIX = '--';

export const parseArgs = (argv: string[]): ParsedArgs => {
  const positionals: string[] = [];
  const flags = new Set<string>();
  const options = new Map<string, string>();
  let command: string | null = null;
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token === undefined) {
      i += 1;
      continue;
    }
    if (token.startsWith(FLAG_PREFIX)) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        const name = token.slice(FLAG_PREFIX.length, eq);
        options.set(name, token.slice(eq + 1));
      } else {
        const name = token.slice(FLAG_PREFIX.length);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith(FLAG_PREFIX)) {
          options.set(name, next);
          i += 1;
        } else {
          flags.add(name);
        }
      }
    } else if (command === null) {
      command = token;
    } else {
      positionals.push(token);
    }
    i += 1;
  }
  return { command, positionals, flags, options };
};
