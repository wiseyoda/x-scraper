'use client';

import { useState, useTransition } from 'react';

import { addTagAction, removeTagAction } from '@/app/actions/source-state';

interface TagEditorProps {
  id: string;
  initialTags: string[];
}

const MAX_TAG_LEN = 40;

export const TagEditor = (props: TagEditorProps): React.JSX.Element => {
  const [tags, setTags] = useState<string[]>(props.initialTags);
  const [draft, setDraft] = useState('');
  const [isPending, startTransition] = useTransition();

  const submit = (): void => {
    const t = draft.trim().slice(0, MAX_TAG_LEN);
    if (t.length === 0) return;
    if (tags.includes(t)) {
      setDraft('');
      return;
    }
    const next = [...tags, t];
    setTags(next);
    setDraft('');
    startTransition(() => {
      addTagAction(props.id, t)
        .then((r) => {
          setTags(r.tags);
        })
        .catch(() => {
          setTags(tags);
        });
    });
  };

  const remove = (t: string): void => {
    const next = tags.filter((x) => x !== t);
    setTags(next);
    startTransition(() => {
      removeTagAction(props.id, t)
        .then((r) => {
          setTags(r.tags);
        })
        .catch(() => {
          setTags(tags);
        });
    });
  };

  return (
    <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Tags
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded bg-violet-500/10 px-2 py-0.5 text-xs text-violet-300 ring-1 ring-inset ring-violet-500/30"
          >
            #{t}
            <button
              type="button"
              onClick={() => {
                remove(t);
              }}
              disabled={isPending}
              aria-label={`Remove tag ${t}`}
              className="text-violet-400/70 hover:text-violet-200"
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Backspace' && draft.length === 0 && tags.length > 0) {
              const last = tags[tags.length - 1];
              if (last !== undefined) remove(last);
            }
          }}
          onBlur={submit}
          placeholder={tags.length === 0 ? 'add a tag — e.g. to-build, research' : '+ tag'}
          maxLength={MAX_TAG_LEN}
          className="min-w-[140px] flex-1 bg-transparent px-1 py-0.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
        />
      </div>
    </div>
  );
};
