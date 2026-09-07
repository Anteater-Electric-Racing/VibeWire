import type { Edge, Node } from '@xyflow/react';
import type {
  ConnectorType,
  HarnessBundle,
  Wire,
  SystemData,
  SharedAnchorLayouts,
  PathNode,
  PortLayouts,
  RouteStyleLayouts,
  SelectedHarnessBundle,
  SelectedItem,
  SizeLayouts,
  SubsystemDocument,
  WaypointLayouts,
  WireRouteStyle,
} from '../../types';
import {
  deriveWires,
  getConnectorOccupancy,
  getConnectorSchematicImage,
  getBaseHarnessBundleId,
  getHarnessBundleLayoutValue,
  getPathNodeHarnessBundleKey,
  getPathNodeRefKey,
  getPathById,
  getPathSignalId,
  getPathWireAppearance,
  getPortWireAppearance,
  isBulkheadConnector,
  isGraphPinHandle,
  isPassThroughConnector,
  BUNDLE_THRU_SEP,
} from '../../lib/systemTopology';
import { nearestOnPolyline, type Point } from '../../lib/paths';
import { resolveEdgeRouteStyle } from '../../lib/routeStyle';
import {
  EXPANDED_CONNECTOR_Z_INDEX,
  GRAPH_Z_CONNECTOR,
  GRAPH_Z_ENCLOSURE,
  getConnectorTablePinCount,
  graphWireZIndex,
  resolveConnectorRenderedSize,
} from '../../lib/connectorSize';
import {
  getNearestWallSide,
  projectNodeToEnclosureWall,
  type GraphNodeSize,
  type GraphRect,
} from '../../lib/parentResize';
import {
  BULKHEAD_DOT_SIZE,
  isBulkheadDot,
} from '../../lib/bulkheadRouting';

export const SUBSYSTEM_FRAME_PREFIX = '__subframe_';
export const SUBSYSTEM_DEVICE_PREFIX = '__subdevice_';
export const SUBSYSTEM_CONNECTOR_PREFIX = '__subconnector_';
export const SHARED_ANCHOR_SNAP_RADIUS_PX = 24;

export function getAbsoluteNodeRect(nodeId: string, nodes: readonly Node[]): GraphRect | null {
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
  if (width <= 0 || height <= 0) return null;
  return { x, y, w: width, h: height };
}

export function getAbsoluteNodeCenter(nodeId: string, nodes: readonly Node[]): Point | null {
  const rect = getAbsoluteNodeRect(nodeId, nodes);
  return rect
    ? { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
    : null;
}

function segmentRectIntersections(
  from: Point,
  to: Point,
  rect: GraphRect,
): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const result: Point[] = [];
  const append = (t: number) => {
    if (t < 0 || t > 1) return;
    const point = { x: from.x + dx * t, y: from.y + dy * t };
    if (
      point.x < rect.x - 0.01
      || point.x > rect.x + rect.w + 0.01
      || point.y < rect.y - 0.01
      || point.y > rect.y + rect.h + 0.01
    ) {
      return;
    }
    if (!result.some((candidate) =>
      Math.hypot(candidate.x - point.x, candidate.y - point.y) < 0.01
    )) {
      result.push(point);
    }
  };
  if (Math.abs(dx) > 1e-9) {
    append((rect.x - from.x) / dx);
    append((rect.x + rect.w - from.x) / dx);
  }
  if (Math.abs(dy) > 1e-9) {
    append((rect.y - from.y) / dy);
    append((rect.y + rect.h - from.y) / dy);
  }
  return result;
}

/**
 * Intermediate single-wire dots are transparent to presentation geometry.
 * Their connector remains in the electrical path, while the visual node moves
 * onto the straight line between its two visible neighbors.
 */
export function positionNonAnchoringDots(
  system: SystemData,
  nodes: readonly Node[],
  resolveNodeId: (node: PathNode) => string | null,
  resolveApproachPoints?: (
    previous: PathNode,
    dot: PathNode,
    next: PathNode,
    defaults: { previous: Point; next: Point },
  ) => { previous: Point; next: Point },
): Node[] {
  const connectorById = new Map(system.connectors.map((connector) => [connector.id, connector]));
  const enclosureById = new Map(system.hierarchy.map((enclosure) => [enclosure.id, enclosure]));

  return nodes.map((dotNode) => {
    const connectorId = typeof dotNode.data?.connectorId === 'string'
      ? dotNode.data.connectorId
      : null;
    const connector = connectorId ? connectorById.get(connectorId) : undefined;
    if (!connector || !isBulkheadDot(connector) || !dotNode.parentId) return dotNode;

    const occurrences = system.paths.flatMap((path) =>
      path.nodes.flatMap((pathNode, index) =>
        pathNode.kind === 'connector' && pathNode.connector_id === connector.id
          ? [{ path, index }]
          : []
      )
    );
    if (
      occurrences.length !== 1
      || occurrences[0].index <= 0
      || occurrences[0].index >= occurrences[0].path.nodes.length - 1
    ) {
      return dotNode;
    }

    const [{ path, index }] = occurrences;
    const previousId = resolveNodeId(path.nodes[index - 1]);
    const nextId = resolveNodeId(path.nodes[index + 1]);
    if (!previousId || !nextId || previousId === nextId) return dotNode;
    let previousCenter = getAbsoluteNodeCenter(previousId, nodes);
    let nextCenter = getAbsoluteNodeCenter(nextId, nodes);
    const parentRect = getAbsoluteNodeRect(dotNode.parentId, nodes);
    const currentCenter = getAbsoluteNodeCenter(dotNode.id, nodes);
    if (!previousCenter || !nextCenter || !parentRect || !currentCenter) return dotNode;
    if (resolveApproachPoints) {
      const approaches = resolveApproachPoints(
        path.nodes[index - 1],
        path.nodes[index],
        path.nodes[index + 1],
        { previous: previousCenter, next: nextCenter },
      );
      previousCenter = approaches.previous;
      nextCenter = approaches.next;
    }

    const parent = connector.parent ? enclosureById.get(connector.parent) : undefined;
    let center: Point;
    if (parent?.kind === 'enclosure') {
      const crossings = segmentRectIntersections(previousCenter, nextCenter, parentRect);
      if (crossings.length === 0) return dotNode;
      center = crossings.reduce((nearest, candidate) =>
        Math.hypot(candidate.x - currentCenter.x, candidate.y - currentCenter.y)
          < Math.hypot(nearest.x - currentCenter.x, nearest.y - currentCenter.y)
          ? candidate
          : nearest
      );
    } else {
      center = nearestOnPolyline(currentCenter, [previousCenter, nextCenter]).nearest;
    }

    const relative = {
      x: center.x - parentRect.x - BULKHEAD_DOT_SIZE / 2,
      y: center.y - parentRect.y - BULKHEAD_DOT_SIZE / 2,
    };
    const position = parent?.kind === 'enclosure'
      ? projectNodeToEnclosureWall(
          relative,
          { w: BULKHEAD_DOT_SIZE, h: BULKHEAD_DOT_SIZE },
          { w: parentRect.w, h: parentRect.h },
        )
      : clampNodeToParentBounds(
          relative,
          { w: BULKHEAD_DOT_SIZE, h: BULKHEAD_DOT_SIZE },
          { w: parentRect.w, h: parentRect.h },
        );
    return {
      ...dotNode,
      position,
      draggable: false,
      data: {
        ...dotNode.data,
        autoPositioned: true,
        wallSide: parent?.kind === 'enclosure'
          ? getNearestWallSide(
              position,
              { w: BULKHEAD_DOT_SIZE, h: BULKHEAD_DOT_SIZE },
              { w: parentRect.w, h: parentRect.h },
            )
          : undefined,
      },
    };
  });
}

export {
  AUTO_EXPANDED_CONNECTOR_WIDTH,
  CONNECTOR_HEADER_HEIGHT,
  CONNECTOR_PIN_ROW_HEIGHT,
  EXPANDED_CONNECTOR_Z_INDEX,
  GRAPH_Z_BACKGROUND,
  GRAPH_Z_CONNECTOR,
  GRAPH_Z_ENCLOSURE,
  GRAPH_Z_IMAGE_FOREGROUND,
  GRAPH_Z_MERGE,
  GRAPH_Z_PIN_WIRE,
  GRAPH_Z_SELECTED_IMAGE,
  GRAPH_Z_SELECTED_PIN_WIRE,
  GRAPH_Z_SELECTED_WIRE,
  GRAPH_Z_TEXT,
  GRAPH_Z_WIRE,
  graphWireZIndex,
  getAutoExpandedConnectorSize,
  getConnectorTablePinCount,
  MAX_AUTO_EXPAND_PINS,
  resolveConnectorRenderedSize,
} from '../../lib/connectorSize';
export {
  getNearestWallSide,
  projectNodeToEnclosureWall,
  type WallSide,
} from '../../lib/parentResize';

/**
 * Keep a child node fully inside its parent bounds. Positions are relative to
 * the parent and use React Flow's top-left node origin.
 */
export function clampNodeToParentBounds(
  position: { x: number; y: number },
  nodeSize: GraphNodeSize,
  parentSize: GraphNodeSize,
): { x: number; y: number } {
  const maxX = Math.max(0, parentSize.w - nodeSize.w);
  const maxY = Math.max(0, parentSize.h - nodeSize.h);
  return {
    x: Math.min(maxX, Math.max(0, position.x)),
    y: Math.min(maxY, Math.max(0, position.y)),
  };
}

/** Distance threshold for treating two wall-mounted bulkheads as overlapping. */
export const BULKHEAD_MERGE_THRESHOLD_PX = 28;

type WallMountedCandidate = {
  id: string;
  parentId?: string;
  position: { x: number; y: number };
  size: GraphNodeSize;
  wallMounted?: boolean;
};

export type PassThroughCandidate = WallMountedCandidate & {
  passThrough?: boolean;
};

function rectsOverlap(
  left: { position: { x: number; y: number }; size: GraphNodeSize },
  right: { position: { x: number; y: number }; size: GraphNodeSize },
): boolean {
  return (
    left.position.x < right.position.x + right.size.w
    && left.position.x + left.size.w > right.position.x
    && left.position.y < right.position.y + right.size.h
    && left.position.y + left.size.h > right.position.y
  );
}

/**
 * Among wall-mounted peers on the same frame/wall, return the closest overlapping
 * connector id, or null when nothing is within the merge threshold.
 */
export function findOverlappingWallMountedPeer(
  dragged: WallMountedCandidate,
  candidates: readonly WallMountedCandidate[],
  enclosureSize: GraphNodeSize,
  thresholdPx = BULKHEAD_MERGE_THRESHOLD_PX,
): string | null {
  if (!dragged.wallMounted || !dragged.parentId) return null;
  const draggedPos = projectNodeToEnclosureWall(dragged.position, dragged.size, enclosureSize);
  const draggedSide = getNearestWallSide(dragged.position, dragged.size, enclosureSize);
  const draggedCenter = {
    x: draggedPos.x + dragged.size.w / 2,
    y: draggedPos.y + dragged.size.h / 2,
  };

  let bestId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (
      candidate.id === dragged.id
      || !candidate.wallMounted
      || candidate.parentId !== dragged.parentId
    ) {
      continue;
    }
    const candidateSide = getNearestWallSide(
      candidate.position,
      candidate.size,
      enclosureSize,
    );
    if (candidateSide !== draggedSide) continue;
    const candidatePos = projectNodeToEnclosureWall(
      candidate.position,
      candidate.size,
      enclosureSize,
    );
    const dx = (candidatePos.x + candidate.size.w / 2) - draggedCenter.x;
    const dy = (candidatePos.y + candidate.size.h / 2) - draggedCenter.y;
    const distance = Math.hypot(dx, dy);
    if (distance < thresholdPx && distance < bestDistance) {
      bestDistance = distance;
      bestId = candidate.id;
    }
  }
  return bestId;
}

/**
 * Closest overlapping pass-through peer that can absorb the dragged connector.
 * Wall-mounted bulkheads still have to share a wall; inline / interior connectors
 * merge when their frames actually overlap.
 */
export function findOverlappingPassThroughPeer(
  dragged: PassThroughCandidate,
  candidates: readonly PassThroughCandidate[],
  enclosureSize?: GraphNodeSize | null,
  thresholdPx = BULKHEAD_MERGE_THRESHOLD_PX,
): string | null {
  if (!dragged.passThrough) return null;
  const passThroughPeers = candidates.filter((candidate) => candidate.passThrough);
  if (dragged.wallMounted) {
    if (!dragged.parentId || !enclosureSize) return null;
    return findOverlappingWallMountedPeer(
      dragged,
      passThroughPeers,
      enclosureSize,
      thresholdPx,
    );
  }

  const draggedParent = dragged.parentId ?? null;
  let bestId: string | null = null;
  let bestArea = 0;
  for (const candidate of passThroughPeers) {
    if (
      candidate.id === dragged.id
      || candidate.wallMounted
      || (candidate.parentId ?? null) !== draggedParent
      || !rectsOverlap(dragged, candidate)
    ) {
      continue;
    }
    const overlapW = Math.min(
      dragged.position.x + dragged.size.w,
      candidate.position.x + candidate.size.w,
    ) - Math.max(dragged.position.x, candidate.position.x);
    const overlapH = Math.min(
      dragged.position.y + dragged.size.h,
      candidate.position.y + candidate.size.h,
    ) - Math.max(dragged.position.y, candidate.position.y);
    const area = overlapW * overlapH;
    if (area > bestArea) {
      bestArea = area;
      bestId = candidate.id;
    }
  }
  return bestId;
}

export type BranchPointOverlapCandidate = {
  id: string;
  branchPointId: string;
  parentId?: string;
  position: { x: number; y: number };
  size: GraphNodeSize;
};

/**
 * Closest overlapping free-floating branch point, so dragging one onto another
 * fuses them. Same-parent bounding-box overlap only — no wall projection,
 * since branch points are never wall-mounted.
 */
export function findOverlappingBranchPointPeer(
  dragged: BranchPointOverlapCandidate,
  candidates: readonly BranchPointOverlapCandidate[],
): string | null {
  const draggedParent = dragged.parentId ?? null;
  let bestId: string | null = null;
  let bestArea = 0;
  for (const candidate of candidates) {
    if (
      candidate.id === dragged.id
      || (candidate.parentId ?? null) !== draggedParent
      || !rectsOverlap(dragged, candidate)
    ) {
      continue;
    }
    const overlapW = Math.min(
      dragged.position.x + dragged.size.w,
      candidate.position.x + candidate.size.w,
    ) - Math.max(dragged.position.x, candidate.position.x);
    const overlapH = Math.min(
      dragged.position.y + dragged.size.h,
      candidate.position.y + candidate.size.h,
    ) - Math.max(dragged.position.y, candidate.position.y);
    const area = overlapW * overlapH;
    if (area > bestArea) {
      bestArea = area;
      bestId = candidate.id;
    }
  }
  return bestId;
}

type GraphWireGroup = HarnessBundle & {
  sourceHandle?: string;
  targetHandle?: string;
};

function getPinHandle(
  node: PathNode,
  expandedNodes: ReadonlySet<string>,
): string | undefined {
  return node.kind === 'connector' && expandedNodes.has(node.connector_id)
    ? `pin:${node.pin_number}`
    : undefined;
}

export function deriveGraphWireGroups(
  segments: Wire[],
  expandedNodes: ReadonlySet<string> = new Set(),
): GraphWireGroup[] {
  const thruByHop = new Map<string, Set<string>>();
  for (const segment of segments) {
    if (!segment.throughKey) continue;
    const fromRef = getPathNodeHarnessBundleKey(segment.from);
    const toRef = getPathNodeHarnessBundleKey(segment.to);
    const hopId = fromRef < toRef
      ? `bundle:${fromRef}|${toRef}`
      : `bundle:${toRef}|${fromRef}`;
    let keys = thruByHop.get(hopId);
    if (!keys) {
      keys = new Set();
      thruByHop.set(hopId, keys);
    }
    keys.add(segment.throughKey);
  }

  const groups = new Map<string, GraphWireGroup>();

  for (const segment of segments) {
    const fromRef = getPathNodeHarnessBundleKey(segment.from);
    const toRef = getPathNodeHarnessBundleKey(segment.to);
    const fromHandle = getPinHandle(segment.from, expandedNodes);
    const toHandle = getPinHandle(segment.to, expandedNodes);
    const fromEndpoint = `${fromRef}@${fromHandle ?? ''}`;
    const toEndpoint = `${toRef}@${toHandle ?? ''}`;
    const forward = fromEndpoint <= toEndpoint;
    const sourceRefKey = forward ? fromRef : toRef;
    const targetRefKey = forward ? toRef : fromRef;
    const sourceHandle = forward ? fromHandle : toHandle;
    const targetHandle = forward ? toHandle : fromHandle;
    const baseId = `bundle:${sourceRefKey}|${targetRefKey}`;
    const hopThruKeys = thruByHop.get(baseId);
    const splitThru = (hopThruKeys?.size ?? 0) > 1 && segment.throughKey
      ? segment.throughKey
      : null;
    const familyId = splitThru ? `${baseId}${BUNDLE_THRU_SEP}${splitThru}` : baseId;
    const id = sourceHandle || targetHandle
      ? `${familyId}#${sourceHandle ?? ''}|${targetHandle ?? ''}`
      : familyId;
    const existing = groups.get(id);

    if (existing) {
      existing.wireIds.push(segment.id);
      if (!existing.pathIds.includes(segment.pathId)) {
        existing.pathIds.push(segment.pathId);
      }
      continue;
    }

    groups.set(id, {
      id,
      wireIds: [segment.id],
      pathIds: [segment.pathId],
      sourceRefKey,
      targetRefKey,
      sourceHandle,
      targetHandle,
    });
  }

  return [...groups.values()];
}

export function firstBundleIdByBase(ids: Iterable<string>): Map<string, string> {
  const first = new Map<string, string>();
  for (const id of ids) {
    const base = getBaseHarnessBundleId(id);
    const prev = first.get(base);
    if (!prev || id < prev) first.set(base, id);
  }
  return first;
}

export function isSharedAnchorLayoutOwner(
  memberEdgeIds: readonly string[],
  edgeId: string,
  firstByBase: ReadonlyMap<string, string>,
): boolean {
  const base = getBaseHarnessBundleId(edgeId);
  if (firstByBase.get(base) !== edgeId) return false;
  return memberEdgeIds.some((member) => getBaseHarnessBundleId(member) === base);
}

type TopologyEdge = {
  to: string;
  segment: Wire;
};

type ProjectedConnection = {
  from: PathNode;
  to: PathNode;
  pathIds: Set<string>;
  canonicalSegmentIds: Map<string, string>;
};

/**
 * Project canonical system topology onto the connectors represented in a
 * subsystem. Hidden connectors and branch points remain part of the electrical
 * model, but are contracted so their visible neighbors still appear connected.
 */
export function deriveSubsystemSegments(
  system: SystemData,
  visibleConnectorIds: Set<string>,
): Wire[] {
  const canonicalSegments = deriveWires(system);
  const nodeByKey = new Map<string, PathNode>();
  const adjacency = new Map<string, TopologyEdge[]>();

  const addTopologyEdge = (from: PathNode, to: PathNode, segment: Wire) => {
    const fromKey = getPathNodeRefKey(from);
    const toKey = getPathNodeRefKey(to);
    nodeByKey.set(fromKey, from);
    nodeByKey.set(toKey, to);
    adjacency.set(fromKey, [...(adjacency.get(fromKey) ?? []), { to: toKey, segment }]);
  };

  for (const segment of canonicalSegments) {
    addTopologyEdge(segment.from, segment.to, segment);
    addTopologyEdge(segment.to, segment.from, segment);
  }

  const isVisible = (key: string) => {
    const node = nodeByKey.get(key);
    return node?.kind === 'connector' && visibleConnectorIds.has(node.connector_id);
  };

  const connections = new Map<string, ProjectedConnection>();
  const addConnection = (
    fromKey: string,
    toKey: string,
    route: Wire[],
    canonicalSegment?: Wire,
  ) => {
    if (fromKey === toKey) return;
    const [sourceKey, targetKey] = fromKey < toKey ? [fromKey, toKey] : [toKey, fromKey];
    const from = nodeByKey.get(sourceKey);
    const to = nodeByKey.get(targetKey);
    if (!from || !to || from.kind !== 'connector' || to.kind !== 'connector') return;

    const key = `${sourceKey}|${targetKey}`;
    const connection = connections.get(key) ?? {
      from,
      to,
      pathIds: new Set<string>(),
      canonicalSegmentIds: new Map<string, string>(),
    };
    for (const segment of route) connection.pathIds.add(segment.pathId);
    if (canonicalSegment) {
      connection.canonicalSegmentIds.set(canonicalSegment.pathId, canonicalSegment.id);
    }
    connections.set(key, connection);
  };

  for (const segment of canonicalSegments) {
    const fromKey = getPathNodeRefKey(segment.from);
    const toKey = getPathNodeRefKey(segment.to);
    if (isVisible(fromKey) && isVisible(toKey)) {
      addConnection(fromKey, toKey, [segment], segment);
    }
  }

  const visitedHiddenNodes = new Set<string>();
  for (const startKey of nodeByKey.keys()) {
    if (isVisible(startKey) || visitedHiddenNodes.has(startKey)) continue;

    const component = new Set<string>();
    const attachedVisibleKeys = new Set<string>();
    const queue = [startKey];
    visitedHiddenNodes.add(startKey);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.add(current);
      for (const edge of adjacency.get(current) ?? []) {
        if (isVisible(edge.to)) {
          attachedVisibleKeys.add(edge.to);
        } else if (!visitedHiddenNodes.has(edge.to)) {
          visitedHiddenNodes.add(edge.to);
          queue.push(edge.to);
        }
      }
    }

    const visibleKeys = [...attachedVisibleKeys].sort();
    if (visibleKeys.length < 2) continue;
    const anchorKey = visibleKeys[0];

    for (const targetKey of visibleKeys.slice(1)) {
      const routeQueue = [anchorKey];
      const visited = new Set([anchorKey]);
      const previous = new Map<string, { key: string; segment: Wire }>();

      while (routeQueue.length > 0 && !visited.has(targetKey)) {
        const current = routeQueue.shift()!;
        for (const edge of adjacency.get(current) ?? []) {
          const entersComponent = current === anchorKey && component.has(edge.to);
          const staysInComponent = component.has(current) && component.has(edge.to);
          const reachesTarget = component.has(current) && edge.to === targetKey;
          if (!entersComponent && !staysInComponent && !reachesTarget) continue;
          if (visited.has(edge.to)) continue;
          visited.add(edge.to);
          previous.set(edge.to, { key: current, segment: edge.segment });
          routeQueue.push(edge.to);
        }
      }

      if (!visited.has(targetKey)) continue;
      const route: Wire[] = [];
      let current = targetKey;
      while (current !== anchorKey) {
        const step = previous.get(current);
        if (!step) break;
        route.unshift(step.segment);
        current = step.key;
      }
      if (current === anchorKey && route.length > 0) {
        addConnection(anchorKey, targetKey, route);
      }
    }
  }

  return [...connections.entries()].flatMap(([connectionKey, connection]) =>
    [...connection.pathIds].sort().flatMap((pathId) => {
      const path = getPathById(system, pathId);
      if (!path) return [];
      return [{
        id: connection.canonicalSegmentIds.get(pathId)
          ?? `projected:${pathId}:${connectionKey}`,
        pathId,
        pathName: path.name,
        wireIndex: 0,
        from: connection.from,
        to: connection.to,
        tags: path.tags,
        properties: path.properties,
      }];
    }),
  );
}

function resolveSubsystemDeviceSize(
  layout: { w?: number; h?: number },
  systemSize?: { w: number; h: number },
): GraphNodeSize {
  return {
    w: layout.w ?? systemSize?.w ?? 220,
    h: layout.h ?? systemSize?.h ?? 180,
  };
}

/** Prefer subsystem-local geometry, then system port/size layouts, then a grid default. */
function resolveSubsystemConnectorLayout(
  connectorId: string,
  index: number,
  subsystemLayout: { x?: number; y?: number; w?: number; h?: number } | undefined,
  portLayouts: PortLayouts,
  sizeLayouts: SizeLayouts,
): { position: { x: number; y: number }; size: { w?: number; h?: number } } {
  const systemPort = portLayouts[connectorId];
  const systemSize = sizeLayouts[connectorId];
  return {
    position: {
      x: subsystemLayout?.x ?? systemPort?.x ?? 12 + (index % 2) * 100,
      y: subsystemLayout?.y ?? systemPort?.y ?? 48 + Math.floor(index / 2) * 44,
    },
    size: {
      w: subsystemLayout?.w ?? systemSize?.w,
      h: subsystemLayout?.h ?? systemSize?.h,
    },
  };
}

export function buildSubsystemGraphModel(
  system: SystemData,
  subsystem: SubsystemDocument,
  expandedNodes: ReadonlySet<string> = new Set(),
  selectedItem: SelectedItem | null = null,
  expandedSizeOverrides: Readonly<Record<string, GraphNodeSize>> = {},
  connectorTypesById: ReadonlyMap<string, ConnectorType> = new Map(),
  waypointLayouts: WaypointLayouts = {},
  sharedAnchors: SharedAnchorLayouts = {},
  selectedHarnessBundle: SelectedHarnessBundle | null = null,
  portLayouts: PortLayouts = {},
  sizeLayouts: SizeLayouts = {},
  routeStyleLayouts: RouteStyleLayouts = {},
  viewRouteStyle: WireRouteStyle = 'straight',
): { graphNodes: Node[]; graphEdges: Edge[] } {
  const nodes: Node[] = [];
  const connectorNodeIds = new Map<string, string>();
  const hiddenConnectorIds = new Set(subsystem.hidden_connectors ?? []);
  const collapseConnectors = subsystem.collapse_connectors ?? false;
  const enclosureById = new Map(system.hierarchy.map((enclosure) => [enclosure.id, enclosure]));
  const enclosureDepth = (enclosureId: string): number => {
    let depth = 0;
    let current: string | null = enclosureId;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      current = enclosureById.get(current)?.parent ?? null;
      depth += 1;
    }
    return depth;
  };
  const frameEntries = Object.entries(subsystem.enclosures)
    .map(([enclosureId, layout]) => ({
      enclosureId,
      layout,
      enclosure: enclosureById.get(enclosureId),
    }))
    .filter((entry) => entry.enclosure?.kind === 'enclosure')
    .sort((left, right) => enclosureDepth(left.enclosureId) - enclosureDepth(right.enclosureId));

  for (const { enclosureId, layout, enclosure } of frameEntries) {
    if (!enclosure) continue;
    const frameNodeId = `${SUBSYSTEM_FRAME_PREFIX}${enclosureId}`;
    const parentFrameId = enclosure.parent
      && subsystem.enclosures[enclosure.parent]
      && enclosureById.get(enclosure.parent)?.kind === 'enclosure'
      ? enclosure.parent
      : null;
    const parentFrameNodeId = parentFrameId ? `${SUBSYSTEM_FRAME_PREFIX}${parentFrameId}` : undefined;
    const frameSize = { w: layout.w ?? 520, h: layout.h ?? 360 };
    const parentLayout = parentFrameId ? subsystem.enclosures[parentFrameId] : undefined;
    const framePosition = parentLayout
      ? clampNodeToParentBounds(
        { x: layout.x, y: layout.y },
        frameSize,
        { w: parentLayout.w ?? 520, h: parentLayout.h ?? 360 },
      )
      : { x: layout.x, y: layout.y };
    const nestedChildFrameCount = frameEntries.filter((entry) =>
      entry.enclosure?.parent === enclosureId
    ).length;
    const devices = Object.entries(subsystem.devices)
      .map(([id, deviceLayout]) => ({
        entity: enclosureById.get(id),
        layout: deviceLayout,
      }))
      .filter((item) => item.entity?.kind === 'device' && item.entity.parent === enclosureId);

    nodes.push({
      id: frameNodeId,
      type: 'enclosure',
      ...(parentFrameNodeId
        ? { parentId: parentFrameNodeId, extent: 'parent' as const }
        : {}),
      position: framePosition,
      style: { width: frameSize.w, height: frameSize.h },
      zIndex: GRAPH_Z_ENCLOSURE,
      selected: selectedItem?.type === 'enclosure' && selectedItem.id === enclosureId,
      data: {
        enclosureId,
        label: enclosure.name,
        connectorCount: 0,
        pathCount: 0,
        isContainer: true,
        image: enclosure.properties?.image,
        fillColor: enclosure.properties?.color,
        childEnclosureCount: nestedChildFrameCount,
        subsystemFrame: true,
        summaryConnector: collapseConnectors,
      },
    });
    for (const { entity: device, layout: deviceLayout } of devices) {
      if (!device) continue;
      const deviceNodeId = `${SUBSYSTEM_DEVICE_PREFIX}${device.id}`;
      const connectorMode = subsystem.device_connector_mode?.[device.id] ?? 'all';
      const deviceConnectors = system.connectors.filter((connector) =>
        connector.parent === device.id &&
        !hiddenConnectorIds.has(connector.id) &&
        (connectorMode === 'all' || !!subsystem.connectors[connector.id]),
      );
      const deviceSize = resolveSubsystemDeviceSize(deviceLayout, sizeLayouts[device.id]);
      const devicePosition = clampNodeToParentBounds(
        { x: deviceLayout.x, y: deviceLayout.y },
        deviceSize,
        frameSize,
      );
      nodes.push({
        id: deviceNodeId,
        type: 'enclosure',
        parentId: frameNodeId,
        extent: 'parent',
        position: devicePosition,
        style: { width: deviceSize.w, height: deviceSize.h },
        zIndex: GRAPH_Z_ENCLOSURE,
        selected: selectedItem?.type === 'enclosure' && selectedItem.id === device.id,
        data: {
          enclosureId: device.id,
          label: device.name,
          connectorCount: system.connectors.filter((item) => item.parent === device.id).length,
          pathCount: 0,
          isContainer: false,
          image: device.properties?.image,
          fillColor: device.properties?.color,
          childEnclosureCount: 0,
          subsystemDevice: true,
          summaryConnector: collapseConnectors,
        },
      });

      deviceConnectors.forEach((connector, index) => {
        const connectorNodeId = `${SUBSYSTEM_CONNECTOR_PREFIX}${connector.id}`;
        connectorNodeIds.set(
          connector.id,
          collapseConnectors ? deviceNodeId : connectorNodeId,
        );
        if (!collapseConnectors) {
          const resolved = resolveSubsystemConnectorLayout(
            connector.id,
            index,
            subsystem.connectors[connector.id],
            portLayouts,
            sizeLayouts,
          );
          nodes.push(connectorNode(
            system,
            connector.id,
            connectorNodeId,
            deviceNodeId,
            resolved.position,
            resolved.size,
            expandedNodes.has(connector.id),
            selectedItem?.type === 'connector' && selectedItem.id === connector.id,
            expandedSizeOverrides[connector.id],
            connectorTypesById.get(connector.connector_type),
          ));
        }
      });
    }

    const deviceIds = new Set(devices.map((item) => item.entity?.id).filter(Boolean));
    for (const [connectorId, connectorLayout] of Object.entries(subsystem.connectors)) {
      const connector = system.connectors.find((item) => item.id === connectorId);
      if (!connector || hiddenConnectorIds.has(connector.id) || deviceIds.has(connector.parent ?? '')) continue;
      const parentEntity = connector.parent
        ? system.hierarchy.find((item) => item.id === connector.parent)
        : undefined;
      const connectorFrameId = parentEntity && parentEntity.kind === 'device'
        ? parentEntity.parent
        : connector.parent;
      if (connectorFrameId !== enclosureId) continue;
      const connectorNodeId = `${SUBSYSTEM_CONNECTOR_PREFIX}${connector.id}`;
      const wallMounted = isBulkheadConnector(system, connector.id);
      connectorNodeIds.set(
        connector.id,
        collapseConnectors ? frameNodeId : connectorNodeId,
      );
      if (!collapseConnectors) {
        const resolved = resolveSubsystemConnectorLayout(
          connector.id,
          0,
          connectorLayout,
          portLayouts,
          sizeLayouts,
        );
        nodes.push(connectorNode(
          system,
          connector.id,
          connectorNodeId,
          frameNodeId,
          resolved.position,
          resolved.size,
          expandedNodes.has(connector.id),
          selectedItem?.type === 'connector' && selectedItem.id === connector.id,
          expandedSizeOverrides[connector.id],
          connectorTypesById.get(connector.connector_type),
          !wallMounted,
          wallMounted ? { w: layout.w ?? 520, h: layout.h ?? 360 } : undefined,
        ));
      }
    }
  }

  const rootDevices = Object.entries(subsystem.devices)
    .map(([id, layout]) => ({ entity: system.hierarchy.find((item) => item.id === id), layout }))
    .filter((item) =>
      item.entity?.kind === 'device'
      && (
        item.entity.parent === null
        || !subsystem.enclosures[item.entity.parent]
      )
    );
  for (const { entity: device, layout } of rootDevices) {
    if (!device) continue;
    const deviceNodeId = `${SUBSYSTEM_DEVICE_PREFIX}${device.id}`;
    const connectorMode = subsystem.device_connector_mode?.[device.id] ?? 'all';
    const deviceConnectors = system.connectors.filter((connector) =>
      connector.parent === device.id &&
      !hiddenConnectorIds.has(connector.id) &&
      (connectorMode === 'all' || !!subsystem.connectors[connector.id]),
    );
    const deviceSize = resolveSubsystemDeviceSize(layout, sizeLayouts[device.id]);
    nodes.push({
      id: deviceNodeId,
      type: 'enclosure',
      position: { x: layout.x, y: layout.y },
      style: { width: deviceSize.w, height: deviceSize.h },
      zIndex: GRAPH_Z_ENCLOSURE,
      selected: selectedItem?.type === 'enclosure' && selectedItem.id === device.id,
      data: {
        enclosureId: device.id,
        label: device.name,
        connectorCount: system.connectors.filter((item) => item.parent === device.id).length,
        pathCount: 0,
        isContainer: false,
        image: device.properties?.image,
        fillColor: device.properties?.color,
        childEnclosureCount: 0,
        subsystemDevice: true,
        summaryConnector: collapseConnectors,
      },
    });
    deviceConnectors.forEach((connector, index) => {
      const connectorNodeId = `${SUBSYSTEM_CONNECTOR_PREFIX}${connector.id}`;
      connectorNodeIds.set(
        connector.id,
        collapseConnectors ? deviceNodeId : connectorNodeId,
      );
      if (!collapseConnectors) {
        const resolved = resolveSubsystemConnectorLayout(
          connector.id,
          index,
          subsystem.connectors[connector.id],
          portLayouts,
          sizeLayouts,
        );
        nodes.push(connectorNode(
          system,
          connector.id,
          connectorNodeId,
          deviceNodeId,
          resolved.position,
          resolved.size,
          expandedNodes.has(connector.id),
          selectedItem?.type === 'connector' && selectedItem.id === connector.id,
          expandedSizeOverrides[connector.id],
          connectorTypesById.get(connector.connector_type),
        ));
      }
    });
  }

  const rootDeviceIds = new Set(rootDevices.map((item) => item.entity?.id).filter(Boolean));
  for (const [connectorId, layout] of Object.entries(subsystem.connectors)) {
    if (connectorNodeIds.has(connectorId)) continue;
    const connector = system.connectors.find((item) => item.id === connectorId);
    if (!connector || hiddenConnectorIds.has(connector.id) || rootDeviceIds.has(connector.parent ?? '')) continue;
    const parentEntity = connector.parent
      ? system.hierarchy.find((item) => item.id === connector.parent)
      : undefined;
    if (connector.parent !== null && parentEntity?.parent !== null) continue;
    const connectorNodeId = `${SUBSYSTEM_CONNECTOR_PREFIX}${connector.id}`;
    connectorNodeIds.set(connector.id, connectorNodeId);
    nodes.push(connectorNode(
      system,
      connector.id,
      connectorNodeId,
      undefined,
      {
        x: layout.x,
        y: layout.y,
      },
      layout,
      expandedNodes.has(connector.id),
      selectedItem?.type === 'connector' && selectedItem.id === connector.id,
      expandedSizeOverrides[connector.id],
      connectorTypesById.get(connector.connector_type),
    ));
  }

  const positionedNodes = positionNonAnchoringDots(
    system,
    nodes,
    (pathNode) => pathNode.kind === 'connector'
      ? connectorNodeIds.get(pathNode.connector_id) ?? null
      : null,
    (previous, dot, next, defaults) => {
      const approach = (neighbor: PathNode, fallback: Point): Point => {
        const neighborKey = getPathNodeHarnessBundleKey(neighbor);
        const dotKey = getPathNodeHarnessBundleKey(dot);
        const baseBundleId = neighborKey < dotKey
          ? `bundle:${neighborKey}|${dotKey}`
          : `bundle:${dotKey}|${neighborKey}`;
        const edgeId = `subsystem:${subsystem.id}:${baseBundleId}`;
        const raw = getHarnessBundleLayoutValue(waypointLayouts, edgeId) ?? [];
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
  nodes.splice(0, nodes.length, ...positionedNodes);

  const visibleSegments = deriveSubsystemSegments(system, new Set(connectorNodeIds.keys()));
  const groups = deriveGraphWireGroups(visibleSegments, expandedNodes);
  const firstByBase = firstBundleIdByBase(
    groups.map((bundle) => `subsystem:${subsystem.id}:${bundle.id}`),
  );

  const rawEdges: Edge[] = groups.flatMap((bundle) => {
    const sourceId = bundle.sourceRefKey.split(':')[1];
    const targetId = bundle.targetRefKey.split(':')[1];
    const source = connectorNodeIds.get(sourceId);
    const target = connectorNodeIds.get(targetId);
    if (!source || !target || source === target) return [];
    const sourceNode = nodes.find((node) => node.id === source);
    const targetNode = nodes.find((node) => node.id === target);
    if (sourceNode?.parentId === target || targetNode?.parentId === source) return [];
    const hasNonAnchoringDot = sourceNode?.data.autoPositioned === true
      || targetNode?.data.autoPositioned === true;
    const appearances = bundle.pathIds.map((pathId) => {
      const path = getPathById(system, pathId);
      return path
        ? getPathWireAppearance(path, system)
        : getPathWireAppearance({ tags: [], properties: {} }, system);
    });
    const edgeId = `subsystem:${subsystem.id}:${bundle.id}`;
    const isSelected =
      (selectedHarnessBundle != null && selectedHarnessBundle.id === edgeId) ||
      (selectedItem?.type === 'path' && bundle.pathIds.includes(selectedItem.id)) ||
      (
        selectedItem?.type === 'signal' &&
        bundle.pathIds.some((pathId) => {
          const path = getPathById(system, pathId);
          return path ? getPathSignalId(path) === selectedItem.id : false;
        })
      );
    const pinAttached = isGraphPinHandle(bundle.sourceHandle)
      || isGraphPinHandle(bundle.targetHandle);
    const rawWps = getHarnessBundleLayoutValue(waypointLayouts, edgeId) ?? [];
    const resolvedWaypoints = rawWps.map((wp) => {
      if ('sharedAnchorId' in wp) {
        const sharedAnchor = sharedAnchors[wp.sharedAnchorId];
        return sharedAnchor ? { x: sharedAnchor.x, y: sharedAnchor.y } : { x: 0, y: 0 };
      }
      return { x: wp.x, y: wp.y };
    });
    const sharedAnchorMeta = rawWps.map((wp) => {
      if (!('sharedAnchorId' in wp)) return { sharedAnchorId: null, isOwner: false, memberCount: 1 };
      const sharedAnchor = sharedAnchors[wp.sharedAnchorId];
      if (!sharedAnchor) return { sharedAnchorId: null, isOwner: false, memberCount: 1 };
      const isOwner = isSharedAnchorLayoutOwner(sharedAnchor.memberEdgeIds, edgeId, firstByBase);
      return { sharedAnchorId: wp.sharedAnchorId, isOwner, memberCount: sharedAnchor.memberEdgeIds.length };
    });
    return [{
      id: edgeId,
      source,
      target,
      sourceHandle: bundle.sourceHandle,
      targetHandle: bundle.targetHandle,
      type: 'harnessBundle',
      selected: !!isSelected,
      zIndex: graphWireZIndex(!!isSelected, pinAttached),
      data: {
        pathIds: bundle.pathIds,
        pathCount: bundle.pathIds.length,
        wireAppearances: appearances,
        bundleColor: appearances[0]?.primaryColor ?? '#666',
        resolvedWaypoints,
        sharedAnchorMeta,
        sourceStub: 0,
        targetStub: 0,
        pinSource: pinAttached && isGraphPinHandle(bundle.sourceHandle),
        pinTarget: pinAttached && isGraphPinHandle(bundle.targetHandle),
        routeStyle: hasNonAnchoringDot
          ? 'straight'
          : resolveEdgeRouteStyle(edgeId, routeStyleLayouts, viewRouteStyle),
      },
    }];
  });
  const edges = !collapseConnectors
    ? rawEdges
    : (() => {
        const byEquipmentPair = new Map<string, Edge>();
        for (const edge of rawEdges) {
          const data = edge.data as {
            pathIds: string[];
            pathCount: number;
            wireAppearances: Array<{ key: string; primaryColor: string }>;
            bundleColor: string;
            resolvedWaypoints: Point[];
            sharedAnchorMeta: Array<{
              sharedAnchorId: string | null;
              isOwner: boolean;
              memberCount: number;
            }>;
          };
          const [firstNodeId, secondNodeId] = edge.source <= edge.target
            ? [edge.source, edge.target]
            : [edge.target, edge.source];
          const appearanceKey = data.wireAppearances[0]?.key ?? data.bundleColor;
          const aggregateId = `subsystem:${subsystem.id}:equipment:${firstNodeId}|${secondNodeId}|${appearanceKey}`;
          const existing = byEquipmentPair.get(aggregateId);
          if (existing) {
            const existingData = existing.data as typeof data;
            existingData.pathIds = Array.from(new Set([
              ...existingData.pathIds,
              ...data.pathIds,
            ])).sort();
            existingData.pathCount = existingData.pathIds.length;
            existingData.wireAppearances.push(...data.wireAppearances);
            existing.selected = existing.selected || edge.selected;
            continue;
          }
          const firstCenter = getAbsoluteNodeCenter(firstNodeId, nodes);
          const secondCenter = getAbsoluteNodeCenter(secondNodeId, nodes);
          const horizontal = firstCenter && secondCenter
            ? Math.abs(secondCenter.x - firstCenter.x) >= Math.abs(secondCenter.y - firstCenter.y)
            : true;
          const firstComesBeforeSecond = firstCenter && secondCenter
            ? horizontal
              ? firstCenter.x <= secondCenter.x
              : firstCenter.y <= secondCenter.y
            : true;
          const source = firstComesBeforeSecond ? firstNodeId : secondNodeId;
          const target = firstComesBeforeSecond ? secondNodeId : firstNodeId;
          const aggregateWaypoints = waypointLayouts[aggregateId] ?? [];
          const resolvedWaypoints = aggregateWaypoints.map((waypoint) => {
            if ('sharedAnchorId' in waypoint) {
              const sharedAnchor = sharedAnchors[waypoint.sharedAnchorId];
              return sharedAnchor ? { x: sharedAnchor.x, y: sharedAnchor.y } : { x: 0, y: 0 };
            }
            return { x: waypoint.x, y: waypoint.y };
          });
          const aggregateSharedAnchorMeta = aggregateWaypoints.map((waypoint) => {
            if (!('sharedAnchorId' in waypoint)) {
              return { sharedAnchorId: null, isOwner: false, memberCount: 1 };
            }
            const sharedAnchor = sharedAnchors[waypoint.sharedAnchorId];
            if (!sharedAnchor) return { sharedAnchorId: null, isOwner: false, memberCount: 1 };
            const sortedMembers = [...sharedAnchor.memberEdgeIds].sort();
            return {
              sharedAnchorId: waypoint.sharedAnchorId,
              isOwner: sortedMembers[0] === aggregateId,
              memberCount: sharedAnchor.memberEdgeIds.length,
            };
          });
          byEquipmentPair.set(aggregateId, {
            ...edge,
            id: aggregateId,
            source,
            target,
            sourceHandle: horizontal ? 'summary-right' : 'summary-bottom',
            targetHandle: horizontal ? 'summary-left' : 'summary-top',
            selected: edge.selected || selectedHarnessBundle?.id === aggregateId,
            data: {
              ...data,
              pathIds: [...data.pathIds],
              wireAppearances: [...data.wireAppearances],
              resolvedWaypoints,
              sharedAnchorMeta: aggregateSharedAnchorMeta,
              routeStyle: resolveEdgeRouteStyle(aggregateId, routeStyleLayouts, viewRouteStyle),
            },
          });
        }
        return [...byEquipmentPair.values()];
      })();

  return { graphNodes: nodes, graphEdges: edges };
}

function connectorNode(
  system: SystemData,
  connectorId: string,
  nodeId: string,
  parentId: string | undefined,
  position: { x: number; y: number },
  layout?: { w?: number; h?: number },
  expanded = false,
  selected = false,
  expandedOverride?: GraphNodeSize | null,
  connectorType?: ConnectorType | null,
  constrainToParent = true,
  wallEnclosureSize?: GraphNodeSize,
): Node {
  const connector = system.connectors.find((item) => item.id === connectorId)!;
  const occupiedPins = getConnectorOccupancy(system, connector.id);
  const width = layout?.w ?? 96;
  const height = layout?.h ?? 36;
  const pinCount = getConnectorTablePinCount(
    connector,
    connectorType,
    occupiedPins.map((pin) => pin.pinNumber),
  );
  const dot = isBulkheadDot(connector);
  const renderedSize = dot
    ? { w: BULKHEAD_DOT_SIZE, h: BULKHEAD_DOT_SIZE }
    : resolveConnectorRenderedSize(
        { w: width, h: height },
        expanded,
        pinCount,
        expandedOverride,
      );
  const wallMounted = !!parentId && !!wallEnclosureSize;
  const renderedPosition = wallEnclosureSize
    ? projectNodeToEnclosureWall(position, renderedSize, wallEnclosureSize)
    : position;
  return {
    id: nodeId,
    type: 'connector',
    ...(parentId ? {
      parentId,
      ...(constrainToParent ? { extent: 'parent' as const } : {}),
    } : {}),
    position: renderedPosition,
    style: {
      width: renderedSize.w,
      height: renderedSize.h,
    },
    zIndex: expanded && !dot ? EXPANDED_CONNECTOR_Z_INDEX : GRAPH_Z_CONNECTOR,
    selected,
    data: {
      label: connector.name,
      parentName: '',
      connectorId,
      occupiedPins,
      pinCount: occupiedPins.length,
      wireAppearance: getPortWireAppearance(system, connector),
      connectorTypeId: connector.connector_type,
      instanceImage: getConnectorSchematicImage(connector, connectorType, { bulkhead: wallMounted }) || '',
      wallMounted,
      wallSide: wallEnclosureSize
        ? getNearestWallSide(renderedPosition, renderedSize, wallEnclosureSize)
        : undefined,
      passThrough: isPassThroughConnector(system, connector),
    },
  };
}
