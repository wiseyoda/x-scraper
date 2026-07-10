import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AiBrief } from '@/components/AiBrief';
import { Markdown } from '@/components/Markdown';
import { PinButton } from '@/components/PinButton';
import { ReadButton } from '@/components/ReadButton';
import { TagEditor } from '@/components/TagEditor';
import { TweetCard } from '@/components/TweetCard';
import { readBrief } from '@/lib/ai-brief';
import { authorFromUrl } from '@/lib/author';
import { readArticleCapture, readRepoCapture, readTweetCapture } from '@/lib/capture-cache';
import { isPinned, markVisited, pinnedIdSet } from '@/lib/pins';
import { loadSourceDetail } from '@/lib/source-detail';
import { getSourceState, markRead } from '@/lib/source-state';

export const dynamic = 'force-dynamic';

const CONTENT_TYPE_LABEL: Record<string, string> = {
  tweet: 'Tweet',
  article: 'Article',
  repo: 'Repo',
  video: 'Video',
  pdf: 'PDF',
};

const formatRelative = (iso: string): string => {
  const ms = Date.now() - Date.parse(iso);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${String(days)}d ago`;
  return `${String(Math.floor(days / 30))}mo ago`;
};

export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await loadSourceDetail(id);
  if (detail === null) notFound();

  const fm = detail.frontmatter;
  const [pinned, pinnedSet, sourceState] = await Promise.all([
    isPinned(id),
    pinnedIdSet(),
    getSourceState(id),
  ]);
  await Promise.all([markVisited(id), markRead(id)]);

  // Pull richer payloads from the capture cache when available — gives us
  // the actual tweet text, article body, repo metadata to render inline.
  const [tweetCap, articleCap, repoCap, cachedBrief] = await Promise.all([
    fm.content_type === 'tweet' ? readTweetCapture(fm.canonical_url) : Promise.resolve(null),
    fm.content_type === 'article' || fm.content_type === 'pdf'
      ? readArticleCapture(fm.canonical_url)
      : Promise.resolve(null),
    fm.content_type === 'repo' ? readRepoCapture(fm.canonical_url) : Promise.resolve(null),
    readBrief(id),
  ]);
  const author = authorFromUrl(fm.canonical_url);
  const briefBody = tweetCap?.body ?? articleCap?.body ?? repoCap?.body ?? detail.body ?? '';

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
        ← back to dashboard
      </Link>

      <header className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-medium uppercase text-zinc-300">
            {CONTENT_TYPE_LABEL[fm.content_type] ?? fm.content_type}
          </span>
          {author !== null ? (
            <Link
              href={`/authors/${author.handle}`}
              className="rounded bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-300 ring-1 ring-inset ring-sky-500/30 hover:bg-sky-500/15"
            >
              @{author.display}
            </Link>
          ) : null}
          <span className="text-xs text-zinc-500">captured {formatRelative(fm.captured_at)}</span>
        </div>
        {fm.content_type !== 'tweet' ? (
          <h1 className="mt-3 break-all text-base font-medium text-zinc-300">
            {articleCap?.title !== undefined && articleCap?.title !== null
              ? articleCap.title
              : repoCap?.repo !== undefined && repoCap?.repo !== null
                ? `${repoCap.owner ?? ''}/${repoCap.repo}`
                : fm.canonical_url}
          </h1>
        ) : null}
        {fm.content_type !== 'tweet' &&
        articleCap?.title !== undefined &&
        articleCap?.title !== null ? (
          <p className="mt-1 break-all text-xs text-zinc-500">{fm.canonical_url}</p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span className="font-mono">{fm.id}</span>
          {repoCap?.stars !== undefined && repoCap?.stars !== null ? (
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300">
              ★ {repoCap.stars.toLocaleString()}
            </span>
          ) : null}
          {repoCap?.language !== undefined && repoCap?.language !== null ? (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">
              {repoCap.language}
            </span>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href={fm.canonical_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            {fm.content_type === 'tweet'
              ? 'Open on x.com'
              : fm.content_type === 'repo'
                ? 'Open on GitHub'
                : 'Open original'}{' '}
            ↗
          </a>
          <PinButton id={fm.id} kind="Source" initialPinned={pinned} variant="full" />
          <ReadButton
            id={fm.id}
            initialReadAt={sourceState.readAt ?? new Date().toISOString()}
            variant="full"
          />
        </div>
        <TagEditor id={fm.id} initialTags={sourceState.tags} />
      </header>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          {briefBody.trim().length >= 200 ? (
            <AiBrief
              sourceId={fm.id}
              contentType={fm.content_type}
              body={briefBody}
              url={fm.canonical_url}
              initialBrief={cachedBrief}
            />
          ) : null}
          {tweetCap !== null ? (
            <TweetCard
              authorHandle={tweetCap.authorHandle}
              body={tweetCap.body}
              tweetUrl={tweetCap.url}
              fetchedAt={tweetCap.fetchedAt}
            />
          ) : articleCap !== null && articleCap.body.trim().length > 0 ? (
            <article>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Article
              </h2>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
                <Markdown body={articleCap.body} />
              </div>
            </article>
          ) : repoCap !== null && repoCap.body.trim().length > 0 ? (
            <article>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                README
              </h2>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
                <Markdown body={repoCap.body} />
              </div>
            </article>
          ) : detail.body.trim().length > 0 ? (
            <article>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Captured content
              </h2>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
                <Markdown body={detail.body} />
              </div>
            </article>
          ) : null}

          {detail.claims.length > 0 ? (
            <section className="mt-10">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Claims extracted ({detail.claims.length})
              </h2>
              <ul className="space-y-2">
                {detail.claims.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-md border border-zinc-800 bg-zinc-900/30 p-3 text-sm"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-zinc-200">{c.subject}</span>
                      <span className="text-xs text-zinc-500 font-mono">{c.predicate}</span>
                      <span className="text-zinc-300">{c.object}</span>
                    </div>
                    {c.body.length > 0 ? (
                      <p className="mt-1 line-clamp-3 text-xs text-zinc-400">{c.body}</p>
                    ) : null}
                    <div className="mt-1 flex gap-3 text-[10px] text-zinc-600">
                      <span className="font-mono">{c.id}</span>
                      <span>conf {c.confidence.toFixed(2)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="space-y-8">
          {detail.ideas.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Synthesized into
              </h2>
              <ul className="space-y-2">
                {detail.ideas.map((i) => (
                  <li
                    key={i.id}
                    className="group relative rounded-md border border-zinc-800 bg-zinc-900/40 transition hover:border-zinc-600"
                  >
                    <Link href={`/ideas/${i.id}`} className="block p-3 pr-10">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-zinc-100">
                          {i.subject}
                        </span>
                        {i.autoConfirmed ? (
                          <span className="shrink-0 rounded bg-emerald-500/10 px-1 py-0.5 text-[9px] font-medium text-emerald-400">
                            auto
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex gap-2 text-xs text-zinc-500">
                        <span>{i.status}</span>
                        <span>·</span>
                        <span>{i.sourceCount} sources</span>
                      </div>
                    </Link>
                    <div className="absolute right-1.5 top-1.5">
                      <PinButton id={i.id} kind="Idea" initialPinned={pinnedSet.has(i.id)} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {detail.entities.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Entities mentioned
              </h2>
              <ul className="space-y-1.5">
                {detail.entities.slice(0, 12).map((e) => (
                  <li
                    key={e.id}
                    className="group relative flex items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 pr-1 text-sm transition hover:border-zinc-600"
                  >
                    <Link
                      href={`/entities/${e.id}`}
                      className="flex flex-1 items-center justify-between gap-2 px-3 py-2"
                    >
                      <span className="truncate text-zinc-200">{e.name}</span>
                      <span className="ml-2 shrink-0 text-xs text-zinc-500">
                        {e.type.toLowerCase()} · {e.sourceCount}
                      </span>
                    </Link>
                    <PinButton id={e.id} kind={e.type} initialPinned={pinnedSet.has(e.id)} />
                  </li>
                ))}
              </ul>
              {detail.entities.length > 12 ? (
                <p className="mt-2 text-xs text-zinc-500">+ {detail.entities.length - 12} more</p>
              ) : null}
            </section>
          ) : null}

          {detail.related.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Related sources
              </h2>
              <p className="mb-2 text-xs text-zinc-500">Sharing entities with this one.</p>
              <ul className="space-y-1.5">
                {detail.related.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-md border border-zinc-800 bg-zinc-900/40 transition hover:border-zinc-600"
                  >
                    <Link href={`/sources/${r.id}`} className="block p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">
                          {r.contentType}
                        </span>
                        <span className="truncate text-xs text-zinc-300">{r.url}</span>
                      </div>
                      <div className="mt-1 truncate text-[11px] text-zinc-500">
                        via {r.via.join(', ')}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
