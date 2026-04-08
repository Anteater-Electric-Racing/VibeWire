import { useState } from 'react';
import { useHarnessStore } from '../../store';

export function Topbar() {
  const isDirty = useHarnessStore((s) => s.isDirty);
  const harness = useHarnessStore((s) => s.harness);
  const nodeLayouts = useHarnessStore((s) => s.nodeLayouts);
  const portLayouts = useHarnessStore((s) => s.portLayouts);
  const sizeLayouts = useHarnessStore((s) => s.sizeLayouts);
  const freePortLayouts = useHarnessStore((s) => s.freePortLayouts);
  const backgroundLayouts = useHarnessStore((s) => s.backgroundLayouts);
  const connectorTypeSizes = useHarnessStore((s) => s.connectorTypeSizes);
  const connectorLibrary = useHarnessStore((s) => s.connectorLibrary);
  const markClean = useHarnessStore((s) => s.markClean);
  const setSettingsOpen = useHarnessStore((s) => s.setSettingsOpen);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const handleSave = async () => {
    if (!harness || saveState === 'saving') return;
    const harnessJson = JSON.stringify(harness, null, 2);
    const layoutsJson = JSON.stringify(
      { nodes: nodeLayouts, ports: portLayouts, sizes: sizeLayouts, free: freePortLayouts, backgrounds: backgroundLayouts, connectorTypeSizes },
      null,
      2,
    );
    const libraryJson = connectorLibrary ? JSON.stringify(connectorLibrary, null, 2) : null;
    setSaveState('saving');

    try {
      const saves: Promise<Response>[] = [
        fetch('/api/save-harness', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: harnessJson }),
        fetch('/api/save-layouts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: layoutsJson }),
      ];
      if (libraryJson) {
        saves.push(fetch('/api/save-library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: libraryJson }));
      }
      const results = await Promise.all(saves);
      if (results.every((r) => r.ok)) {
        markClean();
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 2000);
        return;
      }
    } catch {
      // dev server not available
    }

    // Fallback for production builds: download the harness file.
    const blob = new Blob([harnessJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fsae-car.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    markClean();
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 2000);
  };

  return (
    <header className="h-10 bg-zinc-900 border-b border-zinc-700 flex items-center px-3 gap-3 shrink-0">
      <div className="flex items-center gap-2">
        <svg
          className="w-5 h-5 text-amber-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
        <span className="text-sm font-semibold text-zinc-100 tracking-wide">
          VibeWire
        </span>
      </div>

      <div className="flex-1" />

      <button
        onClick={handleSave}
        disabled={saveState === 'saving'}
        className={`relative px-2 py-1 text-xs rounded border transition-colors ${
          saveState === 'saved'
            ? 'bg-green-900/60 text-green-300 border-green-700'
            : saveState === 'saving'
            ? 'bg-zinc-800 text-zinc-500 border-zinc-700 cursor-wait'
            : 'bg-zinc-800 text-zinc-300 border-zinc-600 hover:bg-zinc-700 hover:text-zinc-100'
        }`}
        title={isDirty ? 'Unsaved changes — click to save' : 'Save'}
      >
        {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : 'Save'}
        {isDirty && saveState === 'idle' && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-500 rounded-full" />
        )}
      </button>

      <button
        onClick={() => setSettingsOpen(true)}
        className="p-1 text-zinc-400 hover:text-zinc-100 transition-colors"
        title="Settings"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </header>
  );
}
