/**
 * Per-stage handlers. Each handler is pure on (deps, ctx) — it reads from
 * deps + ctx and either mutates ctx (writing its output for downstream
 * stages to consume) or throws. The dispatcher catches the throw and
 * routes it to queue.failStage.
 */

import { buildTweetCapture, captureWithCache, toIngestedSource } from '@x-scraper/capture';
import type { Frontmatter } from '@x-scraper/core';
import { canonicalizeUrl, contentHash, entityId } from '@x-scraper/core';
import { extract, EXTRACTION_PROMPT_VERSION } from '@x-scraper/extractor';
import { ingest, X_TWEET_URL_RE } from '@x-scraper/ingestor';
import type { Job, Stage } from '@x-scraper/queue';
import type { ExistingClaim } from '@x-scraper/reconciler';
import {
  normalizedSurfaceForms,
  normalizeEntityName,
  reconcileClaim,
  resolveEntity,
} from '@x-scraper/reconciler';

import type { JobContext, SourceItem, SyncDeps, SyncOptions } from './types.js';

const PROMPT_VERSION_DEFAULT = {
  extraction: EXTRACTION_PROMPT_VERSION,
  reconciliation: 1,
  embedding: 1,
};

const TWEET_HOST_RE = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\//i;
// X Articles (long-form posts) live at x.com/<user>/article/<id> or
// x.com/i/article/<id>. Must be detected BEFORE the tweet-host check
// because the host is also x.com.
const X_ARTICLE_PATH_RE =
  /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:i\/)?[^/]+\/article\/\d+/i;

const inferContentType = (url: string): 'tweet' | 'article' | 'repo' | 'video' | 'pdf' => {
  if (X_ARTICLE_PATH_RE.test(url)) return 'article';
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
  // Hard auto-expand: discover embedded URLs in the source, dedupe
  // against the live bookmark_ledger, and enqueue any unseen URL as a
  // derived ledger row whose parent_entry_id points back to the
  // current bookmark. The next `xs bookmarks sync` pass picks them up
  // and runs them through the existing ingestor → extractor → graph
  // pipeline (article/pdf/repo/youtube routing handled by the URL
  // host classifier in extractTextStage).
  //
  // Tweets keep `https://t.co/...` shortlinks in the body even though
  // X resolves them to expandedUrls in the ledger row's urls_json. If
  // we scan only the body we'd dedupe by t.co and route every derived
  // tweet-link through the default article ingestor — missing repo /
  // video / pdf / X-Article routing AND breaking final-URL dedup. So
  // when expandedUrls is supplied we trust it; otherwise we fall back
  // to body URL_RE scanning (article bodies, ad-hoc URL syncs).
  const rawCandidates: string[] =
    ctx.source.expandedUrls !== undefined && ctx.source.expandedUrls.length > 0
      ? ctx.source.expandedUrls
      : ctx.source.body !== undefined && ctx.source.body.length > 0
        ? (ctx.source.body.match(URL_RE) ?? [])
        : [];
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawCandidates) {
    const trimmed = raw.replace(/[.,;!?)\]]+$/, '');
    if (trimmed.length === 0) continue;
    if (trimmed === ctx.source.url) continue;
    let canonical: string;
    try {
      canonical = canonicalizeUrl(trimmed);
    } catch {
      continue;
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    if (canonical === ctx.source.url) continue;
    // Skip tweet permalinks — we don't ingest standalone tweets (those
    // come in via the bookmark scraper). DON'T skip every same-host
    // URL: a tweet linking to an x.com/i/article/... is a different
    // shape that the X Article ingestor handles, and dropping it here
    // would prevent the only path that auto-ingests linked X Articles.
    if (X_TWEET_URL_RE.test(canonical)) continue;
    candidates.push(canonical);
  }
  if (candidates.length === 0) {
    deps.logger.info('sync.fetch_links.discovered', {
      sourceId: ctx.source.sourceId,
      count: 0,
    });
    await Promise.resolve();
    return;
  }
  // No parent ledger row to attribute derivation to — log discovery
  // only. (Happens for ad-hoc `xs sync --urls=...` invocations.)
  if (ctx.source.entryId === undefined) {
    deps.logger.info('sync.fetch_links.discovered', {
      sourceId: ctx.source.sourceId,
      count: candidates.length,
      urls: candidates,
      derived: 0,
      reason: 'no_parent_entry_id',
    });
    await Promise.resolve();
    return;
  }
  const parentSourceKind = ctx.source.sourceKind;
  // bookmark_ledger.source CHECK constraint allows only bookmarks/likes/posts;
  // anything else falls back to 'bookmarks' since the column tracks origin
  // family, not derivation lineage (sourceKind='derived' lives in source_kind).
  const ledgerSource: 'bookmarks' | 'likes' | 'posts' =
    parentSourceKind === 'likes' || parentSourceKind === 'posts' ? parentSourceKind : 'bookmarks';
  let inserted = 0;
  let alreadyKnown = 0;
  for (const url of candidates) {
    const existing = deps.queue.findBookmarkBySourceUrl(url);
    if (existing !== null) {
      alreadyKnown += 1;
      continue;
    }
    // Deterministic entry_id keeps re-runs idempotent.
    const derivedEntryId = `derived_${entityId('Source', url)}`;
    const result = deps.queue.upsertBookmark({
      entryId: derivedEntryId,
      tweetId: 'derived',
      source: ledgerSource,
      sourceUrl: url,
      text: '',
      capturedAt: new Date().toISOString(),
      parentEntryId: ctx.source.entryId,
      sourceKind: 'derived',
    });
    if (result === 'inserted') inserted += 1;
    else alreadyKnown += 1;
  }
  deps.logger.info('sync.fetch_links.discovered', {
    sourceId: ctx.source.sourceId,
    count: candidates.length,
    derived: inserted,
    alreadyKnown,
  });
};

export const extractTextStage = async (deps: SyncDeps, ctx: JobContext): Promise<void> => {
  const now = (deps.now ?? ((): Date => new Date()))().toISOString();
  // Pre-fetched body short-circuit (tweet text already pulled by the
  // scraper). Persist it as a TweetCaptured so refine sees it the same
  // as any other source.
  if (ctx.source.body !== undefined && ctx.source.body.length > 0) {
    const tweetCaptured = buildTweetCapture(
      {
        url: ctx.source.url,
        text: ctx.source.body,
        title: ctx.source.title ?? null,
        byline: ctx.source.byline ?? null,
      },
      deps.now ?? ((): Date => new Date()),
    );
    if (deps.captureStore !== undefined) {
      await deps.captureStore.write(tweetCaptured);
    }
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

  // Production capture path: read-through cache. Re-runs are network-free.
  if (deps.captureStore !== undefined && deps.captors !== undefined) {
    const { captured, fromCache } = await captureWithCache(
      ctx.source.url,
      deps.captors,
      deps.captureStore,
    );
    deps.logger.info('sync.capture.resolved', {
      sourceId: ctx.source.sourceId,
      url: captured.canonical_url,
      contentType: captured.content_type,
      fromCache,
    });
    const ingested = toIngestedSource(captured);
    ctx.ingested = {
      body: ingested.body,
      title: ingested.title,
      byline: ingested.byline,
      capturedAt: ingested.capturedAt,
      contentType: inferContentType(ctx.source.url),
      metadata: ingested.metadata,
    };
    return;
  }

  // Legacy ingestor fallback (unit tests stub a single passthrough ingestor
  // here; production no longer takes this path).
  if (deps.ingestors === undefined || deps.ingestors.length === 0) {
    throw new Error('extract_text: no captors or ingestors wired');
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

/**
 * Map a source's content_type to the entity type that would represent
 * the same artifact. When the LLM extracts that entity from a source
 * we're already ingesting AS that artifact, the entity stub is
 * self-referential — same content, same id, but with an empty body.
 * Filter these out so the Source.md is the single canonical record.
 */
const SELF_REF_ENTITY_TYPE: Record<string, string> = {
  article: 'Article',
  pdf: 'PDF',
  tweet: 'Tweet',
  video: 'Video',
  repo: 'Repo',
};

const isSelfReferentialEntity = (
  entity: { type: string; name: string },
  contentType: string,
  sourceTitle: string | null,
): boolean => {
  const expectedType = SELF_REF_ENTITY_TYPE[contentType];
  if (expectedType === undefined || entity.type !== expectedType) return false;
  if (sourceTitle === null || sourceTitle.length === 0) return false;
  // Compare on normalized form so trivial whitespace/case differences
  // between the LLM's restatement and the rendered title don't make us
  // miss the self-reference. Both go through normalizeEntityName which
  // does NFKC + lowercase + article-strip.
  return normalizeEntityName(entity.name) === normalizeEntityName(sourceTitle);
};

export const extractFactsStage = async (deps: SyncDeps, ctx: JobContext): Promise<void> => {
  if (ctx.ingested === null) {
    throw new Error('extract_facts: missing ingested body');
  }
  const result = await extract(deps.llm, {
    body: ctx.ingested.body,
    ...(ctx.ingested.title !== null ? { title: ctx.ingested.title } : {}),
    sourceUrl: ctx.source.url,
    cost: {
      jobId: ctx.jobId,
      stage: 'extract_facts',
      ...(ctx.source.entryId === undefined ? {} : { entryId: ctx.source.entryId }),
    },
  });
  // Drop self-referential entities (e.g. an Article entity whose name
  // matches the source's title when content_type is 'article'). Drop
  // any relationship that references the dropped entity too, so the
  // graph stage doesn't try to draw an edge to a missing node.
  const droppedEntityIds = new Set<string>();
  const keptEntities = result.data.entities.filter((e) => {
    if (
      isSelfReferentialEntity(
        { type: e.type, name: e.name },
        ctx.ingested?.contentType ?? '',
        ctx.ingested?.title ?? null,
      )
    ) {
      droppedEntityIds.add(e.id);
      return false;
    }
    return true;
  });
  ctx.extraction = {
    entities: keptEntities.map((e) => ({
      id: e.id,
      type: e.type,
      name: e.name,
      aliases: e.aliases,
    })),
    claims: result.data.claims,
    relationships: result.data.relationships
      .filter((r) => !droppedEntityIds.has(r.from) && !droppedEntityIds.has(r.to))
      .map((r) => ({
        from: r.from,
        to: r.to,
        type: r.type,
      })),
  };

  // Auto-ingest URLs that the model included in entity aliases. When
  // an Article/Repo/Video/PDF entity has a canonical URL alias (a
  // github.com repo, a youtube video, a .pdf, etc.), enqueue a derived
  // ledger row for it. The next sync run picks it up and runs the
  // matching ingestor, populating that entity with rich content
  // (README + description for repos, captions for YouTube, etc.) on
  // a follow-up pass instead of leaving the stub forever empty.
  if (ctx.source.entryId !== undefined) {
    enqueueEntityLinkDerivedRows(deps, ctx);
  }
};

/**
 * Match a URL anywhere inside an alias string. We don't require the
 * alias to BE a URL — sometimes the model returns "github.com/owner/repo"
 * or wraps the URL in punctuation. The lazy regex captures the URL and
 * we canonicalize downstream.
 */
const ALIAS_URL_RE = /\bhttps?:\/\/[^\s)\]]+/i;

const enqueueEntityLinkDerivedRows = (deps: SyncDeps, ctx: JobContext): void => {
  if (ctx.extraction === null) return;
  if (ctx.source.entryId === undefined) return;
  const parentSourceKind = ctx.source.sourceKind;
  const ledgerSource: 'bookmarks' | 'likes' | 'posts' =
    parentSourceKind === 'likes' || parentSourceKind === 'posts' ? parentSourceKind : 'bookmarks';
  const seen = new Set<string>();
  let derived = 0;
  for (const entity of ctx.extraction.entities) {
    // Limit auto-ingest to the linked-artifact entity types — the
    // ones whose ingest produces meaningful content. Skip Person /
    // Tool / Concept where a URL is informational, not a fetch
    // target.
    if (
      entity.type !== 'Article' &&
      entity.type !== 'Repo' &&
      entity.type !== 'Video' &&
      entity.type !== 'PDF'
    ) {
      continue;
    }
    for (const alias of entity.aliases) {
      const match = ALIAS_URL_RE.exec(alias);
      if (match === null) continue;
      const trimmed = match[0].replace(/[.,;!?)\]]+$/, '');
      let canonical: string;
      try {
        canonical = canonicalizeUrl(trimmed);
      } catch {
        continue;
      }
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      if (canonical === ctx.source.url) continue;
      if (X_TWEET_URL_RE.test(canonical)) continue;
      // Don't enqueue t.co shortlinks — Readability gets nothing from
      // them and they aren't canonical URLs anyway. The body's URL_RE
      // already drops them; this guard handles the alias path that
      // discovered them inside an entity's URL alias list.
      try {
        if (new URL(canonical).hostname === 't.co') continue;
      } catch {
        continue;
      }
      if (deps.queue.findBookmarkBySourceUrl(canonical) !== null) continue;
      const result = deps.queue.upsertBookmark({
        entryId: `derived_${entityId('Source', canonical)}`,
        tweetId: 'derived',
        source: ledgerSource,
        sourceUrl: canonical,
        text: '',
        capturedAt: new Date().toISOString(),
        parentEntryId: ctx.source.entryId,
        sourceKind: 'derived',
      });
      if (result === 'inserted') derived += 1;
    }
  }
  if (derived > 0) {
    deps.logger.info('sync.extract_facts.entity_links_enqueued', {
      sourceId: ctx.source.sourceId,
      derived,
    });
  }
};

/**
 * Embed each unique entity name extracted from the source. Stored in
 * ctx.entityEmbeddings keyed by the extractor's local entity id. The
 * resolve_ents stage then uses these (rather than the source embedding)
 * for the HNSW vector ER, dramatically improving entity dedup quality.
 *
 * Skip Source/Topic/Claim — those don't go through entity ER.
 */
export const embedEntitiesStage = async (deps: SyncDeps, ctx: JobContext): Promise<void> => {
  if (ctx.extraction === null) {
    throw new Error('embed_entities: missing extraction');
  }
  // Filter to user-facing entity types and dedupe by id.
  const targets = ctx.extraction.entities.filter(
    (e) => e.type !== 'Source' && e.type !== 'Topic' && e.type !== 'Claim',
  );
  if (targets.length === 0) {
    return;
  }
  const result = await deps.embeddings.embed(targets.map((e) => e.name));
  if (result.vectors.length !== targets.length) {
    throw new Error(
      `embed_entities: provider returned ${result.vectors.length.toString()} vectors for ${targets.length.toString()} entities`,
    );
  }
  for (let i = 0; i < targets.length; i += 1) {
    const entity = targets[i];
    const vec = result.vectors[i];
    if (entity === undefined || vec === undefined) continue;
    ctx.entityEmbeddings.set(entity.id, vec);
  }
};

export const resolveEntsStage = async (deps: SyncDeps, ctx: JobContext): Promise<void> => {
  if (ctx.extraction === null) {
    throw new Error('resolve_ents: missing extraction');
  }
  if (ctx.embedding === null) {
    throw new Error('resolve_ents: missing source embedding');
  }
  // Use per-entity embeddings when embed_entities ran (real entity ER);
  // fall back to the source embedding for entities we didn't embed
  // (e.g. Topic/Claim/Source surfacing through the extractor).
  for (const entity of ctx.extraction.entities) {
    const candidateEmbedding = ctx.entityEmbeddings.get(entity.id) ?? ctx.embedding;
    const judgement = await resolveEntity(
      {
        candidateName: entity.name,
        candidateAliases: entity.aliases,
        candidateEmbedding,
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

/**
 * Write an entity stub, merging sources/aliases/created_at with any
 * existing stub at the same id. The frontmatter `sources` list and
 * `aliases` list grow monotonically across mentions; created_at is
 * preserved from the first mention. The body lists the merged
 * aliases, calls out URL aliases (so Obsidian renders them as links),
 * and lists the sources as wikilinks for click-through navigation.
 */
type MergedEntityType =
  | 'Person'
  | 'Tool'
  | 'Concept'
  | 'Repo'
  | 'Article'
  | 'Tweet'
  | 'Video'
  | 'PDF';

const writeMergedEntity = async (
  vault: SyncDeps['vault'],
  entity: { id: string; type: MergedEntityType; name: string; aliases: string[] },
  currentSourceId: string,
  now: string,
): Promise<string> => {
  let existingSources: string[] = [];
  let existingAliases: string[] = [];
  let createdAt = now;
  let existingName: string | undefined;
  try {
    const existing = await vault.read(entity.id, entity.type);
    const fm = existing.frontmatter as {
      sources?: string[];
      aliases?: string[];
      created_at?: string;
      name?: string;
    };
    existingSources = Array.isArray(fm.sources) ? fm.sources : [];
    existingAliases = Array.isArray(fm.aliases) ? fm.aliases : [];
    if (typeof fm.created_at === 'string' && fm.created_at.length > 0) {
      createdAt = fm.created_at;
    }
    existingName = typeof fm.name === 'string' ? fm.name : undefined;
  } catch {
    // First write — no merge needed.
  }
  const mergedSources = Array.from(new Set([...existingSources, currentSourceId]));
  const mergedAliases = Array.from(new Set([...existingAliases, ...entity.aliases]));
  const fm: Frontmatter = {
    id: entity.id,
    type: entity.type,
    created_at: createdAt,
    updated_at: now,
    prompt_version: PROMPT_VERSION_DEFAULT,
    sources: mergedSources,
    aliases: mergedAliases,
    tags: [],
    topics: [],
    // Prefer the existing stored name to keep the canonical surface
    // form stable across re-mentions; fall back to the incoming name
    // for the first write.
    name: existingName ?? entity.name,
  };
  return await vault.write({
    frontmatter: fm,
    body: buildEntityBody(mergedAliases, mergedSources),
  });
};

const buildEntityBody = (aliases: string[], sources: string[]): string => {
  const lines: string[] = [];
  if (aliases.length > 0) {
    lines.push(`Aliases: ${aliases.join(', ')}`);
    const urlAliases = aliases.filter((a) => /^https?:\/\//i.test(a));
    if (urlAliases.length > 0) {
      lines.push('');
      lines.push('## URLs');
      for (const u of urlAliases) lines.push(`- ${u}`);
    }
  }
  if (sources.length > 0) {
    lines.push('');
    lines.push('## Mentioned in');
    for (const s of sources) lines.push(`- [[${s}]]`);
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
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
  // place rather than creating duplicates). For entities resolved to an
  // existing stub, READ first and merge sources/aliases/created_at so
  // a later mention in source B doesn't clobber the source A backlink.
  for (const entity of ctx.extraction.entities) {
    const resolution = ctx.entityResolutions.get(entity.id);
    if (resolution === undefined) continue;
    if (
      entity.type === 'Source' ||
      entity.type === 'Claim' ||
      entity.type === 'Topic' ||
      entity.type === 'Idea'
    )
      continue;
    const entityPath = await writeMergedEntity(
      deps.vault,
      {
        id: resolution.graphId,
        type: entity.type,
        name: entity.name,
        aliases: entity.aliases,
      },
      ctx.source.sourceId,
      now,
    );
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
      ...(ctx.ingested.byline === null ? {} : { 'host_metadata.byline': ctx.ingested.byline }),
    },
  });
  // T20: when the source has a byline, materialize it as a Person entity
  // and link the Source via AUTHORED_BY. Lets queries answer
  // "show everything bookmarked from @steipete" via Cypher rather than
  // string-matching host_metadata.
  if (ctx.ingested.byline !== null && ctx.ingested.byline.length > 0) {
    const handle = ctx.ingested.byline;
    const personId = entityId('Person', handle);
    const personNormalizedName = normalizeEntityName(handle);
    await deps.graph.upsertNode({
      id: personId,
      type: 'Person',
      props: {
        name: handle,
        handle,
        normalized_name: personNormalizedName,
        normalized_aliases: [personNormalizedName].filter((s) => s.length > 0),
      },
    });
    await deps.graph.upsertEdge({
      from: ctx.source.sourceId,
      to: personId,
      type: 'AUTHORED_BY',
      validAt: now,
      confidence: 1,
    });
  }
  if (ctx.extraction === null) return;

  for (const entity of ctx.extraction.entities) {
    const resolution = ctx.entityResolutions.get(entity.id);
    if (resolution === undefined) continue;
    if (
      entity.type === 'Source' ||
      entity.type === 'Claim' ||
      entity.type === 'Topic' ||
      entity.type === 'Idea'
    )
      continue;
    // normalized_name + normalized_aliases let the reconciler's
    // pre-flight surface-form lookup MATCH this entity on cheap exact
    // equality (catches `AI Agents`/`AI Agent` etc that vector ER
    // misses). Computed at write time; queryable indexed.
    const normalizedName = normalizeEntityName(entity.name);
    const normalizedAliases = normalizedSurfaceForms('', entity.aliases);
    // Per-entity embedding from embed_entities lets entity_embed_idx
    // serve real entity-level vector ER on subsequent ingests; without
    // it the reconciler would still be falling back to source-vector
    // proxy similarity.
    const entityEmbedding = ctx.entityEmbeddings.get(entity.id);
    await deps.graph.upsertNode({
      id: resolution.graphId,
      type: entity.type,
      props: {
        name: entity.name,
        aliases: entity.aliases,
        normalized_name: normalizedName,
        normalized_aliases: normalizedAliases,
      },
      ...(entityEmbedding === undefined ? {} : { embedding: entityEmbedding }),
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

  // Concept co-occurrence edges (T16): every pair of Concept entities
  // mentioned in the same source gets a RELATED_TO edge with weight
  // proportional to inverse-source-frequency (rare-pair edges weigh
  // more than ubiquitous ones). The extractor rarely emits explicit
  // Concept-Concept relationships even when concepts genuinely cluster
  // in the same source — this stage closes that gap so topic detection
  // sees enough edge density to surface meaningful communities.
  //
  // Weight formula: 1 / (1 + ln(1 + sourceCountA + sourceCountB)).
  // Source counts read once per (A, B) pair. UPSERT idempotent — repeat
  // co-occurrence in another source bumps cooccurrence_count + recomputes.
  const conceptResolutions: { graphId: string }[] = [];
  for (const entity of ctx.extraction.entities) {
    if (entity.type !== 'Concept') continue;
    const r = ctx.entityResolutions.get(entity.id);
    if (r !== undefined) conceptResolutions.push({ graphId: r.graphId });
  }
  // Dedupe by graphId — the extractor can emit two synonymous Concepts
  // both resolving to the same node; we don't want self-edges.
  const uniqueConceptIds = Array.from(new Set(conceptResolutions.map((c) => c.graphId)));
  if (uniqueConceptIds.length >= 2) {
    for (let i = 0; i < uniqueConceptIds.length; i += 1) {
      for (let j = i + 1; j < uniqueConceptIds.length; j += 1) {
        const a = uniqueConceptIds[i];
        const b = uniqueConceptIds[j];
        if (a === undefined || b === undefined) continue;
        // Order pair lexicographically so MERGE upserts the same edge
        // regardless of which source happened to emit them in which order.
        const [from, to] = a < b ? [a, b] : [b, a];
        await deps.graph.upsertCooccurrenceEdge({
          from,
          to,
          sourceId: ctx.source.sourceId,
          now,
        });
      }
    }
  }
};

const STAGE_HANDLERS: Record<Stage, (deps: SyncDeps, ctx: JobContext) => Promise<void>> = {
  fetch_links: fetchLinksStage,
  extract_text: extractTextStage,
  embed_source: embedSourceStage,
  extract_facts: extractFactsStage,
  embed_entities: embedEntitiesStage,
  resolve_ents: resolveEntsStage,
  reconcile: reconcileStage,
  write_vault: writeVaultStage,
  update_graph: updateGraphStage,
};

export const stageHandlers = (
  options: SyncOptions = {},
): Record<Stage, (deps: SyncDeps, ctx: JobContext) => Promise<void>> => {
  if (options.skipGraph !== true && options.skipVault !== true && options.skipFetchLinks !== true) {
    return STAGE_HANDLERS;
  }
  // Dry-run / reindex / refine modes: substitute a no-op for whichever
  // stage the caller wants to skip. update_graph is owned by
  // `xs sync --dry-run`; write_vault is owned by `xs reindex`;
  // fetch_links is owned by `xs refine` (re-running extraction over an
  // existing capture should never re-discover derived rows — those were
  // captured at the original sync).
  const noop = async (): Promise<void> => {
    await Promise.resolve();
  };
  return {
    ...STAGE_HANDLERS,
    ...(options.skipGraph === true ? { update_graph: noop } : {}),
    ...(options.skipVault === true ? { write_vault: noop } : {}),
    ...(options.skipFetchLinks === true ? { fetch_links: noop } : {}),
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
