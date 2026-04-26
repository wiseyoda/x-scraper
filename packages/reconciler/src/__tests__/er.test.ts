import { describe, expect, it, vi } from 'vitest';

import { resolveEntity } from '../er.js';
import { type ErCandidateFinder, ReconcilerError } from '../types.js';

const stubFinder = (rows: { id: string; score: number }[]): ErCandidateFinder => ({
  findCandidates: vi.fn(() => Promise.resolve(rows)),
});

const ANY_EMBED = [0.1, 0.2, 0.3, 0.4];

describe('resolveEntity', () => {
  it('returns NEW when there are no candidates', async () => {
    const result = await resolveEntity(
      { candidateName: 'Neo4j', candidateEmbedding: ANY_EMBED, type: 'Tool' },
      { finder: stubFinder([]) },
    );
    expect(result.decision).toBe('NEW');
    expect(result.matchId).toBeNull();
  });

  it('returns MERGE when top score is at or above mergeThreshold', async () => {
    const result = await resolveEntity(
      { candidateName: 'Neo4j', candidateEmbedding: ANY_EMBED, type: 'Tool' },
      {
        finder: stubFinder([
          { id: 'tool_neo4j_existing', score: 0.96 },
          { id: 'tool_other', score: 0.7 },
        ]),
      },
    );
    expect(result.decision).toBe('MERGE');
    expect(result.matchId).toBe('tool_neo4j_existing');
  });

  it('returns SAME_AS_PROBABLE when top score is between thresholds', async () => {
    const result = await resolveEntity(
      { candidateName: 'Neo4j', candidateEmbedding: ANY_EMBED, type: 'Tool' },
      {
        finder: stubFinder([{ id: 'tool_existing', score: 0.85 }]),
      },
    );
    expect(result.decision).toBe('SAME_AS_PROBABLE');
    expect(result.matchId).toBe('tool_existing');
  });

  it('returns NEW when top score is below probable threshold', async () => {
    const result = await resolveEntity(
      { candidateName: 'Neo4j', candidateEmbedding: ANY_EMBED, type: 'Tool' },
      {
        finder: stubFinder([{ id: 'tool_existing', score: 0.4 }]),
      },
    );
    expect(result.decision).toBe('NEW');
    expect(result.matchId).toBeNull();
  });

  it('rejects nonsensical thresholds (probable > merge)', async () => {
    await expect(
      resolveEntity(
        { candidateName: 'Neo4j', candidateEmbedding: ANY_EMBED, type: 'Tool' },
        { finder: stubFinder([]), mergeThreshold: 0.7, probableThreshold: 0.9 },
      ),
    ).rejects.toBeInstanceOf(ReconcilerError);
  });
});
