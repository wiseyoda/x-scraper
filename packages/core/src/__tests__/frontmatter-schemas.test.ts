import { describe, expect, it } from 'vitest';

import {
  ClaimFrontmatterSchema,
  EntityFrontmatterSchema,
  FrontmatterSchema,
  SourceFrontmatterSchema,
} from '../frontmatter-schemas.js';

const NOW = '2026-04-26T00:00:00.000Z';

describe('SourceFrontmatterSchema', () => {
  it('accepts a valid Source frontmatter', () => {
    const out = SourceFrontmatterSchema.parse({
      id: 'src_abcdef12',
      type: 'Source',
      created_at: NOW,
      updated_at: NOW,
      url: 'https://example.com/a',
      canonical_url: 'https://example.com/a',
      captured_at: NOW,
      content_type: 'article',
    });
    expect(out.id).toBe('src_abcdef12');
    expect(out.tags).toEqual([]);
    expect(out.aliases).toEqual([]);
  });

  it('rejects a non-URL url field', () => {
    expect(() =>
      SourceFrontmatterSchema.parse({
        id: 'src_a',
        type: 'Source',
        created_at: NOW,
        updated_at: NOW,
        url: 'not-a-url',
        canonical_url: 'not-a-url',
        captured_at: NOW,
        content_type: 'article',
      }),
    ).toThrow();
  });
});

describe('ClaimFrontmatterSchema', () => {
  it('accepts a valid Claim frontmatter', () => {
    const out = ClaimFrontmatterSchema.parse({
      id: 'claim_a1',
      type: 'Claim',
      created_at: NOW,
      updated_at: NOW,
      valid_at: NOW,
      subject: 'Graphiti',
      predicate: 'uses_storage',
      object: 'Neo4j',
    });
    expect(out.invalid_at).toBeNull();
    expect(out.predicate).toBe('uses_storage');
  });

  it('rejects a non-snake_case predicate', () => {
    expect(() =>
      ClaimFrontmatterSchema.parse({
        id: 'claim_a1',
        type: 'Claim',
        created_at: NOW,
        updated_at: NOW,
        valid_at: NOW,
        subject: 'X',
        predicate: 'usesStorage',
        object: 'Y',
      }),
    ).toThrow();
  });
});

describe('FrontmatterSchema (discriminated union)', () => {
  it('routes to the right schema by type', () => {
    const claim = FrontmatterSchema.parse({
      id: 'claim_a',
      type: 'Claim',
      created_at: NOW,
      updated_at: NOW,
      valid_at: NOW,
      subject: 'X',
      predicate: 'is_a',
      object: 'Y',
    });
    expect(claim.type).toBe('Claim');

    const entity = EntityFrontmatterSchema.parse({
      id: 'tool_a',
      type: 'Tool',
      created_at: NOW,
      updated_at: NOW,
      name: 'Neo4j',
    });
    expect(entity.type).toBe('Tool');
  });
});
