import { useHarnessStore } from '../../store';

export function SettingsModal() {
  const isOpen = useHarnessStore((s) => s.settingsOpen);
  const setOpen = useHarnessStore((s) => s.setSettingsOpen);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-800 border border-zinc-600 rounded-lg shadow-xl w-96 max-w-[90vw]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
          <h2 className="text-sm font-semibold text-zinc-100">Settings</h2>
          <button
            onClick={() => setOpen(false)}
            className="text-zinc-400 hover:text-zinc-100"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Application
            </label>
            <p className="text-sm text-zinc-300">VibeWire v0.1.0</p>
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              User Data Folder
            </label>
            <p className="text-sm text-zinc-300 font-mono">
              public/user-data/
            </p>
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Schema Version
            </label>
            <p className="text-sm text-zinc-300">0.1.0</p>
          </div>
        </div>
        <div className="px-4 py-3 border-t border-zinc-700 flex justify-end">
          <button
            onClick={() => setOpen(false)}
            className="px-3 py-1.5 text-xs bg-zinc-700 text-zinc-200 rounded hover:bg-zinc-600 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
