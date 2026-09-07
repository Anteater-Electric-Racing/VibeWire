import { useId, useMemo, useState, type FormEvent } from 'react';
import { useSystemStore } from '../../store';
import type { HierarchyEntity, SystemData, SelectedItem } from '../../types';
import { ModalShell } from '../collab/ModalShell';

type HierarchyEntityKind = 'device' | 'enclosure';

interface CreateHierarchyEntityModalProps {
  onClose: () => void;
  onCreated: (parentId: string | null) => void;
}

function preferredParent(
  system: SystemData,
  selectedItem: SelectedItem | null,
  openEnclosureId: string | null,
): string | null {
  const byId = new Map(system.hierarchy.map((item) => [item.id, item]));
  const containerOrParent = (enclosure: HierarchyEntity | undefined): string | null => {
    if (!enclosure) return null;
    if (enclosure.kind === 'enclosure') return enclosure.id;
    const parent = enclosure.parent ? byId.get(enclosure.parent) : undefined;
    return parent?.kind === 'enclosure' ? parent.id : null;
  };

  if (selectedItem?.type === 'enclosure') {
    return containerOrParent(byId.get(selectedItem.id));
  }

  if (selectedItem?.type === 'connector') {
    const connector = system.connectors.find((item) => item.id === selectedItem.id);
    return containerOrParent(connector?.parent ? byId.get(connector.parent) : undefined);
  }

  if (selectedItem?.type === 'branchPoint') {
    const branchPoint = system.branchPoints.find((item) => item.id === selectedItem.id);
    return containerOrParent(branchPoint?.parent ? byId.get(branchPoint.parent) : undefined);
  }

  return containerOrParent(openEnclosureId ? byId.get(openEnclosureId) : undefined);
}

function enclosureDepth(enclosure: HierarchyEntity, byId: Map<string, HierarchyEntity>): number {
  let depth = 0;
  let parentId = enclosure.parent;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    depth += 1;
    parentId = byId.get(parentId)?.parent ?? null;
  }
  return depth;
}

export function CreateHierarchyEntityModal({
  onClose,
  onCreated,
}: CreateHierarchyEntityModalProps) {
  const formId = useId();
  const system = useSystemStore((state) => state.system);
  const selectedItem = useSystemStore((state) => state.selectedItem);
  const openEnclosureId = useSystemStore((state) => state.openEnclosureId);
  const addEnclosure = useSystemStore((state) => state.addEnclosure);
  const isEditor = useSystemStore((state) => state.session.isEditor);
  const [kind, setKind] = useState<HierarchyEntityKind>('device');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string | null>(() =>
    system ? preferredParent(system, selectedItem, openEnclosureId) : null,
  );

  const parentOptions = useMemo(() => {
    if (!system) return [];
    const byId = new Map(system.hierarchy.map((item) => [item.id, item]));
    return system.hierarchy
      .filter((item) => item.kind === 'enclosure')
      .map((item) => ({ enclosure: item, depth: enclosureDepth(item, byId) }));
  }, [system]);

  if (!system) return null;

  const canEdit = isEditor;
  const trimmedName = name.trim();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmedName || !canEdit) return;
    const createdId = addEnclosure({
      name: trimmedName,
      parent: parentId,
      kind,
    });
    if (!createdId) return;
    onCreated(parentId);
    onClose();
  };

  return (
    <ModalShell
      title="Add to hierarchy"
      onClose={onClose}
      widthClassName="w-[28rem]"
      footer={(
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            disabled={!trimmedName || !canEdit}
            className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add {kind}
          </button>
        </div>
      )}
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        <fieldset>
          <legend className="mb-1.5 text-[11px] font-medium text-zinc-400">What are you adding?</legend>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed={kind === 'device'}
              onClick={() => setKind('device')}
              className={`rounded-md border p-3 text-left transition-colors ${
                kind === 'device'
                  ? 'border-vw-device bg-vw-device/15 text-vw-device'
                  : 'border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <svg className="h-4 w-4 text-vw-device" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <circle cx="8" cy="12" r="1.5" />
                  <circle cx="16" cy="12" r="1.5" />
                </svg>
                Device
              </span>
              <span className="mt-1 block text-[10px] leading-4 text-zinc-500">
                A component that owns connectors
              </span>
            </button>
            <button
              type="button"
              aria-pressed={kind === 'enclosure'}
              onClick={() => setKind('enclosure')}
              className={`rounded-md border p-3 text-left transition-colors ${
                kind === 'enclosure'
                  ? 'border-vw-enclosure bg-white/10 text-vw-enclosure'
                  : 'border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <svg className="h-4 w-4 text-vw-enclosure" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 9h18" />
                </svg>
                Enclosure
              </span>
              <span className="mt-1 block text-[10px] leading-4 text-zinc-500">
                A container for devices or enclosures
              </span>
            </button>
          </div>
        </fieldset>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-medium text-zinc-400">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={kind === 'device' ? 'e.g. Motor controller' : 'e.g. Battery enclosure'}
            className={`w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-zinc-600 ${
              kind === 'device'
                ? 'text-vw-device focus:border-vw-device'
                : 'text-vw-enclosure focus:border-vw-enclosure'
            }`}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-medium text-zinc-400">Location</span>
          <select
            value={parentId ?? ''}
            onChange={(event) => setParentId(event.target.value || null)}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-amber-500"
          >
            <option value="">{system.name ?? 'System'} (top level)</option>
            {parentOptions.map(({ enclosure, depth }) => (
              <option key={enclosure.id} value={enclosure.id}>
                {`${'\u00a0\u00a0'.repeat(depth + 1)}${enclosure.name}`}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[10px] text-zinc-600">
            Select the enclosure that should contain it.
          </span>
        </label>

        {!canEdit && (
          <p className="rounded border border-amber-900/60 bg-amber-950/30 px-2.5 py-2 text-[11px] text-amber-300">
            Log in with edit access to add hierarchy items.
          </p>
        )}
      </form>
    </ModalShell>
  );
}
