'use client';

import type { EntityType } from '@x-scraper/core';
import { useOptimistic, useState, useTransition } from 'react';

import { togglePinAction } from '@/app/actions/pin';

interface PinButtonProps {
  id: string;
  kind: EntityType;
  initialPinned: boolean;
  /** "icon" for compact card use, "full" for detail pages with text label. */
  variant?: 'icon' | 'full';
  /** Stop click from bubbling to a wrapping <Link>. Default true. */
  stopPropagation?: boolean;
}

const STAR_FILLED = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-4 w-4">
    <path d="M12 2.25l3.09 6.26 6.91 1-5 4.87 1.18 6.87L12 17.77l-6.18 3.49L7 14.38l-5-4.87 6.91-1L12 2.25z" />
  </svg>
);

const STAR_OUTLINE = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinejoin="round"
    aria-hidden="true"
    className="h-4 w-4"
  >
    <path d="M12 2.25l3.09 6.26 6.91 1-5 4.87 1.18 6.87L12 17.77l-6.18 3.49L7 14.38l-5-4.87 6.91-1L12 2.25z" />
  </svg>
);

export const PinButton = (props: PinButtonProps): React.JSX.Element => {
  const variant = props.variant ?? 'icon';
  const stopPropagation = props.stopPropagation ?? true;

  const [serverPinned, setServerPinned] = useState(props.initialPinned);
  const [optimisticPinned, setOptimisticPinned] = useOptimistic<boolean, boolean>(
    serverPinned,
    (_state, next) => next,
  );
  const [isPending, startTransition] = useTransition();

  const onClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    startTransition(() => {
      const next = !optimisticPinned;
      setOptimisticPinned(next);
      togglePinAction(props.id, props.kind)
        .then((r) => {
          setServerPinned(r.pinned);
        })
        .catch(() => {
          setServerPinned(serverPinned);
        });
    });
  };

  const pinned = optimisticPinned;
  const label = pinned ? 'Pinned' : 'Pin';

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={pinned}
        aria-label={pinned ? 'Unpin' : 'Pin'}
        title={pinned ? 'Unpin' : 'Pin'}
        disabled={isPending}
        className={`shrink-0 rounded p-1 transition ${
          pinned
            ? 'text-amber-400 hover:bg-amber-500/10'
            : 'text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300'
        } ${isPending ? 'opacity-60' : ''}`}
      >
        {pinned ? STAR_FILLED : STAR_OUTLINE}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pinned}
      disabled={isPending}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${
        pinned
          ? 'bg-amber-500/10 text-amber-300 ring-amber-500/40 hover:bg-amber-500/15'
          : 'bg-zinc-900 text-zinc-300 ring-zinc-800 hover:bg-zinc-800 hover:text-zinc-100'
      } ${isPending ? 'opacity-60' : ''}`}
    >
      {pinned ? STAR_FILLED : STAR_OUTLINE}
      <span>{label}</span>
    </button>
  );
};
