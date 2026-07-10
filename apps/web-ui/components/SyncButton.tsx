'use client';

import { useEffect, useState, useTransition } from 'react';

import { refreshAfterSyncAction, startSyncAction } from '@/app/actions/sync';
import type { SyncRunState } from '@/lib/sync-runner';

// Plain fetch beats a server action for polling — server actions
// re-render the RSC tree on every call (slow in dev).
const fetchStatus = async (runId?: string): Promise<SyncRunState | null> => {
  const url = runId !== undefined ? `/api/sync/status?id=${runId}` : '/api/sync/status';
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as SyncRunState | null;
  } catch {
    return null;
  }
};

interface SyncButtonProps {
  /** Optional initial run state from the server, e.g. on the inbox header. */
  initialState?: SyncRunState | null;
  /** Tone — 'cta' for amber emphasis on stale banners, 'default' otherwise. */
  tone?: 'cta' | 'default';
}

const POLL_MS = 2000;

const summarize = (state: SyncRunState): string => {
  // Pull a one-line status from the most recent log lines.
  const lines = state.log
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const last = lines[lines.length - 1] ?? '';
  if (last.length === 0) return state.stage;
  return last.length > 90 ? `${last.slice(0, 90)}…` : last;
};

export const SyncButton = (props: SyncButtonProps): React.JSX.Element => {
  const [state, setState] = useState<SyncRunState | null>(props.initialState ?? null);
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  // Poll while a run is active. Uses /api/sync/status (plain JSON) — server
  // actions are too expensive to poll because each call re-renders the RSC tree.
  useEffect(() => {
    const active = state !== null && (state.stage === 'running' || state.stage === 'pending');
    if (!active) return undefined;
    const id = state.runId;
    const handle = setInterval((): void => {
      fetchStatus(id)
        .then((s) => {
          if (s !== null) setState(s);
          if (s !== null && (s.stage === 'success' || s.stage === 'failed')) {
            clearInterval(handle);
            if (s.stage === 'success') {
              refreshAfterSyncAction().catch(() => {
                /* dashboard will catch up on next nav */
              });
            }
          }
        })
        .catch(() => {
          /* transient network blip; next tick will retry */
        });
    }, POLL_MS);
    return (): void => {
      clearInterval(handle);
    };
  }, [state]);

  // On first mount, fetch the latest run state if we weren't given one.
  useEffect(() => {
    if (state !== null) return;
    fetchStatus()
      .then((s) => {
        if (s !== null) setState(s);
      })
      .catch(() => {
        /* server might be warming up; user can still trigger a sync */
      });
  }, [state]);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleStart = (): void => {
    setErrorMsg(null);
    startTransition(() => {
      startSyncAction()
        .then((r) => {
          if (r.alreadyRunning) {
            setOpen(true);
          }
          return fetchStatus(r.runId);
        })
        .then((s) => {
          if (s !== null) {
            setState(s);
            setOpen(true);
          }
        })
        .catch((err: unknown) => {
          setErrorMsg(err instanceof Error ? err.message : String(err));
          setOpen(true);
        });
    });
  };

  const running = state !== null && (state.stage === 'running' || state.stage === 'pending');
  const failed = state !== null && state.stage === 'failed';
  const succeeded = state !== null && state.stage === 'success';

  const ctaToneClasses =
    props.tone === 'cta'
      ? 'bg-amber-500/15 text-amber-200 ring-amber-500/40 hover:bg-amber-500/25'
      : 'bg-zinc-900 text-zinc-200 ring-zinc-800 hover:border-zinc-600';

  const buttonLabel = running ? 'Syncing…' : failed ? 'Retry sync' : 'Sync from x.com';

  return (
    <>
      <button
        type="button"
        onClick={running ? () => setOpen(true) : handleStart}
        disabled={isPending}
        className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${ctaToneClasses} ${isPending ? 'opacity-60' : ''}`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`}
        >
          <path d="M21 12a9 9 0 11-3-6.7" />
          <path d="M21 4v5h-5" />
        </svg>
        <span>{buttonLabel}</span>
      </button>

      {open && state !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
          >
            <header className="flex items-baseline justify-between gap-3 border-b border-zinc-800 px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">
                  {running
                    ? 'Syncing from x.com'
                    : succeeded
                      ? 'Sync complete'
                      : failed
                        ? 'Sync failed'
                        : 'Sync'}
                </h2>
                <p className="text-xs text-zinc-500">{summarize(state)}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                aria-label="Close"
              >
                ✕
              </button>
            </header>
            {failed && state.error !== null ? (
              <div className="border-b border-rose-500/20 bg-rose-500/[0.05] px-5 py-2 text-xs text-rose-300">
                {state.error}
              </div>
            ) : null}
            {errorMsg !== null ? (
              <div className="border-b border-rose-500/20 bg-rose-500/[0.05] px-5 py-2 text-xs text-rose-300">
                Client error: {errorMsg}
              </div>
            ) : null}
            <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words bg-zinc-950 px-5 py-4 font-mono text-[11px] leading-relaxed text-zinc-300">
              {state.log.length > 0 ? state.log : 'starting…'}
            </pre>
            <footer className="flex items-center justify-between gap-3 border-t border-zinc-800 px-5 py-3 text-xs text-zinc-500">
              <span className="font-mono">{state.runId.slice(0, 8)}</span>
              {running ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  live · refreshing every {String(POLL_MS / 1000)}s
                </span>
              ) : (
                <span>
                  {succeeded ? '✓ done' : '✗ failed'} ·{' '}
                  {state.finishedAt !== null ? new Date(state.finishedAt).toLocaleTimeString() : ''}
                </span>
              )}
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
};
