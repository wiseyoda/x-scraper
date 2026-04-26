/**
 * Per-stage handlers. Each handler is pure on (deps, ctx) — it reads from
 * deps + ctx and either mutates ctx (writing its output for downstream
 * stages to consume) or throws. The dispatcher catches the throw and
 * routes it to queue.failStage.
 */

import type { Frontmatter } from '@x-scraper/core';
import { contentHash, entityId } from '@x-scraper/core';
import { extract } from '@x-scraper/extractor';
import { ingest } from '@x-scraper/ingestor';
import type { Job, Stage } from '@x-scraper/queue';
import type { ExistingClaim } from '@x-scraper/reconciler';
import { reconcileClaim, resolveEntity } from '@x-scraper/reconciler';

import type { JobContext, SourceItem, SyncDeps, SyncOptions } from './types.js';

const PROMPT_VERSION_DEFAULT = { extraction: 1, reconciliation: 1, embedding: 1 };

const TWEET_HOST_RE = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\//i;

const inferContentType = (url: string): 'tweet' | 'article' | 'repo' | 'video' | 'pdf' => {
  if (TWEET_HOST_RE.test(url)) return 'tweet';
  const lower = url.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (/^https?:\/\/github\.com\/[^/]+\/[^/]+\/?$/i.test(url)) return 'repo';
  if (/youtube\.com\/watch|youtu\.be\//i.test(url)) return 'video';
  return 'article';
};

/**
 * Match http/https URLs in a body. Lazy regex — no need for full URL
 * RFC 3986 compliance because the canonicalizer downstream rejects
 * malformed URLs.
 */
const URL_RE = /https?:\/\/[^\s)]+/g;

export const fetchLinksStage = async (deps: SyncDeps, ctx: JobContext): Promise<void> => {
  // v1.5 soft auto-expand: scan the source body (when pre-fetched, e.g.
  // tweet text from the bookmark ledger) for embedded URLs and log them.
  // Hard auto-expand (enqueueing follow-up jobs with a parent_entry_id
  // dedupe column) is deferred — see HANDOFF.md.
  if (ctx.source.body === undefined || ctx.source.body.length === 0) {
    await Promise.resolve();
    return;
  }
  const matches = ctx.source.body.match(URL_RE) ?? [];
  // Drop the source URL itself (always present in tweet text as a t.co
  // self-reference for media tweets) and dedupe.
  const unique = Array.from(
    new Set(matches.filter((u) => !u.includes(ctx.source.url))),
  );
  if (unique.length > 0) {
    deps.logger.info('sync.fetch_links.discovered', {
      sourceId: ctx.source.sourceId,
      count: unique.length,
      urls: unique,
    });
  }
  await Promise.resolve();
};

export const extractTextStage = async (deps: SyncDeps, ctx: JobContext): Promise<void> => {
  const now = (deps.now ?? ((): Date => new Date()))().toISOString();
  // Pre-fetched body short-circuit: e.g. tweet text already in hand from
  // the scraper, no external fetch needed.
  if (ctx.source.body !== undefined && ctx.source.body.length > 0) {
    ctx.ingested = {
      body: ctx.source.body,
      title: ctx.source.title ?? null,
      byline: ctx.source.byline ?? null,
      capturedAt: ctx.source.discoveredAt ?? now,
      contentType: inferContentType(ctx.source.url),
      metadata: {},
    };
    return;
  }
  const result = await ingest(ctx.source.url, deps.ingestors);
  ctx.ingested = {
    body: result.body,
    title: result.title,
    byline: result.byline,
    capturedAt: result.capturedAt,
    contentType: inferContentType(ctx.source.url),
    metadata: result.metadata,
  };
};

export const embedSourceStage = async (deps: SyncDeps, ctx: JobContext): Promise<void> => {
  if (ctx.ingested === null) {
    throw new Error('embed_source: missing ingested body');
  }
  const result = await deps.embeddings.embed([ctx.ingested.body]);
  const first = result.vectors[0];
  if (first === undefined) {
    throw new Error('embed_source: provider returned zero vectors');
  }
  ctx.embedding = first;
};

export const extractFactsStage = async (deps: SyncDeps, ctx: JobContext): Promise<void> => {
  if (ctx.ingested === null) {
    throw new Error('extract_facts: missing ingested body');
  }
  const result = await extract(deps.llm, {
    body: ctx.ingested.body,
    ...(ctx.ingested.title !== null ? { title: ctx.ingested.title } : {}),
    sourceUrl: ctx.source.url,
    cost: { jobId: ctx.jobId, stage: 'extract_facts' },
  });
  ctx.extraction = {
    entities: result.data.entities.map((e) => ({
      id: e.id,
      type: e.type,
      name: e.name,
      aliases: e.aliases,
    })),
    claims: result.data.claims,
    relationships: result.data.relationships.map((r) => ({
      from: r.from,
      to: r.to,
      type: r.type,
    })),
  };
};

export const resolveEntsStage = async (deps: SyncDeps, ctx: JobContext): Promise<void> => {
  if (ctx.extraction === null) {
    throw new Error('resolve_ents: missing extraction');
  }
  if (ctx.embedding === null) {
    throw new Error('resolve_ents: missing source embedding');
  }
  // Use the source embedding for every entity: the source-vector locality
  // is a usable proxy when we don't yet have per-entity embeddings. A
  // future slice can swap in per-entity embeddings via a second embed call.
  for (const entity of ctx.extraction.entities) {
    const judgement = await resolveEntity(
      {
        candidateName: entity.name,
        candidateEmbedding: ctx.embedding,
        type: entity.type,
      },
      { finder: deps.erFinder },
    );
    const finalId = judgement.matchId ?? entityId(entity.type, entity.name);
    ctx.entityResolutions.set(entity.id, {
      graphId: finalId,
      decision: judgement.decision,
    });
  }
};

export const reconcileStage = async (deps: SyncDeps, ctx: JobContext): Promise<void> => {
  if (ctx.extraction === null) {
    throw new Error('reconcile: missing extraction');
  }
  for (const claim of ctx.extraction.claims) {
    const existing = await deps.claimFinder.findClaimsForSubject(claim.subject);
    const decision = reconcileClaim({
      incoming: { ...claim, sourceId: ctx.source.sourceId },
      existing,
    });
    ctx.claimDecisions.set(claim.id, decision);
  }
};

export const writeVaultStage = async (deps: SyncDeps, ctx: JobContext): Promise<void> => {
  if (ctx.ingested === null) {
    throw new Error('write_vault: missing ingested body');
  }
  const now = (deps.now ?? ((): Date => new Date()))().toISOString();
  const sourceFm: Frontmatter = {
    id: ctx.source.sourceId,
    type: 'Source',
    created_at: now,
    updated_at: now,
    prompt_version: PROMPT_VERSION_DEFAULT,
    sources: [],
    aliases: [],
    tags: [],
    topics: [],
    url: ctx.source.url,
    canonical_url: ctx.source.url,
    captured_at: ctx.ingested.capturedAt,
    content_type: ctx.ingested.contentType,
    host_metadata: {
      sourceKind: ctx.source.sourceKind,
      ...(ctx.ingested.title === null ? {} : { title: ctx.ingested.title }),
      ...(ctx.ingested.byline === null ? {} : { byline: ctx.ingested.byline }),
    },
    content_hash: contentHash(ctx.ingested.body),
    embedding_model: deps.embeddings.provider,
  };
  const sourcePath = await deps.vault.write({ frontmatter: sourceFm, body: ctx.ingested.body });
  ctx.vaultWrites.push(sourcePath);

  if (ctx.extraction === null) return;

  // Write each new/merged entity as an Entity.md (using the resolved
  // graph id as the file id so future writes to the same entity update in
  // place rather than creating duplicates).
  for (const entity of ctx.extraction.entities) {
    const resolution = ctx.entityResolutions.get(entity.id);
    if (resolution === undefined) continue;
    if (entity.type === 'Source' || entity.type === 'Claim' || entity.type === 'Topic') continue;
    const entityFm: Frontmatter = {
      id: resolution.graphId,
      type: entity.type,
      created_at: now,
      updated_at: now,
      prompt_version: PROMPT_VERSION_DEFAULT,
      sources: [ctx.source.sourceId],
      aliases: entity.aliases,
      tags: [],
      topics: [],
      name: entity.name,
    };
    const entityPath = await deps.vault.write({
      frontmatter: entityFm,
      body: entity.aliases.length > 0 ? `Aliases: ${entity.aliases.join(', ')}\n` : '',
    });
    ctx.vaultWrites.push(entityPath);
  }

  // Write each ADD/UPDATE claim as a Claim.md. NONE/DELETE don't write a
  // new claim file.
  for (const claim of ctx.extraction.claims) {
    const decision = ctx.claimDecisions.get(claim.id);
    if (decision === undefined) continue;
    if (decision.action === 'NONE' || decision.action === 'DELETE') continue;
    const claimId = entityId('Claim', `${claim.subject}|${claim.predicate}|${claim.object}`);
    const claimFm: Frontmatter = {
      id: claimId,
      type: 'Claim',
      created_at: now,
      updated_at: now,
      prompt_version: PROMPT_VERSION_DEFAULT,
      sources: [ctx.source.sourceId],
      aliases: [],
      tags: [],
      topics: [],
      confidence: claim.confidence,
      valid_at: now,
      invalid_at: null,
      subject: claim.subject,
      predicate: claim.predicate,
      object: claim.object,
      contradicts: [],
      supersedes:
        decision.action === 'UPDATE' && decision.existingId !== null ? [decision.existingId] : [],
    };
    const claimPath = await deps.vault.write({ frontmatter: claimFm, body: claim.text });
    ctx.vaultWrites.push(claimPath);
  }
};

export const updateGraphStage = async (deps: SyncDeps, ctx: JobContext): Promise<void> => {
  if (ctx.ingested === null) throw new Error('update_graph: missing ingested body');
  const now = (deps.now ?? ((): Date => new Date()))().toISOString();
  // Source node (no embedding on Source — embeddings live on Claim).
  await deps.graph.upsertNode({
    id: ctx.source.sourceId,
    type: 'Source',
    props: {
      url: ctx.source.url,
      content_type: ctx.ingested.contentType,
      captured_at: ctx.ingested.capturedAt,
    },
  });
  if (ctx.extraction === null) return;

  for (const entity of ctx.extraction.entities) {
    const resolution = ctx.entityResolutions.get(entity.id);
    if (resolution === undefined) continue;
    if (entity.type === 'Source' || entity.type === 'Claim' || entity.type === 'Topic') continue;
    await deps.graph.upsertNode({
      id: resolution.graphId,
      type: entity.type,
      props: { name: entity.name, aliases: entity.aliases },
    });
    await deps.graph.upsertEdge({
      from: resolution.graphId,
      to: ctx.source.sourceId,
      type: 'MENTIONED_IN',
      validAt: now,
      confidence: 1,
    });
  }

  for (const claim of ctx.extraction.claims) {
    const decision = ctx.claimDecisions.get(claim.id);
    if (decision === undefined) continue;
    const claimGraphId = entityId('Claim', `${claim.subject}|${claim.predicate}|${claim.object}`);

    // For UPDATE/DELETE we need to invalidate the existing claim's edge to
    // ITS original source, not to the current source. Look up the existing
    // claim from the same per-subject lookup the reconcile stage used.
    const findExistingFor = async (existingId: string): Promise<ExistingClaim | null> => {
      const existing = await deps.claimFinder.findClaimsForSubject(claim.subject);
      return existing.find((c) => c.id === existingId) ?? null;
    };

    if (decision.action === 'DELETE' && decision.existingId !== null) {
      const existing = await findExistingFor(decision.existingId);
      if (existing !== null) {
        await deps.graph.invalidateEdge(
          decision.existingId,
          existing.sourceId,
          'EXTRACTED_FROM',
          now,
        );
      }
      continue;
    }

    if (decision.action === 'NONE') continue;

    if (decision.action === 'UPDATE' && decision.existingId !== null) {
      // Invalidate the prior current edge from the superseded claim to ITS
      // source (not the new source — the old claim's provenance is what
      // we're invalidating). The new claim edge is created below.
      const existing = await findExistingFor(decision.existingId);
      if (existing !== null) {
        await deps.graph.invalidateEdge(
          decision.existingId,
          existing.sourceId,
          'EXTRACTED_FROM',
          now,
        );
      }
    }

    if (ctx.embedding === null) {
      throw new Error('update_graph: claim node needs source embedding');
    }
    await deps.graph.upsertNode({
      id: claimGraphId,
      type: 'Claim',
      props: {
        subject: claim.subject,
        predicate: claim.predicate,
        object: claim.object,
        text: claim.text,
        confidence: claim.confidence,
      },
      embedding: ctx.embedding,
    });
    await deps.graph.upsertEdge({
      from: claimGraphId,
      to: ctx.source.sourceId,
      type: 'EXTRACTED_FROM',
      validAt: now,
      confidence: claim.confidence,
    });
  }

  // Relationship edges between entities. Skip silently when either side
  // didn't get resolved (the model occasionally emits relationships
  // referencing entity ids it didn't include in entities[]).
  for (const rel of ctx.extraction.relationships) {
    const fromRes = ctx.entityResolutions.get(rel.from);
    const toRes = ctx.entityResolutions.get(rel.to);
    if (fromRes === undefined || toRes === undefined) continue;
    await deps.graph.upsertEdge({
      from: fromRes.graphId,
      to: toRes.graphId,
      type: rel.type as Parameters<typeof deps.graph.upsertEdge>[0]['type'],
      validAt: now,
      confidence: 0.8,
    });
  }
};

const STAGE_HANDLERS: Record<Stage, (deps: SyncDeps, ctx: JobContext) => Promise<void>> = {
  fetch_links: fetchLinksStage,
  extract_text: extractTextStage,
  embed_source: embedSourceStage,
  extract_facts: extractFactsStage,
  resolve_ents: resolveEntsStage,
  reconcile: reconcileStage,
  write_vault: writeVaultStage,
  update_graph: updateGraphStage,
};

export const stageHandlers = (
  options: SyncOptions = {},
): Record<Stage, (deps: SyncDeps, ctx: JobContext) => Promise<void>> => {
  if (options.skipGraph !== true && options.skipVault !== true) return STAGE_HANDLERS;
  // Dry-run / reindex modes: substitute a no-op for whichever stage the
  // caller wants to skip. update_graph is owned by `xs sync --dry-run`;
  // write_vault is owned by `xs reindex` (the vault is its source of truth).
  const noop = async (): Promise<void> => {
    await Promise.resolve();
  };
  return {
    ...STAGE_HANDLERS,
    ...(options.skipGraph === true ? { update_graph: noop } : {}),
    ...(options.skipVault === true ? { write_vault: noop } : {}),
  };
};

export const handlerFor = (
  stage: Stage,
  options: SyncOptions = {},
): ((deps: SyncDeps, ctx: JobContext) => Promise<void>) => {
  const handler = stageHandlers(options)[stage];
  return handler;
};

export const _internalForTesting = { inferContentType };

export const _bookmarkUrl = (job: Job, source: SourceItem): string => {
  void job;
  return source.url;
};
