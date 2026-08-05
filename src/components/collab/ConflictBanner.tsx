import { useState } from 'react';
import { useHarnessStore } from '../../store';

export function ConflictBanner() {
  const conflict = useHarnessStore((state) => state.conflict);
  const dismissConflict = useHarnessStore((state) => state.dismissConflict);
  const [copyError, setCopyError] = useState<string | null>(null);

  if (!conflict) return null;

  const activeConflict = conflict;
  const displayName = conflict.server.lastWriter?.displayName ?? 'Someone else';

  function reloadAndDiscard() {
    dismissConflict();
    window.location.reload();
  }

  async function copyAndDismiss() {
    try {
      await navigator.clipboard.writeText(activeConflict.localDiffJson);
      dismissConflict();
    } catch {
      setCopyError('Could not copy automatically. Check this browser’s clipboard permission and try again.');
    }
  }

  return (
    <div
      role="alertdialog"
      aria-label="Save conflict"
      className="fixed left-1/2 top-12 z-[60] w-[640px] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border border-red-700/80 bg-zinc-950 p-4 shadow-2xl shadow-black/60"
    >
      <div className="flex gap-3">
        <svg
          className="mt-0.5 h-5 w-5 shrink-0 text-red-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M12 9v4m0 4h.01M10.3 3.6 2.2 18a2 2 0 0 0 1.8 3h16a2 2 0 0 0 1.8-3L13.7 3.6a2 2 0 0 0-3.4 0Z" />
        </svg>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-zinc-100">Your change was not saved</h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-300">
            {displayName} changed the harness while you were editing. Your last change wasn&apos;t saved.
          </p>
          {copyError && <p role="alert" className="mt-2 text-xs text-red-300">{copyError}</p>}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => void copyAndDismiss()}
              className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:bg-zinc-700"
            >
              Copy my change to clipboard
            </button>
            <button
              type="button"
              onClick={reloadAndDiscard}
              className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500"
            >
              Reload and discard my change
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
