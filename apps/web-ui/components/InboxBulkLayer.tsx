'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';

import {
  bulkMarkReadAction,
  bulkMarkUnreadAction,
  bulkPinSourcesAction,
  bulkTagAction,
} from '@/app/actions/bulk';

interface InboxBulkLayerProps {
  /** Ids of every row currently rendered, in display order. */
  visibleIds: string[];
}

/**
 * Wraps the inbox list with a checkbox-based selection layer + a
 * floating action bar. We hijack a checkbox at the start of each row
 * via portals — but simpler: just render a translucent overlay on top
 * of each row. That keeps the server-rendered list as-is.
 *
 * Architecture: this client component manages a `selected` Set and
 * injects checkboxes into each `[data-bulk-row="<id>"]` element on
 * mount. Clicking the checkbox toggles selection. The action bar is
 * a sticky-bottom toolbar visible whenever any row is selected.
 */
export const InboxBulkLayer = ({ visibleIds }: InboxBulkLayerProps): React.JSX.Element => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [tagDraft, setTagDraft] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);

  const selectedIds = useMemo(() => [...selected], [selected]);

  // Inject checkboxes into rows on mount, sync DOM with `selected`.
  useEffect(() => {
    const rows = document.querySelectorAll<HTMLElement>('[data-bulk-row]');
    rows.forEach((row) => {
      const id = row.dataset.bulkRow;
      if (id === undefined) return;
      let checkbox = row.querySelector<HTMLInputElement>(':scope > .bulk-checkbox');
      if (checkbox === null) {
        checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className =
          'bulk-checkbox absolute left-2 top-1/2 z-10 -translate-y-1/2 h-4 w-4 cursor-pointer rounded border-zinc-700 bg-zinc-900 accent-sky-500';
        row.appendChild(checkbox);
      }
      checkbox.checked = selected.has(id);
      checkbox.onchange = (): void => {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      };
    });
    // Add left padding to rows so the checkbox doesn't overlap content.
    rows.forEach((row) => {
      const link = row.querySelector<HTMLElement>('a, [role="link"]');
      if (link !== null && !link.classList.contains('bulk-padded')) {
        link.classList.add('bulk-padded');
        link.style.paddingLeft = '2.25rem';
      }
    });
  }, [selected, visibleIds]);

  const clearSelection = (): void => {
    setSelected(new Set());
  };

  const selectAll = (): void => {
    setSelected(new Set(visibleIds));
  };

  if (selected.size === 0) {
    return (
      <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2">
        <button
          type="button"
          onClick={selectAll}
          className="rounded-full border border-zinc-800 bg-zinc-950/80 px-4 py-1.5 text-xs text-zinc-500 backdrop-blur hover:text-zinc-300"
        >
          select all {visibleIds.length}
        </button>
      </div>
    );
  }

  const runBulk = (fn: (ids: string[]) => Promise<unknown>, afterClear = true): void => {
    const ids = [...selected];
    startTransition(() => {
      fn(ids)
        .then(() => {
          if (afterClear) clearSelection();
        })
        .catch(() => {
          /* swallow — UI already optimistic-ish */
        });
    });
  };

  return (
    <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950/95 px-3 py-2 shadow-2xl backdrop-blur">
        <span className="font-mono text-xs tabular-nums text-zinc-400">
          {selected.size} selected
        </span>
        <span className="h-4 w-px bg-zinc-800" />
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            runBulk(bulkPinSourcesAction);
          }}
          className="rounded-md bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300 ring-1 ring-inset ring-amber-500/30 hover:bg-amber-500/20 disabled:opacity-50"
        >
          ★ Pin
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            runBulk(bulkMarkReadAction);
          }}
          className="rounded-md bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-50"
        >
          ✓ Mark read
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            runBulk(bulkMarkUnreadAction);
          }}
          className="rounded-md bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
        >
          Mark unread
        </button>
        {showTagInput ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (tagDraft.trim().length === 0) return;
              const tag = tagDraft.trim();
              startTransition(() => {
                bulkTagAction(selectedIds, tag)
                  .then(() => {
                    setTagDraft('');
                    setShowTagInput(false);
                    clearSelection();
                  })
                  .catch(() => {
                    /* swallow */
                  });
              });
            }}
            className="flex items-center gap-1"
          >
            <input
              autoFocus
              type="text"
              placeholder="tag…"
              value={tagDraft}
              onChange={(e) => {
                setTagDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setShowTagInput(false);
                  setTagDraft('');
                }
              }}
              className="w-28 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-violet-500/15 px-2 py-1 text-xs font-medium text-violet-300 ring-1 ring-inset ring-violet-500/30 hover:bg-violet-500/25 disabled:opacity-50"
            >
              add
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setShowTagInput(true);
            }}
            className="rounded-md bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300 ring-1 ring-inset ring-violet-500/30 hover:bg-violet-500/20"
          >
            # Tag
          </button>
        )}
        <span className="h-4 w-px bg-zinc-800" />
        <button
          type="button"
          onClick={clearSelection}
          className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300"
        >
          clear
        </button>
      </div>
    </div>
  );
};
