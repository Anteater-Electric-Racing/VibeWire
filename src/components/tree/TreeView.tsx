import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useHarnessStore } from '../../store';
import type { Enclosure, Connector, MergePoint } from '../../types';
import { formatConnectorOccupancySummary, getConnectorOccupancy } from '../../lib/harness';
import type { HierarchyEntityKind } from '../../lib/harness';
import type { EntityType } from '../../types';
import { CreateHierarchyEntityModal } from './CreateHierarchyEntityModal';

const DRAG_THRESHOLD_PX = 5;

type TreeDragItem = {
  type: HierarchyEntityKind;
  id: string;
  parentId: string | null;
  label: string;
};

type TreeDropTarget =
  | { mode: 'into'; parentId: string | null }
  | {
      mode: 'before' | 'after';
      type: HierarchyEntityKind;
      id: string;
      parentId: string | null;
    };

type TreeDragContextValue = {
  canDrag: boolean;
  dragItem: TreeDragItem | null;
  dropTarget: TreeDropTarget | null;
  onRowPointerDown: (
    event: ReactPointerEvent,
    item: TreeDragItem,
  ) => void;
};

const TreeDragContext = createContext<TreeDragContextValue>({
  canDrag: false,
  dragItem: null,
  dropTarget: null,
  onRowPointerDown: () => {},
});

function matchesQuery(text: string, query: string): boolean {
  return text.toLowerCase().includes(query);
}

function isAncestorEnclosure(
  enclosures: Enclosure[],
  ancestorId: string,
  descendantId: string,
): boolean {
  const parentById = new Map(enclosures.map((item) => [item.id, item.parent]));
  let current: string | null = descendantId;
  const visited = new Set<string>();
  while (current) {
    if (current === ancestorId) return true;
    if (visited.has(current)) break;
    visited.add(current);
    current = parentById.get(current) ?? null;
  }
  return false;
}

function canDropInto(
  drag: TreeDragItem,
  targetParentId: string | null,
  enclosures: Enclosure[],
): boolean {
  if (targetParentId === null) return true;
  const parent = enclosures.find((item) => item.id === targetParentId);
  if (!parent) return false;
  if (drag.type === 'enclosure') {
    if (!parent.container) return false;
    if (drag.id === targetParentId) return false;
    if (isAncestorEnclosure(enclosures, drag.id, targetParentId)) return false;
    return true;
  }
  return true;
}

function resolveDropTarget(
  drag: TreeDragItem,
  el: Element | null,
  clientY: number,
  enclosures: Enclosure[],
): TreeDropTarget | null {
  // Prefer the concrete row under the pointer; the scroll pane is also a root
  // drop zone and would otherwise always win via closest().
  const row = el?.closest<HTMLElement>('[data-tree-type][data-tree-id]');
  if (row) {
    const type = row.dataset.treeType as HierarchyEntityKind | undefined;
    const id = row.dataset.treeId;
    const parentId = row.dataset.treeParentId === '' ? null : (row.dataset.treeParentId ?? null);
    const container = row.dataset.treeContainer === 'true';
    if (!type || !id) return null;
    if (id === drag.id && type === drag.type) return null;

    const rect = row.getBoundingClientRect();
    const ratio = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;

    const intoParentId = type === 'enclosure' ? id : null;
    const canNestHere =
      intoParentId !== null
      && canDropInto(drag, intoParentId, enclosures)
      && (drag.type !== 'enclosure' || container);

    if (canNestHere && ratio > 0.28 && ratio < 0.72) {
      return { mode: 'into', parentId: intoParentId };
    }

    // Same-kind sibling reorder under the hovered row's parent.
    if (type === drag.type && canDropInto(drag, parentId, enclosures)) {
      return {
        mode: ratio < 0.5 ? 'before' : 'after',
        type,
        id,
        parentId,
      };
    }

    // Cross-kind: nest into a container/device when possible; otherwise adopt
    // the hovered row's parent.
    if (canNestHere) {
      return { mode: 'into', parentId: intoParentId };
    }
    if (canDropInto(drag, parentId, enclosures)) {
      return { mode: 'into', parentId };
    }
    return null;
  }

  const zone = el?.closest<HTMLElement>('[data-tree-drop]');
  if (zone?.dataset.treeDrop === 'root-connectors') {
    return drag.type === 'connector' ? { mode: 'into', parentId: null } : null;
  }
  if (zone?.dataset.treeDrop === 'root') {
    return canDropInto(drag, null, enclosures) ? { mode: 'into', parentId: null } : null;
  }
  return null;
}

function dropTargetKey(target: TreeDropTarget | null): string {
  if (!target) return '';
  if (target.mode === 'into') return `into:${target.parentId ?? ''}`;
  return `${target.mode}:${target.type}:${target.id}`;
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
        className="flex h-5 w-5 items-center justify-center text-sm leading-none text-zinc-500 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-zinc-500"
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

function DropIndicator({ show }: { show: boolean }) {
  if (!show) return null;
  return <div className="mx-2 h-0.5 rounded-full bg-amber-400 shadow-[0_0_0_1px_rgba(251,191,36,0.35)]" />;
}

function TreeRowShell({
  type,
  id,
  parentId,
  label,
  container,
  depth,
  selected,
  className,
  onClick,
  onDoubleClick,
  children,
}: {
  type: HierarchyEntityKind;
  id: string;
  parentId: string | null;
  label: string;
  container?: boolean;
  depth: number;
  selected: boolean;
  className: string;
  onClick: () => void;
  onDoubleClick?: () => void;
  children: ReactNode;
}) {
  const { canDrag, dragItem, dropTarget, onRowPointerDown } = useContext(TreeDragContext);
  const isDragging = dragItem?.type === type && dragItem.id === id;
  const isIntoTarget =
    dropTarget?.mode === 'into'
    && type === 'enclosure'
    && dropTarget.parentId === id;
  const showBefore =
    dropTarget?.mode === 'before'
    && dropTarget.type === type
    && dropTarget.id === id;
  const showAfter =
    dropTarget?.mode === 'after'
    && dropTarget.type === type
    && dropTarget.id === id;

  return (
    <>
      <DropIndicator show={showBefore} />
      <div
        data-tree-type={type}
        data-tree-id={id}
        data-tree-parent-id={parentId ?? ''}
        data-tree-container={container ? 'true' : 'false'}
        className={`pr-2 text-[11px] flex items-center gap-1 ${
          canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
        } ${selected ? 'bg-amber-900/30 text-amber-200' : className} ${
          isDragging ? 'opacity-40' : ''
        } ${isIntoTarget ? 'ring-1 ring-inset ring-amber-400/80 bg-amber-900/20' : ''}`}
        style={{ paddingLeft: depth * 16 + (type === 'enclosure' ? 4 : 8), paddingTop: type === 'enclosure' ? 4 : 2, paddingBottom: type === 'enclosure' ? 4 : 2 }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onPointerDown={(event) => {
          if (!canDrag) return;
          if (event.button !== 0) return;
          const target = event.target as HTMLElement | null;
          if (target?.closest('button')) return;
          onRowPointerDown(event, { type, id, parentId, label });
        }}
      >
        {children}
      </div>
      <DropIndicator show={showAfter} />
    </>
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
      <TreeRowShell
        type="connector"
        id={connector.id}
        parentId={connector.parent}
        label={connector.name}
        depth={depth}
        selected={isSelected}
        className="text-zinc-300 hover:bg-zinc-800"
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
      </TreeRowShell>
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
    <TreeRowShell
      type="mergePoint"
      id={mergePoint.id}
      parentId={mergePoint.parent}
      label={mergePoint.name}
      depth={depth}
      selected={isSelected}
      className="text-cyan-300 hover:bg-zinc-800"
      onClick={() => selectItem({ type: 'mergePoint', id: mergePoint.id })}
    >
      <span className="text-cyan-500">+</span>
      <span className="truncate">{mergePoint.name}</span>
      <TreeEntityActions type="mergePoint" id={mergePoint.id} />
    </TreeRowShell>
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
      <TreeRowShell
        type="enclosure"
        id={enclosure.id}
        parentId={enclosure.parent}
        label={enclosure.name}
        container={isContainer}
        depth={depth}
        selected={isSelected}
        className={
          isContainer
            ? 'text-zinc-200 hover:bg-zinc-800 text-xs'
            : 'text-teal-300 hover:bg-zinc-800 text-xs'
        }
        onClick={() => selectItem({ type: 'enclosure', id: enclosure.id })}
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
      </TreeRowShell>
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

function nextSiblingId(
  items: Array<{ id: string; parent: string | null }>,
  parentId: string | null,
  id: string,
): string | null {
  const siblings = items.filter((item) => item.parent === parentId);
  const index = siblings.findIndex((item) => item.id === id);
  if (index < 0) return null;
  return siblings[index + 1]?.id ?? null;
}

export function TreeView() {
  const harness = useHarnessStore((s) => s.harness);
  const isEditor = useHarnessStore((s) => s.session.isEditor);
  const moveHierarchyEntity = useHarnessStore((s) => s.moveHierarchyEntity);
  const [search, setSearch] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [dragItem, setDragItem] = useState<TreeDragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<TreeDropTarget | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const dragSessionRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    item: TreeDragItem;
    active: boolean;
    dropTarget: TreeDropTarget | null;
  } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const query = search.trim().toLowerCase();
  const canDrag = isEditor && !query;

  const visibleIds = useMemo(() => {
    if (!harness || !query) return new Set<string>();
    return buildVisibleIds(query, harness.enclosures, harness.connectors, harness.mergePoints);
  }, [harness, query]);

  useEffect(() => () => {
    cleanupRef.current?.();
  }, []);

  const applyDrop = useCallback((item: TreeDragItem, target: TreeDropTarget | null) => {
    if (!harness || !target) return;

    if (target.mode === 'into') {
      moveHierarchyEntity(item.type, item.id, target.parentId, null);
      if (target.parentId) {
        setExpandedIds((current) => {
          const next = new Set(current);
          next.add(target.parentId!);
          return next;
        });
      }
      return;
    }

    const collection =
      item.type === 'enclosure' ? harness.enclosures
        : item.type === 'connector' ? harness.connectors
          : harness.mergePoints;
    const beforeId =
      target.mode === 'before'
        ? target.id
        : nextSiblingId(collection, target.parentId, target.id);
    moveHierarchyEntity(item.type, item.id, target.parentId, beforeId);
  }, [harness, moveHierarchyEntity]);

  const onRowPointerDown = useCallback((
    event: ReactPointerEvent,
    item: TreeDragItem,
  ) => {
    if (!canDrag || !harness) return;

    cleanupRef.current?.();
    const pointerId = event.pointerId;
    const previousCursor = document.body.style.cursor;
    const session = {
      pointerId,
      startX: event.clientX,
      startY: event.clientY,
      item,
      active: false,
      dropTarget: null as TreeDropTarget | null,
    };
    dragSessionRef.current = session;

    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
      document.body.style.cursor = previousCursor;
      dragSessionRef.current = null;
      cleanupRef.current = null;
    };

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      const dx = pointerEvent.clientX - session.startX;
      const dy = pointerEvent.clientY - session.startY;
      if (!session.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        session.active = true;
        setDragItem(session.item);
        document.body.style.cursor = 'grabbing';
        // Once dragging, suppress text selection / native drag.
        pointerEvent.preventDefault();
      }

      const under = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY);
      const nextTarget = resolveDropTarget(
        session.item,
        under,
        pointerEvent.clientY,
        harness.enclosures,
      );
      session.dropTarget = nextTarget;
      setDropTarget((current) => (
        dropTargetKey(current) === dropTargetKey(nextTarget) ? current : nextTarget
      ));
      setGhost({
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
        label: session.item.label,
      });
    };

    const handlePointerUp = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      const active = session.active;
      const target = session.dropTarget;
      const dragged = session.item;
      cleanup();
      setDragItem(null);
      setDropTarget(null);
      setGhost(null);
      // Only commit when the pointer actually dragged; plain clicks still select.
      if (active) applyDrop(dragged, target);
    };

    const handlePointerCancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      cleanup();
      setDragItem(null);
      setDropTarget(null);
      setGhost(null);
    };

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerCancel, true);
    cleanupRef.current = () => {
      cleanup();
      setDragItem(null);
      setDropTarget(null);
      setGhost(null);
    };
  }, [applyDrop, canDrag, harness]);

  const dragContext = useMemo<TreeDragContextValue>(() => ({
    canDrag,
    dragItem,
    dropTarget,
    onRowPointerDown,
  }), [canDrag, dragItem, dropTarget, onRowPointerDown]);

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

  const rootIntoActive =
    dropTarget?.mode === 'into' && dropTarget.parentId === null && dragItem?.type !== 'connector';
  const freeConnectorsIntoActive =
    dropTarget?.mode === 'into' && dropTarget.parentId === null && dragItem?.type === 'connector';

  return (
    <TreeDragContext.Provider value={dragContext}>
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
        <div
          className={`flex-1 overflow-y-auto py-1 ${
            rootIntoActive ? 'bg-amber-950/20 ring-1 ring-inset ring-amber-500/30' : ''
          }`}
          data-tree-drop="root"
        >
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
              {(rootConnectors.length > 0 || (dragItem?.type === 'connector')) && (
                <>
                  <div
                    data-tree-drop="root-connectors"
                    className={`px-2 py-1 text-[10px] text-zinc-500 font-medium uppercase tracking-wider border-t border-zinc-800 mt-1 ${
                      freeConnectorsIntoActive ? 'bg-amber-900/30 text-amber-300' : ''
                    }`}
                  >
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
        {ghost && (
          <div
            className="pointer-events-none fixed z-50 max-w-[220px] truncate rounded border border-amber-500/60 bg-zinc-900/95 px-2 py-1 text-[11px] text-amber-100 shadow-lg"
            style={{ left: ghost.x + 12, top: ghost.y + 12 }}
          >
            {ghost.label}
          </div>
        )}
        {createModalOpen && (
          <CreateHierarchyEntityModal
            onClose={() => setCreateModalOpen(false)}
            onCreated={revealCreatedParent}
          />
        )}
      </div>
    </TreeDragContext.Provider>
  );
}
