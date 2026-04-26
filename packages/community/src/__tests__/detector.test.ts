import { describe, expect, it } from 'vitest';

import { detectCommunities } from '../detector.js';
import { CommunityError, type DetectorInput } from '../types.js';

const node = (id: string): { id: string; type: 'Concept'; name: string } => ({
  id,
  type: 'Concept',
  name: id,
});

describe('detectCommunities', () => {
  it('throws EMPTY_GRAPH on no nodes', () => {
    expect(() => detectCommunities({ nodes: [], edges: [] })).toThrow(CommunityError);
  });

  it('finds two clear communities on a barbell graph', () => {
    // Two cliques connected by a single bridge edge — Louvain's textbook
    // case. We expect two communities, each with the clique nodes.
    const left = ['l1', 'l2', 'l3', 'l4'];
    const right = ['r1', 'r2', 'r3', 'r4'];
    const input: DetectorInput = {
      nodes: [...left, ...right].map(node),
      edges: [
        // left clique
        { from: 'l1', to: 'l2', type: 'RELATED_TO' },
        { from: 'l1', to: 'l3', type: 'RELATED_TO' },
        { from: 'l1', to: 'l4', type: 'RELATED_TO' },
        { from: 'l2', to: 'l3', type: 'RELATED_TO' },
        { from: 'l2', to: 'l4', type: 'RELATED_TO' },
        { from: 'l3', to: 'l4', type: 'RELATED_TO' },
        // right clique
        { from: 'r1', to: 'r2', type: 'RELATED_TO' },
        { from: 'r1', to: 'r3', type: 'RELATED_TO' },
        { from: 'r1', to: 'r4', type: 'RELATED_TO' },
        { from: 'r2', to: 'r3', type: 'RELATED_TO' },
        { from: 'r2', to: 'r4', type: 'RELATED_TO' },
        { from: 'r3', to: 'r4', type: 'RELATED_TO' },
        // bridge
        { from: 'l1', to: 'r1', type: 'RELATED_TO' },
      ],
      minCommunitySize: 2,
    };
    const communities = detectCommunities(input);
    expect(communities).toHaveLength(2);
    const memberSets = communities.map((c) => new Set(c.members));
    const leftSet = new Set(left);
    const rightSet = new Set(right);
    const matchesLeft = memberSets.some((s) => Array.from(leftSet).every((x) => s.has(x)));
    const matchesRight = memberSets.some((s) => Array.from(rightSet).every((x) => s.has(x)));
    expect(matchesLeft).toBe(true);
    expect(matchesRight).toBe(true);
  });

  it('drops communities below minCommunitySize', () => {
    // A 4-clique + a 2-node pair (under default minSize=3). Only the
    // clique should survive.
    const input: DetectorInput = {
      nodes: ['a', 'b', 'c', 'd', 'x', 'y'].map(node),
      edges: [
        { from: 'a', to: 'b', type: 'RELATED_TO' },
        { from: 'a', to: 'c', type: 'RELATED_TO' },
        { from: 'a', to: 'd', type: 'RELATED_TO' },
        { from: 'b', to: 'c', type: 'RELATED_TO' },
        { from: 'b', to: 'd', type: 'RELATED_TO' },
        { from: 'c', to: 'd', type: 'RELATED_TO' },
        { from: 'x', to: 'y', type: 'RELATED_TO' },
      ],
    };
    const communities = detectCommunities(input);
    expect(communities).toHaveLength(1);
    expect(communities[0]?.members.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('picks the highest-degree node as representativeId', () => {
    // Star graph: 'hub' connects to a, b, c, d.
    const input: DetectorInput = {
      nodes: ['hub', 'a', 'b', 'c', 'd'].map(node),
      edges: [
        { from: 'hub', to: 'a', type: 'RELATED_TO' },
        { from: 'hub', to: 'b', type: 'RELATED_TO' },
        { from: 'hub', to: 'c', type: 'RELATED_TO' },
        { from: 'hub', to: 'd', type: 'RELATED_TO' },
      ],
    };
    const communities = detectCommunities(input);
    expect(communities[0]?.representativeId).toBe('hub');
  });

  it('skips edges that reference nodes not in the input', () => {
    const input: DetectorInput = {
      nodes: ['a', 'b', 'c'].map(node),
      edges: [
        { from: 'a', to: 'b', type: 'RELATED_TO' },
        { from: 'b', to: 'c', type: 'RELATED_TO' },
        { from: 'a', to: 'ghost', type: 'RELATED_TO' }, // ghost not in nodes
      ],
      minCommunitySize: 2,
    };
    const communities = detectCommunities(input);
    expect(communities).toHaveLength(1);
    expect(communities[0]?.members.sort()).toEqual(['a', 'b', 'c']);
  });

  it('sums parallel edges into a single weighted undirected edge', () => {
    // Two RELATED_TO + one IS_A between a-b should still produce a valid
    // graph (no edge duplication crash).
    const input: DetectorInput = {
      nodes: ['a', 'b', 'c'].map(node),
      edges: [
        { from: 'a', to: 'b', type: 'RELATED_TO' },
        { from: 'a', to: 'b', type: 'RELATED_TO' },
        { from: 'a', to: 'b', type: 'IS_A' },
        { from: 'b', to: 'c', type: 'RELATED_TO' },
      ],
      minCommunitySize: 2,
    };
    expect(() => detectCommunities(input)).not.toThrow();
  });
});
