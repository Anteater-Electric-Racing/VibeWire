import type {
  Connector,
  ConnectorOccupancy,
  ConnectorPathNode,
  DerivedBundle,
  DerivedSegment,
  Enclosure,
  HarnessData,
  MergePoint,
  Path,
  PathNode,
  SelectedItem,
} from '../types';
import { getWireAppearance, type WireAppearance } from './colors';
import {
  applyConnectorPinCount,
  getEffectivePinCount,
  normalizeConnectorKeying,
} from './connectorFamily';
export {
  applyConnectorPinCount,
  formatConnectorOccupancySummary,
  GENERIC_MULTIPIN_TYPE_ID,
  getConnectorCavityVariant,
  getConnectorFamilyCode,
  getConnectorPinGuideImage,
  getConnectorSideImage,
  getConnectorSupportedKeyings,
  getConnectorSupportedPinCounts,
  getConnectorTypeCavityFloor,
  getEffectivePinCount,
  getNextConnectorPinCount,
  getPreviousConnectorPinCount,
  isConnectorFamily,
  normalizeConnectorKeying,
  resolveConnectorFamilyPinCount,
} from './connectorFamily';

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

export function getPathSignalId(path: Pick<Path, 'signal_id' | 'tags'>): string | null {
  if (path.signal_id) return path.signal_id;
  const slug = path.tags.find((tag) => tag.startsWith('signal:'))?.slice(7);
  return slug ? `sig_${slug}` : null;
}

export function getPathSignalName(
  path: Pick<Path, 'signal_id' | 'tags'>,
  harness?: Pick<HarnessData, 'signals'>,
): string | null {
  const signalId = getPathSignalId(path);
  if (!signalId) return null;
  return harness?.signals.find((signal) => signal.id === signalId)?.name
    ?? signalId.replace(/^sig_/, '');
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

export function getPathSegmentMeasurement(path: Path, segmentIndex: number) {
  const from = path.nodes[segmentIndex];
  const to = path.nodes[segmentIndex + 1];
  if (!from || !to) return undefined;
  const fromKey = getPathNodeRefKey(from);
  const toKey = getPathNodeRefKey(to);
  return path.measurements.find((measurement) => {
    const measurementFromKey = getPathNodeRefKey(measurement.from);
    const measurementToKey = getPathNodeRefKey(measurement.to);
    return (
      (measurementFromKey === fromKey && measurementToKey === toKey) ||
      (measurementFromKey === toKey && measurementToKey === fromKey)
    );
  });
}

export interface ConnectorPairSegment {
  path: Path;
  segmentIndex: number;
  from: ConnectorPathNode;
  to: ConnectorPathNode;
}

export function getConnectorPairSegments(
  harness: HarnessData,
  connectorIdA: string,
  connectorIdB: string,
): ConnectorPairSegment[] {
  const matches: ConnectorPairSegment[] = [];
  for (const path of harness.paths) {
    for (let segmentIndex = 0; segmentIndex < path.nodes.length - 1; segmentIndex++) {
      const from = path.nodes[segmentIndex];
      const to = path.nodes[segmentIndex + 1];
      if (from.kind !== 'connector' || to.kind !== 'connector') continue;
      const matchesPair =
        (from.connector_id === connectorIdA && to.connector_id === connectorIdB) ||
        (from.connector_id === connectorIdB && to.connector_id === connectorIdA);
      if (matchesPair) matches.push({ path, segmentIndex, from, to });
    }
  }
  return matches;
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

/** Valid cavity index for occupancy math; missing/invalid pins count as cavity 1. */
export function normalizeOccupiedPinNumber(pinNumber: unknown): number {
  return Number.isInteger(pinNumber) && (pinNumber as number) > 0
    ? (pinNumber as number)
    : 1;
}

export function getConnectorOccupancy(
  harness: HarnessData,
  connectorId: string,
): ConnectorOccupancy[] {
  const occupancy: ConnectorOccupancy[] = [];
  for (const path of harness.paths) {
    const signalName = getPathSignalName(path, harness);
    for (const node of path.nodes) {
      if (node.kind !== 'connector' || node.connector_id !== connectorId) continue;
      occupancy.push({
        // Legacy ring-terminal / placeholder nodes may omit pin_number; treat as cavity 1
        // so Math.max(...pinNumbers) never collapses to NaN.
        pinNumber: normalizeOccupiedPinNumber(node.pin_number),
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

export function getPathNodeBundleKey(node: PathNode): string {
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

/**
 * Resolve the hierarchy sheet that can render an entity reference. Keep the
 * current sheet when it already contains the target; otherwise prefer the
 * sheet where the target has a concrete node or edge.
 */
export function getEntityRevealContext(
  harness: HarnessData,
  item: SelectedItem,
  currentSpaceId: string | null,
): string | null {
  if (item.type === 'enclosure') {
    const enclosure = harness.enclosures.find((candidate) => candidate.id === item.id);
    if (!enclosure) return currentSpaceId;
    return enclosure.parent === currentSpaceId ? currentSpaceId : enclosure.parent;
  }

  if (item.type === 'connector') {
    const connector = harness.connectors.find((candidate) => candidate.id === item.id);
    if (!connector) return currentSpaceId;
    const owner = connector.parent
      ? harness.enclosures.find((candidate) => candidate.id === connector.parent)
      : undefined;
    const visibleFromOwner = connector.parent === currentSpaceId;
    const visibleOnParentSheet = owner?.parent === currentSpaceId;
    if (visibleFromOwner || visibleOnParentSheet) return currentSpaceId;
    return owner ? owner.parent : connector.parent;
  }

  if (item.type === 'mergePoint') {
    const mergePoint = harness.mergePoints.find((candidate) => candidate.id === item.id);
    if (!mergePoint) return currentSpaceId;
    return mergePoint.parent === currentSpaceId ? currentSpaceId : mergePoint.parent;
  }

  const matchingPathIds = item.type === 'path'
    ? new Set([item.id])
    : new Set(
        harness.paths
          .filter((path) => getPathSignalId(path) === item.id)
          .map((path) => path.id),
      );
  if (matchingPathIds.size === 0) return currentSpaceId;

  const sheetContainsTarget = (spaceId: string | null) =>
    getVisibleSegments(harness, spaceId).some((segment) => matchingPathIds.has(segment.pathId));
  if (sheetContainsTarget(currentSpaceId)) return currentSpaceId;

  const contexts: Array<string | null> = [
    null,
    ...harness.enclosures.map((enclosure) => enclosure.id),
  ];
  return contexts.find(sheetContainsTarget) ?? currentSpaceId;
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

/**
 * Pick the next unused `mp_NNN` id by scanning existing merge points for the
 * highest numeric suffix.  Non-numeric or legacy ids are ignored.
 */
export function nextMergePointId(harness: HarnessData): string {
  let max = 0;
  for (const mp of harness.mergePoints) {
    const match = /^mp_(\d+)$/.exec(mp.id);
    if (!match) continue;
    const num = Number(match[1]);
    if (Number.isFinite(num) && num > max) max = num;
  }
  return `mp_${String(max + 1).padStart(3, '0')}`;
}

/**
 * Graph wire groups may append `#handle|handle` when connectors are pin-expanded.
 * Segment lookups use the base endpoint-pair id only.
 */
export function getBaseBundleId(bundleId: string): string {
  const hash = bundleId.indexOf('#');
  return hash >= 0 ? bundleId.slice(0, hash) : bundleId;
}

/**
 * Inverse of `getBundleIdForSegment`.  Returns the two endpoint ref keys, or
 * null when the id does not match the current bundle format.
 */
export function parseBundleId(
  bundleId: string,
): { sourceRefKey: string; targetRefKey: string } | null {
  const baseId = getBaseBundleId(bundleId);
  if (!baseId.startsWith('bundle:')) return null;
  const body = baseId.slice('bundle:'.length);
  const pipe = body.indexOf('|');
  if (pipe < 0) return null;
  const a = body.slice(0, pipe);
  const b = body.slice(pipe + 1);
  if (!a || !b) return null;
  return { sourceRefKey: a, targetRefKey: b };
}

export interface BundleSegment {
  path: Path;
  segmentIndex: number;
  from: PathNode;
  to: PathNode;
}

/** Segments that make up a graph bundle (one hop per path, often connector↔splice). */
export function getBundleSegments(
  harness: HarnessData,
  bundleId: string,
  pathIds?: Iterable<string>,
): BundleSegment[] {
  const pathIdSet = pathIds ? new Set(pathIds) : null;
  const matches: BundleSegment[] = [];
  for (const path of harness.paths) {
    if (pathIdSet && !pathIdSet.has(path.id)) continue;
    const match = findPathSegmentForBundle(path, bundleId);
    if (!match) continue;
    const from = path.nodes[match.index];
    const to = path.nodes[match.index + 1];
    if (!from || !to) continue;
    matches.push({ path, segmentIndex: match.index, from, to });
  }
  return matches;
}

/**
 * Find the segment (consecutive node pair) in `path` whose bundle id matches
 * `bundleId`.  `reversed` indicates the path traverses the segment from the
 * bundle's target key toward its source key.  Returns null when the path does
 * not cross this bundle.
 */
export function findPathSegmentForBundle(
  path: Path,
  bundleId: string,
): { index: number; reversed: boolean } | null {
  const parsed = parseBundleId(bundleId);
  if (!parsed) return null;
  for (let index = 0; index < path.nodes.length - 1; index++) {
    const from = path.nodes[index];
    const to = path.nodes[index + 1];
    const fromKey = getPathNodeBundleKey(from);
    const toKey = getPathNodeBundleKey(to);
    const sorted = fromKey < toKey ? { source: fromKey, target: toKey } : { source: toKey, target: fromKey };
    if (sorted.source === parsed.sourceRefKey && sorted.target === parsed.targetRefKey) {
      return { index, reversed: fromKey !== parsed.sourceRefKey };
    }
  }
  return null;
}

/**
 * Insert a merge-point node into a path's node list inside the segment that
 * matches `bundleId`.  Because promoting a junction always splits its bundle
 * into sub-bundles (so no two coupled merges ever coexist on the same
 * segment), we always insert directly between the two endpoint nodes.
 * Returns a new Path with updated `nodes[]`; the original is not mutated.
 */
export function splicePathWithMerge(
  path: Path,
  bundleId: string,
  mergePointId: string,
): Path {
  const match = findPathSegmentForBundle(path, bundleId);
  if (!match) return path;
  const nextNodes = [...path.nodes];
  nextNodes.splice(match.index + 1, 0, { kind: 'merge', merge_point_id: mergePointId });
  return { ...path, nodes: nextNodes };
}

/**
 * Remove every reference to `mergePointId` from a path's node list.  Returns a
 * new Path even when nothing changed, to keep call sites simple.
 */
export function removeMergeFromPath(path: Path, mergePointId: string): Path {
  const filtered = path.nodes.filter(
    (node) => !(node.kind === 'merge' && node.merge_point_id === mergePointId),
  );
  if (filtered.length === path.nodes.length) return path;
  const measurements = path.measurements.filter(
    (measurement) =>
      !(
        (measurement.from.kind === 'merge' && measurement.from.merge_point_id === mergePointId) ||
        (measurement.to.kind === 'merge' && measurement.to.merge_point_id === mergePointId)
      ),
  );
  return { ...path, nodes: filtered, measurements };
}

/**
 * Delete a splice and reconnect whatever was on either side, as if the splice
 * never existed:
 * - Through-paths (`A → splice → B`) become `A → B`.
 * - Exactly two stub paths that only meet at the splice are stitched into one
 *   continuous path.
 * - Unpairable stubs (0 or 3+ one-sided remnants) are dropped.
 * - Measurements that referenced the splice are removed.
 */
export function dissolveMergePoint(harness: HarnessData, mergePointId: string): HarnessData {
  if (!harness.mergePoints.some((mergePoint) => mergePoint.id === mergePointId)) {
    return harness;
  }

  type Stub = { path: Path; nodes: PathNode[]; mergeAtStart: boolean };
  const stubs: Stub[] = [];
  const nextPaths: Path[] = [];

  for (const path of harness.paths) {
    const mergeIndexes: number[] = [];
    for (let index = 0; index < path.nodes.length; index += 1) {
      const node = path.nodes[index];
      if (node.kind === 'merge' && node.merge_point_id === mergePointId) {
        mergeIndexes.push(index);
      }
    }
    if (mergeIndexes.length === 0) {
      nextPaths.push(path);
      continue;
    }

    const stripped = removeMergeFromPath(path, mergePointId);
    if (stripped.nodes.length >= 2) {
      nextPaths.push(stripped);
      continue;
    }
    if (stripped.nodes.length >= 1 && mergeIndexes.length === 1) {
      stubs.push({
        path: stripped,
        nodes: stripped.nodes,
        mergeAtStart: mergeIndexes[0] === 0,
      });
    }
  }

  if (stubs.length === 2) {
    const [leftStub, rightStub] = stubs;
    const left = leftStub.mergeAtStart ? [...leftStub.nodes].reverse() : [...leftStub.nodes];
    const right = rightStub.mergeAtStart ? [...rightStub.nodes] : [...rightStub.nodes].reverse();
    nextPaths.push({
      ...leftStub.path,
      signal_id: leftStub.path.signal_id ?? rightStub.path.signal_id,
      tags: [...new Set([...leftStub.path.tags, ...rightStub.path.tags])],
      nodes: [...left, ...right],
      measurements: [...leftStub.path.measurements, ...rightStub.path.measurements],
    });
  }

  return {
    ...harness,
    mergePoints: harness.mergePoints.filter((mergePoint) => mergePoint.id !== mergePointId),
    paths: nextPaths,
  };
}

export function renumberConnectorPins(
  harness: HarnessData,
  connectorId: string,
  orderedOldPinNumbers: number[],
): HarnessData {
  const mapping = new Map(orderedOldPinNumbers.map((oldPin, index) => [oldPin, index + 1]));
  if (mapping.size !== orderedOldPinNumbers.length) {
    throw new Error('Cavity order must contain each physical cavity exactly once');
  }
  const next = structuredClone(harness);
  const remap = (node: PathNode) => {
    if (node.kind === 'connector' && node.connector_id === connectorId) {
      const newPin = mapping.get(node.pin_number);
      if (newPin !== undefined) node.pin_number = newPin;
    }
  };
  for (const wirePath of next.paths) {
    wirePath.nodes.forEach(remap);
    wirePath.measurements.forEach((measurement) => {
      remap(measurement.from);
      remap(measurement.to);
    });
  }
  return next;
}

export type MergeConnectorsOptions = {
  /** Catalog type for the surviving (target) connector; used to grow capacity. */
  targetType?: Parameters<typeof applyConnectorPinCount>[1];
};

/**
 * Absorb `sourceId` into `targetId`: remap every path/measurement cavity on the
 * source onto free cavities on the target, grow the target's pin_count as needed,
 * then delete the source connector. Both connectors must share a parent.
 */
export function mergeConnectors(
  harness: HarnessData,
  sourceId: string,
  targetId: string,
  options: MergeConnectorsOptions = {},
): HarnessData {
  if (sourceId === targetId) {
    throw new Error('Cannot merge a connector into itself');
  }
  const source = harness.connectors.find((connector) => connector.id === sourceId);
  const target = harness.connectors.find((connector) => connector.id === targetId);
  if (!source || !target) {
    throw new Error('Both connectors must exist to merge');
  }
  if (source.parent !== target.parent) {
    throw new Error('Connectors must share the same parent enclosure to merge');
  }

  for (const wirePath of harness.paths) {
    let refsSource = false;
    let refsTarget = false;
    for (const node of wirePath.nodes) {
      if (node.kind !== 'connector') continue;
      if (node.connector_id === sourceId) refsSource = true;
      if (node.connector_id === targetId) refsTarget = true;
    }
    if (refsSource && refsTarget) {
      throw new Error('Cannot merge connectors that already share a path');
    }
  }

  const sourcePins = [...new Set(
    getConnectorOccupancy(harness, sourceId).map((entry) => entry.pinNumber),
  )].sort((left, right) => left - right);

  const usedPins = new Set(
    getConnectorOccupancy(harness, targetId).map((entry) => entry.pinNumber),
  );
  const pinMapping = new Map<number, number>();
  let cursor = 1;
  for (const oldPin of sourcePins) {
    while (usedPins.has(cursor)) cursor += 1;
    pinMapping.set(oldPin, cursor);
    usedPins.add(cursor);
    cursor += 1;
  }

  const next = structuredClone(harness);
  const remap = (node: PathNode) => {
    if (node.kind !== 'connector' || node.connector_id !== sourceId) return;
    const oldPin = normalizeOccupiedPinNumber(node.pin_number);
    node.connector_id = targetId;
    node.pin_number = pinMapping.get(oldPin) ?? oldPin;
  };
  for (const wirePath of next.paths) {
    wirePath.nodes.forEach(remap);
    wirePath.measurements.forEach((measurement) => {
      remap(measurement.from);
      remap(measurement.to);
    });
  }

  const surviving = next.connectors.find((connector) => connector.id === targetId);
  if (!surviving) {
    throw new Error('Target connector disappeared during merge');
  }
  const requiredCapacity = Math.max(
    getEffectivePinCount(surviving, options.targetType),
    ...usedPins,
    1,
  );
  applyConnectorPinCount(surviving, options.targetType, requiredCapacity);
  normalizeConnectorKeying(surviving, options.targetType ?? null);

  next.connectors = next.connectors.filter((connector) => connector.id !== sourceId);
  return next;
}
