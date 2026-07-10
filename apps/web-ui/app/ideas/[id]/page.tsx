import type { IdeaFrontmatter } from '@x-scraper/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { confirmIdea, rejectIdea } from '@/app/ideas/actions';
import { Markdown } from '@/components/Markdown';
import { PinButton } from '@/components/PinButton';
import { PinNoteEditor } from '@/components/PinNoteEditor';
import { loadIdeaDetail } from '@/lib/idea-detail';
import { getPin, isPinned, markVisited, pinnedIdSet } from '@/lib/pins';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<IdeaFrontmatter['status'], string> = {
  draft: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  confirmed: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  rejected: 'bg-zinc-500/15 text-zinc-400 ring-zinc-500/30',
};

/**
 * Strip auto-generated body chrome before rendering:
 *   - leading `# {title}` h1 (already shown in page header, redundant)
 *   - trailing `## Derived from` section (we render the real list below)
 */
const stripDerivedFrom = (body: string): string => {
  let out = body;
  const derived = out.indexOf('## Derived from');
  if (derived > 0) out = out.slice(0, derived).trimEnd();
  out = out.replace(/^# .*\n+/, '');
  return out;
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

export default async function IdeaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await loadIdeaDetail(id);
  if (detail === null) notFound();

  const fm = detail.frontmatter;
  const [pinned, pin, pinnedSet] = await Promise.all([isPinned(id), getPin(id), pinnedIdSet()]);
  await markVisited(id);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
        ← back to dashboard
      </Link>

      <header className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">{fm.subject}</h1>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_BADGE[fm.status]}`}
            >
              {fm.status}
            </span>
            {fm.auto_confirmed ? (
              <span className="inline-flex items-center rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
                auto
              </span>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span className="font-mono">{fm.id}</span>
          <span>conf {fm.synthesizer_confidence.toFixed(2)}</span>
          <span>{fm.sources.length} sources</span>
          <span>{fm.derived_from.length} claims</span>
          <span>synthesized {formatRelative(fm.synthesized_at)}</span>
        </div>
        <div className="mt-4">
          <PinButton id={fm.id} kind="Idea" initialPinned={pinned} variant="full" />
        </div>
        {pinned ? <PinNoteEditor id={fm.id} initialNote={pin?.note ?? ''} /> : null}
      </header>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <article>
            <Markdown body={stripDerivedFrom(detail.body)} />
          </article>

          {fm.status === 'draft' ? (
            <div className="mt-10 flex flex-wrap gap-3 border-t border-zinc-800 pt-6">
              <form action={confirmIdea}>
                <input type="hidden" name="id" value={fm.id} />
                <button
                  type="submit"
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                >
                  Confirm
                </button>
              </form>
              <form action={rejectIdea}>
                <input type="hidden" name="id" value={fm.id} />
                <button
                  type="submit"
                  className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
                >
                  Reject
                </button>
              </form>
              <p className="self-center text-xs text-zinc-500">
                Confirmed ideas leave the queue. Rejected ideas stay on disk for audit.
              </p>
            </div>
          ) : null}

          {detail.sources.length > 0 ? (
            <section className="mt-10">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Sources ({detail.sources.length})
              </h2>
              <ul className="space-y-1.5">
                {detail.sources.map((s) => (
                  <li
                    key={s.id}
                    className="rounded-md border border-zinc-800 bg-zinc-900/40 transition hover:border-zinc-600"
                  >
                    <Link href={`/sources/${s.id}`} className="block p-3">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">
                          {s.contentType}
                        </span>
                        <span className="truncate text-sm text-zinc-300">{s.url}</span>
                        <span className="ml-auto shrink-0 text-xs text-zinc-500">
                          {formatRelative(s.capturedAt)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {detail.claims.length > 0 ? (
            <section className="mt-10">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Derived from claims ({detail.claims.length})
              </h2>
              <ul className="space-y-2">
                {detail.claims.slice(0, 30).map((c) => (
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
                    <Link
                      href={`/sources/${c.sourceId}`}
                      className="mt-1 inline-block font-mono text-[10px] text-zinc-600 hover:text-zinc-400"
                    >
                      from {c.sourceId}
                    </Link>
                  </li>
                ))}
              </ul>
              {detail.claims.length > 30 ? (
                <p className="mt-2 text-xs text-zinc-500">
                  + {detail.claims.length - 30} more claims
                </p>
              ) : null}
            </section>
          ) : null}
        </div>

        <aside className="space-y-8">
          {detail.anchor !== null ? (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Anchor entity
              </h2>
              <div className="group relative rounded-md border border-zinc-800 bg-zinc-900/40 transition hover:border-zinc-600">
                <Link href={`/entities/${detail.anchor.id}`} className="block p-3 pr-10">
                  <div className="text-sm font-medium text-zinc-100">{detail.anchor.name}</div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {detail.anchor.type.toLowerCase()} · {detail.anchor.sourceCount} sources
                  </div>
                </Link>
                <div className="absolute right-1.5 top-1.5">
                  <PinButton
                    id={detail.anchor.id}
                    kind={detail.anchor.type}
                    initialPinned={pinnedSet.has(detail.anchor.id)}
                  />
                </div>
              </div>
            </section>
          ) : null}

          {detail.related.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Related ideas
              </h2>
              <p className="mb-3 text-xs text-zinc-500">Sharing sources with this idea.</p>
              <ul className="space-y-1.5">
                {detail.related.slice(0, 8).map((r) => (
                  <li
                    key={r.id}
                    className="group relative rounded-md border border-zinc-800 bg-zinc-900/40 transition hover:border-zinc-600"
                  >
                    <Link href={`/ideas/${r.id}`} className="block p-2.5 pr-10">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-zinc-100">
                          {r.subject}
                        </span>
                        {r.autoConfirmed ? (
                          <span className="shrink-0 rounded bg-emerald-500/10 px-1 py-0.5 text-[9px] text-emerald-400">
                            auto
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {r.status} · {r.overlap} shared source{r.overlap === 1 ? '' : 's'}
                      </div>
                    </Link>
                    <div className="absolute right-1.5 top-1.5">
                      <PinButton id={r.id} kind="Idea" initialPinned={pinnedSet.has(r.id)} />
                    </div>
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
