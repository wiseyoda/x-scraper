import type { EntityType } from '@x-scraper/core';
import Link from 'next/link';

import { PinButton } from '@/components/PinButton';
import { hydratePins, type HydratedPin } from '@/lib/pins-hydrated';

export const dynamic = 'force-dynamic';

const KIND_BADGE: Record<HydratedPin['kind'], string> = {
  Idea: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30',
  Source: 'bg-zinc-500/10 text-zinc-400 ring-zinc-500/30',
  Person: 'bg-sky-500/10 text-sky-300 ring-sky-500/30',
  Tool: 'bg-sky-500/10 text-sky-300 ring-sky-500/30',
  Concept: 'bg-sky-500/10 text-sky-300 ring-sky-500/30',
  Repo: 'bg-sky-500/10 text-sky-300 ring-sky-500/30',
  Article: 'bg-sky-500/10 text-sky-300 ring-sky-500/30',
  Tweet: 'bg-sky-500/10 text-sky-300 ring-sky-500/30',
  Video: 'bg-sky-500/10 text-sky-300 ring-sky-500/30',
  PDF: 'bg-sky-500/10 text-sky-300 ring-sky-500/30',
  Topic: 'bg-violet-500/10 text-violet-300 ring-violet-500/30',
  Claim: 'bg-amber-500/10 text-amber-300 ring-amber-500/30',
  Missing: 'bg-rose-500/10 text-rose-300 ring-rose-500/30',
};

const KIND_ORDER: HydratedPin['kind'][] = [
  'Idea',
  'Tool',
  'Concept',
  'Person',
  'Repo',
  'Article',
  'Tweet',
  'Video',
  'PDF',
  'Source',
  'Topic',
  'Claim',
  'Missing',
];

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

const PinRow = ({ pin }: { pin: HydratedPin }): React.JSX.Element => (
  <div
    className={`group relative rounded-lg border bg-zinc-900/40 transition hover:border-zinc-600 hover:bg-zinc-900 ${pin.stale ? 'border-amber-500/30' : 'border-zinc-800'}`}
  >
    <div className="flex items-start gap-3 p-4 pr-12">
      <span
        className={`mt-1 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ring-1 ring-inset ${KIND_BADGE[pin.kind]}`}
      >
        {pin.kind === 'Missing' ? 'gone' : pin.kind.toLowerCase()}
      </span>
      <div className="min-w-0 flex-1">
        {pin.href !== null ? (
          <Link href={pin.href} className="block">
            <div className="truncate text-base font-medium text-zinc-100 group-hover:text-zinc-50">
              {pin.label}
            </div>
            <div className="mt-1 truncate text-xs text-zinc-500">{pin.meta}</div>
            {pin.snippet !== null ? (
              <p className="mt-2 line-clamp-2 text-sm text-zinc-400">{pin.snippet}</p>
            ) : null}
          </Link>
        ) : (
          <div>
            <div className="truncate text-base font-medium text-zinc-300">{pin.label}</div>
            <div className="mt-1 truncate text-xs text-zinc-500">{pin.meta}</div>
            {pin.snippet !== null ? (
              <p className="mt-2 line-clamp-2 text-sm text-zinc-400">{pin.snippet}</p>
            ) : null}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span>pinned {formatRelative(pin.pinnedAt)}</span>
          {pin.lastVisitedAt !== null ? (
            <span>· last opened {formatRelative(pin.lastVisitedAt)}</span>
          ) : (
            <span className="text-zinc-600">· never opened</span>
          )}
          {pin.stale ? (
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-inset ring-amber-500/30">
              stale — still relevant?
            </span>
          ) : null}
          {pin.externalUrl !== null ? (
            <a
              href={pin.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sky-400 hover:text-sky-300"
            >
              open original ↗
            </a>
          ) : null}
        </div>
        {pin.note !== null && pin.note.length > 0 ? (
          <p className="mt-2 rounded bg-zinc-800/50 px-2 py-1 text-xs italic text-zinc-300">
            {pin.note}
          </p>
        ) : null}
      </div>
    </div>
    <div className="absolute right-2 top-2">
      {pin.kind !== 'Missing' ? (
        <PinButton id={pin.id} kind={pin.kind as EntityType} initialPinned />
      ) : null}
    </div>
  </div>
);

export default async function PinnedPage(): Promise<React.JSX.Element> {
  const pins = await hydratePins();

  // Group by kind, ordering by KIND_ORDER first.
  const byKind = new Map<HydratedPin['kind'], HydratedPin[]>();
  for (const pin of pins) {
    const list = byKind.get(pin.kind) ?? [];
    list.push(pin);
    byKind.set(pin.kind, list);
  }

  const sections = KIND_ORDER.flatMap((k) => {
    const list = byKind.get(k);
    if (list === undefined || list.length === 0) return [];
    return [{ kind: k, items: list }];
  });

  const staleCount = pins.filter((p) => p.stale).length;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
        ← back to dashboard
      </Link>
      <header className="mt-3 mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">Your pins</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Things you flagged as interesting. Pinning is your personal "save for later" — separate
            from the system's auto-confirm.
          </p>
        </div>
        {pins.length > 0 ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-zinc-300">{pins.length} pinned</span>
            {staleCount > 0 ? (
              <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300 ring-1 ring-inset ring-amber-500/30">
                {staleCount} stale
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      {pins.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-12 text-center">
          <p className="text-sm text-zinc-400">
            Nothing pinned yet. Star items on the dashboard, search results, or detail pages to keep
            track of what matters to you.
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            Tip: pin OpenClaw, Claude Code, or Anthropic — your most-bookmarked entities.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
          >
            Go to dashboard →
          </Link>
        </div>
      ) : (
        <div className="space-y-10">
          {sections.map((s) => (
            <section key={s.kind}>
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {s.kind === 'Missing' ? 'Missing from vault' : s.kind} ·{' '}
                <span className="text-zinc-600">{s.items.length}</span>
              </h2>
              <div className="space-y-3">
                {s.items.map((p) => (
                  <PinRow key={p.id} pin={p} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
