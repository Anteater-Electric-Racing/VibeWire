import { useMemo, useState } from 'react';
import { useHarnessStore } from '../../store';
import type { Enclosure, Connector, MergePoint } from '../../types';
import { formatConnectorOccupancySummary, getConnectorOccupancy } from '../../lib/harness';
import type { EntityType } from '../../types';
import { CreateHierarchyEntityModal } from './CreateHierarchyEntityModal';

function matchesQuery(text: string, query: string): boolean {
  return text.toLowerCase().includes(query);
}

function TreeEntityActions({ type, id }: { type: Extract<EntityType, 'enclosure' | 'connector' | 'mergePoint'>; id: string }) {
  const editingSurface = useHarnessStore((s) => s.editingSurface);
  const activeSubsystemId = useHarnessStore((s) => s.activeSubsystemId);
  const addEntity = useHarnessStore((s) => s.addEntityToActiveSubsystem);
  const getDeleteImpact = useHarnessStore((s) => s.getDeleteImpact);
  const deleteEntity = useHarnessStore((s) => s.deleteEntityCascade);
  const findEntity = useHarnessStore((s) => s.findEntity);
  const renameEntity = useHarnessStore((s) => s.renameEntity);
  const isEditor = useHarnessStore((s) => s.session.isEditor);

  const promptRename = () => {
    const entity = findEntity(type, id);
    if (!entity) return;
    const input = window.prompt(
      `Rename ${type === 'mergePoint' ? 'merge point' : type}.\n\nIts stable ID will remain "${id}".`,
      entity.name,
    );
    if (input !== null && input.trim()) renameEntity(type, id, input);
  };

  const confirmDelete = () => {
    const impact = getDeleteImpact(type, id);
    if (type === 'mergePoint') {
      const orphanNote = impact.pathIds.length > 0
        ? `\n\n${impact.pathIds.length} unpairable stub path(s) will be removed.`
        : '';
      if (window.confirm(
        `Delete splice ${id}?\n\nPaths through it will reconnect as if the splice was never there.${orphanNote}`,
      )) {
        deleteEntity(type, id);
      }
      return;
    }
    const summary = [
      `${impact.enclosureIds.length} enclosure/device`,
      `${impact.connectorIds.length} connector`,
      `${impact.mergePointIds.length} merge point`,
      `${impact.pathIds.length} path`,
    ].join(', ');
    if (window.confirm(`Permanently delete ${id}?\n\nThis will also delete: ${summary}.\n\nYou can restore it with Undo.`)) {
      deleteEntity(type, id);
    }
  };

  return (
    <span className="ml-auto flex items-center gap-1 shrink-0">
      {editingSurface === 'subsystem' && activeSubsystemId && type !== 'mergePoint' && (
        <button
          disabled={!isEditor}
          className="text-zinc-500 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-zinc-500"
          title={isEditor ? 'Add only this item to the active subsystem' : 'Log in to edit the subsystem'}
          onClick={(event) => {
            event.stopPropagation();
            addEntity(type, id);
          }}
        >
          ＋
        </button>
      )}
      <button
        disabled={!isEditor}
        className="text-zinc-500 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-zinc-500"
        title={isEditor ? 'Rename display name (stable ID is preserved)' : 'Log in to rename this item'}
        onClick={(event) => {
          event.stopPropagation();
          promptRename();
        }}
      >
        ✎
      </button>
      <button
        disabled={!isEditor}
        className="text-zinc-600 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-zinc-600"
        title={isEditor ? 'Delete entity and references' : 'Log in to delete this item'}
        onClick={(event) => {
          event.stopPropagation();
          confirmDelete();
        }}
      >
        ×
      </button>
    </span>
  );
}

function OccupancyRow({
  pinNumber,
  pathId,
  depth,
}: {
  pinNumber: number;
  pathId: string;
  depth: number;
}) {
  const selectedItem = useHarnessStore((s) => s.selectedItem);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const isSelected = selectedItem?.type === 'path' && selectedItem.id === pathId;

  return (
    <div
      className={`pr-2 py-0.5 text-[11px] cursor-pointer flex items-center gap-1.5 ${
        isSelected
          ? 'bg-amber-900/30 text-amber-200'
          : 'text-zinc-400 hover:bg-zinc-800'
      }`}
      style={{ paddingLeft: (depth + 1) * 16 + 8 }}
      onClick={() => selectItem({ type: 'path', id: pathId })}
    >
      <span className="text-zinc-600 font-mono text-[10px] w-4 text-right shrink-0">
        {pinNumber}
      </span>
      <span className="truncate">{pathId}</span>
    </div>
  );
}

function ConnectorRow({ connector, depth }: { connector: Connector; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const selectedItem = useHarnessStore((s) => s.selectedItem);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const harness = useHarnessStore((s) => s.harness);
  const connectorLibrary = useHarnessStore((s) => s.connectorLibrary);
  const isSelected =
    selectedItem?.type === 'connector' && selectedItem.id === connector.id;
  const occupancy = harness ? getConnectorOccupancy(harness, connector.id) : [];
  const connectorType = connectorLibrary?.connector_types.find(
    (type) => type.id === connector.connector_type,
  );
  const occupancySummary = formatConnectorOccupancySummary(
    occupancy.length,
    connector,
    connectorType,
  );

  return (
    <>
      <div
        className={`pr-2 py-0.5 text-[11px] cursor-pointer flex items-center gap-1 ${
          isSelected
            ? 'bg-amber-900/30 text-amber-200'
            : 'text-zinc-300 hover:bg-zinc-800'
        }`}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => selectItem({ type: 'connector', id: connector.id })}
      >
        <button
          className="text-zinc-600 hover:text-zinc-400 text-[9px] w-3 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {expanded ? '▼' : '▶'}
        </button>
        <span className="font-medium truncate">{connector.name}</span>
        <span className="text-zinc-500 text-[10px] shrink-0">
          ({occupancySummary})
        </span>
        <TreeEntityActions type="connector" id={connector.id} />
      </div>
      {expanded &&
        occupancy.map((entry, index) => (
          <OccupancyRow
            key={`${entry.pathId}-${entry.pinNumber}-${index}`}
            pinNumber={entry.pinNumber}
            pathId={entry.pathId}
            depth={depth + 1}
          />
        ))}
    </>
  );
}

function MergePointRow({ mergePoint, depth }: { mergePoint: MergePoint; depth: number }) {
  const selectedItem = useHarnessStore((s) => s.selectedItem);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const isSelected =
    selectedItem?.type === 'mergePoint' && selectedItem.id === mergePoint.id;

  return (
    <div
      className={`pr-2 py-0.5 text-[11px] cursor-pointer flex items-center gap-1 ${
        isSelected ? 'bg-amber-900/30 text-amber-200' : 'text-cyan-300 hover:bg-zinc-800'
      }`}
      style={{ paddingLeft: depth * 16 + 8 }}
      onClick={() => selectItem({ type: 'mergePoint', id: mergePoint.id })}
    >
      <span className="text-cyan-500">+</span>
      <span className="truncate">{mergePoint.name}</span>
      <TreeEntityActions type="mergePoint" id={mergePoint.id} />
    </div>
  );
}

function EnclosureRow({
  enclosure,
  allEnclosures,
  allConnectors,
  allMergePoints,
  depth = 0,
  query,
  visibleIds,
  expandedIds,
  toggleExpanded,
}: {
  enclosure: Enclosure;
  allEnclosures: Enclosure[];
  allConnectors: Connector[];
  allMergePoints: MergePoint[];
  depth?: number;
  query: string;
  visibleIds: Set<string>;
  expandedIds: Set<string>;
  toggleExpanded: (id: string) => void;
}) {
  const selectedItem = useHarnessStore((s) => s.selectedItem);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const setDrillDown = useHarnessStore((s) => s.setDrillDown);
  const isSelected =
    selectedItem?.type === 'enclosure' && selectedItem.id === enclosure.id;

  const childEnclosures = allEnclosures.filter(
    (e) => e.parent === enclosure.id && (!query || visibleIds.has(e.id)),
  );
  const directConnectors = allConnectors.filter(
    (c) => c.parent === enclosure.id && (!query || visibleIds.has(c.id)),
  );
  const directMergePoints = allMergePoints.filter(
    (mergePoint) => mergePoint.parent === enclosure.id && (!query || visibleIds.has(mergePoint.id)),
  );

  const isContainer = enclosure.container;
  const isExpanded = !!query || expandedIds.has(enclosure.id);

  const icon = isContainer ? (
    <svg className="w-3.5 h-3.5 text-zinc-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
    </svg>
  ) : (
    <svg className="w-3.5 h-3.5 text-teal-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <circle cx="8" cy="12" r="1.5" />
      <circle cx="16" cy="12" r="1.5" />
    </svg>
  );

  return (
    <>
      <div
        className={`pr-2 py-1 text-xs cursor-pointer flex items-center gap-1 ${
          isSelected
            ? 'bg-amber-900/30 text-amber-200'
            : isContainer
            ? 'text-zinc-200 hover:bg-zinc-800'
            : 'text-teal-300 hover:bg-zinc-800'
        }`}
        style={{ paddingLeft: depth * 16 + 4 }}
        onClick={() =>
          selectItem({ type: 'enclosure', id: enclosure.id })
        }
        onDoubleClick={() => {
          if (isContainer) setDrillDown(enclosure.id);
        }}
      >
        <button
          className="text-zinc-600 hover:text-zinc-400 text-[9px] w-4 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            toggleExpanded(enclosure.id);
          }}
        >
          {isExpanded ? '▼' : '▶'}
        </button>
        {icon}
        <span className="font-medium truncate">{enclosure.name}</span>
        <TreeEntityActions type="enclosure" id={enclosure.id} />
      </div>
      {isExpanded && (
        <>
          {childEnclosures.map((child) => (
            <EnclosureRow
              key={child.id}
              enclosure={child}
              allEnclosures={allEnclosures}
              allConnectors={allConnectors}
              allMergePoints={allMergePoints}
              depth={depth + 1}
              query={query}
              visibleIds={visibleIds}
              expandedIds={expandedIds}
              toggleExpanded={toggleExpanded}
            />
          ))}
          {directConnectors.map((c) => (
            <ConnectorRow key={c.id} connector={c} depth={depth + 2} />
          ))}
          {directMergePoints.map((mergePoint) => (
            <MergePointRow key={mergePoint.id} mergePoint={mergePoint} depth={depth + 2} />
          ))}
        </>
      )}
    </>
  );
}

/** Collect IDs that match the query, plus all ancestors needed to show them. */
function buildVisibleIds(
  query: string,
  enclosures: Enclosure[],
  connectors: Connector[],
  mergePoints: MergePoint[],
): Set<string> {
  const visible = new Set<string>();
  if (!query) return visible;

  const parentById = new Map<string, string | null>();
  for (const e of enclosures) parentById.set(e.id, e.parent);
  for (const c of connectors) parentById.set(c.id, c.parent);
  for (const m of mergePoints) parentById.set(m.id, m.parent);

  const markWithAncestors = (id: string) => {
    let current: string | null | undefined = id;
    while (current) {
      if (visible.has(current)) break;
      visible.add(current);
      current = parentById.get(current) ?? null;
    }
  };

  for (const e of enclosures) {
    if (matchesQuery(e.name, query) || matchesQuery(e.id, query)) markWithAncestors(e.id);
  }
  for (const c of connectors) {
    if (matchesQuery(c.name, query) || matchesQuery(c.id, query)) markWithAncestors(c.id);
  }
  for (const m of mergePoints) {
    if (matchesQuery(m.name, query) || matchesQuery(m.id, query)) markWithAncestors(m.id);
  }

  return visible;
}

export function TreeView() {
  const harness = useHarnessStore((s) => s.harness);
  const isEditor = useHarnessStore((s) => s.session.isEditor);
  const [search, setSearch] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const query = search.trim().toLowerCase();

  const visibleIds = useMemo(() => {
    if (!harness || !query) return new Set<string>();
    return buildVisibleIds(query, harness.enclosures, harness.connectors, harness.mergePoints);
  }, [harness, query]);

  if (!harness) return null;

  const rootEnclosures = harness.enclosures.filter(
    (e) => e.parent === null && (!query || visibleIds.has(e.id)),
  );
  const rootConnectors = harness.connectors.filter(
    (c) => c.parent === null && (!query || visibleIds.has(c.id)),
  );
  const rootMergePoints = harness.mergePoints.filter(
    (mergePoint) => mergePoint.parent === null && (!query || visibleIds.has(mergePoint.id)),
  );

  const empty = query && rootEnclosures.length === 0 && rootConnectors.length === 0 && rootMergePoints.length === 0;
  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const revealCreatedParent = (parentId: string | null) => {
    setSearch('');
    if (!parentId) return;
    setExpandedIds((current) => {
      const next = new Set(current);
      let currentId: string | null = parentId;
      while (currentId) {
        next.add(currentId);
        currentId = harness.enclosures.find((item) => item.id === currentId)?.parent ?? null;
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full select-none">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-zinc-800 shrink-0">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search hierarchy…"
          className="min-w-0 flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
        />
        <button
          type="button"
          disabled={!isEditor}
          onClick={() => setCreateModalOpen(true)}
          title={isEditor ? 'Add a device or enclosure' : 'Log in to add a device or enclosure'}
          aria-label="Add a device or enclosure"
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded border border-zinc-700 bg-zinc-800 text-base leading-none text-zinc-300 transition-colors hover:border-amber-600 hover:bg-amber-950/40 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:bg-zinc-800 disabled:hover:text-zinc-300"
        >
          +
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {empty ? (
          <div className="px-3 py-2 text-[11px] text-zinc-600">No matches</div>
        ) : (
          <>
            {rootEnclosures.map((enc) => (
              <EnclosureRow
                key={enc.id}
                enclosure={enc}
                allEnclosures={harness.enclosures}
                allConnectors={harness.connectors}
                allMergePoints={harness.mergePoints}
                query={query}
                visibleIds={visibleIds}
                expandedIds={expandedIds}
                toggleExpanded={toggleExpanded}
              />
            ))}
            {rootMergePoints.map((mergePoint) => (
              <MergePointRow key={mergePoint.id} mergePoint={mergePoint} depth={0} />
            ))}
            {rootConnectors.length > 0 && (
              <>
                <div className="px-2 py-1 text-[10px] text-zinc-500 font-medium uppercase tracking-wider border-t border-zinc-800 mt-1">
                  Free Connectors
                </div>
                {rootConnectors.map((c) => (
                  <ConnectorRow key={c.id} connector={c} depth={0} />
                ))}
              </>
            )}
          </>
        )}
      </div>
      {createModalOpen && (
        <CreateHierarchyEntityModal
          onClose={() => setCreateModalOpen(false)}
          onCreated={revealCreatedParent}
        />
      )}
    </div>
  );
}
