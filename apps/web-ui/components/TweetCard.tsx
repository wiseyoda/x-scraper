/**
 * Tweet-styled card. Renders captured tweet text inline so the user
 * doesn't have to bounce out to x.com to read what they bookmarked.
 *
 * Server component — pure render, no client state.
 */

import 'server-only';

import Link from 'next/link';

interface TweetCardProps {
  authorHandle: string | null;
  body: string;
  tweetUrl: string;
  /** When we captured the tweet (proxy for "saved at" — x.com doesn't expose post date easily). */
  fetchedAt: string;
}

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

export const TweetCard = ({
  authorHandle,
  body,
  tweetUrl,
  fetchedAt,
}: TweetCardProps): React.JSX.Element => {
  const handleHref = authorHandle !== null ? `/authors/${authorHandle}` : null;
  return (
    <article className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <header className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500/30 to-zinc-800 text-sm font-semibold text-zinc-100">
          {authorHandle !== null ? authorHandle[0]?.toUpperCase() : '?'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {handleHref !== null && authorHandle !== null ? (
              <Link
                href={handleHref}
                className="truncate text-base font-semibold text-zinc-100 hover:text-zinc-50 hover:underline"
              >
                @{authorHandle}
              </Link>
            ) : (
              <span className="truncate text-base font-semibold text-zinc-300">unknown</span>
            )}
            <span className="text-xs text-zinc-500" title={new Date(fetchedAt).toLocaleString()}>
              · captured {formatRelative(fetchedAt)} ago
            </span>
          </div>
        </div>
        <a
          href={tweetUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
        >
          Open on x.com ↗
        </a>
      </header>
      <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-zinc-100">
        {body}
      </div>
    </article>
  );
};
