import type {
  EditingSurface,
  RouteStyleLayouts,
  ViewRouteStyleLayouts,
  WaypointItem,
  WireRouteStyle,
} from '../types';
import type { Point } from './paths';

export const DEFAULT_WIRE_ROUTE_STYLE: WireRouteStyle = 'straight';
export const ROUTE_GRID_SIZE = 20;
export const SYSTEM_ROUTE_VIEW_KEY = 'system';

export function isWireRouteStyle(value: unknown): value is WireRouteStyle {
  return value === 'grid' || value === 'straight';
}

export function normalizeRouteStyleMap(
  input: Record<string, unknown> | null | undefined,
): Record<string, WireRouteStyle> {
  const next: Record<string, WireRouteStyle> = {};
  if (!input) return next;
  for (const [key, value] of Object.entries(input)) {
    if (isWireRouteStyle(value)) next[key] = value;
  }
  return next;
}

export function routeViewKey(
  editingSurface: EditingSurface,
  activeSubsystemId: string | null,
): string {
  if (editingSurface === 'subsystem' && activeSubsystemId) {
    return `subsystem:${activeSubsystemId}`;
  }
  return SYSTEM_ROUTE_VIEW_KEY;
}

export function edgeBelongsToRouteView(edgeId: string, viewKey: string): boolean {
  if (viewKey === SYSTEM_ROUTE_VIEW_KEY) return !edgeId.startsWith('subsystem:');
  return edgeId.startsWith(`${viewKey}:`);
}

export function resolveEdgeRouteStyle(
  edgeId: string,
  routeStyles: RouteStyleLayouts | undefined,
  viewDefault: WireRouteStyle | undefined,
): WireRouteStyle {
  if (routeStyles) {
    const hash = edgeId.indexOf('#');
    const base = hash >= 0 ? edgeId.slice(0, hash) : edgeId;
    const styled = routeStyles[base] ?? routeStyles[edgeId];
    if (styled) return styled;
  }
  return viewDefault ?? DEFAULT_WIRE_ROUTE_STYLE;
}

export function viewRouteWiresAllMatch(
  style: WireRouteStyle,
  routeStyles: RouteStyleLayouts,
  viewRouteStyles: ViewRouteStyleLayouts,
  viewKey: string,
): boolean {
  const viewDefault = viewRouteStyles[viewKey] ?? DEFAULT_WIRE_ROUTE_STYLE;
  if (viewDefault !== style) return false;
  for (const [edgeId, value] of Object.entries(routeStyles)) {
    if (edgeBelongsToRouteView(edgeId, viewKey) && value !== style) return false;
  }
  return true;
}

export function snapToRouteGrid(point: Point, grid = ROUTE_GRID_SIZE): Point {
  return {
    x: Math.round(point.x / grid) * grid,
    y: Math.round(point.y / grid) * grid,
  };
}

function nearlyEqual(a: number, b: number, epsilon = 0.5): boolean {
  return Math.abs(a - b) < epsilon;
}

function samePoint(a: Point, b: Point): boolean {
  return nearlyEqual(a.x, b.x) && nearlyEqual(a.y, b.y);
}

function pushUnique(points: Point[], point: Point) {
  const last = points[points.length - 1];
  if (!last || !samePoint(last, point)) points.push(point);
}

/** Single right-angle corner between two points. */
function lVias(a: Point, b: Point): Point[] {
  if (nearlyEqual(a.x, b.x) || nearlyEqual(a.y, b.y)) return [];
  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
    return [{ x: b.x, y: a.y }];
  }
  return [{ x: a.x, y: b.y }];
}

/** Lucidchart-style Z through the midpoint (HVH or VHV). */
function zVias(a: Point, b: Point): Point[] {
  if (nearlyEqual(a.x, b.x) || nearlyEqual(a.y, b.y)) return [];
  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
    const midX = (a.x + b.x) / 2;
    return [{ x: midX, y: a.y }, { x: midX, y: b.y }];
  }
  const midY = (a.y + b.y) / 2;
  return [{ x: a.x, y: midY }, { x: b.x, y: midY }];
}

function expandHop(a: Point, b: Point, vias: Point[]): Point[] {
  const points: Point[] = [];
  pushUnique(points, a);
  for (const via of vias) pushUnique(points, via);
  pushUnique(points, b);
  return points;
}

/**
 * Orthogonalize a polyline into horizontal/vertical segments.
 * A lone hop uses a Lucidchart Z; hops through user waypoints use L-corners
 * so the user-placed points stay the only extra anchors.
 */
export function orthogonalizePolyline(points: Point[]): Point[] {
  if (points.length < 2) return points;
  const hops = points.length === 2 ? zVias : lVias;
  const result: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    for (const point of expandHop(points[i], points[i + 1], hops(points[i], points[i + 1]))) {
      pushUnique(result, point);
    }
  }
  return result;
}

export function routedPolyline(points: Point[], style: WireRouteStyle): Point[] {
  return style === 'grid' ? orthogonalizePolyline(points) : points;
}

/**
 * Map a click on the displayed (possibly orthogonal) path back to the
 * user-waypoint insert index.
 */
export function findRoutePointInsertIndex(
  flowPos: Point,
  source: Point,
  userWaypoints: Point[],
  target: Point,
  style: WireRouteStyle,
  nearestOnPolyline: (
    point: Point,
    polyline: Point[],
  ) => { dist: number; segIndex: number },
): number {
  const logical = [source, ...userWaypoints, target];
  if (logical.length < 2) return 0;
  if (style !== 'grid') {
    const { segIndex } = nearestOnPolyline(flowPos, logical);
    return Math.max(0, Math.min(userWaypoints.length, segIndex));
  }
  let bestDist = Infinity;
  let bestInsert = 0;
  for (let i = 0; i < logical.length - 1; i++) {
    const hop = orthogonalizePolyline([logical[i], logical[i + 1]]);
    const { dist } = nearestOnPolyline(flowPos, hop);
    if (dist < bestDist) {
      bestDist = dist;
      bestInsert = i;
    }
  }
  return bestInsert;
}

export type GridPointOrigin =
  | { type: 'end' }
  | { type: 'sharedAnchor'; sharedAnchorId: string }
  | { type: 'plain' }
  | { type: 'generated' };

export type GridPathNode = {
  point: Point;
  origin: GridPointOrigin;
};

export function routePointsEqual(a: Point, b: Point): boolean {
  return samePoint(a, b);
}

export function gridSegmentAxis(a: Point, b: Point): 'h' | 'v' | null {
  if (nearlyEqual(a.y, b.y)) return 'h';
  if (nearlyEqual(a.x, b.x)) return 'v';
  return null;
}

function cloneGridPath(nodes: GridPathNode[]): GridPathNode[] {
  return nodes.map((node) => ({
    point: { x: node.point.x, y: node.point.y },
    origin: { ...node.origin },
  }));
}

/**
 * Tag displayed orthogonal points with the stored waypoints/shared anchors they
 * came from so a later drag can round-trip generated vias into waypoints.
 */
export function buildGridPath(
  displayed: Point[],
  resolvedWaypoints: Point[],
  sharedAnchorMeta: ReadonlyArray<{ sharedAnchorId: string | null }>,
): GridPathNode[] {
  const nodes: GridPathNode[] = displayed.map((point, index) => ({
    point: { x: point.x, y: point.y },
    origin:
      index === 0 || index === displayed.length - 1
        ? { type: 'end' }
        : { type: 'generated' },
  }));
  const used = new Set<number>();
  for (let waypointIndex = 0; waypointIndex < resolvedWaypoints.length; waypointIndex++) {
    const waypoint = resolvedWaypoints[waypointIndex];
    for (let index = 1; index < nodes.length - 1; index++) {
      if (used.has(index) || !samePoint(nodes[index].point, waypoint)) continue;
      const sharedAnchorId = sharedAnchorMeta[waypointIndex]?.sharedAnchorId;
      nodes[index] = {
        point: nodes[index].point,
        origin: sharedAnchorId
          ? { type: 'sharedAnchor', sharedAnchorId }
          : { type: 'plain' },
      };
      used.add(index);
      break;
    }
  }
  return nodes;
}

/**
 * Drop consecutive duplicates and collinear intermediates (except shared anchors).
 * Segment/vertex drags should call this so stub inserts do not stack.
 */
export function simplifyGridPath(nodes: GridPathNode[]): GridPathNode[] {
  if (nodes.length < 3) return nodes;
  const deduped: GridPathNode[] = [];
  for (const node of nodes) {
    const last = deduped[deduped.length - 1];
    if (last && samePoint(last.point, node.point)) {
      if (node.origin.type === 'sharedAnchor' && last.origin.type !== 'sharedAnchor') {
        deduped[deduped.length - 1] = node;
      }
      continue;
    }
    deduped.push(node);
  }
  if (deduped.length < 3) return deduped;

  const result: GridPathNode[] = [deduped[0]];
  for (let index = 1; index < deduped.length - 1; index++) {
    const prev = result[result.length - 1].point;
    const curr = deduped[index];
    const nextPoint = deduped[index + 1].point;
    const axisIn = gridSegmentAxis(prev, curr.point);
    const axisOut = gridSegmentAxis(curr.point, nextPoint);
    const collinear = axisIn !== null && axisIn === axisOut;
    if (curr.origin.type === 'sharedAnchor' || !collinear) result.push(curr);
  }
  result.push(deduped[deduped.length - 1]);
  return result;
}

function polylinesEqual(a: Point[], b: Point[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((point, index) => samePoint(point, b[index]));
}

export function waypointsFromGridPath(nodes: GridPathNode[]): WaypointItem[] {
  const simplified = simplifyGridPath(nodes);
  if (simplified.length < 2) return [];
  const source = simplified[0].point;
  const target = simplified[simplified.length - 1].point;
  const mids = simplified.slice(1, -1);
  const hasSharedAnchor = mids.some((node) => node.origin.type === 'sharedAnchor');
  if (!hasSharedAnchor && polylinesEqual(
    simplified.map((node) => node.point),
    orthogonalizePolyline([source, target]),
  )) {
    return [];
  }

  const waypoints: WaypointItem[] = [];
  for (const node of mids) {
    if (node.origin.type === 'sharedAnchor') {
      waypoints.push({ sharedAnchorId: node.origin.sharedAnchorId });
    } else {
      waypoints.push({ x: node.point.x, y: node.point.y });
    }
  }
  return waypoints;
}

/** Drop collinear / default-Z pins so only shared anchors and real turns remain. */
export function pruneUnusedGridWaypoints(
  source: Point,
  resolvedWaypoints: Point[],
  target: Point,
  sharedAnchorMeta: ReadonlyArray<{ sharedAnchorId: string | null }>,
): WaypointItem[] {
  const displayed = orthogonalizePolyline([source, ...resolvedWaypoints, target]);
  return waypointsFromGridPath(buildGridPath(displayed, resolvedWaypoints, sharedAnchorMeta));
}

const GENERATED_ORIGIN: GridPointOrigin = { type: 'generated' };

function hopLength(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Connector-adjacent hops shorter than this are treated as stubs, not stacked. */
const STUB_MAX_LENGTH = 48;

function hasOrthoStubAtStart(nodes: GridPathNode[]): boolean {
  if (nodes.length < 3) return false;
  const first = gridSegmentAxis(nodes[0].point, nodes[1].point);
  const second = gridSegmentAxis(nodes[1].point, nodes[2].point);
  if (first == null || second == null || first === second) return false;
  const len = hopLength(nodes[0].point, nodes[1].point);
  const nextLen = hopLength(nodes[1].point, nodes[2].point);
  return len <= STUB_MAX_LENGTH || len < nextLen * 0.35;
}

function hasOrthoStubAtEnd(nodes: GridPathNode[]): boolean {
  if (nodes.length < 3) return false;
  const last = nodes.length - 1;
  const tail = gridSegmentAxis(nodes[last - 1].point, nodes[last].point);
  const prev = gridSegmentAxis(nodes[last - 2].point, nodes[last - 1].point);
  if (tail == null || prev == null || tail === prev) return false;
  const len = hopLength(nodes[last - 1].point, nodes[last].point);
  const prevLen = hopLength(nodes[last - 2].point, nodes[last - 1].point);
  return len <= STUB_MAX_LENGTH || len < prevLen * 0.35;
}

function offsetGridSegmentInner(
  nodes: GridPathNode[],
  segIndex: number,
  pointer: Point,
  redirected: boolean,
): GridPathNode[] {
  if (segIndex < 0 || segIndex >= nodes.length - 1) return nodes;
  const axis = gridSegmentAxis(nodes[segIndex].point, nodes[segIndex + 1].point);
  if (!axis) return nodes;

  const startFixed = segIndex === 0;
  const endFixed = segIndex === nodes.length - 2;
  if (!redirected && startFixed && !endFixed && hasOrthoStubAtStart(nodes)) {
    return offsetGridSegmentInner(nodes, 1, pointer, true);
  }
  if (!redirected && endFixed && !startFixed && hasOrthoStubAtEnd(nodes)) {
    return offsetGridSegmentInner(nodes, segIndex - 1, pointer, true);
  }

  const snapped = snapToRouteGrid(pointer);
  const start = nodes[segIndex].point;
  const end = nodes[segIndex + 1].point;
  const next = cloneGridPath(nodes);

  if (axis === 'h') {
    const y = snapped.y;
    if (nearlyEqual(start.y, y) && nearlyEqual(end.y, y)) return nodes;
    if (startFixed && endFixed) {
      return simplifyGridPath([
        next[0],
        { point: { x: start.x, y }, origin: GENERATED_ORIGIN },
        { point: { x: end.x, y }, origin: GENERATED_ORIGIN },
        ...next.slice(1),
      ]);
    }
    if (startFixed) {
      next[segIndex + 1].point.y = y;
      next.splice(segIndex + 1, 0, { point: { x: start.x, y }, origin: GENERATED_ORIGIN });
      return simplifyGridPath(next);
    }
    if (endFixed) {
      next[segIndex].point.y = y;
      next.splice(segIndex + 1, 0, { point: { x: end.x, y }, origin: GENERATED_ORIGIN });
      return simplifyGridPath(next);
    }
    next[segIndex].point.y = y;
    next[segIndex + 1].point.y = y;
    return simplifyGridPath(next);
  }

  const x = snapped.x;
  if (nearlyEqual(start.x, x) && nearlyEqual(end.x, x)) return nodes;
  if (startFixed && endFixed) {
    return simplifyGridPath([
      next[0],
      { point: { x, y: start.y }, origin: GENERATED_ORIGIN },
      { point: { x, y: end.y }, origin: GENERATED_ORIGIN },
      ...next.slice(1),
    ]);
  }
  if (startFixed) {
    next[segIndex + 1].point.x = x;
    next.splice(segIndex + 1, 0, { point: { x, y: start.y }, origin: GENERATED_ORIGIN });
    return simplifyGridPath(next);
  }
  if (endFixed) {
    next[segIndex].point.x = x;
    next.splice(segIndex + 1, 0, { point: { x, y: end.y }, origin: GENERATED_ORIGIN });
    return simplifyGridPath(next);
  }
  next[segIndex].point.x = x;
  next[segIndex + 1].point.x = x;
  return simplifyGridPath(next);
}

/**
 * Lucidchart-style segment drag: horizontal segments move vertically,
 * vertical segments move horizontally. Connector/end points stay put —
 * a stub is inserted instead of moving them. Existing stubs are not stacked;
 * dragging one redirects onto the following run.
 */
export function offsetGridSegment(
  nodes: GridPathNode[],
  segIndex: number,
  pointer: Point,
): GridPathNode[] {
  return offsetGridSegmentInner(nodes, segIndex, pointer, false);
}

/**
 * Drag an orthogonal vertex. Adjacent H/V neighbors keep their axis;
 * a stub is inserted when the neighbor is a fixed connector/end.
 */
export function offsetGridVertex(
  nodes: GridPathNode[],
  index: number,
  pointer: Point,
): GridPathNode[] {
  if (index <= 0 || index >= nodes.length - 1) return nodes;
  let snapped = snapToRouteGrid(pointer);
  const isFirst = index === 1;
  const isLast = index === nodes.length - 2;
  if (isFirst && isLast) {
    const source = nodes[0].point;
    const target = nodes[nodes.length - 1].point;
    const origin = nodes[index].origin.type === 'end'
      ? GENERATED_ORIGIN
      : nodes[index].origin;
    return simplifyGridPath([
      nodes[0],
      ...lVias(source, snapped).map((point) => ({ point, origin: GENERATED_ORIGIN })),
      { point: { x: snapped.x, y: snapped.y }, origin },
      ...lVias(snapped, target).map((point) => ({ point, origin: GENERATED_ORIGIN })),
      nodes[nodes.length - 1],
    ]);
  }
  if (isFirst) {
    const stubAxis = gridSegmentAxis(nodes[0].point, nodes[1].point);
    if (stubAxis === 'v') snapped = { x: nodes[0].point.x, y: snapped.y };
    else if (stubAxis === 'h') snapped = { x: snapped.x, y: nodes[0].point.y };
  }
  if (isLast) {
    const last = nodes[nodes.length - 1].point;
    const stubAxis = gridSegmentAxis(nodes[index].point, last);
    if (stubAxis === 'v') snapped = { x: last.x, y: snapped.y };
    else if (stubAxis === 'h') snapped = { x: snapped.x, y: last.y };
  }
  const prev = nodes[index - 1].point;
  const curr = nodes[index].point;
  const nextPoint = nodes[index + 1].point;
  if (samePoint(curr, snapped)) return nodes;

  const prevAxis = gridSegmentAxis(prev, curr);
  const nextAxis = gridSegmentAxis(curr, nextPoint);
  const next = cloneGridPath(nodes);
  next[index].point = { x: snapped.x, y: snapped.y };

  if (index + 1 === next.length - 1) {
    const target = next[next.length - 1].point;
    if (nextAxis === 'h' && !nearlyEqual(target.y, snapped.y)) {
      next.splice(next.length - 1, 0, {
        point: { x: target.x, y: snapped.y },
        origin: GENERATED_ORIGIN,
      });
    } else if (nextAxis === 'v' && !nearlyEqual(target.x, snapped.x)) {
      next.splice(next.length - 1, 0, {
        point: { x: snapped.x, y: target.y },
        origin: GENERATED_ORIGIN,
      });
    }
  } else if (nextAxis === 'h') {
    next[index + 1].point.y = snapped.y;
  } else if (nextAxis === 'v') {
    next[index + 1].point.x = snapped.x;
  }

  if (index - 1 === 0) {
    if (prevAxis === 'h' && !nearlyEqual(prev.y, snapped.y)) {
      next.splice(1, 0, {
        point: { x: prev.x, y: snapped.y },
        origin: GENERATED_ORIGIN,
      });
    } else if (prevAxis === 'v' && !nearlyEqual(prev.x, snapped.x)) {
      next.splice(1, 0, {
        point: { x: snapped.x, y: prev.y },
        origin: GENERATED_ORIGIN,
      });
    }
  } else if (prevAxis === 'h') {
    next[index - 1].point.y = snapped.y;
  } else if (prevAxis === 'v') {
    next[index - 1].point.x = snapped.x;
  }

  return simplifyGridPath(next);
}

export function confirmApplyViewRouteStyle(args: {
  style: WireRouteStyle;
  viewKind: 'system' | 'subsystem';
  viewName?: string;
}): boolean {
  const styleLabel = args.style === 'grid'
    ? 'grid (Lucidchart-style orthogonal)'
    : 'straight-shot';
  const viewLabel = args.viewKind === 'subsystem'
    ? `the “${args.viewName || 'subsystem'}” subsystem view`
    : 'this system view';
  return window.confirm([
    `Apply ${styleLabel} routing to every wire in ${viewLabel}?`,
    '',
    args.viewKind === 'subsystem'
      ? 'This changes how all Harness Bundles in the currently open subsystem diagram are drawn.'
      : 'This changes how all Harness Bundles in the currently open system diagram are drawn.',
    'Individual Harness Bundles can still be switched back afterwards.',
  ].join('\n'));
}
