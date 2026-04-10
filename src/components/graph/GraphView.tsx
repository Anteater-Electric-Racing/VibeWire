import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
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
import { BundleEdge } from './BundleEdge';
import { BackgroundImageNode } from './BackgroundImageNode';
import { TextBoxNode } from './TextBoxNode';
import { ImagePickerPanel } from './ImagePickerPanel';
import { itemMatchesFilters } from '../../lib/tags';
import { getWireAppearance } from '../../lib/colors';
import {
  getChildEnclosures,
  getEnclosurePorts,
  getSpaceFreeConnectors,
  getEnclosureConnectors,
  getPortWireAppearance,
} from '../../lib/harness';
import { nearestOnPolyline, type Point } from '../../lib/paths';

const BG_NODE_ID = '__bg_image__';
const TB_NODE_PREFIX = '__tb_';
const FREE_CON_PREFIX = '__freecon_';
const ENC_CON_PREFIX = '__enccon_';

const nodeTypes = {
  enclosure: EnclosureNode,
  connector: ConnectorNode,
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
  const findPinOwner = useHarnessStore((s) => s.findPinOwner);
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

  const spaceId = drillDownEnclosure ?? null;
  const bgKey = spaceId ?? 'graph';

  const prevDragging = useRef(useHarnessStore.getState().draggingEdgeInfo);
  const draggingNodes = useRef(new Set<string>());
  const [pickerOpen, setPickerOpen] = useState(false);

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
    const freeConIds = new Set(freeConnectors.map((c) => c.id));
    // Tracks connector IDs that appear as child nodes inside enclosure rectangles
    const enclosureConIds = new Set<string>();

    const gNodes: Node[] = [];

    // ── Enclosure nodes + connector child nodes ──────────────────────────
    for (let idx = 0; idx < childEnclosures.length; idx++) {
      const enc = childEnclosures[idx];
      const defaultPos = { x: 50 + (idx % 4) * 330, y: 80 + Math.floor(idx / 4) * 250 };
      const pos = nodeLayouts[enc.id] ?? defaultPos;
      const size = sizeLayouts[enc.id] ?? { w: 220, h: 180 };

      const directConnectors = getEnclosurePorts(harness, enc.id);
      const allConnectors = getEnclosureConnectors(harness, enc.id);
      const childEncs = getChildEnclosures(harness, enc.id);

      let wireCount = 0;
      for (const wire of harness.wires) {
        const fromCon = findPinOwner(wire.from);
        const toCon = findPinOwner(wire.to);
        if (!fromCon || !toCon) continue;
        if (allConnectors.some((c) => c.id === fromCon.id) || allConnectors.some((c) => c.id === toCon.id)) {
          wireCount++;
        }
      }

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
          wireCount,
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
            pins: con.pins,
            matchesFilter: itemMatchesFilters(con.tags, activeFilters),
            wireAppearance: getPortWireAppearance(harness, con),
            connectorTypeId: con.connector_type,
            instanceImage: (con.properties?.image as string) || '',
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
          pins: con.pins,
          matchesFilter: itemMatchesFilters(con.tags, activeFilters),
          wireAppearance: getPortWireAppearance(harness, con),
          connectorTypeId: con.connector_type,
          instanceImage: (con.properties?.image as string) || '',
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
          imageUrl: `/img-assets/${bg.image}`,
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
          w: tb.w,
          h: tb.h,
        },
        style: { width: tb.w, height: tb.h },
        zIndex: 10,
      } as Node);
    }

    // ── Bundle edges — connect connector nodes directly ───────────────────
    const getVisibleNodeId = (conId: string): string | null => {
      if (freeConIds.has(conId)) return `${FREE_CON_PREFIX}${conId}`;
      if (enclosureConIds.has(conId)) return `${ENC_CON_PREFIX}${conId}`;
      return null;
    };

    const bundleMap = new Map<
      string,
      { wireIds: string[]; sourceNodeId: string; targetNodeId: string }
    >();

    for (const wire of harness.wires) {
      const fromCon = findPinOwner(wire.from);
      const toCon = findPinOwner(wire.to);
      if (!fromCon || !toCon) continue;

      const fromNode = getVisibleNodeId(fromCon.id);
      const toNode = getVisibleNodeId(toCon.id);
      if (!fromNode || !toNode || fromNode === toNode) continue;

      // Stable bundle key uses connector IDs so waypoints survive view changes
      let srcId = fromCon.id;
      let tgtId = toCon.id;
      let srcNode = fromNode;
      let tgtNode = toNode;
      if (srcId > tgtId) {
        [srcId, tgtId] = [tgtId, srcId];
        [srcNode, tgtNode] = [tgtNode, srcNode];
      }
      const key = `bundle_${srcId}_${tgtId}`;

      const existing = bundleMap.get(key);
      if (existing) {
        existing.wireIds.push(wire.id);
      } else {
        bundleMap.set(key, { wireIds: [wire.id], sourceNodeId: srcNode, targetNodeId: tgtNode });
      }
    }

    const gEdges: Edge[] = [...bundleMap.entries()].map(([key, bundle]) => {
      const wireAppearances = bundle.wireIds.map((wId) => {
        const wire = harness.wires.find((candidate) => candidate.id === wId);
        return wire ? getWireAppearance(wire) : getWireAppearance({ tags: [], properties: {} });
      });
      let matchesFilter = false;
      for (const wId of bundle.wireIds) {
        const w = harness.wires.find((wire) => wire.id === wId);
        if (!w) continue;
        if (itemMatchesFilters(w.tags, activeFilters)) matchesFilter = true;
      }
      const firstAppearance = wireAppearances[0];
      const bundleColor =
        firstAppearance && wireAppearances.every((a) => a.key === firstAppearance.key)
          ? firstAppearance.primaryColor
          : '#666';

      const isSelected =
        selectedBundle &&
        bundle.wireIds.every((id) => selectedBundle.includes(id)) &&
        selectedBundle.every((id) => bundle.wireIds.includes(id));

      const rawWps = waypointLayouts[key] ?? [];
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
        const isOwner = sortedMembers[0] === key;
        return { junctionId: wp.junctionId, isOwner, memberCount: j.memberEdgeIds.length };
      });

      return {
        id: key,
        source: bundle.sourceNodeId,
        target: bundle.targetNodeId,
        type: 'bundle',
        selected: !!isSelected,
        data: {
          wireIds: bundle.wireIds,
          wireCount: bundle.wireIds.length,
          wireAppearances,
          bundleColor,
          matchesFilter,
          resolvedWaypoints,
          junctionMeta,
          sourceStub: 0,
          targetStub: 0,
        },
      };
    });

    return { graphNodes: gNodes, graphEdges: gEdges };
  }, [
    harness, nodeLayouts, sizeLayouts, freePortLayouts, portLayouts, selectedItem,
    selectedBundle, activeFilters, findPinOwner, backgroundLayouts, bgKey,
    textBoxLayouts, waypointLayouts, junctionLayouts, spaceId,
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
      for (const change of changes) {
        if (change.type !== 'position') continue;

        if (change.dragging && !draggingNodes.current.has(change.id)) {
          draggingNodes.current.add(change.id);
          pushUndoSnapshot();
        }

        if (change.position && !change.dragging) {
          draggingNodes.current.delete(change.id);
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
          } else {
            updateNodePosition(change.id, change.position.x, change.position.y);
          }
        }
      }
    },
    [onNodesChangeBase, updateNodePosition, updateBackground, updateTextBox,
     updateFreePortLayout, updatePortLayout, bgKey, pushUndoSnapshot],
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
      >
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
