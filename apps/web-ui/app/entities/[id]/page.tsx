import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Markdown } from '@/components/Markdown';
import { PinButton } from '@/components/PinButton';
import { loadEntityDetail } from '@/lib/entity-detail';
import { isPinned, markVisited, pinnedIdSet } from '@/lib/pins';

export const dynamic = 'force-dynamic';

/**
 * Entity bodies are mostly auto-generated chrome (Aliases line, "## URLs"
 * section, "## Mentioned in" wikilinks). Strip those — the page header
 * already shows aliases, and the sidebar shows sources/co-mentions. Any
 * content the user hand-edited survives.
 */
const stripEntityChrome = (body: string): string => {
  let out = body;
  // Drop leading "Aliases:" paragraph.
  out = out.replace(/^Aliases:[^\n]*\n+/m, '');
  // Drop "## URLs" section through next "##" or end-of-string.
  out = out.replace(/\n*## URLs\n[\s\S]*?(?=\n## |$)/, '');
  // Drop "## Mentioned in" section through next "##" or end-of-string.
  out = out.replace(/\n*## Mentioned in\n[\s\S]*?(?=\n## |$)/, '');
  // Drop leading "# Title" h1 (already in header).
  out = out.replace(/^# .*\n+/, '');
  return out.trim();
};

/**
 * Pull http(s) URLs out of an entity's aliases. Tools and Repos
 * frequently have docs/repo URLs as aliases; surfacing them as one-click
 * external links is more useful than burying them in the "aka" line.
 */
const externalLinksFromAliases = (aliases: readonly string[]): string[] =>
  aliases.filter((a) => /^https?:\/\//.test(a));

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

export default async function EntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await loadEntityDetail(id);
  if (detail === null) notFound();

  const fm = detail.frontmatter;
  const [pinned, pinnedSet] = await Promise.all([isPinned(id), pinnedIdSet()]);
  await markVisited(id);

  const cleanBody = stripEntityChrome(detail.body);
  const externalLinks = externalLinksFromAliases(fm.aliases);
  const nonUrlAliases = fm.aliases.filter((a) => !/^https?:\/\//.test(a));

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
        ← back to dashboard
      </Link>

      <header className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-medium uppercase text-zinc-300">
              {fm.type}
            </span>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-100">{fm.name}</h1>
            {fm.description !== undefined && fm.description.length > 0 ? (
              <p className="mt-2 max-w-2xl text-sm text-zinc-400">{fm.description}</p>
            ) : null}
          </div>
          <PinButton id={fm.id} kind={fm.type} initialPinned={pinned} variant="full" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span className="font-mono">{fm.id}</span>
          <span>
            {detail.sources.length} source{detail.sources.length === 1 ? '' : 's'}
          </span>
          <span>
            {detail.ideas.length} synthesized idea{detail.ideas.length === 1 ? '' : 's'}
          </span>
          <span>
            {detail.claims.length} claim{detail.claims.length === 1 ? '' : 's'}
          </span>
          {nonUrlAliases.length > 0 ? (
            <span className="rounded bg-zinc-800/60 px-1.5 py-0.5 text-zinc-400">
              aka {nonUrlAliases.slice(0, 3).join(', ')}
              {nonUrlAliases.length > 3 ? ` +${String(nonUrlAliases.length - 3)}` : ''}
            </span>
          ) : null}
        </div>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-10">
          {cleanBody.length > 0 ? (
            <article>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Notes
              </h2>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
                <Markdown body={cleanBody} />
              </div>
            </article>
          ) : null}

          {detail.ideas.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Ideas about {fm.name} ({detail.ideas.length})
              </h2>
              <div className="space-y-3">
                {detail.ideas.map((i) => (
                  <div
                    key={i.id}
                    className="group relative rounded-lg border border-zinc-800 bg-zinc-900/40 transition hover:border-zinc-600"
                  >
                    <Link href={`/ideas/${i.id}`} className="block p-4 pr-12">
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 className="truncate text-base font-medium text-zinc-100">
                          {i.subject}
                        </h3>
                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              i.status === 'confirmed'
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : i.status === 'rejected'
                                  ? 'bg-zinc-500/15 text-zinc-400'
                                  : 'bg-amber-500/15 text-amber-300'
                            }`}
                          >
                            {i.status}
                          </span>
                          {i.autoConfirmed ? (
                            <span className="rounded bg-emerald-500/10 px-1 py-0.5 text-[9px] font-medium text-emerald-400">
                              auto
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-1 flex gap-3 text-xs text-zinc-500">
                        <span>{i.sourceCount} sources</span>
                        <span>conf {i.confidence.toFixed(2)}</span>
                      </div>
                    </Link>
                    <div className="absolute right-2 top-2">
                      <PinButton id={i.id} kind="Idea" initialPinned={pinnedSet.has(i.id)} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {detail.claims.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Claims mentioning {fm.name} ({detail.claims.length})
              </h2>
              <ul className="space-y-2">
                {detail.claims.slice(0, 50).map((c) => (
                  <li
                    key={c.id}
                    className="rounded-md border border-zinc-800 bg-zinc-900/30 p-3 text-sm"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-zinc-200">{c.subject}</span>
                      <span className="font-mono text-xs text-zinc-500">{c.predicate}</span>
                      <span className="text-zinc-300">{c.object}</span>
                    </div>
                    {c.body.length > 0 ? (
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{c.body}</p>
                    ) : null}
                    <div className="mt-1 flex gap-3 text-[10px] text-zinc-600">
                      <Link
                        href={`/sources/${c.sourceId}`}
                        className="font-mono hover:text-zinc-400"
                      >
                        from {c.sourceId}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
              {detail.claims.length > 50 ? (
                <p className="mt-3 text-xs text-zinc-500">
                  + {detail.claims.length - 50} more claims
                </p>
              ) : null}
            </section>
          ) : null}
        </div>

        <aside className="space-y-8">
          {externalLinks.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Links
              </h2>
              <ul className="space-y-1.5">
                {externalLinks.map((url) => (
                  <li
                    key={url}
                    className="rounded-md border border-zinc-800 bg-zinc-900/40 transition hover:border-zinc-600"
                  >
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 break-all p-2.5 text-xs text-sky-400 hover:text-sky-300"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3 w-3 shrink-0"
                        aria-hidden="true"
                      >
                        <path d="M9 6h9v9" />
                        <path d="M18 6L8 16" />
                      </svg>
                      <span className="truncate">{url}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {detail.coMentions.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Often appears with
              </h2>
              <p className="mb-3 text-xs text-zinc-500">
                Other entities sharing sources with this one.
              </p>
              <ul className="space-y-1.5">
                {detail.coMentions.slice(0, 15).map((c) => (
                  <li
                    key={c.id}
                    className="group relative flex items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 pr-1 text-sm transition hover:border-zinc-600"
                  >
                    <Link
                      href={`/entities/${c.id}`}
                      className="flex flex-1 items-center justify-between gap-2 px-3 py-2"
                    >
                      <span className="truncate text-zinc-200">{c.name}</span>
                      <span className="ml-2 shrink-0 text-xs text-zinc-500">
                        {c.type.toLowerCase()} · {c.sharedSourceCount} shared
                      </span>
                    </Link>
                    <PinButton id={c.id} kind={c.type} initialPinned={pinnedSet.has(c.id)} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {detail.sources.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Sources mentioning ({detail.sources.length})
              </h2>
              <ul className="space-y-1.5">
                {detail.sources.slice(0, 20).map((s) => (
                  <li
                    key={s.id}
                    className="rounded-md border border-zinc-800 bg-zinc-900/40 transition hover:border-zinc-600"
                  >
                    <Link href={`/sources/${s.id}`} className="block p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">
                          {s.contentType}
                        </span>
                        <span className="truncate text-xs text-zinc-300">{s.url}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-zinc-500">
                        {formatRelative(s.capturedAt)}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              {detail.sources.length > 20 ? (
                <p className="mt-2 text-xs text-zinc-500">
                  + {detail.sources.length - 20} more sources
                </p>
              ) : null}
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
