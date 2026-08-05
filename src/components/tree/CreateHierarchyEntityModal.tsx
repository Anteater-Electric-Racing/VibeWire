import { useId, useMemo, useState, type FormEvent } from 'react';
import { useHarnessStore } from '../../store';
import type { Enclosure, HarnessData, SelectedItem } from '../../types';
import { ModalShell } from '../collab/ModalShell';

type HierarchyEntityKind = 'device' | 'enclosure';

interface CreateHierarchyEntityModalProps {
  onClose: () => void;
  onCreated: (parentId: string | null) => void;
}

function preferredParent(
  harness: HarnessData,
  selectedItem: SelectedItem | null,
  drillDownEnclosure: string | null,
): string | null {
  const byId = new Map(harness.enclosures.map((item) => [item.id, item]));
  const containerOrParent = (enclosure: Enclosure | undefined): string | null => {
    if (!enclosure) return null;
    if (enclosure.container) return enclosure.id;
    const parent = enclosure.parent ? byId.get(enclosure.parent) : undefined;
    return parent?.container ? parent.id : null;
  };

  if (selectedItem?.type === 'enclosure') {
    return containerOrParent(byId.get(selectedItem.id));
  }

  if (selectedItem?.type === 'connector') {
    const connector = harness.connectors.find((item) => item.id === selectedItem.id);
    return containerOrParent(connector?.parent ? byId.get(connector.parent) : undefined);
  }

  if (selectedItem?.type === 'mergePoint') {
    const mergePoint = harness.mergePoints.find((item) => item.id === selectedItem.id);
    return containerOrParent(mergePoint?.parent ? byId.get(mergePoint.parent) : undefined);
  }

  return containerOrParent(drillDownEnclosure ? byId.get(drillDownEnclosure) : undefined);
}

function enclosureDepth(enclosure: Enclosure, byId: Map<string, Enclosure>): number {
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
  const harness = useHarnessStore((state) => state.harness);
  const selectedItem = useHarnessStore((state) => state.selectedItem);
  const drillDownEnclosure = useHarnessStore((state) => state.drillDownEnclosure);
  const addEnclosure = useHarnessStore((state) => state.addEnclosure);
  const isEditor = useHarnessStore((state) => state.session.isEditor);
  const [kind, setKind] = useState<HierarchyEntityKind>('device');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string | null>(() =>
    harness ? preferredParent(harness, selectedItem, drillDownEnclosure) : null,
  );

  const parentOptions = useMemo(() => {
    if (!harness) return [];
    const byId = new Map(harness.enclosures.map((item) => [item.id, item]));
    return harness.enclosures
      .filter((item) => item.container)
      .map((item) => ({ enclosure: item, depth: enclosureDepth(item, byId) }));
  }, [harness]);

  if (!harness) return null;

  const canEdit = isEditor;
  const trimmedName = name.trim();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmedName || !canEdit) return;
    const createdId = addEnclosure({
      name: trimmedName,
      parent: parentId,
      container: kind === 'enclosure',
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
                  ? 'border-teal-500 bg-teal-950/40 text-teal-100'
                  : 'border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <svg className="h-4 w-4 text-teal-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                  ? 'border-amber-500 bg-amber-950/40 text-amber-100'
                  : 'border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <svg className="h-4 w-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-amber-500"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-medium text-zinc-400">Location</span>
          <select
            value={parentId ?? ''}
            onChange={(event) => setParentId(event.target.value || null)}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-amber-500"
          >
            <option value="">{harness.name ?? 'System'} (top level)</option>
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
