'use client';

import { useState, useTransition } from 'react';

import { updateNoteAction } from '@/app/actions/pin';

interface PinNoteEditorProps {
  id: string;
  initialNote: string;
}

const MAX_NOTE_CHARS = 500;

export const PinNoteEditor = (props: PinNoteEditorProps): React.JSX.Element => {
  const [note, setNote] = useState(props.initialNote);
  const [savedNote, setSavedNote] = useState(props.initialNote);
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(props.initialNote.length > 0);

  const dirty = note.trim() !== savedNote.trim();

  const onSave = (): void => {
    startTransition(() => {
      updateNoteAction(props.id, note)
        .then(() => {
          setSavedNote(note);
        })
        .catch(() => {
          /* noop */
        });
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="mt-3 text-xs text-zinc-500 hover:text-zinc-300"
      >
        + add note to pin
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-amber-400/80">
        Your note on this pin
      </label>
      <textarea
        value={note}
        onChange={(e) => {
          setNote(e.target.value.slice(0, MAX_NOTE_CHARS));
        }}
        rows={2}
        placeholder="Why does this matter? What do you want to remember?"
        className="mt-1.5 w-full resize-y rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/40 focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-zinc-600">
          {String(note.length)}/{String(MAX_NOTE_CHARS)}
        </span>
        <div className="flex gap-2">
          {note.length === 0 && savedNote.length === 0 ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
              }}
              className="text-zinc-500 hover:text-zinc-300"
            >
              cancel
            </button>
          ) : null}
          <button
            type="button"
            disabled={!dirty || isPending}
            onClick={onSave}
            className="rounded bg-amber-500/15 px-2.5 py-1 font-medium text-amber-300 ring-1 ring-inset ring-amber-500/30 transition hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPending ? 'saving…' : dirty ? 'save' : 'saved'}
          </button>
        </div>
      </div>
    </div>
  );
};
