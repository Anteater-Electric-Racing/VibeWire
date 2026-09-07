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
import { useSystemStore } from '../../store';
import type { HierarchyEntity, Connector, BranchPoint, EntityType } from '../../types';
import {
  formatConnectorOccupancySummary,
  getConnectorOccupancy,
  getConnectorSignalGroups,
  type ConnectorSignalGroup,
  type HierarchyEntityKind,
} from '../../lib/systemTopology';
import { readableColorOnBackground } from '../../lib/colors';
import { buildHierarchySearch, matchesQuery } from '../../lib/hierarchyTree';
import { canvasImageContextKey, imageMatchesContext } from '../../lib/canvasImages';
import { WireColorSwatch } from '../WireColorEditor';
import { CreateHierarchyEntityModal } from './CreateHierarchyEntityModal';
import { PresenceBadge } from '../collab/PresenceBadge';

const DRAG_THRESHOLD_PX = 5;

type TreeDropdownKind = 'enclosure' | 'connector' | 'signalGroup';

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
  expandedConnectorIds: ReadonlySet<string>;
  expandedSignalGroupIds: ReadonlySet<string>;
  toggleDropdown: (kind: TreeDropdownKind, id: string) => void;
  onRowPointerDown: (
    event: ReactPointerEvent,
    item: TreeDragItem,
  ) => void;
};

const TreeDragContext = createContext<TreeDragContextValue>({
  canDrag: false,
  dragItem: null,
  dropTarget: null,
  expandedConnectorIds: new Set(),
  expandedSignalGroupIds: new Set(),
  toggleDropdown: () => {},
  onRowPointerDown: () => {},
});

function addToIdSet(current: Set<string>, id: string): Set<string> {
  if (current.has(id)) return current;
  const next = new Set(current);
  next.add(id);
  return next;
}

function toggleIdSet(current: Set<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function dropdownFromRow(row: Element | null): { kind: TreeDropdownKind; id: string } | null {
  const el = row?.closest<HTMLElement>('[data-tree-type][data-tree-id]');
  const type = el?.dataset.treeType;
  const id = el?.dataset.treeId;
  if (!el || !type || !id) return null;
  if (type === 'enclosure' || type === 'connector' || type === 'signalGroup') {
    return { kind: type, id };
  }
  return null;
}

function isAncestorEnclosure(
  enclosures: HierarchyEntity[],
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
  enclosures: HierarchyEntity[],
): boolean {
  if (targetParentId === null) return true;
  const parent = enclosures.find((item) => item.id === targetParentId);
  if (!parent) return false;
  if (drag.type === 'enclosure') {
    if (parent.kind === 'device') return false;
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
  enclosures: HierarchyEntity[],
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

function TreeEntityActions({ type, id }: { type: Extract<EntityType, 'enclosure' | 'connector' | 'branchPoint'>; id: string }) {
  const editingSurface = useSystemStore((s) => s.editingSurface);
  const activeSubsystemId = useSystemStore((s) => s.activeSubsystemId);
  const addEntity = useSystemStore((s) => s.addEntityToActiveSubsystem);
  const getDeleteImpact = useSystemStore((s) => s.getDeleteImpact);
  const deleteEntity = useSystemStore((s) => s.deleteEntityCascade);
  const findEntity = useSystemStore((s) => s.findEntity);
  const renameEntity = useSystemStore((s) => s.renameEntity);
  const isEditor = useSystemStore((s) => s.session.isEditor);

  const promptRename = () => {
    const entity = findEntity(type, id);
    if (!entity) return;
    const input = window.prompt(
      `Rename ${type === 'branchPoint' ? 'branch point' : type}.\n\nIts stable ID will remain "${id}".`,
      entity.name,
    );
    if (input !== null && input.trim()) renameEntity(type, id, input);
  };

  const confirmDelete = () => {
    const impact = getDeleteImpact(type, id);
    if (type === 'branchPoint') {
      const orphanNote = impact.pathIds.length > 0
        ? `\n\n${impact.pathIds.length} unpairable stub path(s) will be removed.`
        : '';
      if (window.confirm(
        `Delete branch point ${id}?\n\nPaths through it will reconnect as if the branch point was never there.${orphanNote}`,
      )) {
        deleteEntity(type, id);
      }
      return;
    }
    const summary = [
      `${impact.enclosureIds.length} enclosure/device`,
      `${impact.connectorIds.length} connector`,
      `${impact.branchPointIds.length} branch point`,
      `${impact.pathIds.length} path`,
    ].join(', ');
    if (window.confirm(`Permanently delete ${id}?\n\nThis will also delete: ${summary}.\n\nYou can restore it with Undo.`)) {
      deleteEntity(type, id);
    }
  };

  return (
    <span className="ml-auto flex items-center gap-1 shrink-0">
      {editingSurface === 'subsystem' && activeSubsystemId && type !== 'branchPoint' && (
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
  const { canDrag, dragItem, dropTarget, onRowPointerDown, toggleDropdown } = useContext(TreeDragContext);
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
        className={`pr-2 text-[11px] flex min-w-0 items-center gap-1 ${
          canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
        } ${selected ? 'bg-amber-900/30 text-amber-200' : className} ${
          isDragging ? 'opacity-40' : ''
        } ${isIntoTarget ? 'ring-1 ring-inset ring-amber-400/80 bg-amber-900/20' : ''}`}
        style={{ paddingLeft: depth * 16 + (type === 'enclosure' ? 4 : 8), paddingTop: type === 'enclosure' ? 4 : 2, paddingBottom: type === 'enclosure' ? 4 : 2 }}
        onClick={onClick}
        onDoubleClick={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest('button')) return;
          if (type === 'enclosure' || type === 'connector') toggleDropdown(type, id);
          onDoubleClick?.();
        }}
        onPointerDown={(event) => {
          if (event.shiftKey) return;
          if (!canDrag) return;
          if (event.button !== 0) return;
          const target = event.target as HTMLElement | null;
          if (target?.closest('button')) return;
          onRowPointerDown(event, { type, id, parentId, label });
        }}
      >
        <PresenceBadge kind={type} id={id} className="shrink-0" />
        {children}
      </div>
      <DropIndicator show={showAfter} />
    </>
  );
}

function TreeToggleButton({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="text-zinc-600 hover:text-zinc-400 text-[9px] w-4 shrink-0"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      {expanded ? '▼' : '▶'}
    </button>
  );
}

function ConnectorPathRow({
  pathId,
  pathName,
  pinNumbers,
  depth,
}: {
  pathId: string;
  pathName: string;
  pinNumbers: number[];
  depth: number;
}) {
  const selectedItem = useSystemStore((s) => s.selectedItem);
  const selectItem = useSystemStore((s) => s.selectItem);
  const isSelected = selectedItem?.type === 'path' && selectedItem.id === pathId;
  const pinLabel = pinNumbers.join('/');

  return (
    <div
      className={`pr-2 py-0.5 text-[11px] cursor-pointer flex min-w-0 items-center gap-1.5 ${
        isSelected
          ? 'bg-amber-900/30 text-amber-200'
          : 'text-zinc-400 hover:bg-zinc-800'
      }`}
      style={{ paddingLeft: (depth + 1) * 16 + 8 }}
      onClick={() => selectItem({ type: 'path', id: pathId })}
    >
      <PresenceBadge kind="path" id={pathId} className="shrink-0" />
      {pinLabel && (
        <span className="text-zinc-600 font-mono text-[10px] shrink-0 text-right">
          {pinLabel}
        </span>
      )}
      <span className="truncate">{pathName || pathId}</span>
    </div>
  );
}

function ConnectorSignalRow({
  group,
  connectorId,
  depth,
}: {
  group: ConnectorSignalGroup;
  connectorId: string;
  depth: number;
}) {
  const { expandedSignalGroupIds, toggleDropdown } = useContext(TreeDragContext);
  const dropdownId = `${connectorId}:${group.key}`;
  const expanded = expandedSignalGroupIds.has(dropdownId);
  const selectedItem = useSystemStore((s) => s.selectedItem);
  const selectItem = useSystemStore((s) => s.selectItem);
  const isSelected = Boolean(
    group.signalId && selectedItem?.type === 'signal' && selectedItem.id === group.signalId,
  );
  const labelColor = group.signalId
    ? readableColorOnBackground(group.appearance.primaryColor)
    : undefined;

  return (
    <>
      <div
        data-tree-type="signalGroup"
        data-tree-id={dropdownId}
        className={`pr-2 py-0.5 text-[11px] flex min-w-0 items-center gap-1.5 ${
          group.signalId ? 'cursor-pointer' : 'cursor-default'
        } ${
          isSelected
            ? 'bg-amber-900/30'
            : 'hover:bg-zinc-800'
        }`}
        style={{ paddingLeft: (depth + 1) * 16 + 8 }}
        onClick={() => {
          if (group.signalId) selectItem({ type: 'signal', id: group.signalId });
        }}
        onDoubleClick={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest('button')) return;
          toggleDropdown('signalGroup', dropdownId);
        }}
      >
        {group.signalId && (
          <PresenceBadge kind="signal" id={group.signalId} className="shrink-0" />
        )}
        <TreeToggleButton expanded={expanded} onToggle={() => toggleDropdown('signalGroup', dropdownId)} />
        <span className="inline-flex shrink-0 rounded-full ring-1 ring-zinc-500/70">
          <WireColorSwatch
            appearance={group.appearance}
            className="w-2 h-2 rounded-full"
          />
        </span>
        <span
          className={`font-medium truncate ${group.signalId ? '' : 'text-zinc-500 italic'}`}
          style={labelColor ? { color: labelColor } : undefined}
        >
          {group.signalName}
        </span>
      </div>
      {expanded && group.paths.map((path) => (
        <ConnectorPathRow
          key={path.pathId}
          pathId={path.pathId}
          pathName={path.pathName}
          pinNumbers={path.pinNumbers}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

function ConnectorRow({
  connector,
  depth,
}: {
  connector: Connector;
  depth: number;
}) {
  const { expandedConnectorIds, toggleDropdown } = useContext(TreeDragContext);
  const expanded = expandedConnectorIds.has(connector.id);
  const selectedItem = useSystemStore((s) => s.selectedItem);
  const selectItem = useSystemStore((s) => s.selectItem);
  const system = useSystemStore((s) => s.system);
  const connectorLibrary = useSystemStore((s) => s.connectorLibrary);
  const isSelected =
    selectedItem?.type === 'connector' && selectedItem.id === connector.id;
  const occupancy = system ? getConnectorOccupancy(system, connector.id) : [];
  const signalGroups = system ? getConnectorSignalGroups(system, connector.id) : [];
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
        <TreeToggleButton expanded={expanded} onToggle={() => toggleDropdown('connector', connector.id)} />
        <div className="min-w-0 flex-1 flex items-center gap-1">
          <span className="font-medium min-w-[4.5rem] grow-0 shrink basis-auto truncate text-vw-connector">
            {connector.name}
          </span>
          <span className="min-w-0 flex-1 truncate text-zinc-500 text-[10px]">
            ({occupancySummary})
          </span>
        </div>
        <TreeEntityActions type="connector" id={connector.id} />
      </TreeRowShell>
      {expanded &&
        signalGroups.map((group) => (
          <ConnectorSignalRow
            key={group.key}
            group={group}
            connectorId={connector.id}
            depth={depth + 1}
          />
        ))}
    </>
  );
}

function BranchPointRow({ branchPoint, depth }: { branchPoint: BranchPoint; depth: number }) {
  const selectedItem = useSystemStore((s) => s.selectedItem);
  const selectItem = useSystemStore((s) => s.selectItem);
  const isSelected =
    selectedItem?.type === 'branchPoint' && selectedItem.id === branchPoint.id;

  return (
    <TreeRowShell
      type="branchPoint"
      id={branchPoint.id}
      parentId={branchPoint.parent}
      label={branchPoint.name}
      depth={depth}
      selected={isSelected}
      className="text-cyan-300 hover:bg-zinc-800"
      onClick={() => selectItem({ type: 'branchPoint', id: branchPoint.id })}
    >
      <span className="text-cyan-500">+</span>
      <span className="truncate">{branchPoint.name}</span>
      <TreeEntityActions type="branchPoint" id={branchPoint.id} />
    </TreeRowShell>
  );
}

function EnclosureRow({
  enclosure,
  allEnclosures,
  allConnectors,
  allBranchPoints,
  depth = 0,
  query,
  visibleIds,
  expandedIds,
  toggleExpanded,
}: {
  enclosure: HierarchyEntity;
  allEnclosures: HierarchyEntity[];
  allConnectors: Connector[];
  allBranchPoints: BranchPoint[];
  depth?: number;
  query: string;
  visibleIds: Set<string>;
  expandedIds: Set<string>;
  toggleExpanded: (id: string) => void;
}) {
  const selectedItem = useSystemStore((s) => s.selectedItem);
  const selectItem = useSystemStore((s) => s.selectItem);
  const isSelected =
    selectedItem?.type === 'enclosure' && selectedItem.id === enclosure.id;

  const childEnclosures = allEnclosures.filter(
    (e) => e.parent === enclosure.id && (!query || visibleIds.has(e.id)),
  );
  const directConnectors = allConnectors.filter(
    (c) => c.parent === enclosure.id && (!query || visibleIds.has(c.id)),
  );
  const directBranchPoints = allBranchPoints.filter(
    (branchPoint) => branchPoint.parent === enclosure.id && (!query || visibleIds.has(branchPoint.id)),
  );

  const isContainer = enclosure.kind === 'enclosure';
  const isExpanded = expandedIds.has(enclosure.id);

  const icon = isContainer ? (
    <svg className="w-3.5 h-3.5 text-vw-enclosure shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
    </svg>
  ) : (
    <svg className="w-3.5 h-3.5 text-vw-device shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
        className="hover:bg-zinc-800 text-xs"
        onClick={() => selectItem({ type: 'enclosure', id: enclosure.id })}
      >
        <TreeToggleButton
          expanded={isExpanded}
          onToggle={() => toggleExpanded(enclosure.id)}
        />
        {icon}
        <span className={`font-medium truncate ${isContainer ? 'text-vw-enclosure' : 'text-vw-device'}`}>{enclosure.name}</span>
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
              allBranchPoints={allBranchPoints}
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
          {directBranchPoints.map((branchPoint) => (
            <BranchPointRow key={branchPoint.id} branchPoint={branchPoint} depth={depth + 2} />
          ))}
        </>
      )}
    </>
  );
}

function AnnotationRow({
  kind,
  id,
  label,
  selected,
  locked,
  onSelect,
  onDelete,
}: {
  kind: 'image' | 'textBox';
  id: string;
  label: string;
  selected: boolean;
  locked?: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const isEditor = useSystemStore((s) => s.session.isEditor);
  return (
    <div
      role="button"
      tabIndex={0}
      className={`pr-2 py-0.5 text-[11px] cursor-pointer flex min-w-0 items-center gap-1.5 ${
        selected ? 'bg-amber-900/30 text-amber-200' : 'text-zinc-400 hover:bg-zinc-800'
      }`}
      style={{ paddingLeft: 8 }}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <PresenceBadge kind={kind} id={id} className="shrink-0" />
      {kind === 'image' ? (
        <span className="shrink-0 text-[10px]" aria-hidden>🖼</span>
      ) : (
        <span className="shrink-0 font-bold text-[11px] text-zinc-500">T</span>
      )}
      <span className="truncate flex-1">{label}</span>
      {locked && <span className="shrink-0 text-[9px] text-zinc-600">locked</span>}
      <button
        type="button"
        disabled={!isEditor}
        className="text-zinc-600 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-zinc-600"
        title={isEditor ? `Delete ${kind === 'image' ? 'image' : 'text box'}` : 'Log in to delete'}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      >
        ×
      </button>
    </div>
  );
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
  const system = useSystemStore((s) => s.system);
  const isEditor = useSystemStore((s) => s.session.isEditor);
  const moveHierarchyEntity = useSystemStore((s) => s.moveHierarchyEntity);
  const textBoxLayouts = useSystemStore((s) => s.textBoxLayouts);
  const imageLayouts = useSystemStore((s) => s.imageLayouts);
  const selectedTextBoxId = useSystemStore((s) => s.selectedTextBoxId);
  const selectedImageId = useSystemStore((s) => s.selectedImageId);
  const selectTextBox = useSystemStore((s) => s.selectTextBox);
  const selectImage = useSystemStore((s) => s.selectImage);
  const removeTextBox = useSystemStore((s) => s.removeTextBox);
  const removeImage = useSystemStore((s) => s.removeImage);
  const editingSurface = useSystemStore((s) => s.editingSurface);
  const openEnclosureId = useSystemStore((s) => s.openEnclosureId);
  const activeSubsystemId = useSystemStore((s) => s.activeSubsystemId);
  const [search, setSearch] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [expandedConnectorIds, setExpandedConnectorIds] = useState<Set<string>>(() => new Set());
  const [expandedSignalGroupIds, setExpandedSignalGroupIds] = useState<Set<string>>(() => new Set());
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

  const searchResult = useMemo(() => {
    if (!system || !query) {
      return { visibleIds: new Set<string>(), expandedIds: new Set<string>() };
    }
    return buildHierarchySearch(
      query,
      system.hierarchy,
      system.connectors,
      system.branchPoints,
      system.paths,
      system.signals,
    );
  }, [system, query]);
  const visibleIds = searchResult.visibleIds;
  const [prevQuery, setPrevQuery] = useState(query);
  if (query !== prevQuery) {
    setPrevQuery(query);
    if (query) {
      setExpandedIds((current) => {
        let changed = false;
        const next = new Set(current);
        for (const id of searchResult.expandedIds) {
          if (!next.has(id)) {
            next.add(id);
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }
  }

  useEffect(() => () => {
    cleanupRef.current?.();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isEditor || createModalOpen) return;
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.isContentEditable;
      if (isTyping || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return;
      if (event.key !== 'n' && event.key !== 'N') return;
      event.preventDefault();
      setCreateModalOpen(true);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isEditor, createModalOpen]);

  const openDropdown = useCallback((kind: TreeDropdownKind, id: string) => {
    if (kind === 'enclosure') {
      setExpandedIds((current) => addToIdSet(current, id));
      return;
    }
    if (kind === 'connector') {
      setExpandedConnectorIds((current) => addToIdSet(current, id));
      return;
    }
    setExpandedSignalGroupIds((current) => addToIdSet(current, id));
  }, []);

  const toggleDropdown = useCallback((kind: TreeDropdownKind, id: string) => {
    if (kind === 'enclosure') {
      setExpandedIds((current) => toggleIdSet(current, id));
      return;
    }
    if (kind === 'connector') {
      setExpandedConnectorIds((current) => toggleIdSet(current, id));
      return;
    }
    setExpandedSignalGroupIds((current) => toggleIdSet(current, id));
  }, []);

  const onTreePointerDown = useCallback((event: ReactPointerEvent) => {
    if (event.button !== 0 || !event.shiftKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, textarea')) return;
    const first = dropdownFromRow(target);
    if (!first) return;

    event.preventDefault();
    cleanupRef.current?.();
    openDropdown(first.kind, first.id);

    const pointerId = event.pointerId;
    const painted = new Set([`${first.kind}:${first.id}`]);

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      const under = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY);
      const next = dropdownFromRow(under);
      if (!next) return;
      const key = `${next.kind}:${next.id}`;
      if (painted.has(key)) return;
      painted.add(key);
      openDropdown(next.kind, next.id);
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerUp, true);
      cleanupRef.current = null;
    };

    const handlePointerUp = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      cleanup();
    };

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerUp, true);
    cleanupRef.current = cleanup;
  }, [openDropdown]);

  const applyDrop = useCallback((item: TreeDragItem, target: TreeDropTarget | null) => {
    if (!system || !target) return;

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
      item.type === 'enclosure' ? system.hierarchy
        : item.type === 'connector' ? system.connectors
          : system.branchPoints;
    const beforeId =
      target.mode === 'before'
        ? target.id
        : nextSiblingId(collection, target.parentId, target.id);
    moveHierarchyEntity(item.type, item.id, target.parentId, beforeId);
  }, [system, moveHierarchyEntity]);

  const onRowPointerDown = useCallback((
    event: ReactPointerEvent,
    item: TreeDragItem,
  ) => {
    if (!canDrag || !system) return;

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
        system.hierarchy,
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
  }, [applyDrop, canDrag, system]);

  const dragContext = useMemo<TreeDragContextValue>(() => ({
    canDrag,
    dragItem,
    dropTarget,
    expandedConnectorIds,
    expandedSignalGroupIds,
    toggleDropdown,
    onRowPointerDown,
  }), [
    canDrag,
    dragItem,
    dropTarget,
    expandedConnectorIds,
    expandedSignalGroupIds,
    toggleDropdown,
    onRowPointerDown,
  ]);

  if (!system) return null;

  const rootEnclosures = system.hierarchy.filter(
    (e) => e.parent === null && (!query || visibleIds.has(e.id)),
  );
  const rootConnectors = system.connectors.filter(
    (c) => c.parent === null && (!query || visibleIds.has(c.id)),
  );
  const rootBranchPoints = system.branchPoints.filter(
    (branchPoint) => branchPoint.parent === null && (!query || visibleIds.has(branchPoint.id)),
  );
  const imageContextKey = canvasImageContextKey(
    editingSurface,
    openEnclosureId,
    activeSubsystemId,
  );
  const annotationImages = Object.values(imageLayouts)
    .filter((img) => {
      const matches = !query || matchesQuery(img.name, query) || matchesQuery(img.image, query);
      if (!matches) return false;
      if (query) return true;
      return imageMatchesContext(img.contextKey, imageContextKey);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const annotationTextBoxes = Object.values(textBoxLayouts)
    .filter((tb) => {
      const label = tb.text.trim() || 'Text box';
      return !query || matchesQuery(label, query) || matchesQuery(tb.id, query);
    })
    .sort((a, b) => (a.text.trim() || a.id).localeCompare(b.text.trim() || b.id));

  const empty = query
    && rootEnclosures.length === 0
    && rootConnectors.length === 0
    && rootBranchPoints.length === 0
    && annotationImages.length === 0
    && annotationTextBoxes.length === 0;
  const toggleExpanded = (id: string) => toggleDropdown('enclosure', id);
  const revealCreatedParent = (parentId: string | null) => {
    setSearch('');
    if (!parentId) return;
    setExpandedIds((current) => {
      const next = new Set(current);
      let currentId: string | null = parentId;
      while (currentId) {
        next.add(currentId);
        currentId = system.hierarchy.find((item) => item.id === currentId)?.parent ?? null;
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
            title={isEditor ? 'Add a device or enclosure (N)' : 'Log in to add a device or enclosure'}
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
          onPointerDown={onTreePointerDown}
        >
          {empty ? (
            <div className="px-3 py-2 text-[11px] text-zinc-600">No matches</div>
          ) : (
            <>
              {rootEnclosures.map((enc) => (
                <EnclosureRow
                  key={enc.id}
                  enclosure={enc}
                  allEnclosures={system.hierarchy}
                  allConnectors={system.connectors}
                  allBranchPoints={system.branchPoints}
                  query={query}
                  visibleIds={visibleIds}
                  expandedIds={expandedIds}
                  toggleExpanded={toggleExpanded}
                />
              ))}
              {rootBranchPoints.map((branchPoint) => (
                <BranchPointRow key={branchPoint.id} branchPoint={branchPoint} depth={0} />
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
              {(annotationImages.length > 0 || annotationTextBoxes.length > 0) && (
                <>
                  <div className="px-2 py-1 text-[10px] text-zinc-500 font-medium uppercase tracking-wider border-t border-zinc-800 mt-1">
                    Images &amp; text
                  </div>
                  {annotationImages.map((img) => (
                    <AnnotationRow
                      key={img.id}
                      kind="image"
                      id={img.id}
                      label={img.name}
                      selected={selectedImageId === img.id}
                      locked={img.locked}
                      onSelect={() => selectImage(img.id)}
                      onDelete={() => removeImage(img.id)}
                    />
                  ))}
                  {annotationTextBoxes.map((tb) => (
                    <AnnotationRow
                      key={tb.id}
                      kind="textBox"
                      id={tb.id}
                      label={tb.text.trim() || 'Text box'}
                      selected={selectedTextBoxId === tb.id}
                      onSelect={() => selectTextBox(tb.id)}
                      onDelete={() => removeTextBox(tb.id)}
                    />
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
            onCreated={(parentId) => {
              revealCreatedParent(parentId);
              const state = useSystemStore.getState();
              if (
                state.editingSurface === 'subsystem'
                && state.selectedItem?.type === 'enclosure'
              ) {
                state.addEntityToActiveSubsystem('enclosure', state.selectedItem.id);
              }
            }}
          />
        )}
      </div>
    </TreeDragContext.Provider>
  );
}
