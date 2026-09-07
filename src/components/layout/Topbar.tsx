import { useEffect, useMemo, useRef, useState } from 'react';
import { useSystemStore } from '../../store';
import {
  deriveManufacturingBundles,
  deriveManufacturingHarnesses,
} from '../../lib/manufacturing';
import { CollaborationControls } from '../collab/CollaborationControls';
import { UndoStalenessChip } from '../collab/UndoStalenessChip';
import { PresenceStack } from '../collab/PresenceBadge';
import {
  ENTER_SUBSYSTEM_EVENT,
  OPEN_MANUFACTURING_PICKER_EVENT,
  OPEN_SUBSYSTEM_PICKER_EVENT,
} from '../../lib/topbarEvents';

function requestUndoWithWarning() {
  window.dispatchEvent(new CustomEvent('vibewire:request-undo'));
}

const MANUFACTURING_TABS = [
  { id: 'cutlists' as const, label: 'Build' },
  { id: 'progress' as const, label: 'Progress' },
  { id: 'bom' as const, label: 'BOM' },
];

function formatSystemName(name: string) {
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

function systemDisplayName(
  item: { id: string; name: string },
  activeId: string,
  activeName: string | undefined,
) {
  if (item.id === activeId && activeName) return activeName;
  if (item.name && item.name !== item.id) return item.name;
  return formatSystemName(item.id);
}

function PickerRow({
  index,
  label,
  selected,
  renameTitle,
  canRename,
  onSelect,
  onRename,
}: {
  index: number;
  label: string;
  selected: boolean;
  renameTitle: string;
  canRename: boolean;
  onSelect: () => void;
  onRename: () => void;
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      className={`flex w-full items-center gap-1 px-1.5 py-0.5 text-xs ${
        selected ? 'bg-amber-950/40 text-amber-200' : 'text-zinc-300'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className={`flex min-w-0 flex-1 items-center gap-2 px-1 py-1 text-left transition-colors rounded ${
          selected ? 'hover:bg-amber-950/30' : 'hover:bg-zinc-800 hover:text-zinc-100'
        }`}
      >
        <span className="w-3 shrink-0 text-[10px] text-zinc-600 tabular-nums">
          {index < 9 ? index + 1 : ''}
        </span>
        <span className="truncate">{label}</span>
      </button>
      <button
        type="button"
        disabled={!canRename}
        onClick={(event) => {
          event.stopPropagation();
          onRename();
        }}
        className="flex h-5 w-5 shrink-0 items-center justify-center text-sm leading-none text-zinc-500 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-zinc-500"
        title={renameTitle}
      >
        ✎
      </button>
    </div>
  );
}

function PickerAddRow({
  disabled,
  title,
  onClick,
}: {
  disabled: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <div className="mt-1 border-t border-zinc-800 pt-1">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
        title={title}
      >
        <span className="w-3 shrink-0 text-center text-sm leading-none">＋</span>
        <span>New</span>
      </button>
    </div>
  );
}

export function Topbar() {
  const setSettingsOpen = useSystemStore((s) => s.setSettingsOpen);
  const system = useSystemStore((s) => s.system);
  const redo = useSystemStore((s) => s.redo);
  const undoStack = useSystemStore((s) => s.undoStack);
  const redoStack = useSystemStore((s) => s.redoStack);
  const activeSystemName = useSystemStore((s) => s.activeSystemName);
  const availableSystems = useSystemStore((s) => s.availableSystems);
  const setActiveSystemName = useSystemStore((s) => s.setActiveSystemName);
  const setAvailableSystems = useSystemStore((s) => s.setAvailableSystems);
  const renameSystem = useSystemStore((s) => s.renameSystem);
  const appView = useSystemStore((s) => s.appView);
  const openConnectorLibrary = useSystemStore((s) => s.openConnectorLibrary);
  const openSignalLibrary = useSystemStore((s) => s.openSignalLibrary);
  const openManufacturing = useSystemStore((s) => s.openManufacturing);
  const manufacturingTab = useSystemStore((s) => s.manufacturingTab);
  const setManufacturingTab = useSystemStore((s) => s.setManufacturingTab);
  const manufacturingTargetBundleId = useSystemStore((s) => s.manufacturingTargetBundleId);
  const setManufacturingTargetBundle = useSystemStore((s) => s.setManufacturingTargetBundle);
  const manufacturing = useSystemStore((s) => s.manufacturing);
  const connectorLibrary = useSystemStore((s) => s.connectorLibrary);
  const closeConnectorLibrary = useSystemStore((s) => s.closeConnectorLibrary);
  const editingSurface = useSystemStore((s) => s.editingSurface);
  const setEditingSurface = useSystemStore((s) => s.setEditingSurface);
  const subsystems = useSystemStore((s) => s.subsystems);
  const activeSubsystemId = useSystemStore((s) => s.activeSubsystemId);
  const setActiveSubsystem = useSystemStore((s) => s.setActiveSubsystem);
  const upsertSubsystem = useSystemStore((s) => s.upsertSubsystem);
  const renameSubsystem = useSystemStore((s) => s.renameSubsystem);
  const setMutationError = useSystemStore((s) => s.setMutationError);
  const isEditor = useSystemStore((s) => s.session.isEditor);

  async function handleNewSystem() {
    if (!isEditor) return;
    const input = prompt('New system name (e.g. car #2, or megazott 2026):');
    if (!input) return;
    const slug = slugify(input);
    if (!slug) {
      setMutationError('System name must contain at least one letter or number.');
      return;
    }
    setSystemMenuOpen(false);
    setMutationError(null);
    if (availableSystems.some((item) => item.id === slug)) {
      if (!(await setActiveSystemName(slug))) {
        setMutationError('Save the current system before switching projects.');
      }
      return;
    }

    const template = {
      schema_version: '0.1.0',
      name: input.trim(),
      enclosures: [],
      connectors: [],
      branchPoints: [],
      paths: [],
      signals: [],
      signalPropertyDefinitions: [],
    };

    try {
      const response = await fetch(`/api/system?system=${encodeURIComponent(slug)}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template, null, 2),
      });
      if (!response.ok) {
        const result = await response.json()
          .catch(() => null) as { error?: string } | null;
        throw new Error(result?.error ?? `System creation failed (${response.status}).`);
      }

      const next = [...availableSystems, { id: slug, name: input.trim() }]
        .sort((left, right) => left.id.localeCompare(right.id));
      setAvailableSystems(next);
      if (!(await setActiveSystemName(slug))) {
        throw new Error(
          `Created "${input.trim()}", but could not switch because the current system has unsaved changes.`,
        );
      }
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'System creation failed.');
    }
  }

  async function handleRenameSystem(systemKey: string) {
    if (!isEditor) return;
    const item = availableSystems.find((entry) => entry.id === systemKey);
    const currentName = systemKey === activeSystemName
      ? (system?.name ?? formatSystemName(systemKey))
      : systemDisplayName(
        item ?? { id: systemKey, name: systemKey },
        activeSystemName,
        system?.name,
      );
    const input = prompt(
      `Rename system display name.\n\nIts stable storage key will remain "${systemKey}".`,
      currentName,
    );
    if (input === null || !input.trim()) return;

    if (systemKey === activeSystemName) {
      renameSystem(input);
      return;
    }

    try {
      const response = await fetch(`/api/system?system=${encodeURIComponent(systemKey)}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`Failed to load system "${systemKey}".`);
      const document = await response.json() as { name?: string; schema_version?: string };
      document.name = input.trim();
      const save = await fetch(`/api/system?system=${encodeURIComponent(systemKey)}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(document, null, 2),
      });
      if (!save.ok) {
        const result = await save.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error ?? `Failed to rename system "${systemKey}".`);
      }
      setAvailableSystems(
        availableSystems.map((entry) => (
          entry.id === systemKey ? { ...entry, name: input.trim() } : entry
        )),
      );
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'System rename failed.');
    }
  }

  async function handleNewSubsystem() {
    if (!isEditor) return;
    const input = prompt('Subsystem name (e.g. "Cooling" or "CAN"):');
    if (!input) return;
    setSubsystemMenuOpen(false);
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
    const response = await fetch(`/api/subsystems/${encodeURIComponent(id)}?system=${encodeURIComponent(activeSystemName)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(document),
    });
    if (response.ok) {
      upsertSubsystem(await response.json());
      setEditingSurface('subsystem');
    }
  }

  function handleRenameSubsystem(subsystemId: string) {
    if (!isEditor) return;
    const subsystem = subsystems[subsystemId];
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

  const subsystemList = useMemo(
    () => Object.values(subsystems).sort((a, b) => a.name.localeCompare(b.name)),
    [subsystems],
  );
  const activeSubsystem = activeSubsystemId ? subsystems[activeSubsystemId] : null;
  const [subsystemMenuOpen, setSubsystemMenuOpen] = useState(false);
  const subsystemPickerRef = useRef<HTMLDivElement>(null);
  const subsystemListRef = useRef(subsystemList);
  subsystemListRef.current = subsystemList;
  const isEditorRef = useRef(isEditor);
  isEditorRef.current = isEditor;
  const handleNewSubsystemRef = useRef(handleNewSubsystem);
  handleNewSubsystemRef.current = handleNewSubsystem;

  const systemList = useMemo(() => {
    if (availableSystems.length > 0) {
      return [...availableSystems].sort((a, b) => a.id.localeCompare(b.id));
    }
    if (!activeSystemName) return [];
    return [{ id: activeSystemName, name: system?.name ?? activeSystemName }];
  }, [availableSystems, activeSystemName, system?.name]);
  const [systemMenuOpen, setSystemMenuOpen] = useState(false);
  const systemPickerRef = useRef<HTMLDivElement>(null);
  const systemListRef = useRef(systemList);
  systemListRef.current = systemList;
  const activeSystemLabel = system?.name
    ?? systemDisplayName(
      { id: activeSystemName, name: activeSystemName },
      activeSystemName,
      system?.name,
    );

  function promptCreateSubsystemIfEmpty() {
    if (subsystemListRef.current.length > 0) return;
    if (isEditorRef.current) {
      void handleNewSubsystemRef.current();
      return;
    }
    setSystemMenuOpen(false);
    setSubsystemMenuOpen(true);
  }

  function enterSubsystemSurface() {
    showCanvasSurface('subsystem');
    promptCreateSubsystemIfEmpty();
  }

  function openSubsystemMenu() {
    setSystemMenuOpen(false);
    showCanvasSurface('subsystem');
    setSubsystemMenuOpen(true);
  }

  function selectSubsystemAtIndex(index: number) {
    const subsystem = subsystemListRef.current[index];
    if (!subsystem) return false;
    showCanvasSurface('subsystem');
    setActiveSubsystem(subsystem.id);
    setSubsystemMenuOpen(false);
    return true;
  }

  function openSystemMenu() {
    setSubsystemMenuOpen(false);
    setManufacturingMenuOpen(false);
    setSystemMenuOpen(true);
  }

  function selectSystemAtIndex(index: number) {
    const item = systemListRef.current[index];
    if (!item) return false;
    setSystemMenuOpen(false);
    if (item.id !== activeSystemName) {
      void setActiveSystemName(item.id);
    }
    return true;
  }

  useEffect(() => {
    function onEnterEvent() {
      closeConnectorLibrary();
      setEditingSurface('subsystem');
      if (subsystemListRef.current.length === 0) {
        if (isEditorRef.current) {
          void handleNewSubsystemRef.current();
        } else {
          setSystemMenuOpen(false);
          setSubsystemMenuOpen(true);
        }
      }
    }
    function onOpenEvent() {
      closeConnectorLibrary();
      setEditingSurface('subsystem');
      setSystemMenuOpen(false);
      if (subsystemListRef.current.length === 0 && isEditorRef.current) {
        void handleNewSubsystemRef.current();
        return;
      }
      setSubsystemMenuOpen(true);
    }
    window.addEventListener(ENTER_SUBSYSTEM_EVENT, onEnterEvent);
    window.addEventListener(OPEN_SUBSYSTEM_PICKER_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener(ENTER_SUBSYSTEM_EVENT, onEnterEvent);
      window.removeEventListener(OPEN_SUBSYSTEM_PICKER_EVENT, onOpenEvent);
    };
  }, [closeConnectorLibrary, setEditingSurface]);

  useEffect(() => {
    if (!subsystemMenuOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (!subsystemPickerRef.current?.contains(event.target as Node)) {
        setSubsystemMenuOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.isContentEditable;
      if (isTyping) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setSubsystemMenuOpen(false);
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const index = Number(event.key) - 1;
      if (index < 0 || index > 8) return;
      const subsystem = subsystemListRef.current[index];
      if (!subsystem) return;
      closeConnectorLibrary();
      setEditingSurface('subsystem');
      setActiveSubsystem(subsystem.id);
      setSubsystemMenuOpen(false);
      event.preventDefault();
      event.stopPropagation();
    }

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [subsystemMenuOpen, closeConnectorLibrary, setEditingSurface, setActiveSubsystem]);

  useEffect(() => {
    if (!systemMenuOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (!systemPickerRef.current?.contains(event.target as Node)) {
        setSystemMenuOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.isContentEditable;
      if (isTyping) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setSystemMenuOpen(false);
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const index = Number(event.key) - 1;
      if (index < 0 || index > 8) return;
      const item = systemListRef.current[index];
      if (!item) return;
      setSystemMenuOpen(false);
      if (item.id !== activeSystemName) {
        void setActiveSystemName(item.id);
      }
      event.preventDefault();
      event.stopPropagation();
    }

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [systemMenuOpen, setActiveSystemName, activeSystemName]);

  const [manufacturingMenuOpen, setManufacturingMenuOpen] = useState(false);
  const manufacturingPickerRef = useRef<HTMLDivElement>(null);
  const activeManufacturingTab = MANUFACTURING_TABS.find((tab) => tab.id === manufacturingTab)
    ?? MANUFACTURING_TABS[0];
  const manufacturingHarnessList = useMemo(() => {
    if (!system) return [];
    return deriveManufacturingHarnesses(
      deriveManufacturingBundles(system, connectorLibrary, manufacturing),
    );
  }, [system, connectorLibrary, manufacturing]);
  const manufacturingHarnessListRef = useRef(manufacturingHarnessList);
  manufacturingHarnessListRef.current = manufacturingHarnessList;
  const selectedManufacturingHarness = manufacturingHarnessList.find(
    (item) => item.bundleIds.includes(manufacturingTargetBundleId ?? '')
      || item.trunkBundleId === manufacturingTargetBundleId
      || item.id === manufacturingTargetBundleId,
  ) ?? null;

  function openManufacturingMenu() {
    setSubsystemMenuOpen(false);
    setSystemMenuOpen(false);
    openManufacturing();
    setManufacturingMenuOpen(true);
  }

  function selectManufacturingHarnessAtIndex(index: number) {
    const item = manufacturingHarnessListRef.current[index];
    if (!item) return false;
    openManufacturing();
    setManufacturingTargetBundle(item.trunkBundleId);
    setManufacturingTab('cutlists');
    setManufacturingMenuOpen(false);
    return true;
  }

  useEffect(() => {
    function onOpenEvent() {
      setSubsystemMenuOpen(false);
      setSystemMenuOpen(false);
      openManufacturing();
      setManufacturingMenuOpen(true);
    }
    window.addEventListener(OPEN_MANUFACTURING_PICKER_EVENT, onOpenEvent);
    return () => window.removeEventListener(OPEN_MANUFACTURING_PICKER_EVENT, onOpenEvent);
  }, [openManufacturing]);

  useEffect(() => {
    if (!manufacturingMenuOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (!manufacturingPickerRef.current?.contains(event.target as Node)) {
        setManufacturingMenuOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.isContentEditable;
      if (isTyping) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setManufacturingMenuOpen(false);
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const index = Number(event.key) - 1;
      if (index < 0 || index > 8) return;
      const item = manufacturingHarnessListRef.current[index];
      if (!item) return;
      openManufacturing();
      setManufacturingTargetBundle(item.trunkBundleId);
      setManufacturingTab('cutlists');
      setManufacturingMenuOpen(false);
      event.preventDefault();
      event.stopPropagation();
    }

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [manufacturingMenuOpen, openManufacturing, setManufacturingTargetBundle, setManufacturingTab]);

  // Close the other pickers when one opens; leave manufacturing menu when leaving the view.
  useEffect(() => {
    if (subsystemMenuOpen) {
      setManufacturingMenuOpen(false);
      setSystemMenuOpen(false);
    }
  }, [subsystemMenuOpen]);
  useEffect(() => {
    if (manufacturingMenuOpen) {
      setSubsystemMenuOpen(false);
      setSystemMenuOpen(false);
    }
  }, [manufacturingMenuOpen]);
  useEffect(() => {
    if (systemMenuOpen) {
      setSubsystemMenuOpen(false);
      setManufacturingMenuOpen(false);
    }
  }, [systemMenuOpen]);
  useEffect(() => {
    if (appView !== 'manufacturing') setManufacturingMenuOpen(false);
  }, [appView]);

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
            className="flex items-center rounded border border-zinc-700"
            role="group"
            aria-label="Project pages"
          >
            <button
              type="button"
              onClick={() => showCanvasSurface('hierarchy')}
              aria-pressed={appView === 'canvas' && editingSurface === 'hierarchy'}
              className={`px-2 py-0.5 text-xs transition-colors rounded-l-[3px] ${
                appView === 'canvas' && editingSurface === 'hierarchy'
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              System
            </button>
            <div ref={subsystemPickerRef} className="relative border-l border-zinc-700">
              <button
                type="button"
                onClick={() => {
                  if (subsystemMenuOpen) {
                    setSubsystemMenuOpen(false);
                    return;
                  }
                  if (appView === 'canvas' && editingSurface === 'subsystem') {
                    if (subsystemList.length === 0 && isEditor) {
                      void handleNewSubsystem();
                      return;
                    }
                    openSubsystemMenu();
                  } else {
                    enterSubsystemSurface();
                  }
                }}
                aria-haspopup="listbox"
                aria-expanded={subsystemMenuOpen}
                aria-pressed={appView === 'canvas' && editingSurface === 'subsystem'}
                title="Subsystem (2), again to pick"
                className={`flex items-center gap-1 px-2 py-0.5 text-xs transition-colors max-w-[160px] ${
                  subsystemMenuOpen || (appView === 'canvas' && editingSurface === 'subsystem')
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span className="truncate">
                  {appView === 'canvas' && editingSurface === 'subsystem' && activeSubsystem
                    ? activeSubsystem.name
                    : 'Subsystem'}
                </span>
                <svg width="8" height="8" viewBox="0 0 8 8" className="shrink-0 opacity-70">
                  <path d="M1.5 2.5 L4 5.5 L6.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {subsystemMenuOpen && (
                <div
                  role="listbox"
                  aria-label="Subsystems"
                  className="absolute left-0 top-full z-50 mt-1 min-w-[180px] max-h-64 overflow-y-auto rounded border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
                >
                  {subsystemList.length === 0 ? (
                    <div className="px-2.5 py-2 text-[11px] text-zinc-500">No subsystems yet</div>
                  ) : (
                    subsystemList.map((subsystem, index) => (
                      <PickerRow
                        key={subsystem.id}
                        index={index}
                        label={subsystem.name}
                        selected={subsystem.id === activeSubsystemId}
                        canRename={isEditor}
                        renameTitle={isEditor
                          ? `Rename "${subsystem.name}" (stable ID is preserved)`
                          : 'Log in to rename this subsystem'}
                        onSelect={() => selectSubsystemAtIndex(index)}
                        onRename={() => handleRenameSubsystem(subsystem.id)}
                      />
                    ))
                  )}
                  <PickerAddRow
                    disabled={!isEditor}
                    title={isEditor ? 'New subsystem' : 'Log in to create a subsystem'}
                    onClick={() => {
                      void handleNewSubsystem();
                    }}
                  />
                </div>
              )}
            </div>
            <div ref={manufacturingPickerRef} className="relative border-l border-zinc-700">
              <button
                type="button"
                onClick={() => {
                  if (manufacturingMenuOpen) {
                    setManufacturingMenuOpen(false);
                    return;
                  }
                  if (appView === 'manufacturing') {
                    openManufacturingMenu();
                  } else {
                    openManufacturing();
                  }
                }}
                aria-haspopup="listbox"
                aria-expanded={manufacturingMenuOpen}
                aria-pressed={appView === 'manufacturing'}
                title="Manufacturing (3), again to pick system / tab"
                className={`flex items-center gap-1 px-2 py-0.5 text-xs transition-colors max-w-[160px] rounded-r-[3px] ${
                  manufacturingMenuOpen || appView === 'manufacturing'
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span className="truncate">
                  {appView === 'manufacturing'
                    ? (selectedManufacturingHarness?.name ?? activeManufacturingTab.label)
                    : 'Manufacturing'}
                </span>
                <svg width="8" height="8" viewBox="0 0 8 8" className="shrink-0 opacity-70">
                  <path d="M1.5 2.5 L4 5.5 L6.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {manufacturingMenuOpen && (
                <div
                  className="absolute left-0 top-full z-50 mt-1 min-w-[200px] max-h-72 overflow-y-auto rounded border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
                >
                  <div className="flex items-center gap-0.5 px-1.5 pb-1.5 mb-1 border-b border-zinc-800">
                    {MANUFACTURING_TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          openManufacturing();
                          setManufacturingTab(tab.id);
                        }}
                        className={`flex-1 px-1.5 py-1 text-[10px] rounded transition-colors ${
                          tab.id === manufacturingTab
                            ? 'bg-zinc-700 text-zinc-100'
                            : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <div role="listbox" aria-label="Manufacturing harnesses">
                    {manufacturingHarnessList.length === 0 ? (
                      <div className="px-2.5 py-2 text-[11px] text-zinc-500">No harnesses yet</div>
                    ) : (
                      manufacturingHarnessList.map((item, index) => (
                        <button
                          key={item.id}
                          type="button"
                          role="option"
                          aria-selected={item.id === selectedManufacturingHarness?.id}
                          onClick={() => selectManufacturingHarnessAtIndex(index)}
                          className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors ${
                            item.id === selectedManufacturingHarness?.id
                              ? 'bg-amber-950/40 text-amber-200'
                              : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
                          }`}
                        >
                          <span className="w-3 shrink-0 text-[10px] text-zinc-600 tabular-nums">
                            {index < 9 ? index + 1 : ''}
                          </span>
                          <span className="truncate">{item.name}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
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

      {/* System / system switcher */}
      <div ref={systemPickerRef} className="relative flex items-center gap-1">
        <svg className="w-3.5 h-3.5 text-zinc-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
        <button
          type="button"
          onClick={() => {
            if (systemMenuOpen) {
              setSystemMenuOpen(false);
              return;
            }
            openSystemMenu();
          }}
          aria-haspopup="listbox"
          aria-expanded={systemMenuOpen}
          title="Switch system"
          className={`flex items-center gap-1 max-w-[180px] rounded border px-2 py-0.5 text-xs transition-colors ${
            systemMenuOpen
              ? 'border-amber-500 bg-zinc-800 text-zinc-100'
              : 'border-zinc-700 bg-zinc-800 text-zinc-100 hover:border-zinc-500'
          }`}
        >
          <span className="truncate">{activeSystemLabel}</span>
          <svg width="8" height="8" viewBox="0 0 8 8" className="shrink-0 opacity-70">
            <path d="M1.5 2.5 L4 5.5 L6.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {systemMenuOpen && (
          <div
            role="listbox"
            aria-label="Systems"
            className="absolute left-5 top-full z-50 mt-1 min-w-[200px] max-h-64 overflow-y-auto rounded border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
          >
            {systemList.length === 0 ? (
              <div className="px-2.5 py-2 text-[11px] text-zinc-500">No systems yet</div>
            ) : (
              systemList.map((item, index) => {
                const label = systemDisplayName(item, activeSystemName, system?.name);
                return (
                  <PickerRow
                    key={item.id}
                    index={index}
                    label={label}
                    selected={item.id === activeSystemName}
                    canRename={isEditor}
                    renameTitle={isEditor
                      ? `Rename "${label}" (storage key stays "${item.id}")`
                      : 'Log in to rename the system'}
                    onSelect={() => selectSystemAtIndex(index)}
                    onRename={() => {
                      void handleRenameSystem(item.id);
                    }}
                  />
                );
              })
            )}
            <PickerAddRow
              disabled={!isEditor}
              title={isEditor ? 'New system' : 'Log in to create a system'}
              onClick={() => {
                void handleNewSystem();
              }}
            />
          </div>
        )}
      </div>

      <div className="flex-1" />

      <PresenceStack />

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

      <CollaborationControls system={activeSystemName} />

      <button
        onClick={() => setSettingsOpen(true)}
        className="px-1.5 py-1 text-[11px] font-medium text-zinc-400 hover:text-zinc-100 transition-colors"
        title="Tips & settings"
        aria-label="Tips & settings"
      >
        Tips
      </button>
    </header>
  );
}
