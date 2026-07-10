'use client';

import { useOptimistic, useState, useTransition } from 'react';

import { toggleReadAction } from '@/app/actions/source-state';

interface ReadButtonProps {
  id: string;
  initialReadAt: string | null;
  variant?: 'icon' | 'full';
  stopPropagation?: boolean;
}

const CHECK = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="h-3.5 w-3.5"
  >
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const DOT = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-3 w-3">
    <circle cx="12" cy="12" r="5" />
  </svg>
);

export const ReadButton = (props: ReadButtonProps): React.JSX.Element => {
  const variant = props.variant ?? 'icon';
  const stopPropagation = props.stopPropagation ?? true;

  const [serverReadAt, setServerReadAt] = useState(props.initialReadAt);
  const [optimisticReadAt, setOptimisticReadAt] = useOptimistic<string | null, string | null>(
    serverReadAt,
    (_state, next) => next,
  );
  const [isPending, startTransition] = useTransition();

  const onClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    startTransition(() => {
      const next = optimisticReadAt === null ? new Date().toISOString() : null;
      setOptimisticReadAt(next);
      toggleReadAction(props.id)
        .then((r) => {
          setServerReadAt(r.readAt);
        })
        .catch(() => {
          setServerReadAt(serverReadAt);
        });
    });
  };

  const read = optimisticReadAt !== null;
  const label = read ? 'Read' : 'Unread';

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={read}
        aria-label={read ? 'Mark unread' : 'Mark read'}
        title={read ? 'Mark unread' : 'Mark read'}
        disabled={isPending}
        className={`shrink-0 rounded p-1 transition ${
          read
            ? 'text-emerald-400 hover:bg-emerald-500/10'
            : 'text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300'
        } ${isPending ? 'opacity-60' : ''}`}
      >
        {read ? CHECK : DOT}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={read}
      disabled={isPending}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${
        read
          ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30 hover:bg-emerald-500/15'
          : 'bg-zinc-900 text-zinc-300 ring-zinc-800 hover:bg-zinc-800 hover:text-zinc-100'
      } ${isPending ? 'opacity-60' : ''}`}
    >
      {read ? CHECK : DOT}
      <span>{label}</span>
    </button>
  );
};
