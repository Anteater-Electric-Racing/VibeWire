import { useMemo, useState } from 'react';
import {
  getWireAppearance,
  getWireBackground,
  getWireBorderColor,
  getWireColorPresetHex,
  WIRE_COLOR_PRESETS,
} from '../../lib/colors';
import { getPathSignalId } from '../../lib/harness';
import { useHarnessStore } from '../../store';
import type { Signal, SignalPropertyDefinition } from '../../types';

const inputClass = 'w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none transition-colors focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-50';

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/60">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h3 className="text-xs font-semibold text-zinc-200">{title}</h3>
        {description && <p className="mt-0.5 text-[10px] text-zinc-500">{description}</p>}
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium text-zinc-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[9px] text-zinc-600">{hint}</span>}
    </label>
  );
}

function SignalSwatch({
  signal,
  className = 'h-3 w-3 rounded-sm',
}: {
  signal: Signal;
  className?: string;
}) {
  const appearance = getWireAppearance({
    tags: signal.tags,
    signal_id: signal.id,
    preferred_wire_color: signal.properties.preferred_wire_color,
  });
  return (
    <span
      className={`inline-block shrink-0 border ${className}`}
      style={{
        background: getWireBackground(appearance),
        borderColor: getWireBorderColor(appearance),
      }}
    />
  );
}

function NameField({
  signal,
  autoFocus = false,
  onAutoFocus,
}: {
  signal: Signal;
  autoFocus?: boolean;
  onAutoFocus?: () => void;
}) {
  const updateSignalName = useHarnessStore((state) => state.updateSignalName);

  return (
    <input
      autoFocus={autoFocus}
      defaultValue={signal.name}
      onFocus={(event) => {
        if (!autoFocus) return;
        event.currentTarget.select();
        onAutoFocus?.();
      }}
      onBlur={(event) => {
        const name = event.target.value.trim();
        if (!name) {
          event.target.value = signal.name;
          return;
        }
        if (name !== signal.name) updateSignalName(signal.id, name);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          event.currentTarget.value = signal.name;
          event.currentTarget.blur();
        }
      }}
      className={inputClass}
    />
  );
}

function TagsEditor({ signal }: { signal: Signal }) {
  const addTag = useHarnessStore((state) => state.addTag);
  const removeTag = useHarnessStore((state) => state.removeTag);
  const isEditor = useHarnessStore((state) => state.session.isEditor);
  const [draft, setDraft] = useState('');

  const addDraftTags = () => {
    const tags = draft
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    for (const tag of tags) addTag('signal', signal.id, tag);
    setDraft('');
  };

  return (
    <div>
      <div className="mb-2 flex min-h-6 flex-wrap gap-1">
        {signal.tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300"
          >
            {tag}
            <button
              type="button"
              disabled={!isEditor}
              onClick={() => removeTag('signal', signal.id, tag)}
              className="text-zinc-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
              title={`Remove ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        {signal.tags.length === 0 && (
          <span className="text-[10px] text-zinc-600">No tags yet</span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          disabled={!isEditor}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addDraftTags();
          }}
          placeholder="Add tags, separated by commas"
          className={inputClass}
        />
        <button
          type="button"
          disabled={!isEditor || !draft.trim()}
          onClick={addDraftTags}
          className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-3 text-xs text-zinc-300 hover:border-amber-700 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function PropertyEditor({
  signalId,
  propertyKey,
  value,
  existingKeys,
}: {
  signalId: string;
  propertyKey: string;
  value: string;
  existingKeys: string[];
}) {
  const updateSignalProperty = useHarnessStore((state) => state.updateSignalProperty);
  const setMutationError = useHarnessStore((state) => state.setMutationError);

  return (
    <div className="grid grid-cols-[minmax(140px,0.8fr)_minmax(180px,1.4fr)_auto] gap-2">
      <input
        defaultValue={propertyKey}
        onBlur={(event) => {
          const nextKey = event.target.value.trim();
          if (!nextKey) {
            event.target.value = propertyKey;
            return;
          }
          if (nextKey === propertyKey) return;
          if (existingKeys.includes(nextKey)) {
            event.target.value = propertyKey;
            setMutationError(`Signal property '${nextKey}' already exists.`);
            return;
          }
          updateSignalProperty(signalId, propertyKey, '');
          updateSignalProperty(signalId, nextKey, value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') event.currentTarget.value = propertyKey;
        }}
        className={`${inputClass} font-mono`}
        aria-label="Property name"
      />
      <input
        defaultValue={value}
        onBlur={(event) => {
          if (event.target.value !== value) {
            updateSignalProperty(signalId, propertyKey, event.target.value);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') event.currentTarget.value = value;
        }}
        className={inputClass}
        aria-label={`${propertyKey} value`}
      />
      <button
        type="button"
        onClick={() => updateSignalProperty(signalId, propertyKey, '')}
        className="rounded border border-zinc-800 px-2.5 text-zinc-500 hover:border-red-900 hover:text-red-400"
        title={`Remove ${propertyKey}`}
      >
        ×
      </button>
    </div>
  );
}

function DropdownDefinitionEditor({
  definition,
  usageCount,
}: {
  definition: SignalPropertyDefinition;
  usageCount: number;
}) {
  const updateDefinition = useHarnessStore(
    (state) => state.updateSignalPropertyDefinition,
  );
  const deleteDefinition = useHarnessStore(
    (state) => state.deleteSignalPropertyDefinition,
  );

  const handleDelete = () => {
    const confirmed = window.confirm(
      usageCount > 0
        ? `Delete dropdown property '${definition.name}'?\n\nThe saved value will be removed from ${usageCount} signal${usageCount === 1 ? '' : 's'}.`
        : `Delete unused dropdown property '${definition.name}'?`,
    );
    if (confirmed) deleteDefinition(definition.id);
  };

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/50 p-3">
      <div className="grid grid-cols-[minmax(140px,0.7fr)_minmax(220px,1.3fr)_auto] items-end gap-3">
        <Field label="Display name">
          <input
            key={`${definition.id}:${definition.name}`}
            defaultValue={definition.name}
            onBlur={(event) => {
              const name = event.target.value.trim();
              if (!name) event.target.value = definition.name;
              else if (name !== definition.name) updateDefinition(definition.id, { name });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') event.currentTarget.value = definition.name;
            }}
            className={inputClass}
          />
        </Field>
        <Field
          label="Dropdown options"
          hint={usageCount > 0 ? 'Options currently selected by signals are kept.' : undefined}
        >
          <input
            key={`${definition.id}:${definition.options.join('|')}`}
            defaultValue={definition.options.join(', ')}
            onBlur={(event) => {
              const options = event.target.value
                .split(',')
                .map((option) => option.trim())
                .filter(Boolean);
              if (options.length === 0) {
                event.target.value = definition.options.join(', ');
                return;
              }
              updateDefinition(definition.id, { options });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                event.currentTarget.value = definition.options.join(', ');
              }
            }}
            className={inputClass}
          />
        </Field>
        <button
          type="button"
          onClick={handleDelete}
          className="h-[30px] rounded border border-red-950 px-2.5 text-[10px] text-red-500 hover:border-red-800 hover:bg-red-950/30 hover:text-red-400"
        >
          Delete
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[9px] text-zinc-600">
        <span className="font-mono">{definition.key}</span>
        <span>·</span>
        <span>{usageCount} configured signal{usageCount === 1 ? '' : 's'}</span>
      </div>
    </div>
  );
}

export function SignalLibraryPage() {
  const harness = useHarnessStore((state) => state.harness);
  const targetId = useHarnessStore((state) => state.signalLibraryTargetId);
  const activeHarnessName = useHarnessStore((state) => state.activeHarnessName);
  const addSignal = useHarnessStore((state) => state.addSignal);
  const addSignalPropertyDefinition = useHarnessStore(
    (state) => state.addSignalPropertyDefinition,
  );
  const deleteEntityCascade = useHarnessStore((state) => state.deleteEntityCascade);
  const getDeleteImpact = useHarnessStore((state) => state.getDeleteImpact);
  const inspectEntity = useHarnessStore((state) => state.inspectEntity);
  const closeConnectorLibrary = useHarnessStore((state) => state.closeConnectorLibrary);
  const updateSignalProperty = useHarnessStore((state) => state.updateSignalProperty);
  const mutationError = useHarnessStore((state) => state.mutationError);
  const setMutationError = useHarnessStore((state) => state.setMutationError);
  const isEditor = useHarnessStore((state) => state.session.isEditor);

  const [selectedId, setSelectedId] = useState<string | null>(targetId);
  const [focusSignalId, setFocusSignalId] = useState<string | null>(targetId);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTags, setNewTags] = useState('');
  const [newColor, setNewColor] = useState('');
  const [newPropertyKey, setNewPropertyKey] = useState('');
  const [newPropertyValue, setNewPropertyValue] = useState('');
  const [creatingDropdown, setCreatingDropdown] = useState(false);
  const [newDropdownName, setNewDropdownName] = useState('');
  const [newDropdownOptions, setNewDropdownOptions] = useState('');

  const allSignals = useMemo(() => harness?.signals ?? [], [harness]);
  const propertyDefinitions = harness?.signalPropertyDefinitions ?? [];

  const visibleSignals = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...allSignals]
      .filter((signal) => !query || [
        signal.name,
        signal.id,
        ...signal.tags,
        ...Object.keys(signal.properties),
        ...Object.values(signal.properties),
      ].some((value) => value.toLowerCase().includes(query)))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [allSignals, search]);

  const selectedSignal = allSignals.find((signal) => signal.id === selectedId)
    ?? [...allSignals].sort((a, b) => a.name.localeCompare(b.name))[0];
  const usedPaths = useMemo(
    () => selectedSignal && harness
      ? harness.paths
          .filter((path) => getPathSignalId(path) === selectedSignal.id)
          .sort((left, right) => left.name.localeCompare(right.name))
      : [],
    [harness, selectedSignal],
  );
  const connectionCount = usedPaths.reduce((total, path) => total + path.nodes.length, 0);

  const handleCreate = () => {
    if (!newName.trim()) return;
    const id = addSignal({
      name: newName,
      tags: newTags.split(',').map((tag) => tag.trim()).filter(Boolean),
      properties: newColor.trim() ? { preferred_wire_color: newColor.trim() } : {},
    });
    if (!id) return;
    setSelectedId(id);
    setNewName('');
    setNewTags('');
    setNewColor('');
    setCreating(false);
  };

  const handleDuplicate = () => {
    if (!selectedSignal) return;
    const id = addSignal({
      name: `${selectedSignal.name} Copy`,
      tags: [...selectedSignal.tags],
      properties: { ...selectedSignal.properties },
    });
    if (id) setSelectedId(id);
  };

  const handleDelete = () => {
    if (!selectedSignal) return;
    const impact = getDeleteImpact('signal', selectedSignal.id);
    const pathCount = impact.pathIds.length;
    const confirmed = window.confirm(
      pathCount > 0
        ? `Delete '${selectedSignal.name}'?\n\nThis signal is used by ${pathCount} path${pathCount === 1 ? '' : 's'}. Those paths will also be permanently deleted.`
        : `Delete unused signal '${selectedSignal.name}'?`,
    );
    if (!confirmed) return;
    const nextId = [...allSignals]
      .filter((signal) => signal.id !== selectedSignal.id)
      .sort((a, b) => a.name.localeCompare(b.name))[0]?.id ?? null;
    deleteEntityCascade('signal', selectedSignal.id);
    setSelectedId(nextId);
  };

  const handleAddProperty = () => {
    if (!selectedSignal) return;
    const key = newPropertyKey.trim();
    if (!key || !newPropertyValue) return;
    if (propertyDefinitions.some((definition) => definition.key === key)) {
      setMutationError(`'${key}' is managed by a dropdown property.`);
      return;
    }
    if (selectedSignal.properties[key] !== undefined) {
      setMutationError(`Signal property '${key}' already exists.`);
      return;
    }
    updateSignalProperty(selectedSignal.id, key, newPropertyValue);
    setNewPropertyKey('');
    setNewPropertyValue('');
  };

  const handleCreateDropdown = () => {
    const options = newDropdownOptions
      .split(',')
      .map((option) => option.trim())
      .filter(Boolean);
    const id = addSignalPropertyDefinition({
      name: newDropdownName,
      options,
    });
    if (!id) return;
    setNewDropdownName('');
    setNewDropdownOptions('');
    setCreatingDropdown(false);
  };

  const definitionKeys = new Set(
    propertyDefinitions.map((definition) => definition.key),
  );
  const customProperties = selectedSignal
    ? Object.entries(selectedSignal.properties).filter(
        ([key]) => key !== 'preferred_wire_color' && !definitionKeys.has(key),
      )
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900/70 px-5 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-zinc-100">Signal Library</h1>
            <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[9px] text-zinc-400">
              {allSignals.length} total
            </span>
          </div>
          <p className="mt-0.5 text-[10px] text-zinc-500">
            Configures {harness?.name ?? activeHarnessName} · {isEditor ? 'changes save automatically' : 'log in to edit'}
          </p>
        </div>
        <button
          type="button"
          onClick={closeConnectorLibrary}
          className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
        >
          Open system
        </button>
      </div>

      {mutationError && (
        <button
          type="button"
          onClick={() => setMutationError(null)}
          className="mx-4 mt-3 shrink-0 rounded border border-red-800 bg-red-950/70 px-3 py-2 text-left text-xs text-red-300"
          title="Dismiss"
        >
          {mutationError}
        </button>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/40">
          <div className="space-y-2 border-b border-zinc-800 p-3">
            <div className="relative">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-600"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3-3" />
              </svg>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search signals, tags, properties…"
                className={`${inputClass} pl-8`}
              />
            </div>
            {!creating || !isEditor ? (
              <button
                type="button"
                disabled={!isEditor}
                onClick={() => setCreating(true)}
                className="w-full rounded border border-dashed border-zinc-700 py-1.5 text-xs text-zinc-400 hover:border-amber-700 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:text-zinc-400"
              >
                + New signal
              </button>
            ) : (
              <div className="space-y-2 rounded border border-zinc-700 bg-zinc-900 p-3">
                <input
                  autoFocus
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleCreate();
                    if (event.key === 'Escape') setCreating(false);
                  }}
                  placeholder="Signal name"
                  className={inputClass}
                />
                <input
                  value={newTags}
                  onChange={(event) => setNewTags(event.target.value)}
                  placeholder="Tags (optional, comma-separated)"
                  className={inputClass}
                />
                <input
                  value={newColor}
                  onChange={(event) => setNewColor(event.target.value)}
                  placeholder="Preferred wire color (optional)"
                  className={inputClass}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!newName.trim()}
                    onClick={handleCreate}
                    className="flex-1 rounded bg-amber-500 py-1.5 text-[10px] font-semibold text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Create signal
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    className="rounded border border-zinc-700 px-3 text-[10px] text-zinc-400 hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <div className="space-y-1">
              {visibleSignals.map((signal) => {
                const usage = harness?.paths.filter((path) => getPathSignalId(path) === signal.id).length ?? 0;
                return (
                  <button
                    key={signal.id}
                    type="button"
                    onClick={() => setSelectedId(signal.id)}
                    className={`w-full rounded border px-3 py-2 text-left transition-colors ${
                      selectedSignal?.id === signal.id
                        ? 'border-amber-700/70 bg-amber-950/30'
                        : 'border-transparent hover:border-zinc-800 hover:bg-zinc-900'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <SignalSwatch signal={signal} />
                      <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">{signal.name}</span>
                      <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">
                        {usage} path{usage === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 pl-5 text-[9px] text-zinc-600">
                      <span className="truncate font-mono">{signal.id}</span>
                      {signal.tags.length > 0 && (
                        <>
                          <span>·</span>
                          <span className="truncate">{signal.tags.join(', ')}</span>
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
              {visibleSignals.length === 0 && (
                <div className="px-3 py-10 text-center text-xs text-zinc-600">
                  {allSignals.length === 0 ? 'No signals configured' : 'No matching signals'}
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          {!selectedSignal ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-600">
                ⌁
              </div>
              <p className="text-sm text-zinc-500">
                {allSignals.length === 0 ? 'Create your first signal to get started' : 'Select a signal to configure it'}
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-5xl space-y-4 p-5">
              <div className="flex items-start gap-3">
                <SignalSwatch signal={selectedSignal} className="mt-1 h-8 w-2 rounded-full" />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-semibold text-zinc-100">{selectedSignal.name}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
                    <span className="font-mono">{selectedSignal.id}</span>
                    <span>·</span>
                    <span>{usedPaths.length} path{usedPaths.length === 1 ? '' : 's'}</span>
                    <span>·</span>
                    <span>{connectionCount} connection point{connectionCount === 1 ? '' : 's'}</span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!isEditor}
                  onClick={handleDuplicate}
                  className="rounded border border-zinc-700 px-2.5 py-1.5 text-[10px] text-zinc-400 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  disabled={!isEditor}
                  onClick={handleDelete}
                  className="rounded border border-red-900/70 px-2.5 py-1.5 text-[10px] text-red-400 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Delete
                </button>
              </div>

              <fieldset disabled={!isEditor} className="space-y-4 border-0 p-0">
                <Section
                  title="Definition"
                  description="The stable ID is generated at creation and remains unchanged."
                >
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Display name">
                      <NameField
                        key={`${selectedSignal.id}:${selectedSignal.name}`}
                        signal={selectedSignal}
                        autoFocus={focusSignalId === selectedSignal.id}
                        onAutoFocus={() => setFocusSignalId(null)}
                      />
                    </Field>
                    <Field label="Stable ID">
                      <input
                        value={selectedSignal.id}
                        readOnly
                        className={`${inputClass} font-mono text-zinc-500`}
                      />
                    </Field>
                  </div>
                  <Field label="Tags" hint="Use tags to group signals by voltage, network, function, or subsystem.">
                    <TagsEditor key={selectedSignal.id} signal={selectedSignal} />
                  </Field>
                </Section>

                <Section
                  title="Preferred wire color"
                  description="Paths inherit this as design guidance unless they define their own wire color."
                >
                  <div className="flex items-center gap-3">
                    <SignalSwatch signal={selectedSignal} className="h-8 w-8 rounded-md" />
                    <input
                      key={`${selectedSignal.id}:${selectedSignal.properties.preferred_wire_color ?? ''}`}
                      defaultValue={selectedSignal.properties.preferred_wire_color ?? ''}
                      onBlur={(event) => updateSignalProperty(
                        selectedSignal.id,
                        'preferred_wire_color',
                        event.target.value.trim(),
                      )}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                      }}
                      placeholder="e.g. red or white/brown"
                      className={inputClass}
                    />
                    {selectedSignal.properties.preferred_wire_color && (
                      <button
                        type="button"
                        onClick={() => updateSignalProperty(selectedSignal.id, 'preferred_wire_color', '')}
                        className="shrink-0 text-[10px] text-zinc-500 hover:text-red-400"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {WIRE_COLOR_PRESETS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => updateSignalProperty(selectedSignal.id, 'preferred_wire_color', color)}
                        className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[9px] capitalize transition-colors ${
                          selectedSignal.properties.preferred_wire_color === color
                            ? 'border-amber-600 bg-amber-950/30 text-amber-300'
                            : 'border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
                        }`}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full border border-white/10"
                          style={{ backgroundColor: getWireColorPresetHex(color) ?? '#666' }}
                        />
                        {color}
                      </button>
                    ))}
                  </div>
                  <p className="text-[9px] text-zinc-600">
                    For striped wire, enter colors separated by a slash, such as white/brown.
                  </p>
                </Section>

                <Section
                  title="Dropdown property setup"
                  description="Create reusable classifications that appear as dropdowns on every signal."
                >
                  {propertyDefinitions.length > 0 && (
                    <div className="space-y-2">
                      {propertyDefinitions.map((definition) => (
                        <DropdownDefinitionEditor
                          key={definition.id}
                          definition={definition}
                          usageCount={allSignals.filter(
                            (signal) => signal.properties[definition.key] !== undefined,
                          ).length}
                        />
                      ))}
                    </div>
                  )}
                  {!creatingDropdown ? (
                    <button
                      type="button"
                      onClick={() => setCreatingDropdown(true)}
                      className="w-full rounded border border-dashed border-zinc-700 py-1.5 text-xs text-zinc-400 hover:border-amber-700 hover:text-amber-400"
                    >
                      + New dropdown property
                    </button>
                  ) : (
                    <div className="rounded border border-amber-900/60 bg-amber-950/10 p-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Property name" hint="Example: Noise classification">
                          <input
                            autoFocus
                            value={newDropdownName}
                            onChange={(event) => setNewDropdownName(event.target.value)}
                            placeholder="Noise"
                            className={inputClass}
                          />
                        </Field>
                        <Field label="Dropdown options" hint="Comma-separated">
                          <input
                            value={newDropdownOptions}
                            onChange={(event) => setNewDropdownOptions(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') handleCreateDropdown();
                              if (event.key === 'Escape') setCreatingDropdown(false);
                            }}
                            placeholder="Sensitive, Neutral, Noisy"
                            className={inputClass}
                          />
                        </Field>
                      </div>
                      <div className="mt-3 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setCreatingDropdown(false);
                            setNewDropdownName('');
                            setNewDropdownOptions('');
                          }}
                          className="rounded border border-zinc-700 px-3 py-1.5 text-[10px] text-zinc-400 hover:text-zinc-200"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={
                            !newDropdownName.trim()
                            || !newDropdownOptions.split(',').some((option) => option.trim())
                          }
                          onClick={handleCreateDropdown}
                          className="rounded bg-amber-500 px-3 py-1.5 text-[10px] font-semibold text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Create dropdown
                        </button>
                      </div>
                    </div>
                  )}
                </Section>

                <Section
                  title="Signal properties"
                  description="Choose structured dropdown values or add one-off freeform metadata."
                >
                  {propertyDefinitions.length > 0 && (
                    <div className="grid grid-cols-2 gap-3">
                      {propertyDefinitions.map((definition) => (
                        <Field
                          key={definition.id}
                          label={definition.name}
                          hint={`Property key: ${definition.key}`}
                        >
                          <select
                            value={selectedSignal.properties[definition.key] ?? ''}
                            onChange={(event) => updateSignalProperty(
                              selectedSignal.id,
                              definition.key,
                              event.target.value,
                            )}
                            className={`${inputClass} cursor-pointer`}
                          >
                            <option value="">Not set</option>
                            {definition.options.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        </Field>
                      ))}
                    </div>
                  )}

                  <div className={propertyDefinitions.length > 0 ? 'border-t border-zinc-800 pt-3' : ''}>
                    <div className="mb-2 text-[10px] font-medium text-zinc-400">
                      Freeform properties
                    </div>
                  {customProperties.length > 0 && (
                    <div className="space-y-2">
                      {customProperties.map(([key, value]) => (
                        <PropertyEditor
                          key={`${selectedSignal.id}:${key}`}
                          signalId={selectedSignal.id}
                          propertyKey={key}
                          value={value}
                          existingKeys={Object.keys(selectedSignal.properties)}
                        />
                      ))}
                    </div>
                  )}
                  {customProperties.length === 0 && (
                    <div className="rounded border border-dashed border-zinc-800 py-4 text-center text-[10px] text-zinc-600">
                      No custom properties
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-[minmax(140px,0.8fr)_minmax(180px,1.4fr)_auto] gap-2 border-t border-zinc-800 pt-3">
                    <input
                      value={newPropertyKey}
                      onChange={(event) => setNewPropertyKey(event.target.value)}
                      placeholder="Property name"
                      className={`${inputClass} font-mono`}
                    />
                    <input
                      value={newPropertyValue}
                      onChange={(event) => setNewPropertyValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') handleAddProperty();
                      }}
                      placeholder="Value"
                      className={inputClass}
                    />
                    <button
                      type="button"
                      disabled={!newPropertyKey.trim() || !newPropertyValue}
                      onClick={handleAddProperty}
                      className="rounded border border-zinc-700 bg-zinc-800 px-3 text-[10px] text-zinc-300 hover:border-amber-700 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Add
                    </button>
                  </div>
                  </div>
                </Section>
              </fieldset>

              <Section
                title={`Used by ${usedPaths.length} path${usedPaths.length === 1 ? '' : 's'}`}
                description="Open a path in the System view to inspect its routing and connection details."
              >
                {usedPaths.length === 0 ? (
                  <div className="rounded border border-dashed border-zinc-800 py-5 text-center text-[10px] text-zinc-600">
                    This signal is not assigned to any paths.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                    {usedPaths.map((path) => {
                      const wireColor = path.properties.wire_color ?? path.properties.color;
                      return (
                        <button
                          key={path.id}
                          type="button"
                          onClick={() => inspectEntity({ type: 'path', id: path.id })}
                          className="group rounded border border-zinc-800 bg-zinc-950/50 p-3 text-left hover:border-amber-800 hover:bg-zinc-900"
                        >
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-xs text-zinc-300 group-hover:text-amber-300">
                              {path.name}
                            </span>
                            <span className="text-[9px] text-zinc-600">{path.nodes.length} points</span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[9px] text-zinc-600">
                            <span className="truncate font-mono">{path.id}</span>
                            <span>·</span>
                            <span>{wireColor ? `Wire: ${wireColor}` : 'Uses preferred color'}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
