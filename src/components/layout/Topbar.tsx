import { useHarnessStore } from '../../store';

function formatHarnessName(name: string) {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function Topbar() {
  const setSettingsOpen = useHarnessStore((s) => s.setSettingsOpen);
  const harness = useHarnessStore((s) => s.harness);
  const undo = useHarnessStore((s) => s.undo);
  const redo = useHarnessStore((s) => s.redo);
  const undoStack = useHarnessStore((s) => s.undoStack);
  const redoStack = useHarnessStore((s) => s.redoStack);
  const activeHarnessName = useHarnessStore((s) => s.activeHarnessName);
  const availableHarnesses = useHarnessStore((s) => s.availableHarnesses);
  const setActiveHarnessName = useHarnessStore((s) => s.setActiveHarnessName);
  const setAvailableHarnesses = useHarnessStore((s) => s.setAvailableHarnesses);
  const renameSystem = useHarnessStore((s) => s.renameSystem);
  const appView = useHarnessStore((s) => s.appView);
  const openConnectorLibrary = useHarnessStore((s) => s.openConnectorLibrary);
  const openManufacturing = useHarnessStore((s) => s.openManufacturing);
  const closeConnectorLibrary = useHarnessStore((s) => s.closeConnectorLibrary);
  const editingSurface = useHarnessStore((s) => s.editingSurface);
  const setEditingSurface = useHarnessStore((s) => s.setEditingSurface);
  const subsystems = useHarnessStore((s) => s.subsystems);
  const activeSubsystemId = useHarnessStore((s) => s.activeSubsystemId);
  const setActiveSubsystem = useHarnessStore((s) => s.setActiveSubsystem);
  const upsertSubsystem = useHarnessStore((s) => s.upsertSubsystem);
  const renameSubsystem = useHarnessStore((s) => s.renameSubsystem);

  async function handleNewHarness() {
    const input = prompt('New harness name (e.g. "Tractive System" or "lvs-harness"):');
    if (!input) return;
    const slug = slugify(input);
    if (!slug) return;
    if (availableHarnesses.includes(slug)) {
      setActiveHarnessName(slug);
      return;
    }

    const template = {
      schema_version: '0.1.0',
      name: input.trim(),
      enclosures: [],
      connectors: [],
      mergePoints: [],
      paths: [],
      signals: [],
    };

    const res = await fetch(`/api/harness?harness=${encodeURIComponent(slug)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(template, null, 2),
    });

    if (res.ok) {
      const harnesses = await fetch('/api/harnesses')
        .then((r) => r.json() as Promise<string[]>)
        .catch(() => [...availableHarnesses, slug]);
      setAvailableHarnesses(harnesses);
      setActiveHarnessName(slug);
    }
  }

  function handleRenameSystem() {
    const currentName = harness?.name ?? formatHarnessName(activeHarnessName);
    const input = prompt(
      `Rename system display name.\n\nIts stable storage key will remain "${activeHarnessName}".`,
      currentName,
    );
    if (input !== null && input.trim()) renameSystem(input);
  }

  async function handleNewSubsystem() {
    const input = prompt('Subsystem name (e.g. "Cooling" or "CAN"):');
    if (!input) return;
    const id = slugify(input);
    if (!id) return;
    const document = {
      schema_version: '1.0.0' as const,
      id,
      name: input.trim(),
      tags: [`system:${id}`],
      enclosures: {},
      devices: {},
      connectors: {},
    };
    const response = await fetch(`/api/subsystems/${encodeURIComponent(id)}?harness=${encodeURIComponent(activeHarnessName)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(document),
    });
    if (response.ok) {
      upsertSubsystem(await response.json());
      setEditingSurface('subsystem');
    }
  }

  function handleRenameSubsystem() {
    if (!activeSubsystemId) return;
    const subsystem = subsystems[activeSubsystemId];
    if (!subsystem) return;
    const input = prompt(
      `Rename subsystem display name.\n\nIts stable ID will remain "${subsystem.id}".`,
      subsystem.name,
    );
    if (input !== null && input.trim()) renameSubsystem(subsystem.id, input);
  }

  function showCanvasSurface(surface: 'hierarchy' | 'subsystem') {
    closeConnectorLibrary();
    setEditingSurface(surface);
  }

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

      <div
        className="flex items-center rounded border border-zinc-700 overflow-hidden"
        role="group"
        aria-label="Canvas view"
      >
        {(['hierarchy', 'subsystem'] as const).map((surface) => (
          <button
            key={surface}
            type="button"
            onClick={() => showCanvasSurface(surface)}
            aria-pressed={appView === 'canvas' && editingSurface === surface}
            className={`px-2 py-0.5 text-xs capitalize transition-colors ${
              appView === 'canvas' && editingSurface === surface
                ? 'bg-zinc-700 text-zinc-100'
                : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {surface}
          </button>
        ))}
        <button
          type="button"
          onClick={() => openConnectorLibrary()}
          aria-pressed={appView === 'connectorLibrary'}
          className={`px-2 py-0.5 text-xs transition-colors ${
            appView === 'connectorLibrary'
              ? 'bg-zinc-700 text-zinc-100'
              : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Connectors
        </button>
        <button
          type="button"
          onClick={() => openManufacturing()}
          aria-pressed={appView === 'manufacturing'}
          className={`px-2 py-0.5 text-xs transition-colors ${
            appView === 'manufacturing'
              ? 'bg-zinc-700 text-zinc-100'
              : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Manufacturing
        </button>
      </div>

      {appView === 'canvas' && editingSurface === 'subsystem' && (
        <div className="flex items-center gap-1">
          <select
            value={activeSubsystemId ?? ''}
            onChange={(event) => setActiveSubsystem(event.target.value || null)}
            className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-100 rounded px-2 py-0.5 max-w-[140px]"
            title="Switch subsystem"
          >
            <option value="">Select subsystem</option>
            {Object.values(subsystems).map((subsystem) => (
              <option key={subsystem.id} value={subsystem.id}>{subsystem.name}</option>
            ))}
          </select>
          <button onClick={handleNewSubsystem} className="text-zinc-500 hover:text-amber-400" title="New subsystem">＋</button>
          <button
            onClick={handleRenameSubsystem}
            disabled={!activeSubsystemId}
            className="text-zinc-500 hover:text-amber-400 disabled:opacity-30"
            title="Rename selected subsystem (stable ID is preserved)"
          >
            ✎
          </button>
        </div>
      )}

      {/* Harness switcher */}
      <div className="flex items-center gap-1">
        <svg className="w-3.5 h-3.5 text-zinc-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
        <select
          value={activeHarnessName}
          onChange={(e) => setActiveHarnessName(e.target.value)}
          className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-100 rounded px-2 py-0.5 focus:outline-none focus:border-amber-500 cursor-pointer max-w-[160px]"
          title="Switch harness"
        >
          {availableHarnesses.length === 0
            ? <option value={activeHarnessName}>{harness?.name ?? formatHarnessName(activeHarnessName)}</option>
            : availableHarnesses.map((name) => (
              <option key={name} value={name}>
                {name === activeHarnessName && harness?.name ? harness.name : formatHarnessName(name)}
              </option>
            ))}
        </select>
        <button
          onClick={handleRenameSystem}
          className="p-0.5 text-zinc-500 hover:text-amber-400 transition-colors"
          title={`Rename system display name (storage key stays "${activeHarnessName}")`}
        >
          ✎
        </button>
        <button
          onClick={handleNewHarness}
          className="p-0.5 text-zinc-500 hover:text-amber-400 transition-colors"
          title="New harness"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      <div className="flex-1" />

      {/* Undo / Redo */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={undo}
          disabled={undoStack.length === 0}
          className="p-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          title="Undo (⌘Z)"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7v6h6" />
            <path d="M3 13C5 7 12 4 18 7s6 12 0 15" />
          </svg>
        </button>
        <button
          onClick={redo}
          disabled={redoStack.length === 0}
          className="p-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          title="Redo (⌘⇧Z)"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 7v6h-6" />
            <path d="M21 13C19 7 12 4 6 7S0 19 6 22" />
          </svg>
        </button>
      </div>

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
