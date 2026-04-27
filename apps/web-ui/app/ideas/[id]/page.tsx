import type { IdeaFrontmatter } from '@x-scraper/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { confirmIdea, rejectIdea } from '@/app/ideas/actions';
import { getVault } from '@/lib/vault';

export const dynamic = 'force-dynamic';

interface IdeaPayload {
  frontmatter: IdeaFrontmatter;
  body: string;
}

const loadIdea = async (id: string): Promise<IdeaPayload | null> => {
  const vault = await getVault();
  let record;
  try {
    record = await vault.read(id, 'Idea');
  } catch {
    return null;
  }
  if (record.frontmatter.type !== 'Idea') return null;
  return { frontmatter: record.frontmatter, body: record.body };
};

const STATUS_BADGE: Record<IdeaFrontmatter['status'], string> = {
  draft: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  confirmed: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  rejected: 'bg-zinc-500/15 text-zinc-400 ring-zinc-500/30',
};

export default async function IdeaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idea = await loadIdea(id);
  if (idea === null) notFound();

  const fm = idea.frontmatter;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link href="/ideas" className="text-sm text-zinc-500 hover:text-zinc-300">
        ← back to ideas
      </Link>

      <header className="mt-4">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">{fm.subject}</h1>
          <span
            className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_BADGE[fm.status]}`}
          >
            {fm.status}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span className="font-mono">{fm.id}</span>
          <span>conf {fm.synthesizer_confidence.toFixed(2)}</span>
          <span>{fm.sources.length} sources</span>
          <span>{fm.derived_from.length} claims</span>
          <span>synthesized {new Date(fm.synthesized_at).toLocaleString()}</span>
        </div>
      </header>

      <article className="prose prose-invert mt-8 max-w-none whitespace-pre-wrap break-words font-sans text-zinc-200">
        {idea.body}
      </article>

      {fm.status === 'draft' && (
        <div className="mt-10 flex gap-3 border-t border-zinc-800 pt-6">
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
      )}

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Sources
        </h2>
        <ul className="space-y-1 text-sm font-mono text-zinc-300">
          {fm.sources.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Derived from claims
        </h2>
        <ul className="space-y-1 text-sm font-mono text-zinc-300">
          {fm.derived_from.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
