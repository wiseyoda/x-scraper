/**
 * Sticky global header. Brand + search + nav. Lives in the root layout
 * so every page gets it. Pin count is server-rendered from the pins
 * file each render — cheap (single small JSON read).
 *
 * The homepage prints its own stats inline in the hero; this header is
 * intentionally count-free to stay readable on narrow viewports.
 */

import 'server-only';

import Link from 'next/link';

import { SearchBox } from '@/app/SearchBox';
import { SyncButton } from '@/components/SyncButton';
import { listPins } from '@/lib/pins';
import { allSourceState } from '@/lib/source-state';
import { latestSyncState } from '@/lib/sync-runner';
import { getVault } from '@/lib/vault';

const countUnread = async (): Promise<number> => {
  try {
    const vault = await getVault();
    const [list, state] = await Promise.all([
      vault.list('Source').catch(() => []),
      allSourceState(),
    ]);
    let n = 0;
    for (const e of list) if ((state[e.id]?.readAt ?? null) === null) n += 1;
    return n;
  } catch {
    return 0;
  }
};

export const SiteHeader = async (): Promise<React.JSX.Element> => {
  const [pins, unread, latestSync] = await Promise.all([
    listPins(),
    countUnread(),
    latestSyncState(),
  ]);
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/60">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-6 py-3">
        <Link
          href="/"
          className="flex shrink-0 items-baseline gap-2 text-zinc-100 hover:text-zinc-50"
        >
          <span className="text-base font-semibold tracking-tight">x-scraper</span>
        </Link>
        <div className="min-w-[220px] flex-1">
          <SearchBox />
        </div>
        <nav className="flex shrink-0 items-center gap-2 text-sm">
          <Link
            href="/inbox"
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-zinc-200 hover:border-zinc-600"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="h-3.5 w-3.5"
            >
              <path d="M22 12h-6l-2 3h-4l-2-3H2" />
              <path d="M5 5l-3 7v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3-7a2 2 0 00-2-1H7a2 2 0 00-2 1z" />
            </svg>
            <span>Inbox</span>
            {unread > 0 ? (
              <span className="rounded bg-emerald-500/20 px-1 font-mono text-[10px] tabular-nums text-emerald-300">
                {unread}
              </span>
            ) : null}
          </Link>
          <Link
            href="/pinned"
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-zinc-200 hover:border-zinc-600"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              className="h-3.5 w-3.5 text-amber-400"
            >
              <path d="M12 2.25l3.09 6.26 6.91 1-5 4.87 1.18 6.87L12 17.77l-6.18 3.49L7 14.38l-5-4.87 6.91-1L12 2.25z" />
            </svg>
            <span>Pinned</span>
            {pins.length > 0 ? (
              <span className="font-mono text-xs tabular-nums text-zinc-500">{pins.length}</span>
            ) : null}
          </Link>
          <Link
            href="/ideas?status=confirmed"
            className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-zinc-200 hover:border-zinc-600"
          >
            Ideas
          </Link>
          <Link
            href="/digest"
            className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-zinc-200 hover:border-zinc-600"
          >
            Digest
          </Link>
          <SyncButton initialState={latestSync} />
        </nav>
      </div>
    </header>
  );
};
