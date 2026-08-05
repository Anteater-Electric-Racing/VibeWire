import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  ConnectionMode,
  Controls,
  Panel,
  SelectionMode,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useUpdateNodeInternals,
  type Node,
  type Edge,
  type OnNodesChange,
  type NodeChange,
  type Connection,
  type ReactFlowInstance,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useHarnessStore } from '../../store';
import type { ConnectorType } from '../../types';
import { EnclosureNode } from './EnclosureNode';
import { ConnectorNode } from './ConnectorNode';
import { MergePointNode } from './MergePointNode';
import { BundleEdge } from './BundleEdge';
import { BackgroundImageNode } from './BackgroundImageNode';
import { TextBoxNode } from './TextBoxNode';
import { ImagePickerPanel } from './ImagePickerPanel';
import { itemMatchesFilters } from '../../lib/tags';
import {
  countPathsTouchingConnectors,
  getConnectorOccupancy,
  getConnectorPinGuideImage,
  getConnectorSideImage,
  getChildEnclosures,
  getEnclosureMergePoints,
  getEnclosurePorts,
  getEnclosureConnectors,
  getEntityRevealContext,
  getPathById,
  getPathSignalId,
  getPortWireAppearance,
  getSpaceFreeConnectors,
  getSpaceFreeMergePoints,
  getVisibleSegments,
} from '../../lib/harness';
import { nearestOnPolyline, type Point } from '../../lib/paths';
import { getWireAppearance } from '../../lib/colors';
import {
  EXPANDED_CONNECTOR_Z_INDEX,
  getConnectorTablePinCount,
  resolveConnectorRenderedSize,
} from '../../lib/connectorSize';
import {
  buildSubsystemGraphModel,
  deriveGraphWireGroups,
  findOverlappingWallMountedPeer,
  projectNodeToEnclosureWall,
  SUBSYSTEM_CONNECTOR_PREFIX,
  SUBSYSTEM_DEVICE_PREFIX,
  SUBSYSTEM_FRAME_PREFIX,
} from './graphModel';

const BG_NODE_ID = '__bg_image__';
const TB_NODE_PREFIX = '__tb_';
const FREE_CON_PREFIX = '__freecon_';
const ENC_CON_PREFIX = '__enccon_';
const FREE_MERGE_PREFIX = '__freemerge_';

const nodeTypes = {
  enclosure: EnclosureNode,
  connector: ConnectorNode,
  mergePoint: MergePointNode,
  backgroundImage: BackgroundImageNode,
  textBox: TextBoxNode,
};
const edgeTypes = { bundle: BundleEdge };

function getAbsoluteNodeCenter(nodeId: string, nodes: Node[]): Point | null {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const node = nodesById.get(nodeId);
  if (!node) return null;

  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;
  const visited = new Set([node.id]);
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = nodesById.get(parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }

  const style = node.style as { width?: number | string; height?: number | string } | undefined;
  const width = node.measured?.width
    ?? node.width
    ?? (typeof style?.width === 'number' ? style.width : 0);
  const height = node.measured?.height
    ?? node.height
    ?? (typeof style?.height === 'number' ? style.height : 0);
  return { x: x + width / 2, y: y + height / 2 };
}

function AddTextBoxButton() {
  const { screenToFlowPosition } = useReactFlow();
  const addTextBox = useHarnessStore((s) => s.addTextBox);
  const isEditor = useHarnessStore((s) => s.session.isEditor);

  const handleAdd = () => {
    if (!isEditor) return;
    const pos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    addTextBox(pos.x - 110, pos.y - 55);
  };

  return (
    <button
      disabled={!isEditor}
      className="flex items-center gap-1.5 px-2 py-1 text-[11px] bg-zinc-800/90 border border-zinc-600 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 rounded shadow transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-zinc-800/90 disabled:hover:text-zinc-300"
      onClick={handleAdd}
      title={isEditor ? 'Add a floating text box' : 'Log in to add a text box'}
    >
      <span className="font-bold text-[12px] leading-none">T</span>
      <span>Text Box</span>
    </button>
  );
}

function ViewportResetter({ viewportKey }: { viewportKey: string }) {
  const { setViewport } = useReactFlow();

  useEffect(() => {
    void setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 });
  }, [setViewport, viewportKey]);

  return null;
}

function NodeGeometryUpdater({ nodes }: { nodes: Node[] }) {
  const updateNodeInternals = useUpdateNodeInternals();
  const previousGeometry = useRef<string | null>(null);

  useEffect(() => {
    const geometry = nodes.map((node) => {
      const style = node.style as { width?: number | string; height?: number | string } | undefined;
      return `${node.id}:${String(style?.width)}:${String(style?.height)}`;
    }).join('|');
    if (geometry === previousGeometry.current) return;
    previousGeometry.current = geometry;

    const frame = requestAnimationFrame(() => {
      for (const node of nodes) updateNodeInternals(node.id);
    });
    return () => cancelAnimationFrame(frame);
  }, [nodes, updateNodeInternals]);

  return null;
}

function EntityRevealController({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) {
  const { fitView } = useReactFlow();
  const revealRequest = useHarnessStore((s) => s.revealRequest);
  const editingSurface = useHarnessStore((s) => s.editingSurface);
  const drillDownEnclosure = useHarnessStore((s) => s.drillDownEnclosure);
  const harness = useHarnessStore((s) => s.harness);
  const processedRequest = useRef<number | null>(null);

  useEffect(() => {
    if (!revealRequest || processedRequest.current === revealRequest.requestId || !harness) return;

    const item = revealRequest.item;
    let targetNodes: Node[] = [];

    if (item.type === 'enclosure') {
      targetNodes = nodes.filter((node) => node.data?.enclosureId === item.id);
    } else if (item.type === 'connector') {
      targetNodes = nodes.filter((node) => node.data?.connectorId === item.id);
    } else if (item.type === 'mergePoint') {
      targetNodes = nodes.filter((node) => node.data?.mergePointId === item.id);
    } else {
      const pathIds = item.type === 'path'
        ? new Set([item.id])
        : new Set(
            harness.paths
              .filter((path) => getPathSignalId(path) === item.id)
              .map((path) => path.id),
          );
      const nodeIds = new Set<string>();
      for (const edge of edges) {
        const edgePathIds = (edge.data?.pathIds as string[] | undefined) ?? [];
        if (!edgePathIds.some((pathId) => pathIds.has(pathId))) continue;
        nodeIds.add(edge.source);
        nodeIds.add(edge.target);
      }
      targetNodes = nodes.filter((node) => nodeIds.has(node.id));
    }

    if (targetNodes.length === 0 && editingSurface === 'subsystem') {
      useHarnessStore.setState({
        editingSurface: 'hierarchy',
        drillDownEnclosure: getEntityRevealContext(harness, item, drillDownEnclosure),
      });
      return;
    }

    if (targetNodes.length === 0) return;

    let focusFrame: number | null = null;
    const layoutFrame = requestAnimationFrame(() => {
      focusFrame = requestAnimationFrame(() => {
        void fitView({
          nodes: targetNodes,
          padding: 0.4,
          duration: 350,
          maxZoom: 1.5,
        });
        processedRequest.current = revealRequest.requestId;
      });
    });
    return () => {
      cancelAnimationFrame(layoutFrame);
      if (focusFrame !== null) cancelAnimationFrame(focusFrame);
    };
  }, [
    drillDownEnclosure,
    edges,
    editingSurface,
    fitView,
    harness,
    nodes,
    revealRequest,
  ]);

  return null;
}

export function GraphView() {
  const harness = useHarnessStore((s) => s.harness);
  const isEditor = useHarnessStore((s) => s.session.isEditor);
  const activeHarnessName = useHarnessStore((s) => s.activeHarnessName);
  const nodeLayouts = useHarnessStore((s) => s.nodeLayouts);
  const sizeLayouts = useHarnessStore((s) => s.sizeLayouts);
  const expandedSizeOverrides = useHarnessStore((s) => s.expandedSizeOverrides);
  const connectorLibrary = useHarnessStore((s) => s.connectorLibrary);
  const freePortLayouts = useHarnessStore((s) => s.freePortLayouts);
  const portLayouts = useHarnessStore((s) => s.portLayouts);
  const updateNodePosition = useHarnessStore((s) => s.updateNodePosition);
  const updatePortLayout = useHarnessStore((s) => s.updatePortLayout);
  const updateFreePortLayout = useHarnessStore((s) => s.updateFreePortLayout);
  const updateBackground = useHarnessStore((s) => s.updateBackground);
  const backgroundLayouts = useHarnessStore((s) => s.backgroundLayouts);
  const selectedItem = useHarnessStore((s) => s.selectedItem);
  const selectedBundle = useHarnessStore((s) => s.selectedBundle);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const activeFilters = useHarnessStore((s) => s.activeFilters);
  const drillDownEnclosure = useHarnessStore((s) => s.drillDownEnclosure);
  const setDrillDown = useHarnessStore((s) => s.setDrillDown);
  const textBoxLayouts = useHarnessStore((s) => s.textBoxLayouts);
  const updateTextBox = useHarnessStore((s) => s.updateTextBox);
  const selectTextBox = useHarnessStore((s) => s.selectTextBox);
  const waypointLayouts = useHarnessStore((s) => s.waypointLayouts);
  const setEdgeWaypoints = useHarnessStore((s) => s.setEdgeWaypoints);
  const junctionLayouts = useHarnessStore((s) => s.junctionLayouts);
  const createJunction = useHarnessStore((s) => s.createJunction);
  const linkEdgeToJunction = useHarnessStore((s) => s.linkEdgeToJunction);
  const draggingEdgeInfo = useHarnessStore((s) => s.draggingEdgeInfo);
  const pushUndoSnapshot = useHarnessStore((s) => s.pushUndoSnapshot);
  const commitUndoSnapshot = useHarnessStore((s) => s.commitUndoSnapshot);
  const cancelUndoSnapshot = useHarnessStore((s) => s.cancelUndoSnapshot);
  const mergePointLayouts = useHarnessStore((s) => s.mergePointLayouts);
  const updateMergePointLayout = useHarnessStore((s) => s.updateMergePointLayout);
  const expandedNodes = useHarnessStore((s) => s.expandedNodes);
  const editingSurface = useHarnessStore((s) => s.editingSurface);
  const activeSubsystemId = useHarnessStore((s) => s.activeSubsystemId);
  const subsystems = useHarnessStore((s) => s.subsystems);
  const updateSubsystemEntityLayout = useHarnessStore((s) => s.updateSubsystemEntityLayout);
  const addEntityToActiveSubsystem = useHarnessStore((s) => s.addEntityToActiveSubsystem);
  const mergeBulkheadConnectors = useHarnessStore((s) => s.mergeBulkheadConnectors);
  const setMutationError = useHarnessStore((s) => s.setMutationError);
  const mutationError = useHarnessStore((s) => s.mutationError);
  const removeEntityFromActiveSubsystem = useHarnessStore((s) => s.removeEntityFromActiveSubsystem);
  const openSignalLibrary = useHarnessStore((s) => s.openSignalLibrary);

  const spaceId = drillDownEnclosure ?? null;
  const bgKey = spaceId ?? 'graph';
  const viewportKey = editingSurface === 'subsystem'
    ? `${activeHarnessName}:subsystem:${activeSubsystemId ?? 'none'}`
    : `${activeHarnessName}:hierarchy:${bgKey}`;

  const prevDragging = useRef(useHarnessStore.getState().draggingEdgeInfo);
  const reactFlowInstance = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const draggingNodes = useRef(new Set<string>());
  const didPushSnapshotForDrag = useRef(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lassoMode, setLassoMode] = useState(false);
  const [placingRoutePoints, setPlacingRoutePoints] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<{
    from: { connector_id: string; pin_number: number };
    to: { connector_id: string; pin_number: number };
  } | null>(null);
  const [selectedSignalId, setSelectedSignalId] = useState('');
  const [creatingSignal, setCreatingSignal] = useState(false);

  useEffect(() => {
    if (isEditor) return;
    setPickerOpen(false);
    setPendingRoute(null);
    setPlacingRoutePoints(false);
  }, [isEditor]);

  useEffect(() => {
    if (selectedBundle) return;
    setPlacingRoutePoints(false);
  }, [selectedBundle]);

  useEffect(() => {
    if (!placingRoutePoints) return;
    const stopPlacing = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPlacingRoutePoints(false);
    };
    window.addEventListener('keydown', stopPlacing);
    return () => window.removeEventListener('keydown', stopPlacing);
  }, [placingRoutePoints]);

  const breadcrumbs = useMemo(() => {
    if (!harness || !spaceId) return [];
    const crumbs: { id: string | null; name: string }[] = [];
    let cur: string | null = spaceId;
    while (cur) {
      const enc = harness.enclosures.find((e) => e.id === cur);
      if (!enc) break;
      crumbs.unshift({ id: enc.id, name: enc.name });
      cur = enc.parent;
    }
    crumbs.unshift({ id: null, name: harness.name ?? 'System' });
    return crumbs;
  }, [harness, spaceId]);

  const hierarchyGraph = useMemo(() => {
    if (!harness) return { graphNodes: [] as Node[], graphEdges: [] as Edge[] };

    const childEnclosures = getChildEnclosures(harness, spaceId);
    const freeConnectors = getSpaceFreeConnectors(harness, spaceId);
    const freeMergePoints = getSpaceFreeMergePoints(harness, spaceId);
    const freeConIds = new Set(freeConnectors.map((c) => c.id));
    const freeMergeIds = new Set(freeMergePoints.map((mergePoint) => mergePoint.id));
    const enclosureConIds = new Set<string>();
    const conToEncId = new Map<string, string>();   // connectorId → enclosureId for ENC_CON nodes
    const mergeToEncId = new Map<string, string>(); // mergePointId → enclosureId (no node rendered)
    const mergeLayoutsForContext = mergePointLayouts[bgKey] ?? {};

    const gNodes: Node[] = [];

    // ── Enclosure nodes + connector child nodes ──────────────────────────
    for (let idx = 0; idx < childEnclosures.length; idx++) {
      const enc = childEnclosures[idx];
      const defaultPos = { x: 50 + (idx % 4) * 330, y: 80 + Math.floor(idx / 4) * 250 };
      const pos = nodeLayouts[enc.id] ?? defaultPos;
      const size = sizeLayouts[enc.id] ?? { w: 220, h: 180 };

      const directConnectors = getEnclosurePorts(harness, enc.id);
      const allConnectors = getEnclosureConnectors(harness, enc.id);
      const directMergePoints = getEnclosureMergePoints(harness, enc.id);
      const childEncs = getChildEnclosures(harness, enc.id);
      const pathCount = countPathsTouchingConnectors(harness, allConnectors.map((connector) => connector.id));

      gNodes.push({
        id: enc.id,
        type: 'enclosure',
        deletable: false,
        position: pos,
        style: { width: size.w, height: size.h },
        selected: selectedItem?.type === 'enclosure' && selectedItem.id === enc.id,
        data: {
          enclosureId: enc.id,
          label: enc.name,
          tags: enc.tags,
          connectorCount: allConnectors.length,
          pathCount,
          matchesFilter: itemMatchesFilters(enc.tags, activeFilters),
          isContainer: enc.container,
          image: enc.properties?.image,
          childEnclosureCount: childEncs.length,
        },
      });

      // Device connectors float inside their device. Bulkheads on physical
      // enclosure containers stay centered on the enclosure wall.
      directConnectors.forEach((con, conIdx) => {
        enclosureConIds.add(con.id);
        conToEncId.set(con.id, enc.id);
        const savedPos = portLayouts[con.id];
        const defaultConX = 12 + (conIdx % 3) * 90;
        const defaultConY = 48 + Math.floor(conIdx / 3) * 52;
        const conPos = savedPos ?? { x: defaultConX, y: defaultConY };
        const savedConSize = sizeLayouts[con.id] ?? { w: 100, h: 32 };
        const occupiedPins = getConnectorOccupancy(harness, con.id);
        const conType = connectorLibrary?.connector_types.find((t) => t.id === con.connector_type);
        const isExpanded = expandedNodes.has(con.id);
        const conSize = resolveConnectorRenderedSize(
          savedConSize,
          isExpanded,
          getConnectorTablePinCount(con, conType, occupiedPins.map((pin) => pin.pinNumber)),
          expandedSizeOverrides[con.id],
        );
        const wallMounted = enc.container;

        gNodes.push({
          id: `${ENC_CON_PREFIX}${con.id}`,
          type: 'connector',
          parentId: enc.id,
          ...(wallMounted ? {} : { extent: 'parent' as const }),
          deletable: false,
          position: wallMounted
            ? projectNodeToEnclosureWall(conPos, conSize, size)
            : { x: conPos.x, y: conPos.y },
          style: { width: conSize.w, height: conSize.h },
          zIndex: isExpanded ? EXPANDED_CONNECTOR_Z_INDEX : 0,
          selected: selectedItem?.type === 'connector' && selectedItem.id === con.id,
          data: {
            label: con.name,
            parentName: '',
            connectorId: con.id,
            occupiedPins: occupiedPins.map((entry) => ({
              pinNumber: entry.pinNumber,
              pathId: entry.pathId,
              pathName: entry.pathName,
              signalName: entry.signalName,
            })),
            pinCount: occupiedPins.length,
            matchesFilter: itemMatchesFilters(con.tags, activeFilters),
            wireAppearance: getPortWireAppearance(harness, con),
            connectorTypeId: con.connector_type,
            instanceImage: (con.properties?.image as string)
              || getConnectorSideImage(con, conType)
              || getConnectorPinGuideImage(con, conType)
              || '',
            wallMounted,
          },
        } as Node);
      });

      directMergePoints.forEach((mergePoint) => {
        mergeToEncId.set(mergePoint.id, enc.id);
      });
    }

    // ── Free-floating connector nodes (parent === spaceId) ───────────────
    for (const con of freeConnectors) {
      const nodeId = `${FREE_CON_PREFIX}${con.id}`;
      const freePos = freePortLayouts[con.id];
      const pos = freePos ?? { x: 100, y: 400 + gNodes.length * 60 };
      const savedConSize = sizeLayouts[con.id] ?? { w: 140, h: 32 };
      const occupiedPins = getConnectorOccupancy(harness, con.id);
      const conType = connectorLibrary?.connector_types.find((t) => t.id === con.connector_type);
      const isExpanded = expandedNodes.has(con.id);
      const conSize = resolveConnectorRenderedSize(
        savedConSize,
        isExpanded,
        getConnectorTablePinCount(con, conType, occupiedPins.map((pin) => pin.pinNumber)),
        expandedSizeOverrides[con.id],
      );

      gNodes.push({
        id: nodeId,
        type: 'connector',
        deletable: false,
        position: { x: pos.x, y: pos.y },
        style: { width: conSize.w, height: conSize.h },
        zIndex: isExpanded ? EXPANDED_CONNECTOR_Z_INDEX : 0,
        selected: selectedItem?.type === 'connector' && selectedItem.id === con.id,
        data: {
          label: con.name,
          parentName: '',
          connectorId: con.id,
          occupiedPins: occupiedPins.map((entry) => ({
            pinNumber: entry.pinNumber,
            pathId: entry.pathId,
            pathName: entry.pathName,
            signalName: entry.signalName,
          })),
          pinCount: occupiedPins.length,
          matchesFilter: itemMatchesFilters(con.tags, activeFilters),
          wireAppearance: getPortWireAppearance(harness, con),
          connectorTypeId: con.connector_type,
          instanceImage: (con.properties?.image as string)
            || getConnectorSideImage(con, conType)
            || getConnectorPinGuideImage(con, conType)
            || '',
        },
      } as Node);
    }

    for (const mergePoint of freeMergePoints) {
      const nodeId = `${FREE_MERGE_PREFIX}${mergePoint.id}`;
      const pos = mergeLayoutsForContext[mergePoint.id] ?? { x: 160, y: 420 + gNodes.length * 40 };
      const size = sizeLayouts[mergePoint.id] ?? { w: 52, h: 28 };
      gNodes.push({
        id: nodeId,
        type: 'mergePoint',
        deletable: false,
        position: { x: pos.x, y: pos.y },
        style: { width: size.w, height: size.h },
        zIndex: 5,
        selected: selectedItem?.type === 'mergePoint' && selectedItem.id === mergePoint.id,
        data: {
          mergePointId: mergePoint.id,
          label: mergePoint.name,
          matchesFilter: itemMatchesFilters(mergePoint.tags, activeFilters),
        },
      } as Node);
    }

    // ── Background image node ────────────────────────────────────────────
    const bg = backgroundLayouts[bgKey];
    if (bg?.image) {
      gNodes.unshift({
        id: BG_NODE_ID,
        type: 'backgroundImage',
        position: { x: bg.x, y: bg.y },
        draggable: !bg.locked,
        selectable: !bg.locked,
        data: {
          imageUrl: `/user-data/images/${bg.image}`,
          w: bg.w,
          h: bg.h,
          locked: bg.locked,
          contextKey: bgKey,
        },
        zIndex: -1000,
        style: { width: bg.w, height: bg.h },
      } as Node);
    }

    // ── Text box nodes ───────────────────────────────────────────────────
    for (const tb of Object.values(textBoxLayouts)) {
      if ((tb.contextKey ?? 'graph') !== bgKey) continue;
      gNodes.push({
        id: `${TB_NODE_PREFIX}${tb.id}`,
        type: 'textBox',
        position: { x: tb.x, y: tb.y },
        draggable: true,
        selectable: true,
        data: {
          tbId: tb.id,
          text: tb.text,
          bgColor: tb.bgColor,
          textColor: tb.textColor,
          fontSize: tb.fontSize,
          fontFamily: tb.fontFamily,
          fontWeight: tb.fontWeight,
          textAlign: tb.textAlign,
          borderColor: tb.borderColor,
          borderWidth: tb.borderWidth,
          borderRadius: tb.borderRadius,
          opacity: tb.opacity,
          padding: tb.padding,
          w: tb.w,
          h: tb.h,
        },
        style: { width: tb.w, height: tb.h },
        zIndex: 10,
      } as Node);
    }

    // ── Bundle edges — connect connector nodes directly ───────────────────
    const getVisibleNodeId = (refKey: string): string | null => {
      if (refKey.startsWith('connector:')) {
        const [, connectorId] = refKey.split(':');
        if (freeConIds.has(connectorId)) return `${FREE_CON_PREFIX}${connectorId}`;
        if (enclosureConIds.has(connectorId)) return `${ENC_CON_PREFIX}${connectorId}`;
        return null;
      }
      if (refKey.startsWith('merge:')) {
        const [, mergePointId] = refKey.split(':');
        if (freeMergeIds.has(mergePointId)) return `${FREE_MERGE_PREFIX}${mergePointId}`;
        const encId = mergeToEncId.get(mergePointId);
        if (encId !== undefined) return encId;
        return null;
      }
      return null;
    };

    const visibleSegments = getVisibleSegments(harness, spaceId);
    const bundles = deriveGraphWireGroups(visibleSegments, expandedNodes);

    const gEdges: Edge[] = bundles.flatMap((bundle) => {
      const sourceNodeId = getVisibleNodeId(bundle.sourceRefKey);
      const targetNodeId = getVisibleNodeId(bundle.targetRefKey);
      if (!sourceNodeId || !targetNodeId) return [];

      // Drop edges that are internal to a child enclosure: an ENC_CON connecting
      // to the enclosure node itself (which is where its splice endpoint was mapped).
      const srcEncForCon = sourceNodeId.startsWith(ENC_CON_PREFIX)
        ? conToEncId.get(sourceNodeId.slice(ENC_CON_PREFIX.length))
        : null;
      const tgtEncForCon = targetNodeId.startsWith(ENC_CON_PREFIX)
        ? conToEncId.get(targetNodeId.slice(ENC_CON_PREFIX.length))
        : null;
      if (srcEncForCon && srcEncForCon === targetNodeId) return [];
      if (tgtEncForCon && tgtEncForCon === sourceNodeId) return [];

      const pathAppearances = bundle.pathIds.map((pathId) => {
        const path = getPathById(harness, pathId);
        return path ? getWireAppearance(path) : getWireAppearance({ tags: [], properties: {} });
      });
      let matchesFilter = false;
      for (const pathId of bundle.pathIds) {
        const path = getPathById(harness, pathId);
        const effectiveTags = path?.signal_id
          ? [...path.tags, `signal:${path.signal_id.replace(/^sig_/, '')}`]
          : path?.tags ?? [];
        if (path && itemMatchesFilters(effectiveTags, activeFilters)) matchesFilter = true;
      }
      const firstAppearance = pathAppearances[0];
      const bundleColor =
        firstAppearance && pathAppearances.every((appearance) => appearance.key === firstAppearance.key)
          ? firstAppearance.primaryColor
          : '#666';

      const isSelected =
        (selectedBundle != null && selectedBundle.id === bundle.id) ||
        (
          selectedItem?.type === 'path' &&
          bundle.pathIds.includes(selectedItem.id)
        ) ||
        (
          selectedItem?.type === 'signal' &&
          bundle.pathIds.some((pathId) => {
            const path = getPathById(harness, pathId);
            return path ? getPathSignalId(path) === selectedItem.id : false;
          })
        );

      const rawWps = waypointLayouts[bundle.id] ?? [];
      const resolvedWaypoints: Point[] = rawWps.map((wp) => {
        if ('junctionId' in wp) {
          const j = junctionLayouts[wp.junctionId];
          return j ? { x: j.x, y: j.y } : { x: 0, y: 0 };
        }
        return { x: wp.x, y: wp.y };
      });

      const junctionMeta = rawWps.map((wp) => {
        if (!('junctionId' in wp)) return { junctionId: null, isOwner: false, memberCount: 1 };
        const j = junctionLayouts[wp.junctionId];
        if (!j) return { junctionId: null, isOwner: false, memberCount: 1 };
        const sortedMembers = [...j.memberEdgeIds].sort();
        const isOwner = sortedMembers[0] === bundle.id;
        return { junctionId: wp.junctionId, isOwner, memberCount: j.memberEdgeIds.length };
      });

      return [{
        id: bundle.id,
        source: sourceNodeId,
        target: targetNodeId,
        sourceHandle: bundle.sourceHandle,
        targetHandle: bundle.targetHandle,
        type: 'bundle',
        selected: !!isSelected,
        // Keep selected edges (and their bend-point handles) above other harnesses.
        zIndex: isSelected ? 1000 : 0,
        data: {
          pathIds: bundle.pathIds,
          pathCount: bundle.pathIds.length,
          wireAppearances: pathAppearances,
          bundleColor,
          matchesFilter,
          resolvedWaypoints,
          junctionMeta,
          sourceStub: 0,
          targetStub: 0,
        },
      }];
    });

    return { graphNodes: gNodes, graphEdges: gEdges };
  }, [
    harness, nodeLayouts, sizeLayouts, freePortLayouts, portLayouts, selectedItem,
    selectedBundle, activeFilters, backgroundLayouts, bgKey,
    textBoxLayouts, waypointLayouts, junctionLayouts, spaceId, mergePointLayouts,
    expandedNodes, expandedSizeOverrides, connectorLibrary,
  ]);

  const connectorTypesById = useMemo(() => {
    const map = new Map<string, ConnectorType>();
    for (const type of connectorLibrary?.connector_types ?? []) {
      map.set(type.id, type);
    }
    return map;
  }, [connectorLibrary]);

  const subsystem = activeSubsystemId ? subsystems[activeSubsystemId] : undefined;
  const subsystemGraph = useMemo(
    () => harness && subsystem
      ? buildSubsystemGraphModel(
        harness,
        subsystem,
        activeFilters,
        expandedNodes,
        selectedItem,
        expandedSizeOverrides,
        connectorTypesById,
      )
      : { graphNodes: [] as Node[], graphEdges: [] as Edge[] },
    [harness, subsystem, activeFilters, expandedNodes, selectedItem, expandedSizeOverrides, connectorTypesById],
  );
  const { graphNodes, graphEdges } = editingSurface === 'subsystem'
    ? subsystemGraph
    : hierarchyGraph;

  const [nodes, setNodes, onNodesChangeBase] = useNodesState(graphNodes);
  const [edges, setEdges] = useEdgesState(graphEdges);

  useEffect(() => { setNodes(graphNodes); }, [graphNodes, setNodes]);
  useEffect(() => { setEdges(graphEdges); }, [graphEdges, setEdges]);

  // Auto-create junction when a waypoint is dropped near another edge
  useEffect(() => {
    if (!isEditor) return;
    const prev = prevDragging.current;
    prevDragging.current = draggingEdgeInfo;

    if (!prev || draggingEdgeInfo || prev.waypointIndex == null) return;

    const draggedId = prev.edgeId;
    const dropPos = prev.position;
    const wpIdx = prev.waypointIndex;
    const THRESHOLD = 50;

    for (const edge of graphEdges) {
      if (edge.id === draggedId) continue;

      const edgeData = edge.data as { resolvedWaypoints?: Point[] } | undefined;
      const resolvedWps = edgeData?.resolvedWaypoints ?? [];

      const eNode = graphNodes.find((n) => n.id === edge.source);
      const tNode = graphNodes.find((n) => n.id === edge.target);
      if (!eNode || !tNode) continue;

      const eSz = sizeLayouts[eNode.id] ?? { w: 220, h: 180 };
      const tSz = sizeLayouts[tNode.id] ?? { w: 220, h: 180 };
      const ePt: Point = { x: eNode.position.x + eSz.w / 2, y: eNode.position.y + eSz.h / 2 };
      const tPt: Point = { x: tNode.position.x + tSz.w / 2, y: tNode.position.y + tSz.h / 2 };
      const pts: Point[] = [ePt, ...resolvedWps, tPt];

      const { dist, segIndex } = nearestOnPolyline(dropPos, pts);

      if (dist < THRESHOLD) {
        const currentWps = useHarnessStore.getState().waypointLayouts;
        const dragWp = (currentWps[draggedId] ?? [])[wpIdx];
        const existingJunctionId = dragWp && 'junctionId' in dragWp ? dragWp.junctionId : null;
        const targetWps = currentWps[edge.id] ?? [];
        const alreadyLinked =
          existingJunctionId &&
          targetWps.some((wp) => 'junctionId' in wp && wp.junctionId === existingJunctionId);

        if (alreadyLinked) break;

        pushUndoSnapshot(`junction:${existingJunctionId ?? draggedId}:link:${edge.id}`);
        const insertAfterIndex = Math.max(0, segIndex - 1);

        if (existingJunctionId) {
          linkEdgeToJunction(existingJunctionId, edge.id, insertAfterIndex, dropPos);
        } else {
          const junctionId = createJunction(dropPos, draggedId, wpIdx);
          linkEdgeToJunction(junctionId, edge.id, insertAfterIndex, dropPos);
        }
        commitUndoSnapshot();
        break;
      }
    }
  }, [draggingEdgeInfo, graphEdges, graphNodes, sizeLayouts, createJunction, isEditor, linkEdgeToJunction, pushUndoSnapshot, commitUndoSnapshot]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!isEditor) {
        onNodesChangeBase(changes.filter(
          (change) => change.type !== 'position' && change.type !== 'dimensions',
        ));
        return;
      }
      const constrainedChanges = changes.map((change) => {
        if (change.type !== 'position' || !change.position) return change;
        const node = nodes.find((candidate) => candidate.id === change.id);
        if (!node?.parentId || !node.data.wallMounted) return change;
        const parent = nodes.find((candidate) => candidate.id === node.parentId);
        const nodeStyle = node.style as { width?: number; height?: number } | undefined;
        const parentStyle = parent?.style as { width?: number; height?: number } | undefined;
        if (
          typeof nodeStyle?.width !== 'number' ||
          typeof nodeStyle.height !== 'number' ||
          typeof parentStyle?.width !== 'number' ||
          typeof parentStyle.height !== 'number'
        ) {
          return change;
        }
        return {
          ...change,
          position: projectNodeToEnclosureWall(
            change.position,
            { w: nodeStyle.width, h: nodeStyle.height },
            { w: parentStyle.width, h: parentStyle.height },
          ),
        };
      });

      onNodesChangeBase(constrainedChanges);

      const positionChanges = constrainedChanges.filter((c) => c.type === 'position');
      const anyStarting = positionChanges.some(
        (c) => c.type === 'position' && c.dragging && !draggingNodes.current.has(c.id),
      );
      if (anyStarting && !didPushSnapshotForDrag.current) {
        didPushSnapshotForDrag.current = true;
        pushUndoSnapshot(`nodes:${positionChanges.map((change) => change.id).sort().join(',')}:drag`);
      }

      for (const change of positionChanges) {
        if (change.dragging) {
          draggingNodes.current.add(change.id);
        }

        // Only persist after a real node-drag end. NodeResizer emits position
        // changes with `dragging` undefined; treating those as drag-end was
        // rewriting subsystem layouts mid-resize and snapping sizes back.
        if (change.position && change.dragging === false) {
          draggingNodes.current.delete(change.id);
          if (draggingNodes.current.size === 0) didPushSnapshotForDrag.current = false;
          if (change.id === BG_NODE_ID) {
            updateBackground(bgKey, { x: change.position.x, y: change.position.y });
          } else if (change.id.startsWith(TB_NODE_PREFIX)) {
            const tbId = change.id.slice(TB_NODE_PREFIX.length);
            updateTextBox(tbId, { x: change.position.x, y: change.position.y });
          } else if (change.id.startsWith(FREE_CON_PREFIX)) {
            const conId = change.id.slice(FREE_CON_PREFIX.length);
            updateFreePortLayout(conId, change.position.x, change.position.y);
          } else if (change.id.startsWith(ENC_CON_PREFIX)) {
            const conId = change.id.slice(ENC_CON_PREFIX.length);
            updatePortLayout(conId, change.position.x, change.position.y);
          } else if (change.id.startsWith(FREE_MERGE_PREFIX)) {
            const mergePointId = change.id.slice(FREE_MERGE_PREFIX.length);
            updateMergePointLayout(bgKey, mergePointId, change.position.x, change.position.y);
          } else if (change.id.startsWith(SUBSYSTEM_FRAME_PREFIX)) {
            const enclosureId = change.id.slice(SUBSYSTEM_FRAME_PREFIX.length);
            const previous = subsystem?.enclosures[enclosureId];
            updateSubsystemEntityLayout('enclosures', enclosureId, { ...previous, x: change.position.x, y: change.position.y });
          } else if (change.id.startsWith(SUBSYSTEM_DEVICE_PREFIX)) {
            const deviceId = change.id.slice(SUBSYSTEM_DEVICE_PREFIX.length);
            const previous = subsystem?.devices[deviceId];
            updateSubsystemEntityLayout('devices', deviceId, { ...previous, x: change.position.x, y: change.position.y });
          } else if (change.id.startsWith(SUBSYSTEM_CONNECTOR_PREFIX)) {
            const connectorId = change.id.slice(SUBSYSTEM_CONNECTOR_PREFIX.length);
            const draggedNode = nodes.find((candidate) => candidate.id === change.id);
            if (draggedNode?.data.wallMounted && draggedNode.parentId) {
              const parent = nodes.find((candidate) => candidate.id === draggedNode.parentId);
              const parentStyle = parent?.style as { width?: number; height?: number } | undefined;
              const enclosureSize =
                typeof parentStyle?.width === 'number' && typeof parentStyle.height === 'number'
                  ? { w: parentStyle.width, h: parentStyle.height }
                  : null;
              if (enclosureSize) {
                const peerNodeId = findOverlappingWallMountedPeer(
                  {
                    id: change.id,
                    parentId: draggedNode.parentId,
                    position: change.position,
                    size: {
                      w: Number((draggedNode.style as { width?: number } | undefined)?.width ?? 96),
                      h: Number((draggedNode.style as { height?: number } | undefined)?.height ?? 36),
                    },
                    wallMounted: true,
                  },
                  nodes.map((candidate) => {
                    const style = candidate.style as { width?: number; height?: number } | undefined;
                    return {
                      id: candidate.id,
                      parentId: candidate.parentId,
                      position: candidate.position,
                      size: {
                        w: Number(style?.width ?? 96),
                        h: Number(style?.height ?? 36),
                      },
                      wallMounted: !!candidate.data.wallMounted,
                    };
                  }),
                  enclosureSize,
                );
                if (peerNodeId?.startsWith(SUBSYSTEM_CONNECTOR_PREFIX)) {
                  const targetId = peerNodeId.slice(SUBSYSTEM_CONNECTOR_PREFIX.length);
                  const keptId = mergeBulkheadConnectors(connectorId, targetId);
                  if (keptId) {
                    // Surviving connector was the dragged one (e.g. real hardware
                    // dropped onto a generated placeholder) — persist its drop spot.
                    if (keptId === connectorId) {
                      const previous = subsystem?.connectors[connectorId];
                      updateSubsystemEntityLayout('connectors', connectorId, {
                        ...previous,
                        x: change.position.x,
                        y: change.position.y,
                      });
                    }
                    continue;
                  }
                }
              }
            }
            const previous = subsystem?.connectors[connectorId];
            updateSubsystemEntityLayout('connectors', connectorId, { ...previous, x: change.position.x, y: change.position.y });
          } else {
            updateNodePosition(change.id, change.position.x, change.position.y);
          }
        }
      }
      if (
        positionChanges.some((change) => change.dragging === false)
        && draggingNodes.current.size === 0
      ) {
        commitUndoSnapshot();
      }
    },
    [isEditor, onNodesChangeBase, updateNodePosition, updateBackground, updateTextBox,
     updateFreePortLayout, updatePortLayout, updateMergePointLayout, updateSubsystemEntityLayout,
     mergeBulkheadConnectors, subsystem, bgKey, pushUndoSnapshot, commitUndoSnapshot, nodes],
  );

  const placeRoutePoint = useCallback((event: React.MouseEvent): boolean => {
    if (!placingRoutePoints || !selectedBundle || !isEditor) return false;

    const instance = reactFlowInstance.current;
    const edge = edges.find((candidate) => candidate.id === selectedBundle.id);
    if (!instance || !edge) {
      setMutationError('The selected bundle is no longer visible.');
      setPlacingRoutePoints(false);
      return true;
    }

    const position = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const source = getAbsoluteNodeCenter(edge.source, nodes);
    const target = getAbsoluteNodeCenter(edge.target, nodes);
    if (!source || !target) {
      setMutationError('Could not place a routing point on this bundle.');
      return true;
    }

    const resolvedWaypoints =
      (edge.data?.resolvedWaypoints as Point[] | undefined) ?? [];
    const { segIndex } = nearestOnPolyline(
      position,
      [source, ...resolvedWaypoints, target],
    );
    const currentWaypoints = waypointLayouts[edge.id] ?? [];
    const nextWaypoints = [...currentWaypoints];
    nextWaypoints.splice(
      Math.max(0, Math.min(currentWaypoints.length, segIndex)),
      0,
      { x: position.x, y: position.y },
    );
    pushUndoSnapshot(`edge:${edge.id}:add-waypoint`);
    setEdgeWaypoints(edge.id, nextWaypoints);
    commitUndoSnapshot();
    return true;
  }, [
    commitUndoSnapshot,
    edges,
    isEditor,
    nodes,
    placingRoutePoints,
    pushUndoSnapshot,
    selectedBundle,
    setEdgeWaypoints,
    setMutationError,
    waypointLayouts,
  ]);

  const onPaneClick = useCallback((event: React.MouseEvent) => {
    if (placeRoutePoint(event)) return;
    selectItem(null);
    selectTextBox(null);
  }, [placeRoutePoint, selectItem, selectTextBox]);

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (node.id === BG_NODE_ID) {
        if (placeRoutePoint(event)) return;
        selectItem(null);
        selectTextBox(null);
        return;
      }
      if (node.id.startsWith(TB_NODE_PREFIX)) {
        const tbId = node.id.slice(TB_NODE_PREFIX.length);
        selectTextBox(tbId);
        return;
      }
      if (node.id.startsWith(FREE_CON_PREFIX)) {
        const conId = node.id.slice(FREE_CON_PREFIX.length);
        selectItem({ type: 'connector', id: conId });
        return;
      }
      if (node.id.startsWith(ENC_CON_PREFIX)) {
        const conId = node.id.slice(ENC_CON_PREFIX.length);
        selectItem({ type: 'connector', id: conId });
        return;
      }
      if (node.id.startsWith(FREE_MERGE_PREFIX)) {
        const mergePointId = node.id.slice(FREE_MERGE_PREFIX.length);
        selectItem({ type: 'mergePoint', id: mergePointId });
        return;
      }
      if (node.id.startsWith(SUBSYSTEM_CONNECTOR_PREFIX)) {
        selectItem({ type: 'connector', id: node.id.slice(SUBSYSTEM_CONNECTOR_PREFIX.length) });
        return;
      }
      if (node.id.startsWith(SUBSYSTEM_DEVICE_PREFIX)) {
        selectItem({ type: 'enclosure', id: node.id.slice(SUBSYSTEM_DEVICE_PREFIX.length) });
        return;
      }
      if (node.id.startsWith(SUBSYSTEM_FRAME_PREFIX)) {
        selectItem({ type: 'enclosure', id: node.id.slice(SUBSYSTEM_FRAME_PREFIX.length) });
        return;
      }
      selectItem({ type: 'enclosure', id: node.id });
    },
    [placeRoutePoint, selectItem, selectTextBox],
  );

  const submitRoute = useCallback(async (
    from: { connector_id: string; pin_number: number },
    to: { connector_id: string; pin_number: number },
    signalId: string,
    properties?: Record<string, string>,
  ) => {
    if (!isEditor) {
      setMutationError('Log in to edit');
      return false;
    }
    if (!signalId) return false;
    pushUndoSnapshot(
      `route:${from.connector_id}:${from.pin_number}:${to.connector_id}:${to.pin_number}`,
    );
    const routeSubsystemId = editingSurface === 'subsystem' ? activeSubsystemId : null;
    const response = await fetch(`/api/paths/route?harness=${encodeURIComponent(useHarnessStore.getState().activeHarnessName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        signal_id: signalId,
        subsystem_id: routeSubsystemId,
        request_id: crypto.randomUUID(),
        properties,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      cancelUndoSnapshot();
      setMutationError(result.error ?? 'Wire routing failed');
      return false;
    }
    const store = useHarnessStore.getState();
    store.loadHarness(result.harness);
    if (result.subsystem) {
      store.acceptSavedSubsystem(result.subsystem);
    } else if (
      store.editingSurface === 'subsystem'
      && store.activeSubsystemId === routeSubsystemId
    ) {
      for (const connectorId of result.generated_connectors ?? []) {
        useHarnessStore.getState().addEntityToActiveSubsystem('connector', connectorId);
      }
    }
    commitUndoSnapshot();
    setMutationError(null);
    setPendingRoute(null);
    return true;
  }, [activeSubsystemId, editingSurface, isEditor, setMutationError, pushUndoSnapshot, commitUndoSnapshot, cancelUndoSnapshot]);

  const onConnect = useCallback((connection: Connection) => {
    if (!isEditor) {
      setMutationError('Log in to edit');
      return;
    }
    if (!harness) return;
    const parse = (nodeId: string | null, handleId: string | null) => {
      if (!nodeId || !handleId?.startsWith('pin:')) return null;
      const connectorId = nodeId.startsWith(SUBSYSTEM_CONNECTOR_PREFIX)
        ? nodeId.slice(SUBSYSTEM_CONNECTOR_PREFIX.length)
        : nodeId.startsWith(FREE_CON_PREFIX)
          ? nodeId.slice(FREE_CON_PREFIX.length)
          : nodeId.startsWith(ENC_CON_PREFIX)
            ? nodeId.slice(ENC_CON_PREFIX.length)
            : null;
      if (!connectorId) return null;
      return {
        connector_id: connectorId,
        pin_number: Number(handleId.slice(4)),
      };
    };
    const from = parse(connection.source, connection.sourceHandle);
    const to = parse(connection.target, connection.targetHandle);
    if (!from || !to) {
      setMutationError('Choose a cavity handle at both ends.');
      return;
    }
    if (from.connector_id === to.connector_id) {
      return;
    }
    const existingBulkheadSignalId = [from, to].map((endpoint) => {
      const connector = harness.connectors.find((item) => item.id === endpoint.connector_id);
      const parent = connector?.parent
        ? harness.enclosures.find((item) => item.id === connector.parent)
        : undefined;
      if (!connector || !parent?.container) return null;
      const stub = harness.paths.find((path) => {
        const nodeIndex = path.nodes.findIndex((node) =>
          node.kind === 'connector'
          && node.connector_id === connector.id
          && node.pin_number === endpoint.pin_number
        );
        return nodeIndex === 0 || nodeIndex === path.nodes.length - 1;
      });
      return stub ? getPathSignalId(stub) : null;
    }).find((signalId): signalId is string => !!signalId);
    setPendingRoute({ from, to });
    setSelectedSignalId(existingBulkheadSignalId ?? harness.signals[0]?.id ?? '');
    setCreatingSignal(false);
  }, [
    harness,
    isEditor,
    setMutationError,
  ]);

  const createSignalAndRoute = useCallback(async () => {
    if (!isEditor) {
      setMutationError('Log in to edit');
      return;
    }
    if (!pendingRoute || creatingSignal) return;

    setCreatingSignal(true);
    try {
      const response = await fetch(`/api/signals?harness=${encodeURIComponent(useHarnessStore.getState().activeHarnessName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'new signal',
          tags: [],
          properties: { preferred_wire_color: 'grey' },
        }),
      });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || !result.id) {
        setMutationError(result.error ?? 'Signal creation failed');
        return;
      }

      const routed = await submitRoute(
        pendingRoute.from,
        pendingRoute.to,
        result.id,
        { wire_color: 'grey' },
      );
      if (routed) openSignalLibrary(result.id);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Signal creation failed');
    } finally {
      setCreatingSignal(false);
    }
  }, [
    creatingSignal,
    isEditor,
    openSignalLibrary,
    pendingRoute,
    setMutationError,
    submitRoute,
  ]);

  return (
    <div className="w-full h-full bg-zinc-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onConnect={onConnect}
        onInit={(instance) => {
          reactFlowInstance.current = instance;
        }}
        nodesDraggable={isEditor}
        nodesConnectable={isEditor}
        connectionMode={ConnectionMode.Loose}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.2}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ animated: false }}
        elevateEdgesOnSelect
        selectionOnDrag={lassoMode}
        panOnDrag={lassoMode ? false : true}
        selectionMode={SelectionMode.Partial}
      >
        <ViewportResetter viewportKey={viewportKey} />
        <NodeGeometryUpdater nodes={nodes} />
        <EntityRevealController nodes={nodes} edges={edges} />
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#333"
        />
        <Controls className="!bg-zinc-800 !border-zinc-600 !rounded !shadow-lg [&>button]:!bg-zinc-800 [&>button]:!border-zinc-600 [&>button]:!text-zinc-300 [&>button:hover]:!bg-zinc-700" />

        {breadcrumbs.length > 0 && (
          <Panel position="top-left">
            <div className="flex items-center gap-1 px-2 py-1 bg-zinc-800/95 border border-zinc-600 rounded shadow-lg text-[11px]">
              {breadcrumbs.map((crumb, i) => (
                <span key={crumb.id ?? 'root'} className="flex items-center gap-1">
                  {i > 0 && <span className="text-zinc-500">›</span>}
                  {i < breadcrumbs.length - 1 ? (
                    <button
                      className="text-zinc-400 hover:text-zinc-100 transition-colors"
                      onClick={() => setDrillDown(crumb.id)}
                    >
                      {crumb.name}
                    </button>
                  ) : (
                    <span className="text-zinc-100 font-medium">{crumb.name}</span>
                  )}
                </span>
              ))}
            </div>
          </Panel>
        )}

        <Panel position="top-right">
          <div className="flex flex-col gap-1 items-end">
            <div className="flex gap-1">
              <button
                className={`flex items-center gap-1.5 px-2 py-1 text-[11px] border rounded shadow transition-colors ${
                  lassoMode
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300 hover:bg-amber-500/30'
                    : 'bg-zinc-800/90 border-zinc-600 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700'
                }`}
                onClick={() => setLassoMode((m) => !m)}
                title={lassoMode ? 'Exit lasso mode (back to pan)' : 'Lasso select (drag to select multiple)'}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 1 C2 1 1 3 1 5 C1 8 3 10 6 10 C9 10 11 8 11 6 C11 4 10 2 8 2" />
                  <line x1="8" y1="2" x2="10" y2="4" />
                  <line x1="10" y1="4" x2="10" y2="7" strokeDasharray="1.5 1.5" />
                </svg>
                <span>Lasso</span>
              </button>
              <div className="relative">
                <button
                  disabled={!isEditor}
                  className="flex items-center gap-1.5 px-2 py-1 text-[11px] bg-zinc-800/90 border border-zinc-600 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 rounded shadow transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-zinc-800/90 disabled:hover:text-zinc-300"
                  onClick={() => setPickerOpen((p) => !p)}
                  title={isEditor ? 'Set background image' : 'Log in to set a background image'}
                >
                  <span>🖼</span>
                  <span>Background</span>
                </button>
                {pickerOpen && isEditor && (
                  <ImagePickerPanel
                    onPick={(filename) => {
                      const bg = backgroundLayouts[bgKey];
                      updateBackground(bgKey, {
                        image: filename,
                        x: bg?.x ?? -400,
                        y: bg?.y ?? -300,
                        w: bg?.w ?? 900,
                        h: bg?.h ?? 600,
                        locked: false,
                      });
                    }}
                    onClose={() => setPickerOpen(false)}
                  />
                )}
              </div>
            </div>
            <AddTextBoxButton />
            {editingSurface === 'subsystem' && selectedItem && (
              <div className="flex gap-1">
                {(selectedItem.type === 'enclosure' || selectedItem.type === 'connector') && (
                  <button
                    disabled={!isEditor}
                    className="px-2 py-1 text-[11px] bg-zinc-800 border border-zinc-600 text-zinc-300 rounded disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => addEntityToActiveSubsystem(selectedItem.type as 'enclosure' | 'connector', selectedItem.id)}
                  >
                    Add selected
                  </button>
                )}
                <button
                  disabled={!isEditor}
                  className="px-2 py-1 text-[11px] bg-zinc-800 border border-zinc-600 text-zinc-300 rounded disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => {
                    if (selectedItem.type === 'enclosure' || selectedItem.type === 'connector') {
                      removeEntityFromActiveSubsystem(selectedItem.type, selectedItem.id);
                    }
                  }}
                >
                  Remove from subsystem
                </button>
              </div>
            )}
          </div>
        </Panel>

        {selectedBundle && isEditor && (
          <Panel position="bottom-center">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800/95 border border-zinc-600 rounded-lg shadow-lg">
              <button
                className={`rounded border px-2 py-1 text-[10px] font-medium transition-colors ${
                  placingRoutePoints
                    ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                    : 'border-zinc-600 bg-zinc-900 text-zinc-200 hover:border-amber-500 hover:text-amber-300'
                }`}
                onClick={() => setPlacingRoutePoints((active) => !active)}
              >
                {placingRoutePoints ? 'Done placing' : '+ Route points'}
              </button>
              <span className="text-[10px] text-zinc-400">
                {placingRoutePoints
                  ? 'Click anywhere on the empty canvas to route this bundle through that point · Esc to finish'
                  : 'Add free route points, or double-click the edge for a bend · Drag a point near another edge to create a junction'}
              </span>
            </div>
          </Panel>
        )}
        {mutationError && (
          <Panel position="bottom-center">
            <button
              onClick={() => setMutationError(null)}
              className="max-w-xl px-3 py-2 text-xs text-left text-red-200 bg-red-950/95 border border-red-700 rounded shadow-lg"
              title="Dismiss"
            >
              {mutationError}
            </button>
          </Panel>
        )}
        {pendingRoute && (
          <Panel position="top-center">
            <div className="w-72 rounded border border-zinc-600 bg-zinc-900/95 p-3 shadow-xl text-xs">
              <div className="font-semibold text-zinc-100 mb-2">Choose signal</div>
              <select
                value={selectedSignalId}
                disabled={creatingSignal}
                onChange={(event) => setSelectedSignalId(event.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-100 disabled:opacity-50"
              >
                {harness?.signals.map((signal) => (
                  <option key={signal.id} value={signal.id}>{signal.name} · {signal.id}</option>
                ))}
              </select>
              <button
                className="mt-2 text-amber-400 hover:text-amber-300 disabled:cursor-wait disabled:opacity-50"
                disabled={creatingSignal}
                onClick={() => void createSignalAndRoute()}
              >
                {creatingSignal ? 'Creating new signal…' : '+ Create new signal'}
              </button>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  className="text-zinc-400 disabled:opacity-50"
                  disabled={creatingSignal}
                  onClick={() => setPendingRoute(null)}
                >
                  Cancel
                </button>
                <button
                  className="rounded bg-amber-600 px-2 py-1 text-white disabled:opacity-40"
                  disabled={creatingSignal || !selectedSignalId}
                  onClick={() => void submitRoute(pendingRoute.from, pendingRoute.to, selectedSignalId)}
                >
                  Route wire
                </button>
              </div>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
