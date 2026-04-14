import type {
  Connector,
  ConnectorOccupancy,
  DerivedBundle,
  DerivedSegment,
  Enclosure,
  HarnessData,
  MergePoint,
  Path,
  PathNode,
} from '../types';
import { getWireAppearance, type WireAppearance } from './colors';

/**
 * Walk up the parent chain to find the nearest enclosure ancestor of a
 * connector.  Returns null when the connector sits in the root space.
 */
export function getConnectorEnclosure(
  harness: HarnessData,
  conId: string,
): string | null {
  const con = harness.connectors.find((c) => c.id === conId);
  if (!con) return null;
  return con.parent;
}

/**
 * Direct child enclosures of a given space.
 * `parentId === null` means the root space.
 */
export function getChildEnclosures(
  harness: HarnessData,
  parentId: string | null,
): Enclosure[] {
  return harness.enclosures.filter((e) => e.parent === parentId);
}

/**
 * Connectors that should appear as port tabs on a given enclosure when
 * viewed from the parent space.  This is any connector whose parent is
 * this enclosure, OR whose parent is a non-container child of this
 * enclosure (i.e. connectors on a "PCB" surface are surfaced as ports
 * on the PCB enclosure node).
 */
export function getEnclosurePorts(
  harness: HarnessData,
  encId: string,
): Connector[] {
  return harness.connectors.filter((c) => c.parent === encId);
}

/**
 * All connectors reachable inside an enclosure — direct children plus
 * connectors on non-container child enclosures.
 */
export function getEnclosureConnectors(
  harness: HarnessData,
  encId: string,
): Connector[] {
  const childEncIds = new Set(
    harness.enclosures
      .filter((e) => e.parent === encId)
      .map((e) => e.id),
  );
  return harness.connectors.filter((c) => {
    if (c.parent === encId) return true;
    return c.parent !== null && childEncIds.has(c.parent);
  });
}

/**
 * Free-floating connectors within a space — connectors whose parent IS
 * the current space (null for root).
 */
export function getSpaceFreeConnectors(
  harness: HarnessData,
  spaceId: string | null,
): Connector[] {
  return harness.connectors.filter((c) => c.parent === spaceId);
}

export function getEnclosureMergePoints(
  harness: HarnessData,
  encId: string,
): MergePoint[] {
  return harness.mergePoints.filter((mergePoint) => mergePoint.parent === encId);
}

export function getSpaceFreeMergePoints(
  harness: HarnessData,
  spaceId: string | null,
): MergePoint[] {
  return harness.mergePoints.filter((mergePoint) => mergePoint.parent === spaceId);
}

export function getPathSignalName(path: Pick<Path, 'tags'>): string | null {
  return path.tags.find((tag) => tag.startsWith('signal:'))?.slice(7) ?? null;
}

export function getPathNodeRefKey(node: PathNode): string {
  if (node.kind === 'connector') {
    return `connector:${node.connector_id}:${node.pin_number}`;
  }
  return `merge:${node.merge_point_id}`;
}

export function getPathNodeLabel(
  harness: HarnessData,
  node: PathNode,
): string {
  if (node.kind === 'connector') {
    const connector = harness.connectors.find((candidate) => candidate.id === node.connector_id);
    return connector ? `${connector.name}-${node.pin_number}` : `${node.connector_id}-${node.pin_number}`;
  }
  const mergePoint = harness.mergePoints.find((candidate) => candidate.id === node.merge_point_id);
  return mergePoint?.name ?? node.merge_point_id;
}

export function deriveSegments(harness: HarnessData): DerivedSegment[] {
  const segments: DerivedSegment[] = [];
  for (const path of harness.paths) {
    for (let segmentIndex = 0; segmentIndex < path.nodes.length - 1; segmentIndex++) {
      const from = path.nodes[segmentIndex];
      const to = path.nodes[segmentIndex + 1];
      segments.push({
        id: `${path.id}::${segmentIndex}`,
        pathId: path.id,
        pathName: path.name,
        segmentIndex,
        from,
        to,
        tags: path.tags,
        properties: path.properties,
      });
    }
  }
  return segments;
}

export function getConnectorOccupancy(
  harness: HarnessData,
  connectorId: string,
): ConnectorOccupancy[] {
  const occupancy: ConnectorOccupancy[] = [];
  for (const path of harness.paths) {
    const signalName = getPathSignalName(path);
    for (const node of path.nodes) {
      if (node.kind !== 'connector' || node.connector_id !== connectorId) continue;
      occupancy.push({
        pinNumber: node.pin_number,
        pathId: path.id,
        pathName: path.name,
        signalName,
        tags: path.tags,
      });
    }
  }
  occupancy.sort((a, b) => a.pinNumber - b.pinNumber || a.pathId.localeCompare(b.pathId));
  return occupancy;
}

export function getPortWireAppearance(
  harness: HarnessData,
  con: Connector,
): WireAppearance | null {
  const appearances = getConnectorOccupancy(harness, con.id).map((entry) => {
    const path = harness.paths.find((candidate) => candidate.id === entry.pathId);
    return path ? getWireAppearance(path) : getWireAppearance({ tags: [], properties: {} });
  });
  if (appearances.length === 0) return null;

  const first = appearances[0];
  const allMatch = appearances.every((appearance) => appearance.key === first.key);
  return allMatch ? first : null;
}

function getPathNodeBundleKey(node: PathNode): string {
  if (node.kind === 'connector') {
    return `connector:${node.connector_id}`;
  }
  return `merge:${node.merge_point_id}`;
}

export function getBundleIdForSegment(segment: DerivedSegment): string {
  const fromKey = getPathNodeBundleKey(segment.from);
  const toKey = getPathNodeBundleKey(segment.to);
  return fromKey < toKey
    ? `bundle:${fromKey}|${toKey}`
    : `bundle:${toKey}|${fromKey}`;
}

export function deriveBundles(segments: DerivedSegment[]): DerivedBundle[] {
  const byBundle = new Map<string, DerivedBundle>();
  for (const segment of segments) {
    const id = getBundleIdForSegment(segment);
    const from = getPathNodeBundleKey(segment.from);
    const to = getPathNodeBundleKey(segment.to);
    const sourceRefKey = from < to ? from : to;
    const targetRefKey = from < to ? to : from;
    const existing = byBundle.get(id);
    if (existing) {
      existing.segmentIds.push(segment.id);
      if (!existing.pathIds.includes(segment.pathId)) {
        existing.pathIds.push(segment.pathId);
      }
      continue;
    }
    byBundle.set(id, {
      id,
      segmentIds: [segment.id],
      pathIds: [segment.pathId],
      sourceRefKey,
      targetRefKey,
    });
  }
  return [...byBundle.values()];
}

function getVisibleConnectorIds(
  harness: HarnessData,
  spaceId: string | null,
): Set<string> {
  const childEncIds = new Set(
    harness.enclosures
      .filter((e) => e.parent === spaceId)
      .map((e) => e.id),
  );
  const visible = new Set<string>();
  for (const connector of harness.connectors) {
    if (connector.parent === spaceId) {
      visible.add(connector.id);
      continue;
    }
    if (connector.parent !== null && childEncIds.has(connector.parent)) {
      visible.add(connector.id);
    }
  }
  return visible;
}

function getVisibleMergePointIds(
  harness: HarnessData,
  spaceId: string | null,
): Set<string> {
  const childEncIds = new Set(
    harness.enclosures
      .filter((e) => e.parent === spaceId)
      .map((e) => e.id),
  );
  const visible = new Set<string>();
  for (const mergePoint of harness.mergePoints) {
    if (mergePoint.parent === spaceId) {
      visible.add(mergePoint.id);
      continue;
    }
    if (mergePoint.parent !== null && childEncIds.has(mergePoint.parent)) {
      visible.add(mergePoint.id);
    }
  }
  return visible;
}

export function isPathNodeVisible(
  harness: HarnessData,
  node: PathNode,
  spaceId: string | null,
): boolean {
  if (node.kind === 'connector') {
    return getVisibleConnectorIds(harness, spaceId).has(node.connector_id);
  }
  return getVisibleMergePointIds(harness, spaceId).has(node.merge_point_id);
}

export function getVisibleSegments(
  harness: HarnessData,
  spaceId: string | null,
): DerivedSegment[] {
  const visibleConnectorIds = getVisibleConnectorIds(harness, spaceId);
  const visibleMergePointIds = getVisibleMergePointIds(harness, spaceId);
  return deriveSegments(harness).filter((segment) => {
    const fromVisible = segment.from.kind === 'connector'
      ? visibleConnectorIds.has(segment.from.connector_id)
      : visibleMergePointIds.has(segment.from.merge_point_id);
    const toVisible = segment.to.kind === 'connector'
      ? visibleConnectorIds.has(segment.to.connector_id)
      : visibleMergePointIds.has(segment.to.merge_point_id);
    return fromVisible && toVisible;
  });
}

export function countPathsTouchingConnectors(
  harness: HarnessData,
  connectorIds: Iterable<string>,
): number {
  const connectorIdSet = new Set(connectorIds);
  let count = 0;
  for (const path of harness.paths) {
    if (path.nodes.some((node) => node.kind === 'connector' && connectorIdSet.has(node.connector_id))) {
      count++;
    }
  }
  return count;
}

export function getPathById(
  harness: HarnessData,
  pathId: string,
): Path | undefined {
  return harness.paths.find((path) => path.id === pathId);
}
