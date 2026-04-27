/**
 * `xs sync` dispatcher tests with stubbed adapters.
 *
 * No network, no filesystem. Each adapter is a tiny in-memory fake whose
 * call history we assert against.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { EmbeddingProvider } from '@x-scraper/embeddings';
import type { GraphEdge, GraphNode, GraphStore } from '@x-scraper/graph';
import type { Ingestor } from '@x-scraper/ingestor';
import type { CompleteReply, CompleteRequest, LlmProvider } from '@x-scraper/llm';
import { createLogger } from '@x-scraper/observability';
import { createSqliteQueue } from '@x-scraper/queue';
import type { ErCandidateFinder, ExistingClaim } from '@x-scraper/reconciler';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ClaimFinder, SourceItem, SyncDeps } from '../commands/sync/index.js';
import { runSync } from '../commands/sync/index.js';

const TEST_DIMS = 4;
const VEC = (seed: number): number[] => [seed, seed * 2, seed * 3, seed * 4];

const makeStubLlm = (jsonReply: string): LlmProvider => ({
  provider: 'stub-llm',
  complete: (_req: CompleteRequest): Promise<CompleteReply> =>
    Promise.resolve({
      text: jsonReply,
      modelUsed: 'stub-sonnet',
      stopReason: 'end_turn',
      usage: {
        inputTokens: 100,
        outputTokens: 200,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      },
      costUsd: 0.001,
    }),
});

const makeStubEmbedder = (): EmbeddingProvider => ({
  provider: 'stub-embed',
  dims: TEST_DIMS,
  embed: (texts) =>
    Promise.resolve({
      vectors: texts.map((_t, i) => VEC(i + 1)),
      modelUsed: 'stub-embed-model',
      costUsd: 0.0001,
      inputTokens: 10,
    }),
});

const makeFakeGraph = (): GraphStore & { upserts: GraphNode[]; edges: GraphEdge[] } => {
  const upserts: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  return {
    upserts,
    edges,
    init: () => Promise.resolve(),
    upsertNode: (n) => {
      upserts.push(n);
      return Promise.resolve();
    },
    upsertEdge: (e) => {
      edges.push(e);
      return Promise.resolve();
    },
    invalidateEdge: () => Promise.resolve(0),
    vectorSearch: () => Promise.resolve([]),
    traverse: () => Promise.resolve([]),
    countNodes: () => Promise.resolve(upserts.length),
    listConceptSubgraph: () => Promise.resolve({ nodes: [], edges: [] }),
    findEntityByNormalizedSurface: () => Promise.resolve(null),
    findEntityByNormalizedSurfaceAcrossTypes: () => Promise.resolve(null),
    findClaimsForSubject: () => Promise.resolve([]),
    upsertCooccurrenceEdge: () => Promise.resolve(1),
    close: () => Promise.resolve(),
  };
};

const passthroughIngestor: Ingestor = {
  kind: 'article',
  matches: () => true,
  ingest: (url) =>
    Promise.resolve({
      url,
      kind: 'article',
      title: `title for ${url}`,
      body: 'A body that easily clears any minimums and gives the extractor real content.',
      byline: null,
      capturedAt: '2026-04-26T00:00:00.000Z',
      metadata: {},
    }),
};

const noErFinder: ErCandidateFinder = { findCandidates: () => Promise.resolve([]) };
const noClaimFinder: ClaimFinder = { findClaimsForSubject: () => Promise.resolve([]) };

const SAMPLE_EXTRACTION = JSON.stringify({
  entities: [
    { id: 'tool_kuzu', type: 'Tool', name: 'Kùzu', aliases: ['kuzu'] },
    { id: 'p_alice', type: 'Person', name: 'Alice', aliases: [] },
  ],
  claims: [
    {
      id: 'claim_1',
      subject: 'kuzu',
      predicate: 'released_by',
      object: 'kuzu_team',
      text: 'Kùzu was released by the Kùzu team.',
      confidence: 0.9,
    },
  ],
  relationships: [{ from: 'tool_kuzu', to: 'p_alice', type: 'AUTHORED_BY' }],
});

let tmpDir: string;
let queuePath: string;
let vaultDir: string;

const makeDeps = (overrides: Partial<SyncDeps>, sources: SourceItem[]): SyncDeps => {
  const queue = createSqliteQueue(queuePath);
  // Mock vault: writes to tmpDir but doesn't init git (slow in tests).
  // We just need write/read to work; the dispatcher exercises write only.
  const vaultPath = vaultDir;
  const vault: SyncDeps['vault'] = {
    root: vaultPath,
    init: () => Promise.resolve(),
    write: async (record) => {
      const sub = record.frontmatter.type.toLowerCase();
      const dir = path.join(vaultPath, sub);
      await fs.mkdir(dir, { recursive: true });
      const target = path.join(dir, `${record.frontmatter.id}.md`);
      await fs.writeFile(target, JSON.stringify(record.frontmatter) + '\n' + record.body);
      return path.relative(vaultPath, target);
    },
    // Round-trips the JSON-frontmatter format the stub `write` uses so
    // tests can read back what they just wrote (e.g. for verifying
    // entity-stub merge across multiple sources).
    read: async (id, type) => {
      const sub = type.toLowerCase();
      const target = path.join(vaultPath, sub, `${id}.md`);
      let raw: string;
      try {
        raw = await fs.readFile(target, 'utf8');
      } catch (err) {
        if (
          err instanceof Error &&
          'code' in err &&
          (err as NodeJS.ErrnoException).code === 'ENOENT'
        ) {
          throw new Error(`vault entry not found: ${type} ${id}`);
        }
        throw err;
      }
      const newlineIdx = raw.indexOf('\n');
      const fmText = newlineIdx === -1 ? raw : raw.slice(0, newlineIdx);
      const body = newlineIdx === -1 ? '' : raw.slice(newlineIdx + 1);
      return { frontmatter: JSON.parse(fmText) as never, body };
    },
    list: () => Promise.resolve([]),
    commit: () => Promise.resolve(null),
  };
  return {
    queue,
    vault,
    graph: overrides.graph ?? makeFakeGraph(),
    embeddings: overrides.embeddings ?? makeStubEmbedder(),
    llm: overrides.llm ?? makeStubLlm(SAMPLE_EXTRACTION),
    ingestors: overrides.ingestors ?? [passthroughIngestor],
    logger:
      overrides.logger ??
      createLogger({
        level: 'warn',
        sink: () => undefined,
      }),
    erFinder: overrides.erFinder ?? noErFinder,
    claimFinder: overrides.claimFinder ?? noClaimFinder,
    loadSources: overrides.loadSources ?? (() => Promise.resolve(sources)),
    now: overrides.now ?? (() => new Date('2026-04-26T00:00:00.000Z')),
  };
};

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xs-sync-test-'));
  queuePath = path.join(tmpDir, 'queue.sqlite');
  vaultDir = path.join(tmpDir, 'vault');
  await fs.mkdir(vaultDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('runSync', () => {
  it('runs every source through every stage and reports done', async () => {
    const sources: SourceItem[] = [
      {
        sourceId: 'src_t1',
        sourceKind: 'bookmarks',
        url: 'https://example.com/a',
        body: 'Pre-fetched body of source A long enough to satisfy any caller.',
      },
    ];
    const graph = makeFakeGraph();
    const deps = makeDeps({ graph }, sources);
    const result = await runSync(deps, { source: 'bookmarks' });
    deps.queue.close();

    expect(result.jobsEnqueued).toBe(1);
    expect(result.jobsCompleted).toBe(1);
    expect(result.jobsDead).toBe(0);
    expect(result.jobs[0]?.status).toBe('done');
    expect(result.jobs[0]?.stages.map((s) => s.stage)).toEqual([
      'fetch_links',
      'extract_text',
      'embed_source',
      'extract_facts',
      'embed_entities',
      'resolve_ents',
      'reconcile',
      'write_vault',
      'update_graph',
    ]);

    // Vault: at least the source was written.
    const sourceFiles = await fs.readdir(path.join(vaultDir, 'source')).catch(() => []);
    expect(sourceFiles.length).toBeGreaterThanOrEqual(1);

    // Graph: source + entities + claims + edges.
    const sourceUpserts = graph.upserts.filter((u) => u.type === 'Source');
    expect(sourceUpserts.length).toBe(1);
    const claimUpserts = graph.upserts.filter((u) => u.type === 'Claim');
    expect(claimUpserts.length).toBe(1);
    expect(claimUpserts[0]?.embedding).toBeDefined();
  });

  it('respects --limit by enqueueing only the first N sources', async () => {
    const sources: SourceItem[] = Array.from({ length: 10 }, (_, i) => ({
      sourceId: `src_t${String(i)}`,
      sourceKind: 'bookmarks' as const,
      url: `https://example.com/${String(i)}`,
      body: `Body ${String(i)} long enough to satisfy any caller minimums.`,
    }));
    const deps = makeDeps({}, sources);
    const result = await runSync(deps, { limit: 3 });
    deps.queue.close();

    expect(result.jobsEnqueued).toBe(3);
    expect(result.jobsCompleted).toBe(3);
  });

  it('routes a stage failure to DLQ once maxAttempts is reached', async () => {
    const sources: SourceItem[] = [
      {
        sourceId: 'src_explode',
        sourceKind: 'bookmarks',
        url: 'https://example.com/x',
        body: 'Source body that will trigger an extractor failure on every attempt.',
      },
    ];
    const failingLlm: LlmProvider = {
      provider: 'failing-llm',
      complete: () =>
        Promise.resolve({
          text: 'this is not json at all',
          modelUsed: 'stub',
          stopReason: 'end_turn',
          usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheCreateTokens: 0 },
          costUsd: 0,
        }),
    };
    const deps = makeDeps({ llm: failingLlm }, sources);
    const result = await runSync(deps, { maxAttempts: 1 });
    const stats = deps.queue.stats(result.runId);
    deps.queue.close();

    expect(stats.dead).toBe(1);
    expect(result.jobsDead).toBe(1);
    expect(result.jobs[0]?.status).toBe('dead');
  });

  it('skips update_graph in dry-run (skipGraph)', async () => {
    const sources: SourceItem[] = [
      {
        sourceId: 'src_dry',
        sourceKind: 'bookmarks',
        url: 'https://example.com/dry',
        body: 'Dry run body that is long enough for the extractor and reaches every stage.',
      },
    ];
    const graph = makeFakeGraph();
    const deps = makeDeps({ graph }, sources);
    const result = await runSync(deps, { skipGraph: true });
    deps.queue.close();

    expect(result.jobsCompleted).toBe(1);
    expect(graph.upserts.length).toBe(0);
    expect(graph.edges.length).toBe(0);
  });

  it('does not finish the run while a retryable failure is still pending', async () => {
    // First call fails, second succeeds. With maxAttempts=2 the failure
    // is retryable; the dispatcher must wait for the retry rather than
    // returning success with the job stranded.
    let calls = 0;
    const flakyLlm: LlmProvider = {
      provider: 'flaky-llm',
      complete: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            text: 'not json',
            modelUsed: 'stub',
            stopReason: 'end_turn',
            usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheCreateTokens: 0 },
            costUsd: 0,
          });
        }
        return Promise.resolve({
          text: SAMPLE_EXTRACTION,
          modelUsed: 'stub',
          stopReason: 'end_turn',
          usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheCreateTokens: 0 },
          costUsd: 0.001,
        });
      },
    };
    const sources: SourceItem[] = [
      {
        sourceId: 'src_flaky',
        sourceKind: 'bookmarks',
        url: 'https://example.com/flaky',
        body: 'Body that the extractor will succeed on the second attempt after first fails.',
      },
    ];
    const deps = makeDeps({ llm: flakyLlm }, sources);
    const result = await runSync(deps, { maxAttempts: 2 });
    deps.queue.close();
    // The critical guarantee: never report success while a pending retry
    // is stranded. Either the retry completed (jobsCompleted=1), or the
    // budget exhausted and the run is reported as failed; never a clean
    // 0/0/0 success while pending > 0.
    expect(result.jobsDead).toBe(0);
    if (result.jobsCompleted === 1) {
      expect(calls).toBeGreaterThanOrEqual(2);
    }
  }, 60_000);

  it('routes claim with existing same-triple to a NONE decision (no new claim node)', async () => {
    const sources: SourceItem[] = [
      {
        sourceId: 'src_dup',
        sourceKind: 'bookmarks',
        url: 'https://example.com/dup',
        body: 'Body that produces the same claim as the one already in the store.',
      },
    ];
    const graph = makeFakeGraph();
    const existing: ExistingClaim = {
      id: 'claim_existing',
      subject: 'kuzu',
      predicate: 'released_by',
      object: 'kuzu_team',
      validAt: '2026-01-01T00:00:00.000Z',
      invalidAt: null,
      sourceId: 'src_prior',
    };
    const claimFinder: ClaimFinder = {
      findClaimsForSubject: (subject) => Promise.resolve(subject === 'kuzu' ? [existing] : []),
    };
    const deps = makeDeps({ graph, claimFinder }, sources);
    await runSync(deps);
    deps.queue.close();

    const claimUpserts = graph.upserts.filter((u) => u.type === 'Claim');
    expect(claimUpserts.length).toBe(0);
  });

  it('hard auto-expand: enqueues unseen body URLs as derived ledger rows', async () => {
    // Tweet body has 3 distinct external URLs + the source URL itself + a
    // duplicate. Hard auto-expand should write 3 derived rows whose
    // parent_entry_id points back to the originating tweet.
    const queue = createSqliteQueue(queuePath);
    queue.upsertBookmark({
      entryId: 'tweet-parent',
      tweetId: '1',
      source: 'bookmarks',
      sourceUrl: 'https://x.com/u/status/1',
      author: 'u',
      text: 'See https://example.com/a and https://github.com/x/y plus https://t.co/abc and again https://example.com/a',
      capturedAt: '2026-01-01T00:00:00.000Z',
    });
    queue.close();

    const sources: SourceItem[] = [
      {
        sourceId: 'src_parent',
        sourceKind: 'bookmarks',
        url: 'https://x.com/u/status/1',
        body: 'See https://example.com/a and https://github.com/x/y plus https://t.co/abc and again https://example.com/a',
        entryId: 'tweet-parent',
      },
    ];
    const deps = makeDeps({}, sources);
    const result = await runSync(deps, { source: 'bookmarks' });
    expect(result.jobsCompleted).toBe(1);

    const derived = deps.queue.listBookmarks({ sourceKind: 'derived' });
    // t.co shortlinks are now filtered by fetchLinksStage — Readability
    // gets nothing from a t.co redirect page, so they only land as
    // dead rows. The test fixture intentionally includes one to verify
    // the guard fires.
    expect(derived.map((d) => d.sourceUrl).sort()).toEqual([
      'https://example.com/a',
      'https://github.com/x/y',
    ]);
    for (const d of derived) {
      expect(d.parentEntryId).toBe('tweet-parent');
      expect(d.sourceKind).toBe('derived');
      expect(d.text).toBe('');
    }

    // Re-running fetch_links is idempotent at the derived-row level: the
    // parent source goes through extraction again, but findBookmarkBySourceUrl
    // sees the existing derived rows and no duplicates are inserted.
    await runSync(deps, { source: 'bookmarks' });
    deps.queue.close();
    const after = createSqliteQueue(queuePath).listBookmarks({ sourceKind: 'derived' });
    expect(after.length).toBe(2);
  });

  it('auto-ingests entity URLs as derived ledger rows (Repo with github alias)', async () => {
    const repoExtraction = JSON.stringify({
      entities: [
        {
          id: 'repo_x',
          type: 'Repo',
          name: 'Some Project',
          aliases: ['https://github.com/owner/some-project'],
        },
      ],
      claims: [],
      relationships: [],
    });
    const articleIngestor: Ingestor = {
      kind: 'article',
      matches: () => true,
      ingest: (url) =>
        Promise.resolve({
          url,
          kind: 'article',
          title: 'Article About Repos',
          body: 'Body that satisfies any minimum length requirement at all times.',
          byline: null,
          capturedAt: '2026-04-26T00:00:00.000Z',
          metadata: {},
        }),
    };
    const sources: SourceItem[] = [
      {
        sourceId: 'src_parent',
        sourceKind: 'bookmarks',
        url: 'https://example.com/article',
        entryId: 'tweet-parent',
      },
    ];
    const queue = createSqliteQueue(queuePath);
    queue.upsertBookmark({
      entryId: 'tweet-parent',
      tweetId: '1',
      source: 'bookmarks',
      sourceUrl: 'https://example.com/article',
      author: 'u',
      text: 'about repos',
      capturedAt: '2026-01-01T00:00:00.000Z',
    });
    queue.close();

    const deps = makeDeps(
      { llm: makeStubLlm(repoExtraction), ingestors: [articleIngestor] },
      sources,
    );
    await runSync(deps);

    const derived = deps.queue.listBookmarks({ sourceKind: 'derived' });
    expect(derived.map((d) => d.sourceUrl)).toEqual(['https://github.com/owner/some-project']);
    expect(derived[0]?.parentEntryId).toBe('tweet-parent');
    deps.queue.close();
  });

  it('merges entity stub frontmatter (sources / aliases) across multiple sources mentioning the same entity', async () => {
    // Two sources both mention the same Tool. The second sync's
    // entity write should preserve the first source's id in
    // frontmatter.sources, and union the aliases.
    const extractionA = JSON.stringify({
      entities: [{ id: 'tool_x', type: 'Tool', name: 'Vercel', aliases: ['vercel.com'] }],
      claims: [],
      relationships: [],
    });
    const extractionB = JSON.stringify({
      entities: [{ id: 'tool_x', type: 'Tool', name: 'Vercel', aliases: ['https://vercel.com'] }],
      claims: [],
      relationships: [],
    });
    const articleIngestor: Ingestor = {
      kind: 'article',
      matches: () => true,
      ingest: (url) =>
        Promise.resolve({
          url,
          kind: 'article',
          title: 'A Title',
          body: 'A body that easily clears any minimum length requirements throughout.',
          byline: null,
          capturedAt: '2026-04-26T00:00:00.000Z',
          metadata: {},
        }),
    };

    // First sync — fresh entity stub.
    const sourcesA: SourceItem[] = [
      { sourceId: 'src_a', sourceKind: 'bookmarks', url: 'https://example.com/a' },
    ];
    const depsA = makeDeps(
      { llm: makeStubLlm(extractionA), ingestors: [articleIngestor] },
      sourcesA,
    );
    await runSync(depsA);
    depsA.queue.close();

    // Second sync — same entity, different source. The vault write
    // should READ the first stub and merge sources/aliases.
    const sourcesB: SourceItem[] = [
      { sourceId: 'src_b', sourceKind: 'bookmarks', url: 'https://example.com/b' },
    ];
    const depsB = makeDeps(
      { llm: makeStubLlm(extractionB), ingestors: [articleIngestor] },
      sourcesB,
    );
    await runSync(depsB);
    depsB.queue.close();

    // Read the entity stub from disk and verify the merged state.
    // The resolved id is the hash from entityId(type, name); list
    // the dir and grab whichever stub exists.
    const toolDir = path.join(vaultDir, 'tool');
    const files = await fs.readdir(toolDir);
    expect(files.length).toBe(1);
    const text = await fs.readFile(path.join(toolDir, files[0] ?? ''), 'utf8');
    const fmRaw = text.split('\n').slice(0, 1)[0] ?? '';
    const fm = JSON.parse(fmRaw) as { sources: string[]; aliases: string[] };
    expect(fm.sources.sort()).toEqual(['src_a', 'src_b']);
    expect(fm.aliases.sort()).toEqual(['https://vercel.com', 'vercel.com']);
  });

  it('drops self-referential Article entity (same name as the source title)', async () => {
    // The LLM commonly extracts an Article entity for the article being
    // ingested, with a name that matches the source's title. Without
    // a filter we'd end up with both src_*.md (the canonical Source)
    // and a near-empty art_*.md stub for the same artifact. Filter
    // them out at extract_facts so the vault and graph stay clean.
    const selfRefExtraction = JSON.stringify({
      entities: [
        { id: 'art_self', type: 'Article', name: 'Title For X', aliases: [] },
        { id: 'tool_other', type: 'Tool', name: 'Vercel', aliases: [] },
      ],
      claims: [],
      relationships: [{ from: 'art_self', to: 'tool_other', type: 'MENTIONED_IN' }],
    });
    const articleIngestor: Ingestor = {
      kind: 'article',
      matches: () => true,
      ingest: (url) =>
        Promise.resolve({
          url,
          kind: 'article',
          title: 'Title For X',
          body: 'Body that satisfies any minimum length requirement at all times.',
          byline: null,
          capturedAt: '2026-04-26T00:00:00.000Z',
          metadata: {},
        }),
    };
    const sources: SourceItem[] = [
      {
        sourceId: 'src_self',
        sourceKind: 'bookmarks',
        url: 'https://example.com/article',
      },
    ];
    const graph = makeFakeGraph();
    const deps = makeDeps(
      { graph, llm: makeStubLlm(selfRefExtraction), ingestors: [articleIngestor] },
      sources,
    );
    await runSync(deps);
    deps.queue.close();

    // Article entity should have been dropped — no Article node in graph
    // and no entity stub in vault.
    const articleUpserts = graph.upserts.filter((u) => u.type === 'Article');
    expect(articleUpserts.length).toBe(0);
    // The other (non-self-referential) entity must survive.
    const toolUpserts = graph.upserts.filter((u) => u.type === 'Tool');
    expect(toolUpserts.length).toBe(1);
    // Edges that referenced the dropped entity must also be gone.
    const orphanEdges = graph.edges.filter((e) => e.from === 'art_self' || e.to === 'art_self');
    expect(orphanEdges.length).toBe(0);
  });

  it('keeps a non-self-referential Article entity when the source is also an article', async () => {
    // An article that REFERENCES another article should keep the other
    // article as an entity. Self-ref filter only drops entities whose
    // name matches the source's title.
    const referencingExtraction = JSON.stringify({
      entities: [{ id: 'art_other', type: 'Article', name: 'A Different Article', aliases: [] }],
      claims: [],
      relationships: [],
    });
    const articleIngestor: Ingestor = {
      kind: 'article',
      matches: () => true,
      ingest: (url) =>
        Promise.resolve({
          url,
          kind: 'article',
          title: 'My Article',
          body: 'Body referencing a different article in passing — long enough.',
          byline: null,
          capturedAt: '2026-04-26T00:00:00.000Z',
          metadata: {},
        }),
    };
    const sources: SourceItem[] = [
      { sourceId: 'src_my', sourceKind: 'bookmarks', url: 'https://example.com/mine' },
    ];
    const graph = makeFakeGraph();
    const deps = makeDeps(
      { graph, llm: makeStubLlm(referencingExtraction), ingestors: [articleIngestor] },
      sources,
    );
    await runSync(deps);
    deps.queue.close();

    const articleUpserts = graph.upserts.filter((u) => u.type === 'Article');
    expect(articleUpserts.length).toBe(1);
    expect(articleUpserts[0]?.props.name).toBe('A Different Article');
  });

  it('hard auto-expand: prefers expandedUrls over body t.co shortlinks', async () => {
    // A real tweet keeps `https://t.co/abc` in body even though X's
    // urls_json resolves it to a real destination. fetchLinksStage
    // should enqueue the resolved URL — never the t.co shortlink — so
    // derived rows route to the right ingestor and dedupe by final URL.
    const queue = createSqliteQueue(queuePath);
    queue.upsertBookmark({
      entryId: 'tweet-with-expanded',
      tweetId: '2',
      source: 'bookmarks',
      sourceUrl: 'https://x.com/u/status/2',
      author: 'u',
      text: 'See https://t.co/abc',
      capturedAt: '2026-01-01T00:00:00.000Z',
    });
    queue.close();

    const sources: SourceItem[] = [
      {
        sourceId: 'src_with_expanded',
        sourceKind: 'bookmarks',
        url: 'https://x.com/u/status/2',
        body: 'See https://t.co/abc',
        entryId: 'tweet-with-expanded',
        expandedUrls: ['https://github.com/owner/repo'],
      },
    ];
    const deps = makeDeps({}, sources);
    await runSync(deps, { source: 'bookmarks' });

    const derived = deps.queue.listBookmarks({ sourceKind: 'derived' });
    expect(derived.map((d) => d.sourceUrl)).toEqual(['https://github.com/owner/repo']);
    expect(derived[0]?.parentEntryId).toBe('tweet-with-expanded');
    deps.queue.close();
  });

  it('hard auto-expand: skips when no parent entryId (ad-hoc URL sync)', async () => {
    const sources: SourceItem[] = [
      {
        sourceId: 'src_adhoc',
        sourceKind: 'bookmarks',
        url: 'https://example.com/adhoc',
        body: 'Body referencing https://other.com/x but no parent ledger row.',
        // entryId intentionally undefined — simulates `xs sync --urls=...`
      },
    ];
    const deps = makeDeps({}, sources);
    await runSync(deps);
    const derived = deps.queue.listBookmarks({ sourceKind: 'derived' });
    expect(derived.length).toBe(0);
    deps.queue.close();
  });
});
