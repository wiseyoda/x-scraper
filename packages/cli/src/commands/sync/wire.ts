/**
 * Production wiring for `xs sync` — turns env + config into a SyncDeps.
 *
 * Kept separate from the dispatcher so unit tests don't have to drag in
 * the Anthropic SDK / Patchright / neo4j-driver. Tests inject deps; only
 * the bin uses this.
 */

import * as fs from 'node:fs';

import Anthropic from '@anthropic-ai/sdk';
import { canonicalizeUrl, entityId } from '@x-scraper/core';
import type { CostSink } from '@x-scraper/embeddings';
import { createGeminiEmbedding } from '@x-scraper/embeddings';
import { createNeo4jGraph } from '@x-scraper/graph';
import {
  createArticleIngestor,
  createPdfIngestor,
  createRepoIngestor,
  createYouTubeIngestor,
  type Ingestor,
} from '@x-scraper/ingestor';
import type { LlmCostSink } from '@x-scraper/llm';
import { createClaudeProvider } from '@x-scraper/llm';
import { createLogger, jsonLineSink } from '@x-scraper/observability';
import type { JobQueue } from '@x-scraper/queue';
import { createSqliteQueue } from '@x-scraper/queue';
import type { ErCandidateFinder, ExistingClaim } from '@x-scraper/reconciler';
import { createMarkdownVault } from '@x-scraper/vault';

import type { ClaimFinder, SourceItem, SyncDeps } from './types.js';

export interface WireConfig {
  envFilePath: string;
  vaultDir: string;
  queuePath: string;
  /** Optional list of URLs to ingest. If absent, the bin will read --urls. */
  curatedUrls?: string[];
}

export const parseEnvFile = (envPath: string): Record<string, string> => {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#') || t.length === 0) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const v = t.slice(eq + 1).trim();
    if (v.length > 0) out[t.slice(0, eq).trim()] = v;
  }
  return out;
};

const requireKey = (env: Record<string, string>, key: string): string => {
  const v = process.env[key] ?? env[key];
  if (v === undefined || v.length === 0) {
    throw new Error(`xs sync: required env var ${key} is not set`);
  }
  return v;
};

export const buildCuratedSources = (urls: string[]): SourceItem[] =>
  urls.map((rawUrl) => {
    const url = canonicalizeUrl(rawUrl);
    return {
      sourceId: entityId('Source', url),
      sourceKind: 'bookmarks',
      url,
    };
  });

export interface WiredAdapters {
  deps: SyncDeps;
  cleanup: () => Promise<void>;
}

export const wireSyncDeps = async (
  config: WireConfig,
  curated: SourceItem[],
): Promise<WiredAdapters> => {
  const env = parseEnvFile(config.envFilePath);
  const queue: JobQueue = createSqliteQueue(config.queuePath);
  const vault = createMarkdownVault(config.vaultDir);
  await vault.init();

  const graph = createNeo4jGraph({
    uri: requireKey(env, 'NEO4J_URI'),
    user: requireKey(env, 'NEO4J_USER'),
    password: requireKey(env, 'NEO4J_PASSWORD'),
  });
  await graph.init();

  // Cost sinks: every external adapter records into the queue's cost
  // ledger so `xs cost` reflects this run accurately.
  const embedCost: CostSink = { recordCost: (c) => queue.recordCost(c) };
  const llmCost: LlmCostSink = { recordCost: (c) => queue.recordCost(c) };

  // Embedding cost attribution carries entryId when this wire is for
  // a single bookmark sync (T22). For multi-source URL syncs the
  // attribution is wire-time-fixed; entry_id is not meaningful there.
  const wireTimeEntryId = curated.length === 1 ? curated[0]?.entryId : undefined;
  const embeddings = createGeminiEmbedding({
    apiKey: requireKey(env, 'GEMINI_API_KEY'),
    cost: {
      sink: embedCost,
      ...(wireTimeEntryId === undefined ? {} : { entryId: wireTimeEntryId }),
    },
  });

  const anthropic = new Anthropic({ apiKey: requireKey(env, 'ANTHROPIC_API_KEY') });
  const llm = createClaudeProvider({
    messagesCreate: (input) => anthropic.messages.create(input),
    cost: llmCost,
  });

  const githubToken = process.env.GITHUB_TOKEN ?? env.GITHUB_TOKEN;
  const ingestors: Ingestor[] = [
    createPdfIngestor(),
    createRepoIngestor(githubToken === undefined ? {} : { token: githubToken }),
    createYouTubeIngestor(),
    createArticleIngestor(),
  ];

  const erFinder: ErCandidateFinder = {
    findCandidates: async (type, embedding, k) => {
      // Source/Topic/Claim hit different indexes (Source/Topic have no
      // ER; Claim uses claim_embed_idx); everything else hits
      // entity_embed_idx via the Entity meta-label.
      return graph.vectorSearch(type, embedding, k);
    },
    findByNormalizedSurface: (type, surfaces) =>
      graph.findEntityByNormalizedSurface(type, surfaces),
  };

  // Existing-claims lookup wired to the graph adapter — replaces the old
  // empty-stub that made every claim land as ADD. UPDATE/DELETE
  // reconciliation paths now actually fire.
  const claimFinder: ClaimFinder = {
    findClaimsForSubject: async (subject: string): Promise<ExistingClaim[]> => {
      const rows = await graph.findClaimsForSubject(subject);
      return rows.map((r) => ({
        id: r.id,
        subject: r.subject,
        predicate: r.predicate,
        object: r.object,
        validAt: r.validAt,
        invalidAt: r.invalidAt,
        sourceId: r.sourceId,
      }));
    },
  };

  const logger = createLogger({
    level: 'info',
    sink: jsonLineSink((line) => {
      process.stdout.write(line);
    }),
  });

  const deps: SyncDeps = {
    queue,
    vault,
    graph,
    embeddings,
    llm,
    ingestors,
    logger,
    erFinder,
    claimFinder,
    loadSources: () => Promise.resolve(curated),
  };

  const cleanup = async (): Promise<void> => {
    queue.close();
    await graph.close();
  };

  return { deps, cleanup };
};
