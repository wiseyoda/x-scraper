import Link from 'next/link';

import { PinButton } from '@/components/PinButton';
import { SyncButton } from '@/components/SyncButton';
import { topAuthors } from '@/lib/author-detail';
import { lastSyncInfo } from '@/lib/bookmark-ledger';
import { computeDashboard, type IdeaSummary, type EntitySummary } from '@/lib/dashboard';
import { readLastVisit } from '@/lib/lastVisit';
import { pinnedIdSet } from '@/lib/pins';
import { hydratePins } from '@/lib/pins-hydrated';

import { SearchBox } from './SearchBox';

export const dynamic = 'force-dynamic';

const formatRelative = (iso: string): string => {
  const ms = Date.now() - Date.parse(iso);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${String(days)}d ago`;
  return `${String(Math.floor(days / 30))}mo ago`;
};

const StarIcon = ({ className }: { className?: string }): React.JSX.Element => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M12 2.25l3.09 6.26 6.91 1-5 4.87 1.18 6.87L12 17.77l-6.18 3.49L7 14.38l-5-4.87 6.91-1L12 2.25z" />
  </svg>
);

const ExternalIcon = ({ className }: { className?: string }): React.JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M9 6h9v9" />
    <path d="M18 6L8 16" />
    <path d="M6 11v7a1 1 0 001 1h7" />
  </svg>
);

const IdeaCard = ({
  idea,
  pinned,
  showSnippet = true,
}: {
  idea: IdeaSummary;
  pinned: boolean;
  showSnippet?: boolean;
}): React.JSX.Element => (
  <div className="group relative flex h-full flex-col rounded-lg border border-zinc-800 bg-zinc-900/40 transition hover:border-zinc-600 hover:bg-zinc-900">
    <Link href={`/ideas/${idea.id}`} className="flex flex-1 flex-col p-4 pr-12">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="truncate text-base font-medium text-zinc-100 group-hover:text-zinc-50">
          {idea.subject}
        </h3>
        {idea.autoConfirmed ? (
          <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
            auto
          </span>
        ) : null}
      </div>
      {showSnippet && idea.snippet !== null ? (
        <p className="mt-2 line-clamp-3 flex-1 text-xs leading-relaxed text-zinc-400">
          {idea.snippet}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-zinc-500">
        <span>{idea.sourceCount} sources</span>
        <span className="text-zinc-700">·</span>
        <span>{idea.derivedFromCount} claims</span>
        <span className="text-zinc-700">·</span>
        <span>conf {idea.confidence.toFixed(2)}</span>
      </div>
    </Link>
    <div className="absolute right-2 top-2">
      <PinButton id={idea.id} kind="Idea" initialPinned={pinned} />
    </div>
  </div>
);

const EntityRow = ({
  entity,
  pinned,
  maxCount,
}: {
  entity: EntitySummary;
  pinned: boolean;
  maxCount: number;
}): React.JSX.Element => {
  const widthPct = Math.min(100, Math.round((entity.sourceCount / Math.max(1, maxCount)) * 100));
  return (
    <div className="group relative flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/40 pr-1 transition hover:border-zinc-600">
      <Link
        href={`/entities/${entity.id}`}
        className="relative flex flex-1 items-center justify-between gap-3 overflow-hidden px-3 py-2 text-sm"
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 rounded-l-md bg-sky-500/[0.07] transition group-hover:bg-sky-500/[0.12]"
          style={{ width: `${String(widthPct)}%` }}
        />
        <span className="relative z-10 truncate text-zinc-200 group-hover:text-zinc-100">
          {entity.name}
        </span>
        <span className="relative z-10 ml-3 flex shrink-0 items-baseline gap-1.5 text-[11px] text-zinc-500">
          <span className="text-zinc-600">{entity.type.toLowerCase()}</span>
          <span className="font-mono tabular-nums text-zinc-400">{entity.sourceCount}</span>
        </span>
      </Link>
      <PinButton id={entity.id} kind={entity.type} initialPinned={pinned} />
    </div>
  );
};

const SourceRow = ({
  source,
  pinned,
}: {
  source: {
    id: string;
    url: string;
    contentType: string;
    capturedAt: string;
    postedAt?: string | null;
    bookmarkedAt?: string | null;
    primary?: string;
  };
  pinned: boolean;
}): React.JSX.Element => {
  const timeLabel =
    source.bookmarkedAt !== null && source.bookmarkedAt !== undefined
      ? `saved ${formatRelative(source.bookmarkedAt)}`
      : `imported ${formatRelative(source.capturedAt)}`;
  const tooltip = [
    source.bookmarkedAt !== null && source.bookmarkedAt !== undefined
      ? `saved on x.com ${new Date(source.bookmarkedAt).toLocaleString()}`
      : null,
    source.postedAt !== null && source.postedAt !== undefined
      ? `posted ${new Date(source.postedAt).toLocaleString()}`
      : null,
    `imported ${new Date(source.capturedAt).toLocaleString()}`,
  ]
    .filter((x): x is string => x !== null)
    .join(' · ');
  const primaryText = source.primary ?? source.url;
  return (
    <li className="group relative flex items-center gap-1 rounded-md border border-zinc-800/70 bg-zinc-900/30 pr-1 text-sm transition hover:border-zinc-700">
      <Link
        href={`/sources/${source.id}`}
        className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2 hover:text-zinc-100"
      >
        <div className="flex items-center gap-3">
          <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
            {source.contentType}
          </span>
          <span className="truncate text-zinc-100 group-hover:text-zinc-50">{primaryText}</span>
          <span className="ml-auto shrink-0 text-xs text-zinc-500" title={tooltip}>
            {timeLabel}
            {source.postedAt !== null && source.postedAt !== undefined ? (
              <span className="ml-1 text-zinc-600">· posted {formatRelative(source.postedAt)}</span>
            ) : null}
          </span>
        </div>
        {primaryText !== source.url ? (
          <span className="truncate font-mono text-[10px] text-zinc-600">{source.url}</span>
        ) : null}
      </Link>
      <a
        href={source.url}
        target="_blank"
        rel="noreferrer"
        title="Open original"
        aria-label="Open original"
        className="shrink-0 rounded p-1.5 text-zinc-600 transition hover:bg-zinc-800 hover:text-zinc-300"
      >
        <ExternalIcon className="h-3.5 w-3.5" />
      </a>
      <PinButton id={source.id} kind="Source" initialPinned={pinned} />
    </li>
  );
};

export default async function Home(): Promise<React.JSX.Element> {
  const [sinceCookie, pinned, hydratedPins, authors, sync] = await Promise.all([
    readLastVisit(),
    pinnedIdSet(),
    hydratePins(),
    topAuthors(8),
    lastSyncInfo(),
  ]);
  const data = await computeDashboard(sinceCookie);
  const staleHours =
    sync.lastBookmarkedAt !== null
      ? (Date.now() - Date.parse(sync.lastBookmarkedAt)) / (1000 * 60 * 60)
      : null;
  const isStale = staleHours !== null && staleHours >= 24;
  const recentPins = hydratedPins
    .slice()
    .sort((a, b) => b.pinnedAt.localeCompare(a.pinnedAt))
    .slice(0, 4);
  const stalePins = hydratedPins.filter((p) => p.stale).slice(0, 3);

  const sinceLabel = data.whatsNew.defaulted
    ? `the past 7 days`
    : `your last visit ${formatRelative(data.whatsNew.since)}`;
  const newConfirmedTotal = data.whatsNew.newConfirmedIdeas.length;
  const autoConfirmedShare = data.whatsNew.newAutoConfirmedIdeas.length;
  const hasActivity =
    data.whatsNew.newSources.length > 0 ||
    data.whatsNew.newClaimsCount > 0 ||
    newConfirmedTotal > 0 ||
    data.whatsNew.newEntities.length > 0;

  const maxEntityCount = data.topEntities[0]?.sourceCount ?? 1;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Dashboard</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            <span className="font-mono tabular-nums text-zinc-300">{data.stats.sourceCount}</span>{' '}
            sources ·{' '}
            <span className="font-mono tabular-nums text-zinc-300">{data.stats.entityCount}</span>{' '}
            entities ·{' '}
            <span className="font-mono tabular-nums text-zinc-300">
              {data.stats.ideaConfirmedCount}
            </span>{' '}
            confirmed ideas
          </p>
        </div>
        {data.stats.needsReviewCount > 0 ? (
          <Link
            href="/ideas?status=draft"
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-500/15"
          >
            <span className="font-mono tabular-nums">{data.stats.needsReviewCount}</span>
            <span>need your review</span>
          </Link>
        ) : null}
      </header>

      {isStale ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/[0.04] px-4 py-3 text-sm">
          <p className="text-amber-300">
            Last sync was{' '}
            <span className="font-mono">
              {staleHours !== null && staleHours < 48
                ? `${Math.floor(staleHours)}h ago`
                : staleHours !== null
                  ? `${Math.floor(staleHours / 24)}d ago`
                  : 'never'}
            </span>{' '}
            — pull fresh bookmarks from x.com:
          </p>
          <SyncButton tone="cta" />
        </div>
      ) : null}

      {hydratedPins.length > 0 ? (
        <section className="mb-8 rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.04] to-zinc-900/30 p-5">
          <header className="mb-3 flex items-baseline justify-between">
            <h2 className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
              <StarIcon className="h-3 w-3" />
              Your pins
            </h2>
            <Link href="/pinned" className="text-xs text-zinc-400 hover:text-zinc-200">
              see all {hydratedPins.length} →
            </Link>
          </header>
          {stalePins.length > 0 ? (
            <div className="mb-3 rounded-md border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2">
              <p className="text-xs text-amber-300">
                {stalePins.length} pin{stalePins.length === 1 ? '' : 's'} you haven't opened in 14+
                days — still relevant?
              </p>
              <ul className="mt-1.5 space-y-0.5 text-sm">
                {stalePins.map((p) => (
                  <li key={p.id} className="truncate">
                    {p.href !== null ? (
                      <Link href={p.href} className="text-zinc-200 hover:text-zinc-50">
                        {p.label}
                      </Link>
                    ) : (
                      <span className="text-zinc-300">{p.label}</span>
                    )}
                    <span className="ml-2 text-xs text-zinc-500">{p.meta}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {recentPins.map((p) => (
              <div
                key={p.id}
                className="rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm transition hover:border-zinc-600"
              >
                {p.href !== null ? (
                  <Link href={p.href} className="block">
                    <div className="truncate font-medium text-zinc-100">{p.label}</div>
                    <div className="mt-0.5 truncate text-xs text-zinc-500">{p.meta}</div>
                  </Link>
                ) : (
                  <div>
                    <div className="truncate font-medium text-zinc-300">{p.label}</div>
                    <div className="mt-0.5 truncate text-xs text-zinc-500">{p.meta}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {hasActivity ? (
        <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/30 p-5">
          <header className="mb-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Since you last visited
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">activity since {sinceLabel}</p>
          </header>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
              <div className="font-mono text-xl tabular-nums text-zinc-100">
                {data.whatsNew.newSources.length}
              </div>
              <div className="mt-0.5 text-[11px] uppercase tracking-wide text-zinc-500">
                new sources
              </div>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
              <div className="font-mono text-xl tabular-nums text-zinc-100">
                {data.whatsNew.newClaimsCount}
              </div>
              <div className="mt-0.5 text-[11px] uppercase tracking-wide text-zinc-500">
                new claims
              </div>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
              <div className="font-mono text-xl tabular-nums text-emerald-400">
                {newConfirmedTotal}
              </div>
              <div className="mt-0.5 text-[11px] uppercase tracking-wide text-zinc-500">
                confirmed
                {autoConfirmedShare > 0 ? (
                  <span className="ml-1 text-emerald-500/80">({autoConfirmedShare} auto)</span>
                ) : null}
              </div>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
              <div className="font-mono text-xl tabular-nums text-zinc-100">
                {data.whatsNew.newEntities.length}
              </div>
              <div className="mt-0.5 text-[11px] uppercase tracking-wide text-zinc-500">
                new entities
              </div>
            </div>
          </div>
          {data.whatsNew.newConfirmedIdeas.length > 0 ? (
            <div className="mt-5">
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                New confirmed ideas
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.whatsNew.newConfirmedIdeas.map((idea) => (
                  <IdeaCard key={idea.id} idea={idea} pinned={pinned.has(idea.id)} />
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <div className="mb-8 flex items-center justify-between rounded-md border border-zinc-800/80 bg-zinc-900/20 px-4 py-2.5 text-xs text-zinc-500">
          <span>
            All caught up — nothing new since {sinceLabel}.{' '}
            <span className="text-zinc-600">
              Set up{' '}
              <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-400">
                xs schedule install
              </code>{' '}
              for hourly auto-sync.
            </span>
          </span>
        </div>
      )}

      <section className="mb-8">
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-zinc-100">Top confirmed ideas</h2>
          <Link
            href="/ideas?status=confirmed"
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            all {data.stats.ideaConfirmedCount} →
          </Link>
        </header>
        {data.topConfirmed.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-6 text-center text-sm text-zinc-500">
            No confirmed ideas yet. The synthesizer auto-confirms patterns spanning{' '}
            <span className="text-zinc-300">10+ sources</span> at{' '}
            <span className="text-zinc-300">≥0.70 confidence</span>; lower-evidence ideas wait for
            your review.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {data.topConfirmed.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} pinned={pinned.has(idea.id)} />
            ))}
          </div>
        )}
      </section>

      {authors.length > 0 ? (
        <section className="mb-8">
          <header className="mb-3 flex items-baseline justify-between">
            <h2 className="text-base font-semibold text-zinc-100">Top authors</h2>
            <span className="text-xs text-zinc-500">who you bookmark from most</span>
          </header>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {authors.map((a) => (
              <Link
                key={a.handle}
                href={`/authors/${a.handle}`}
                className="group flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 transition hover:border-zinc-600"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500/30 to-zinc-800 text-sm font-semibold text-zinc-100">
                  {a.display[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-zinc-100 group-hover:text-zinc-50">
                    @{a.display}
                  </div>
                  <div className="truncate text-[11px] text-zinc-500">
                    {a.bookmarkCount} bookmark{a.bookmarkCount === 1 ? '' : 's'}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <header className="mb-3 flex items-baseline justify-between">
            <h2 className="text-base font-semibold text-zinc-100">Top entities</h2>
            <span className="text-xs text-zinc-500">by source count</span>
          </header>
          <div className="space-y-1.5">
            {data.topEntities.map((e) => (
              <EntityRow
                key={e.id}
                entity={e}
                pinned={pinned.has(e.id)}
                maxCount={maxEntityCount}
              />
            ))}
          </div>
        </div>

        <div>
          <header className="mb-3 flex items-baseline justify-between">
            <h2 className="text-base font-semibold text-zinc-100">Needs your review</h2>
            <Link href="/ideas?status=draft" className="text-xs text-zinc-500 hover:text-zinc-300">
              {data.stats.needsReviewCount} drafts →
            </Link>
          </header>
          {data.needsReview.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-6 text-center text-sm text-zinc-500">
              Nothing in the manual queue. Auto-confirm caught everything that crossed the bar.
            </p>
          ) : (
            <div className="space-y-2.5">
              {data.needsReview.map((idea) => (
                <IdeaCard
                  key={idea.id}
                  idea={idea}
                  pinned={pinned.has(idea.id)}
                  showSnippet={false}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="mb-12">
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-zinc-100">Recent bookmarks</h2>
          <span className="text-xs text-zinc-500">latest captures</span>
        </header>
        {data.recentSources.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-6 text-center text-sm text-zinc-500">
            No bookmarks yet. Run{' '}
            <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
              xs bookmarks pull
            </code>{' '}
            and{' '}
            <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
              xs bookmarks sync
            </code>{' '}
            to pull from x.com.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {data.recentSources.map((s) => (
              <SourceRow key={s.id} source={s} pinned={pinned.has(s.id)} />
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-12 border-t border-zinc-900 pt-6 text-xs text-zinc-600">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>
            {data.stats.sourceCount} sources · {data.stats.entityCount} entities ·{' '}
            {data.stats.claimCount} claims · {data.stats.ideaCount} ideas
          </span>
          <span className="font-mono text-[10px] tracking-wide">x-scraper · local-first KB</span>
        </div>
      </footer>
    </main>
  );
}
