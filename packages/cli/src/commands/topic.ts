/**
 * `xs topic detect` — run Louvain community detection on the Concept
 * subgraph, optionally synthesize a title + summary via Sonnet, write
 * Topic.md files and Topic graph nodes.
 *
 * Outputs:
 *   - One vault file per community: topics/<topic_id>.md
 *   - One Topic node per community in the graph
 *   - One RELATED_TO edge per (Concept, Topic) member pair
 *
 * The LLM synthesis pass is opt-in via {synthesize: true}. Without it
 * topics get a deterministic name like "topic_<id>" and a member list
 * for body — useful for dry runs and CI.
 */

import Anthropic from '@anthropic-ai/sdk';
import { type CommunityResult, detectCommunities } from '@x-scraper/community';
import { entityId, type Frontmatter } from '@x-scraper/core';
import { type ConceptSubgraph, createNeo4jGraph, type GraphStore } from '@x-scraper/graph';
import { createClaudeProvider, type LlmCostSink, type LlmProvider } from '@x-scraper/llm';
import type { Logger } from '@x-scraper/observability';
import { createLogger, jsonLineSink } from '@x-scraper/observability';
import { createSqliteQueue } from '@x-scraper/queue';
import { createMarkdownVault, type VaultStore } from '@x-scraper/vault';

import type { CliConfig } from '../config.js';
import { ENV_FILE_PATH } from '../constants.js';
import { parseEnvFile } from './sync/wire.js';

const PROMPT_VERSION = { extraction: 1, reconciliation: 1, embedding: 1 };
const DEFAULT_MIN_COMMUNITY_SIZE = 5;
const TOPIC_PROMPT = `You are summarizing a discovered topic in a personal knowledge graph.

Given a list of related concept names, produce JSON with two fields:
  - "title": a 2-5 word noun phrase that captures what the cluster is about
  - "summary": a single sentence (≤30 words) describing what these concepts share

Output ONLY the JSON object — no prose, no fences.

Concepts:
`;

export interface TopicDetectOptions {
  /** When false, skip the LLM synthesis pass (still writes deterministic topics). */
  synthesize?: boolean;
  /** Default 5. Drop communities smaller than this. */
  minCommunitySize?: number;
  /** Skip the actual graph + vault writes (returns the would-be plan). */
  dryRun?: boolean;
  /** Test seam: stub the graph store. */
  graph?: GraphStore;
  /** Test seam: stub the LLM. */
  llm?: LlmProvider;
  /** Test seam: stub the vault. */
  vault?: VaultStore;
  /** Test seam: replacement env reader. */
  env?: Record<string, string>;
  logger?: Logger;
  /** When > 0, decay each edge's effective weight by 2^(-age_days / N).
   *  0 disables decay (cooccurrence_count is the raw weight). Default 0. */
  recencyHalfLifeDays?: number;
  /** Test seam: clock for recency decay. */
  now?: () => Date;
}

export interface TopicSummary {
  topicId: string;
  title: string;
  summary: string;
  members: string[];
  representativeId: string;
  edgeCount: number;
}

export interface TopicDetectResult {
  totalNodes: number;
  totalEdges: number;
  communitiesFound: number;
  communitiesAccepted: number;
  topicsWritten: number;
  edgesWritten: number;
  topics: TopicSummary[];
  costUsd: number;
}

const stdoutLogger = (): Logger =>
  createLogger({
    level: 'info',
    sink: jsonLineSink((line) => {
      process.stdout.write(line);
    }),
  });

const wireLlm = (env: Record<string, string>, cost?: LlmCostSink): LlmProvider => {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error('xs topic detect: ANTHROPIC_API_KEY is required for synthesis');
  }
  const client = new Anthropic({ apiKey });
  // Cost sink wires synthesis charges into cost_ledger so `xs cost`
  // reflects them. Without this, synthesis usage is reported only via
  // the command's return value and lost after process exit. (Codex v2.)
  return createClaudeProvider({
    messagesCreate: (input) => client.messages.create(input),
    ...(cost === undefined ? {} : { cost }),
  });
};

const wireGraph = (env: Record<string, string>): GraphStore => {
  const get = (key: string): string => {
    const v = process.env[key] ?? env[key];
    if (v === undefined || v.length === 0) {
      throw new Error(`xs topic detect: required env var ${key} is not set`);
    }
    return v;
  };
  return createNeo4jGraph({
    uri: get('NEO4J_URI'),
    user: get('NEO4J_USER'),
    password: get('NEO4J_PASSWORD'),
  });
};

interface SynthesisOutput {
  title: string;
  summary: string;
}

const synthesizeOne = async (
  llm: LlmProvider,
  memberNames: string[],
): Promise<{ result: SynthesisOutput; costUsd: number }> => {
  const reply = await llm.complete({
    system: [{ text: 'Output only valid JSON.', cache: false }],
    messages: [
      {
        role: 'user',
        content: TOPIC_PROMPT + memberNames.join('\n- '),
      },
    ],
    maxTokens: 256,
  });
  const stripped = reply.text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  // Defensive: the LLM may still leak prose. Fall back to deterministic
  // title from the representative name if parse fails.
  try {
    const parsed: unknown = JSON.parse(stripped);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'title' in parsed &&
      'summary' in parsed &&
      typeof (parsed as { title: unknown }).title === 'string' &&
      typeof (parsed as { summary: unknown }).summary === 'string'
    ) {
      return {
        result: {
          title: (parsed as { title: string }).title,
          summary: (parsed as { summary: string }).summary,
        },
        costUsd: reply.costUsd,
      };
    }
  } catch {
    // fallthrough
  }
  return {
    result: {
      title: memberNames[0] ?? 'topic',
      summary: `Cluster of ${String(memberNames.length)} concepts.`,
    },
    costUsd: reply.costUsd,
  };
};

const buildSynthesizer = (
  llm: LlmProvider | null,
  nameById: Map<string, string>,
): ((
  community: CommunityResult,
) => Promise<{ title: string; summary: string; costUsd: number }>) => {
  if (llm === null) {
    return (community): Promise<{ title: string; summary: string; costUsd: number }> => {
      const repName = nameById.get(community.representativeId) ?? community.representativeId;
      return Promise.resolve({
        title: repName,
        summary: `${String(community.members.length)} concepts including ${community.members
          .slice(0, 3)
          .map((id) => nameById.get(id) ?? id)
          .join(', ')}.`,
        costUsd: 0,
      });
    };
  }
  return async (community): Promise<{ title: string; summary: string; costUsd: number }> => {
    const memberNames = community.members
      .map((id) => nameById.get(id) ?? id)
      .filter((n) => n.length > 0);
    const out = await synthesizeOne(llm, memberNames);
    return { ...out.result, costUsd: out.costUsd };
  };
};

export const runTopicDetect = async (
  config: CliConfig,
  options: TopicDetectOptions = {},
): Promise<TopicDetectResult> => {
  const logger = options.logger ?? stdoutLogger();
  const env = options.env ?? parseEnvFile(ENV_FILE_PATH);
  const synthesize = options.synthesize ?? false;
  const minCommunitySize = options.minCommunitySize ?? DEFAULT_MIN_COMMUNITY_SIZE;
  const dryRun = options.dryRun ?? false;

  // Open the queue when we'll persist anything to cost_ledger — the
  // synthesis path bills LLM calls; dry-run / no-synthesize paths skip
  // it. Closed in the finally block alongside graph + vault.
  const queue =
    synthesize && !dryRun && options.llm === undefined ? createSqliteQueue(config.queuePath) : null;
  const llmCost: LlmCostSink | undefined =
    queue === null ? undefined : { recordCost: (c) => queue.recordCost(c) };

  const graph = options.graph ?? wireGraph(env);
  const llm: LlmProvider | null = synthesize ? (options.llm ?? wireLlm(env, llmCost)) : null;
  const vault = options.vault ?? createMarkdownVault(config.vaultDir);

  try {
    // Dry-run skips writers entirely — no point creating vault directories,
    // git metadata, or Neo4j constraints/indexes when we won't write.
    // (Codex P3.) Production graph init must already have run for any
    // useful subgraph to exist anyway.
    if (!dryRun && options.vault === undefined) await vault.init();
    if (!dryRun && options.graph === undefined) await graph.init();

    const subgraph: ConceptSubgraph = await graph.listConceptSubgraph();
    logger.info('topic.detect.subgraph_loaded', {
      nodes: subgraph.nodes.length,
      edges: subgraph.edges.length,
    });

    if (subgraph.nodes.length === 0 || subgraph.edges.length === 0) {
      return {
        totalNodes: subgraph.nodes.length,
        totalEdges: subgraph.edges.length,
        communitiesFound: 0,
        communitiesAccepted: 0,
        topicsWritten: 0,
        edgesWritten: 0,
        topics: [],
        costUsd: 0,
      };
    }

    const nameById = new Map(subgraph.nodes.map((n) => [n.id, n.name] as const));
    // T19: optional recency decay. With half-life H days, an edge whose
    // most recent contributing source landed N days ago contributes
    // `cooccurrence_count * 2^(-N/H)` to the Louvain weight. Disabled
    // (H=0) means raw cooccurrence_count is the weight.
    const halfLife = options.recencyHalfLifeDays ?? 0;
    const nowMs = (options.now ?? ((): Date => new Date()))().getTime();
    const decayedEdges = subgraph.edges.map((e) => {
      const baseWeight = Math.max(1, e.cooccurrenceCount);
      if (halfLife <= 0 || e.lastObservedAt === null) {
        return { ...e, weight: baseWeight };
      }
      const observedMs = Date.parse(e.lastObservedAt);
      if (Number.isNaN(observedMs)) {
        return { ...e, weight: baseWeight };
      }
      const ageDays = Math.max(0, (nowMs - observedMs) / (24 * 60 * 60 * 1000));
      const decay = Math.pow(2, -ageDays / halfLife);
      return { ...e, weight: baseWeight * decay };
    });
    const communities = detectCommunities({
      nodes: subgraph.nodes,
      edges: decayedEdges,
      minCommunitySize,
    });
    logger.info('topic.detect.communities_found', {
      count: communities.length,
      halfLifeDays: halfLife,
    });

    const synthesizer = buildSynthesizer(llm, nameById);
    let totalCost = 0;
    let topicsWritten = 0;
    let edgesWritten = 0;
    const now = new Date().toISOString();
    const topics: TopicSummary[] = [];

    for (const community of communities) {
      const synthesis = await synthesizer(community);
      totalCost += synthesis.costUsd;
      const topicId = entityId('Topic', `${synthesis.title}|${String(community.communityId)}`);
      const summary: TopicSummary = {
        topicId,
        title: synthesis.title,
        summary: synthesis.summary,
        members: community.members,
        representativeId: community.representativeId,
        edgeCount: community.edgeCount,
      };
      topics.push(summary);
      if (dryRun) continue;

      const fm: Frontmatter = {
        id: topicId,
        type: 'Topic',
        created_at: now,
        updated_at: now,
        prompt_version: PROMPT_VERSION,
        sources: [],
        aliases: [synthesis.title],
        tags: [],
        topics: [],
        member_count: community.members.length,
        representative_claims: [community.representativeId],
        last_summarized_at: now,
      };
      const body = `# ${synthesis.title}\n\n${synthesis.summary}\n\nMembers: ${String(community.members.length)} concepts.\n`;
      await vault.write({ frontmatter: fm, body });
      topicsWritten += 1;

      await graph.upsertNode({
        id: topicId,
        type: 'Topic',
        props: {
          title: synthesis.title,
          summary: synthesis.summary,
          member_count: community.members.length,
        },
      });
      for (const memberId of community.members) {
        await graph.upsertEdge({
          from: memberId,
          to: topicId,
          type: 'RELATED_TO',
          validAt: now,
          confidence: 1,
        });
        edgesWritten += 1;
      }
    }

    logger.info('topic.detect.finished', {
      topicsWritten,
      edgesWritten,
      costUsd: totalCost,
    });

    return {
      totalNodes: subgraph.nodes.length,
      totalEdges: subgraph.edges.length,
      communitiesFound: communities.length,
      communitiesAccepted: communities.length,
      topicsWritten,
      edgesWritten,
      topics,
      costUsd: totalCost,
    };
  } finally {
    if (options.graph === undefined) await graph.close();
    if (queue !== null) queue.close();
  }
};
