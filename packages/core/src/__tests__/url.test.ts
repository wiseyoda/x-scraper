import { describe, expect, it } from 'vitest';

import { canonicalizeUrl } from '../url.js';

describe('canonicalizeUrl', () => {
  it('lowercases the host', () => {
    expect(canonicalizeUrl('HTTPS://Example.COM/Foo')).toBe('https://example.com/Foo');
  });

  it('strips utm tracking parameters', () => {
    expect(canonicalizeUrl('https://example.com/x?utm_source=twitter&utm_medium=social&q=hi')).toBe(
      'https://example.com/x?q=hi',
    );
  });

  it('strips fbclid, gclid, and similar tracking parameters', () => {
    const out = canonicalizeUrl('https://example.com/?fbclid=abc&gclid=def&keep=yes');
    expect(out).toBe('https://example.com/?keep=yes');
  });

  it('drops the URL fragment', () => {
    expect(canonicalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
  });

  it('strips a trailing slash on non-root paths', () => {
    expect(canonicalizeUrl('https://example.com/foo/')).toBe('https://example.com/foo');
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('produces stable param ordering', () => {
    const a = canonicalizeUrl('https://example.com/?b=2&a=1');
    const b = canonicalizeUrl('https://example.com/?a=1&b=2');
    expect(a).toBe(b);
  });
});
