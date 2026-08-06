import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  type Edge,
  type EdgeProps,
  useInternalNode,
  useReactFlow,
} from '@xyflow/react';
import { useHarnessStore } from '../../store';
import {
  filletedPolylinePath,
  nearestOnPolyline,
  pointOnRectBoundaryToward,
  type Point,
  type Rect,
} from '../../lib/paths';
import {
  getWireAppearance,
  getWireStrokeLayers,
  type WireAppearance,
} from '../../lib/colors';
import type { WaypointItem } from '../../types';
import {
  GRAPH_Z_SELECTED_WIRE,
  GRAPH_Z_WIRE,
  JUNCTION_SNAP_RADIUS_PX,
} from './graphModel';

const BOUNDARY_EXIT_NODE_TYPES = new Set(['connector', 'mergePoint']);

type BoundaryGeometry = Rect & {
  /** Connectors emit from their geometric center; merge points use boundary projection. */
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

function boundaryExitPoint(
  rect: BoundaryGeometry | null,
  toward: Point,
  fallback: Point,
): Point {
  if (!rect) return fallback;
  if (rect.exitFromCenter) {
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
  }
  const anchor = { x: rect.x + rect.width / 2, y: fallback.y };
  return pointOnRectBoundaryToward(rect, anchor, toward);
}

type BundleEdgeData = {
  pathIds: string[];
  pathCount: number;
  wireAppearances: WireAppearance[];
  bundleColor: string;
  resolvedWaypoints: Point[];
  junctionMeta: Array<{ junctionId: string | null; isOwner: boolean; memberCount: number }>;
};

type BundleEdgeType = Edge<BundleEdgeData, 'bundle'>;

const WP_R = 7;
const JUNC_R = 9;
const HIT_R = 16;
const EMPTY_WAYPOINTS: WaypointItem[] = [];

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

function buildInteractiveSegments(points: Point[], hitStrokeWidth: number): Array<{ start: Point; end: Point }> {
  if (points.length < 2) return [];
  const trim = Math.max(6, hitStrokeWidth * 0.45);
  const segments: Array<{ start: Point; end: Point }> = [];

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
    });
  }

  return segments;
}

function getInteractiveCorners(points: Point[]): Point[] {
  return points.filter((_, index) => isSharpCorner(points, index));
}

export function BundleEdge(props: EdgeProps<BundleEdgeType>) {
  const { id, source: sourceId, target: targetId, sourceX, sourceY, targetX, targetY, data, selected } = props;

  const { screenToFlowPosition, setEdges, getZoom } = useReactFlow();
  const sourceNode = useInternalNode(sourceId);
  const targetNode = useInternalNode(targetId);
  const setSelectedBundle = useHarnessStore((s) => s.setSelectedBundle);
  const dismissInspector = useHarnessStore((s) => s.dismissInspector);
  const inspectorDismissed = useHarnessStore((s) => s.inspectorDismissed);
  const setEdgeWaypoints = useHarnessStore((s) => s.setEdgeWaypoints);
  const moveJunction = useHarnessStore((s) => s.moveJunction);
  const unlinkEdgeFromJunction = useHarnessStore((s) => s.unlinkEdgeFromJunction);
  const deleteJunction = useHarnessStore((s) => s.deleteJunction);
  const draggingEdgeInfo = useHarnessStore((s) => s.draggingEdgeInfo);
  const setDraggingEdgeInfo = useHarnessStore((s) => s.setDraggingEdgeInfo);
  const pushUndoSnapshot = useHarnessStore((s) => s.pushUndoSnapshot);
  const commitUndoSnapshot = useHarnessStore((s) => s.commitUndoSnapshot);
  const setInteracting = useHarnessStore((s) => s.setInteracting);
  const rawWaypoints = useHarnessStore((s) => s.waypointLayouts[id] ?? EMPTY_WAYPOINTS);
  const isEditor = useHarnessStore((s) => s.session.isEditor);

  const [hovered, setHovered] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<Point | null>(null);
  const [hoveredWpIdx, setHoveredWpIdx] = useState<number | null>(null);

  const dragPosRef = useRef<Point | null>(null);
  const rawWaypointsRef = useRef<WaypointItem[]>([]);

  const wireCount = data?.pathCount ?? 1;
  const color = data?.bundleColor ?? '#666';
  const resolvedWaypoints = useMemo(
    () => data?.resolvedWaypoints ?? [],
    [data?.resolvedWaypoints],
  );
  const junctionMeta = useMemo(
    () => data?.junctionMeta ?? [],
    [data?.junctionMeta],
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
      source: boundaryExitPoint(sourceRect, sourceToward, fallbackSource),
      target: boundaryExitPoint(targetRect, targetToward, fallbackTarget),
    };
  }, [sourceRect, targetRect, sourceX, sourceY, targetX, targetY, waypoints]);

  const allPoints = useMemo(
    () => [source, ...waypoints, target],
    [source, target, waypoints],
  );

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
  const interactiveCorners = useMemo(
    () => getInteractiveCorners(allPoints),
    [allPoints],
  );

  useEffect(() => {
    rawWaypointsRef.current = rawWaypoints;
  }, [rawWaypoints]);

  const commitWaypoints = useCallback(
    (wps: WaypointItem[]) => setEdgeWaypoints(id, wps),
    [id, setEdgeWaypoints],
  );

  const findInsertIndex = useCallback((flowPos: Point) => {
    const pts = [source, ...resolvedWaypoints, target];
    if (pts.length < 2) return 0;
    const { segIndex } = nearestOnPolyline(flowPos, pts);
    return Math.max(0, Math.min(rawWaypointsRef.current.length, segIndex));
  }, [source, target, resolvedWaypoints]);

  // Delete/Backspace key removes hovered waypoint or junction
  useEffect(() => {
    if (!isEditor || hoveredWpIdx === null) return;
    const idx = hoveredWpIdx;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      e.preventDefault();
      e.stopPropagation();
      pushUndoSnapshot(`edge:${id}:delete-waypoint`);

      const meta = junctionMeta[idx];
      if (meta?.junctionId) {
        if (meta.memberCount <= 1) {
          deleteJunction(meta.junctionId);
        } else {
          unlinkEdgeFromJunction(meta.junctionId, id);
        }
      } else {
        const newWps = rawWaypointsRef.current.filter((_, i) => i !== idx);
        commitWaypoints(newWps);
      }
      commitUndoSnapshot();
      setHoveredWpIdx(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hoveredWpIdx, isEditor, junctionMeta, pushUndoSnapshot, commitUndoSnapshot, deleteJunction, unlinkEdgeFromJunction, id, commitWaypoints]);

  // Click: select the edge (or re-open the inspector after waypoint editing)
  const pathIds = data?.pathIds;
  const handleHitAreaClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!pathIds) return;
      if (!selected || inspectorDismissed) {
        setSelectedBundle({ id, pathIds });
      }
    },
    [selected, inspectorDismissed, id, pathIds, setSelectedBundle],
  );

  // Double-click edge body: insert a bend point (only if not over a handle)
  const handlePathDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isEditor || !selected) return;
      e.stopPropagation();
      e.preventDefault();
      pushUndoSnapshot(`edge:${id}:add-waypoint`);
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const idx = findInsertIndex(flowPos);
      const newWps = [...rawWaypointsRef.current];
      newWps.splice(idx, 0, { x: flowPos.x, y: flowPos.y });
      commitWaypoints(newWps);
      commitUndoSnapshot();
    },
    [isEditor, selected, screenToFlowPosition, findInsertIndex, commitWaypoints, pushUndoSnapshot, commitUndoSnapshot, id],
  );

  // Drag an existing regular waypoint
  const handleWaypointDragStart = useCallback(
    (e: React.MouseEvent, resolvedIndex: number) => {
      if (!isEditor || e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      // Keep the edge selected for handles, but free the canvas from the inspector.
      if (pathIds) setSelectedBundle({ id, pathIds });
      dismissInspector();
      pushUndoSnapshot(`edge:${id}:move-waypoint:${resolvedIndex}`);
      setInteracting('bundle', id, true);

      setDragIdx(resolvedIndex);
      const startPt = resolvedWaypoints[resolvedIndex];
      setDragPos(startPt);
      dragPosRef.current = startPt;

      const onMove = (me: MouseEvent) => {
        const pos = screenToFlowPosition({ x: me.clientX, y: me.clientY });
        setDragPos(pos);
        dragPosRef.current = pos;
        setDraggingEdgeInfo({ edgeId: id, position: pos, waypointIndex: resolvedIndex });
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        setDraggingEdgeInfo(null);
        setInteracting('bundle', id, false);

        if (dragPosRef.current) {
          const newWps = [...rawWaypointsRef.current];
          newWps[resolvedIndex] = { x: dragPosRef.current.x, y: dragPosRef.current.y };
          commitWaypoints(newWps);
        }
        commitUndoSnapshot();

        setDragIdx(null);
        setDragPos(null);
        dragPosRef.current = null;
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [isEditor, resolvedWaypoints, screenToFlowPosition, commitWaypoints, id, pathIds,
      setSelectedBundle, dismissInspector, setDraggingEdgeInfo, pushUndoSnapshot, commitUndoSnapshot,
      setInteracting],
  );

  // Drag a junction
  const handleJunctionDragStart = useCallback(
    (e: React.MouseEvent, junctionId: string, resolvedIndex: number) => {
      if (!isEditor || e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      if (pathIds) setSelectedBundle({ id, pathIds });
      dismissInspector();
      pushUndoSnapshot(`junction:${junctionId}:move`);
      setInteracting('bundle', id, true);

      const startPt = resolvedWaypoints[resolvedIndex];
      setDragIdx(resolvedIndex);
      setDragPos(startPt);
      dragPosRef.current = startPt;

      const onMove = (me: MouseEvent) => {
        const pos = screenToFlowPosition({ x: me.clientX, y: me.clientY });
        setDragPos(pos);
        dragPosRef.current = pos;
        moveJunction(junctionId, pos);
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        setInteracting('bundle', id, false);
        if (dragPosRef.current) {
          moveJunction(junctionId, dragPosRef.current);
        }
        commitUndoSnapshot();
        setDragIdx(null);
        setDragPos(null);
        dragPosRef.current = null;
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [isEditor, resolvedWaypoints, screenToFlowPosition, moveJunction, id, pathIds,
      setSelectedBundle, dismissInspector, pushUndoSnapshot, commitUndoSnapshot, setInteracting],
  );

  // Proximity detection for junction auto-merge
  const isNearbyDrag = (() => {
    if (!draggingEdgeInfo || draggingEdgeInfo.edgeId === id) return false;
    const dp = draggingEdgeInfo.position;
    const { dist } = nearestOnPolyline(dp, allPoints);
    return dist * getZoom() <= JUNCTION_SNAP_RADIUS_PX;
  })();

  const showHandles = isEditor && (selected || hovered);

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
        if (elevate) {
          return { ...edge, zIndex: Math.max(edge.zIndex ?? GRAPH_Z_WIRE, GRAPH_Z_SELECTED_WIRE) };
        }
        if (edge.selected) return { ...edge, zIndex: GRAPH_Z_SELECTED_WIRE };
        return { ...edge, zIndex: GRAPH_Z_WIRE };
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

      {/* Junction dot visuals — always visible */}
      {waypoints.map((wp, i) => {
        const meta = junctionMeta[i];
        if (!meta?.junctionId || !meta.isOwner) return null;
        const isHov = hoveredWpIdx === i;
        return (
          <g key={`jctv-${i}`} pointerEvents="none">
            <circle cx={wp.x} cy={wp.y} r={JUNC_R + 3} fill="none" stroke="#f59e0b" strokeWidth={1} opacity={isHov ? 0.6 : 0.3} />
            <circle
              cx={wp.x} cy={wp.y} r={JUNC_R}
              fill={dragIdx === i ? '#fbbf24' : isHov ? '#fcd34d' : '#f59e0b'}
              stroke="#fff" strokeWidth={2}
              style={{ filter: 'drop-shadow(0 0 4px #f59e0b)' }}
            />
            {meta.memberCount > 1 && (
              <text x={wp.x} y={wp.y + 1} textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="bold" fill="#1c1917" className="select-none">
                {meta.memberCount}
              </text>
            )}
            {isHov && (
              <text x={wp.x} y={wp.y - JUNC_R - 8} textAnchor="middle" dominantBaseline="auto" fontSize="8" fill="#a1a1aa" className="select-none">Del</text>
            )}
          </g>
        );
      })}

      {/* Waypoint dot visuals — when hovered or selected */}
      {showHandles &&
        waypoints.map((wp, i) => {
          if (junctionMeta[i]?.junctionId) return null;
          const isHov = hoveredWpIdx === i;
          return (
            <g key={`wpv-${i}`} pointerEvents="none">
              <circle cx={wp.x} cy={wp.y} r={WP_R + 2} fill="none" stroke={color} strokeWidth={1} opacity={isHov ? 0.6 : 0.3} />
              <circle
                cx={wp.x} cy={wp.y} r={WP_R}
                fill={dragIdx === i ? '#f59e0b' : isHov ? '#a3e635' : color}
                stroke="#fff" strokeWidth={1.5}
                style={{ filter: `drop-shadow(0 0 3px ${color})` }}
              />
              {isHov && (
                <text x={wp.x} y={wp.y - WP_R - 6} textAnchor="middle" dominantBaseline="auto" fontSize="8" fill="#a1a1aa" className="select-none">Del</text>
              )}
            </g>
          );
        })}

      {/* Wire count label */}
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

      {/* Edge body hit area — for selection + double-click to add bend */}
      {interactiveSegments.map((segment, index) => (
        <path
          key={`hit-seg-${index}`}
          d={`M ${segment.start.x} ${segment.start.y} L ${segment.end.x} ${segment.end.y}`}
          fill="none"
          stroke="transparent"
          strokeWidth={hitStrokeWidth}
          strokeLinecap="butt"
          pointerEvents="all"
          className="cursor-pointer"
          onClick={handleHitAreaClick}
          onDoubleClick={handlePathDoubleClick}
        />
      ))}

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

      {/* Junction grab circles — on EVERY edge (not just owner) so the topmost
           edge in SVG paint order always has a grabbable target */}
      {isEditor && waypoints.map((wp, i) => {
        const meta = junctionMeta[i];
        if (!meta?.junctionId) return null;
        return (
          <circle
            key={`jcth-${i}`}
            cx={wp.x} cy={wp.y} r={HIT_R}
            fill="none" stroke="none"
            pointerEvents="all"
            className="cursor-move"
            onMouseEnter={() => setHoveredWpIdx(i)}
            onMouseLeave={() => setHoveredWpIdx(null)}
            onMouseDown={(e) => handleJunctionDragStart(e, meta.junctionId!, i)}
          />
        );
      })}

      {/* Waypoint grab circles — rendered LAST = topmost */}
      {showHandles &&
        waypoints.map((wp, i) => {
          if (junctionMeta[i]?.junctionId) return null;
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
            />
          );
        })}
    </g>
  );
}
