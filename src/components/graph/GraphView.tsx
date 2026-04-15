import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  SelectionMode,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type OnNodesChange,
  type NodeChange,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useHarnessStore } from '../../store';
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
  deriveBundles,
  getConnectorOccupancy,
  getChildEnclosures,
  getEnclosureMergePoints,
  getEnclosurePorts,
  getEnclosureConnectors,
  getPathById,
  getPortWireAppearance,
  getSpaceFreeConnectors,
  getSpaceFreeMergePoints,
  getVisibleSegments,
} from '../../lib/harness';
import { nearestOnPolyline, type Point } from '../../lib/paths';
import { getWireAppearance } from '../../lib/colors';

const BG_NODE_ID = '__bg_image__';
const TB_NODE_PREFIX = '__tb_';
const FREE_CON_PREFIX = '__freecon_';
const ENC_CON_PREFIX = '__enccon_';
const FREE_MERGE_PREFIX = '__freemerge_';
const ENC_MERGE_PREFIX = '__encmerge_';

const nodeTypes = {
  enclosure: EnclosureNode,
  connector: ConnectorNode,
  mergePoint: MergePointNode,
  backgroundImage: BackgroundImageNode,
  textBox: TextBoxNode,
};
const edgeTypes = { bundle: BundleEdge };

function AddTextBoxButton() {
  const { screenToFlowPosition } = useReactFlow();
  const addTextBox = useHarnessStore((s) => s.addTextBox);

  const handleAdd = () => {
    const pos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    addTextBox(pos.x - 110, pos.y - 55);
  };

  return (
    <button
      className="flex items-center gap-1.5 px-2 py-1 text-[11px] bg-zinc-800/90 border border-zinc-600 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 rounded shadow transition-colors"
      onClick={handleAdd}
      title="Add a floating text box"
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

export function GraphView() {
  const harness = useHarnessStore((s) => s.harness);
  const nodeLayouts = useHarnessStore((s) => s.nodeLayouts);
  const sizeLayouts = useHarnessStore((s) => s.sizeLayouts);
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
  const junctionLayouts = useHarnessStore((s) => s.junctionLayouts);
  const createJunction = useHarnessStore((s) => s.createJunction);
  const linkEdgeToJunction = useHarnessStore((s) => s.linkEdgeToJunction);
  const draggingEdgeInfo = useHarnessStore((s) => s.draggingEdgeInfo);
  const pushUndoSnapshot = useHarnessStore((s) => s.pushUndoSnapshot);
  const mergePointLayouts = useHarnessStore((s) => s.mergePointLayouts);
  const updateMergePointLayout = useHarnessStore((s) => s.updateMergePointLayout);

  const spaceId = drillDownEnclosure ?? null;
  const bgKey = spaceId ?? 'graph';

  const prevDragging = useRef(useHarnessStore.getState().draggingEdgeInfo);
  const draggingNodes = useRef(new Set<string>());
  const didPushSnapshotForDrag = useRef(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lassoMode, setLassoMode] = useState(false);

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
    crumbs.unshift({ id: null, name: 'Car' });
    return crumbs;
  }, [harness, spaceId]);

  const { graphNodes, graphEdges } = useMemo(() => {
    if (!harness) return { graphNodes: [] as Node[], graphEdges: [] as Edge[] };

    const childEnclosures = getChildEnclosures(harness, spaceId);
    const freeConnectors = getSpaceFreeConnectors(harness, spaceId);
    const freeMergePoints = getSpaceFreeMergePoints(harness, spaceId);
    const freeConIds = new Set(freeConnectors.map((c) => c.id));
    const freeMergeIds = new Set(freeMergePoints.map((mergePoint) => mergePoint.id));
    const enclosureConIds = new Set<string>();
    const enclosureMergeIds = new Set<string>();
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

      // Each connector belonging to this enclosure is a child node that floats
      // freely inside the enclosure's rectangle.
      directConnectors.forEach((con, conIdx) => {
        enclosureConIds.add(con.id);
        const savedPos = portLayouts[con.id];
        const defaultConX = 12 + (conIdx % 3) * 90;
        const defaultConY = 48 + Math.floor(conIdx / 3) * 52;
        const conPos = savedPos ?? { x: defaultConX, y: defaultConY };
        const conSize = sizeLayouts[con.id] ?? { w: 100, h: 32 };

        gNodes.push({
          id: `${ENC_CON_PREFIX}${con.id}`,
          type: 'connector',
          parentId: enc.id,
          extent: 'parent' as const,
          deletable: false,
          position: { x: conPos.x, y: conPos.y },
          style: { width: conSize.w, height: conSize.h },
          selected: selectedItem?.type === 'connector' && selectedItem.id === con.id,
          data: {
            label: con.name,
            parentName: '',
            connectorId: con.id,
            occupiedPins: getConnectorOccupancy(harness, con.id).map((entry) => ({
              pinNumber: entry.pinNumber,
              pathId: entry.pathId,
              signalName: entry.signalName,
            })),
            pinCount: getConnectorOccupancy(harness, con.id).length,
            matchesFilter: itemMatchesFilters(con.tags, activeFilters),
            wireAppearance: getPortWireAppearance(harness, con),
            connectorTypeId: con.connector_type,
            instanceImage: (con.properties?.image as string) || '',
          },
        } as Node);
      });

      directMergePoints.forEach((mergePoint, mergeIndex) => {
        enclosureMergeIds.add(mergePoint.id);
        const savedPos = mergeLayoutsForContext[mergePoint.id];
        const pos = savedPos ?? { x: 24 + (mergeIndex % 3) * 70, y: 96 + Math.floor(mergeIndex / 3) * 52 };
        const size = sizeLayouts[mergePoint.id] ?? { w: 52, h: 28 };
        gNodes.push({
          id: `${ENC_MERGE_PREFIX}${mergePoint.id}`,
          type: 'mergePoint',
          parentId: enc.id,
          extent: 'parent' as const,
          deletable: false,
          position: pos,
          style: { width: size.w, height: size.h },
          selected: selectedItem?.type === 'mergePoint' && selectedItem.id === mergePoint.id,
          data: {
            mergePointId: mergePoint.id,
            label: mergePoint.name,
            matchesFilter: itemMatchesFilters(mergePoint.tags, activeFilters),
          },
        } as Node);
      });
    }

    // ── Free-floating connector nodes (parent === spaceId) ───────────────
    for (const con of freeConnectors) {
      const nodeId = `${FREE_CON_PREFIX}${con.id}`;
      const freePos = freePortLayouts[con.id];
      const pos = freePos ?? { x: 100, y: 400 + gNodes.length * 60 };
      const conSize = sizeLayouts[con.id] ?? { w: 140, h: 32 };

      gNodes.push({
        id: nodeId,
        type: 'connector',
        deletable: false,
        position: { x: pos.x, y: pos.y },
        style: { width: conSize.w, height: conSize.h },
        selected: selectedItem?.type === 'connector' && selectedItem.id === con.id,
        data: {
          label: con.name,
          parentName: '',
          connectorId: con.id,
          occupiedPins: getConnectorOccupancy(harness, con.id).map((entry) => ({
            pinNumber: entry.pinNumber,
            pathId: entry.pathId,
            signalName: entry.signalName,
          })),
          pinCount: getConnectorOccupancy(harness, con.id).length,
          matchesFilter: itemMatchesFilters(con.tags, activeFilters),
          wireAppearance: getPortWireAppearance(harness, con),
          connectorTypeId: con.connector_type,
          instanceImage: (con.properties?.image as string) || '',
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
        if (enclosureMergeIds.has(mergePointId)) return `${ENC_MERGE_PREFIX}${mergePointId}`;
        return null;
      }
      return null;
    };

    const visibleSegments = getVisibleSegments(harness, spaceId);
    const bundles = deriveBundles(visibleSegments);

    const gEdges: Edge[] = bundles.flatMap((bundle) => {
      const sourceNodeId = getVisibleNodeId(bundle.sourceRefKey);
      const targetNodeId = getVisibleNodeId(bundle.targetRefKey);
      if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) return [];

      const pathAppearances = bundle.pathIds.map((pathId) => {
        const path = getPathById(harness, pathId);
        return path ? getWireAppearance(path) : getWireAppearance({ tags: [], properties: {} });
      });
      let matchesFilter = false;
      for (const pathId of bundle.pathIds) {
        const path = getPathById(harness, pathId);
        if (path && itemMatchesFilters(path.tags, activeFilters)) matchesFilter = true;
      }
      const firstAppearance = pathAppearances[0];
      const bundleColor =
        firstAppearance && pathAppearances.every((appearance) => appearance.key === firstAppearance.key)
          ? firstAppearance.primaryColor
          : '#666';

      const isSelected =
        selectedBundle &&
        bundle.pathIds.every((id) => selectedBundle.includes(id)) &&
        selectedBundle.every((id) => bundle.pathIds.includes(id));

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
        type: 'bundle',
        selected: !!isSelected,
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
  ]);

  const [nodes, setNodes, onNodesChangeBase] = useNodesState(graphNodes);
  const [edges, setEdges] = useEdgesState(graphEdges);

  useEffect(() => { setNodes(graphNodes); }, [graphNodes, setNodes]);
  useEffect(() => { setEdges(graphEdges); }, [graphEdges, setEdges]);

  // Auto-create junction when a waypoint is dropped near another edge
  useEffect(() => {
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

        pushUndoSnapshot();
        const insertAfterIndex = Math.max(0, segIndex - 1);

        if (existingJunctionId) {
          linkEdgeToJunction(existingJunctionId, edge.id, insertAfterIndex, dropPos);
        } else {
          const junctionId = createJunction(dropPos, draggedId, wpIdx);
          linkEdgeToJunction(junctionId, edge.id, insertAfterIndex, dropPos);
        }
        break;
      }
    }
  }, [draggingEdgeInfo, graphEdges, graphNodes, sizeLayouts, createJunction, linkEdgeToJunction, pushUndoSnapshot]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeBase(changes);

      const positionChanges = changes.filter((c) => c.type === 'position');
      const anyStarting = positionChanges.some(
        (c) => c.type === 'position' && c.dragging && !draggingNodes.current.has(c.id),
      );
      if (anyStarting && !didPushSnapshotForDrag.current) {
        didPushSnapshotForDrag.current = true;
        pushUndoSnapshot();
      }

      for (const change of positionChanges) {
        if (change.dragging) {
          draggingNodes.current.add(change.id);
        }

        if (change.position && !change.dragging) {
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
          } else if (change.id.startsWith(ENC_MERGE_PREFIX)) {
            const mergePointId = change.id.slice(ENC_MERGE_PREFIX.length);
            updateMergePointLayout(bgKey, mergePointId, change.position.x, change.position.y);
          } else {
            updateNodePosition(change.id, change.position.x, change.position.y);
          }
        }
      }
    },
    [onNodesChangeBase, updateNodePosition, updateBackground, updateTextBox,
     updateFreePortLayout, updatePortLayout, updateMergePointLayout, bgKey, pushUndoSnapshot],
  );

  const onPaneClick = useCallback(() => {
    selectItem(null);
    selectTextBox(null);
  }, [selectItem, selectTextBox]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.id === BG_NODE_ID) {
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
      if (node.id.startsWith(ENC_MERGE_PREFIX)) {
        const mergePointId = node.id.slice(ENC_MERGE_PREFIX.length);
        selectItem({ type: 'mergePoint', id: mergePointId });
        return;
      }
      selectItem({ type: 'enclosure', id: node.id });
    },
    [selectItem, selectTextBox],
  );

  return (
    <div className="w-full h-full bg-zinc-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.2}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ animated: false }}
        selectionOnDrag={lassoMode}
        panOnDrag={lassoMode ? false : true}
        selectionMode={SelectionMode.Partial}
      >
        <ViewportResetter viewportKey={bgKey} />
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
                  className="flex items-center gap-1.5 px-2 py-1 text-[11px] bg-zinc-800/90 border border-zinc-600 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 rounded shadow transition-colors"
                  onClick={() => setPickerOpen((p) => !p)}
                  title="Set background image"
                >
                  <span>🖼</span>
                  <span>Background</span>
                </button>
                {pickerOpen && (
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
          </div>
        </Panel>

        {selectedBundle && (
          <Panel position="bottom-center">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800/95 border border-zinc-600 rounded-lg shadow-lg">
              <span className="text-[10px] text-zinc-400">
                Click edge to add bend points · Drag bend point near another edge to create a junction · Double-click junction to unlink
              </span>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
