import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { DOUBLE_CLICK_GUARD_MS } from '../../lib/doubleClickGuard';

export const EDITABLE_FIELD_CLASS =
  'rounded border border-zinc-500/80 bg-zinc-950 px-2 py-1 outline-none transition-colors placeholder:text-zinc-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40';

export function NodeTitleEditor({
  value,
  color,
  disabled,
  ariaLabel,
  className = '',
  passThroughDoubleClick = false,
  onCommit,
}: {
  value: string;
  color?: string;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  passThroughDoubleClick?: boolean;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingEditRef = useRef<number | null>(null);

  const cancelPendingEdit = () => {
    if (pendingEditRef.current == null) return;
    window.clearTimeout(pendingEditRef.current);
    pendingEditRef.current = null;
  };

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => () => cancelPendingEdit(), []);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === value) {
      setDraft(value);
      return;
    }
    onCommit(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(value);
      setEditing(false);
    }
  };

  if (disabled) {
    return (
      <div
        className={`rounded border border-zinc-600/50 bg-zinc-950/40 px-1.5 py-0.5 ${className}`}
        style={{ color }}
      >
        {value}
      </div>
    );
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        aria-label={ariaLabel}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        className={`nodrag nopan w-full min-w-0 font-bold ${EDITABLE_FIELD_CLASS} ${className}`}
        style={{ color }}
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title="Click to rename"
      onClick={() => {
        if (!passThroughDoubleClick) {
          setEditing(true);
          return;
        }
        cancelPendingEdit();
        pendingEditRef.current = window.setTimeout(() => {
          pendingEditRef.current = null;
          setEditing(true);
        }, DOUBLE_CLICK_GUARD_MS);
      }}
      onDoubleClick={(event) => {
        if (passThroughDoubleClick) {
          cancelPendingEdit();
          return;
        }
        event.stopPropagation();
      }}
      className={`nodrag nopan w-full min-w-0 rounded border border-zinc-500/70 bg-zinc-950/50 px-1.5 py-0.5 text-left font-bold leading-tight hover:border-amber-500/70 ${className}`}
      style={{ color }}
    >
      {value}
    </button>
  );
}
