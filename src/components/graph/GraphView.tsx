import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  ConnectionMode,
  ControlButton,
  Controls,
  Panel,
  SelectionMode,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useOnViewportChange,
  useStore,
  useUpdateNodeInternals,
  type Node,
  type Edge,
  type OnConnectEnd,
  type OnConnectStart,
  type OnNodesChange,
  type NodeChange,
  type Connection,
  type ReactFlowInstance,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useSystemStore } from '../../store';
import type {
  ConnectorType,
  SystemData,
  SelectedHarnessBundle,
  CanvasImageLayouts,
  Signal,
  TextBoxLayouts,
  WaypointItem,
  WireRouteStyle,
} from '../../types';
import type { PresenceTargetKind } from '../../types/collab';
import { EnclosureNode } from './EnclosureNode';
import { ConnectorNode } from './ConnectorNode';
import { BranchPointNode } from './BranchPointNode';
import { HarnessBundleEdge } from './HarnessBundleEdge';
import { JoinKindPopup } from './JoinKindPopup';
import { CanvasImageNode } from './CanvasImageNode';
import { TextBoxNode } from './TextBoxNode';
import { ImagePickerPanel } from './ImagePickerPanel';
import {
  countPathsTouchingConnectors,
  getConnectorOccupancy,
  getConnectorSchematicImage,
  getChildEnclosures,
  getEnclosureBranchPoints,
  getEnclosurePorts,
  getEnclosureConnectors,
  getEntityRevealContext,
  getPathById,
  getPathSignalId,
  getPathWireAppearance,
  getPortWireAppearance,
  getSpaceFreeConnectors,
  getSpaceFreeBranchPoints,
  getVisibleWires,
  canMergePassThroughConnectors,
  canFuseBranchPoints,
  getHarnessBundleLayoutValue,
  getPathNodeHarnessBundleKey,
  branchPointIdFromRefKey,
  isBulkheadConnector,
  isGraphPinHandle,
  isInlineConnector,
  isPassThroughConnector,
} from '../../lib/systemTopology';
import { nearestOnPolyline, type Point } from '../../lib/paths';
import {
  DEFAULT_JOIN_KIND,
  type JoinKind,
  type PendingBundleJoin,
} from '../../lib/joinChoice';
import {
  DEFAULT_WIRE_ROUTE_STYLE,
  findRoutePointInsertIndex,
  resolveEdgeRouteStyle,
  routeViewKey,
  routedPolyline,
  snapToRouteGrid,
} from '../../lib/routeStyle';
import { HarnessBundleRouteStyleControls } from './RouteStyleBar';
import { WireColorEditor } from '../WireColorEditor';
import {
  CanvasPlacementContext,
  type CanvasPlacementMode,
} from './canvasPlacement';
import {
  getSheetViewport,
  setSheetViewport,
} from '../../lib/userPrefs';
import {
  RESTORE_VIEWPORT_EVENT,
  reportViewportForHistory,
  type RestoreViewportEventDetail,
} from '../../lib/viewHistoryEvents';
import { ADD_TEXT_BOX_EVENT, type AddTextBoxDetail } from '../../lib/textBoxes';
import { ADD_IMAGE_EVENT, canvasImageContextKey, imageMatchesContext } from '../../lib/canvasImages';
import {
  BULKHEAD_DOT_SIZE,
  getVisualDotRoutePin,
  isBulkheadDot,
  isTerminalVisualDot,
} from '../../lib/bulkheadRouting';
import {
  EXPANDED_CONNECTOR_Z_INDEX,
  getConnectorTablePinCount,
  resolveConnectorRenderedSize,
} from '../../lib/connectorSize';
import {
  buildSubsystemGraphModel,
  clampNodeToParentBounds,
  deriveGraphWireGroups,
  firstBundleIdByBase,
  getAbsoluteNodeCenter,
  getAbsoluteNodeRect,
  findOverlappingBranchPointPeer,
  findOverlappingPassThroughPeer,
  type BranchPointOverlapCandidate,
  GRAPH_Z_BACKGROUND,
  GRAPH_Z_CONNECTOR,
  GRAPH_Z_ENCLOSURE,
  GRAPH_Z_IMAGE_FOREGROUND,
  GRAPH_Z_MERGE,
  GRAPH_Z_SELECTED_IMAGE,
  GRAPH_Z_TEXT,
  GRAPH_Z_WIRE,
  graphWireZIndex,
  getNearestWallSide,
  isSharedAnchorLayoutOwner,
  SHARED_ANCHOR_SNAP_RADIUS_PX,
  positionNonAnchoringDots,
  projectNodeToEnclosureWall,
  SUBSYSTEM_CONNECTOR_PREFIX,
  SUBSYSTEM_DEVICE_PREFIX,
  SUBSYSTEM_FRAME_PREFIX,
} from './graphModel';

function edgeRouteStyle(edge: { data?: { routeStyle?: WireRouteStyle } } | undefined): WireRouteStyle {
  return edge?.data?.routeStyle === 'grid' ? 'grid' : 'straight';
}

function displayedEdgePolyline(
  source: Point,
  waypoints: Point[],
  target: Point,
  style: WireRouteStyle,
): Point[] {
  return routedPolyline([source, ...waypoints, target], style);
}

const ORIGIN_NODE_ID = '__origin__';
const TB_NODE_PREFIX = '__tb_';
const IMG_NODE_PREFIX = '__img_';
const FREE_CON_PREFIX = '__freecon_';

function resolveTextBoxParentNodeId(
  parentId: string | undefined,
  nodeIds: Set<string>,
): string | undefined {
  if (!parentId) return undefined;
  if (nodeIds.has(parentId)) return parentId;
  const deviceId = `${SUBSYSTEM_DEVICE_PREFIX}${parentId}`;
  if (nodeIds.has(deviceId)) return deviceId;
  const frameId = `${SUBSYSTEM_FRAME_PREFIX}${parentId}`;
  if (nodeIds.has(frameId)) return frameId;
  return undefined;
}

function appendTextBoxNodes(
  gNodes: Node[],
  textBoxLayouts: TextBoxLayouts,
  bgKey: string,
  selectedTextBoxId: string | null,
) {
  const nodeIds = new Set(gNodes.map((node) => node.id));
  for (const tb of Object.values(textBoxLayouts)) {
    const rfParent = resolveTextBoxParentNodeId(tb.parentId, nodeIds);
    if (tb.parentId) {
      if (!rfParent) continue;
    } else if ((tb.contextKey ?? 'graph') !== bgKey) {
      continue;
    }
    gNodes.push({
      id: `${TB_NODE_PREFIX}${tb.id}`,
      type: 'textBox',
      position: { x: tb.x, y: tb.y },
      draggable: true,
      selectable: true,
      connectable: false,
      selected: selectedTextBoxId === tb.id,
      ...(rfParent ? { parentId: rfParent, extent: 'parent' as const } : {}),
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
        autoFit: tb.autoFit,
      },
      style: { width: tb.w, height: tb.h },
      zIndex: GRAPH_Z_TEXT,
    } as Node);
  }
}

function canvasImageZIndex(layer: 'background' | 'foreground', selected: boolean, locked: boolean): number {
  if (selected && !locked) return GRAPH_Z_SELECTED_IMAGE;
  return layer === 'foreground' ? GRAPH_Z_IMAGE_FOREGROUND : GRAPH_Z_BACKGROUND;
}

function appendImageNodes(
  gNodes: Node[],
  imageLayouts: CanvasImageLayouts,
  bgKey: string,
  selectedImageId: string | null,
) {
  for (const img of Object.values(imageLayouts)) {
    if ((img.contextKey ?? 'graph') !== bgKey) continue;
    const selected = selectedImageId === img.id;
    gNodes.push({
      id: `${IMG_NODE_PREFIX}${img.id}`,
      type: 'canvasImage',
      position: { x: img.x, y: img.y },
      draggable: !img.locked,
      selectable: !img.locked,
      connectable: false,
      deletable: false,
      selected,
      data: {
        imageId: img.id,
        imageUrl: `/user-data/images/${img.image}`,
        w: img.w,
        h: img.h,
        locked: img.locked,
        layer: img.layer === 'foreground' ? 'foreground' : 'background',
      },
      style: { width: img.w, height: img.h },
      zIndex: canvasImageZIndex(img.layer === 'foreground' ? 'foreground' : 'background', selected, img.locked),
    } as Node);
  }
}

const ENC_CON_PREFIX = '__enccon_';
const FREE_BRANCH_PREFIX = '__freebranch_';
/** Half-length of each origin cross arm, in flow units. */
const ORIGIN_ARM_PX = 56;
const ORIGIN_SIZE = ORIGIN_ARM_PX * 2;
const STANDARD_ZOOM = 1;
const INLINE_DROP_RADIUS_PX = 32;

type RouteEndpoint = {
  connector_id: string;
  pin_number: number;
};

type DraftDotPlacement = {
  id: string;
  parentId: string;
  parentNodeId: string;
  parentIsContainer: boolean;
  position: Point;
  center: Point;
};

type RoutingDotPreview = Omit<DraftDotPlacement, 'id'>;

type PendingRouteState = {
  from: RouteEndpoint;
  to: RouteEndpoint;
  draftDot?: DraftDotPlacement;
};

function connectorIdFromGraphNodeId(nodeId: string): string | null {
  if (nodeId.startsWith(FREE_CON_PREFIX)) return nodeId.slice(FREE_CON_PREFIX.length);
  if (nodeId.startsWith(ENC_CON_PREFIX)) return nodeId.slice(ENC_CON_PREFIX.length);
  if (nodeId.startsWith(SUBSYSTEM_CONNECTOR_PREFIX)) return nodeId.slice(SUBSYSTEM_CONNECTOR_PREFIX.length);
  return null;
}

function branchPointIdFromGraphNodeId(nodeId: string): string | null {
  return nodeId.startsWith(FREE_BRANCH_PREFIX) ? nodeId.slice(FREE_BRANCH_PREFIX.length) : null;
}

const ROUTING_PIN_MENU_CLOSE_MS = 500;

function connectorIdUnderClientPoint(clientX: number, clientY: number): string | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    if (!(el instanceof Element)) continue;
    const nodeEl = el.closest('.react-flow__node-connector');
    const nodeId = nodeEl?.getAttribute('data-id');
    if (!nodeId) continue;
    const connectorId = connectorIdFromGraphNodeId(nodeId);
    if (connectorId) return connectorId;
  }
  return null;
}

function routeEndpointUnderClientPoint(
  system: SystemData,
  clientX: number,
  clientY: number,
): RouteEndpoint | null {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    if (!(element instanceof Element)) continue;
    const handle = element.closest<HTMLElement>('[data-route-pin]');
    if (!handle) continue;
    const nodeId = handle.closest('.react-flow__node-connector')?.getAttribute('data-id');
    const connectorId = nodeId ? connectorIdFromGraphNodeId(nodeId) : null;
    const pinNumber = Number(handle.dataset.routePin);
    if (!connectorId || !Number.isInteger(pinNumber) || pinNumber <= 0) continue;
    const connector = system.connectors.find((candidate) => candidate.id === connectorId);
    if (isBulkheadDot(connector) && !isTerminalVisualDot(system, connectorId)) {
      continue;
    }
    return { connector_id: connectorId, pin_number: pinNumber };
  }
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    if (!(element instanceof Element)) continue;
    const nodeId = element.closest('.react-flow__node-connector')?.getAttribute('data-id');
    const connectorId = nodeId ? connectorIdFromGraphNodeId(nodeId) : null;
    if (!connectorId) continue;
    const connector = system.connectors.find((candidate) => candidate.id === connectorId);
    if (!isBulkheadDot(connector)) continue;
    const pinNumber = getVisualDotRoutePin(system, connectorId);
    if (pinNumber !== null) {
      return { connector_id: connectorId, pin_number: pinNumber };
    }
  }
  return null;
}

function routeEndpointFromHandle(
  nodeId: string | null,
  handleId: string | null,
): RouteEndpoint | null {
  if (!nodeId || !handleId?.startsWith('pin:')) return null;
  const connectorId = connectorIdFromGraphNodeId(nodeId);
  const pinNumber = Number(handleId.slice(4));
  if (!connectorId || !Number.isInteger(pinNumber) || pinNumber <= 0) return null;
  return { connector_id: connectorId, pin_number: pinNumber };
}

function distanceToRect(point: Point, rect: { x: number; y: number; w: number; h: number }): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.w));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.h));
  return Math.hypot(dx, dy);
}

function distanceToRectBoundary(
  point: Point,
  rect: { x: number; y: number; w: number; h: number },
): number {
  const outsideDistance = distanceToRect(point, rect);
  if (outsideDistance > 0) return outsideDistance;
  return Math.min(
    point.x - rect.x,
    rect.x + rect.w - point.x,
    point.y - rect.y,
    rect.y + rect.h - point.y,
  );
}

function resolveRoutingDotPreview(
  system: SystemData,
  nodes: readonly Node[],
  cursor: Point,
): RoutingDotPreview | null {
  const overlapsExistingPassThrough = nodes.some((node) => {
    const connectorId = typeof node.data?.connectorId === 'string'
      ? node.data.connectorId
      : null;
    const connector = connectorId
      ? system.connectors.find((candidate) => candidate.id === connectorId)
      : undefined;
    if (
      !connectorId
      || !connector
      || (!isBulkheadDot(connector) && !isBulkheadConnector(system, connectorId))
    ) {
      return false;
    }
    const rect = getAbsoluteNodeRect(node.id, nodes);
    return !!rect && distanceToRect(cursor, rect) <= BULKHEAD_DOT_SIZE;
  });
  if (overlapsExistingPassThrough) return null;

  const targets = nodes.flatMap((node) => {
    if (node.type !== 'enclosure') return [];
    const enclosureId = typeof node.data?.enclosureId === 'string'
      ? node.data.enclosureId
      : null;
    const enclosure = enclosureId
      ? system.hierarchy.find((candidate) => candidate.id === enclosureId)
      : undefined;
    const rect = enclosure ? getAbsoluteNodeRect(node.id, nodes) : null;
    const hoverRadius = BULKHEAD_DOT_SIZE / 2;
    const wallDistance = rect
      ? distanceToRectBoundary(cursor, rect)
      : Number.POSITIVE_INFINITY;
    if (
      !enclosure
      || !rect
      || wallDistance > hoverRadius
    ) {
      return [];
    }
    return [{ node, enclosure, rect, area: rect.w * rect.h }];
  }).sort((left, right) => left.area - right.area);
  const target = targets[0];
  if (!target) return null;

  const relative = {
    x: cursor.x - target.rect.x - BULKHEAD_DOT_SIZE / 2,
    y: cursor.y - target.rect.y - BULKHEAD_DOT_SIZE / 2,
  };
  const position = target.enclosure.kind === 'enclosure'
    ? projectNodeToEnclosureWall(
        relative,
        { w: BULKHEAD_DOT_SIZE, h: BULKHEAD_DOT_SIZE },
        { w: target.rect.w, h: target.rect.h },
      )
    : clampNodeToParentBounds(
        relative,
        { w: BULKHEAD_DOT_SIZE, h: BULKHEAD_DOT_SIZE },
        { w: target.rect.w, h: target.rect.h },
      );
  return {
    parentId: target.enclosure.id,
    parentNodeId: target.node.id,
    parentIsContainer: target.enclosure.kind === 'enclosure',
    position,
    center: {
      x: target.rect.x + position.x + BULKHEAD_DOT_SIZE / 2,
      y: target.rect.y + position.y + BULKHEAD_DOT_SIZE / 2,
    },
  };
}

function RoutingDotPreviewOverlay({
  preview,
  onPointerDown,
}: {
  preview: RoutingDotPreview;
  onPointerDown?: (event: React.PointerEvent) => void;
}) {
  const [translateX, translateY, zoom] = useStore((state) => state.transform);
  return (
    <div
      className={`absolute left-0 top-0 z-[1000] rounded-full border-2 border-zinc-950 bg-amber-400 ${
        onPointerDown ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none'
      }`}
      style={{
        width: BULKHEAD_DOT_SIZE,
        height: BULKHEAD_DOT_SIZE,
        transform: `translate(${translateX + preview.center.x * zoom - BULKHEAD_DOT_SIZE * zoom / 2}px, ${translateY + preview.center.y * zoom - BULKHEAD_DOT_SIZE * zoom / 2}px) scale(${zoom})`,
        transformOrigin: 'top left',
      }}
      title={onPointerDown ? 'Drag from this wall to create and route a visual dot' : undefined}
      onPointerDown={onPointerDown}
    />
  );
}

function RoutingDraftLineOverlay({ from, to }: { from: Point; to: Point }) {
  const [translateX, translateY, zoom] = useStore((state) => state.transform);
  return (
    <svg className="pointer-events-none absolute inset-0 z-[999] h-full w-full overflow-visible">
      <line
        x1={translateX + from.x * zoom}
        y1={translateY + from.y * zoom}
        x2={translateX + to.x * zoom}
        y2={translateY + to.y * zoom}
        stroke="#f59e0b"
        strokeWidth={2}
        strokeDasharray="5 4"
      />
    </svg>
  );
}

function passThroughCandidateFromNode(
  node: Node,
  position = node.position,
) {
  const style = node.style as { width?: number; height?: number } | undefined;
  return {
    id: node.id,
    parentId: node.parentId,
    position,
    size: {
      w: Number(style?.width ?? node.width ?? 96),
      h: Number(style?.height ?? node.height ?? 36),
    },
    wallMounted: !!node.data.wallMounted,
    passThrough: !!node.data.passThrough,
  };
}

function findOverlappingMergePeerNodeId(
  dragged: Node,
  position: { x: number; y: number },
  nodes: readonly Node[],
): string | null {
  const parent = dragged.parentId
    ? nodes.find((candidate) => candidate.id === dragged.parentId)
    : undefined;
  const parentStyle = parent?.style as { width?: number; height?: number } | undefined;
  const enclosureSize =
    typeof parentStyle?.width === 'number' && typeof parentStyle.height === 'number'
      ? { w: parentStyle.width, h: parentStyle.height }
      : null;
  return findOverlappingPassThroughPeer(
    passThroughCandidateFromNode(dragged, position),
    nodes.map((node) => passThroughCandidateFromNode(node)),
    enclosureSize,
  );
}

function branchPointCandidateFromNode(
  node: Node,
  position = node.position,
): BranchPointOverlapCandidate | null {
  const branchPointId = (node.data as { branchPointId?: unknown } | undefined)?.branchPointId;
  if (typeof branchPointId !== 'string') return null;
  const style = node.style as { width?: number; height?: number } | undefined;
  return {
    id: node.id,
    branchPointId,
    parentId: node.parentId,
    position,
    size: {
      w: Number(style?.width ?? node.width ?? 52),
      h: Number(style?.height ?? node.height ?? 28),
    },
  };
}

function findOverlappingBranchPointPeerNodeId(
  dragged: Node,
  position: { x: number; y: number },
  nodes: readonly Node[],
): string | null {
  const draggedCandidate = branchPointCandidateFromNode(dragged, position);
  if (!draggedCandidate) return null;
  const candidates = nodes
    .map((node) => branchPointCandidateFromNode(node))
    .filter((candidate): candidate is BranchPointOverlapCandidate => candidate !== null);
  return findOverlappingBranchPointPeer(draggedCandidate, candidates);
}

const OriginNode = memo(function OriginNode() {
  const c = ORIGIN_ARM_PX;
  return (
    <div aria-hidden className="pointer-events-none" style={{ width: ORIGIN_SIZE, height: ORIGIN_SIZE }}>
      <svg width={ORIGIN_SIZE} height={ORIGIN_SIZE} viewBox={`0 0 ${ORIGIN_SIZE} ${ORIGIN_SIZE}`}>
        <line
          x1={c}
          y1={0}
          x2={c}
          y2={ORIGIN_SIZE}
          stroke="#a1a1aa"
          strokeWidth={1.5}
        />
        <line
          x1={0}
          y1={c}
          x2={ORIGIN_SIZE}
          y2={c}
          stroke="#a1a1aa"
          strokeWidth={1.5}
        />
      </svg>
    </div>
  );
});

const ORIGIN_NODE: Node = {
  id: ORIGIN_NODE_ID,
  type: 'origin',
  // Top-left offset so the cross center sits on flow (0, 0).
  position: { x: -ORIGIN_ARM_PX, y: -ORIGIN_ARM_PX },
  draggable: false,
  selectable: false,
  focusable: false,
  deletable: false,
  connectable: false,
  zIndex: GRAPH_Z_BACKGROUND,
  style: { width: ORIGIN_SIZE, height: ORIGIN_SIZE },
  data: {},
};

/** Map a React Flow node id to the collab presence / interaction target it represents. */
function presenceTargetForGraphNode(
  nodeId: string,
): { kind: PresenceTargetKind; id: string } | null {
  if (nodeId === ORIGIN_NODE_ID) return null;
  if (nodeId.startsWith(IMG_NODE_PREFIX)) {
    return { kind: 'image', id: nodeId.slice(IMG_NODE_PREFIX.length) };
  }
  if (nodeId.startsWith(TB_NODE_PREFIX)) {
    return { kind: 'textBox', id: nodeId.slice(TB_NODE_PREFIX.length) };
  }
  if (nodeId.startsWith(FREE_CON_PREFIX)) {
    return { kind: 'connector', id: nodeId.slice(FREE_CON_PREFIX.length) };
  }
  if (nodeId.startsWith(ENC_CON_PREFIX)) {
    return { kind: 'connector', id: nodeId.slice(ENC_CON_PREFIX.length) };
  }
  if (nodeId.startsWith(FREE_BRANCH_PREFIX)) {
    return { kind: 'branchPoint', id: nodeId.slice(FREE_BRANCH_PREFIX.length) };
  }
  if (nodeId.startsWith(SUBSYSTEM_CONNECTOR_PREFIX)) {
    return { kind: 'connector', id: nodeId.slice(SUBSYSTEM_CONNECTOR_PREFIX.length) };
  }
  if (nodeId.startsWith(SUBSYSTEM_DEVICE_PREFIX)) {
    return { kind: 'enclosure', id: nodeId.slice(SUBSYSTEM_DEVICE_PREFIX.length) };
  }
  if (nodeId.startsWith(SUBSYSTEM_FRAME_PREFIX)) {
    return { kind: 'enclosure', id: nodeId.slice(SUBSYSTEM_FRAME_PREFIX.length) };
  }
  return { kind: 'enclosure', id: nodeId };
}

const nodeTypes = {
  enclosure: EnclosureNode,
  connector: ConnectorNode,
  branchPoint: BranchPointNode,
  backgroundImage: CanvasImageNode,
  canvasImage: CanvasImageNode,
  textBox: TextBoxNode,
  origin: OriginNode,
};
const edgeTypes = { harnessBundle: HarnessBundleEdge };

function AddTextBoxButton() {
  const { screenToFlowPosition } = useReactFlow();
  const addTextBox = useSystemStore((s) => s.addTextBox);
  const isEditor = useSystemStore((s) => s.session.isEditor);

  const handleAdd = useCallback((explicitParentId?: string) => {
    if (!isEditor) return;
    const state = useSystemStore.getState();
    const selected = state.selectedItem;
    const parentId = explicitParentId
      ?? (selected?.type === 'enclosure' ? selected.id : undefined);

    if (parentId) {
      const subsystem = state.activeSubsystemId ? state.subsystems[state.activeSubsystemId] : undefined;
      const size = state.sizeLayouts[parentId]
        ?? subsystem?.devices[parentId]
        ?? subsystem?.enclosures[parentId]
        ?? { w: 220, h: 180 };
      const parentW = Number(size.w) || 220;
      const parentH = Number(size.h) || 180;
      const w = Math.min(180, Math.max(72, parentW - 16));
      const h = Math.min(48, Math.max(36, Math.min(48, parentH - 16)));
      addTextBox(Math.max(4, (parentW - w) / 2), 8, { parentId, w, h });
      return;
    }

    const flowPos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    addTextBox(flowPos.x - 110, flowPos.y - 55);
  }, [addTextBox, isEditor, screenToFlowPosition]);

  useEffect(() => {
    const onAdd = (event: Event) => {
      const parentId = (event as CustomEvent<AddTextBoxDetail>).detail?.parentId;
      handleAdd(parentId);
    };
    window.addEventListener(ADD_TEXT_BOX_EVENT, onAdd);
    return () => window.removeEventListener(ADD_TEXT_BOX_EVENT, onAdd);
  }, [handleAdd]);

  return (
    <button
      disabled={!isEditor}
      className="flex items-center gap-1.5 px-2 py-1 text-[11px] bg-zinc-800/90 border border-zinc-600 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 rounded shadow transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-zinc-800/90 disabled:hover:text-zinc-300"
      onClick={() => handleAdd()}
      title={isEditor ? 'Add a text box on the selected device' : 'Log in to add a text box'}
    >
      <span className="font-bold text-[12px] leading-none">T</span>
      <span>Text Box</span>
    </button>
  );
}

function AddImageButton() {
  const { screenToFlowPosition } = useReactFlow();
  const addImage = useSystemStore((s) => s.addImage);
  const isEditor = useSystemStore((s) => s.session.isEditor);
  const [pickerOpen, setPickerOpen] = useState(false);

  const placeImage = useCallback((filename: string) => {
    if (!isEditor) return;
    const flowPos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const state = useSystemStore.getState();
    const viewKey = canvasImageContextKey(
      state.editingSurface,
      state.openEnclosureId,
      state.activeSubsystemId,
    );
    const count = Object.values(state.imageLayouts).filter((img) =>
      imageMatchesContext(img.contextKey, viewKey),
    ).length;
    addImage(flowPos.x - 240 + count * 16, flowPos.y - 160 + count * 16, filename);
  }, [addImage, isEditor, screenToFlowPosition]);

  useEffect(() => {
    const onAdd = () => {
      if (!isEditor) return;
      setPickerOpen(true);
    };
    window.addEventListener(ADD_IMAGE_EVENT, onAdd);
    return () => window.removeEventListener(ADD_IMAGE_EVENT, onAdd);
  }, [isEditor]);

  return (
    <div className="relative">
      <button
        disabled={!isEditor}
        className="flex items-center gap-1.5 px-2 py-1 text-[11px] bg-zinc-800/90 border border-zinc-600 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 rounded shadow transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-zinc-800/90 disabled:hover:text-zinc-300"
        onClick={() => setPickerOpen((open) => !open)}
        title={isEditor ? 'Add a floating image' : 'Log in to add an image'}
      >
        <span>🖼</span>
        <span>Image</span>
      </button>
      {pickerOpen && isEditor && (
        <ImagePickerPanel
          title="Add image"
          onPick={placeImage}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

/** Cleared on full page reload; survives in-app GraphView remounts (tab switches). */
let hasHomedOnPageLoad = false;

const PAN_GESTURE_THRESHOLD_PX = 3;
const PAN_GESTURE_UI_CHROME = [
  'button',
  'input',
  'textarea',
  'select',
  'a',
  '[contenteditable="true"]',
  '.react-flow__panel',
  '.react-flow__controls',
  '.react-flow__minimap',
].join(',');

function isModifierPanGesture(event: PointerEvent): boolean {
  if (event.pointerType === 'touch') return false;
  if (event.button === 2) return true;
  return event.button === 0 && (event.ctrlKey || event.metaKey);
}

/** Right-click, Ctrl, or Command drag pans the canvas, including over nodes. */
function CanvasPanGestures() {
  const { getViewport, setViewport } = useReactFlow();
  const domNode = useStore((state) => state.domNode);

  useEffect(() => {
    if (!domNode) return;

    type Session = {
      pointerId: number;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
      zoom: number;
      moved: boolean;
    };

    let session: Session | null = null;
    let suppressContextMenu = false;

    const onPointerDown = (event: PointerEvent) => {
      if (!isModifierPanGesture(event)) return;
      if (event.target instanceof Element && event.target.closest(PAN_GESTURE_UI_CHROME)) {
        return;
      }

      const viewport = getViewport();
      session = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: viewport.x,
        originY: viewport.y,
        zoom: viewport.zoom,
        moved: false,
      };
      // Own the gesture so nodes/lasso/xyflow do not also start a drag.
      event.stopPropagation();
      if (event.button === 2) event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!session || event.pointerId !== session.pointerId) return;
      const dx = event.clientX - session.startX;
      const dy = event.clientY - session.startY;
      if (!session.moved) {
        if (Math.hypot(dx, dy) < PAN_GESTURE_THRESHOLD_PX) return;
        session.moved = true;
        suppressContextMenu = true;
        domNode.classList.add('cursor-grabbing');
        document.body.style.userSelect = 'none';
      }
      event.preventDefault();
      void setViewport(
        { x: session.originX + dx, y: session.originY + dy, zoom: session.zoom },
        { duration: 0 },
      );
    };

    const endSession = (event: PointerEvent) => {
      if (!session || event.pointerId !== session.pointerId) return;
      const moved = session.moved;
      session = null;
      domNode.classList.remove('cursor-grabbing');
      document.body.style.userSelect = '';
      if (!moved) return;
      const swallowClick = (clickEvent: MouseEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
      };
      window.addEventListener('click', swallowClick, { capture: true, once: true });
      window.setTimeout(() => {
        window.removeEventListener('click', swallowClick, { capture: true });
      }, 50);
    };

    const onContextMenu = (event: MouseEvent) => {
      if (!suppressContextMenu && !session?.moved) return;
      event.preventDefault();
      suppressContextMenu = false;
    };

    // Document capture runs before React's root listener, so nodes/lasso
    // never start a competing drag.
    const onPointerDownCapture = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !domNode.contains(event.target)) return;
      onPointerDown(event);
    };

    document.addEventListener('pointerdown', onPointerDownCapture, true);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endSession);
    window.addEventListener('pointercancel', endSession);
    document.addEventListener('contextmenu', onContextMenu);
    return () => {
      document.removeEventListener('pointerdown', onPointerDownCapture, true);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endSession);
      window.removeEventListener('pointercancel', endSession);
      document.removeEventListener('contextmenu', onContextMenu);
      document.body.style.userSelect = '';
    };
  }, [domNode, getViewport, setViewport]);

  return null;
}

function ViewportMemory({
  viewportKey,
  userId,
  defaultZoom = STANDARD_ZOOM,
}: {
  viewportKey: string;
  userId: string | null;
  defaultZoom?: number;
}) {
  const { getViewport, setViewport, setCenter } = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const activeKeyRef = useRef(viewportKey);
  const userIdRef = useRef(userId);
  const readyRef = useRef(false);
  const appliedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // setCenter needs a measured pane; retry when width/height become available.
    if (width <= 0 || height <= 0) return;

    const previousKey = activeKeyRef.current;
    const previousUserId = userIdRef.current;
    const keyChanged = previousKey !== viewportKey;
    const userChanged = previousUserId !== userId;
    const alreadyApplied = appliedKeyRef.current === viewportKey
      && !keyChanged
      && !userChanged
      && hasHomedOnPageLoad;

    if (alreadyApplied) return;

    readyRef.current = false;
    if (previousKey && keyChanged) {
      setSheetViewport(previousUserId, previousKey, getViewport());
    } else if (previousKey && userChanged) {
      // Session user resolved after pan — keep camera, re-key prefs to the user.
      setSheetViewport(userId, previousKey, getViewport());
    }

    activeKeyRef.current = viewportKey;
    userIdRef.current = userId;
    appliedKeyRef.current = viewportKey;

    const finish = () => {
      requestAnimationFrame(() => {
        readyRef.current = true;
        reportViewportForHistory(viewportKey, getViewport(), false);
      });
    };

    // Full page load / refresh: always start centered on the origin.
    // In-session sheet/tab changes still restore the saved camera below.
    if (!hasHomedOnPageLoad) {
      hasHomedOnPageLoad = true;
      void setCenter(0, 0, { zoom: defaultZoom, duration: 0 }).finally(finish);
      return;
    }

    const saved = getSheetViewport(userId, viewportKey);
    const apply = saved
      ? setViewport(saved, { duration: 0 })
      : setCenter(0, 0, { zoom: defaultZoom, duration: 0 });
    void Promise.resolve(apply).finally(finish);
  }, [defaultZoom, getViewport, setViewport, setCenter, userId, viewportKey, width, height]);

  useOnViewportChange({
    onEnd: (viewport) => {
      if (!readyRef.current) return;
      const key = activeKeyRef.current;
      if (key) {
        setSheetViewport(userIdRef.current, key, viewport);
        reportViewportForHistory(key, viewport, true);
      }
    },
  });

  useEffect(() => {
    function onRestoreViewport(event: Event) {
      const { viewportKey: requestedKey, viewport } = (
        event as CustomEvent<RestoreViewportEventDetail>
      ).detail;
      if (requestedKey !== activeKeyRef.current) return;

      readyRef.current = false;
      setSheetViewport(userIdRef.current, requestedKey, viewport);
      void Promise.resolve(setViewport(viewport, { duration: 0 })).finally(() => {
        requestAnimationFrame(() => {
          readyRef.current = true;
          reportViewportForHistory(requestedKey, getViewport(), false);
        });
      });
    }

    window.addEventListener(RESTORE_VIEWPORT_EVENT, onRestoreViewport);
    return () => window.removeEventListener(RESTORE_VIEWPORT_EVENT, onRestoreViewport);
  }, [getViewport, setViewport]);

  useEffect(() => {
    return () => {
      const key = activeKeyRef.current;
      if (!key) return;
      setSheetViewport(userIdRef.current, key, getViewport());
    };
  }, [getViewport]);

  return null;
}

function StripNativeControlTitles() {
  useLayoutEffect(() => {
    document.querySelectorAll('.react-flow__controls button[title]').forEach((button) => {
      button.removeAttribute('title');
    });
  });
  return null;
}

function FitViewOnFKey() {
  const { fitView } = useReactFlow();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.isContentEditable;
      if (isTyping || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (event.key !== 'f' && event.key !== 'F') return;
      event.preventDefault();
      void fitView();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fitView]);

  return null;
}

function OriginHomeButton({ zoom = STANDARD_ZOOM }: { zoom?: number }) {
  const { setCenter } = useReactFlow();

  return (
    <ControlButton
      onClick={() => {
        void setCenter(0, 0, { zoom, duration: 220 });
      }}
      aria-label="take to origin"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2.5 7.5 L8 2.5 L13.5 7.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 7 v5.5 h8 V7" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="8" cy="9.5" r="1.4" fill="currentColor" stroke="none" />
      </svg>
    </ControlButton>
  );
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
  const revealRequest = useSystemStore((s) => s.revealRequest);
  const editingSurface = useSystemStore((s) => s.editingSurface);
  const openEnclosureId = useSystemStore((s) => s.openEnclosureId);
  const selectedItem = useSystemStore((s) => s.selectedItem);
  const inspectorDismissed = useSystemStore((s) => s.inspectorDismissed);
  const system = useSystemStore((s) => s.system);
  const processedRequest = useRef<number | null>(null);

  useEffect(() => {
    if (!revealRequest || processedRequest.current === revealRequest.requestId || !system) return;

    const item = revealRequest.item;
    let targetNodes: Node[] = [];

    if (item.type === 'enclosure') {
      targetNodes = nodes.filter((node) => node.data?.enclosureId === item.id);
    } else if (item.type === 'connector') {
      targetNodes = nodes.filter((node) => node.data?.connectorId === item.id);
    } else if (item.type === 'branchPoint') {
      targetNodes = nodes.filter((node) => node.data?.branchPointId === item.id);
    } else {
      const pathIds = item.type === 'path'
        ? new Set([item.id])
        : new Set(
            system.paths
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
      if (!selectedItem || inspectorDismissed) return;
      useSystemStore.setState({
        editingSurface: 'hierarchy',
        openEnclosureId: getEntityRevealContext(system, item, openEnclosureId),
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
    openEnclosureId,
    edges,
    editingSurface,
    fitView,
    system,
    inspectorDismissed,
    nodes,
    revealRequest,
    selectedItem,
  ]);

  return null;
}

const NEW_SIGNAL_VALUE = '__new_signal__';
const DEFAULT_NEW_SIGNAL_NAME = 'new signal';
const DEFAULT_NEW_SIGNAL_COLOR = 'grey';

function draftsForSignal(signal: Signal | undefined): { name: string; color: string } {
  if (!signal) {
    return { name: '', color: DEFAULT_NEW_SIGNAL_COLOR };
  }
  return {
    name: signal.name,
    color: signal.properties.preferred_wire_color ?? '',
  };
}

function ChooseSignalPanel({
  signals,
  selectedSignalId,
  draftName,
  draftColor,
  creating,
  onSelectSignal,
  onNameChange,
  onColorChange,
  onCancel,
  onConfirm,
  onOpenEditor,
}: {
  signals: Signal[];
  selectedSignalId: string;
  draftName: string;
  draftColor: string;
  creating: boolean;
  onSelectSignal: (signalId: string) => void;
  onNameChange: (name: string) => void;
  onColorChange: (color: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onOpenEditor: () => void;
}) {
  const isNew = selectedSignalId === NEW_SIGNAL_VALUE;
  return (
    <form
      className="w-80 rounded border border-zinc-600 bg-zinc-900/95 p-3 shadow-xl text-xs"
      onSubmit={(event) => {
        event.preventDefault();
        if (!creating) onConfirm();
      }}
    >
      <div className="font-semibold text-zinc-100 mb-2">Choose signal</div>
      <select
        value={selectedSignalId}
        disabled={creating}
        onChange={(event) => onSelectSignal(event.target.value)}
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-100 disabled:opacity-50"
        aria-label="Signal"
      >
        <option value={NEW_SIGNAL_VALUE}>Uninitialized</option>
        {[...signals]
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((signal) => (
            <option key={signal.id} value={signal.id}>
              {signal.name} · {signal.id}
            </option>
          ))}
      </select>
      <label className="mt-2 flex items-center gap-2">
        <span className="text-[10px] text-zinc-500 w-12 shrink-0 text-right">Name</span>
        <input
          autoFocus
          value={draftName}
          disabled={creating}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={isNew ? DEFAULT_NEW_SIGNAL_NAME : 'Signal name'}
          aria-label="Signal name"
          className="min-w-0 flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-100 placeholder-zinc-600 focus:border-amber-500 focus:outline-none disabled:opacity-50"
        />
      </label>
      <div className="mt-1">
        <WireColorEditor
          key={selectedSignalId}
          label="Color"
          value={draftColor}
          onChange={onColorChange}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          className="text-amber-400 hover:text-amber-300 disabled:cursor-wait disabled:opacity-50"
          disabled={creating}
          onClick={onOpenEditor}
        >
          Open full editor
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            className="text-zinc-400 disabled:opacity-50"
            disabled={creating}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded bg-amber-600 px-2 py-1 text-white disabled:opacity-40"
            disabled={creating}
          >
            {creating ? 'Routing…' : 'Route wire'}
          </button>
        </div>
      </div>
    </form>
  );
}

export function GraphView() {
  const system = useSystemStore((s) => s.system);
  const isEditor = useSystemStore((s) => s.session.isEditor);
  const activeSystemName = useSystemStore((s) => s.activeSystemName);
  const nodeLayouts = useSystemStore((s) => s.nodeLayouts);
  const sizeLayouts = useSystemStore((s) => s.sizeLayouts);
  const expandedSizeOverrides = useSystemStore((s) => s.expandedSizeOverrides);
  const connectorLibrary = useSystemStore((s) => s.connectorLibrary);
  const freePortLayouts = useSystemStore((s) => s.freePortLayouts);
  const portLayouts = useSystemStore((s) => s.portLayouts);
  const updateNodePosition = useSystemStore((s) => s.updateNodePosition);
  const updatePortLayout = useSystemStore((s) => s.updatePortLayout);
  const updateFreePortLayout = useSystemStore((s) => s.updateFreePortLayout);
  const addInlineConnector = useSystemStore((s) => s.addInlineConnector);
  const insertInlineConnectorOnBundle = useSystemStore(
    (s) => s.insertInlineConnectorOnBundle,
  );
  const imageLayouts = useSystemStore((s) => s.imageLayouts);
  const selectedImageId = useSystemStore((s) => s.selectedImageId);
  const updateImage = useSystemStore((s) => s.updateImage);
  const selectImage = useSystemStore((s) => s.selectImage);
  const selectedItem = useSystemStore((s) => s.selectedItem);
  const selectedHarnessBundle = useSystemStore((s) => s.selectedHarnessBundle);
  const selectItem = useSystemStore((s) => s.selectItem);
  const openEnclosureId = useSystemStore((s) => s.openEnclosureId);
  const setOpenEnclosure = useSystemStore((s) => s.setOpenEnclosure);
  const textBoxLayouts = useSystemStore((s) => s.textBoxLayouts);
  const selectedTextBoxId = useSystemStore((s) => s.selectedTextBoxId);
  const updateTextBox = useSystemStore((s) => s.updateTextBox);
  const selectTextBox = useSystemStore((s) => s.selectTextBox);
  const waypointLayouts = useSystemStore((s) => s.waypointLayouts);
  const routeStyleLayouts = useSystemStore((s) => s.routeStyleLayouts);
  const viewRouteStyleLayouts = useSystemStore((s) => s.viewRouteStyleLayouts);
  const setEdgeWaypoints = useSystemStore((s) => s.setEdgeWaypoints);
  const sharedAnchors = useSystemStore((s) => s.sharedAnchors);
  const joinBundlesAtDrop = useSystemStore((s) => s.joinBundlesAtDrop);
  const linkEdgeToSharedAnchor = useSystemStore((s) => s.linkEdgeToSharedAnchor);
  const draggingEdgeInfo = useSystemStore((s) => s.draggingEdgeInfo);
  const pushUndoSnapshot = useSystemStore((s) => s.pushUndoSnapshot);
  const commitUndoSnapshot = useSystemStore((s) => s.commitUndoSnapshot);
  const cancelUndoSnapshot = useSystemStore((s) => s.cancelUndoSnapshot);
  const branchPointLayouts = useSystemStore((s) => s.branchPointLayouts);
  const updateBranchPointLayout = useSystemStore((s) => s.updateBranchPointLayout);
  const expandedNodes = useSystemStore((s) => s.expandedNodes);
  const editingSurface = useSystemStore((s) => s.editingSurface);
  const activeSubsystemId = useSystemStore((s) => s.activeSubsystemId);
  const subsystems = useSystemStore((s) => s.subsystems);
  const updateSubsystemEntityLayout = useSystemStore((s) => s.updateSubsystemEntityLayout);
  const addEntityToActiveSubsystem = useSystemStore((s) => s.addEntityToActiveSubsystem);
  const mergeBulkheadConnectors = useSystemStore((s) => s.mergeBulkheadConnectors);
  const fuseBranchPoints = useSystemStore((s) => s.fuseBranchPoints);
  const setMutationError = useSystemStore((s) => s.setMutationError);
  const mutationError = useSystemStore((s) => s.mutationError);
  const removeEntityFromActiveSubsystem = useSystemStore((s) => s.removeEntityFromActiveSubsystem);
  const updateSignalName = useSystemStore((s) => s.updateSignalName);
  const updateSignalProperty = useSystemStore((s) => s.updateSignalProperty);
  const openSignalLibrary = useSystemStore((s) => s.openSignalLibrary);
  const setInteracting = useSystemStore((s) => s.setInteracting);
  const userId = useSystemStore((s) => s.session.user?.id ?? null);

  const spaceId = openEnclosureId ?? null;
  const bgKey = spaceId ?? 'graph';
  const imageContextKey = canvasImageContextKey(
    editingSurface,
    openEnclosureId,
    activeSubsystemId,
  );
  const viewportKey = editingSurface === 'subsystem'
    ? `${activeSystemName}:subsystem:${activeSubsystemId ?? 'none'}`
    : `${activeSystemName}:hierarchy:${bgKey}`;
  const currentRouteViewKey = routeViewKey(editingSurface, activeSubsystemId);
  const viewRouteStyle = viewRouteStyleLayouts[currentRouteViewKey] ?? DEFAULT_WIRE_ROUTE_STYLE;

  const prevDragging = useRef(useSystemStore.getState().draggingEdgeInfo);
  const reactFlowInstance = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const graphContainerRef = useRef<HTMLDivElement | null>(null);
  const draggingNodes = useRef(new Set<string>());
  const didPushSnapshotForDrag = useRef(false);
  const nodesRef = useRef<Node[]>([]);
  const [canvasPlacement, setCanvasPlacement] = useState<CanvasPlacementMode>('none');
  const [pendingJoin, setPendingJoin] = useState<PendingBundleJoin | null>(null);
  const [joinFocus, setJoinFocus] = useState<JoinKind>(DEFAULT_JOIN_KIND);
  const inlineDropTarget = useRef<{
    bundle: SelectedHarnessBundle;
    point: Point;
    bundleLayout: {
      before: WaypointItem[];
      after: WaypointItem[];
    };
  } | null>(null);
  const mergeDropTargetId = useRef<string | null>(null);
  const didMergeOnDrop = useRef(false);
  const connectionStart = useRef<RouteEndpoint | null>(null);
  const connectionCompleted = useRef(false);
  const routingPreviewRef = useRef<RoutingDotPreview | null>(null);
  const routingFromConnectorId = useRef<string | null>(null);
  const routingAutoExpanded = useRef<Set<string>>(new Set());
  const routingPinMenuCloseTimer = useRef<number | null>(null);
  const routingPinMenuMoveRef = useRef<(event: PointerEvent) => void>(() => {});
  const [routingPreview, setRoutingPreview] = useState<RoutingDotPreview | null>(null);
  const draftRouteSourceRef = useRef<DraftDotPlacement | null>(null);
  const [draftRouteSource, setDraftRouteSource] = useState<DraftDotPlacement | null>(null);
  const [draftRouteCursor, setDraftRouteCursor] = useState<Point | null>(null);
  const [pendingRoute, setPendingRoute] = useState<PendingRouteState | null>(null);
  const [selectedSignalId, setSelectedSignalId] = useState(NEW_SIGNAL_VALUE);
  const [draftSignalName, setDraftSignalName] = useState('');
  const [draftSignalColor, setDraftSignalColor] = useState(DEFAULT_NEW_SIGNAL_COLOR);
  const draftSignalNameRef = useRef(draftSignalName);
  const draftSignalColorRef = useRef(draftSignalColor);
  const confirmingRouteRef = useRef(false);
  const [creatingSignal, setCreatingSignal] = useState(false);
  const updateRoutingPreview = useCallback((preview: RoutingDotPreview | null) => {
    routingPreviewRef.current = preview;
    setRoutingPreview(preview);
  }, []);

  const onRoutingPinMenuMove = useCallback((event: PointerEvent) => {
    routingPinMenuMoveRef.current(event);
  }, []);

  const collapseRoutingPinMenus = useCallback((connectorIds: string[]) => {
    const store = useSystemStore.getState();
    for (const connectorId of connectorIds) {
      store.setNodeExpanded(connectorId, false);
    }
  }, []);

  const finishRoutingPinMenus = useCallback(() => {
    window.removeEventListener('pointermove', onRoutingPinMenuMove, true);
    routingFromConnectorId.current = null;
    if (routingPinMenuCloseTimer.current != null) return;
    const toClose = [...routingAutoExpanded.current];
    if (toClose.length === 0) return;
    routingPinMenuCloseTimer.current = window.setTimeout(() => {
      routingPinMenuCloseTimer.current = null;
      routingAutoExpanded.current.clear();
      collapseRoutingPinMenus(toClose);
    }, ROUTING_PIN_MENU_CLOSE_MS);
  }, [collapseRoutingPinMenus, onRoutingPinMenuMove]);

  routingPinMenuMoveRef.current = (event: PointerEvent) => {
    if (!routingFromConnectorId.current) return;
    const connectorId = connectorIdUnderClientPoint(event.clientX, event.clientY);
    if (!connectorId || connectorId === routingFromConnectorId.current) return;
    const store = useSystemStore.getState();
    const connector = store.system?.connectors.find((item) => item.id === connectorId);
    if (!connector || isBulkheadDot(connector) || store.expandedNodes.has(connectorId)) return;
    routingAutoExpanded.current.add(connectorId);
    store.setNodeExpanded(connectorId, true);
  };

  useEffect(() => () => {
    window.removeEventListener('pointermove', onRoutingPinMenuMove, true);
    if (routingPinMenuCloseTimer.current != null) {
      window.clearTimeout(routingPinMenuCloseTimer.current);
    }
  }, [onRoutingPinMenuMove]);

  useEffect(() => {
    if (isEditor) return;
    setPendingRoute(null);
    connectionStart.current = null;
    updateRoutingPreview(null);
    draftRouteSourceRef.current = null;
    setDraftRouteSource(null);
    setDraftRouteCursor(null);
    setCanvasPlacement('none');
  }, [isEditor, updateRoutingPreview]);

  useEffect(() => {
    if (selectedHarnessBundle) return;
    setCanvasPlacement((mode) => (mode === 'route-point' ? 'none' : mode));
  }, [selectedHarnessBundle]);

  useEffect(() => {
    if (canvasPlacement === 'none') return;
    const stopPlacing = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCanvasPlacement('none');
    };
    window.addEventListener('keydown', stopPlacing);
    return () => window.removeEventListener('keydown', stopPlacing);
  }, [canvasPlacement]);

  const breadcrumbs = useMemo(() => {
    if (!system || !spaceId) return [];
    const crumbs: { id: string | null; name: string }[] = [];
    let cur: string | null = spaceId;
    while (cur) {
      const enc = system.hierarchy.find((e) => e.id === cur);
      if (!enc) break;
      crumbs.unshift({ id: enc.id, name: enc.name });
      cur = enc.parent;
    }
    crumbs.unshift({ id: null, name: system.name ?? 'System' });
    return crumbs;
  }, [system, spaceId]);

  const hierarchyGraph = useMemo(() => {
    if (!system) return { graphNodes: [] as Node[], graphEdges: [] as Edge[] };

    const childEnclosures = getChildEnclosures(system, spaceId);
    const freeConnectors = getSpaceFreeConnectors(system, spaceId);
    const freeBranchPoints = getSpaceFreeBranchPoints(system, spaceId);
    const freeConIds = new Set(freeConnectors.map((c) => c.id));
    const freeBranchIds = new Set(freeBranchPoints.map((branchPoint) => branchPoint.id));
    const enclosureConIds = new Set<string>();
    const conToEncId = new Map<string, string>();   // connectorId → enclosureId for ENC_CON nodes
    const branchToEncId = new Map<string, string>(); // branchPointId → enclosureId (no node rendered)
    const mergeLayoutsForContext = branchPointLayouts[bgKey] ?? {};

    const gNodes: Node[] = [];

    // ── Enclosure nodes + connector child nodes ──────────────────────────
    for (let idx = 0; idx < childEnclosures.length; idx++) {
      const enc = childEnclosures[idx];
      const defaultPos = { x: 50 + (idx % 4) * 330, y: 80 + Math.floor(idx / 4) * 250 };
      const pos = nodeLayouts[enc.id] ?? defaultPos;
      const size = sizeLayouts[enc.id] ?? { w: 220, h: 180 };

      const directConnectors = getEnclosurePorts(system, enc.id);
      const allConnectors = getEnclosureConnectors(system, enc.id);
      const directBranchPoints = getEnclosureBranchPoints(system, enc.id);
      const childEncs = getChildEnclosures(system, enc.id);
      const pathCount = countPathsTouchingConnectors(system, allConnectors.map((connector) => connector.id));

      gNodes.push({
        id: enc.id,
        type: 'enclosure',
        deletable: false,
        position: pos,
        style: { width: size.w, height: size.h },
        zIndex: GRAPH_Z_ENCLOSURE,
        selected: selectedItem?.type === 'enclosure' && selectedItem.id === enc.id,
        data: {
          enclosureId: enc.id,
          label: enc.name,
          connectorCount: allConnectors.length,
          pathCount,
          isContainer: enc.kind === 'enclosure',
          image: enc.properties?.image,
          fillColor: enc.properties?.color,
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
        const occupiedPins = getConnectorOccupancy(system, con.id);
        const conType = connectorLibrary?.connector_types.find((t) => t.id === con.connector_type);
        const dot = isBulkheadDot(con);
        const isExpanded = !dot && expandedNodes.has(con.id);
        const conSize = dot
          ? { w: BULKHEAD_DOT_SIZE, h: BULKHEAD_DOT_SIZE }
          : resolveConnectorRenderedSize(
              savedConSize,
              isExpanded,
              getConnectorTablePinCount(con, conType, occupiedPins.map((pin) => pin.pinNumber)),
              expandedSizeOverrides[con.id],
            );
        const wallMounted = isBulkheadConnector(system, con.id);
        const renderedPosition = wallMounted
          ? projectNodeToEnclosureWall(conPos, conSize, size)
          : { x: conPos.x, y: conPos.y };

        gNodes.push({
          id: `${ENC_CON_PREFIX}${con.id}`,
          type: 'connector',
          parentId: enc.id,
          ...(wallMounted ? {} : { extent: 'parent' as const }),
          deletable: false,
          position: renderedPosition,
          style: { width: conSize.w, height: conSize.h },
          zIndex: isExpanded ? EXPANDED_CONNECTOR_Z_INDEX : GRAPH_Z_CONNECTOR,
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
            wireAppearance: getPortWireAppearance(system, con),
            connectorTypeId: con.connector_type,
            instanceImage: getConnectorSchematicImage(con, conType, { bulkhead: wallMounted }) || '',
            wallMounted,
            wallSide: wallMounted
              ? getNearestWallSide(renderedPosition, conSize, size)
              : undefined,
            passThrough: isPassThroughConnector(system, con),
          },
        } as Node);
      });

      directBranchPoints.forEach((branchPoint) => {
        branchToEncId.set(branchPoint.id, enc.id);
      });
    }

    // ── Free-floating connector nodes (parent === spaceId) ───────────────
    for (const con of freeConnectors) {
      const nodeId = `${FREE_CON_PREFIX}${con.id}`;
      const freePos = freePortLayouts[con.id];
      const pos = freePos ?? { x: 100, y: 400 + gNodes.length * 60 };
      const savedConSize = sizeLayouts[con.id] ?? { w: 140, h: 32 };
      const occupiedPins = getConnectorOccupancy(system, con.id);
      const conType = connectorLibrary?.connector_types.find((t) => t.id === con.connector_type);
      const dot = isBulkheadDot(con);
      const isExpanded = !dot && expandedNodes.has(con.id);
      const conSize = dot
        ? { w: BULKHEAD_DOT_SIZE, h: BULKHEAD_DOT_SIZE }
        : resolveConnectorRenderedSize(
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
        zIndex: isExpanded ? EXPANDED_CONNECTOR_Z_INDEX : GRAPH_Z_CONNECTOR,
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
          wireAppearance: getPortWireAppearance(system, con),
          connectorTypeId: con.connector_type,
          instanceImage: getConnectorSchematicImage(con, conType, { bulkhead: false }) || '',
          passThrough: isPassThroughConnector(system, con),
        },
      } as Node);
    }

    for (const branchPoint of freeBranchPoints) {
      const nodeId = `${FREE_BRANCH_PREFIX}${branchPoint.id}`;
      const pos = mergeLayoutsForContext[branchPoint.id] ?? { x: 160, y: 420 + gNodes.length * 40 };
      const size = sizeLayouts[branchPoint.id] ?? { w: 52, h: 28 };
      gNodes.push({
        id: nodeId,
        type: 'branchPoint',
        deletable: false,
        position: { x: pos.x, y: pos.y },
        style: { width: size.w, height: size.h },
        zIndex: GRAPH_Z_MERGE,
        selected: selectedItem?.type === 'branchPoint' && selectedItem.id === branchPoint.id,
        data: {
          branchPointId: branchPoint.id,
          label: branchPoint.name,
        },
      } as Node);
    }

    // ── Floating image nodes ───────────────────────────────────────────
    appendImageNodes(gNodes, imageLayouts, imageContextKey, selectedImageId);

    // ── Text box nodes ───────────────────────────────────────────────────
    appendTextBoxNodes(gNodes, textBoxLayouts, bgKey, selectedTextBoxId);

    // ── Harness Bundle edges — connect connector nodes directly ───────────────────
    const getVisibleNodeId = (refKey: string): string | null => {
      if (refKey.startsWith('connector:')) {
        const [, connectorId] = refKey.split(':');
        if (freeConIds.has(connectorId)) return `${FREE_CON_PREFIX}${connectorId}`;
        if (enclosureConIds.has(connectorId)) return `${ENC_CON_PREFIX}${connectorId}`;
        return null;
      }
      const branchPointId = branchPointIdFromRefKey(refKey);
      if (branchPointId) {
        if (freeBranchIds.has(branchPointId)) return `${FREE_BRANCH_PREFIX}${branchPointId}`;
        const encId = branchToEncId.get(branchPointId);
        if (encId !== undefined) return encId;
        return null;
      }
      return null;
    };

    const positionedNodes = positionNonAnchoringDots(
      system,
      gNodes,
      (pathNode) => getVisibleNodeId(
        pathNode.kind === 'connector'
          ? `connector:${pathNode.connector_id}`
          : `branch:${pathNode.branch_point_id}`,
      ),
      (previous, dot, next, defaults) => {
        const approach = (
          neighbor: typeof previous,
          fallback: Point,
        ): Point => {
          const neighborKey = getPathNodeHarnessBundleKey(neighbor);
          const dotKey = getPathNodeHarnessBundleKey(dot);
          const bundleId = neighborKey < dotKey
            ? `bundle:${neighborKey}|${dotKey}`
            : `bundle:${dotKey}|${neighborKey}`;
          const raw = getHarnessBundleLayoutValue(waypointLayouts, bundleId) ?? [];
          const points = raw.flatMap((waypoint) => {
            if (!('sharedAnchorId' in waypoint)) return [{ x: waypoint.x, y: waypoint.y }];
            const sharedAnchor = sharedAnchors[waypoint.sharedAnchorId];
            return sharedAnchor ? [{ x: sharedAnchor.x, y: sharedAnchor.y }] : [];
          });
          if (points.length === 0) return fallback;
          return dotKey < neighborKey ? points[0] : points[points.length - 1];
        };
        return {
          previous: approach(previous, defaults.previous),
          next: approach(next, defaults.next),
        };
      },
    );
    gNodes.splice(0, gNodes.length, ...positionedNodes);

    const visibleSegments = getVisibleWires(system, spaceId);
    const bundles = deriveGraphWireGroups(visibleSegments, expandedNodes);
    const firstByBase = firstBundleIdByBase(bundles.map((bundle) => bundle.id));

    const gEdges: Edge[] = bundles.flatMap((bundle) => {
      const sourceNodeId = getVisibleNodeId(bundle.sourceRefKey);
      const targetNodeId = getVisibleNodeId(bundle.targetRefKey);
      if (!sourceNodeId || !targetNodeId) return [];
      const hasNonAnchoringDot = [sourceNodeId, targetNodeId].some((nodeId) =>
        gNodes.some((node) => node.id === nodeId && node.data.autoPositioned === true)
      );

      // Drop edges that are internal to a child enclosure: an ENC_CON connecting
      // to the enclosure node itself (which is where its branch-point endpoint was mapped).
      const srcEncForCon = sourceNodeId.startsWith(ENC_CON_PREFIX)
        ? conToEncId.get(sourceNodeId.slice(ENC_CON_PREFIX.length))
        : null;
      const tgtEncForCon = targetNodeId.startsWith(ENC_CON_PREFIX)
        ? conToEncId.get(targetNodeId.slice(ENC_CON_PREFIX.length))
        : null;
      if (srcEncForCon && srcEncForCon === targetNodeId) return [];
      if (tgtEncForCon && tgtEncForCon === sourceNodeId) return [];

      const pathAppearances = bundle.pathIds.map((pathId) => {
        const path = getPathById(system, pathId);
        return path
          ? getPathWireAppearance(path, system)
          : getPathWireAppearance({ tags: [], properties: {} }, system);
      });
      const firstAppearance = pathAppearances[0];
      const bundleColor =
        firstAppearance && pathAppearances.every((appearance) => appearance.key === firstAppearance.key)
          ? firstAppearance.primaryColor
          : '#666';

      const isSelected =
        (selectedHarnessBundle != null && selectedHarnessBundle.id === bundle.id) ||
        (
          selectedItem?.type === 'path' &&
          bundle.pathIds.includes(selectedItem.id)
        ) ||
        (
          selectedItem?.type === 'signal' &&
          bundle.pathIds.some((pathId) => {
            const path = getPathById(system, pathId);
            return path ? getPathSignalId(path) === selectedItem.id : false;
          })
        );

      const pinAttached = isGraphPinHandle(bundle.sourceHandle)
        || isGraphPinHandle(bundle.targetHandle);
      const rawWps = getHarnessBundleLayoutValue(waypointLayouts, bundle.id) ?? [];
      const resolvedWaypoints: Point[] = rawWps.map((wp) => {
        if ('sharedAnchorId' in wp) {
          const j = sharedAnchors[wp.sharedAnchorId];
          return j ? { x: j.x, y: j.y } : { x: 0, y: 0 };
        }
        return { x: wp.x, y: wp.y };
      });

      const sharedAnchorMeta = rawWps.map((wp) => {
        if (!('sharedAnchorId' in wp)) return { sharedAnchorId: null, isOwner: false, memberCount: 1 };
        const j = sharedAnchors[wp.sharedAnchorId];
        if (!j) return { sharedAnchorId: null, isOwner: false, memberCount: 1 };
        const isOwner = isSharedAnchorLayoutOwner(j.memberEdgeIds, bundle.id, firstByBase);
        return { sharedAnchorId: wp.sharedAnchorId, isOwner, memberCount: j.memberEdgeIds.length };
      });

      return [{
        id: bundle.id,
        source: sourceNodeId,
        target: targetNodeId,
        sourceHandle: bundle.sourceHandle,
        targetHandle: bundle.targetHandle,
        type: 'harnessBundle',
        selected: !!isSelected,
        // Pin-attached wires sit above the expanded cavity table.
        zIndex: graphWireZIndex(!!isSelected, pinAttached),
        data: {
          pathIds: bundle.pathIds,
          pathCount: bundle.pathIds.length,
          wireAppearances: pathAppearances,
          bundleColor,
          resolvedWaypoints,
          sharedAnchorMeta,
          sourceStub: 0,
          targetStub: 0,
          pinSource: isGraphPinHandle(bundle.sourceHandle),
          pinTarget: isGraphPinHandle(bundle.targetHandle),
          routeStyle: hasNonAnchoringDot
            ? 'straight'
            : resolveEdgeRouteStyle(bundle.id, routeStyleLayouts, viewRouteStyle),
        },
      }];
    });

    return { graphNodes: gNodes, graphEdges: gEdges };
  }, [
    system, nodeLayouts, sizeLayouts, freePortLayouts, portLayouts, selectedItem,
    selectedHarnessBundle, imageLayouts, selectedImageId, bgKey, imageContextKey,
    textBoxLayouts, selectedTextBoxId, waypointLayouts, sharedAnchors, spaceId, branchPointLayouts,
    expandedNodes, expandedSizeOverrides, connectorLibrary, routeStyleLayouts, viewRouteStyle,
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
    () => system && subsystem
      ? buildSubsystemGraphModel(
        system,
        subsystem,
        expandedNodes,
        selectedItem,
        expandedSizeOverrides,
        connectorTypesById,
        waypointLayouts,
        sharedAnchors,
        selectedHarnessBundle,
        portLayouts,
        sizeLayouts,
        routeStyleLayouts,
        viewRouteStyle,
      )
      : { graphNodes: [] as Node[], graphEdges: [] as Edge[] },
    [
      system,
      subsystem,
      expandedNodes,
      selectedItem,
      expandedSizeOverrides,
      connectorTypesById,
      waypointLayouts,
      sharedAnchors,
      selectedHarnessBundle,
      portLayouts,
      sizeLayouts,
      routeStyleLayouts,
      viewRouteStyle,
    ],
  );
  const { graphNodes, graphEdges } = useMemo(() => {
    if (editingSurface === 'subsystem') {
      const gNodes = [...subsystemGraph.graphNodes];
      appendImageNodes(gNodes, imageLayouts, imageContextKey, selectedImageId);
      appendTextBoxNodes(gNodes, textBoxLayouts, bgKey, selectedTextBoxId);
      return {
        graphNodes: [{ ...ORIGIN_NODE }, ...gNodes],
        graphEdges: subsystemGraph.graphEdges,
      };
    }
    return {
      // Fresh copy each rebuild so React Flow mutations never leak across views.
      graphNodes: [{ ...ORIGIN_NODE }, ...hierarchyGraph.graphNodes],
      graphEdges: hierarchyGraph.graphEdges,
    };
  }, [bgKey, editingSurface, hierarchyGraph, imageContextKey, imageLayouts, selectedImageId, selectedTextBoxId, subsystemGraph, textBoxLayouts]);

  const [nodes, setNodes, onNodesChangeBase] = useNodesState(graphNodes);
  const [edges, setEdges] = useEdgesState(graphEdges);
  nodesRef.current = nodes;

  // Reconcile store-derived nodes into React Flow without clobbering in-flight
  // drag positions. Selection/sync/etc. rebuild graphNodes from persisted
  // layouts; applying that wholesale mid-drag snaps connectors back to their
  // pre-drag spot until mouseup.
  useEffect(() => {
    setNodes((current) => {
      if (draggingNodes.current.size === 0) return graphNodes;
      const liveById = new Map(current.map((node) => [node.id, node]));
      return graphNodes.map((node) => {
        const mergeTarget = mergeDropTargetId.current;
        const highlighted = mergeTarget ? {
          ...node,
          data: { ...node.data, mergeTarget: node.id === mergeTarget },
        } : node;
        if (!draggingNodes.current.has(node.id)) return highlighted;
        const live = liveById.get(node.id);
        if (!live) return highlighted;
        return {
          ...highlighted,
          position: live.position,
          dragging: live.dragging ?? true,
          measured: live.measured,
          width: live.width,
          height: live.height,
        };
      });
    });
  }, [graphNodes, setNodes]);
  useEffect(() => { setEdges(graphEdges); }, [graphEdges, setEdges]);

  const setInlineDropHighlight = useCallback((edgeId: string | null) => {
    setEdges((current) => current.map((edge) => {
      const highlighted = edge.id === edgeId;
      if (!!edge.data?.inlineDropTarget === highlighted) return edge;
      return {
        ...edge,
        data: { ...(edge.data ?? {}), inlineDropTarget: highlighted },
      };
    }));
  }, [setEdges]);

  const setMergeDropHighlight = useCallback((nodeId: string | null) => {
    mergeDropTargetId.current = nodeId;
    setNodes((current) => current.map((candidate) => {
      const highlighted = candidate.id === nodeId;
      if (!!candidate.data?.mergeTarget === highlighted) return candidate;
      return {
        ...candidate,
        data: { ...candidate.data, mergeTarget: highlighted },
      };
    }));
  }, [setNodes]);

  const onNodeDrag = useCallback((_event: React.MouseEvent, node: Node) => {
    const liveNodes = nodesRef.current.map((candidate) =>
      candidate.id === node.id ? node : candidate
    );
    const sourceId = connectorIdFromGraphNodeId(node.id);
    if (isEditor && system && sourceId && node.data.passThrough) {
      const peerNodeId = findOverlappingMergePeerNodeId(node, node.position, liveNodes);
      const targetId = peerNodeId ? connectorIdFromGraphNodeId(peerNodeId) : null;
      if (peerNodeId && targetId && canMergePassThroughConnectors(system, sourceId, targetId)) {
        setMergeDropHighlight(peerNodeId);
        inlineDropTarget.current = null;
        setInlineDropHighlight(null);
        return;
      }
    }
    const sourceBranchPointId = branchPointIdFromGraphNodeId(node.id);
    if (isEditor && system && sourceBranchPointId) {
      const peerNodeId = findOverlappingBranchPointPeerNodeId(node, node.position, liveNodes);
      const targetBranchPointId = peerNodeId ? branchPointIdFromGraphNodeId(peerNodeId) : null;
      if (peerNodeId && targetBranchPointId && canFuseBranchPoints(system, sourceBranchPointId, targetBranchPointId)) {
        setMergeDropHighlight(peerNodeId);
        inlineDropTarget.current = null;
        setInlineDropHighlight(null);
        return;
      }
    }
    setMergeDropHighlight(null);

    if (
      editingSurface !== 'hierarchy'
      || !system
      || !node.id.startsWith(FREE_CON_PREFIX)
    ) {
      inlineDropTarget.current = null;
      setInlineDropHighlight(null);
      return;
    }
    const connectorId = node.id.slice(FREE_CON_PREFIX.length);
    if (
      !isInlineConnector(system, connectorId)
      || getConnectorOccupancy(system, connectorId).length > 0
    ) {
      inlineDropTarget.current = null;
      setInlineDropHighlight(null);
      return;
    }

    const connectorCenter = getAbsoluteNodeCenter(node.id, liveNodes);
    if (!connectorCenter) return;
    const zoom = reactFlowInstance.current?.getZoom() ?? 1;
    const threshold = INLINE_DROP_RADIUS_PX / Math.max(zoom, 0.001);
    let nearest: {
      edge: Edge;
      distance: number;
      point: Point;
      pathIds: string[];
      wireIndex: number;
    } | null = null;

    for (const edge of edges) {
      if (edge.type !== 'harnessBundle' || edge.source === node.id || edge.target === node.id) continue;
      const source = getAbsoluteNodeCenter(edge.source, liveNodes);
      const target = getAbsoluteNodeCenter(edge.target, liveNodes);
      const pathIds = (edge.data?.pathIds as string[] | undefined) ?? [];
      if (!source || !target || pathIds.length === 0) continue;
      const waypoints = (edge.data?.resolvedWaypoints as Point[] | undefined) ?? [];
      const result = nearestOnPolyline(
        connectorCenter,
        displayedEdgePolyline(source, waypoints, target, edgeRouteStyle(edge)),
      );
      if (
        result.dist <= threshold
        && (!nearest || result.dist < nearest.distance)
      ) {
        nearest = {
          edge,
          distance: result.dist,
          point: result.nearest,
          pathIds,
          wireIndex: result.segIndex,
        };
      }
    }

    inlineDropTarget.current = nearest
      ? {
          bundle: { id: nearest.edge.id, pathIds: nearest.pathIds },
          point: nearest.point,
          bundleLayout: {
            before: (getHarnessBundleLayoutValue(waypointLayouts, nearest.edge.id) ?? []).slice(0, nearest.wireIndex),
            after: (getHarnessBundleLayoutValue(waypointLayouts, nearest.edge.id) ?? []).slice(nearest.wireIndex),
          },
        }
      : null;
    setInlineDropHighlight(nearest?.edge.id ?? null);
  }, [
    editingSurface,
    edges,
    system,
    isEditor,
    setInlineDropHighlight,
    setMergeDropHighlight,
    waypointLayouts,
  ]);

  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
    const merged = didMergeOnDrop.current;
    didMergeOnDrop.current = false;
    setMergeDropHighlight(null);
    const target = inlineDropTarget.current;
    inlineDropTarget.current = null;
    setInlineDropHighlight(null);
    if (merged || !target || !node.id.startsWith(FREE_CON_PREFIX)) return;
    const style = node.style as { width?: number; height?: number } | undefined;
    const width = node.measured?.width ?? node.width ?? style?.width ?? 140;
    const height = node.measured?.height ?? node.height ?? style?.height ?? 32;
    insertInlineConnectorOnBundle(
      node.id.slice(FREE_CON_PREFIX.length),
      target.bundle,
      {
        x: target.point.x - Number(width) / 2,
        y: target.point.y - Number(height) / 2,
      },
      target.bundleLayout,
    );
  }, [insertInlineConnectorOnBundle, setInlineDropHighlight, setMergeDropHighlight]);

  const INLINE_CONNECTOR_HALF = { x: 70, y: 16 };

  const placeInlineAt = useCallback((event: React.MouseEvent, bundle?: SelectedHarnessBundle): boolean => {
    if (editingSurface !== 'hierarchy') {
      setMutationError('Inline connectors can only be inserted from the system hierarchy view.');
      return true;
    }
    const instance = reactFlowInstance.current;
    if (!instance) {
      setMutationError('Could not find a visible position for the inline connector.');
      return true;
    }

    let flowPos = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    let bundleLayout:
      | {
          before: WaypointItem[];
          after: WaypointItem[];
        }
      | undefined;

    if (bundle) {
      const edge = edges.find((candidate) => candidate.id === bundle.id);
      if (!edge) {
        setMutationError('The selected Harness Bundle is no longer visible.');
        return true;
      }
      const source = getAbsoluteNodeCenter(edge.source, nodes);
      const target = getAbsoluteNodeCenter(edge.target, nodes);
      if (source && target) {
        const waypoints = (edge.data?.resolvedWaypoints as Point[] | undefined) ?? [];
        const style = edgeRouteStyle(edge);
        if (style === 'grid') flowPos = snapToRouteGrid(flowPos);
        const splitIndex = findRoutePointInsertIndex(
          flowPos,
          source,
          waypoints,
          target,
          style,
          nearestOnPolyline,
        );
        const rawWaypoints = getHarnessBundleLayoutValue(waypointLayouts, edge.id) ?? [];
        bundleLayout = {
          before: rawWaypoints.slice(0, splitIndex),
          after: rawWaypoints.slice(splitIndex),
        };
      }
    } else if (viewRouteStyle === 'grid') {
      flowPos = snapToRouteGrid(flowPos);
    }

    addInlineConnector({
      parent: spaceId,
      position: {
        x: flowPos.x - INLINE_CONNECTOR_HALF.x,
        y: flowPos.y - INLINE_CONNECTOR_HALF.y,
      },
      ...(bundle ? { bundle } : {}),
      ...(bundleLayout ? { bundleLayout } : {}),
    });
    return true;
  }, [
    addInlineConnector,
    editingSurface,
    edges,
    INLINE_CONNECTOR_HALF.x,
    INLINE_CONNECTOR_HALF.y,
    nodes,
    setMutationError,
    spaceId,
    viewRouteStyle,
    waypointLayouts,
  ]);

  // Offer Shared Anchor vs Branch Point when a route point is dropped on another edge.
  // Do not open an undo session while the popup is pending.
  useEffect(() => {
    if (!isEditor) return;
    const prev = prevDragging.current;
    prevDragging.current = draggingEdgeInfo;
    if (draggingEdgeInfo) setPendingJoin(null);

    if (!prev || draggingEdgeInfo || prev.waypointIndex == null) return;

    const draggedId = prev.edgeId;
    const dropPos = prev.position;
    const wpIdx = prev.waypointIndex;
    const zoom = reactFlowInstance.current?.getZoom() ?? 1;
    const threshold = SHARED_ANCHOR_SNAP_RADIUS_PX / Math.max(zoom, 0.001);
    let nearestTarget: {
      edge: Edge;
      dist: number;
      segIndex: number;
      position: Point;
    } | null = null;

    for (const edge of graphEdges) {
      if (edge.id === draggedId) continue;

      const edgeData = edge.data as { resolvedWaypoints?: Point[]; routeStyle?: WireRouteStyle } | undefined;
      const resolvedWps = edgeData?.resolvedWaypoints ?? [];

      const source = getAbsoluteNodeCenter(edge.source, nodes);
      const target = getAbsoluteNodeCenter(edge.target, nodes);
      if (!source || !target) continue;

      const style = edgeRouteStyle(edge);
      const polyline = displayedEdgePolyline(source, resolvedWps, target, style);
      const result = nearestOnPolyline(dropPos, polyline);
      if (
        result.dist <= threshold
        && (!nearestTarget || result.dist < nearestTarget.dist)
      ) {
        nearestTarget = {
          edge,
          dist: result.dist,
          segIndex: result.segIndex,
          position: result.nearest,
        };
      }
    }

    if (!nearestTarget) return;

    const currentWps = useSystemStore.getState().waypointLayouts;
    const dragWp = getHarnessBundleLayoutValue(currentWps, draggedId)?.[wpIdx]
      ?? (currentWps[draggedId] ?? [])[wpIdx];
    const existingSharedAnchorId = dragWp && 'sharedAnchorId' in dragWp ? dragWp.sharedAnchorId : null;
    const targetWps = getHarnessBundleLayoutValue(currentWps, nearestTarget.edge.id)
      ?? currentWps[nearestTarget.edge.id]
      ?? [];
    const alreadyLinked =
      existingSharedAnchorId &&
      targetWps.some((wp) => 'sharedAnchorId' in wp && wp.sharedAnchorId === existingSharedAnchorId);
    if (alreadyLinked) return;

    const targetEdge = nearestTarget.edge;
    const targetSource = getAbsoluteNodeCenter(targetEdge.source, nodes);
    const targetTarget = getAbsoluteNodeCenter(targetEdge.target, nodes);
    const targetWaypoints = (targetEdge.data?.resolvedWaypoints as Point[] | undefined) ?? [];
    const insertAt = targetSource && targetTarget
      ? findRoutePointInsertIndex(
        nearestTarget.position,
        targetSource,
        targetWaypoints,
        targetTarget,
        edgeRouteStyle(targetEdge),
        nearestOnPolyline,
      )
      : nearestTarget.segIndex;
    const insertAfterIndex = insertAt - 1;

    if (existingSharedAnchorId) {
      linkEdgeToSharedAnchor(
        existingSharedAnchorId,
        nearestTarget.edge.id,
        insertAfterIndex,
        nearestTarget.position,
      );
      return;
    }

    const screen = reactFlowInstance.current?.flowToScreenPosition(nearestTarget.position)
      ?? { x: dropPos.x, y: dropPos.y };
    setJoinFocus(DEFAULT_JOIN_KIND);
    setPendingJoin({
      sourceEdgeId: draggedId,
      sourceWaypointIndex: wpIdx,
      targetEdgeId: nearestTarget.edge.id,
      insertAfterIndex,
      position: nearestTarget.position,
      screen,
    });
  }, [
    draggingEdgeInfo,
    graphEdges,
    isEditor,
    linkEdgeToSharedAnchor,
    nodes,
  ]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!isEditor) {
        onNodesChangeBase(changes.filter(
          (change) => change.type !== 'position' && change.type !== 'dimensions',
        ));
        return;
      }
      const currentNodes = nodesRef.current;
      const constrainedChanges = changes.map((change) => {
        if (change.type !== 'position' || !change.position) return change;
        const node = currentNodes.find((candidate) => candidate.id === change.id);
        if (!node?.parentId || !node.data.wallMounted) return change;
        const parent = currentNodes.find((candidate) => candidate.id === node.parentId);
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

      const tryMergePassThrough = (
        nodeId: string,
        position: { x: number; y: number },
      ): string | null => {
        if (!system) return null;
        const draggedNode = currentNodes.find((candidate) => candidate.id === nodeId);
        const sourceId = connectorIdFromGraphNodeId(nodeId);
        if (!draggedNode?.data.passThrough || !sourceId) return null;
        const liveNode = { ...draggedNode, position };
        const liveNodes = currentNodes.map((candidate) =>
          candidate.id === nodeId ? liveNode : candidate
        );
        const peerNodeId = findOverlappingMergePeerNodeId(liveNode, position, liveNodes);
        const targetId = peerNodeId ? connectorIdFromGraphNodeId(peerNodeId) : null;
        if (
          !peerNodeId
          || !targetId
          || !canMergePassThroughConnectors(system, sourceId, targetId)
        ) {
          return null;
        }
        const keptId = mergeBulkheadConnectors(sourceId, targetId);
        if (keptId) didMergeOnDrop.current = true;
        return keptId;
      };

      const tryFuseBranchPoints = (
        nodeId: string,
        position: { x: number; y: number },
      ): string | null => {
        if (!system) return null;
        const draggedNode = currentNodes.find((candidate) => candidate.id === nodeId);
        const sourceBranchPointId = branchPointIdFromGraphNodeId(nodeId);
        if (!draggedNode || !sourceBranchPointId) return null;
        const liveNode = { ...draggedNode, position };
        const liveNodes = currentNodes.map((candidate) =>
          candidate.id === nodeId ? liveNode : candidate
        );
        const peerNodeId = findOverlappingBranchPointPeerNodeId(liveNode, position, liveNodes);
        const targetBranchPointId = peerNodeId ? branchPointIdFromGraphNodeId(peerNodeId) : null;
        if (
          !peerNodeId
          || !targetBranchPointId
          || !canFuseBranchPoints(system, sourceBranchPointId, targetBranchPointId)
        ) {
          return null;
        }
        const keptId = fuseBranchPoints(sourceBranchPointId, targetBranchPointId);
        if (keptId) didMergeOnDrop.current = true;
        return keptId;
      };

      for (const change of positionChanges) {
        if (change.dragging && !draggingNodes.current.has(change.id)) {
          draggingNodes.current.add(change.id);
          const target = presenceTargetForGraphNode(change.id);
          if (target) setInteracting(target.kind, target.id, true);
        }

        // Only persist after a real node-drag end. NodeResizer emits position
        // changes with `dragging` undefined; treating those as drag-end was
        // rewriting subsystem layouts mid-resize and snapping sizes back.
        if (change.position && change.dragging === false) {
          draggingNodes.current.delete(change.id);
          const target = presenceTargetForGraphNode(change.id);
          if (target) setInteracting(target.kind, target.id, false);
          if (draggingNodes.current.size === 0) didPushSnapshotForDrag.current = false;
          if (change.id === ORIGIN_NODE_ID) {
            continue;
          }
          if (change.id.startsWith(IMG_NODE_PREFIX)) {
            const imageId = change.id.slice(IMG_NODE_PREFIX.length);
            if (useSystemStore.getState().imageLayouts[imageId]?.locked) continue;
            updateImage(imageId, { x: change.position.x, y: change.position.y });
          } else if (change.id.startsWith(TB_NODE_PREFIX)) {
            const tbId = change.id.slice(TB_NODE_PREFIX.length);
            updateTextBox(tbId, { x: change.position.x, y: change.position.y });
          } else if (change.id.startsWith(FREE_CON_PREFIX)) {
            const conId = change.id.slice(FREE_CON_PREFIX.length);
            const keptId = tryMergePassThrough(change.id, change.position);
            if (keptId) {
              if (keptId === conId) {
                updateFreePortLayout(conId, change.position.x, change.position.y);
              }
              continue;
            }
            updateFreePortLayout(conId, change.position.x, change.position.y);
          } else if (change.id.startsWith(ENC_CON_PREFIX)) {
            const conId = change.id.slice(ENC_CON_PREFIX.length);
            const keptId = tryMergePassThrough(change.id, change.position);
            if (keptId) {
              if (keptId === conId) {
                updatePortLayout(conId, change.position.x, change.position.y);
              }
              continue;
            }
            updatePortLayout(conId, change.position.x, change.position.y);
          } else if (change.id.startsWith(FREE_BRANCH_PREFIX)) {
            const branchPointId = change.id.slice(FREE_BRANCH_PREFIX.length);
            const keptId = tryFuseBranchPoints(change.id, change.position);
            if (keptId) {
              if (keptId === branchPointId) {
                updateBranchPointLayout(bgKey, branchPointId, change.position.x, change.position.y);
              }
              continue;
            }
            updateBranchPointLayout(bgKey, branchPointId, change.position.x, change.position.y);
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
            const keptId = tryMergePassThrough(change.id, change.position);
            if (keptId) {
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
    [isEditor, onNodesChangeBase, updateNodePosition, updateImage, updateTextBox,
     updateFreePortLayout, updatePortLayout, updateBranchPointLayout, updateSubsystemEntityLayout,
     mergeBulkheadConnectors, fuseBranchPoints, subsystem, system, bgKey, pushUndoSnapshot, commitUndoSnapshot, setInteracting],
  );

  const placeRoutePoint = useCallback((event: React.MouseEvent): boolean => {
    if (canvasPlacement !== 'route-point' || !selectedHarnessBundle || !isEditor) return false;

    const instance = reactFlowInstance.current;
    const edge = edges.find((candidate) => candidate.id === selectedHarnessBundle.id);
    if (!instance || !edge) {
      setMutationError('The selected Harness Bundle is no longer visible.');
      setCanvasPlacement('none');
      return true;
    }

    const position = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const source = getAbsoluteNodeCenter(edge.source, nodes);
    const target = getAbsoluteNodeCenter(edge.target, nodes);
    if (!source || !target) {
      setMutationError('Could not place a routing point on this Harness Bundle.');
      return true;
    }

    const resolvedWaypoints =
      (edge.data?.resolvedWaypoints as Point[] | undefined) ?? [];
    const routeStyle = edgeRouteStyle(edge);
    const insertAt = findRoutePointInsertIndex(
      position,
      source,
      resolvedWaypoints,
      target,
      routeStyle,
      nearestOnPolyline,
    );
    const currentWaypoints = getHarnessBundleLayoutValue(waypointLayouts, edge.id) ?? [];
    const nextWaypoints = [...currentWaypoints];
    const point = routeStyle === 'grid' ? snapToRouteGrid(position) : position;
    nextWaypoints.splice(
      Math.max(0, Math.min(currentWaypoints.length, insertAt)),
      0,
      { x: point.x, y: point.y },
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
    canvasPlacement,
    pushUndoSnapshot,
    selectedHarnessBundle,
    setEdgeWaypoints,
    setMutationError,
    waypointLayouts,
  ]);

  const handleFlowClick = useCallback((event: React.MouseEvent, clickedBundle?: SelectedHarnessBundle): boolean => {
    if (canvasPlacement === 'route-point') return placeRoutePoint(event);
    if (canvasPlacement === 'inline-connector') {
      return placeInlineAt(event, selectedHarnessBundle ?? clickedBundle);
    }
    return false;
  }, [canvasPlacement, placeInlineAt, placeRoutePoint, selectedHarnessBundle]);

  const onPaneClick = useCallback((event: React.MouseEvent) => {
    if (handleFlowClick(event)) return;
    selectItem(null);
    selectTextBox(null);
    selectImage(null);
  }, [handleFlowClick, selectImage, selectItem, selectTextBox]);

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (node.id.startsWith(IMG_NODE_PREFIX)) {
        if (handleFlowClick(event)) return;
        const imageId = node.id.slice(IMG_NODE_PREFIX.length);
        const img = useSystemStore.getState().imageLayouts[imageId];
        if (img?.locked) {
          if (selectedImageId !== imageId) {
            selectItem(null);
            selectTextBox(null);
            selectImage(null);
          }
          return;
        }
        selectImage(imageId);
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
      if (node.id.startsWith(FREE_BRANCH_PREFIX)) {
        const branchPointId = node.id.slice(FREE_BRANCH_PREFIX.length);
        selectItem({ type: 'branchPoint', id: branchPointId });
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
    [handleFlowClick, selectImage, selectItem, selectTextBox, selectedImageId],
  );

  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (!node.id.startsWith(IMG_NODE_PREFIX)) return;
      selectImage(node.id.slice(IMG_NODE_PREFIX.length));
    },
    [selectImage],
  );

  const submitRoute = useCallback(async (
    from: RouteEndpoint,
    to: RouteEndpoint,
    signalId: string,
    properties?: Record<string, string>,
    draftDot?: DraftDotPlacement,
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
    const response = await fetch(`/api/paths/route?system=${encodeURIComponent(useSystemStore.getState().activeSystemName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        signal_id: signalId,
        subsystem_id: routeSubsystemId,
        request_id: crypto.randomUUID(),
        properties,
        ...(draftDot ? {
          draft_connector: {
            id: draftDot.id,
            name: 'Visual dot',
            parent: draftDot.parentId,
            x: draftDot.position.x,
            y: draftDot.position.y,
          },
        } : {}),
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      cancelUndoSnapshot();
      setMutationError(result.error ?? 'Wire routing failed');
      return false;
    }
    const store = useSystemStore.getState();
    store.loadSystem(result.system);
    if (result.subsystem) {
      store.acceptSavedSubsystem(result.subsystem);
    } else if (
      store.editingSurface === 'subsystem'
      && store.activeSubsystemId === routeSubsystemId
    ) {
      for (const connectorId of result.generated_connectors ?? []) {
        useSystemStore.getState().addEntityToActiveSubsystem('connector', connectorId);
      }
    }
    for (const split of result.unmerged_dots ?? []) {
      const sourceLayout = useSystemStore.getState().portLayouts[split.sourceConnectorId];
      if (sourceLayout) {
        updatePortLayout(split.connectorId, sourceLayout.x + 24, sourceLayout.y + 24);
      }
    }
    if (draftDot) {
      if (routeSubsystemId && useSystemStore.getState().activeSubsystemId === routeSubsystemId) {
        const current = useSystemStore.getState().subsystems[routeSubsystemId]?.connectors[draftDot.id];
        updateSubsystemEntityLayout('connectors', draftDot.id, {
          ...current,
          x: draftDot.position.x,
          y: draftDot.position.y,
          w: BULKHEAD_DOT_SIZE,
          h: BULKHEAD_DOT_SIZE,
        });
      } else {
        updatePortLayout(draftDot.id, draftDot.position.x, draftDot.position.y);
      }
    }
    commitUndoSnapshot();
    setMutationError(null);
    setPendingRoute(null);
    updateRoutingPreview(null);
    draftRouteSourceRef.current = null;
    setDraftRouteSource(null);
    return true;
  }, [
    activeSubsystemId,
    cancelUndoSnapshot,
    commitUndoSnapshot,
    editingSurface,
    isEditor,
    pushUndoSnapshot,
    setMutationError,
    updatePortLayout,
    updateRoutingPreview,
    updateSubsystemEntityLayout,
  ]);

  const preparePendingRoute = useCallback((
    from: RouteEndpoint,
    to: RouteEndpoint,
    draftDot?: DraftDotPlacement,
  ) => {
    if (!system || from.connector_id === to.connector_id) return;
    const existingBulkheadSignalId = [from, to].map((endpoint) => {
      const connector = system.connectors.find((item) => item.id === endpoint.connector_id);
      if (!connector || !isPassThroughConnector(system, connector)) return null;
      const stub = system.paths.find((path) => {
        const nodeIndex = path.nodes.findIndex((node) =>
          node.kind === 'connector'
          && node.connector_id === connector.id
          && node.pin_number === endpoint.pin_number
        );
        return nodeIndex === 0 || nodeIndex === path.nodes.length - 1;
      });
      return stub ? getPathSignalId(stub) : null;
    }).find((signalId): signalId is string => !!signalId);
    setPendingRoute({ from, to, draftDot });
    const defaultId = existingBulkheadSignalId ?? NEW_SIGNAL_VALUE;
    const draft = draftsForSignal(
      existingBulkheadSignalId
        ? system.signals.find((signal) => signal.id === existingBulkheadSignalId)
        : undefined,
    );
    setSelectedSignalId(defaultId);
    draftSignalNameRef.current = draft.name;
    draftSignalColorRef.current = draft.color;
    setDraftSignalName(draft.name);
    setDraftSignalColor(draft.color);
    setCreatingSignal(false);
  }, [system]);

  const beginDraftDotRoute = useCallback((event: React.PointerEvent) => {
    const preview = routingPreviewRef.current;
    if (!preview || !system || !isEditor || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const source: DraftDotPlacement = {
      ...preview,
      id: `con_dot_${crypto.randomUUID()}`,
    };
    draftRouteSourceRef.current = source;
    setDraftRouteSource(source);
    setDraftRouteCursor(source.center);
    updateRoutingPreview(null);

    if (routingPinMenuCloseTimer.current != null) {
      window.clearTimeout(routingPinMenuCloseTimer.current);
      routingPinMenuCloseTimer.current = null;
    }
    routingFromConnectorId.current = source.id;
    window.addEventListener('pointermove', onRoutingPinMenuMove, true);

    const handleMove = (moveEvent: PointerEvent) => {
      routingPinMenuMoveRef.current(moveEvent);
      const instance = reactFlowInstance.current;
      if (!instance) return;
      const cursor = instance.screenToFlowPosition({
        x: moveEvent.clientX,
        y: moveEvent.clientY,
      });
      setDraftRouteCursor(cursor);
      const endpoint = routeEndpointUnderClientPoint(
        system,
        moveEvent.clientX,
        moveEvent.clientY,
      );
      updateRoutingPreview(
        endpoint ? null : resolveRoutingDotPreview(system, nodesRef.current, cursor),
      );
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', handleMove, true);
      window.removeEventListener('pointerup', handleUp, true);
      window.removeEventListener('pointercancel', handleCancel, true);
      finishRoutingPinMenus();
      setDraftRouteCursor(null);
    };
    const cancelDraft = () => {
      draftRouteSourceRef.current = null;
      setDraftRouteSource(null);
      updateRoutingPreview(null);
    };
    const handleUp = (upEvent: PointerEvent) => {
      cleanup();
      const endpoint = routeEndpointUnderClientPoint(
        system,
        upEvent.clientX,
        upEvent.clientY,
      );
      if (!endpoint) {
        cancelDraft();
        return;
      }
      preparePendingRoute(
        { connector_id: source.id, pin_number: 1 },
        endpoint,
        source,
      );
    };
    const handleCancel = () => {
      cleanup();
      cancelDraft();
    };

    window.addEventListener('pointermove', handleMove, true);
    window.addEventListener('pointerup', handleUp, true);
    window.addEventListener('pointercancel', handleCancel, true);
  }, [
    finishRoutingPinMenus,
    system,
    isEditor,
    onRoutingPinMenuMove,
    preparePendingRoute,
    updateRoutingPreview,
  ]);

  const onConnect = useCallback((connection: Connection) => {
    connectionCompleted.current = true;
    connectionStart.current = null;
    updateRoutingPreview(null);
    finishRoutingPinMenus();
    if (!isEditor) {
      setMutationError('Log in to edit');
      return;
    }
    const from = routeEndpointFromHandle(connection.source, connection.sourceHandle);
    const to = routeEndpointFromHandle(connection.target, connection.targetHandle);
    if (!from || !to) {
      setMutationError('Choose a cavity handle at both ends.');
      return;
    }
    preparePendingRoute(from, to);
  }, [
    finishRoutingPinMenus,
    isEditor,
    preparePendingRoute,
    setMutationError,
    updateRoutingPreview,
  ]);

  const onConnectStart = useCallback<OnConnectStart>((_event, params) => {
    connectionCompleted.current = false;
    connectionStart.current = routeEndpointFromHandle(params.nodeId, params.handleId);
    updateRoutingPreview(null);
    if (routingPinMenuCloseTimer.current != null) {
      window.clearTimeout(routingPinMenuCloseTimer.current);
      routingPinMenuCloseTimer.current = null;
    }
    const leftover = [...routingAutoExpanded.current];
    routingAutoExpanded.current.clear();
    collapseRoutingPinMenus(leftover);
    routingFromConnectorId.current = params.nodeId
      ? connectorIdFromGraphNodeId(params.nodeId)
      : null;
    window.addEventListener('pointermove', onRoutingPinMenuMove, true);
  }, [collapseRoutingPinMenus, onRoutingPinMenuMove, updateRoutingPreview]);

  const handleRoutingPointerMove = useCallback((event: React.PointerEvent) => {
    if (routingFromConnectorId.current) {
      routingPinMenuMoveRef.current(event.nativeEvent);
    }
    if (
      !system
      || !isEditor
      || canvasPlacement !== 'none'
      || draftRouteSourceRef.current
    ) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (
      !connectionStart.current
      && target?.closest('.react-flow__node-connector, .react-flow__resize-control')
    ) {
      updateRoutingPreview(null);
      return;
    }
    if (connectionStart.current && target?.closest('.react-flow__handle')) {
      updateRoutingPreview(null);
      return;
    }
    const instance = reactFlowInstance.current;
    if (!instance) return;
    const cursor = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    updateRoutingPreview(resolveRoutingDotPreview(system, nodesRef.current, cursor));
  }, [canvasPlacement, system, isEditor, updateRoutingPreview]);

  const onConnectEnd = useCallback<OnConnectEnd>((event) => {
    finishRoutingPinMenus();
    const from = connectionStart.current;
    connectionStart.current = null;
    if (connectionCompleted.current) {
      connectionCompleted.current = false;
      updateRoutingPreview(null);
      return;
    }
    const pointer = 'changedTouches' in event
      ? event.changedTouches[0]
      : event;
    const existingEndpoint = from && pointer && system
      ? routeEndpointUnderClientPoint(system, pointer.clientX, pointer.clientY)
      : null;
    if (
      from
      && existingEndpoint
      && existingEndpoint.connector_id !== from.connector_id
    ) {
      updateRoutingPreview(null);
      preparePendingRoute(from, existingEndpoint);
      return;
    }
    const preview = routingPreviewRef.current;
    if (!from || !preview) {
      updateRoutingPreview(null);
      return;
    }
    const draftDot: DraftDotPlacement = {
      ...preview,
      id: `con_dot_${crypto.randomUUID()}`,
    };
    preparePendingRoute(
      from,
      { connector_id: draftDot.id, pin_number: 1 },
      draftDot,
    );
  }, [finishRoutingPinMenus, system, preparePendingRoute, updateRoutingPreview]);

  const cancelPendingRoute = useCallback(() => {
    confirmingRouteRef.current = false;
    setPendingRoute(null);
    setCreatingSignal(false);
    updateRoutingPreview(null);
    draftRouteSourceRef.current = null;
    setDraftRouteSource(null);
  }, [updateRoutingPreview]);

  const selectPendingSignal = useCallback((signalId: string) => {
    setSelectedSignalId(signalId);
    const draft = draftsForSignal(
      signalId === NEW_SIGNAL_VALUE
        ? undefined
        : system?.signals.find((signal) => signal.id === signalId),
    );
    draftSignalNameRef.current = draft.name;
    draftSignalColorRef.current = draft.color;
    setDraftSignalName(draft.name);
    setDraftSignalColor(draft.color);
  }, [system]);

  const confirmPendingRoute = useCallback(async (): Promise<string | null> => {
    if (!isEditor) {
      setMutationError('Log in to edit');
      return null;
    }
    if (!pendingRoute || creatingSignal || confirmingRouteRef.current) return null;
    confirmingRouteRef.current = true;
    const nextName = draftSignalNameRef.current.trim();
    const nextColor = draftSignalColorRef.current.trim();

    try {
      if (selectedSignalId !== NEW_SIGNAL_VALUE) {
        const signal = system?.signals.find((item) => item.id === selectedSignalId);
        if (!signal) {
          setMutationError('Select a signal');
          return null;
        }
        const signalId = signal.id;
        const currentColor = signal.properties.preferred_wire_color ?? '';
        const routed = await submitRoute(
          pendingRoute.from,
          pendingRoute.to,
          signalId,
          undefined,
          pendingRoute.draftDot,
        );
        if (!routed) return null;
        // Apply after loadSystem so the route response does not wipe the edits.
        if (nextName && nextName !== signal.name) {
          updateSignalName(signalId, nextName);
        }
        if (nextColor !== currentColor) {
          updateSignalProperty(signalId, 'preferred_wire_color', nextColor);
        }
        return signalId;
      }

      setCreatingSignal(true);
      const response = await fetch(`/api/signals?system=${encodeURIComponent(useSystemStore.getState().activeSystemName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nextName || DEFAULT_NEW_SIGNAL_NAME,
          tags: [],
          properties: nextColor ? { preferred_wire_color: nextColor } : {},
        }),
      });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || !result.id) {
        setMutationError(result.error ?? 'Signal creation failed');
        return null;
      }

      // Omit path wire_color so the route inherits the new signal's preferred color.
      const routed = await submitRoute(
        pendingRoute.from,
        pendingRoute.to,
        result.id,
        undefined,
        pendingRoute.draftDot,
      );
      return routed ? result.id : null;
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Signal creation failed');
      return null;
    } finally {
      confirmingRouteRef.current = false;
      setCreatingSignal(false);
    }
  }, [
    creatingSignal,
    system,
    isEditor,
    pendingRoute,
    selectedSignalId,
    setMutationError,
    submitRoute,
    updateSignalName,
    updateSignalProperty,
  ]);

  const confirmPendingRouteAndEdit = useCallback(async () => {
    const signalId = await confirmPendingRoute();
    if (signalId) openSignalLibrary(signalId);
  }, [confirmPendingRoute, openSignalLibrary]);

  useEffect(() => {
    if (!pendingRoute || creatingSignal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancelPendingRoute();
        return;
      }
      if (event.key !== 'Enter' || event.repeat || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT'
        || target?.tagName === 'SELECT'
        || target?.tagName === 'TEXTAREA'
        || target?.tagName === 'BUTTON'
      ) {
        return;
      }
      event.preventDefault();
      void confirmPendingRoute();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [cancelPendingRoute, confirmPendingRoute, creatingSignal, pendingRoute]);

  return (
    <div
      ref={graphContainerRef}
      className={`w-full h-full bg-zinc-950 ${canvasPlacement !== 'none' ? 'cursor-crosshair' : ''}`}
      onPointerMove={handleRoutingPointerMove}
    >
      <CanvasPlacementContext.Provider value={{ mode: canvasPlacement, handleFlowClick }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onInit={(instance) => {
          reactFlowInstance.current = instance;
        }}
        nodesDraggable={isEditor && canvasPlacement === 'none'}
        nodesConnectable={isEditor}
        panOnDrag={canvasPlacement === 'none' ? true : [1, 2]}
        connectionMode={ConnectionMode.Loose}
        connectOnClick={false}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        minZoom={0.08}
        maxZoom={3}
        // d3-zoom's dblclick handler calls stopImmediatePropagation, which
        // swallows the double-click before React's delegated onDoubleClick can
        // run. Nodes use double-click to drill in, so zoom-to-double-click has
        // to stay off; the zoom controls and scroll wheel cover zooming.
        zoomOnDoubleClick={false}
        ariaLabelConfig={{ 'controls.fitView.ariaLabel': 'Fit View (F)' }}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ animated: false, zIndex: GRAPH_Z_WIRE }}
        zIndexMode="manual"
        elevateEdgesOnSelect
        selectionMode={SelectionMode.Partial}
      >
        <CanvasPanGestures />
        {draftRouteSource && <RoutingDotPreviewOverlay preview={draftRouteSource} />}
        {draftRouteSource && draftRouteCursor && (
          <RoutingDraftLineOverlay from={draftRouteSource.center} to={draftRouteCursor} />
        )}
        {routingPreview && (
          <RoutingDotPreviewOverlay
            preview={routingPreview}
            onPointerDown={
              !connectionStart.current && !draftRouteSource && !pendingRoute
                ? beginDraftDotRoute
                : undefined
            }
          />
        )}
        <ViewportMemory
          viewportKey={viewportKey}
          userId={userId}
          defaultZoom={
            editingSurface === 'subsystem'
              ? subsystem?.viewport?.zoom ?? 0.25
              : STANDARD_ZOOM
          }
        />
        <NodeGeometryUpdater nodes={nodes} />
        <EntityRevealController nodes={nodes} edges={edges} />
        <Background
          variant={viewRouteStyle === 'grid' ? BackgroundVariant.Lines : BackgroundVariant.Dots}
          gap={20}
          size={1}
          color={viewRouteStyle === 'grid' ? '#3f3f46' : '#333'}
        />
        <FitViewOnFKey />
        <Controls
          showInteractive={false}
          className="!bg-zinc-800 !border-zinc-600 !rounded !shadow-lg [&>button]:!bg-zinc-800 [&>button]:!border-zinc-600 [&>button]:!text-zinc-300 [&>button:hover]:!bg-zinc-700"
        >
          <StripNativeControlTitles />
          <OriginHomeButton
            zoom={
              editingSurface === 'subsystem'
                ? subsystem?.viewport?.zoom ?? 0.25
                : STANDARD_ZOOM
            }
          />
        </Controls>

        {breadcrumbs.length > 0 && (
          <Panel position="top-left">
            <div className="flex items-center gap-1 px-2 py-1 bg-zinc-800/95 border border-zinc-600 rounded shadow-lg text-[11px]">
              {breadcrumbs.map((crumb, i) => (
                <span key={crumb.id ?? 'root'} className="flex items-center gap-1">
                  {i > 0 && <span className="text-zinc-500">›</span>}
                  {i < breadcrumbs.length - 1 ? (
                    <button
                      className={`transition-colors hover:opacity-80 ${
                        crumb.id ? 'text-vw-enclosure' : 'text-zinc-400 hover:text-zinc-100'
                      }`}
                      onClick={() => setOpenEnclosure(crumb.id)}
                    >
                      {crumb.name}
                    </button>
                  ) : (
                    <span className={`font-medium ${crumb.id ? 'text-vw-enclosure' : 'text-zinc-100'}`}>{crumb.name}</span>
                  )}
                </span>
              ))}
            </div>
          </Panel>
        )}

        <Panel position="top-right">
          <div className="flex flex-col gap-1 items-end">
            <div className="flex gap-1">
              {editingSurface === 'hierarchy' && (
                <button
                  type="button"
                  disabled={!isEditor}
                  className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] shadow transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    canvasPlacement === 'inline-connector'
                      ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                      : 'border-zinc-600 bg-zinc-800/90 text-zinc-300 hover:border-vw-connector hover:bg-zinc-700 hover:text-vw-connector'
                  }`}
                  onClick={() => setCanvasPlacement((mode) => (
                    mode === 'inline-connector' ? 'none' : 'inline-connector'
                  ))}
                  title={
                    isEditor
                      ? `Click anywhere to place a free-hanging connector ${spaceId ? 'inside this enclosure' : 'at system root'}`
                      : 'Log in to add an inline connector'
                  }
                >
                  <span>+</span>
                  <span>Inline connector</span>
                </button>
              )}
              <AddImageButton />
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

        {selectedHarnessBundle && isEditor && (
          <Panel position="bottom-center">
            <div className="flex w-[min(36rem,90vw)] flex-col gap-1.5 px-3 py-1.5 bg-zinc-800/95 border border-zinc-600 rounded-lg shadow-lg">
              <HarnessBundleRouteStyleControls
                edgeId={selectedHarnessBundle.id}
                extraEdgeIds={edges.map((edge) => edge.id)}
              />
              <div className="flex items-center gap-2">
              {editingSurface === 'hierarchy' && (
                <button
                  type="button"
                  className={`rounded border px-2 py-1 text-[10px] font-medium transition-colors ${
                    canvasPlacement === 'inline-connector'
                      ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                      : 'border-zinc-600 bg-zinc-900 text-zinc-200 hover:border-vw-connector hover:text-vw-connector'
                  }`}
                  onClick={() => setCanvasPlacement((mode) => (
                    mode === 'inline-connector' ? 'none' : 'inline-connector'
                  ))}
                  title="Click anywhere to insert an inline connector into this Harness Bundle"
                >
                  + Inline connector
                </button>
              )}
              <button
                className={`rounded border px-2 py-1 text-[10px] font-medium transition-colors ${
                  canvasPlacement === 'route-point'
                    ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                    : 'border-zinc-600 bg-zinc-900 text-zinc-200 hover:border-amber-500 hover:text-amber-300'
                }`}
                onClick={() => setCanvasPlacement((mode) => (
                  mode === 'route-point' ? 'none' : 'route-point'
                ))}
              >
                + Route points
              </button>
              <span className="text-[10px] text-zinc-400">
                {canvasPlacement === 'inline-connector'
                  ? 'Click anywhere to place an inline connector on this Harness Bundle · Esc to finish'
                  : canvasPlacement === 'route-point'
                    ? 'Click anywhere to add a route point · drag points to move · Esc to finish'
                    : 'Add free route points, or double-click the edge for a bend · Drag a point near another edge to choose Shared anchor or Branch point'}
              </span>
              </div>
            </div>
          </Panel>
        )}
        {!selectedHarnessBundle && canvasPlacement === 'inline-connector' && isEditor && (
          <Panel position="bottom-center">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800/95 border border-amber-400/60 rounded-lg shadow-lg">
              <span className="text-[10px] text-amber-200">
                Click anywhere to place an inline connector · Esc to finish
              </span>
              <button
                type="button"
                className="rounded border border-amber-400 bg-amber-500/20 px-2 py-1 text-[10px] font-medium text-amber-200"
                onClick={() => setCanvasPlacement('none')}
              >
                Done placing
              </button>
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
            <ChooseSignalPanel
              signals={system?.signals ?? []}
              selectedSignalId={selectedSignalId}
              draftName={draftSignalName}
              draftColor={draftSignalColor}
              creating={creatingSignal}
              onSelectSignal={selectPendingSignal}
              onNameChange={(name) => {
                draftSignalNameRef.current = name;
                setDraftSignalName(name);
              }}
              onColorChange={(color) => {
                draftSignalColorRef.current = color;
                setDraftSignalColor(color);
              }}
              onCancel={cancelPendingRoute}
              onConfirm={() => void confirmPendingRoute()}
              onOpenEditor={() => void confirmPendingRouteAndEdit()}
            />
          </Panel>
        )}
      </ReactFlow>
      {pendingJoin && (
        <JoinKindPopup
          screen={pendingJoin.screen}
          focused={joinFocus}
          onFocus={setJoinFocus}
          onCancel={() => setPendingJoin(null)}
          onConfirm={(kind) => {
            joinBundlesAtDrop({ ...pendingJoin, kind });
            setPendingJoin(null);
          }}
        />
      )}
      </CanvasPlacementContext.Provider>
    </div>
  );
}
