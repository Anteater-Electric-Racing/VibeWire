import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImagePickerPanel } from '../graph/ImagePickerPanel';
import { GENERIC_MULTIPIN_TYPE_ID, isConnectorFamily } from '../../lib/connectorFamily';
import { flushAutoSave, useHarnessStore } from '../../store';
import type {
  ConnectorCavityVariant,
  ConnectorLibrary,
  ConnectorType,
  HarnessData,
} from '../../types';

const PROTECTED_TYPE_IDS = new Set([
  GENERIC_MULTIPIN_TYPE_ID,
]);

interface UsageEntry {
  total: number;
  harnesses: Record<string, number>;
  pin_counts: Record<string, number>;
  keyings: Record<string, number>;
}

type UsageMap = Record<string, UsageEntry>;

function slugifyId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'connector_type';
}

function uniqueTypeId(name: string, library: ConnectorLibrary): string {
  const base = slugifyId(name);
  const ids = new Set(library.connector_types.map((type) => type.id));
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

function normalizedVariants(variants: ConnectorCavityVariant[]): ConnectorCavityVariant[] {
  return [...variants].sort((a, b) => a.pin_count - b.pin_count);
}

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
    <section className="border border-zinc-800 rounded-lg bg-zinc-900/60">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h3 className="text-xs font-semibold text-zinc-200">{title}</h3>
        {description && <p className="text-[10px] text-zinc-500 mt-0.5">{description}</p>}
      </div>
      <div className="p-4 space-y-3">{children}</div>
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
      <span className="block text-[10px] font-medium text-zinc-400 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[9px] text-zinc-600 mt-1">{hint}</span>}
    </label>
  );
}

const inputClass = 'w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed';

function ImageField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string;
  onChange: (value: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <span className="block text-[10px] font-medium text-zinc-400 mb-1">{label}</span>
      {value && (
        <div className="h-24 mb-1.5 rounded border border-zinc-800 bg-zinc-950 overflow-hidden">
          <img
            src={`/user-data/images/${value}`}
            alt=""
            className="w-full h-full object-contain"
          />
        </div>
      )}
      <div className="flex gap-1.5">
        <input
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value || undefined)}
          placeholder="No image"
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="shrink-0 px-2.5 rounded border border-zinc-700 bg-zinc-800 text-[10px] text-zinc-300 hover:border-amber-600 hover:text-amber-300"
        >
          Upload
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="shrink-0 px-2 rounded border border-zinc-800 text-zinc-500 hover:text-red-400"
            title="Remove image"
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <ImagePickerPanel
          title={`Pick ${label.toLowerCase()}`}
          onPick={(filename) => onChange(filename)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function KeyingsEditor({
  variant,
  usage,
  onChange,
  onError,
}: {
  variant: ConnectorCavityVariant;
  usage: UsageEntry | undefined;
  onChange: (keyings: string[] | undefined) => void;
  onError: (message: string) => void;
}) {
  const source = (variant.keyings ?? []).join(', ');
  const [draft, setDraft] = useState(source);

  const commit = () => {
    const next = Array.from(new Set(
      draft.split(',').map((keying) => keying.trim()).filter(Boolean),
    ));
    const removedInUse = (variant.keyings ?? []).find(
      (keying) => !next.includes(keying)
        && (usage?.keyings[`${variant.pin_count}:${keying}`] ?? 0) > 0,
    );
    if (removedInUse) {
      setDraft(source);
      onError(
        `Keying '${removedInUse}' is used by connector instances and cannot be removed.`,
      );
      return;
    }
    onChange(next.length > 0 ? next : undefined);
  };

  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(source);
          event.currentTarget.blur();
        }
      }}
      placeholder="A, B, C"
      className={inputClass}
      aria-label={`${variant.pin_count}-cavity keyings`}
    />
  );
}

export function ConnectorLibraryPage() {
  const library = useHarnessStore((state) => state.connectorLibrary);
  const targetId = useHarnessStore((state) => state.connectorLibraryTargetId);
  const activeHarnessName = useHarnessStore((state) => state.activeHarnessName);
  const updateConnectorLibrary = useHarnessStore((state) => state.updateConnectorLibrary);
  const loadConnectorLibrary = useHarnessStore((state) => state.loadConnectorLibrary);
  const loadHarness = useHarnessStore((state) => state.loadHarness);
  const closeConnectorLibrary = useHarnessStore((state) => state.closeConnectorLibrary);
  const mutationError = useHarnessStore((state) => state.mutationError);
  const setMutationError = useHarnessStore((state) => state.setMutationError);
  const isEditor = useHarnessStore((state) => state.session.isEditor);

  const [selectedId, setSelectedId] = useState<string | null>(targetId);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<'family' | 'fixed'>('family');
  const [usage, setUsage] = useState<UsageMap>({});
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshUsage = useCallback(() => {
    fetch('/api/library/usage')
      .then((response) => {
        if (!response.ok) throw new Error(`Usage lookup failed: ${response.status}`);
        return response.json() as Promise<UsageMap>;
      })
      .then(setUsage)
      .catch(() => setUsage({}));
  }, []);

  useEffect(refreshUsage, [refreshUsage]);

  useEffect(() => {
    if (!isEditor) setCreating(false);
  }, [isEditor]);

  useEffect(() => {
    if (!library) return;
    if (targetId && library.connector_types.some((type) => type.id === targetId)) {
      setSelectedId(targetId);
      return;
    }
    if (!selectedId || !library.connector_types.some((type) => type.id === selectedId)) {
      setSelectedId(library.connector_types[0]?.id ?? null);
    }
  }, [library, selectedId, targetId]);

  const types = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...(library?.connector_types ?? [])]
      .filter((type) => !query || [
        type.name,
        type.id,
        type.crimp_spec,
        type.male_crimp_part_number ?? '',
        type.female_crimp_part_number ?? '',
        type.wire_gauge,
        ...(type.cavity_variants ?? []).flatMap((variant) => [
          variant.housing_part_number ?? '',
          variant.male_housing_part_number ?? '',
          variant.female_housing_part_number ?? '',
        ]),
      ].some((value) => value.toLowerCase().includes(query)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [library, search]);

  const selectedType = library?.connector_types.find((type) => type.id === selectedId);
  const selectedUsage = selectedType ? usage[selectedType.id] : undefined;

  const replaceType = (next: ConnectorType) => {
    if (!isEditor || !library) return;
    updateConnectorLibrary({
      ...library,
      connector_types: library.connector_types.map((type) =>
        type.id === next.id ? next : type
      ),
    });
    setNotice(null);
  };

  const patchType = (patch: Partial<ConnectorType>) => {
    if (!isEditor || !selectedType) return;
    replaceType({ ...selectedType, ...patch });
  };

  const handleCreate = () => {
    if (!isEditor || !library || !newName.trim()) return;
    const id = uniqueTypeId(newName, library);
    const next: ConnectorType = {
      id,
      name: newName.trim(),
      pin_count: newKind === 'family' ? 0 : 1,
      crimp_spec: '',
      wire_gauge: '',
      notes: '',
      ...(newKind === 'family'
        ? { cavity_variants: [{ pin_count: 2 }] }
        : {}),
    };
    updateConnectorLibrary({
      ...library,
      connector_types: [...library.connector_types, next],
    });
    setSelectedId(id);
    setNewName('');
    setCreating(false);
  };

  const handleDuplicate = () => {
    if (!isEditor || !library || !selectedType) return;
    const id = uniqueTypeId(`${selectedType.id}_copy`, library);
    const copy: ConnectorType = {
      ...structuredClone(selectedType),
      id,
      name: `${selectedType.name} Copy`,
    };
    updateConnectorLibrary({
      ...library,
      connector_types: [...library.connector_types, copy],
    });
    setSelectedId(id);
  };

  const handleDelete = async () => {
    if (!isEditor || !library || !selectedType || PROTECTED_TYPE_IDS.has(selectedType.id)) return;
    const count = selectedUsage?.total ?? 0;
    const confirmed = window.confirm(
      count > 0
        ? `Delete '${selectedType.name}'?\n\n${count} connector instance${count === 1 ? '' : 's'} across all harnesses will be migrated to Generic Multi-pin. Their cavity counts and custom properties will be preserved.`
        : `Delete unused connector type '${selectedType.name}'?`,
    );
    if (!confirmed) return;

    setDeleting(true);
    setNotice(null);
    setMutationError(null);
    try {
      if (!(await flushAutoSave())) {
        throw new Error('Save pending connector library edits before deleting.');
      }
      const response = await fetch(
        `/api/library/connector-types/${encodeURIComponent(selectedType.id)}?harness=${encodeURIComponent(activeHarnessName)}`,
        { method: 'DELETE' },
      );
      const body = await response.json() as {
        error?: string;
        library?: ConnectorLibrary;
        harness?: HarnessData;
        migrated?: number;
      };
      if (!response.ok || !body.library) {
        throw new Error(body.error ?? `Delete failed: ${response.status}`);
      }
      loadConnectorLibrary(body.library);
      if (body.harness) loadHarness(body.harness);
      const nextId = body.library.connector_types
        .filter((type) => type.id !== selectedType.id)
        .sort((a, b) => a.name.localeCompare(b.name))[0]?.id ?? null;
      setSelectedId(nextId);
      setNotice(
        `Deleted ${selectedType.name}. Migrated ${body.migrated ?? 0} connector instance${body.migrated === 1 ? '' : 's'} to Generic Multi-pin.`,
      );
      refreshUsage();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Connector type deletion failed.');
    } finally {
      setDeleting(false);
    }
  };

  if (!library) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-zinc-500">
        Connector library is unavailable.
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-zinc-950">
      <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-zinc-800 bg-zinc-900/70">
        <div>
          <h1 className="text-sm font-semibold text-zinc-100">Connector Library</h1>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            Shared across every harness · {isEditor ? 'changes save automatically' : 'log in to edit'}
          </p>
        </div>
        <button
          type="button"
          onClick={closeConnectorLibrary}
          className="px-3 py-1.5 text-xs rounded border border-zinc-700 bg-zinc-800 text-zinc-300 hover:text-zinc-100 hover:border-zinc-600"
        >
          Back to canvas
        </button>
      </div>

      {mutationError && (
        <button
          type="button"
          onClick={() => setMutationError(null)}
          className="shrink-0 mx-4 mt-3 px-3 py-2 text-xs text-left rounded border border-red-800 bg-red-950/70 text-red-300"
          title="Dismiss"
        >
          {mutationError}
        </button>
      )}
      {notice && (
        <button
          type="button"
          onClick={() => setNotice(null)}
          className="shrink-0 mx-4 mt-3 px-3 py-2 text-xs text-left rounded border border-emerald-800 bg-emerald-950/50 text-emerald-300"
          title="Dismiss"
        >
          {notice}
        </button>
      )}

      <div className="flex flex-1 min-h-0">
        <aside className="w-72 shrink-0 border-r border-zinc-800 flex flex-col min-h-0 bg-zinc-900/40">
          <div className="p-3 border-b border-zinc-800 space-y-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search connectors…"
              className={inputClass}
            />
            {!creating ? (
              <button
                type="button"
                disabled={!isEditor}
                onClick={() => setCreating(true)}
                className="w-full py-1.5 rounded border border-dashed border-zinc-700 text-xs text-zinc-400 hover:text-amber-400 hover:border-amber-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:text-zinc-400"
              >
                + New connector type
              </button>
            ) : (
              <div className="p-2.5 rounded border border-zinc-700 bg-zinc-900 space-y-2">
                <input
                  autoFocus
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleCreate();
                    if (event.key === 'Escape') setCreating(false);
                  }}
                  placeholder="Connector family name"
                  className={inputClass}
                />
                <div className="grid grid-cols-2 gap-1">
                  {(['family', 'fixed'] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setNewKind(kind)}
                      className={`py-1 rounded border text-[10px] capitalize ${
                        newKind === kind
                          ? 'border-amber-600 bg-amber-950/40 text-amber-300'
                          : 'border-zinc-700 text-zinc-500'
                      }`}
                    >
                      {kind}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={!newName.trim()}
                    className="flex-1 py-1 rounded bg-amber-600 text-[10px] text-zinc-950 disabled:opacity-40"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    className="px-2 py-1 rounded border border-zinc-700 text-[10px] text-zinc-400"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
            {types.map((type) => {
              const typeUsage = usage[type.id]?.total ?? 0;
              const family = isConnectorFamily(type);
              return (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => setSelectedId(type.id)}
                  className={`w-full text-left px-2.5 py-2 rounded border transition-colors ${
                    selectedId === type.id
                      ? 'border-amber-700/70 bg-amber-950/30'
                      : 'border-transparent hover:border-zinc-800 hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 text-xs text-zinc-200 truncate">{type.name}</span>
                    {typeUsage > 0 && (
                      <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                        {typeUsage}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-zinc-600">
                    <span className="font-mono truncate">{type.id}</span>
                    <span>·</span>
                    <span>{family ? `${type.cavity_variants?.length ?? 0} configs` : `${type.pin_count}p`}</span>
                  </div>
                </button>
              );
            })}
            {types.length === 0 && (
              <div className="py-8 text-center text-xs text-zinc-600">No matching connectors</div>
            )}
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto">
          {!selectedType ? (
            <div className="h-full flex items-center justify-center text-sm text-zinc-600">
              Select or create a connector type
            </div>
          ) : (
            <fieldset
              key={`${selectedType.id}:${isEditor ? 'editable' : 'read-only'}`}
              disabled={!isEditor}
              className="max-w-4xl min-w-0 mx-auto p-5 space-y-4 border-0"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-zinc-100">{selectedType.name}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
                    <span className="font-mono">{selectedType.id}</span>
                    <span>·</span>
                    <span>{isConnectorFamily(selectedType) ? 'Connector family' : 'Fixed connector'}</span>
                    <span>·</span>
                    <span>
                      {selectedUsage?.total ?? 0} instance{selectedUsage?.total === 1 ? '' : 's'} across all harnesses
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDuplicate}
                  className="px-2.5 py-1.5 rounded border border-zinc-700 text-[10px] text-zinc-400 hover:text-zinc-200"
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting || PROTECTED_TYPE_IDS.has(selectedType.id)}
                  title={
                    PROTECTED_TYPE_IDS.has(selectedType.id)
                      ? 'This connector type is required by VibeWire'
                      : 'Delete and migrate instances to Generic Multi-pin'
                  }
                  className="px-2.5 py-1.5 rounded border border-red-900/70 text-[10px] text-red-400 hover:bg-red-950/40 disabled:opacity-35 disabled:cursor-not-allowed"
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>

              <Section title="Definition" description="The stable ID cannot be changed after creation.">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Display name">
                    <input
                      value={selectedType.name}
                      onChange={(event) => patchType({ name: event.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Stable ID">
                    <input value={selectedType.id} readOnly className={`${inputClass} font-mono`} />
                  </Field>
                </div>
                <Field
                  label="Type"
                  hint={
                    PROTECTED_TYPE_IDS.has(selectedType.id)
                      ? 'This built-in type must keep its current mode.'
                      : (selectedUsage?.total ?? 0) > 0
                      ? 'Fixed/family mode is locked while this type is in use.'
                      : 'Families define multiple acceptable physical housings.'
                  }
                >
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['family', 'fixed'] as const).map((kind) => {
                      const active = isConnectorFamily(selectedType)
                        ? kind === 'family'
                        : kind === 'fixed';
                      return (
                        <button
                          key={kind}
                          type="button"
                          disabled={
                            PROTECTED_TYPE_IDS.has(selectedType.id)
                            || (selectedUsage?.total ?? 0) > 0
                          }
                          onClick={() => {
                            if (kind === 'family') {
                              patchType({
                                pin_count: 0,
                                cavity_variants: [{
                                  pin_count: Math.max(1, selectedType.pin_count || 1),
                                }],
                              });
                            } else {
                              const pinCount = selectedType.cavity_variants?.[0]?.pin_count ?? 1;
                              const next = { ...selectedType, pin_count: pinCount };
                              delete next.cavity_variants;
                              replaceType(next);
                            }
                          }}
                          className={`py-1.5 rounded border text-xs capitalize disabled:cursor-not-allowed ${
                            active
                              ? 'border-amber-600 bg-amber-950/30 text-amber-300'
                              : 'border-zinc-700 text-zinc-500 disabled:opacity-40'
                          }`}
                        >
                          {kind}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Legacy crimp specification" hint="Fallback for older catalog entries without structured male/female part numbers.">
                    <input
                      value={selectedType.crimp_spec}
                      onChange={(event) => patchType({ crimp_spec: event.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Compatible wire gauge">
                    <input
                      value={selectedType.wire_gauge}
                      onChange={(event) => patchType({ wire_gauge: event.target.value })}
                      className={inputClass}
                    />
                  </Field>
                </div>
                <Field label="Notes">
                  <textarea
                    value={selectedType.notes}
                    onChange={(event) => patchType({ notes: event.target.value })}
                    rows={3}
                    className={`${inputClass} resize-y`}
                  />
                </Field>
              </Section>

              <Section
                title="Male / female pin families"
                description="Manufacturing infers the contact, housing, and guide from this family and the selected connector gender."
              >
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-violet-900/60 bg-violet-950/15 p-3">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="text-xl" aria-hidden>🍆</span>
                      <div>
                        <div className="text-xs font-semibold text-violet-200">Male pin family</div>
                        <div className="text-[9px] text-zinc-600">Default manufacturing symbol</div>
                      </div>
                    </div>
                    <Field label="Male crimp part number" hint="Shared by every housing size.">
                      <input
                        value={selectedType.male_crimp_part_number ?? ''}
                        onChange={(event) => patchType({
                          male_crimp_part_number: event.target.value || undefined,
                        })}
                        placeholder="Male contact PN"
                        className={`${inputClass} font-mono`}
                      />
                    </Field>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <ImageField
                        label="Male pin guide"
                        value={selectedType.male_image}
                        onChange={(maleImage) => patchType({ male_image: maleImage })}
                      />
                      <ImageField
                        label="Male side view"
                        value={selectedType.male_side_image}
                        onChange={(maleSideImage) => patchType({
                          male_side_image: maleSideImage,
                        })}
                      />
                    </div>
                  </div>
                  <div className="rounded-lg border border-orange-900/60 bg-orange-950/15 p-3">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="text-xl" aria-hidden>🍑</span>
                      <div>
                        <div className="text-xs font-semibold text-orange-200">Female pin family</div>
                        <div className="text-[9px] text-zinc-600">Default manufacturing symbol</div>
                      </div>
                    </div>
                    <Field label="Female crimp part number" hint="Shared by every housing size.">
                      <input
                        value={selectedType.female_crimp_part_number ?? ''}
                        onChange={(event) => patchType({
                          female_crimp_part_number: event.target.value || undefined,
                        })}
                        placeholder="Female contact PN"
                        className={`${inputClass} font-mono`}
                      />
                    </Field>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <ImageField
                        label="Female pin guide"
                        value={selectedType.female_image}
                        onChange={(femaleImage) => patchType({ female_image: femaleImage })}
                      />
                      <ImageField
                        label="Female side view"
                        value={selectedType.female_side_image}
                        onChange={(femaleSideImage) => patchType({
                          female_side_image: femaleSideImage,
                        })}
                      />
                    </div>
                  </div>
                </div>
              </Section>

              {isConnectorFamily(selectedType) ? (
                <Section
                  title="Acceptable configurations"
                  description="Each row is a real housing size and housing part number. Contact part numbers are shared by the family."
                >
                  <div className="space-y-2">
                    {(selectedType.cavity_variants ?? []).map((variant) => {
                      const variantUsage = selectedUsage?.pin_counts[String(variant.pin_count)] ?? 0;
                      return (
                        <div
                          key={variant.pin_count}
                          className="p-3 rounded border border-zinc-800 bg-zinc-950/50"
                        >
                          <div className="grid grid-cols-[120px_minmax(0,1fr)_auto] gap-2 items-end">
                            <Field
                              label="Cavities"
                              hint={variantUsage > 0 ? `${variantUsage} in use` : undefined}
                            >
                              <input
                                type="number"
                                min={1}
                                disabled={variantUsage > 0}
                                value={variant.pin_count}
                                onChange={(event) => {
                                  const pinCount = Math.max(1, Math.floor(Number(event.target.value)));
                                  if (
                                    selectedType.cavity_variants?.some(
                                      (candidate) =>
                                        candidate !== variant && candidate.pin_count === pinCount,
                                    )
                                  ) return;
                                  patchType({
                                    cavity_variants: normalizedVariants(
                                      (selectedType.cavity_variants ?? []).map((candidate) =>
                                        candidate === variant
                                          ? { ...candidate, pin_count: pinCount }
                                          : candidate
                                      ),
                                    ),
                                  });
                                }}
                                className={inputClass}
                              />
                            </Field>
                            <Field label="Allowed keyings" hint="Comma-separated; leave blank when keying is not applicable.">
                              <KeyingsEditor
                                key={`${variant.pin_count}:${(variant.keyings ?? []).join('|')}`}
                                variant={variant}
                                usage={selectedUsage}
                                onError={setMutationError}
                                onChange={(keyings) => patchType({
                                  cavity_variants: (selectedType.cavity_variants ?? []).map(
                                    (candidate) => candidate === variant
                                      ? { ...candidate, keyings }
                                      : candidate,
                                  ),
                                })}
                              />
                            </Field>
                            <button
                              type="button"
                              disabled={
                                variantUsage > 0
                                || (selectedType.cavity_variants?.length ?? 0) <= 1
                              }
                              onClick={() => patchType({
                                cavity_variants: selectedType.cavity_variants?.filter(
                                  (candidate) => candidate !== variant,
                                ),
                              })}
                              className="h-[30px] px-2.5 rounded border border-zinc-800 text-zinc-500 hover:text-red-400 hover:border-red-900 disabled:opacity-30 disabled:cursor-not-allowed"
                              title={variantUsage > 0 ? 'This configuration is in use' : 'Remove configuration'}
                            >
                              ×
                            </button>
                          </div>
                          <div className="mt-3 pt-3 border-t border-zinc-800">
                            <div className="grid grid-cols-3 gap-3">
                              {([
                                ['Housing part number', 'housing_part_number', 'Shared housing PN'],
                                ['Male housing', 'male_housing_part_number', 'Defaults to shared'],
                                ['Female housing', 'female_housing_part_number', 'Defaults to shared'],
                              ] as const).map(([label, field, placeholder]) => (
                                <Field key={field} label={label}>
                                  <input
                                    value={variant[field] ?? ''}
                                    onChange={(event) => patchType({
                                      cavity_variants: (selectedType.cavity_variants ?? []).map(
                                        (candidate) => candidate === variant
                                          ? {
                                              ...candidate,
                                              [field]: event.target.value || undefined,
                                            }
                                          : candidate,
                                      ),
                                    })}
                                    placeholder={placeholder}
                                    className={`${inputClass} font-mono`}
                                  />
                                </Field>
                              ))}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3 mt-3">
                            <ImageField
                              label="Pin guide"
                              value={variant.image}
                              onChange={(image) => patchType({
                                cavity_variants: (selectedType.cavity_variants ?? []).map(
                                  (candidate) => candidate === variant
                                    ? { ...candidate, image }
                                    : candidate,
                                ),
                              })}
                            />
                            <ImageField
                              label="Side view (on boxes)"
                              value={variant.side_image}
                              onChange={(sideImage) => patchType({
                                cavity_variants: (selectedType.cavity_variants ?? []).map(
                                  (candidate) => candidate === variant
                                    ? { ...candidate, side_image: sideImage }
                                    : candidate,
                                ),
                              })}
                            />
                          </div>
                          <details className="mt-3 rounded border border-zinc-800 bg-zinc-900/40">
                            <summary className="cursor-pointer px-3 py-2 text-[10px] font-medium text-zinc-400 hover:text-zinc-200">
                              Gender-specific guide overrides
                            </summary>
                            <div className="grid grid-cols-2 gap-3 border-t border-zinc-800 p-3">
                              <div className="space-y-3">
                                <div className="text-[10px] font-semibold text-violet-300">🍆 Male</div>
                                <ImageField
                                  label="Male pin guide"
                                  value={variant.male_image}
                                  onChange={(maleImage) => patchType({
                                    cavity_variants: (selectedType.cavity_variants ?? []).map(
                                      (candidate) => candidate === variant
                                        ? { ...candidate, male_image: maleImage }
                                        : candidate,
                                    ),
                                  })}
                                />
                                <ImageField
                                  label="Male side view"
                                  value={variant.male_side_image}
                                  onChange={(maleSideImage) => patchType({
                                    cavity_variants: (selectedType.cavity_variants ?? []).map(
                                      (candidate) => candidate === variant
                                        ? { ...candidate, male_side_image: maleSideImage }
                                        : candidate,
                                    ),
                                  })}
                                />
                              </div>
                              <div className="space-y-3">
                                <div className="text-[10px] font-semibold text-orange-300">🍑 Female</div>
                                <ImageField
                                  label="Female pin guide"
                                  value={variant.female_image}
                                  onChange={(femaleImage) => patchType({
                                    cavity_variants: (selectedType.cavity_variants ?? []).map(
                                      (candidate) => candidate === variant
                                        ? { ...candidate, female_image: femaleImage }
                                        : candidate,
                                    ),
                                  })}
                                />
                                <ImageField
                                  label="Female side view"
                                  value={variant.female_side_image}
                                  onChange={(femaleSideImage) => patchType({
                                    cavity_variants: (selectedType.cavity_variants ?? []).map(
                                      (candidate) => candidate === variant
                                        ? { ...candidate, female_side_image: femaleSideImage }
                                        : candidate,
                                    ),
                                  })}
                                />
                              </div>
                            </div>
                          </details>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const variants = selectedType.cavity_variants ?? [];
                      const nextCount = Math.max(0, ...variants.map((variant) => variant.pin_count)) + 1;
                      patchType({
                        cavity_variants: [...variants, { pin_count: nextCount }],
                      });
                    }}
                    className="w-full py-1.5 rounded border border-dashed border-zinc-700 text-xs text-zinc-400 hover:text-amber-400 hover:border-amber-700"
                  >
                    + Add configuration
                  </button>
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-zinc-800">
                    <ImageField
                      label="Fallback pin guide"
                      value={selectedType.image}
                      onChange={(image) => patchType({ image })}
                    />
                    <ImageField
                      label="Fallback side view (on boxes)"
                      value={selectedType.side_image}
                      onChange={(sideImage) => patchType({ side_image: sideImage })}
                    />
                  </div>
                </Section>
              ) : (
                <Section title="Physical configuration">
                  <Field
                    label="Cavity count"
                    hint={
                      PROTECTED_TYPE_IDS.has(selectedType.id)
                        ? 'This built-in type must keep its current capacity.'
                        : (selectedUsage?.total ?? 0) > 0
                        ? 'The default capacity is locked while this type is in use.'
                        : undefined
                    }
                  >
                    <input
                      type="number"
                      min={selectedType.id === GENERIC_MULTIPIN_TYPE_ID ? 0 : 1}
                      disabled={
                        PROTECTED_TYPE_IDS.has(selectedType.id)
                        || (selectedUsage?.total ?? 0) > 0
                      }
                      value={selectedType.pin_count}
                      onChange={(event) => patchType({
                        pin_count: Math.max(
                          selectedType.id === GENERIC_MULTIPIN_TYPE_ID ? 0 : 1,
                          Math.floor(Number(event.target.value)),
                        ),
                      })}
                      className={inputClass}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <ImageField
                      label="Pin guide"
                      value={selectedType.image}
                      onChange={(image) => patchType({ image })}
                    />
                    <ImageField
                      label="Side view (on boxes)"
                      value={selectedType.side_image}
                      onChange={(sideImage) => patchType({ side_image: sideImage })}
                    />
                  </div>
                </Section>
              )}

              <Section
                title="Default instance properties"
                description="Copied only when a connector selects this type. Existing instance values are never overwritten."
              >
                <div className="space-y-2">
                  {Object.entries(selectedType.default_properties ?? {}).map(([key, value]) => (
                    <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-2">
                      <input
                        defaultValue={key}
                        onBlur={(event) => {
                          const nextKey = event.target.value.trim();
                          if (!nextKey || nextKey === key) return;
                          if (selectedType.default_properties?.[nextKey] !== undefined) {
                            event.target.value = key;
                            setMutationError(`Default property '${nextKey}' already exists.`);
                            return;
                          }
                          const properties = { ...(selectedType.default_properties ?? {}) };
                          delete properties[key];
                          properties[nextKey] = value;
                          patchType({ default_properties: properties });
                        }}
                        className={`${inputClass} font-mono`}
                        aria-label="Default property name"
                      />
                      <input
                        value={value}
                        onChange={(event) => patchType({
                          default_properties: {
                            ...(selectedType.default_properties ?? {}),
                            [key]: event.target.value,
                          },
                        })}
                        className={inputClass}
                        aria-label={`${key} default value`}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const properties = { ...(selectedType.default_properties ?? {}) };
                          delete properties[key];
                          patchType({
                            default_properties: Object.keys(properties).length > 0
                              ? properties
                              : undefined,
                          });
                        }}
                        className="px-2.5 rounded border border-zinc-800 text-zinc-500 hover:text-red-400"
                        title="Remove default property"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const properties = { ...(selectedType.default_properties ?? {}) };
                    let index = 1;
                    let key = 'property';
                    while (properties[key] !== undefined) {
                      index += 1;
                      key = `property_${index}`;
                    }
                    properties[key] = '';
                    patchType({ default_properties: properties });
                  }}
                  className="w-full py-1.5 rounded border border-dashed border-zinc-700 text-xs text-zinc-400 hover:text-amber-400 hover:border-amber-700"
                >
                  + Add default property
                </button>
              </Section>
            </fieldset>
          )}
        </main>
      </div>
    </div>
  );
}
