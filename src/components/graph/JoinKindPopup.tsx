import { useEffect, useRef } from 'react';
import {
  DEFAULT_JOIN_KIND,
  JOIN_KIND_ORDER,
  joinKindLabel,
  nextJoinKind,
  resolveJoinPromptKey,
  type JoinKind,
} from '../../lib/joinChoice';

export function JoinKindPopup({
  screen,
  focused,
  onFocus,
  onConfirm,
  onCancel,
}: {
  screen: { x: number; y: number };
  focused: JoinKind;
  onFocus: (kind: JoinKind) => void;
  onConfirm: (kind: JoinKind) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const decision = resolveJoinPromptKey(event.key, focused);
      if (decision === 'cancel') {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      if (decision === 'shared-anchor' || decision === 'branch-point') {
        event.preventDefault();
        event.stopPropagation();
        onConfirm(decision);
        return;
      }
      if (decision === 'focus-next') {
        event.preventDefault();
        onFocus(nextJoinKind(focused, 1));
        return;
      }
      if (decision === 'focus-prev') {
        event.preventDefault();
        onFocus(nextJoinKind(focused, -1));
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (dialogRef.current?.contains(event.target as Node)) return;
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [focused, onCancel, onConfirm, onFocus]);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Join as"
      tabIndex={-1}
      className="fixed z-[80] min-w-[11rem] rounded-lg border border-zinc-600 bg-zinc-900/95 p-1.5 shadow-xl outline-none"
      style={{ left: screen.x + 8, top: screen.y + 8 }}
    >
      <div className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
        Join as
      </div>
      <div role="listbox" aria-label="Join as" className="flex flex-col gap-0.5">
        {JOIN_KIND_ORDER.map((kind) => {
          const selected = focused === kind;
          return (
            <button
              key={kind}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onConfirm(kind)}
              onMouseEnter={() => onFocus(kind)}
              className={`rounded px-2 py-1.5 text-left text-[11px] ${
                selected
                  ? 'bg-amber-500/20 text-amber-100'
                  : 'text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <span className="font-medium">{joinKindLabel(kind)}</span>
              {kind === DEFAULT_JOIN_KIND && (
                <span className="ml-2 text-[9px] text-zinc-500">Enter</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
