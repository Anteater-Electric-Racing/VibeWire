import { useHarnessStore } from '../../store';
import { CollaborationControls } from '../collab/CollaborationControls';
import { UndoStalenessChip } from '../collab/UndoStalenessChip';

function requestUndoWithWarning() {
  window.dispatchEvent(new CustomEvent('vibewire:request-undo'));
}

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
  const openSignalLibrary = useHarnessStore((s) => s.openSignalLibrary);
  const openManufacturing = useHarnessStore((s) => s.openManufacturing);
  const closeConnectorLibrary = useHarnessStore((s) => s.closeConnectorLibrary);
  const editingSurface = useHarnessStore((s) => s.editingSurface);
  const setEditingSurface = useHarnessStore((s) => s.setEditingSurface);
  const subsystems = useHarnessStore((s) => s.subsystems);
  const activeSubsystemId = useHarnessStore((s) => s.activeSubsystemId);
  const setActiveSubsystem = useHarnessStore((s) => s.setActiveSubsystem);
  const upsertSubsystem = useHarnessStore((s) => s.upsertSubsystem);
  const renameSubsystem = useHarnessStore((s) => s.renameSubsystem);
  const setMutationError = useHarnessStore((s) => s.setMutationError);
  const isEditor = useHarnessStore((s) => s.session.isEditor);

  async function handleNewHarness() {
    if (!isEditor) return;
    const input = prompt('New harness name (e.g. "Tractive System" or "lvs-harness"):');
    if (!input) return;
    const slug = slugify(input);
    if (!slug) {
      setMutationError('Harness name must contain at least one letter or number.');
      return;
    }
    setMutationError(null);
    if (availableHarnesses.includes(slug)) {
      if (!(await setActiveHarnessName(slug))) {
        setMutationError('Save the current harness before switching projects.');
      }
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
      signalPropertyDefinitions: [],
    };

    try {
      const response = await fetch(`/api/harness?harness=${encodeURIComponent(slug)}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template, null, 2),
      });
      if (!response.ok) {
        const result = await response.json()
          .catch(() => null) as { error?: string } | null;
        throw new Error(result?.error ?? `Harness creation failed (${response.status}).`);
      }

      setAvailableHarnesses([...new Set([...availableHarnesses, slug])].sort());
      if (!(await setActiveHarnessName(slug))) {
        throw new Error(
          `Created "${input.trim()}", but could not switch because the current harness has unsaved changes.`,
        );
      }
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Harness creation failed.');
    }
  }

  function handleRenameSystem() {
    if (!isEditor) return;
    const currentName = harness?.name ?? formatHarnessName(activeHarnessName);
    const input = prompt(
      `Rename system display name.\n\nIts stable storage key will remain "${activeHarnessName}".`,
      currentName,
    );
    if (input !== null && input.trim()) renameSystem(input);
  }

  async function handleNewSubsystem() {
    if (!isEditor) return;
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
    if (!isEditor || !activeSubsystemId) return;
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
      <img
        src="/vibewire-logo.png"
        alt="VibeWire"
        className="h-8 w-auto shrink-0"
      />

      <nav className="flex items-center gap-2" aria-label="Primary">
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
            Project
          </span>
          <div
            className="flex items-center overflow-hidden rounded border border-zinc-700"
            role="group"
            aria-label="Project pages"
          >
          <button
            type="button"
            onClick={() => showCanvasSurface('hierarchy')}
            aria-pressed={appView === 'canvas' && editingSurface === 'hierarchy'}
            className={`px-2 py-0.5 text-xs transition-colors ${
              appView === 'canvas' && editingSurface === 'hierarchy'
                ? 'bg-zinc-700 text-zinc-100'
                : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            System
          </button>
            <button
              type="button"
              onClick={() => showCanvasSurface('subsystem')}
              aria-pressed={appView === 'canvas' && editingSurface === 'subsystem'}
              className={`px-2 py-0.5 text-xs transition-colors ${
                appView === 'canvas' && editingSurface === 'subsystem'
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Subsystem
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
        </div>

        <div className="h-5 w-px bg-zinc-800" />

        <div className="flex items-center gap-1.5">
          <span className="text-[8px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
            Core setup
          </span>
          <div
            className="flex items-center overflow-hidden rounded border border-zinc-700"
            role="group"
            aria-label="Core setup pages"
          >
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
              onClick={() => openSignalLibrary()}
              aria-pressed={appView === 'signalLibrary'}
              className={`px-2 py-0.5 text-xs transition-colors ${
                appView === 'signalLibrary'
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Signals
            </button>
          </div>
        </div>
      </nav>

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
          <button
            onClick={handleNewSubsystem}
            disabled={!isEditor}
            className="text-zinc-500 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-zinc-500"
            title={isEditor ? 'New subsystem' : 'Log in to create a subsystem'}
          >
            ＋
          </button>
          <button
            onClick={handleRenameSubsystem}
            disabled={!isEditor || !activeSubsystemId}
            className="text-zinc-500 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-30"
            title={isEditor ? 'Rename selected subsystem (stable ID is preserved)' : 'Log in to rename the subsystem'}
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
          disabled={!isEditor}
          className="p-0.5 text-zinc-500 hover:text-amber-400 transition-colors disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-zinc-500"
          title={isEditor ? `Rename system display name (storage key stays "${activeHarnessName}")` : 'Log in to rename the system'}
        >
          ✎
        </button>
        <button
          onClick={handleNewHarness}
          disabled={!isEditor}
          className="p-0.5 text-zinc-500 hover:text-amber-400 transition-colors disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-zinc-500"
          title={isEditor ? 'New harness' : 'Log in to create a harness'}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      <div className="flex-1" />

      {/* Undo / Redo */}
      <div className="flex items-center gap-0.5">
        <UndoStalenessChip />
        <button
          onClick={requestUndoWithWarning}
          disabled={!isEditor || undoStack.length === 0}
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
          disabled={!isEditor || redoStack.length === 0}
          className="p-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          title="Redo (⌘⇧Z)"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 7v6h-6" />
            <path d="M21 13C19 7 12 4 6 7S0 19 6 22" />
          </svg>
        </button>
      </div>

      <CollaborationControls harness={activeHarnessName} />

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
