import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  type Edge,
  type EdgeProps,
  useInternalNode,
  useReactFlow,
} from '@xyflow/react';
import { useSystemStore } from '../../store';
import {
  filletedPolylinePath,
  nearestOnPolyline,
  pointOnRectBoundaryToward,
  type Point,
  type Rect,
} from '../../lib/paths';
import {
  DEFAULT_WIRE_ROUTE_STYLE,
  buildGridPath,
  findRoutePointInsertIndex,
  gridSegmentAxis,
  offsetGridSegment,
  offsetGridVertex,
  pruneUnusedGridWaypoints,
  routePointsEqual,
  routedPolyline,
  snapToRouteGrid,
  waypointsFromGridPath,
  type GridPathNode,
} from '../../lib/routeStyle';
import type { WireRouteStyle } from '../../types';
import {
  getWireAppearance,
  getWireStrokeLayers,
  type WireAppearance,
} from '../../lib/colors';
import type { WaypointItem } from '../../types';
import {
  getHarnessBundleLayoutValue,
  getConnectorOccupancy,
  getBranchPointWireFamilies,
  isGraphPinHandle,
  parseHarnessBundleId,
  parseHarnessBundleThruKey,
  branchPointIdFromRefKey,
} from '../../lib/systemTopology';
import { isBulkheadDot } from '../../lib/bulkheadRouting';
import {
  SHARED_ANCHOR_SNAP_RADIUS_PX,
  graphWireZIndex,
} from './graphModel';
import { useCanvasPlacement } from './canvasPlacement';
import { PresenceBadge } from '../collab/PresenceBadge';

const BOUNDARY_EXIT_NODE_TYPES = new Set(['connector', 'branchPoint']);

type BoundaryGeometry = Rect & {
  /** Connectors emit from their geometric center; branch points use boundary projection. */
  exitFromCenter: boolean;
};

function nodeFlowRect(node: {
  measured: { width?: number; height?: number };
  internals: { positionAbsolute: { x: number; y: number } };
  type?: string;
  width?: number;
  height?: number;
  style?: unknown;
} | undefined): BoundaryGeometry | null {
  if (!node) return null;
  const style = node.style as { width?: number | string; height?: number | string } | undefined;
  const width =
    node.measured.width
    ?? (typeof node.width === 'number' ? node.width : undefined)
    ?? (typeof style?.width === 'number' ? style.width : undefined);
  const height =
    node.measured.height
    ?? (typeof node.height === 'number' ? node.height : undefined)
    ?? (typeof style?.height === 'number' ? style.height : undefined);
  if (width == null || height == null || width <= 0 || height <= 0) return null;
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width,
    height,
    exitFromCenter: node.type === 'connector',
  };
}

function pinRowExitPoint(rect: BoundaryGeometry, handle: Point): Point {
  const y = Math.min(rect.y + rect.height, Math.max(rect.y, handle.y));
  const midX = rect.x + rect.width / 2;
  return handle.x <= midX
    ? { x: rect.x, y }
    : { x: rect.x + rect.width, y };
}

function boundaryExitPoint(
  rect: BoundaryGeometry | null,
  toward: Point,
  fallback: Point,
  pinHandle = false,
): Point {
  if (!rect) return fallback;
  if (pinHandle) return pinRowExitPoint(rect, fallback);
  if (rect.exitFromCenter) {
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
  }
  const anchor = { x: rect.x + rect.width / 2, y: fallback.y };
  return pointOnRectBoundaryToward(rect, anchor, toward);
}

type HarnessBundleEdgeData = {
  pathIds: string[];
  pathCount: number;
  wireAppearances: WireAppearance[];
  bundleColor: string;
  resolvedWaypoints: Point[];
  sharedAnchorMeta: Array<{ sharedAnchorId: string | null; isOwner: boolean; memberCount: number }>;
  inlineDropTarget?: boolean;
  routeStyle?: WireRouteStyle;
  pinSource?: boolean;
  pinTarget?: boolean;
};

type HarnessBundleEdgeType = Edge<HarnessBundleEdgeData, 'harnessBundle'>;

type DotWirePullTarget = {
  key: string;
  connectorId: string;
  pathId: string;
  start: Point;
  end: Point;
  grip: Point;
  color: string;
};

type BranchFamilyPullTarget = {
  key: string;
  end: 'source' | 'target';
  branchPointId: string;
  occurrences: Array<{ pathId: string; nodeIndex: number }>;
  start: Point;
  tip: Point;
  grip: Point;
  color: string;
  label: string;
};

const GRID_STUB_HIT_PX = 48;
const HANDLE_DRAG_THRESHOLD_PX = 5;

function isShortGridStub(points: Point[], index: number): boolean {
  if (points.length < 3) return false;
  if (index === 0) {
    const first = gridSegmentAxis(points[0], points[1]);
    const second = gridSegmentAxis(points[1], points[2]);
    if (first == null || second == null || first === second) return false;
    return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) <= GRID_STUB_HIT_PX;
  }
  if (index === points.length - 2) {
    const last = points.length - 1;
    const tail = gridSegmentAxis(points[last - 1], points[last]);
    const prev = gridSegmentAxis(points[last - 2], points[last - 1]);
    if (tail == null || prev == null || tail === prev) return false;
    return Math.hypot(points[last].x - points[last - 1].x, points[last].y - points[last - 1].y)
      <= GRID_STUB_HIT_PX;
  }
  return false;
}

const WP_R = 7;
const JUNC_R = 9;
const HIT_R = 16;
const EMPTY_WAYPOINTS: WaypointItem[] = [];
const GRID_DRAG_THRESHOLD_PX = HANDLE_DRAG_THRESHOLD_PX;

function waypointListsEqual(a: WaypointItem[], b: WaypointItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    if ('sharedAnchorId' in item || 'sharedAnchorId' in other) {
      return 'sharedAnchorId' in item && 'sharedAnchorId' in other && item.sharedAnchorId === other.sharedAnchorId;
    }
    return item.x === other.x && item.y === other.y;
  });
}

const DEFAULT_WIRE_W = 2;
const WIRE_GAP = 1.5;
const MAX_BUNDLE_W = 28;
const MIN_WIRE_W = 0.5;
const FALLBACK_WIRE_APPEARANCE = getWireAppearance({ tags: [], properties: {} });

function isSharpCorner(points: Point[], index: number): boolean {
  if (index <= 0 || index >= points.length - 1) return false;
  const prev = points[index - 1];
  const curr = points[index];
  const next = points[index + 1];
  const ax = prev.x - curr.x;
  const ay = prev.y - curr.y;
  const bx = next.x - curr.x;
  const by = next.y - curr.y;
  const aLen = Math.hypot(ax, ay);
  const bLen = Math.hypot(bx, by);
  if (aLen < 0.001 || bLen < 0.001) return false;
  const cross = ax * by - ay * bx;
  return Math.abs(cross) / (aLen * bLen) > 0.01;
}

function buildInteractiveSegments(points: Point[], hitStrokeWidth: number): Array<{ start: Point; end: Point; index: number }> {
  if (points.length < 2) return [];
  const trim = Math.max(6, hitStrokeWidth * 0.45);
  const segments: Array<{ start: Point; end: Point; index: number }> = [];

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) continue;

    let startTrim = i > 0 && isSharpCorner(points, i) ? trim : 0;
    let endTrim = i < points.length - 2 && isSharpCorner(points, i + 1) ? trim : 0;

    const maxTrimTotal = Math.max(0, len - 4);
    const trimTotal = startTrim + endTrim;
    if (trimTotal > maxTrimTotal && trimTotal > 0) {
      const scale = maxTrimTotal / trimTotal;
      startTrim *= scale;
      endTrim *= scale;
    }

    const ux = dx / len;
    const uy = dy / len;
    segments.push({
      start: { x: start.x + ux * startTrim, y: start.y + uy * startTrim },
      end: { x: end.x - ux * endTrim, y: end.y - uy * endTrim },
      index: i,
    });
  }

  return segments;
}

function getInteractiveCorners(points: Point[]): Point[] {
  return points.filter((_, index) => isSharpCorner(points, index));
}

export function HarnessBundleEdge(props: EdgeProps<HarnessBundleEdgeType>) {
  const { id, source: sourceId, target: targetId, sourceX, sourceY, targetX, targetY, data, selected } = props;

  const { screenToFlowPosition, setEdges, getZoom } = useReactFlow();
  const sourceNode = useInternalNode(sourceId);
  const targetNode = useInternalNode(targetId);
  const setSelectedHarnessBundle = useSystemStore((s) => s.setSelectedHarnessBundle);
  const selectedRoutePointIndex = useSystemStore((s) =>
    s.selectedHarnessBundle?.id === id ? s.selectedHarnessBundle.routePoint?.index : undefined
  );
  const dismissInspector = useSystemStore((s) => s.dismissInspector);
  const inspectorDismissed = useSystemStore((s) => s.inspectorDismissed);
  const setEdgeWaypoints = useSystemStore((s) => s.setEdgeWaypoints);
  const moveSharedAnchor = useSystemStore((s) => s.moveSharedAnchor);
  const unlinkEdgeFromSharedAnchor = useSystemStore((s) => s.unlinkEdgeFromSharedAnchor);
  const deleteSharedAnchor = useSystemStore((s) => s.deleteSharedAnchor);
  const draggingEdgeInfo = useSystemStore((s) => s.draggingEdgeInfo);
  const setDraggingEdgeInfo = useSystemStore((s) => s.setDraggingEdgeInfo);
  const pushUndoSnapshot = useSystemStore((s) => s.pushUndoSnapshot);
  const commitUndoSnapshot = useSystemStore((s) => s.commitUndoSnapshot);
  const setInteracting = useSystemStore((s) => s.setInteracting);
  const system = useSystemStore((s) => s.system);
  const splitBulkheadDotPath = useSystemStore((s) => s.splitBulkheadDotPath);
  const separateBranchPointFamily = useSystemStore((s) => s.separateBranchPointFamily);
  const selectItem = useSystemStore((s) => s.selectItem);
  const sharedAnchors = useSystemStore((s) => s.sharedAnchors);
  const rawWaypoints = useSystemStore((s) =>
    getHarnessBundleLayoutValue(s.waypointLayouts, id) ?? EMPTY_WAYPOINTS
  );
  const isEditor = useSystemStore((s) => s.session.isEditor);
  const { mode: canvasPlacement, handleFlowClick } = useCanvasPlacement();

  const [hovered, setHovered] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<Point | null>(null);
  const [hoveredWpIdx, setHoveredWpIdx] = useState<number | null>(null);
  const [hoveredGridIdx, setHoveredGridIdx] = useState<number | null>(null);
  const [gridPreview, setGridPreview] = useState<GridPathNode[] | null>(null);
  const [dotWirePull, setDotWirePull] = useState<{
    anchor: Point;
    current: Point;
    color: string;
  } | null>(null);
  const [branchFamilyPull, setBranchFamilyPull] = useState<{
    anchor: Point;
    current: Point;
    color: string;
  } | null>(null);

  const dragPosRef = useRef<Point | null>(null);
  const rawWaypointsRef = useRef<WaypointItem[]>([]);
  const suppressClickRef = useRef(false);

  const wireCount = data?.pathCount ?? 1;
  const pathIds = data?.pathIds;
  const color = data?.bundleColor ?? '#666';
  const routeStyle = data?.routeStyle ?? DEFAULT_WIRE_ROUTE_STYLE;
  const resolvedWaypoints = useMemo(
    () => data?.resolvedWaypoints ?? [],
    [data?.resolvedWaypoints],
  );
  const sharedAnchorMeta = useMemo(
    () => data?.sharedAnchorMeta ?? [],
    [data?.sharedAnchorMeta],
  );

  const waypoints = useMemo(
    () => resolvedWaypoints.map((wp, i) =>
      i === dragIdx && dragPos ? dragPos : wp,
    ),
    [dragIdx, dragPos, resolvedWaypoints],
  );

  const sourceRect = useMemo(
    () => (sourceNode && BOUNDARY_EXIT_NODE_TYPES.has(sourceNode.type ?? '')
      ? nodeFlowRect(sourceNode)
      : null),
    [sourceNode],
  );
  const targetRect = useMemo(
    () => (targetNode && BOUNDARY_EXIT_NODE_TYPES.has(targetNode.type ?? '')
      ? nodeFlowRect(targetNode)
      : null),
    [targetNode],
  );

  const { source, target } = useMemo(() => {
    const fallbackSource = { x: sourceX, y: sourceY };
    const fallbackTarget = { x: targetX, y: targetY };
    const sourceToward = waypoints[0]
      ?? (targetRect
        ? { x: targetRect.x + targetRect.width / 2, y: targetRect.y + targetRect.height / 2 }
        : fallbackTarget);
    const targetToward = waypoints.length > 0
      ? waypoints[waypoints.length - 1]
      : (sourceRect
        ? { x: sourceRect.x + sourceRect.width / 2, y: sourceRect.y + sourceRect.height / 2 }
        : fallbackSource);
    return {
      source: boundaryExitPoint(
        sourceRect,
        sourceToward,
        fallbackSource,
        !!data?.pinSource,
      ),
      target: boundaryExitPoint(
        targetRect,
        targetToward,
        fallbackTarget,
        !!data?.pinTarget,
      ),
    };
  }, [
    sourceRect,
    targetRect,
    sourceX,
    sourceY,
    targetX,
    targetY,
    data?.pinSource,
    data?.pinTarget,
    waypoints,
  ]);

  const allPoints = useMemo(() => {
    if (gridPreview && gridPreview.length >= 2) {
      return gridPreview.map((node) => node.point);
    }
    return routedPolyline([source, ...waypoints, target], routeStyle);
  }, [gridPreview, source, target, waypoints, routeStyle]);

  const wireAppearances = data?.wireAppearances ?? Array(wireCount).fill(FALLBACK_WIRE_APPEARANCE);
  const rawTotalW = wireCount * DEFAULT_WIRE_W + Math.max(0, wireCount - 1) * WIRE_GAP;
  const wireScale = rawTotalW > MAX_BUNDLE_W ? MAX_BUNDLE_W / rawTotalW : 1;
  const wireW = Math.max(MIN_WIRE_W, DEFAULT_WIRE_W * wireScale);
  const wireGap = WIRE_GAP * wireScale;
  const wireStep = wireW + wireGap;
  const bundleW = wireCount <= 1 ? wireW : (wireCount - 1) * wireStep + wireW;
  // Compact bend: clear the innermost wire, but stay tight and circular.
  const halfBundle = bundleW / 2;
  const cornerRadius = halfBundle + Math.max(6, wireStep);
  const edgePath = filletedPolylinePath(allPoints, cornerRadius, 0, halfBundle);
  const strokeWidth = bundleW + 4;
  const hitStrokeWidth = Math.max(20, strokeWidth + 14);
  const cornerHitRadius = Math.max(4, Math.min(8, hitStrokeWidth * 0.2));
  const interactiveSegments = useMemo(
    () => buildInteractiveSegments(allPoints, hitStrokeWidth),
    [allPoints, hitStrokeWidth],
  );
  const gridHandleEntries = useMemo(() => {
    if (routeStyle !== 'grid') return [];
    const nodes = gridPreview ?? buildGridPath(allPoints, resolvedWaypoints, sharedAnchorMeta);
    const entries: Array<{ index: number; point: Point }> = [];
    for (let index = 1; index < nodes.length - 1; index++) {
      const origin = nodes[index].origin.type;
      if (origin !== 'plain' && origin !== 'sharedAnchor') continue;
      entries.push({ index, point: nodes[index].point });
    }
    return entries;
  }, [routeStyle, gridPreview, allPoints, resolvedWaypoints, sharedAnchorMeta]);
  const interactiveCorners = useMemo(
    () => getInteractiveCorners(allPoints),
    [allPoints],
  );
  const dotWirePullTargets = useMemo<DotWirePullTarget[]>(() => {
    if (!isEditor || !system || !pathIds?.length || allPoints.length < 2) return [];
    const targets: DotWirePullTarget[] = [];
    const connectorIdForNode = (node: typeof sourceNode): string | null => {
      const value = (node?.data as { connectorId?: unknown } | undefined)?.connectorId;
      return typeof value === 'string' ? value : null;
    };
    const canRelease = (connectorId: string | null): connectorId is string => {
      if (!connectorId) return false;
      const connector = system.connectors.find((candidate) => candidate.id === connectorId);
      return isBulkheadDot(connector)
        && new Set(getConnectorOccupancy(system, connectorId).map((entry) => entry.pathId)).size > 1;
    };
    const appendTargets = (
      side: 'source' | 'target',
      connectorId: string | null,
      anchor: Point,
      toward: Point,
    ) => {
      if (!canRelease(connectorId)) return;
      const dx = toward.x - anchor.x;
      const dy = toward.y - anchor.y;
      const length = Math.hypot(dx, dy);
      if (length < 0.001) return;
      const ux = dx / length;
      const uy = dy / length;
      const nx = -uy;
      const ny = ux;
      const reach = Math.min(28, length * 0.65);
      pathIds.forEach((pathId, index) => {
        const wireOffset = (index - (pathIds.length - 1) / 2) * wireStep;
        const start = {
          x: anchor.x + nx * wireOffset,
          y: anchor.y + ny * wireOffset,
        };
        const end = {
          x: start.x + ux * reach,
          y: start.y + uy * reach,
        };
        targets.push({
          key: `${side}:${connectorId}:${pathId}`,
          connectorId,
          pathId,
          start,
          end,
          grip: {
            x: start.x + ux * Math.min(9, reach / 2),
            y: start.y + uy * Math.min(9, reach / 2),
          },
          color: wireAppearances[index]?.primaryColor ?? color,
        });
      });
    };

    appendTargets('source', connectorIdForNode(sourceNode), source, allPoints[1]);
    appendTargets(
      'target',
      connectorIdForNode(targetNode),
      target,
      allPoints[allPoints.length - 2],
    );
    return targets;
  }, [
    allPoints,
    color,
    system,
    isEditor,
    pathIds,
    source,
    sourceNode,
    target,
    targetNode,
    wireAppearances,
    wireStep,
  ]);

  const branchFamilyPullTargets = useMemo<BranchFamilyPullTarget[]>(() => {
    if (!isEditor || !system || allPoints.length < 2) return [];
    const parsed = parseHarnessBundleId(id);
    if (!parsed) return [];
    const families = getBranchPointWireFamilies(system, id);
    if (families.length < 2) return [];
    const myThru = parseHarnessBundleThruKey(id);
    const familyIndex = families.findIndex((family) => family.throughKey === myThru);
    const family = families[familyIndex];
    if (!family) return [];

    const ends: Array<{ end: 'source' | 'target'; branchPointId: string }> = [];
    const sourceBranchPointId = branchPointIdFromRefKey(parsed.sourceRefKey);
    if (sourceBranchPointId) {
      ends.push({ end: 'source', branchPointId: sourceBranchPointId });
    }
    const targetBranchPointId = branchPointIdFromRefKey(parsed.targetRefKey);
    if (targetBranchPointId) {
      ends.push({ end: 'target', branchPointId: targetBranchPointId });
    }
    if (ends.length === 0) return [];

    const lane = (familyIndex - (families.length - 1) / 2) * 12;
    const targets: BranchFamilyPullTarget[] = [];
    for (const { end, branchPointId } of ends) {
      const occurrences = family.occurrences
        .filter((occurrence) => occurrence.branchPointId === branchPointId)
        .map((occurrence) => ({ pathId: occurrence.pathId, nodeIndex: occurrence.nodeIndex }));
      if (occurrences.length === 0) continue;
      const anchor = end === 'source' ? source : target;
      const toward = end === 'source' ? allPoints[1] : allPoints[allPoints.length - 2];
      const dx = toward.x - anchor.x;
      const dy = toward.y - anchor.y;
      const length = Math.hypot(dx, dy);
      if (length < 0.001) continue;
      const ux = dx / length;
      const uy = dy / length;
      const nx = -uy;
      const ny = ux;
      const reach = Math.min(28, length * 0.55);
      const start = {
        x: anchor.x + nx * lane + ux * 8,
        y: anchor.y + ny * lane + uy * 8,
      };
      const tip = {
        x: start.x + ux * reach,
        y: start.y + uy * reach,
      };
      targets.push({
        key: `${end}:${family.throughKey}`,
        end,
        branchPointId,
        occurrences,
        start,
        tip,
        grip: {
          x: start.x + ux * Math.min(11, reach / 2),
          y: start.y + uy * Math.min(11, reach / 2),
        },
        color,
        label: family.label,
      });
    }
    return targets;
  }, [allPoints, color, system, id, isEditor, source, target]);

  useEffect(() => {
    rawWaypointsRef.current = rawWaypoints;
  }, [rawWaypoints]);

  const commitWaypoints = useCallback(
    (wps: WaypointItem[]) => setEdgeWaypoints(id, wps),
    [id, setEdgeWaypoints],
  );

  const selectThisRoutePoint = useCallback((index: number) => {
    if (!pathIds) return;
    setSelectedHarnessBundle({ id, pathIds, routePoint: { index } });
  }, [id, pathIds, setSelectedHarnessBundle]);

  const clearRoutePointSelection = useCallback(() => {
    if (!pathIds) return;
    setSelectedHarnessBundle({ id, pathIds });
  }, [id, pathIds, setSelectedHarnessBundle]);

  const commitGridPath = useCallback((nodes: GridPathNode[]) => {
    for (const node of nodes) {
      if (node.origin.type === 'sharedAnchor') {
        moveSharedAnchor(node.origin.sharedAnchorId, node.point);
      }
    }
    commitWaypoints(waypointsFromGridPath(nodes));
  }, [commitWaypoints, moveSharedAnchor]);

  const wasSelectedRef = useRef(selected);
  useEffect(() => {
    const wasSelected = wasSelectedRef.current;
    wasSelectedRef.current = selected;
    if (!wasSelected || selected || routeStyle !== 'grid' || !isEditor) return;
    const pruned = pruneUnusedGridWaypoints(
      source,
      resolvedWaypoints,
      target,
      sharedAnchorMeta,
    );
    if (waypointListsEqual(rawWaypointsRef.current, pruned)) return;
    commitWaypoints(pruned);
  }, [
    selected,
    routeStyle,
    isEditor,
    source,
    target,
    resolvedWaypoints,
    sharedAnchorMeta,
    commitWaypoints,
  ]);

  const findInsertIndex = useCallback((flowPos: Point) => {
    return findRoutePointInsertIndex(
      flowPos,
      source,
      resolvedWaypoints,
      target,
      routeStyle,
      nearestOnPolyline,
    );
  }, [source, target, resolvedWaypoints, routeStyle]);

  // Delete/Backspace removes the selected or hovered waypoint, shared anchor, or grid vertex
  useEffect(() => {
    const selectedWp = selectedRoutePointIndex;
    if (!isEditor || (hoveredWpIdx === null && hoveredGridIdx === null && selectedWp == null)) {
      return;
    }
    const wpIdx = hoveredWpIdx ?? selectedWp ?? null;
    const gridIdx = hoveredGridIdx;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      pushUndoSnapshot(`edge:${id}:delete-waypoint`);

      const meta = wpIdx !== null ? sharedAnchorMeta[wpIdx] : undefined;
      if (meta?.sharedAnchorId) {
        if (meta.memberCount <= 1) {
          deleteSharedAnchor(meta.sharedAnchorId);
        } else {
          unlinkEdgeFromSharedAnchor(meta.sharedAnchorId, id);
        }
      } else if (wpIdx !== null) {
        const newWps = rawWaypointsRef.current.filter((_, i) => i !== wpIdx);
        commitWaypoints(newWps);
      } else if (gridIdx !== null && gridIdx > 0 && gridIdx < allPoints.length - 1) {
        const nodes = buildGridPath(allPoints, resolvedWaypoints, sharedAnchorMeta)
          .filter((_, index) => index !== gridIdx);
        commitGridPath(nodes);
      }
      commitUndoSnapshot();
      setHoveredWpIdx(null);
      setHoveredGridIdx(null);
      clearRoutePointSelection();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [
    hoveredWpIdx,
    hoveredGridIdx,
    selectedRoutePointIndex,
    isEditor,
    sharedAnchorMeta,
    pushUndoSnapshot,
    commitUndoSnapshot,
    deleteSharedAnchor,
    unlinkEdgeFromSharedAnchor,
    id,
    pathIds,
    clearRoutePointSelection,
    commitWaypoints,
    commitGridPath,
    allPoints,
    resolvedWaypoints,
  ]);

  // Click: place in canvas-placement mode, otherwise select the edge
  const handleHitAreaClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (handleFlowClick(e, pathIds ? { id, pathIds } : undefined)) return;
      if (!pathIds) return;
      if (selectedRoutePointIndex != null) {
        clearRoutePointSelection();
        return;
      }
      if (!selected || inspectorDismissed) {
        setSelectedHarnessBundle({ id, pathIds });
      }
    },
    [handleFlowClick, selected, inspectorDismissed, id, pathIds, setSelectedHarnessBundle, selectedRoutePointIndex, clearRoutePointSelection],
  );

  // Double-click edge body: insert a bend point (only if not over a handle)
  const handlePathDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isEditor) return;
      e.stopPropagation();
      e.preventDefault();
      if (pathIds) setSelectedHarnessBundle({ id, pathIds });
      pushUndoSnapshot(`edge:${id}:add-waypoint`);
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const { nearest, segIndex } = nearestOnPolyline(flowPos, allPoints);
      let point = nearest;
      if (routeStyle === 'grid') {
        const start = allPoints[segIndex] ?? nearest;
        const end = allPoints[segIndex + 1] ?? nearest;
        const axis = gridSegmentAxis(start, end);
        const snapped = snapToRouteGrid(nearest);
        point = axis === 'h'
          ? { x: snapped.x, y: start.y }
          : axis === 'v'
            ? { x: start.x, y: snapped.y }
            : snapped;
      }
      const idx = findInsertIndex(point);
      const newWps = [...rawWaypointsRef.current];
      newWps.splice(idx, 0, { x: point.x, y: point.y });
      commitWaypoints(newWps);
      commitUndoSnapshot();
    },
    [
      isEditor,
      pathIds,
      setSelectedHarnessBundle,
      id,
      screenToFlowPosition,
      allPoints,
      findInsertIndex,
      commitWaypoints,
      pushUndoSnapshot,
      commitUndoSnapshot,
      routeStyle,
    ],
  );

  const handleGridGeometryDragStart = useCallback((
    event: React.MouseEvent,
    kind: 'segment' | 'vertex',
    index: number,
  ) => {
    if (!isEditor || event.button !== 0 || routeStyle !== 'grid') return;
    if (event.detail > 1) return;
    event.stopPropagation();
    if (kind === 'vertex') event.preventDefault();

    const originNodes = buildGridPath(allPoints, resolvedWaypoints, sharedAnchorMeta);
    if (kind === 'vertex') {
      const point = originNodes[index]?.point;
      const resolvedIndex = point
        ? resolvedWaypoints.findIndex((wp) => routePointsEqual(wp, point))
        : -1;
      if (resolvedIndex >= 0) selectThisRoutePoint(resolvedIndex);
      else if (pathIds) setSelectedHarnessBundle({ id, pathIds });
    } else if (pathIds) {
      setSelectedHarnessBundle({ id, pathIds });
    }

    const startClient = { x: event.clientX, y: event.clientY };
    let dragging = false;
    let current = originNodes;

    const onMove = (moveEvent: MouseEvent) => {
      const dist = Math.hypot(moveEvent.clientX - startClient.x, moveEvent.clientY - startClient.y);
      if (!dragging) {
        if (dist < GRID_DRAG_THRESHOLD_PX) return;
        dragging = true;
        dismissInspector();
        pushUndoSnapshot(`edge:${id}:grid-${kind}:${index}`);
        setInteracting('harnessBundle', id, true);
      }
      const pointer = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
      current = kind === 'segment'
        ? offsetGridSegment(originNodes, index, pointer)
        : offsetGridVertex(originNodes, index, pointer);
      setGridPreview(current);
      commitGridPath(current);
      const draggedIndex = kind === 'vertex'
        ? Math.min(current.length - 2, originNodes.length === current.length ? index : index + 1)
        : -1;
      setDraggingEdgeInfo({
        edgeId: id,
        position: snapToRouteGrid(pointer),
        waypointIndex: draggedIndex > 0 ? draggedIndex - 1 : undefined,
      });
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setGridPreview(null);
      setInteracting('harnessBundle', id, false);
      if (dragging) {
        suppressClickRef.current = true;
        commitGridPath(current);
        commitUndoSnapshot();
      }
      setDraggingEdgeInfo(null);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [
    isEditor,
    routeStyle,
    pathIds,
    setSelectedHarnessBundle,
    selectThisRoutePoint,
    id,
    dismissInspector,
    allPoints,
    resolvedWaypoints,
    sharedAnchorMeta,
    pushUndoSnapshot,
    setInteracting,
    screenToFlowPosition,
    setDraggingEdgeInfo,
    commitGridPath,
    commitUndoSnapshot,
  ]);

  const handleDotWirePullStart = useCallback((
    event: React.MouseEvent,
    targetInfo: DotWirePullTarget,
  ) => {
    if (!isEditor || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startClient = { x: event.clientX, y: event.clientY };
    setDotWirePull({
      anchor: targetInfo.start,
      current: targetInfo.start,
      color: targetInfo.color,
    });

    const handleMove = (moveEvent: MouseEvent) => {
      const current = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
      setDotWirePull({
        anchor: targetInfo.start,
        current,
        color: targetInfo.color,
      });
    };
    const handleUp = (upEvent: MouseEvent) => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      setDotWirePull(null);
      const distance = Math.hypot(
        upEvent.clientX - startClient.x,
        upEvent.clientY - startClient.y,
      );
      if (distance >= 10) {
        splitBulkheadDotPath(targetInfo.connectorId, targetInfo.pathId);
      }
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [isEditor, screenToFlowPosition, splitBulkheadDotPath]);

  const handleBranchFamilyPullStart = useCallback((
    event: React.MouseEvent,
    targetInfo: BranchFamilyPullTarget,
  ) => {
    if (!isEditor || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = true;
    const startClient = { x: event.clientX, y: event.clientY };
    if (pathIds) setSelectedHarnessBundle({ id, pathIds });
    setBranchFamilyPull({
      anchor: targetInfo.start,
      current: targetInfo.start,
      color: targetInfo.color,
    });

    const handleMove = (moveEvent: MouseEvent) => {
      const current = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
      setBranchFamilyPull({
        anchor: targetInfo.start,
        current,
        color: targetInfo.color,
      });
    };
    const handleUp = (upEvent: MouseEvent) => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      setBranchFamilyPull(null);
      const distance = Math.hypot(
        upEvent.clientX - startClient.x,
        upEvent.clientY - startClient.y,
      );
      if (distance < 10) return;
      const raw = screenToFlowPosition({ x: upEvent.clientX, y: upEvent.clientY });
      const point = routeStyle === 'grid' ? snapToRouteGrid(raw) : raw;
      separateBranchPointFamily(targetInfo.branchPointId, targetInfo.occurrences, point);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [
    id,
    isEditor,
    pathIds,
    routeStyle,
    screenToFlowPosition,
    setSelectedHarnessBundle,
    separateBranchPointFamily,
  ]);

  // Drag an existing regular waypoint
  const handleWaypointDragStart = useCallback(
    (e: React.MouseEvent, resolvedIndex: number) => {
      if (!isEditor || e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      selectThisRoutePoint(resolvedIndex);

      const startClient = { x: e.clientX, y: e.clientY };
      const originWps = rawWaypointsRef.current.map((waypoint) => ({ ...waypoint }));
      let dragging = false;

      setDragIdx(resolvedIndex);
      const startPt = resolvedWaypoints[resolvedIndex];
      setDragPos(startPt);
      dragPosRef.current = startPt;

      const onMove = (me: MouseEvent) => {
        const dist = Math.hypot(me.clientX - startClient.x, me.clientY - startClient.y);
        if (!dragging) {
          if (dist < HANDLE_DRAG_THRESHOLD_PX) return;
          dragging = true;
          dismissInspector();
          pushUndoSnapshot(`edge:${id}:move-waypoint:${resolvedIndex}`);
          setInteracting('harnessBundle', id, true);
        }
        const raw = screenToFlowPosition({ x: me.clientX, y: me.clientY });
        const pos = routeStyle === 'grid' ? snapToRouteGrid(raw) : raw;
        setDragPos(pos);
        dragPosRef.current = pos;
        const newWps = [...originWps];
        newWps[resolvedIndex] = { x: pos.x, y: pos.y };
        commitWaypoints(newWps);
        setDraggingEdgeInfo({ edgeId: id, position: pos, waypointIndex: resolvedIndex });
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        setDraggingEdgeInfo(null);
        setInteracting('harnessBundle', id, false);

        if (dragging) {
          suppressClickRef.current = true;
          if (dragPosRef.current) {
            const newWps = [...originWps];
            newWps[resolvedIndex] = { x: dragPosRef.current.x, y: dragPosRef.current.y };
            commitWaypoints(newWps);
          }
          commitUndoSnapshot();
        }

        setDragIdx(null);
        setDragPos(null);
        dragPosRef.current = null;
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [isEditor, resolvedWaypoints, screenToFlowPosition, commitWaypoints, id,
      selectThisRoutePoint, dismissInspector, setDraggingEdgeInfo, pushUndoSnapshot, commitUndoSnapshot,
      setInteracting, routeStyle],
  );

  // Drag a shared anchor
  const handleSharedAnchorDragStart = useCallback(
    (e: React.MouseEvent, sharedAnchorId: string, resolvedIndex: number) => {
      if (!isEditor || e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const branchPointId = sharedAnchors[sharedAnchorId]?.branchPointId;
      if (branchPointId) {
        selectItem({ type: 'branchPoint', id: branchPointId });
      } else {
        selectThisRoutePoint(resolvedIndex);
      }

      const startClient = { x: e.clientX, y: e.clientY };
      let dragging = false;

      const startPt = resolvedWaypoints[resolvedIndex];
      setDragIdx(resolvedIndex);
      setDragPos(startPt);
      dragPosRef.current = startPt;

      const onMove = (me: MouseEvent) => {
        const dist = Math.hypot(me.clientX - startClient.x, me.clientY - startClient.y);
        if (!dragging) {
          if (dist < HANDLE_DRAG_THRESHOLD_PX) return;
          dragging = true;
          if (!branchPointId) dismissInspector();
          pushUndoSnapshot(`sharedAnchor:${sharedAnchorId}:move`);
          setInteracting('harnessBundle', id, true);
        }
        const raw = screenToFlowPosition({ x: me.clientX, y: me.clientY });
        const pos = routeStyle === 'grid' ? snapToRouteGrid(raw) : raw;
        setDragPos(pos);
        dragPosRef.current = pos;
        moveSharedAnchor(sharedAnchorId, pos);
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        setInteracting('harnessBundle', id, false);
        if (dragging) {
          suppressClickRef.current = true;
          if (dragPosRef.current) {
            moveSharedAnchor(sharedAnchorId, dragPosRef.current);
          }
          commitUndoSnapshot();
        }
        setDragIdx(null);
        setDragPos(null);
        dragPosRef.current = null;
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [isEditor, resolvedWaypoints, screenToFlowPosition, moveSharedAnchor, id,
      selectThisRoutePoint, dismissInspector, pushUndoSnapshot, commitUndoSnapshot, setInteracting,
      routeStyle, sharedAnchors, selectItem],
  );

  // Proximity detection for shared-anchor auto-join
  const isNearbyDrag = (() => {
    if (!draggingEdgeInfo || draggingEdgeInfo.edgeId === id) return false;
    const dp = draggingEdgeInfo.position;
    const { dist } = nearestOnPolyline(dp, allPoints);
    return dist * getZoom() <= SHARED_ANCHOR_SNAP_RADIUS_PX;
  })();

  const showHandles = isEditor && (selected || hovered || selectedRoutePointIndex != null);

  // Label position: offset perpendicular from the midpoint segment
  const labelPos = (() => {
    const mid = Math.floor(allPoints.length / 2);
    const a = allPoints[Math.max(0, mid - 1)];
    const b = allPoints[Math.min(allPoints.length - 1, mid)];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const offset = strokeWidth + 12;
    return { x: mx + nx * offset, y: my + ny * offset };
  })();

  // Keep the active edge (bend handles included) above crossing harnesses.
  const elevateEdge = useCallback((elevate: boolean) => {
    setEdges((eds) =>
      eds.map((edge) => {
        if (edge.id !== id) return edge;
        const data = edge.data as HarnessBundleEdgeData | undefined;
        const attached = !!(data?.pinSource || data?.pinTarget)
          || isGraphPinHandle(edge.sourceHandle)
          || isGraphPinHandle(edge.targetHandle);
        if (elevate) {
          return { ...edge, zIndex: graphWireZIndex(true, attached) };
        }
        return { ...edge, zIndex: graphWireZIndex(!!edge.selected, attached) };
      }),
    );
  }, [id, setEdges]);

  return (
    <g
      onMouseEnter={() => {
        setHovered(true);
        elevateEdge(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
        elevateEdge(false);
      }}
      className="cursor-pointer"
    >
      {/* ── Layer 1: all visuals (no events) ── */}

      {data?.inlineDropTarget && (
        <path
          d={edgePath}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={bundleW + 18}
          opacity={0.55}
          pointerEvents="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {dotWirePull && (
        <line
          x1={dotWirePull.anchor.x}
          y1={dotWirePull.anchor.y}
          x2={dotWirePull.current.x}
          y2={dotWirePull.current.y}
          stroke={dotWirePull.color}
          strokeWidth={2}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      )}

      {branchFamilyPull && (
        <line
          x1={branchFamilyPull.anchor.x}
          y1={branchFamilyPull.anchor.y}
          x2={branchFamilyPull.current.x}
          y2={branchFamilyPull.current.y}
          stroke={branchFamilyPull.color}
          strokeWidth={2.5}
          strokeDasharray="5 3"
          pointerEvents="none"
        />
      )}

      {isNearbyDrag && (
        <path
          d={edgePath}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={bundleW + 14}
          opacity={0.45}
          pointerEvents="none"
        />
      )}

      {selected && (
        <path
          d={edgePath}
          fill="none"
          stroke={color}
          strokeWidth={bundleW + 8}
          opacity={0.25}
          strokeLinejoin="round"
          pointerEvents="none"
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        />
      )}

      {wireAppearances.map((appearance, wi) => {
        const wo = (wi - (wireCount - 1) / 2) * wireStep;
        const wp = wireCount <= 1
          ? edgePath
          : filletedPolylinePath(allPoints, cornerRadius, wo, halfBundle);
        const layers = isNearbyDrag
          ? [{ color: '#f59e0b', width: wireW }]
          : getWireStrokeLayers(appearance ?? FALLBACK_WIRE_APPEARANCE, wireW);
        return (
          <g key={`w-${wi}`}>
            {layers.map((layer, layerIndex) => (
              <path
                key={`w-${wi}-${layerIndex}`}
                d={wp}
                fill="none"
                stroke={layer.color}
                strokeWidth={layer.width}
                opacity={layer.opacity ?? 1}
                strokeDasharray={layer.dasharray}
                strokeDashoffset={layer.dashoffset}
                strokeLinejoin="round"
                strokeLinecap={layer.linecap ?? 'round'}
                pointerEvents="none"
                style={{ transition: 'opacity 0.2s' }}
              />
            ))}
          </g>
        );
      })}

      {/* Shared-anchor dot visuals — always visible */}
      {waypoints.map((wp, i) => {
        const meta = sharedAnchorMeta[i];
        if (!meta?.sharedAnchorId || !meta.isOwner) return null;
        const isHov = hoveredWpIdx === i;
        const isSel = selectedRoutePointIndex === i;
        return (
          <g key={`jctv-${i}`} pointerEvents="none">
            <circle cx={wp.x} cy={wp.y} r={JUNC_R + 3} fill="none" stroke="#f59e0b" strokeWidth={isSel ? 2 : 1} opacity={isHov || isSel ? 0.8 : 0.3} />
            <circle
              cx={wp.x} cy={wp.y} r={JUNC_R}
              fill={dragIdx === i ? '#fbbf24' : isSel || isHov ? '#fcd34d' : '#f59e0b'}
              stroke="#fff" strokeWidth={2}
              style={{ filter: 'drop-shadow(0 0 4px #f59e0b)' }}
            />
            {meta.memberCount > 1 && (
              <text x={wp.x} y={wp.y + 1} textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="bold" fill="#1c1917" className="select-none">
                {meta.memberCount}
              </text>
            )}
            {isHov || isSel ? (
              <text x={wp.x} y={wp.y - JUNC_R - 8} textAnchor="middle" dominantBaseline="auto" fontSize="8" fill="#a1a1aa" className="select-none">Del</text>
            ) : null}
          </g>
        );
      })}

      {/* Waypoint dot visuals — when hovered or selected */}
      {showHandles && routeStyle !== 'grid' &&
        waypoints.map((wp, i) => {
          if (sharedAnchorMeta[i]?.sharedAnchorId) return null;
          const isHov = hoveredWpIdx === i;
          const isSel = selectedRoutePointIndex === i;
          return (
            <g key={`wpv-${i}`} pointerEvents="none">
              <circle cx={wp.x} cy={wp.y} r={WP_R + 2} fill="none" stroke={color} strokeWidth={isSel ? 2 : 1} opacity={isHov || isSel ? 0.85 : 0.3} />
              <circle
                cx={wp.x} cy={wp.y} r={WP_R}
                fill={dragIdx === i ? '#f59e0b' : isSel || isHov ? '#a3e635' : color}
                stroke={isSel ? '#fafafa' : '#fff'} strokeWidth={isSel ? 2 : 1.5}
                style={{ filter: `drop-shadow(0 0 3px ${color})` }}
              />
              {(isHov || isSel) && (
                <text x={wp.x} y={wp.y - WP_R - 6} textAnchor="middle" dominantBaseline="auto" fontSize="8" fill="#a1a1aa" className="select-none">Del</text>
              )}
            </g>
          );
        })}

      {showHandles && routeStyle === 'grid' &&
        gridHandleEntries.map(({ index, point: pt }) => {
          const resolvedIndex = resolvedWaypoints.findIndex((wp) => routePointsEqual(wp, pt));
          if (resolvedIndex >= 0 && sharedAnchorMeta[resolvedIndex]?.sharedAnchorId) return null;
          const isHov = hoveredGridIdx === index;
          const isSel = resolvedIndex >= 0 && selectedRoutePointIndex === resolvedIndex;
          return (
            <g key={`gridv-${index}`} pointerEvents="none">
              <circle cx={pt.x} cy={pt.y} r={WP_R + 2} fill="none" stroke={color} strokeWidth={isSel ? 2 : 1} opacity={isHov || isSel ? 0.85 : 0.3} />
              <circle
                cx={pt.x} cy={pt.y} r={WP_R}
                fill={isSel || isHov ? '#a3e635' : color}
                stroke={isSel ? '#fafafa' : '#fff'} strokeWidth={isSel ? 2 : 1.5}
                style={{ filter: `drop-shadow(0 0 3px ${color})` }}
              />
              {(isHov || isSel) && (
                <text x={pt.x} y={pt.y - WP_R - 6} textAnchor="middle" dominantBaseline="auto" fontSize="8" fill="#a1a1aa" className="select-none">Del</text>
              )}
            </g>
          );
        })}

      {/* Wire count label */}
      <foreignObject
        x={labelPos.x + 16}
        y={labelPos.y - 10}
        width={56}
        height={20}
        pointerEvents="none"
        className="overflow-visible"
      >
        <PresenceBadge
          kind="harnessBundle"
          id={id}
          className="pointer-events-auto"
        />
      </foreignObject>
      {selected ? (
        <foreignObject x={labelPos.x - 30} y={labelPos.y - 12} width={60} height={24} pointerEvents="none" className="overflow-visible">
          <div className="flex items-center justify-center h-full">
            <span className="text-[11px] font-medium bg-zinc-800 text-zinc-100 px-2 py-0.5 rounded border border-zinc-600 whitespace-nowrap shadow">
              {wireCount} path{wireCount !== 1 ? 's' : ''}
            </span>
          </div>
        </foreignObject>
      ) : (
        <foreignObject x={labelPos.x - 16} y={labelPos.y - 8} width={32} height={16} pointerEvents="none" className="overflow-visible">
          <div className="flex items-center justify-center h-full">
            <span className="text-[7px] bg-zinc-900/50 text-zinc-600 px-0.5 rounded whitespace-nowrap">{wireCount}p</span>
          </div>
        </foreignObject>
      )}

      {/* ── Layer 2: all interactive hit targets (on top of everything) ── */}

      {/* Edge body hit area — selection, click-to-place, and grid segment drag */}
      {interactiveSegments.map((segment) => {
        if (routeStyle === 'grid' && isShortGridStub(allPoints, segment.index)) return null;
        const axis = gridSegmentAxis(allPoints[segment.index] ?? segment.start, allPoints[segment.index + 1] ?? segment.end);
        const cursorClass = canvasPlacement !== 'none'
          ? 'cursor-crosshair'
          : routeStyle === 'grid' && isEditor
            ? (axis === 'h' ? 'cursor-ns-resize' : axis === 'v' ? 'cursor-ew-resize' : 'cursor-pointer')
            : 'cursor-pointer';
        return (
          <path
            key={`hit-seg-${segment.index}`}
            d={`M ${segment.start.x} ${segment.start.y} L ${segment.end.x} ${segment.end.y}`}
            fill="none"
            stroke="transparent"
            strokeWidth={hitStrokeWidth}
            strokeLinecap="butt"
            pointerEvents="all"
            className={cursorClass}
            onMouseDown={routeStyle === 'grid' && isEditor
              ? (event) => handleGridGeometryDragStart(event, 'segment', segment.index)
              : undefined}
            onClick={handleHitAreaClick}
            onDoubleClick={handlePathDoubleClick}
          />
        );
      })}

      {interactiveCorners.map((point, index) => (
        <circle
          key={`hit-corner-${index}`}
          cx={point.x}
          cy={point.y}
          r={cornerHitRadius}
          fill="transparent"
          pointerEvents="all"
          className="cursor-pointer"
          onClick={handleHitAreaClick}
          onDoubleClick={handlePathDoubleClick}
        />
      ))}

      {dotWirePullTargets.map((targetInfo) => (
        <g key={targetInfo.key}>
          <circle
            cx={targetInfo.grip.x}
            cy={targetInfo.grip.y}
            r={2.5}
            fill={targetInfo.color}
            stroke="#18181b"
            strokeWidth={1}
            pointerEvents="none"
          />
          <path
            d={`M ${targetInfo.start.x} ${targetInfo.start.y} L ${targetInfo.end.x} ${targetInfo.end.y}`}
            fill="none"
            stroke="transparent"
            strokeWidth={10}
            strokeLinecap="round"
            pointerEvents="all"
            className="cursor-grab active:cursor-grabbing"
            onMouseDown={(event) => handleDotWirePullStart(event, targetInfo)}
          >
            <title>Drag this wire away from the dot to pop it out</title>
          </path>
        </g>
      ))}

      {branchFamilyPullTargets.map((targetInfo) => (
        <g key={targetInfo.key}>
          <line
            x1={targetInfo.start.x}
            y1={targetInfo.start.y}
            x2={targetInfo.tip.x}
            y2={targetInfo.tip.y}
            stroke={targetInfo.color}
            strokeWidth={1.5}
            strokeDasharray="3 2"
            opacity={0.55}
            pointerEvents="none"
          />
          <circle
            cx={targetInfo.grip.x}
            cy={targetInfo.grip.y}
            r={4}
            fill={targetInfo.color}
            stroke="#fafafa"
            strokeWidth={1.25}
            pointerEvents="none"
            style={{ filter: 'drop-shadow(0 0 3px rgba(0,0,0,0.45))' }}
          />
          <path
            d={`M ${targetInfo.start.x} ${targetInfo.start.y} L ${targetInfo.tip.x} ${targetInfo.tip.y}`}
            fill="none"
            stroke="transparent"
            strokeWidth={12}
            strokeLinecap="round"
            pointerEvents="all"
            className="cursor-grab active:cursor-grabbing"
            onMouseDown={(event) => handleBranchFamilyPullStart(event, targetInfo)}
          >
            <title>{`Drag to split "${targetInfo.label}" off this branch point onto its own new branch point`}</title>
          </path>
        </g>
      ))}

      {/* Shared-anchor grab circles — on EVERY edge (not just owner) so the topmost
           edge in SVG paint order always has a grabbable target */}
      {isEditor && routeStyle !== 'grid' && waypoints.map((wp, i) => {
        const meta = sharedAnchorMeta[i];
        if (!meta?.sharedAnchorId) return null;
        return (
          <circle
            key={`jcth-${i}`}
            cx={wp.x} cy={wp.y} r={HIT_R}
            fill="none" stroke="none"
            pointerEvents="all"
            className="cursor-move"
            onMouseEnter={() => setHoveredWpIdx(i)}
            onMouseLeave={() => setHoveredWpIdx(null)}
            onMouseDown={(e) => handleSharedAnchorDragStart(e, meta.sharedAnchorId!, i)}
            onClick={(e) => e.stopPropagation()}
          />
        );
      })}

      {/* Waypoint grab circles — rendered LAST = topmost */}
      {showHandles && routeStyle !== 'grid' &&
        waypoints.map((wp, i) => {
          if (sharedAnchorMeta[i]?.sharedAnchorId) return null;
          return (
            <circle
              key={`wph-${i}`}
              cx={wp.x} cy={wp.y} r={HIT_R}
              fill="none" stroke="none"
              pointerEvents="all"
            className="cursor-move"
            onMouseEnter={() => setHoveredWpIdx(i)}
            onMouseLeave={() => setHoveredWpIdx(null)}
            onMouseDown={(e) => handleWaypointDragStart(e, i)}
            onClick={(e) => e.stopPropagation()}
            />
          );
        })}

      {showHandles && routeStyle === 'grid' &&
        gridHandleEntries.map(({ index, point: pt }) => {
          const resolvedIndex = resolvedWaypoints.findIndex((wp) => routePointsEqual(wp, pt));
          return (
            <circle
              key={`gridh-${index}`}
              cx={pt.x} cy={pt.y} r={HIT_R}
              fill="none" stroke="none"
              pointerEvents="all"
              className="cursor-move"
              onMouseEnter={() => {
                setHoveredGridIdx(index);
                setHoveredWpIdx(resolvedIndex >= 0 ? resolvedIndex : null);
              }}
              onMouseLeave={() => {
                setHoveredGridIdx(null);
                setHoveredWpIdx(null);
              }}
              onMouseDown={(e) => handleGridGeometryDragStart(e, 'vertex', index)}
              onClick={(e) => e.stopPropagation()}
            />
          );
        })}
    </g>
  );
}
