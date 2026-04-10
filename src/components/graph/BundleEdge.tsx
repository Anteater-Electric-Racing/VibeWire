import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  type Edge,
  type EdgeProps,
  useReactFlow,
} from '@xyflow/react';
import { useHarnessStore } from '../../store';
import { linePath, nearestOnPolyline, type Point } from '../../lib/paths';
import {
  getWireAppearance,
  getWireStrokeLayers,
  type WireAppearance,
} from '../../lib/colors';
import type { WaypointItem } from '../../types';

type BundleEdgeData = {
  wireIds: string[];
  wireCount: number;
  wireAppearances: WireAppearance[];
  bundleColor: string;
  matchesFilter: boolean;
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

function offsetPolyline(points: Point[], offset: number): string {
  if (points.length < 2) return '';
  if (Math.abs(offset) < 0.01) return linePath(points);
  const result: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    let nx: number, ny: number;
    if (i === 0) {
      const dx = points[1].x - points[0].x;
      const dy = points[1].y - points[0].y;
      const len = Math.hypot(dx, dy) || 1;
      nx = -dy / len;
      ny = dx / len;
    } else if (i === points.length - 1) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      const len = Math.hypot(dx, dy) || 1;
      nx = -dy / len;
      ny = dx / len;
    } else {
      const dx1 = points[i].x - points[i - 1].x;
      const dy1 = points[i].y - points[i - 1].y;
      const len1 = Math.hypot(dx1, dy1) || 1;
      const dx2 = points[i + 1].x - points[i].x;
      const dy2 = points[i + 1].y - points[i].y;
      const len2 = Math.hypot(dx2, dy2) || 1;
      nx = (-dy1 / len1 + -dy2 / len2) / 2;
      ny = (dx1 / len1 + dx2 / len2) / 2;
      const nlen = Math.hypot(nx, ny);
      if (nlen < 0.001) {
        nx = -dy1 / len1;
        ny = dx1 / len1;
      } else {
        nx /= nlen;
        ny /= nlen;
      }
    }
    result.push({ x: points[i].x + nx * offset, y: points[i].y + ny * offset });
  }
  return linePath(result);
}

export function BundleEdge(props: EdgeProps<BundleEdgeType>) {
  const { id, sourceX, sourceY, targetX, targetY, data, selected } = props;

  const { screenToFlowPosition } = useReactFlow();
  const setSelectedBundle = useHarnessStore((s) => s.setSelectedBundle);
  const setEdgeWaypoints = useHarnessStore((s) => s.setEdgeWaypoints);
  const moveJunction = useHarnessStore((s) => s.moveJunction);
  const unlinkEdgeFromJunction = useHarnessStore((s) => s.unlinkEdgeFromJunction);
  const deleteJunction = useHarnessStore((s) => s.deleteJunction);
  const draggingEdgeInfo = useHarnessStore((s) => s.draggingEdgeInfo);
  const setDraggingEdgeInfo = useHarnessStore((s) => s.setDraggingEdgeInfo);
  const pushUndoSnapshot = useHarnessStore((s) => s.pushUndoSnapshot);
  const rawWaypoints = useHarnessStore((s) => s.waypointLayouts[id] ?? EMPTY_WAYPOINTS);

  const [hovered, setHovered] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<Point | null>(null);
  const [hoveredWpIdx, setHoveredWpIdx] = useState<number | null>(null);

  const dragPosRef = useRef<Point | null>(null);
  const rawWaypointsRef = useRef<WaypointItem[]>([]);

  const wireCount = data?.wireCount ?? 1;
  const color = data?.bundleColor ?? '#666';
  const matchesFilter = data?.matchesFilter ?? true;
  const resolvedWaypoints = useMemo(
    () => data?.resolvedWaypoints ?? [],
    [data?.resolvedWaypoints],
  );
  const junctionMeta = useMemo(
    () => data?.junctionMeta ?? [],
    [data?.junctionMeta],
  );

  const waypoints = resolvedWaypoints.map((wp, i) =>
    i === dragIdx && dragPos ? dragPos : wp,
  );

  const source = useMemo<Point>(() => ({ x: sourceX, y: sourceY }), [sourceX, sourceY]);
  const target = useMemo<Point>(() => ({ x: targetX, y: targetY }), [targetX, targetY]);
  const allPoints = [source, ...waypoints, target];
  const edgePath = linePath(allPoints);

  const wireAppearances = data?.wireAppearances ?? Array(wireCount).fill(FALLBACK_WIRE_APPEARANCE);
  const rawTotalW = wireCount * DEFAULT_WIRE_W + Math.max(0, wireCount - 1) * WIRE_GAP;
  const wireScale = rawTotalW > MAX_BUNDLE_W ? MAX_BUNDLE_W / rawTotalW : 1;
  const wireW = Math.max(MIN_WIRE_W, DEFAULT_WIRE_W * wireScale);
  const wireGap = WIRE_GAP * wireScale;
  const wireStep = wireW + wireGap;
  const bundleW = wireCount <= 1 ? wireW : (wireCount - 1) * wireStep + wireW;
  const strokeWidth = bundleW + 4;

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
    if (hoveredWpIdx === null) return;
    const idx = hoveredWpIdx;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      e.preventDefault();
      e.stopPropagation();
      pushUndoSnapshot();

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
      setHoveredWpIdx(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hoveredWpIdx, junctionMeta, pushUndoSnapshot, deleteJunction, unlinkEdgeFromJunction, id, commitWaypoints]);

  // Click: select the edge
  const handleHitAreaClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selected && data?.wireIds) setSelectedBundle(data.wireIds);
    },
    [selected, data?.wireIds, setSelectedBundle],
  );

  // Double-click edge body: insert a bend point (only if not over a handle)
  const handlePathDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!selected) return;
      e.stopPropagation();
      e.preventDefault();
      pushUndoSnapshot();
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const idx = findInsertIndex(flowPos);
      const newWps = [...rawWaypointsRef.current];
      newWps.splice(idx, 0, { x: flowPos.x, y: flowPos.y });
      commitWaypoints(newWps);
    },
    [selected, screenToFlowPosition, findInsertIndex, commitWaypoints, pushUndoSnapshot],
  );

  // Drag an existing regular waypoint
  const handleWaypointDragStart = useCallback(
    (e: React.MouseEvent, resolvedIndex: number) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      pushUndoSnapshot();

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

        if (dragPosRef.current) {
          const newWps = [...rawWaypointsRef.current];
          newWps[resolvedIndex] = { x: dragPosRef.current.x, y: dragPosRef.current.y };
          commitWaypoints(newWps);
        }

        setDragIdx(null);
        setDragPos(null);
        dragPosRef.current = null;
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [resolvedWaypoints, screenToFlowPosition, commitWaypoints, id,
      setDraggingEdgeInfo, pushUndoSnapshot],
  );

  // Drag a junction
  const handleJunctionDragStart = useCallback(
    (e: React.MouseEvent, junctionId: string, resolvedIndex: number) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      pushUndoSnapshot();

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
        if (dragPosRef.current) {
          moveJunction(junctionId, dragPosRef.current);
        }
        setDragIdx(null);
        setDragPos(null);
        dragPosRef.current = null;
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [resolvedWaypoints, screenToFlowPosition, moveJunction, pushUndoSnapshot],
  );

  // Proximity detection for junction auto-merge
  const isNearbyDrag = (() => {
    if (!draggingEdgeInfo || draggingEdgeInfo.edgeId === id) return false;
    const dp = draggingEdgeInfo.position;
    const { dist } = nearestOnPolyline(dp, allPoints);
    return dist < 50;
  })();

  const showHandles = selected || hovered;

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

  return (
    <g
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
        const wp = wireCount <= 1 ? edgePath : offsetPolyline(allPoints, wo);
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
                opacity={(layer.opacity ?? 1) * (matchesFilter ? 1 : 0.15)}
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
              {wireCount} wire{wireCount !== 1 ? 's' : ''}
            </span>
          </div>
        </foreignObject>
      ) : (
        <foreignObject x={labelPos.x - 16} y={labelPos.y - 8} width={32} height={16} pointerEvents="none" className="overflow-visible">
          <div className="flex items-center justify-center h-full">
            <span className="text-[7px] bg-zinc-900/50 text-zinc-600 px-0.5 rounded whitespace-nowrap">{wireCount}w</span>
          </div>
        </foreignObject>
      )}

      {/* ── Layer 2: all interactive hit targets (on top of everything) ── */}

      {/* Edge body hit area — for selection + double-click to add bend */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(20, strokeWidth + 14)}
        pointerEvents="all"
        className="cursor-pointer"
        onClick={handleHitAreaClick}
        onDoubleClick={handlePathDoubleClick}
      />

      {/* Junction grab circles — on EVERY edge (not just owner) so the topmost
           edge in SVG paint order always has a grabbable target */}
      {waypoints.map((wp, i) => {
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
