import { describe, expect, it } from 'vitest';

import { parseArgs } from '../argparse.js';

describe('parseArgs', () => {
  it('treats the first positional as the command', () => {
    const r = parseArgs(['status']);
    expect(r.command).toBe('status');
    expect(r.positionals).toEqual([]);
  });

  it('captures --name=value options', () => {
    const r = parseArgs(['cost', '--since=2026-01-01']);
    expect(r.command).toBe('cost');
    expect(r.options.get('since')).toBe('2026-01-01');
  });

  it('captures --name value options', () => {
    const r = parseArgs(['status', '--run', 'run_xyz']);
    expect(r.options.get('run')).toBe('run_xyz');
  });

  it('captures bare flags as boolean', () => {
    const r = parseArgs(['init', '--force']);
    expect(r.flags.has('force')).toBe(true);
  });

  it('returns null command for an empty argv', () => {
    const r = parseArgs([]);
    expect(r.command).toBeNull();
  });

  it('does not consume a flag-looking value as a string option', () => {
    const r = parseArgs(['x', '--foo', '--bar=1']);
    expect(r.flags.has('foo')).toBe(true);
    expect(r.options.get('bar')).toBe('1');
  });
});
