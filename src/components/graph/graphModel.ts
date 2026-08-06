import type { Edge, Node } from '@xyflow/react';
import type {
  ConnectorType,
  DerivedBundle,
  DerivedSegment,
  HarnessData,
  JunctionLayouts,
  PathNode,
  PortLayouts,
  SelectedBundle,
  SelectedItem,
  SizeLayouts,
  SubsystemDocument,
  WaypointLayouts,
} from '../../types';
import {
  deriveSegments,
  getConnectorOccupancy,
  getConnectorSchematicImage,
  getPathNodeBundleKey,
  getPathNodeRefKey,
  getPathById,
  getPathSignalId,
  getPathWireAppearance,
  getPortWireAppearance,
} from '../../lib/harness';
import type { Point } from '../../lib/paths';
import {
  EXPANDED_CONNECTOR_Z_INDEX,
  GRAPH_Z_CONNECTOR,
  GRAPH_Z_ENCLOSURE,
  GRAPH_Z_SELECTED_WIRE,
  GRAPH_Z_WIRE,
  getConnectorTablePinCount,
  resolveConnectorRenderedSize,
} from '../../lib/connectorSize';
import {
  getNearestWallSide,
  projectNodeToEnclosureWall,
  type GraphNodeSize,
} from '../../lib/parentResize';

export const SUBSYSTEM_FRAME_PREFIX = '__subframe_';
export const SUBSYSTEM_DEVICE_PREFIX = '__subdevice_';
export const SUBSYSTEM_CONNECTOR_PREFIX = '__subconnector_';
export const JUNCTION_SNAP_RADIUS_PX = 24;

export function getAbsoluteNodeCenter(nodeId: string, nodes: readonly Node[]): Point | null {
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

export {
  AUTO_EXPANDED_CONNECTOR_WIDTH,
  CONNECTOR_HEADER_HEIGHT,
  CONNECTOR_PIN_ROW_HEIGHT,
  EXPANDED_CONNECTOR_Z_INDEX,
  GRAPH_Z_BACKGROUND,
  GRAPH_Z_CONNECTOR,
  GRAPH_Z_ENCLOSURE,
  GRAPH_Z_MERGE,
  GRAPH_Z_SELECTED_WIRE,
  GRAPH_Z_TEXT,
  GRAPH_Z_WIRE,
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

type GraphWireGroup = DerivedBundle & {
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
  segments: DerivedSegment[],
  expandedNodes: ReadonlySet<string> = new Set(),
): GraphWireGroup[] {
  const groups = new Map<string, GraphWireGroup>();

  for (const segment of segments) {
    const fromRef = getPathNodeBundleKey(segment.from);
    const toRef = getPathNodeBundleKey(segment.to);
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
    const id = sourceHandle || targetHandle
      ? `${baseId}#${sourceHandle ?? ''}|${targetHandle ?? ''}`
      : baseId;
    const existing = groups.get(id);

    if (existing) {
      existing.segmentIds.push(segment.id);
      if (!existing.pathIds.includes(segment.pathId)) {
        existing.pathIds.push(segment.pathId);
      }
      continue;
    }

    groups.set(id, {
      id,
      segmentIds: [segment.id],
      pathIds: [segment.pathId],
      sourceRefKey,
      targetRefKey,
      sourceHandle,
      targetHandle,
    });
  }

  return [...groups.values()];
}

type TopologyEdge = {
  to: string;
  segment: DerivedSegment;
};

type ProjectedConnection = {
  from: PathNode;
  to: PathNode;
  pathIds: Set<string>;
  canonicalSegmentIds: Map<string, string>;
};

/**
 * Project canonical harness topology onto the connectors represented in a
 * subsystem. Hidden connectors and merge points remain part of the electrical
 * model, but are contracted so their visible neighbors still appear connected.
 */
export function deriveSubsystemSegments(
  harness: HarnessData,
  visibleConnectorIds: Set<string>,
): DerivedSegment[] {
  const canonicalSegments = deriveSegments(harness);
  const nodeByKey = new Map<string, PathNode>();
  const adjacency = new Map<string, TopologyEdge[]>();

  const addTopologyEdge = (from: PathNode, to: PathNode, segment: DerivedSegment) => {
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
    route: DerivedSegment[],
    canonicalSegment?: DerivedSegment,
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
      const previous = new Map<string, { key: string; segment: DerivedSegment }>();

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
      const route: DerivedSegment[] = [];
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
      const path = getPathById(harness, pathId);
      if (!path) return [];
      return [{
        id: connection.canonicalSegmentIds.get(pathId)
          ?? `projected:${pathId}:${connectionKey}`,
        pathId,
        pathName: path.name,
        segmentIndex: 0,
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
  harness: HarnessData,
  subsystem: SubsystemDocument,
  expandedNodes: ReadonlySet<string> = new Set(),
  selectedItem: SelectedItem | null = null,
  expandedSizeOverrides: Readonly<Record<string, GraphNodeSize>> = {},
  connectorTypesById: ReadonlyMap<string, ConnectorType> = new Map(),
  waypointLayouts: WaypointLayouts = {},
  junctionLayouts: JunctionLayouts = {},
  selectedBundle: SelectedBundle | null = null,
  portLayouts: PortLayouts = {},
  sizeLayouts: SizeLayouts = {},
): { graphNodes: Node[]; graphEdges: Edge[] } {
  const nodes: Node[] = [];
  const connectorNodeIds = new Map<string, string>();
  const hiddenConnectorIds = new Set(subsystem.hidden_connectors ?? []);

  for (const [enclosureId, layout] of Object.entries(subsystem.enclosures)) {
    const enclosure = harness.enclosures.find((item) => item.id === enclosureId);
    if (!enclosure?.container) continue;
    const frameNodeId = `${SUBSYSTEM_FRAME_PREFIX}${enclosureId}`;
    const devices = Object.entries(subsystem.devices)
      .map(([id, deviceLayout]) => ({
        entity: harness.enclosures.find((item) => item.id === id),
        layout: deviceLayout,
      }))
      .filter((item) => item.entity?.container === false && item.entity.parent === enclosureId);

    nodes.push({
      id: frameNodeId,
      type: 'enclosure',
      position: { x: layout.x, y: layout.y },
      style: { width: layout.w ?? 520, height: layout.h ?? 360 },
      zIndex: GRAPH_Z_ENCLOSURE,
      selected: selectedItem?.type === 'enclosure' && selectedItem.id === enclosureId,
      data: {
        enclosureId,
        label: enclosure.name,
        tags: enclosure.tags,
        connectorCount: 0,
        pathCount: 0,
        isContainer: true,
        image: enclosure.properties?.image,
        childEnclosureCount: 0,
        subsystemFrame: true,
      },
    });

    const frameSize = { w: layout.w ?? 520, h: layout.h ?? 360 };
    for (const { entity: device, layout: deviceLayout } of devices) {
      if (!device) continue;
      const deviceNodeId = `${SUBSYSTEM_DEVICE_PREFIX}${device.id}`;
      const connectorMode = subsystem.device_connector_mode?.[device.id] ?? 'all';
      const deviceConnectors = harness.connectors.filter((connector) =>
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
          tags: device.tags,
          connectorCount: harness.connectors.filter((item) => item.parent === device.id).length,
          pathCount: 0,
          isContainer: false,
          image: device.properties?.image,
          childEnclosureCount: 0,
          subsystemDevice: true,
        },
      });

      deviceConnectors.forEach((connector, index) => {
        const connectorNodeId = `${SUBSYSTEM_CONNECTOR_PREFIX}${connector.id}`;
        connectorNodeIds.set(connector.id, connectorNodeId);
        const resolved = resolveSubsystemConnectorLayout(
          connector.id,
          index,
          subsystem.connectors[connector.id],
          portLayouts,
          sizeLayouts,
        );
        nodes.push(connectorNode(
          harness,
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
      });
    }

    const deviceIds = new Set(devices.map((item) => item.entity?.id).filter(Boolean));
    for (const [connectorId, connectorLayout] of Object.entries(subsystem.connectors)) {
      const connector = harness.connectors.find((item) => item.id === connectorId);
      if (!connector || hiddenConnectorIds.has(connector.id) || deviceIds.has(connector.parent ?? '')) continue;
      const parentEntity = connector.parent
        ? harness.enclosures.find((item) => item.id === connector.parent)
        : undefined;
      const connectorFrameId = parentEntity && !parentEntity.container
        ? parentEntity.parent
        : connector.parent;
      if (connectorFrameId !== enclosureId) continue;
      const connectorNodeId = `${SUBSYSTEM_CONNECTOR_PREFIX}${connector.id}`;
      const wallMounted = parentEntity?.container === true;
      connectorNodeIds.set(connector.id, connectorNodeId);
      const resolved = resolveSubsystemConnectorLayout(
        connector.id,
        0,
        connectorLayout,
        portLayouts,
        sizeLayouts,
      );
      nodes.push(connectorNode(
        harness,
        connector.id,
        connectorNodeId,
        frameNodeId,
        resolved.position,
        resolved.size,
        expandedNodes.has(connector.id),
        selectedItem?.type === 'connector' && selectedItem.id === connector.id,
        expandedSizeOverrides[connector.id],
        connectorTypesById.get(connector.connector_type),
        false,
        wallMounted ? { w: layout.w ?? 520, h: layout.h ?? 360 } : undefined,
      ));
    }
  }

  const rootDevices = Object.entries(subsystem.devices)
    .map(([id, layout]) => ({ entity: harness.enclosures.find((item) => item.id === id), layout }))
    .filter((item) => item.entity?.container === false && item.entity.parent === null);
  for (const { entity: device, layout } of rootDevices) {
    if (!device) continue;
    const deviceNodeId = `${SUBSYSTEM_DEVICE_PREFIX}${device.id}`;
    const connectorMode = subsystem.device_connector_mode?.[device.id] ?? 'all';
    const deviceConnectors = harness.connectors.filter((connector) =>
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
        tags: device.tags,
        connectorCount: harness.connectors.filter((item) => item.parent === device.id).length,
        pathCount: 0,
        isContainer: false,
        image: device.properties?.image,
        childEnclosureCount: 0,
        subsystemDevice: true,
      },
    });
    deviceConnectors.forEach((connector, index) => {
      const connectorNodeId = `${SUBSYSTEM_CONNECTOR_PREFIX}${connector.id}`;
      connectorNodeIds.set(connector.id, connectorNodeId);
      const resolved = resolveSubsystemConnectorLayout(
        connector.id,
        index,
        subsystem.connectors[connector.id],
        portLayouts,
        sizeLayouts,
      );
      nodes.push(connectorNode(
        harness,
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
    });
  }

  const rootDeviceIds = new Set(rootDevices.map((item) => item.entity?.id).filter(Boolean));
  for (const [connectorId, layout] of Object.entries(subsystem.connectors)) {
    if (connectorNodeIds.has(connectorId)) continue;
    const connector = harness.connectors.find((item) => item.id === connectorId);
    if (!connector || hiddenConnectorIds.has(connector.id) || rootDeviceIds.has(connector.parent ?? '')) continue;
    const parentEntity = connector.parent
      ? harness.enclosures.find((item) => item.id === connector.parent)
      : undefined;
    if (connector.parent !== null && parentEntity?.parent !== null) continue;
    const connectorNodeId = `${SUBSYSTEM_CONNECTOR_PREFIX}${connector.id}`;
    connectorNodeIds.set(connector.id, connectorNodeId);
    nodes.push(connectorNode(
      harness,
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

  const visibleSegments = deriveSubsystemSegments(harness, new Set(connectorNodeIds.keys()));

  const edges: Edge[] = deriveGraphWireGroups(visibleSegments, expandedNodes).flatMap((bundle) => {
    const sourceId = bundle.sourceRefKey.split(':')[1];
    const targetId = bundle.targetRefKey.split(':')[1];
    const source = connectorNodeIds.get(sourceId);
    const target = connectorNodeIds.get(targetId);
    if (!source || !target) return [];
    const appearances = bundle.pathIds.map((pathId) => {
      const path = getPathById(harness, pathId);
      return path
        ? getPathWireAppearance(path, harness)
        : getPathWireAppearance({ tags: [], properties: {} }, harness);
    });
    const edgeId = `subsystem:${subsystem.id}:${bundle.id}`;
    const isSelected =
      (selectedBundle != null && selectedBundle.id === edgeId) ||
      (selectedItem?.type === 'path' && bundle.pathIds.includes(selectedItem.id)) ||
      (
        selectedItem?.type === 'signal' &&
        bundle.pathIds.some((pathId) => {
          const path = getPathById(harness, pathId);
          return path ? getPathSignalId(path) === selectedItem.id : false;
        })
      );
    const rawWps = waypointLayouts[edgeId] ?? [];
    const resolvedWaypoints = rawWps.map((wp) => {
      if ('junctionId' in wp) {
        const junction = junctionLayouts[wp.junctionId];
        return junction ? { x: junction.x, y: junction.y } : { x: 0, y: 0 };
      }
      return { x: wp.x, y: wp.y };
    });
    const junctionMeta = rawWps.map((wp) => {
      if (!('junctionId' in wp)) return { junctionId: null, isOwner: false, memberCount: 1 };
      const junction = junctionLayouts[wp.junctionId];
      if (!junction) return { junctionId: null, isOwner: false, memberCount: 1 };
      const sortedMembers = [...junction.memberEdgeIds].sort();
      const isOwner = sortedMembers[0] === edgeId;
      return { junctionId: wp.junctionId, isOwner, memberCount: junction.memberEdgeIds.length };
    });
    return [{
      id: edgeId,
      source,
      target,
      sourceHandle: bundle.sourceHandle,
      targetHandle: bundle.targetHandle,
      type: 'bundle',
      selected: !!isSelected,
      zIndex: isSelected ? GRAPH_Z_SELECTED_WIRE : GRAPH_Z_WIRE,
      data: {
        pathIds: bundle.pathIds,
        pathCount: bundle.pathIds.length,
        wireAppearances: appearances,
        bundleColor: appearances[0]?.primaryColor ?? '#666',
        resolvedWaypoints,
        junctionMeta,
        sourceStub: 0,
        targetStub: 0,
      },
    }];
  });

  return { graphNodes: nodes, graphEdges: edges };
}

function connectorNode(
  harness: HarnessData,
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
  const connector = harness.connectors.find((item) => item.id === connectorId)!;
  const occupiedPins = getConnectorOccupancy(harness, connector.id);
  const width = layout?.w ?? 96;
  const height = layout?.h ?? 36;
  const pinCount = getConnectorTablePinCount(
    connector,
    connectorType,
    occupiedPins.map((pin) => pin.pinNumber),
  );
  const renderedSize = resolveConnectorRenderedSize(
    { w: width, h: height },
    expanded,
    pinCount,
    expandedOverride,
  );
  const wallMounted = !!parentId && !!wallEnclosureSize;
  return {
    id: nodeId,
    type: 'connector',
    ...(parentId ? {
      parentId,
      ...(constrainToParent ? { extent: 'parent' as const } : {}),
    } : {}),
    position: wallEnclosureSize
      ? projectNodeToEnclosureWall(position, renderedSize, wallEnclosureSize)
      : position,
    style: {
      width: renderedSize.w,
      height: renderedSize.h,
    },
    zIndex: expanded ? EXPANDED_CONNECTOR_Z_INDEX : GRAPH_Z_CONNECTOR,
    selected,
    data: {
      label: connector.name,
      parentName: '',
      connectorId,
      occupiedPins,
      pinCount: occupiedPins.length,
      wireAppearance: getPortWireAppearance(harness, connector),
      connectorTypeId: connector.connector_type,
      instanceImage: getConnectorSchematicImage(connector, connectorType, { bulkhead: wallMounted }) || '',
      wallMounted,
    },
  };
}
