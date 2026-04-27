import type { IdeaFrontmatter } from '@x-scraper/core';
import Link from 'next/link';

import { getVault } from '@/lib/vault';

export const dynamic = 'force-dynamic';

interface IdeaSummary {
  id: string;
  status: 'draft' | 'confirmed' | 'rejected';
  subject: string;
  confidence: number;
  sourceCount: number;
  derivedFromCount: number;
  updatedAt: string;
}

const STATUS_FILTERS: ('draft' | 'confirmed' | 'rejected')[] = ['draft', 'confirmed', 'rejected'];

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
      subject: fm.subject,
      confidence: fm.synthesizer_confidence,
      sourceCount: fm.sources.length,
      derivedFromCount: fm.derived_from.length,
      updatedAt: fm.updated_at,
    });
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
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
  const ideas = await loadIdeas(status);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ideas</h1>
          <p className="mt-1 text-sm text-zinc-400">
            L1 knowledge nodes synthesized from claim clusters. Confirm what holds; reject the rest.
          </p>
        </div>
        <nav className="flex gap-1 rounded-md border border-zinc-800 bg-zinc-900 p-1">
          {STATUS_FILTERS.map((s) => (
            <Link
              key={s}
              href={`/ideas?status=${s}`}
              className={
                s === status
                  ? 'rounded px-3 py-1 text-sm bg-zinc-700 text-zinc-100'
                  : 'rounded px-3 py-1 text-sm text-zinc-400 hover:text-zinc-200'
              }
            >
              {s}
            </Link>
          ))}
        </nav>
      </header>

      {ideas.length === 0 ? (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-8 text-center text-sm text-zinc-400">
          No {status} ideas. Run <code className="text-zinc-200">xs ideas synthesize</code> to draft
          new ones.
        </div>
      ) : (
        <ul className="space-y-3">
          {ideas.map((idea) => (
            <li
              key={idea.id}
              className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 transition hover:border-zinc-700 hover:bg-zinc-900"
            >
              <Link href={`/ideas/${idea.id}`} className="block">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="text-lg font-medium text-zinc-100">{idea.subject}</h2>
                  <span
                    className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_BADGE[idea.status]}`}
                  >
                    {idea.status}
                  </span>
                </div>
                <div className="mt-2 flex gap-4 text-xs text-zinc-500">
                  <span>conf {idea.confidence.toFixed(2)}</span>
                  <span>{idea.sourceCount} sources</span>
                  <span>{idea.derivedFromCount} claims</span>
                  <span className="font-mono">{idea.id}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
