import { useEffect, useState } from 'react';
import { useHarnessStore, useUndoStaleness } from '../../store';

const UNDO_REQUEST_EVENT = 'vibewire:request-undo';

function formatSince(timestamp: number | null): string {
  if (!timestamp) return 'recently';
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'} ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

export function UndoStalenessChip() {
  const staleness = useUndoStaleness();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [affectedEntities, setAffectedEntities] = useState<string[]>([]);

  useEffect(() => {
    const requestUndo = () => {
      if (staleness.state !== 'red') {
        useHarnessStore.getState().undo();
        return;
      }
      setAffectedEntities(useHarnessStore.getState().getUndoAffectedEntities());
      setConfirmOpen(true);
    };
    window.addEventListener(UNDO_REQUEST_EVENT, requestUndo);
    return () => window.removeEventListener(UNDO_REQUEST_EVENT, requestUndo);
  }, [staleness.state]);

  const colorClass = staleness.state === 'green'
    ? 'border-emerald-800 bg-emerald-950/60 text-emerald-300'
    : staleness.state === 'red'
      ? 'border-red-800 bg-red-950/60 text-red-300'
      : 'border-zinc-700 bg-zinc-800 text-zinc-500';
  const writer = staleness.lastWriter?.displayName ?? 'Someone else';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setPopoverOpen((open) => !open)}
        className={`rounded border px-1.5 py-0.5 text-[9px] font-medium ${colorClass}`}
        title="Undo collaboration status"
      >
        <span className="mr-1">●</span>
        {staleness.state === 'none' ? 'No undo' : staleness.state === 'red' ? 'Undo changed' : 'Undo ready'}
      </button>

      {popoverOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded border border-zinc-700 bg-zinc-900 p-3 text-[11px] text-zinc-300 shadow-xl">
          <div className="font-semibold text-zinc-100">Undo is per-person and time-ordered.</div>
          <p className="mt-1">
            VibeWire undoes your last change, not the most recent change overall. If someone
            else edited afterward, undo can cross their work or fail because the harness moved on.
          </p>
          <p className="mt-2 text-zinc-400">
            {staleness.state === 'none'
              ? 'Right now: there is nothing to undo.'
              : staleness.state === 'red'
                ? `Right now: ${writer} edited this harness ${formatSince(staleness.since)}.`
                : 'Right now: nobody else has written since your last change.'}
          </p>
          <p className="mt-2 text-amber-300">If you are not sure, save a checkpoint first.</p>
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="stale-undo-title"
            className="w-full max-w-md rounded border border-red-800 bg-zinc-900 p-4 shadow-2xl"
          >
            <h2 id="stale-undo-title" className="text-sm font-semibold text-red-300">
              {writer} edited after your change
            </h2>
            <p className="mt-2 text-xs text-zinc-300">
              Undoing now may cross their work. VibeWire will revert these entities:
            </p>
            <div className="mt-2 max-h-36 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-400">
              {affectedEntities.length > 0
                ? affectedEntities.map((entity) => <div key={entity}>{entity}</div>)
                : <div>the changed document data</div>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  useHarnessStore.getState().undo();
                }}
                className="rounded border border-red-700 bg-red-950 px-3 py-1.5 text-xs text-red-200 hover:bg-red-900"
              >
                Undo anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
