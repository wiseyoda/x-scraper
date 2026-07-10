import type { SourceFrontmatter } from '@x-scraper/core';
import Link from 'next/link';

import { InboxBulkLayer } from '@/components/InboxBulkLayer';
import { PinButton } from '@/components/PinButton';
import { ReadButton } from '@/components/ReadButton';
import { SyncButton } from '@/components/SyncButton';
import { lastSyncInfo } from '@/lib/bookmark-ledger';
import {
  groupByBin,
  loadInbox,
  TIME_BIN_LABEL,
  type InboxFilter,
  type InboxRow,
} from '@/lib/inbox';
import { PIPELINE_STAGE_LABEL } from '@/lib/pipeline-status';
import { allTags } from '@/lib/source-state';

export const dynamic = 'force-dynamic';

const formatRelative = (iso: string): string => {
  const ms = Date.now() - Date.parse(iso);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${String(days)}d`;
  return `${String(Math.floor(days / 30))}mo`;
};

const CONTENT_TYPES: SourceFrontmatter['content_type'][] = [
  'tweet',
  'article',
  'repo',
  'video',
  'pdf',
];

const buildHref = (
  current: Record<string, string | undefined>,
  patch: Record<string, string | undefined>,
): string => {
  const merged = { ...current, ...patch };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== '') params.set(k, v);
  }
  const qs = params.toString();
  return qs.length > 0 ? `/inbox?${qs}` : '/inbox';
};

const FilterChip = ({
  href,
  active,
  label,
  count,
  tone = 'default',
}: {
  href: string;
  active: boolean;
  label: string;
  count?: number;
  tone?: 'default' | 'amber' | 'emerald';
}): React.JSX.Element => {
  const toneClasses =
    tone === 'amber'
      ? active
        ? 'bg-amber-500/15 text-amber-300 ring-amber-500/40'
        : 'bg-zinc-900 text-zinc-300 ring-zinc-800 hover:text-amber-300'
      : tone === 'emerald'
        ? active
          ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40'
          : 'bg-zinc-900 text-zinc-300 ring-zinc-800 hover:text-emerald-300'
        : active
          ? 'bg-zinc-800 text-zinc-100 ring-zinc-700'
          : 'bg-zinc-900 text-zinc-400 ring-zinc-800 hover:text-zinc-200';
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${toneClasses}`}
    >
      <span>{label}</span>
      {count !== undefined ? (
        <span className="font-mono tabular-nums text-[10px] opacity-70">{count}</span>
      ) : null}
    </Link>
  );
};

const InboxRowCard = ({ row }: { row: InboxRow }): React.JSX.Element => (
  <li
    data-bulk-row={row.id}
    className={`group relative rounded-md border bg-zinc-900/40 transition hover:border-zinc-600 hover:bg-zinc-900 ${row.read ? 'border-zinc-800/50 opacity-80' : 'border-zinc-800'}`}
  >
    <Link href={`/sources/${row.id}`} className="block px-4 py-3 pr-24">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
          {row.contentType}
        </span>
        <span
          className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-500"
          title="pipeline stage"
        >
          {PIPELINE_STAGE_LABEL[row.pipelineStage]}
        </span>
        {row.author !== null ? (
          <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[11px] text-sky-300 ring-1 ring-inset ring-sky-500/30">
            @{row.author.display}
          </span>
        ) : null}
        {row.tags.map((t) => (
          <span
            key={t}
            className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-300 ring-1 ring-inset ring-violet-500/30"
          >
            #{t}
          </span>
        ))}
        {!row.read ? (
          <span
            className="ml-auto inline-block h-2 w-2 rounded-full bg-emerald-500"
            title="unread"
            aria-label="unread"
          />
        ) : null}
        <span
          className={`text-zinc-500 ${row.read ? 'ml-auto' : ''}`}
          title={[
            row.bookmarkedAt !== null
              ? `saved on x.com ${new Date(row.bookmarkedAt).toLocaleString()}`
              : null,
            row.postedAt !== null ? `posted ${new Date(row.postedAt).toLocaleString()}` : null,
            `imported ${new Date(row.capturedAt).toLocaleString()}`,
          ]
            .filter((x): x is string => x !== null)
            .join(' · ')}
        >
          {row.bookmarkedAt !== null
            ? `saved ${formatRelative(row.bookmarkedAt)}`
            : `imported ${formatRelative(row.capturedAt)}`}
          {row.postedAt !== null ? (
            <span className="ml-1 text-zinc-600">· posted {formatRelative(row.postedAt)}</span>
          ) : null}
        </span>
      </div>
      <p
        className={`mt-2 line-clamp-3 text-sm leading-relaxed ${row.read ? 'text-zinc-300' : 'text-zinc-100'}`}
      >
        {row.primary}
      </p>
      {row.snippet !== null && row.snippet !== row.primary ? (
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500">{row.snippet}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        <span className="truncate font-mono text-[10px] text-zinc-600" title={row.secondary}>
          {row.secondary}
        </span>
        {row.claimCount > 0 ? <span>· {row.claimCount} claims</span> : null}
        {row.entityCount > 0 ? <span>· {row.entityCount} entities</span> : null}
      </div>
    </Link>
    <div className="absolute right-1.5 top-1.5 flex gap-0.5">
      <ReadButton id={row.id} initialReadAt={row.readAt} />
      <PinButton id={row.id} kind="Source" initialPinned={row.pinned} />
      <a
        href={row.url}
        target="_blank"
        rel="noreferrer"
        title="Open original"
        aria-label="Open original"
        className="shrink-0 rounded p-1 text-zinc-600 transition hover:bg-zinc-800 hover:text-zinc-300"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <path d="M9 6h9v9" />
          <path d="M18 6L8 16" />
          <path d="M6 11v7a1 1 0 001 1h7" />
        </svg>
      </a>
    </div>
  </li>
);

export default async function InboxPage({
  searchParams,
}: {
  searchParams?: Promise<{
    type?: string;
    author?: string;
    read?: string;
    pinned?: string;
    tag?: string;
    q?: string;
    derived?: string;
    page?: string;
  }>;
}) {
  const sp = (await searchParams) ?? {};
  const filter: InboxFilter = {};
  if (sp.type !== undefined && (CONTENT_TYPES as readonly string[]).includes(sp.type)) {
    filter.contentType = sp.type as SourceFrontmatter['content_type'];
  }
  if (sp.author !== undefined) filter.author = sp.author;
  if (sp.read === 'read' || sp.read === 'unread') filter.read = sp.read;
  if (sp.pinned === '1') filter.pinned = true;
  if (sp.tag !== undefined) filter.tag = sp.tag;
  if (sp.q !== undefined) filter.q = sp.q;
  if (sp.derived === '1') filter.includeDerived = true;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  filter.page = page;
  filter.pageSize = 50;

  const [{ rows, totals, matchedCount, pageSize }, tagList, sync] = await Promise.all([
    loadInbox(filter),
    allTags(),
    lastSyncInfo(),
  ]);
  const grouped = groupByBin(rows);
  const totalPages = Math.max(1, Math.ceil(matchedCount / pageSize));

  const current: Record<string, string | undefined> = {
    type: sp.type,
    author: sp.author,
    read: sp.read,
    pinned: sp.pinned,
    tag: sp.tag,
    q: sp.q,
    derived: sp.derived,
    page: undefined, // never carry page across filter changes
  };

  // Stale-data warning — show a banner when the latest sync is >24h old.
  const staleHours =
    sync.lastBookmarkedAt !== null
      ? (Date.now() - Date.parse(sync.lastBookmarkedAt)) / (1000 * 60 * 60)
      : null;
  const isStale = staleHours !== null && staleHours >= 24;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Inbox</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Your bookmarks, newest-saved first. Showing{' '}
            <span className="text-zinc-300">{rows.length}</span> of{' '}
            <span className="text-zinc-300">{matchedCount}</span> matched
            {!filter.includeDerived ? (
              <>
                {' '}
                (<span className="text-zinc-400">{totals.organic}</span> organic ·{' '}
                <span className="text-zinc-600">{totals.derived}</span> derived hidden)
              </>
            ) : null}
            .
          </p>
        </div>
        {filter.author !== undefined ? (
          <Link
            href={`/authors/${filter.author}`}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            view @{filter.author} profile →
          </Link>
        ) : null}
      </header>

      {isStale ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/[0.04] px-4 py-3 text-sm">
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

      <div className="mb-4 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <FilterChip
            href={buildHref(current, { type: undefined })}
            active={filter.contentType === undefined}
            label="All"
            count={totals.all}
          />
          {CONTENT_TYPES.map((t) => {
            const c = totals.byContentType[t] ?? 0;
            if (c === 0) return null;
            return (
              <FilterChip
                key={t}
                href={buildHref(current, { type: t })}
                active={filter.contentType === t}
                label={t}
                count={c}
              />
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip
            href={buildHref(current, { read: undefined })}
            active={filter.read === undefined}
            label="any state"
          />
          <FilterChip
            href={buildHref(current, { read: 'unread' })}
            active={filter.read === 'unread'}
            label="unread"
            count={totals.unread}
            tone="emerald"
          />
          <FilterChip
            href={buildHref(current, { read: 'read' })}
            active={filter.read === 'read'}
            label="read"
            count={totals.all - totals.unread}
          />
          <FilterChip
            href={buildHref(current, { pinned: filter.pinned ? undefined : '1' })}
            active={filter.pinned === true}
            label="pinned"
            count={totals.pinned}
            tone="amber"
          />
          <FilterChip
            href={buildHref(current, { derived: filter.includeDerived ? undefined : '1' })}
            active={filter.includeDerived === true}
            label={filter.includeDerived ? 'incl derived' : 'organic only'}
            count={filter.includeDerived ? totals.all : totals.organic}
          />
        </div>
        {tagList.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[11px] uppercase tracking-wider text-zinc-600 self-center mr-1">
              tags:
            </span>
            {tagList.map((t) => (
              <FilterChip
                key={t}
                href={buildHref(current, { tag: filter.tag === t ? undefined : t })}
                active={filter.tag === t}
                label={`#${t}`}
              />
            ))}
          </div>
        ) : null}
      </div>

      {grouped.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-800 bg-zinc-900/30 p-8 text-center text-sm text-zinc-500">
          No bookmarks match this filter.{' '}
          <Link href="/inbox" className="text-zinc-300 hover:text-zinc-100">
            Clear filters →
          </Link>
        </p>
      ) : (
        <>
          <div className="space-y-8 pb-20">
            {grouped.map(({ bin, rows: binRows }) => (
              <section key={bin}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  {TIME_BIN_LABEL[bin]} · <span className="text-zinc-600">{binRows.length}</span>
                </h2>
                <ul className="space-y-2">
                  {binRows.map((r) => (
                    <InboxRowCard key={r.id} row={r} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {totalPages > 1 ? (
            <nav className="mb-20 flex items-center justify-between gap-2 border-t border-zinc-800 pt-4 text-sm">
              {page > 1 ? (
                <Link
                  href={buildHref(current, { page: String(page - 1) })}
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-zinc-300 hover:border-zinc-600"
                >
                  ← previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-xs text-zinc-500">
                page <span className="font-mono text-zinc-300">{page}</span> of{' '}
                <span className="font-mono text-zinc-300">{totalPages}</span>
              </span>
              {page < totalPages ? (
                <Link
                  href={buildHref(current, { page: String(page + 1) })}
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-zinc-300 hover:border-zinc-600"
                >
                  next →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
          <InboxBulkLayer visibleIds={rows.map((r) => r.id)} />
        </>
      )}
    </main>
  );
}
