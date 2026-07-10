import Link from 'next/link';
import { notFound } from 'next/navigation';

import { loadAuthorDetail } from '@/lib/author-detail';

export const dynamic = 'force-dynamic';

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

const SOURCE_LABEL: Record<string, string> = {
  'x.com': 'on x.com',
  'github.com': 'on GitHub',
  capture: 'from capture',
  unknown: '',
};

export default async function AuthorPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const detail = await loadAuthorDetail(handle);
  if (detail === null) notFound();

  const externalProfileUrl =
    detail.source === 'x.com'
      ? `https://x.com/${detail.display}`
      : detail.source === 'github.com'
        ? `https://github.com/${detail.display}`
        : null;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
        ← back to dashboard
      </Link>

      <header className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-sky-500/40 to-zinc-800 text-xl font-semibold text-zinc-100">
            {detail.display[0]?.toUpperCase()}
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">
              @{detail.display}
            </h1>
            <p className="mt-0.5 text-sm text-zinc-500">
              {detail.bookmarks.length} bookmark{detail.bookmarks.length === 1 ? '' : 's'}{' '}
              {SOURCE_LABEL[detail.source] ?? ''}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
              {Object.entries(detail.byContentType).map(([t, n]) => (
                <span key={t} className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-zinc-400">
                  {String(n)} {t}
                </span>
              ))}
            </div>
          </div>
        </div>
        {externalProfileUrl !== null ? (
          <a
            href={externalProfileUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
          >
            View profile ↗
          </a>
        ) : null}
      </header>

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Bookmarks from @{detail.display}
        </h2>
        <ul className="space-y-2">
          {detail.bookmarks.map((b) => (
            <li
              key={b.id}
              className="rounded-lg border border-zinc-800 bg-zinc-900/40 transition hover:border-zinc-600 hover:bg-zinc-900"
            >
              <Link href={`/sources/${b.id}`} className="block p-4">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                    {b.contentType}
                  </span>
                  <span className="ml-auto text-xs text-zinc-500">
                    {formatRelative(b.capturedAt)}
                  </span>
                </div>
                {b.snippet !== null ? (
                  <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-zinc-200">
                    {b.snippet}
                  </p>
                ) : (
                  <p className="mt-2 truncate text-sm text-zinc-400">{b.url}</p>
                )}
                <div className="mt-2 truncate text-[10px] font-mono text-zinc-600">{b.url}</div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
