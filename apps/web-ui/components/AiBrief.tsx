'use client';

import { useState, useTransition } from 'react';

import { generateBriefAction } from '@/app/actions/brief';
import type { CapturedContentType } from '@/lib/capture-cache';

interface AiBriefProps {
  sourceId: string;
  contentType: CapturedContentType;
  body: string;
  url: string;
  /** Pre-existing brief read from cache by the server component. */
  initialBrief: string | null;
}

export const AiBrief = (props: AiBriefProps): React.JSX.Element => {
  const [brief, setBrief] = useState<string | null>(props.initialBrief);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const generate = (): void => {
    setError(null);
    startTransition(() => {
      generateBriefAction({
        sourceId: props.sourceId,
        contentType: props.contentType,
        body: props.body,
        url: props.url,
      })
        .then((r) => {
          if (r.error !== undefined) {
            setError(r.error);
          } else {
            setBrief(r.brief);
          }
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
        });
    });
  };

  if (brief !== null && brief.length > 0) {
    return (
      <section className="rounded-lg border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.04] to-zinc-900/30 p-4">
        <header className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-violet-400">
            ✨ AI brief
          </h3>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setBrief(null);
              generate();
            }}
            className="text-[10px] text-zinc-500 hover:text-zinc-300"
          >
            regenerate
          </button>
        </header>
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{brief}</div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-dashed border-violet-500/20 bg-violet-500/[0.02] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-violet-400">
            ✨ AI brief
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Get a quick takeaway. ~$0.001, cached after first generation.
          </p>
        </div>
        <button
          type="button"
          disabled={isPending}
          onClick={generate}
          className="rounded-md bg-violet-500/15 px-3 py-1.5 text-xs font-medium text-violet-200 ring-1 ring-inset ring-violet-500/30 hover:bg-violet-500/25 disabled:opacity-50"
        >
          {isPending ? 'generating…' : 'Generate brief'}
        </button>
      </div>
      {error !== null ? <p className="mt-2 text-xs text-rose-400">Error: {error}</p> : null}
    </section>
  );
};
