import { describe, expect, it } from 'vitest';

import {
  derivePipelineStage,
  fastPrimaryFromBookmark,
  PIPELINE_STAGE_LABEL,
} from './pipeline-status.js';

describe('derivePipelineStage', () => {
  it('maps new ledger without claims to captured', () => {
    expect(derivePipelineStage({ ledgerStatus: 'new', claimCount: 0, ideaCount: 0 })).toBe(
      'captured',
    );
  });

  it('maps claims present to extracted', () => {
    expect(derivePipelineStage({ ledgerStatus: 'synced', claimCount: 3, ideaCount: 0 })).toBe(
      'extracted',
    );
  });

  it('maps ideas present to synthesized', () => {
    expect(derivePipelineStage({ ledgerStatus: 'synced', claimCount: 5, ideaCount: 1 })).toBe(
      'synthesized',
    );
  });

  it('maps failed ledger to failed', () => {
    expect(derivePipelineStage({ ledgerStatus: 'failed' })).toBe('failed');
  });

  it('exposes human labels for each stage', () => {
    expect(PIPELINE_STAGE_LABEL.captured).toBe('captured');
    expect(PIPELINE_STAGE_LABEL.synthesized).toBe('in ideas');
  });
});

describe('fastPrimaryFromBookmark', () => {
  it('uses tweet text as primary without needing extract', () => {
    const r = fastPrimaryFromBookmark({
      text: 'Claude Code just did something remarkable for agent loops',
      byline: 'polydao',
      url: 'https://x.com/polydao/status/1',
    });
    expect(r.fromPayload).toBe(true);
    expect(r.primary.toLowerCase()).toContain('claude code');
    expect(r.primary).not.toMatch(/^https?:\/\//);
    expect(r.secondary).toContain('x.com');
  });

  it('falls back to @byline when text is URL-only', () => {
    const r = fastPrimaryFromBookmark({
      text: 'https://t.co/abc',
      byline: 'sidrmsh',
      url: 'https://x.com/sidrmsh/status/1',
    });
    expect(r.primary).toBe('@sidrmsh');
    expect(r.fromPayload).toBe(true);
  });
});
