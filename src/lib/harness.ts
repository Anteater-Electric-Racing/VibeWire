import type {
  Connector,
  ConnectorOccupancy,
  ConnectorPathNode,
  DerivedBundle,
  DerivedSegment,
  Enclosure,
  HarnessData,
  LengthSplitTarget,
  MergePoint,
  Path,
  PathMeasurement,
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
  getConnectorSchematicImage,
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
 * viewed from the parent space. Device-owned connectors remain ordinary child
 * ports; container-owned connectors are exposed only when they resolve to a
 * wall-mounted bulkhead. Explicit inline connectors stay inside the container.
 */
export function getEnclosurePorts(
  harness: HarnessData,
  encId: string,
): Connector[] {
  const enclosure = harness.enclosures.find((candidate) => candidate.id === encId);
  return harness.connectors.filter((connector) =>
    connector.parent === encId
    && (!enclosure?.container || isBulkheadConnector(harness, connector.id))
  );
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

/** Side of a bulkhead wall: wires inside the box, outside, or both. */
export type BulkheadWireSide = 'internal' | 'external' | 'both';

/** Runtime role resolved from the optional placement override plus legacy hierarchy rules. */
export type ConnectorRole = 'endpoint' | 'inline' | 'bulkhead';

export function getConnectorRole(
  harness: Pick<HarnessData, 'connectors' | 'enclosures'>,
  connectorOrId: Connector | string,
): ConnectorRole {
  const connector = typeof connectorOrId === 'string'
    ? harness.connectors.find((candidate) => candidate.id === connectorOrId)
    : connectorOrId;
  if (!connector) return 'endpoint';
  if (connector.mounting === 'inline') return 'inline';
  if (connector.mounting === 'bulkhead') return 'bulkhead';
  if (!connector.parent) return 'endpoint';
  return harness.enclosures.find((candidate) => candidate.id === connector.parent)?.container
    ? 'bulkhead'
    : 'endpoint';
}

export function isInlineConnector(
  harness: Pick<HarnessData, 'connectors' | 'enclosures'>,
  connectorOrId: Connector | string,
): boolean {
  return getConnectorRole(harness, connectorOrId) === 'inline';
}

/**
 * True when a connector is mounted on a container enclosure wall (a bulkhead).
 * Device-mounted connectors and free/root connectors are not bulkheads.
 */
export function isBulkheadConnector(
  harness: HarnessData,
  connectorId: string,
): boolean {
  return getConnectorRole(harness, connectorId) === 'bulkhead';
}

export function isPassThroughConnector(
  harness: Pick<HarnessData, 'connectors' | 'enclosures'>,
  connectorOrId: Connector | string,
): boolean {
  const role = getConnectorRole(harness, connectorOrId);
  return role === 'inline' || role === 'bulkhead';
}

/** True when `ancestorId` is `nodeId` or an ancestor enclosure of `nodeId`. */
export function enclosureContains(
  harness: HarnessData,
  ancestorId: string,
  nodeId: string | null,
): boolean {
  let current = nodeId;
  while (current) {
    if (current === ancestorId) return true;
    current = harness.enclosures.find((item) => item.id === current)?.parent ?? null;
  }
  return false;
}

/**
 * True when the entity lives in the enclosure's interior (device/PCB or in-box
 * splice), not merely on the enclosure wall as another bulkhead.
 */
export function isInteriorToEnclosure(
  harness: HarnessData,
  node: PathNode,
  enclosureId: string,
): boolean {
  if (node.kind === 'connector') {
    const connector = harness.connectors.find((item) => item.id === node.connector_id);
    if (!connector?.parent) return false;
    // Wall-mounted siblings share the enclosure as parent — treat as exterior.
    if (connector.parent === enclosureId) {
      return isInlineConnector(harness, connector);
    }
    return enclosureContains(harness, enclosureId, connector.parent);
  }
  const mergePoint = harness.mergePoints.find((item) => item.id === node.merge_point_id);
  if (!mergePoint) return false;
  if (mergePoint.parent === enclosureId) return true;
  return enclosureContains(harness, enclosureId, mergePoint.parent);
}

/**
 * Which bulkhead sides a path touches at `connectorId`.
 * Non-bulkhead connectors always report `'both'`.
 */
export function getPathBulkheadSidesAtConnector(
  harness: HarnessData,
  connectorId: string,
  path: Path,
): BulkheadWireSide {
  if (!isBulkheadConnector(harness, connectorId)) return 'both';
  const connector = harness.connectors.find((item) => item.id === connectorId);
  const enclosureId = connector?.parent;
  if (!enclosureId) return 'both';

  let internal = false;
  let external = false;
  path.nodes.forEach((node, index) => {
    if (node.kind !== 'connector' || node.connector_id !== connectorId) return;
    for (const neighborIndex of [index - 1, index + 1]) {
      const neighbor = path.nodes[neighborIndex];
      if (!neighbor) continue;
      if (isInteriorToEnclosure(harness, neighbor, enclosureId)) internal = true;
      else external = true;
    }
  });

  if (internal && external) return 'both';
  if (internal) return 'internal';
  if (external) return 'external';
  // Path ends on the bulkhead with no neighbor yet — treat as both so it stays editable.
  return 'both';
}

/**
 * Paths that land on `connectorId`, optionally filtered by bulkhead side.
 * `side` is ignored for non-bulkhead connectors.
 */
export function getPathsTouchingConnector(
  harness: HarnessData,
  connectorId: string,
  side: BulkheadWireSide = 'both',
): Path[] {
  const seen = new Set<string>();
  const matches: Path[] = [];
  for (const path of harness.paths) {
    if (!path.nodes.some((node) => node.kind === 'connector' && node.connector_id === connectorId)) {
      continue;
    }
    if (seen.has(path.id)) continue;
    if (side !== 'both') {
      const pathSide = getPathBulkheadSidesAtConnector(harness, connectorId, path);
      if (pathSide !== side && pathSide !== 'both') continue;
    }
    seen.add(path.id);
    matches.push(path);
  }
  return matches;
}

/** Resolve wire appearance for a path, preferring path color then signal preferred color. */
export function getPathWireAppearance(
  path: Pick<Path, 'properties' | 'tags' | 'signal_id'>,
  harness: Pick<HarnessData, 'signals'>,
): WireAppearance {
  const signalId = getPathSignalId(path);
  const preferred = signalId
    ? harness.signals.find((signal) => signal.id === signalId)?.properties.preferred_wire_color
    : undefined;
  return getWireAppearance({
    properties: path.properties,
    tags: path.tags,
    signal_id: path.signal_id,
    preferred_wire_color: preferred,
  });
}

export function getPortWireAppearance(
  harness: HarnessData,
  con: Connector,
): WireAppearance | null {
  const appearances = getConnectorOccupancy(harness, con.id).map((entry) => {
    const path = harness.paths.find((candidate) => candidate.id === entry.pathId);
    return path
      ? getPathWireAppearance(path, harness)
      : getWireAppearance({ tags: [], properties: {} });
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
  const childEnclosures = new Map(
    harness.enclosures
      .filter((enclosure) => enclosure.parent === spaceId)
      .map((enclosure) => [enclosure.id, enclosure]),
  );
  const visible = new Set<string>();
  for (const connector of harness.connectors) {
    if (connector.parent === spaceId) {
      visible.add(connector.id);
      continue;
    }
    const parent = connector.parent ? childEnclosures.get(connector.parent) : undefined;
    if (
      parent
      && (!parent.container || isBulkheadConnector(harness, connector.id))
    ) {
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
    if (isInlineConnector(harness, connector)) {
      return connector.parent;
    }
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

/** Round to the 3 decimal places `applySpanTotalLength` also stores hop runs at. */
function roundMm(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Split the measurement recorded for the `A -> B` hop into `A -> mid` and
 * `mid -> B` runs, so inserting `mid` between them keeps every measurement
 * attached to an adjacent node pair.
 *
 * Persistence requires that invariant: a measurement whose endpoints are no
 * longer neighbors cannot be placed on any sheet, so the storage layer drops it
 * and then refuses the whole save. Length is halved (the splice's true position
 * along the run is not known here) with the remainder pushed onto the second
 * run so the two still sum to the original.
 */
function splitHopMeasurements(
  measurements: PathMeasurement[],
  from: PathNode,
  to: PathNode,
  mid: PathNode,
): PathMeasurement[] {
  const fromKey = getPathNodeRefKey(from);
  const toKey = getPathNodeRefKey(to);
  const next: PathMeasurement[] = [];
  for (const measurement of measurements) {
    const measurementFromKey = getPathNodeRefKey(measurement.from);
    const measurementToKey = getPathNodeRefKey(measurement.to);
    const isHop =
      (measurementFromKey === fromKey && measurementToKey === toKey)
      || (measurementFromKey === toKey && measurementToKey === fromKey);
    if (!isHop) {
      next.push(measurement);
      continue;
    }
    const head = roundMm((measurement.length_mm ?? 0) / 2);
    const tail = roundMm((measurement.length_mm ?? 0) - head);
    const carry = (length: number) => ({
      ...(measurement.length_mm !== undefined ? { length_mm: length } : {}),
      ...(measurement.note !== undefined ? { note: measurement.note } : {}),
    });
    next.push(
      { from: structuredClone(measurement.from), to: structuredClone(mid), ...carry(head) },
      { from: structuredClone(mid), to: structuredClone(measurement.to), ...carry(tail) },
    );
  }
  return next;
}

/**
 * Insert a merge-point node into a path's node list inside the segment that
 * matches `bundleId`.  Because promoting a junction always splits its bundle
 * into sub-bundles (so no two coupled merges ever coexist on the same
 * segment), we always insert directly between the two endpoint nodes.
 * Any measurement recorded for that segment is split across the two new hops.
 * Returns a new Path with updated `nodes[]`; the original is not mutated.
 */
export function splicePathWithMerge(
  path: Path,
  bundleId: string,
  mergePointId: string,
): Path {
  const match = findPathSegmentForBundle(path, bundleId);
  if (!match) return path;
  const mid: PathNode = { kind: 'merge', merge_point_id: mergePointId };
  const nextNodes = [...path.nodes];
  nextNodes.splice(match.index + 1, 0, mid);
  return {
    ...path,
    nodes: nextNodes,
    measurements: splitHopMeasurements(
      path.measurements,
      path.nodes[match.index],
      path.nodes[match.index + 1],
      mid,
    ),
  };
}

/**
 * Insert a connector cavity into the concrete path segment represented by a
 * graph bundle. The logical Path and its identity remain intact; manufacturing
 * derives two physical runs from the new intermediate connector stop.
 */
export function splicePathWithConnector(
  path: Path,
  bundleId: string,
  connectorId: string,
  pinNumber: number,
): Path {
  const match = findPathSegmentForBundle(path, bundleId);
  if (!match) return path;
  const mid: ConnectorPathNode = {
    kind: 'connector',
    connector_id: connectorId,
    pin_number: normalizeOccupiedPinNumber(pinNumber),
  };
  const nextNodes = [...path.nodes];
  nextNodes.splice(match.index + 1, 0, mid);
  return {
    ...path,
    nodes: nextNodes,
    measurements: splitHopMeasurements(
      path.measurements,
      path.nodes[match.index],
      path.nodes[match.index + 1],
      mid,
    ),
  };
}

/** Which sheet (root harness, or a hierarchy enclosure) a path node's device lives on. */
export function getPathNodeSheetName(harness: HarnessData, node: PathNode): string {
  const parentId = node.kind === 'connector'
    ? harness.connectors.find((candidate) => candidate.id === node.connector_id)?.parent ?? null
    : harness.mergePoints.find((candidate) => candidate.id === node.merge_point_id)?.parent ?? null;
  if (!parentId) return harness.name || 'Root';
  return harness.enclosures.find((candidate) => candidate.id === parentId)?.name ?? parentId;
}

function describeLengthSplitNode(harness: HarnessData, node: PathNode): LengthSplitSideNode {
  if (node.kind === 'connector') {
    const connector = harness.connectors.find((candidate) => candidate.id === node.connector_id);
    return {
      label: connector?.name ?? node.connector_id,
      sheetName: getPathNodeSheetName(harness, node),
      kind: 'connector',
    };
  }
  const mergePoint = harness.mergePoints.find((candidate) => candidate.id === node.merge_point_id);
  return {
    label: mergePoint?.name ?? node.merge_point_id,
    sheetName: getPathNodeSheetName(harness, node),
    kind: 'merge',
  };
}

function buildLengthSplitChain(
  harness: HarnessData,
  path: Path,
  startIndex: number,
  direction: 1 | -1,
): LengthSplitSideNode[] {
  const chain: LengthSplitSideNode[] = [];
  for (let index = startIndex; index >= 0 && index < path.nodes.length; index += direction) {
    chain.push(describeLengthSplitNode(harness, path.nodes[index]));
  }
  return chain;
}

/** One device (or chain of devices, when it leads through further splices) on a side of a split node. */
export interface LengthSplitSideNode {
  label: string;
  sheetName: string;
  kind: 'connector' | 'merge';
}

/** One wire's hop toward a particular side of the node being adjusted. */
export interface LengthSplitSideInstance {
  pathId: string;
  pathName: string;
  segmentIndex: number;
  lengthMm?: number;
}

/** One neighboring bundle around the split node: the route toward it, plus every wire's hop there. */
export interface LengthSplitSide {
  /** Bundle key of the neighboring node, stable across wires that traverse this node in either direction. */
  key: string;
  /** Breadcrumb of devices from the split node outward to the end of a representative wire's route, nearest first. */
  chain: LengthSplitSideNode[];
  instances: LengthSplitSideInstance[];
}

export interface LengthSplitDetail {
  targetLabel: string;
  targetKind: 'connector' | 'merge';
  sides: LengthSplitSide[];
}

/**
 * Describe the hop lengths on every side of an inline connector or splice, so a
 * UI can offer to redistribute them (e.g. right after the node was spliced into
 * a bundle that already had a length, or whenever the node is opened directly).
 * Returns `null` when the node isn't currently a mid-route stop on any wire, or
 * when it only has one distinct neighbor (nothing to redistribute between).
 */
export function getLengthSplitDetail(
  harness: HarnessData,
  target: LengthSplitTarget,
): LengthSplitDetail | null {
  const matchesTarget = (node: PathNode): boolean =>
    target.kind === 'connector'
      ? node.kind === 'connector' && node.connector_id === target.connectorId
      : node.kind === 'merge' && node.merge_point_id === target.mergePointId;

  interface RawEntry {
    pathId: string;
    pathName: string;
    segmentIndex: number;
    lengthMm?: number;
    neighborKey: string;
    path: Path;
    neighborIndex: number;
    direction: 1 | -1;
  }
  const raw: RawEntry[] = [];
  let targetNode: PathNode | undefined;

  for (const path of harness.paths) {
    path.nodes.forEach((node, index) => {
      if (!matchesTarget(node)) return;
      if (index <= 0 || index >= path.nodes.length - 1) return;
      targetNode ??= node;
      const beforeIndex = index - 1;
      const afterIndex = index + 1;
      raw.push({
        pathId: path.id,
        pathName: path.name,
        segmentIndex: beforeIndex,
        lengthMm: getPathSegmentMeasurement(path, beforeIndex)?.length_mm,
        neighborKey: getPathNodeBundleKey(path.nodes[beforeIndex]),
        path,
        neighborIndex: beforeIndex,
        direction: -1,
      });
      raw.push({
        pathId: path.id,
        pathName: path.name,
        segmentIndex: index,
        lengthMm: getPathSegmentMeasurement(path, index)?.length_mm,
        neighborKey: getPathNodeBundleKey(path.nodes[afterIndex]),
        path,
        neighborIndex: afterIndex,
        direction: 1,
      });
    });
  }

  if (!targetNode || raw.length === 0) return null;

  const sidesByKey = new Map<string, LengthSplitSide>();
  for (const entry of raw) {
    let side = sidesByKey.get(entry.neighborKey);
    if (!side) {
      side = {
        key: entry.neighborKey,
        chain: buildLengthSplitChain(harness, entry.path, entry.neighborIndex, entry.direction),
        instances: [],
      };
      sidesByKey.set(entry.neighborKey, side);
    }
    side.instances.push({
      pathId: entry.pathId,
      pathName: entry.pathName,
      segmentIndex: entry.segmentIndex,
      lengthMm: entry.lengthMm,
    });
  }

  const sides = [...sidesByKey.values()];
  if (sides.length < 2) return null;

  return {
    targetLabel: describeLengthSplitNode(harness, targetNode).label,
    targetKind: targetNode.kind === 'connector' ? 'connector' : 'merge',
    sides,
  };
}

/** True when at least one wire already has a measured length on any side of the split node. */
export function lengthSplitHasExistingLength(detail: LengthSplitDetail): boolean {
  return detail.sides.some((side) =>
    side.instances.some((instance) => instance.lengthMm !== undefined));
}

/**
 * Inverse of `splitHopMeasurements`: fold the `A -> mid` and `mid -> B` runs
 * back into a single `A -> B` run so dropping `mid` leaves every measurement on
 * an adjacent node pair.
 *
 * A joined length is only produced when both runs were measured -- the codebase
 * treats a total derived from partially measured hops as unknown rather than
 * understating the run (see `spanLengthMm`).
 */
function joinHopMeasurements(
  measurements: PathMeasurement[],
  from: PathNode,
  mid: PathNode,
  to: PathNode,
): PathMeasurement[] {
  const fromKey = getPathNodeRefKey(from);
  const midKey = getPathNodeRefKey(mid);
  const toKey = getPathNodeRefKey(to);
  const spans = (measurement: PathMeasurement, a: string, b: string) => {
    const measurementFromKey = getPathNodeRefKey(measurement.from);
    const measurementToKey = getPathNodeRefKey(measurement.to);
    return (
      (measurementFromKey === a && measurementToKey === b)
      || (measurementFromKey === b && measurementToKey === a)
    );
  };

  const head = measurements.find((measurement) => spans(measurement, fromKey, midKey));
  const tail = measurements.find((measurement) => spans(measurement, midKey, toKey));
  const next = measurements.filter(
    (measurement) =>
      getPathNodeRefKey(measurement.from) !== midKey
      && getPathNodeRefKey(measurement.to) !== midKey,
  );
  if (!head && !tail) return next;

  const length = head?.length_mm !== undefined && tail?.length_mm !== undefined
    ? roundMm(head.length_mm + tail.length_mm)
    : undefined;
  const note = head?.note ?? tail?.note;
  if (length === undefined && note === undefined) return next;
  next.push({
    from: structuredClone(from),
    to: structuredClone(to),
    ...(length !== undefined ? { length_mm: length } : {}),
    ...(note !== undefined ? { note } : {}),
  });
  return next;
}

/**
 * Drop the node at `index`, rejoining the measurements on either side of it.
 * Interior removals collapse `A -> node -> B` into `A -> B`; removing an
 * endpoint just discards the runs that referenced it.
 */
export function removePathNodeAt(path: Path, index: number): Path {
  const mid = path.nodes[index];
  if (!mid) return path;
  const from = path.nodes[index - 1];
  const to = path.nodes[index + 1];
  const nodes = [...path.nodes.slice(0, index), ...path.nodes.slice(index + 1)];
  const midKey = getPathNodeRefKey(mid);
  const measurements = from && to
    ? joinHopMeasurements(path.measurements, from, mid, to)
    : path.measurements.filter(
      (measurement) =>
        getPathNodeRefKey(measurement.from) !== midKey
        && getPathNodeRefKey(measurement.to) !== midKey,
    );
  return { ...path, nodes, measurements };
}

/** Remove every occurrence of a connector from a path while rejoining each hop. */
export function removeConnectorFromPath(path: Path, connectorId: string): Path {
  let next = path;
  for (let index = next.nodes.length - 1; index >= 0; index -= 1) {
    const node = next.nodes[index];
    if (node.kind === 'connector' && node.connector_id === connectorId) {
      next = removePathNodeAt(next, index);
    }
  }
  return next;
}

/**
 * Delete an inline connector without deleting the wires routed through it.
 * Valid through-paths retain their identity as `A -> inline -> B` collapses
 * back to `A -> B`; one-node remnants from half-wired cavities are discarded.
 */
export function dissolveInlineConnector(
  harness: HarnessData,
  connectorId: string,
): HarnessData {
  if (!harness.connectors.some((connector) => connector.id === connectorId)) {
    return harness;
  }
  const paths = harness.paths
    .map((path) => removeConnectorFromPath(path, connectorId))
    .filter((path) => path.nodes.length >= 2);
  return {
    ...harness,
    connectors: harness.connectors.filter((connector) => connector.id !== connectorId),
    paths,
  };
}

/**
 * Remove every reference to `mergePointId` from a path's node list.  Returns a
 * new Path even when nothing changed, to keep call sites simple.
 */
export function removeMergeFromPath(path: Path, mergePointId: string): Path {
  let next = path;
  for (let index = next.nodes.length - 1; index >= 0; index -= 1) {
    const node = next.nodes[index];
    if (node.kind === 'merge' && node.merge_point_id === mergePointId) {
      next = removePathNodeAt(next, index);
    }
  }
  return next;
}

/**
 * Delete a splice and reconnect whatever was on either side, as if the splice
 * never existed:
 * - Through-paths (`A → splice → B`) become `A → B`.
 * - Exactly two stub paths that only meet at the splice are stitched into one
 *   continuous path.
 * - Unpairable stubs (0 or 3+ one-sided remnants) are dropped.
 * - The runs on either side of the splice are folded back into one measurement.
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

export type HierarchyEntityKind = 'enclosure' | 'connector' | 'mergePoint';

/**
 * Move an enclosure, connector, or merge point to a new parent and/or sibling
 * position. Sibling order is array order among entities that share the same
 * `parent`. `beforeId` inserts immediately before that same-kind sibling under
 * the new parent; `null` appends after the last sibling.
 */
export function moveHierarchyEntity(
  harness: HarnessData,
  type: HierarchyEntityKind,
  id: string,
  newParentId: string | null,
  beforeId: string | null = null,
): HarnessData {
  if (beforeId === id) {
    throw new Error('Cannot insert an entity before itself.');
  }

  if (newParentId !== null) {
    const parent = harness.enclosures.find((item) => item.id === newParentId);
    if (!parent) {
      throw new Error('Target parent does not exist.');
    }
    if (type === 'enclosure' && !parent.container) {
      throw new Error('Devices and enclosures can only be placed inside an enclosure.');
    }
  }

  const items =
    type === 'enclosure' ? harness.enclosures
      : type === 'connector' ? harness.connectors
        : harness.mergePoints;
  const fromIndex = items.findIndex((item) => item.id === id);
  if (fromIndex < 0) {
    throw new Error(
      type === 'enclosure' ? 'Enclosure not found.'
        : type === 'connector' ? 'Connector not found.'
          : 'Merge point not found.',
    );
  }

  if (type === 'enclosure') {
    if (newParentId === id) {
      throw new Error('An enclosure cannot be placed inside itself.');
    }
    if (newParentId !== null) {
      const parentById = new Map(harness.enclosures.map((item) => [item.id, item.parent]));
      let current: string | null = newParentId;
      const visited = new Set<string>();
      while (current) {
        if (current === id) {
          throw new Error('Cannot move an enclosure into one of its descendants.');
        }
        if (visited.has(current)) break;
        visited.add(current);
        current = parentById.get(current) ?? null;
      }
    }
  }

  const current = items[fromIndex];
  if (current.parent === newParentId) {
    const siblings = items.filter((item) => item.parent === newParentId);
    const currentSiblingIndex = siblings.findIndex((item) => item.id === id);
    if (beforeId === null) {
      if (siblings.at(-1)?.id === id) return harness;
    } else {
      const beforeSiblingIndex = siblings.findIndex((item) => item.id === beforeId);
      if (
        beforeSiblingIndex >= 0
        && (beforeSiblingIndex === currentSiblingIndex || beforeSiblingIndex === currentSiblingIndex + 1)
      ) {
        return harness;
      }
    }
  }

  const next = structuredClone(harness);
  const nextItems =
    type === 'enclosure' ? next.enclosures
      : type === 'connector' ? next.connectors
        : next.mergePoints;
  const nextFromIndex = nextItems.findIndex((item) => item.id === id);
  const [removed] = nextItems.splice(nextFromIndex, 1);
  removed.parent = newParentId;

  if (beforeId) {
    const beforeIndex = nextItems.findIndex((item) => item.id === beforeId);
    if (beforeIndex >= 0 && nextItems[beforeIndex].parent === newParentId) {
      nextItems.splice(beforeIndex, 0, removed);
      return next;
    }
  }

  let insertAt = nextItems.length;
  for (let i = nextItems.length - 1; i >= 0; i -= 1) {
    if (nextItems[i].parent === newParentId) {
      insertAt = i + 1;
      break;
    }
  }
  nextItems.splice(insertAt, 0, removed);
  return next;
}
