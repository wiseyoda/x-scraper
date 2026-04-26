import { describe, expect, it } from 'vitest';

import { buildLaunchdPlist, defaultPlistPath } from '../launchd.js';

describe('buildLaunchdPlist', () => {
  it('emits a valid plist with the required keys', () => {
    const plist = buildLaunchdPlist({
      label: 'com.x-scraper.sync',
      programPath: '/usr/local/bin/xs',
      args: ['sync', '--source', 'bookmarks'],
      intervalSeconds: 3600,
    });
    expect(plist).toContain('<?xml version="1.0"');
    expect(plist).toContain('<key>Label</key>');
    expect(plist).toContain('<string>com.x-scraper.sync</string>');
    expect(plist).toContain('<key>StartInterval</key>');
    expect(plist).toContain('<integer>3600</integer>');
    expect(plist).toContain('<string>sync</string>');
    expect(plist).toContain('<string>--source</string>');
    expect(plist).toContain('<string>bookmarks</string>');
  });

  it('escapes special characters in env values', () => {
    const plist = buildLaunchdPlist({
      label: 'a',
      programPath: '/x',
      intervalSeconds: 1,
      env: { K: 'v & "quoted" <ok>' },
    });
    expect(plist).toContain('&amp;');
    expect(plist).toContain('&quot;');
    expect(plist).toContain('&lt;ok&gt;');
  });

  it('floors fractional intervals to at least 1', () => {
    const plist = buildLaunchdPlist({
      label: 'a',
      programPath: '/x',
      intervalSeconds: 0.4,
    });
    expect(plist).toContain('<integer>1</integer>');
  });
});

describe('defaultPlistPath', () => {
  it('lives under ~/Library/LaunchAgents', () => {
    const p = defaultPlistPath('com.x-scraper.sync');
    expect(p).toContain('Library/LaunchAgents');
    expect(p).toContain('com.x-scraper.sync.plist');
  });
});
