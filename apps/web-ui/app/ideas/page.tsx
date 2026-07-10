import type { IdeaFrontmatter } from '@x-scraper/core';
import Link from 'next/link';

import { PinButton } from '@/components/PinButton';
import { pinnedIdSet } from '@/lib/pins';
import { getVault } from '@/lib/vault';

export const dynamic = 'force-dynamic';

interface IdeaSummary {
  id: string;
  status: 'draft' | 'confirmed' | 'rejected';
  autoConfirmed: boolean;
  subject: string;
  confidence: number;
  sourceCount: number;
  derivedFromCount: number;
  updatedAt: string;
  snippet: string | null;
}

const STATUS_FILTERS: ('draft' | 'confirmed' | 'rejected')[] = ['draft', 'confirmed', 'rejected'];

const firstParagraph = (body: string): string | null => {
  const stopAt = body.indexOf('## Derived from');
  const trimmed = stopAt > 0 ? body.slice(0, stopAt) : body;
  const lines = trimmed
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('---'));
  if (lines.length === 0) return null;
  const meaty = lines.find((l) => l.length >= 60) ?? lines[0];
  if (meaty === undefined) return null;
  return meaty.length > 220 ? `${meaty.slice(0, 220).trimEnd()}…` : meaty;
};

const loadIdeas = async (status: 'draft' | 'confirmed' | 'rejected'): Promise<IdeaSummary[]> => {
  const vault = await getVault();
  const list = await vault.list('Idea');
  const out: IdeaSummary[] = [];
  for (const entry of list) {
    let record;
    try {
      record = await vault.read(entry.id, 'Idea');
    } catch {
      continue;
    }
    if (record.frontmatter.type !== 'Idea') continue;
    const fm: IdeaFrontmatter = record.frontmatter;
    if (fm.status !== status) continue;
    out.push({
      id: fm.id,
      status: fm.status,
      autoConfirmed: fm.auto_confirmed,
      subject: fm.subject,
      confidence: fm.synthesizer_confidence,
      sourceCount: fm.sources.length,
      derivedFromCount: fm.derived_from.length,
      updatedAt: fm.updated_at,
      snippet: firstParagraph(record.body),
    });
  }
  // Sort by source count desc (interest), then by recency.
  out.sort((a, b) => {
    if (b.sourceCount !== a.sourceCount) return b.sourceCount - a.sourceCount;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  return out;
};

const STATUS_BADGE: Record<IdeaSummary['status'], string> = {
  draft: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  confirmed: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  rejected: 'bg-zinc-500/15 text-zinc-400 ring-zinc-500/30',
};

export default async function IdeasPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const status: 'draft' | 'confirmed' | 'rejected' =
    params.status === 'confirmed' || params.status === 'rejected' ? params.status : 'draft';
  const [ideas, pinned] = await Promise.all([loadIdeas(status), pinnedIdSet()]);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Ideas</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            L1 knowledge nodes synthesized from claim clusters. Confirm what holds; reject the rest.
          </p>
        </div>
        <nav className="flex gap-1 rounded-md border border-zinc-800 bg-zinc-900 p-1 text-sm">
          {STATUS_FILTERS.map((s) => (
            <Link
              key={s}
              href={`/ideas?status=${s}`}
              className={
                s === status
                  ? 'rounded px-3 py-1 bg-zinc-700 text-zinc-100'
                  : 'rounded px-3 py-1 text-zinc-400 hover:text-zinc-200'
              }
            >
              {s}
            </Link>
          ))}
        </nav>
      </header>

      {ideas.length === 0 ? (
        <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-900/30 p-8 text-center text-sm text-zinc-400">
          No {status} ideas. Run{' '}
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-200">
            xs ideas synthesize
          </code>{' '}
          to draft new ones.
        </div>
      ) : (
        <ul className="space-y-2">
          {ideas.map((idea) => (
            <li
              key={idea.id}
              className="group relative rounded-lg border border-zinc-800 bg-zinc-900/40 transition hover:border-zinc-600 hover:bg-zinc-900"
            >
              <Link href={`/ideas/${idea.id}`} className="block p-4 pr-12">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="truncate text-base font-medium text-zinc-100">{idea.subject}</h2>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${STATUS_BADGE[idea.status]}`}
                    >
                      {idea.status}
                    </span>
                    {idea.autoConfirmed ? (
                      <span className="inline-flex items-center rounded bg-emerald-500/10 px-1 py-0.5 text-[9px] font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
                        auto
                      </span>
                    ) : null}
                  </div>
                </div>
                {idea.snippet !== null ? (
                  <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-zinc-400">
                    {idea.snippet}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                  <span>conf {idea.confidence.toFixed(2)}</span>
                  <span className="text-zinc-700">·</span>
                  <span>{idea.sourceCount} sources</span>
                  <span className="text-zinc-700">·</span>
                  <span>{idea.derivedFromCount} claims</span>
                  <span className="ml-auto font-mono text-[10px] text-zinc-600">{idea.id}</span>
                </div>
              </Link>
              <div className="absolute right-2 top-2">
                <PinButton id={idea.id} kind="Idea" initialPinned={pinned.has(idea.id)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
