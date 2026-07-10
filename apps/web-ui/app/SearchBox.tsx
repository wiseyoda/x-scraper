'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';

import { searchAction } from '@/app/actions/search';
import type { SearchHit } from '@/lib/search';

const KIND_BADGE: Record<SearchHit['kind'], string> = {
  idea: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30',
  entity: 'bg-sky-500/10 text-sky-300 ring-sky-500/30',
  source: 'bg-zinc-500/10 text-zinc-400 ring-zinc-500/30',
};

const DEBOUNCE_MS = 150;

export const SearchBox = (): React.JSX.Element => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Debounced search.
  useEffect(() => {
    if (query.trim().length === 0) {
      setResults([]);
      return undefined;
    }
    const handle = setTimeout(() => {
      startTransition(() => {
        searchAction(query)
          .then((hits) => {
            setResults(hits);
            setActiveIdx(0);
          })
          .catch(() => {
            setResults([]);
          });
      });
    }, DEBOUNCE_MS);
    return (): void => {
      clearTimeout(handle);
    };
  }, [query]);

  // Click-outside closes dropdown.
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return (): void => {
      document.removeEventListener('mousedown', onClick);
    };
  }, []);

  // Global "/" focuses the search input. ESC blurs and clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const isFormField =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (e.key === '/' && !isFormField) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return (): void => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (query.length > 0) {
        setQuery('');
        setResults([]);
      } else {
        setOpen(false);
        inputRef.current?.blur();
      }
      return;
    }
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const hit = results[activeIdx];
      if (hit !== undefined) {
        e.preventDefault();
        if (hit.href.startsWith('http')) {
          window.open(hit.href, '_blank', 'noreferrer');
        } else {
          window.location.assign(hit.href);
        }
        setOpen(false);
      }
    }
  };

  const showDropdown = open && query.trim().length > 0;

  return (
    <div ref={wrapRef} className="relative w-full">
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-zinc-500">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
        </span>
        <input
          ref={inputRef}
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search ideas, entities, sources…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onKeyDown={onInputKey}
          className="w-full rounded-md border border-zinc-800 bg-zinc-900/70 py-1.5 pl-9 pr-12 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:bg-zinc-900 focus:outline-none"
        />
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-3 my-auto hidden h-5 select-none items-center rounded border border-zinc-800 bg-zinc-900 px-1.5 text-[10px] font-mono text-zinc-500 sm:inline-flex"
        >
          /
        </kbd>
      </div>
      {showDropdown ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[480px] overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl">
          {results.length === 0 ? (
            <div className="p-6 text-center text-sm text-zinc-500">No matches.</div>
          ) : (
            <ul className="divide-y divide-zinc-800/60">
              {results.map((hit, idx) => {
                const isExternal = hit.href.startsWith('http');
                const active = idx === activeIdx;
                const inner = (
                  <div
                    className={`flex items-baseline gap-3 px-4 py-2.5 ${active ? 'bg-zinc-900' : 'hover:bg-zinc-900/70'}`}
                    onMouseEnter={() => {
                      setActiveIdx(idx);
                    }}
                  >
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ring-1 ring-inset ${KIND_BADGE[hit.kind]}`}
                    >
                      {hit.kind}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-zinc-100">{hit.label}</div>
                      <div className="truncate text-xs text-zinc-500">{hit.meta}</div>
                      {hit.snippet !== undefined ? (
                        <div className="mt-0.5 line-clamp-1 text-[11px] italic text-zinc-400">
                          {hit.snippet}
                        </div>
                      ) : null}
                    </div>
                    {isExternal ? (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        className="h-3 w-3 shrink-0 text-zinc-600"
                        aria-hidden="true"
                      >
                        <path d="M9 6h9v9" />
                        <path d="M18 6L8 16" />
                      </svg>
                    ) : null}
                  </div>
                );
                return (
                  <li key={`${hit.kind}-${hit.id}`}>
                    {isExternal ? (
                      <a href={hit.href} target="_blank" rel="noreferrer" className="block">
                        {inner}
                      </a>
                    ) : (
                      <Link
                        href={hit.href}
                        onClick={() => {
                          setOpen(false);
                        }}
                        className="block"
                      >
                        {inner}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="border-t border-zinc-800/60 px-4 py-1.5 text-[10px] text-zinc-600">
            <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1 font-mono">↑↓</kbd>{' '}
            navigate ·{' '}
            <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1 font-mono">↵</kbd> open
            · <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1 font-mono">esc</kbd>{' '}
            clear
          </div>
        </div>
      ) : null}
    </div>
  );
};
