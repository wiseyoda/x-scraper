import Link from 'next/link';

import { computeDigest } from '@/lib/digest';

export const dynamic = 'force-dynamic';

const formatDate = (iso: string): string => new Date(iso).toLocaleDateString();

export default async function DigestPage({
  searchParams,
}: {
  searchParams?: Promise<{ window?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const requested = sp.window === undefined ? 7 : Number.parseInt(sp.window, 10);
  const windowDays = Number.isFinite(requested) && requested > 0 ? requested : 7;

  const data = await computeDigest(windowDays);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Digest</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Theme-forward briefing · last {windowDays} days · {formatDate(data.windowStart)} →{' '}
            {formatDate(data.windowEnd)}
          </p>
        </div>
        <nav className="flex gap-1 rounded-md border border-zinc-800 bg-zinc-900 p-1 text-xs">
          {[1, 7, 30, 90].map((d) => (
            <Link
              key={d}
              href={`/digest?window=${String(d)}`}
              className={
                d === windowDays
                  ? 'rounded px-2.5 py-1 bg-zinc-700 text-zinc-100'
                  : 'rounded px-2.5 py-1 text-zinc-400 hover:text-zinc-200'
              }
            >
              {d}d
            </Link>
          ))}
        </nav>
      </header>

      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="font-mono text-2xl tabular-nums text-sky-300">{data.themes.length}</div>
          <div className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500">themes</div>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="font-mono text-2xl tabular-nums text-zinc-100">{data.totalCaptures}</div>
          <div className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500">captures</div>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="font-mono text-2xl tabular-nums text-emerald-400">
            {data.newConfirmedIdeas.length}
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500">
            new confirmed ideas
          </div>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="font-mono text-2xl tabular-nums text-zinc-100">
            {data.claimCountInWindow}
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500">
            claims in window
          </div>
        </div>
      </section>

      <section className="mb-10">
        <header className="mb-3">
          <h2 className="text-base font-semibold text-zinc-100">Themes</h2>
          <p className="text-xs text-zinc-500">
            Idea subjects that touch this window — same assembleThemes path as package digests
          </p>
        </header>
        {data.themes.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-4 text-center text-xs text-zinc-500">
            No idea themes touched this window. Capture more sources or wait for synthesis.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {data.themes.map((t) => (
              <li
                key={t.ideaId}
                className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 transition hover:border-zinc-600"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/ideas/${t.ideaId}`}
                    className="text-sm font-medium text-zinc-100 hover:text-sky-300"
                  >
                    {t.subject}
                  </Link>
                  <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                    {t.status}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[11px] text-zinc-500">{t.ideaId}</div>
                {t.linkedSourceIds.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="text-[11px] text-zinc-500">Linked this window:</span>
                    {t.linkedSourceIds.slice(0, 8).map((sid) => (
                      <Link
                        key={sid}
                        href={`/sources/${sid}`}
                        className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-sky-400/90 hover:text-sky-300"
                      >
                        {sid}
                      </Link>
                    ))}
                    {t.linkedSourceIds.length > 8 ? (
                      <span className="text-[10px] text-zinc-500">
                        +{t.linkedSourceIds.length - 8} more
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-zinc-500">
                    Updated this window · {t.sourceIds.length} source
                    {t.sourceIds.length === 1 ? '' : 's'} total
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {Object.keys(data.byContentType).length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            By content type
          </h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.byContentType).map(([k, v]) => (
              <Link
                key={k}
                href={`/inbox?type=${k}`}
                className="rounded bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-300 ring-1 ring-inset ring-zinc-800 hover:ring-zinc-700"
              >
                <span className="uppercase">{k}</span>{' '}
                <span className="ml-1 font-mono tabular-nums text-zinc-400">{v}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <header className="mb-3">
            <h2 className="text-base font-semibold text-zinc-100">Top authors</h2>
            <p className="text-xs text-zinc-500">who you bookmarked from in this window</p>
          </header>
          {data.topAuthors.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-4 text-center text-xs text-zinc-500">
              No bookmarks with detectable authors in this window.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.topAuthors.map((a) => (
                <li
                  key={a.handle}
                  className="rounded-md border border-zinc-800 bg-zinc-900/40 transition hover:border-zinc-600"
                >
                  <Link href={`/authors/${a.handle}`} className="flex items-center gap-3 p-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500/30 to-zinc-800 text-sm font-semibold text-zinc-100">
                      {a.display[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-zinc-100">@{a.display}</div>
                      <div className="text-[11px] text-zinc-500">
                        {a.newBookmarks} new bookmark{a.newBookmarks === 1 ? '' : 's'}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <header className="mb-3">
            <h2 className="text-base font-semibold text-zinc-100">Top entities</h2>
            <p className="text-xs text-zinc-500">most-mentioned in this window</p>
          </header>
          {data.topEntities.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-4 text-center text-xs text-zinc-500">
              No entity activity in this window.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {data.topEntities.map((e) => (
                <li
                  key={e.id}
                  className="rounded-md border border-zinc-800 bg-zinc-900/40 transition hover:border-zinc-600"
                >
                  <Link
                    href={`/entities/${e.id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span className="truncate text-zinc-200">{e.name}</span>
                    <span className="ml-2 shrink-0 text-[11px] text-zinc-500">
                      {e.type.toLowerCase()} ·{' '}
                      <span className="font-mono tabular-nums text-zinc-400">{e.newMentions}</span>{' '}
                      this window
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {data.newConfirmedIdeas.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-3 text-base font-semibold text-zinc-100">Confirmed in this window</h2>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
            {data.newConfirmedIdeas.map((i) => (
              <Link
                key={i.id}
                href={`/ideas/${i.id}`}
                className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 transition hover:border-zinc-600"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="truncate text-sm font-medium text-zinc-100">{i.subject}</h3>
                  {i.autoConfirmed ? (
                    <span className="shrink-0 rounded bg-emerald-500/10 px-1 py-0.5 text-[9px] font-medium text-emerald-400">
                      auto
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-[11px] text-zinc-500">
                  {i.sourceCount} sources · conf {i.confidence.toFixed(2)}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {data.newDraftIdeas.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-3 text-base font-semibold text-zinc-100">
            Drafts you might want to review
          </h2>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
            {data.newDraftIdeas.map((i) => (
              <Link
                key={i.id}
                href={`/ideas/${i.id}`}
                className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 transition hover:border-zinc-600"
              >
                <div className="truncate text-sm font-medium text-zinc-100">{i.subject}</div>
                <div className="mt-1 text-[11px] text-zinc-500">
                  {i.sourceCount} sources · conf {i.confidence.toFixed(2)}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {data.recentSources.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-3 text-base font-semibold text-zinc-100">Recent captures</h2>
          <ul className="space-y-1.5">
            {data.recentSources.map((s) => (
              <li
                key={s.id}
                className="rounded-md border border-zinc-800 bg-zinc-900/40 transition hover:border-zinc-600"
              >
                <Link href={`/sources/${s.id}`} className="flex items-center gap-3 p-3 text-sm">
                  <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                    {s.contentType}
                  </span>
                  <span className="truncate text-zinc-300">{s.url}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-zinc-500">
                    {s.readMins} min · {s.read ? 'read' : 'unread'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mb-12">
        <header className="mb-3">
          <h2 className="text-base font-semibold text-zinc-100">Offline theme body</h2>
          <p className="text-xs text-zinc-500">
            Deterministic package output (formatThemeForwardBody) — same as CLI offline digest
          </p>
        </header>
        <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/80 p-4 text-[11px] leading-relaxed text-zinc-400 whitespace-pre-wrap">
          {data.themeBody}
        </pre>
      </section>
    </main>
  );
}
