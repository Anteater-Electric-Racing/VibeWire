import type {
  Connector,
  ConnectorOccupancy,
  ConnectorPathNode,
  HarnessBundle,
  Wire,
  HierarchyEntity,
  SystemData,
  BranchPoint,
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
import {
  isBulkheadDot,
  isTerminalVisualDot,
} from './bulkheadRouting';
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
  system: SystemData,
  parentId: string | null,
): HierarchyEntity[] {
  return system.hierarchy.filter((e) => e.parent === parentId);
}

/**
 * Connectors that should appear as port tabs on a given enclosure when
 * viewed from the parent space. Device-owned connectors remain ordinary child
 * ports; container-owned connectors are exposed only when they resolve to a
 * wall-mounted bulkhead. Explicit inline connectors stay inside the container.
 */
export function getEnclosurePorts(
  system: SystemData,
  encId: string,
): Connector[] {
  const enclosure = system.hierarchy.find((candidate) => candidate.id === encId);
  return system.connectors.filter((connector) =>
    connector.parent === encId
    && (enclosure?.kind !== 'enclosure' || isBulkheadConnector(system, connector.id))
  );
}

/**
 * All connectors reachable inside an enclosure — direct children plus
 * connectors on non-container child enclosures.
 */
export function getEnclosureConnectors(
  system: SystemData,
  encId: string,
): Connector[] {
  const childEncIds = new Set(
    system.hierarchy
      .filter((e) => e.parent === encId)
      .map((e) => e.id),
  );
  return system.connectors.filter((c) => {
    if (c.parent === encId) return true;
    return c.parent !== null && childEncIds.has(c.parent);
  });
}

/**
 * Free-floating connectors within a space — connectors whose parent IS
 * the current space (null for root).
 */
export function getSpaceFreeConnectors(
  system: SystemData,
  spaceId: string | null,
): Connector[] {
  return system.connectors.filter((c) => c.parent === spaceId);
}

export function getEnclosureBranchPoints(
  system: SystemData,
  encId: string,
): BranchPoint[] {
  return system.branchPoints.filter((branchPoint) => branchPoint.parent === encId);
}

export function getSpaceFreeBranchPoints(
  system: SystemData,
  spaceId: string | null,
): BranchPoint[] {
  return system.branchPoints.filter((branchPoint) => branchPoint.parent === spaceId);
}

export function getPathSignalId(path: Pick<Path, 'signal_id' | 'tags'>): string | null {
  if (path.signal_id) return path.signal_id;
  const slug = path.tags.find((tag) => tag.startsWith('signal:'))?.slice(7);
  return slug ? `sig_${slug}` : null;
}

export function getPathSignalName(
  path: Pick<Path, 'signal_id' | 'tags'>,
  system?: Pick<SystemData, 'signals'>,
): string | null {
  const signalId = getPathSignalId(path);
  if (!signalId) return null;
  return system?.signals.find((signal) => signal.id === signalId)?.name
    ?? signalId.replace(/^sig_/, '');
}

export const BRANCH_REF_PREFIX = 'branch:';
const LEGACY_MERGE_REF_PREFIX = 'merge:';

export function branchPointRefKey(branchPointId: string): string {
  return `${BRANCH_REF_PREFIX}${branchPointId}`;
}

export function isBranchPointRefKey(key: string): boolean {
  return key.startsWith(BRANCH_REF_PREFIX) || key.startsWith(LEGACY_MERGE_REF_PREFIX);
}

export function canonicalizeRefKey(key: string): string {
  return key.replaceAll(LEGACY_MERGE_REF_PREFIX, BRANCH_REF_PREFIX);
}

export function branchPointIdFromRefKey(key: string): string | null {
  if (key.startsWith(BRANCH_REF_PREFIX)) return key.slice(BRANCH_REF_PREFIX.length);
  if (key.startsWith(LEGACY_MERGE_REF_PREFIX)) return key.slice(LEGACY_MERGE_REF_PREFIX.length);
  return null;
}

export function getPathNodeRefKey(node: PathNode): string {
  if (node.kind === 'connector') {
    return `connector:${node.connector_id}:${node.pin_number}`;
  }
  return branchPointRefKey(node.branch_point_id);
}

export function getPathNodeLabel(
  system: SystemData,
  node: PathNode,
): string {
  if (node.kind === 'connector') {
    const connector = system.connectors.find((candidate) => candidate.id === node.connector_id);
    return connector ? `${connector.name}-${node.pin_number}` : `${node.connector_id}-${node.pin_number}`;
  }
  const branchPoint = system.branchPoints.find((candidate) => candidate.id === node.branch_point_id);
  return branchPoint?.name ?? node.branch_point_id;
}

/**
 * Device-oriented label for a path stop: the owning device when the connector
 * lives on one, otherwise the connector or branch-point name. Used for branch-point
 * inspector chains where pin-level labels are noise.
 */
export function getPathNodeDeviceLabel(
  system: SystemData,
  node: PathNode,
): string {
  if (node.kind === 'branch') {
    const branchPoint = system.branchPoints.find((candidate) => candidate.id === node.branch_point_id);
    return branchPoint?.name ?? node.branch_point_id;
  }
  const connector = system.connectors.find((candidate) => candidate.id === node.connector_id);
  if (!connector) return node.connector_id;
  const parent = connector.parent
    ? system.hierarchy.find((candidate) => candidate.id === connector.parent)
    : undefined;
  if (parent && parent.kind === 'device') return parent.name;
  if (parent) return `${parent.name} · ${connector.name}`;
  return connector.name;
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
  wireIndex: number;
  from: ConnectorPathNode;
  to: ConnectorPathNode;
}

export function getConnectorPairSegments(
  system: SystemData,
  connectorIdA: string,
  connectorIdB: string,
): ConnectorPairSegment[] {
  const matches: ConnectorPairSegment[] = [];
  for (const path of system.paths) {
    for (let segmentIndex = 0; segmentIndex < path.nodes.length - 1; segmentIndex++) {
      const from = path.nodes[segmentIndex];
      const to = path.nodes[segmentIndex + 1];
      if (from.kind !== 'connector' || to.kind !== 'connector') continue;
      const matchesPair =
        (from.connector_id === connectorIdA && to.connector_id === connectorIdB) ||
        (from.connector_id === connectorIdB && to.connector_id === connectorIdA);
      if (matchesPair) matches.push({ path, wireIndex: segmentIndex, from, to });
    }
  }
  return matches;
}

export function deriveWires(system: SystemData): Wire[] {
  const segments: Wire[] = [];
  for (const path of system.paths) {
    for (let segmentIndex = 0; segmentIndex < path.nodes.length - 1; segmentIndex++) {
      const from = path.nodes[segmentIndex];
      const to = path.nodes[segmentIndex + 1];
      const throughKey = getSegmentThroughKey(path, segmentIndex) ?? undefined;
      segments.push({
        id: `${path.id}::${segmentIndex}`,
        pathId: path.id,
        pathName: path.name,
        wireIndex: segmentIndex,
        from,
        to,
        tags: path.tags,
        properties: path.properties,
        ...(throughKey ? { throughKey } : {}),
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
  system: SystemData,
  connectorId: string,
): ConnectorOccupancy[] {
  const occupancy: ConnectorOccupancy[] = [];
  for (const path of system.paths) {
    const signalName = getPathSignalName(path, system);
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

const UNASSIGNED_SIGNAL_KEY = '__unassigned';

export interface ConnectorSignalPath {
  pathId: string;
  pathName: string;
  pinNumbers: number[];
}

/** Signals present on a connector/bulkhead, each with the paths that land there. */
export interface ConnectorSignalGroup {
  key: string;
  signalId: string | null;
  signalName: string;
  appearance: WireAppearance;
  paths: ConnectorSignalPath[];
}

export function getConnectorSignalGroups(
  system: SystemData,
  connectorId: string,
): ConnectorSignalGroup[] {
  const occupancy = getConnectorOccupancy(system, connectorId);
  const groups = new Map<string, ConnectorSignalGroup>();

  for (const entry of occupancy) {
    const path = system.paths.find((candidate) => candidate.id === entry.pathId);
    const signalId = path ? getPathSignalId(path) : null;
    const key = signalId ?? UNASSIGNED_SIGNAL_KEY;
    let group = groups.get(key);
    if (!group) {
      const signal = signalId
        ? system.signals.find((candidate) => candidate.id === signalId)
        : undefined;
      group = {
        key,
        signalId,
        signalName: entry.signalName ?? 'Unassigned',
        appearance: getWireAppearance({
          tags: [],
          properties: {},
          signal_id: signalId ?? undefined,
          preferred_wire_color: signal?.properties.preferred_wire_color,
        }),
        paths: [],
      };
      groups.set(key, group);
    }

    const existing = group.paths.find((candidate) => candidate.pathId === entry.pathId);
    if (existing) {
      if (!existing.pinNumbers.includes(entry.pinNumber)) {
        existing.pinNumbers.push(entry.pinNumber);
        existing.pinNumbers.sort((a, b) => a - b);
      }
    } else {
      group.paths.push({
        pathId: entry.pathId,
        pathName: entry.pathName,
        pinNumbers: [entry.pinNumber],
      });
    }
  }

  for (const group of groups.values()) {
    group.paths.sort(
      (a, b) => a.pathName.localeCompare(b.pathName) || a.pathId.localeCompare(b.pathId),
    );
  }

  return [...groups.values()].sort((a, b) => {
    if (!a.signalId && b.signalId) return 1;
    if (a.signalId && !b.signalId) return -1;
    return a.signalName.localeCompare(b.signalName)
      || (a.signalId ?? '').localeCompare(b.signalId ?? '');
  });
}

export interface BranchPointPathStop {
  kind: 'connector' | 'branch';
  id: string;
  label: string;
  isBranchStop: boolean;
}

export interface BranchPointSignalPath {
  pathId: string;
  pathName: string;
  stops: BranchPointPathStop[];
}

/** One signal at a branch point, with every complete path that crosses it. */
export interface BranchPointSignalGroup {
  key: string;
  signalId: string | null;
  signalName: string;
  appearance: WireAppearance;
  paths: BranchPointSignalPath[];
}

/**
 * Signals at a branch point, each listing the full device chain of every path that
 * touches it — both directions, not just the neighboring hop.
 */
export function getBranchPointSignalGroups(
  system: SystemData,
  branchPointId: string,
): BranchPointSignalGroup[] {
  const groups = new Map<string, BranchPointSignalGroup>();

  for (const path of system.paths) {
    if (!path.nodes.some((node) => node.kind === 'branch' && node.branch_point_id === branchPointId)) {
      continue;
    }
    const signalId = getPathSignalId(path);
    const key = signalId ?? UNASSIGNED_SIGNAL_KEY;
    let group = groups.get(key);
    if (!group) {
      const signal = signalId
        ? system.signals.find((candidate) => candidate.id === signalId)
        : undefined;
      group = {
        key,
        signalId,
        signalName: signal?.name ?? (signalId ? signalId.replace(/^sig_/, '') : 'Unassigned'),
        appearance: getPathWireAppearance(path, system),
        paths: [],
      };
      groups.set(key, group);
    }
    group.paths.push({
      pathId: path.id,
      pathName: path.name,
      stops: path.nodes.map((node) => ({
        kind: node.kind === 'connector' ? 'connector' : 'branch',
        id: node.kind === 'connector' ? node.connector_id : node.branch_point_id,
        label: getPathNodeDeviceLabel(system, node),
        isBranchStop: node.kind === 'branch' && node.branch_point_id === branchPointId,
      })),
    });
  }

  for (const group of groups.values()) {
    group.paths.sort(
      (a, b) => a.pathName.localeCompare(b.pathName) || a.pathId.localeCompare(b.pathId),
    );
  }

  return [...groups.values()].sort((a, b) => {
    if (!a.signalId && b.signalId) return 1;
    if (a.signalId && !b.signalId) return -1;
    return a.signalName.localeCompare(b.signalName)
      || (a.signalId ?? '').localeCompare(b.signalId ?? '');
  });
}

/** Side of a bulkhead wall: wires inside the box, outside, or both. */
export type BulkheadWireSide = 'internal' | 'external' | 'both';

/** Runtime role resolved from the optional placement override plus legacy hierarchy rules. */
export type ConnectorRole = 'endpoint' | 'inline' | 'bulkhead';

export function getConnectorRole(
  system: Pick<SystemData, 'connectors' | 'hierarchy'>,
  connectorOrId: Connector | string,
): ConnectorRole {
  const connector = typeof connectorOrId === 'string'
    ? system.connectors.find((candidate) => candidate.id === connectorOrId)
    : connectorOrId;
  if (!connector) return 'endpoint';
  if (connector.mounting === 'inline') return 'inline';
  if (connector.mounting === 'bulkhead') {
    return system.hierarchy.find((candidate) => candidate.id === connector.parent)?.kind === 'enclosure'
      ? 'bulkhead'
      : 'endpoint';
  }
  if (!connector.parent) return 'endpoint';
  return system.hierarchy.find((candidate) => candidate.id === connector.parent)?.kind === 'enclosure'
    ? 'bulkhead'
    : 'endpoint';
}

export function isInlineConnector(
  system: Pick<SystemData, 'connectors' | 'hierarchy'>,
  connectorOrId: Connector | string,
): boolean {
  return getConnectorRole(system, connectorOrId) === 'inline';
}

/**
 * True when a connector is mounted on a container enclosure wall (a bulkhead).
 * Device-mounted connectors and free/root connectors are not bulkheads.
 */
export function isBulkheadConnector(
  system: SystemData,
  connectorId: string,
): boolean {
  return getConnectorRole(system, connectorId) === 'bulkhead';
}

export function isPassThroughConnector(
  system: Pick<SystemData, 'connectors' | 'hierarchy'>,
  connectorOrId: Connector | string,
): boolean {
  const role = getConnectorRole(system, connectorOrId);
  return role === 'inline' || role === 'bulkhead';
}

/** True when `ancestorId` is `nodeId` or an ancestor enclosure of `nodeId`. */
export function enclosureContains(
  system: SystemData,
  ancestorId: string,
  nodeId: string | null,
): boolean {
  let current = nodeId;
  while (current) {
    if (current === ancestorId) return true;
    current = system.hierarchy.find((item) => item.id === current)?.parent ?? null;
  }
  return false;
}

/**
 * True when the entity lives in the enclosure's interior (device/PCB or in-box
 * branch point), not merely on the enclosure wall as another bulkhead.
 */
export function isInteriorToEnclosure(
  system: SystemData,
  node: PathNode,
  enclosureId: string,
): boolean {
  if (node.kind === 'connector') {
    const connector = system.connectors.find((item) => item.id === node.connector_id);
    if (!connector?.parent) return false;
    // Wall-mounted siblings share the enclosure as parent — treat as exterior.
    if (connector.parent === enclosureId) {
      return isInlineConnector(system, connector);
    }
    return enclosureContains(system, enclosureId, connector.parent);
  }
  const branchPoint = system.branchPoints.find((item) => item.id === node.branch_point_id);
  if (!branchPoint) return false;
  if (branchPoint.parent === enclosureId) return true;
  return enclosureContains(system, enclosureId, branchPoint.parent);
}

/**
 * Which bulkhead sides a path touches at `connectorId`.
 * Non-bulkhead connectors always report `'both'`.
 */
export function getPathBulkheadSidesAtConnector(
  system: SystemData,
  connectorId: string,
  path: Path,
): BulkheadWireSide {
  if (!isBulkheadConnector(system, connectorId)) return 'both';
  const connector = system.connectors.find((item) => item.id === connectorId);
  const enclosureId = connector?.parent;
  if (!enclosureId) return 'both';

  let internal = false;
  let external = false;
  path.nodes.forEach((node, index) => {
    if (node.kind !== 'connector' || node.connector_id !== connectorId) return;
    for (const neighborIndex of [index - 1, index + 1]) {
      const neighbor = path.nodes[neighborIndex];
      if (!neighbor) continue;
      if (isInteriorToEnclosure(system, neighbor, enclosureId)) internal = true;
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
  system: SystemData,
  connectorId: string,
  side: BulkheadWireSide = 'both',
): Path[] {
  const seen = new Set<string>();
  const matches: Path[] = [];
  for (const path of system.paths) {
    if (!path.nodes.some((node) => node.kind === 'connector' && node.connector_id === connectorId)) {
      continue;
    }
    if (seen.has(path.id)) continue;
    if (side !== 'both') {
      const pathSide = getPathBulkheadSidesAtConnector(system, connectorId, path);
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
  system: Pick<SystemData, 'signals'>,
): WireAppearance {
  const signalId = getPathSignalId(path);
  const preferred = signalId
    ? system.signals.find((signal) => signal.id === signalId)?.properties.preferred_wire_color
    : undefined;
  return getWireAppearance({
    properties: path.properties,
    tags: path.tags,
    signal_id: path.signal_id,
    preferred_wire_color: preferred,
  });
}

export function getPortWireAppearance(
  system: SystemData,
  con: Connector,
): WireAppearance | null {
  const appearances = getConnectorOccupancy(system, con.id).map((entry) => {
    const path = system.paths.find((candidate) => candidate.id === entry.pathId);
    return path
      ? getPathWireAppearance(path, system)
      : getWireAppearance({ tags: [], properties: {} });
  });
  // Tint the connector only when every occupied cavity shares one signal/wire
  // appearance. Mixed signals fall back to the default black/white shell.
  if (appearances.length === 0) return null;

  const first = appearances[0];
  const allMatch = appearances.every((appearance) => appearance.key === first.key);
  return allMatch ? first : null;
}

export function getPathNodeHarnessBundleKey(node: PathNode): string {
  if (node.kind === 'connector') {
    return `connector:${node.connector_id}`;
  }
  return branchPointRefKey(node.branch_point_id);
}

/**
 * Identity of the far side(s) of any branch point this hop meets. Two wires that
 * both go A→branch→B share a key; a wire that goes A→branch→C does not.
 */
export function getSegmentThroughKey(
  path: Pick<Path, 'nodes'>,
  segmentIndex: number,
): string | null {
  const from = path.nodes[segmentIndex];
  const to = path.nodes[segmentIndex + 1];
  if (!from || !to) return null;
  const fars: string[] = [];
  if (from.kind === 'branch' && segmentIndex > 0) {
    fars.push(getPathNodeHarnessBundleKey(path.nodes[segmentIndex - 1]));
  }
  if (to.kind === 'branch' && segmentIndex + 2 < path.nodes.length) {
    fars.push(getPathNodeHarnessBundleKey(path.nodes[segmentIndex + 2]));
  }
  if (fars.length === 0) return null;
  return [...new Set(fars)].sort().join('+');
}

/** Human label for a bundle through-key (`connector:id` / `branch:id`, joined by `+`). */
export function getThroughKeyLabel(system: SystemData, throughKey: string): string {
  return throughKey.split('+').map((part) => {
    if (part.startsWith('connector:')) {
      const connectorId = part.slice('connector:'.length);
      const connector = system.connectors.find((candidate) => candidate.id === connectorId);
      if (!connector) return connectorId;
      return getPathNodeDeviceLabel(system, {
        kind: 'connector',
        connector_id: connectorId,
        pin_number: 1,
      });
    }
    const branchPointId = branchPointIdFromRefKey(part);
    if (branchPointId) {
      return getPathNodeDeviceLabel(system, { kind: 'branch', branch_point_id: branchPointId });
    }
    return part;
  }).join(' / ');
}

/** One occurrence of a branch node inside a path's node list, for separating a branch point. */
export interface BranchPointOccurrence {
  pathId: string;
  nodeIndex: number;
  branchPointId: string;
}

export interface BranchPointHopFamily {
  throughKey: string;
  pathIds: string[];
  label: string;
  occurrences: BranchPointOccurrence[];
}

/** Distinct through-route families that share a branch hop. */
export function getBranchPointWireFamilies(
  system: SystemData,
  bundleId: string,
  pathIds?: Iterable<string>,
): BranchPointHopFamily[] {
  const segments = getHarnessBundleWires(system, bundleId, pathIds);
  const byKey = new Map<string, BranchPointHopFamily>();
  for (const segment of segments) {
    const throughKey = getSegmentThroughKey(segment.path, segment.wireIndex);
    if (!throughKey) continue;
    let family = byKey.get(throughKey);
    if (!family) {
      family = {
        throughKey,
        pathIds: [],
        label: getThroughKeyLabel(system, throughKey),
        occurrences: [],
      };
      byKey.set(throughKey, family);
    }
    if (!family.pathIds.includes(segment.path.id)) family.pathIds.push(segment.path.id);
    if (segment.from.kind === 'branch') {
      family.occurrences.push({
        pathId: segment.path.id,
        nodeIndex: segment.wireIndex,
        branchPointId: segment.from.branch_point_id,
      });
    }
    if (segment.to.kind === 'branch') {
      family.occurrences.push({
        pathId: segment.path.id,
        nodeIndex: segment.wireIndex + 1,
        branchPointId: segment.to.branch_point_id,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label) || a.throughKey.localeCompare(b.throughKey));
}

export interface BranchPointBundleFamilySide {
  refKey: string;
  label: string;
}

/**
 * One distinct physical connection through a branch point: the pair of neighbors
 * on either side (e.g. "Device A ↔ Device B"), and every path that makes that
 * exact connection. Two 12V wires that both run A→branch→B share one family;
 * a wire that runs A→branch→C is a different family.
 */
export interface BranchPointBundleFamily {
  key: string;
  label: string;
  pathIds: string[];
  sides: [BranchPointBundleFamilySide | null, BranchPointBundleFamilySide | null];
  occurrences: BranchPointOccurrence[];
}

const BRANCH_FAMILY_DEAD_END = '∅';

/** Every distinct connection through a branch point, both directions, across all its paths. */
export function getBranchPointHarnessBundleFamilies(
  system: SystemData,
  branchPointId: string,
): BranchPointBundleFamily[] {
  const byKey = new Map<string, BranchPointBundleFamily>();

  for (const path of system.paths) {
    path.nodes.forEach((node, index) => {
      if (node.kind !== 'branch' || node.branch_point_id !== branchPointId) return;
      const prevNode = path.nodes[index - 1];
      const nextNode = path.nodes[index + 1];
      const prevSide: BranchPointBundleFamilySide | null = prevNode
        ? { refKey: getPathNodeHarnessBundleKey(prevNode), label: getPathNodeDeviceLabel(system, prevNode) }
        : null;
      const nextSide: BranchPointBundleFamilySide | null = nextNode
        ? { refKey: getPathNodeHarnessBundleKey(nextNode), label: getPathNodeDeviceLabel(system, nextNode) }
        : null;
      const rawKeys = [prevSide?.refKey ?? BRANCH_FAMILY_DEAD_END, nextSide?.refKey ?? BRANCH_FAMILY_DEAD_END];
      const key = [...rawKeys].sort().join('|');

      let family = byKey.get(key);
      if (!family) {
        const orderedSides: [BranchPointBundleFamilySide | null, BranchPointBundleFamilySide | null] =
          rawKeys[0] <= rawKeys[1] ? [prevSide, nextSide] : [nextSide, prevSide];
        const label = orderedSides
          .map((side) => side?.label ?? 'Dead end')
          .join(' ↔ ');
        family = { key, label, pathIds: [], sides: orderedSides, occurrences: [] };
        byKey.set(key, family);
      }
      if (!family.pathIds.includes(path.id)) family.pathIds.push(path.id);
      family.occurrences.push({ pathId: path.id, nodeIndex: index, branchPointId });
    });
  }

  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}

/**
 * Undo a branch-point fuse: move the exact node occurrences given (from
 * `getBranchPointWireFamilies` / `getBranchPointHarnessBundleFamilies`) off `branchPointId` and
 * onto a brand-new branch point, leaving every other connection through the
 * original branch point untouched. Measurements adjacent to a moved occurrence move
 * with it so hop lengths stay attached to the right run.
 */
export function separateBranchPointOccurrences(
  system: SystemData,
  branchPointId: string,
  occurrences: ReadonlyArray<Pick<BranchPointOccurrence, 'pathId' | 'nodeIndex'>>,
  newBranchPointId: string,
  newName: string,
): SystemData {
  const original = system.branchPoints.find((branchPoint) => branchPoint.id === branchPointId);
  if (!original) return system;
  if (system.branchPoints.some((branchPoint) => branchPoint.id === newBranchPointId)) return system;

  const indicesByPath = new Map<string, Set<number>>();
  for (const occurrence of occurrences) {
    const indices = indicesByPath.get(occurrence.pathId) ?? new Set<number>();
    indices.add(occurrence.nodeIndex);
    indicesByPath.set(occurrence.pathId, indices);
  }
  if (indicesByPath.size === 0) return system;

  const next = structuredClone(system);
  next.branchPoints.push({
    id: newBranchPointId,
    name: newName,
    parent: original.parent,
    tags: [...original.tags],
    properties: { ...original.properties },
  });

  next.paths = next.paths.map((path) => {
    const indices = indicesByPath.get(path.id);
    if (!indices) return path;
    const neighborKeys = new Set<string>();
    let changed = false;
    for (const index of indices) {
      const node = path.nodes[index];
      if (!node || node.kind !== 'branch' || node.branch_point_id !== branchPointId) continue;
      const prev = path.nodes[index - 1];
      const nxt = path.nodes[index + 1];
      if (prev) neighborKeys.add(getPathNodeRefKey(prev));
      if (nxt) neighborKeys.add(getPathNodeRefKey(nxt));
      node.branch_point_id = newBranchPointId;
      changed = true;
    }
    if (!changed) return path;
    return {
      ...path,
      measurements: path.measurements.map((measurement) => {
        const fromIsOld = measurement.from.kind === 'branch' && measurement.from.branch_point_id === branchPointId;
        const toIsOld = measurement.to.kind === 'branch' && measurement.to.branch_point_id === branchPointId;
        if (!fromIsOld && !toIsOld) return measurement;
        const otherRef = fromIsOld ? measurement.to : measurement.from;
        if (!neighborKeys.has(getPathNodeRefKey(otherRef))) return measurement;
        return {
          ...measurement,
          from: fromIsOld ? { ...measurement.from, branch_point_id: newBranchPointId } : measurement.from,
          to: toIsOld ? { ...measurement.to, branch_point_id: newBranchPointId } : measurement.to,
        };
      }),
    };
  });

  return next;
}

/**
 * True when two branch points can be fused into one by dragging: same parent, and
 * no single path already threads through both (which would collapse into an
 * ambiguous loop).
 */
export function canFuseBranchPoints(
  system: Pick<SystemData, 'branchPoints' | 'paths'>,
  sourceId: string,
  targetId: string,
): boolean {
  if (sourceId === targetId) return false;
  const source = system.branchPoints.find((branchPoint) => branchPoint.id === sourceId);
  const target = system.branchPoints.find((branchPoint) => branchPoint.id === targetId);
  if (!source || !target || source.parent !== target.parent) return false;
  for (const path of system.paths) {
    let refsSource = false;
    let refsTarget = false;
    for (const node of path.nodes) {
      if (node.kind !== 'branch') continue;
      if (node.branch_point_id === sourceId) refsSource = true;
      if (node.branch_point_id === targetId) refsTarget = true;
    }
    if (refsSource && refsTarget) return false;
  }
  return true;
}

/**
 * Fuse two branch points into one: every path through `sourceId` is remapped onto
 * `targetId`, tags are unioned onto the survivor, and `sourceId` is removed.
 * The inverse of `separateBranchPointOccurrences`.
 */
export function fuseBranchPoints(
  system: SystemData,
  sourceId: string,
  targetId: string,
): SystemData {
  if (sourceId === targetId) {
    throw new Error('Cannot fuse a branch point into itself');
  }
  const source = system.branchPoints.find((branchPoint) => branchPoint.id === sourceId);
  const target = system.branchPoints.find((branchPoint) => branchPoint.id === targetId);
  if (!source || !target) {
    throw new Error('Both branch points must exist to fuse');
  }
  if (source.parent !== target.parent) {
    throw new Error('Branch points must share the same parent to fuse');
  }
  for (const path of system.paths) {
    let refsSource = false;
    let refsTarget = false;
    for (const node of path.nodes) {
      if (node.kind !== 'branch') continue;
      if (node.branch_point_id === sourceId) refsSource = true;
      if (node.branch_point_id === targetId) refsTarget = true;
    }
    if (refsSource && refsTarget) {
      throw new Error('Cannot fuse branch points that already share a path');
    }
  }

  const next = structuredClone(system);
  const remap = (node: PathNode) => {
    if (node.kind === 'branch' && node.branch_point_id === sourceId) {
      node.branch_point_id = targetId;
    }
  };
  for (const path of next.paths) {
    path.nodes.forEach(remap);
    path.measurements.forEach((measurement) => {
      remap(measurement.from);
      remap(measurement.to);
    });
  }

  next.branchPoints = next.branchPoints
    .map((branchPoint) => branchPoint.id === targetId
      ? { ...branchPoint, tags: [...new Set([...branchPoint.tags, ...source.tags])] }
      : branchPoint)
    .filter((branchPoint) => branchPoint.id !== sourceId);

  return next;
}

export function getHarnessBundleIdForWire(segment: Wire): string {
  const fromKey = getPathNodeHarnessBundleKey(segment.from);
  const toKey = getPathNodeHarnessBundleKey(segment.to);
  return fromKey < toKey
    ? `bundle:${fromKey}|${toKey}`
    : `bundle:${toKey}|${fromKey}`;
}

export function deriveHarnessBundles(segments: Wire[]): HarnessBundle[] {
  const byBundle = new Map<string, HarnessBundle>();
  for (const segment of segments) {
    const id = getHarnessBundleIdForWire(segment);
    const from = getPathNodeHarnessBundleKey(segment.from);
    const to = getPathNodeHarnessBundleKey(segment.to);
    const sourceRefKey = from < to ? from : to;
    const targetRefKey = from < to ? to : from;
    const existing = byBundle.get(id);
    if (existing) {
      existing.wireIds.push(segment.id);
      if (!existing.pathIds.includes(segment.pathId)) {
        existing.pathIds.push(segment.pathId);
      }
      continue;
    }
    byBundle.set(id, {
      id,
      wireIds: [segment.id],
      pathIds: [segment.pathId],
      sourceRefKey,
      targetRefKey,
    });
  }
  return [...byBundle.values()];
}

function getVisibleConnectorIds(
  system: SystemData,
  spaceId: string | null,
): Set<string> {
  const childEnclosures = new Map(
    system.hierarchy
      .filter((enclosure) => enclosure.parent === spaceId)
      .map((enclosure) => [enclosure.id, enclosure]),
  );
  const visible = new Set<string>();
  for (const connector of system.connectors) {
    if (connector.parent === spaceId) {
      visible.add(connector.id);
      continue;
    }
    const parent = connector.parent ? childEnclosures.get(connector.parent) : undefined;
    if (
      parent
      && (parent.kind === 'device' || isBulkheadConnector(system, connector.id))
    ) {
      visible.add(connector.id);
    }
  }
  return visible;
}

function getVisibleBranchPointIds(
  system: SystemData,
  spaceId: string | null,
): Set<string> {
  const childEncIds = new Set(
    system.hierarchy
      .filter((e) => e.parent === spaceId)
      .map((e) => e.id),
  );
  const visible = new Set<string>();
  for (const branchPoint of system.branchPoints) {
    if (branchPoint.parent === spaceId) {
      visible.add(branchPoint.id);
      continue;
    }
    if (branchPoint.parent !== null && childEncIds.has(branchPoint.parent)) {
      visible.add(branchPoint.id);
    }
  }
  return visible;
}

export function getVisibleWires(
  system: SystemData,
  spaceId: string | null,
): Wire[] {
  const visibleConnectorIds = getVisibleConnectorIds(system, spaceId);
  const visibleBranchPointIds = getVisibleBranchPointIds(system, spaceId);
  return deriveWires(system).filter((segment) => {
    const fromVisible = segment.from.kind === 'connector'
      ? visibleConnectorIds.has(segment.from.connector_id)
      : visibleBranchPointIds.has(segment.from.branch_point_id);
    const toVisible = segment.to.kind === 'connector'
      ? visibleConnectorIds.has(segment.to.connector_id)
      : visibleBranchPointIds.has(segment.to.branch_point_id);
    return fromVisible && toVisible;
  });
}

/**
 * Resolve the hierarchy sheet that can render an entity reference. Keep the
 * current sheet when it already contains the target; otherwise prefer the
 * sheet where the target has a concrete node or edge.
 */
export function getEntityRevealContext(
  system: SystemData,
  item: SelectedItem,
  currentSpaceId: string | null,
): string | null {
  if (item.type === 'enclosure') {
    const enclosure = system.hierarchy.find((candidate) => candidate.id === item.id);
    if (!enclosure) return currentSpaceId;
    return enclosure.parent === currentSpaceId ? currentSpaceId : enclosure.parent;
  }

  if (item.type === 'connector') {
    const connector = system.connectors.find((candidate) => candidate.id === item.id);
    if (!connector) return currentSpaceId;
    if (isInlineConnector(system, connector)) {
      return connector.parent;
    }
    const owner = connector.parent
      ? system.hierarchy.find((candidate) => candidate.id === connector.parent)
      : undefined;
    const visibleFromOwner = connector.parent === currentSpaceId;
    const visibleOnParentSheet = owner?.parent === currentSpaceId;
    if (visibleFromOwner || visibleOnParentSheet) return currentSpaceId;
    return owner ? owner.parent : connector.parent;
  }

  if (item.type === 'branchPoint') {
    const branchPoint = system.branchPoints.find((candidate) => candidate.id === item.id);
    if (!branchPoint) return currentSpaceId;
    return branchPoint.parent === currentSpaceId ? currentSpaceId : branchPoint.parent;
  }

  const matchingPathIds = item.type === 'path'
    ? new Set([item.id])
    : new Set(
        system.paths
          .filter((path) => getPathSignalId(path) === item.id)
          .map((path) => path.id),
      );
  if (matchingPathIds.size === 0) return currentSpaceId;

  const sheetContainsTarget = (spaceId: string | null) =>
    getVisibleWires(system, spaceId).some((segment) => matchingPathIds.has(segment.pathId));
  if (sheetContainsTarget(currentSpaceId)) return currentSpaceId;

  const contexts: Array<string | null> = [
    null,
    ...system.hierarchy.map((enclosure) => enclosure.id),
  ];
  return contexts.find(sheetContainsTarget) ?? currentSpaceId;
}

export function countPathsTouchingConnectors(
  system: SystemData,
  connectorIds: Iterable<string>,
): number {
  const connectorIdSet = new Set(connectorIds);
  let count = 0;
  for (const path of system.paths) {
    if (path.nodes.some((node) => node.kind === 'connector' && connectorIdSet.has(node.connector_id))) {
      count++;
    }
  }
  return count;
}

export function getPathById(
  system: SystemData,
  pathId: string,
): Path | undefined {
  return system.paths.find((path) => path.id === pathId);
}

/**
 * Pick the next unused `bp_NNN` id. Existing `mp_*` ids are left untouched.
 */
export function nextBranchPointId(system: SystemData): string {
  let max = 0;
  for (const point of system.branchPoints) {
    const match = /^(?:bp|mp)_(\d+)$/.exec(point.id);
    if (!match) continue;
    const num = Number(match[1]);
    if (Number.isFinite(num) && num > max) max = num;
  }
  return `bp_${String(max + 1).padStart(3, '0')}`;
}

/** Default display name for a newly created Branch Point. */
export function nextBranchPointName(system: SystemData): string {
  let max = 0;
  for (const point of system.branchPoints) {
    const match = /^Branch (\d+)$/.exec(point.name);
    if (!match) continue;
    const num = Number(match[1]);
    if (Number.isFinite(num) && num > max) max = num;
  }
  return `Branch ${max + 1}`;
}

/**
 * Graph wire groups may append `#handle|handle` when connectors are pin-expanded,
 * and `~thru:farKey` when a branch hop is split into distinct through-route families.
 * Segment lookups use the base endpoint-pair id only.
 */
export const BUNDLE_THRU_SEP = '~thru:';

/** Strip pin-handle suffixes; keep a branch through-family suffix. */
export function getHarnessBundleLayoutId(bundleId: string): string {
  const hash = bundleId.indexOf('#');
  return hash >= 0 ? bundleId.slice(0, hash) : bundleId;
}

export function getBaseHarnessBundleId(bundleId: string): string {
  const layoutId = getHarnessBundleLayoutId(bundleId);
  const thru = layoutId.indexOf(BUNDLE_THRU_SEP);
  return thru >= 0 ? layoutId.slice(0, thru) : layoutId;
}

export function parseHarnessBundleThruKey(bundleId: string): string | null {
  const layoutId = getHarnessBundleLayoutId(bundleId);
  const thru = layoutId.indexOf(BUNDLE_THRU_SEP);
  if (thru < 0) return null;
  const key = layoutId.slice(thru + BUNDLE_THRU_SEP.length);
  return key || null;
}

export function harnessBundleIdWithThru(baseId: string, throughKey: string): string {
  return `${getBaseHarnessBundleId(baseId)}${BUNDLE_THRU_SEP}${throughKey}`;
}

/**
 * Canonical bundle/ref key: `merge:` → `branch:`, and `bundle:a|b` pairs (and
 * `+`-joined through-keys) are sorted so lookups survive the prefix change.
 */
export function canonicalizeHarnessBundleId(bundleId: string): string {
  const rewritten = canonicalizeRefKey(bundleId);
  const hash = rewritten.indexOf('#');
  const pinSuffix = hash >= 0 ? rewritten.slice(hash) : '';
  const layoutId = hash >= 0 ? rewritten.slice(0, hash) : rewritten;
  if (!layoutId.startsWith('bundle:')) return rewritten;
  const thruIdx = layoutId.indexOf(BUNDLE_THRU_SEP);
  const base = thruIdx >= 0 ? layoutId.slice(0, thruIdx) : layoutId;
  const thru = thruIdx >= 0 ? layoutId.slice(thruIdx + BUNDLE_THRU_SEP.length) : null;
  const body = base.slice('bundle:'.length);
  const pipe = body.indexOf('|');
  if (pipe < 0) return rewritten;
  const a = body.slice(0, pipe);
  const b = body.slice(pipe + 1);
  if (!a || !b) return rewritten;
  const [left, right] = a <= b ? [a, b] : [b, a];
  let next = `bundle:${left}|${right}`;
  if (thru) {
    const thruCanonical = thru.includes('+')
      ? thru.split('+').map(canonicalizeRefKey).sort().join('+')
      : canonicalizeRefKey(thru);
    next += `${BUNDLE_THRU_SEP}${thruCanonical}`;
  }
  return next + pinSuffix;
}

export function isGraphPinHandle(handle: string | null | undefined): boolean {
  return typeof handle === 'string' && handle.startsWith('pin:');
}

/**
 * Pin-expanded edges change id (`…#pin:1|`); family-split branch hops change
 * id (`…~thru:connector:c`). Waypoint / route-style layouts prefer the family
 * key, then the collapsed hop pair.
 */
export function getHarnessBundleLayoutValue<T>(
  map: Record<string, T> | undefined,
  bundleId: string,
): T | undefined {
  if (!map) return undefined;
  const layoutId = getHarnessBundleLayoutId(bundleId);
  const base = getBaseHarnessBundleId(bundleId);
  const canonical = canonicalizeHarnessBundleId(bundleId);
  const candidates = [
    bundleId,
    layoutId,
    base,
    canonical,
    getHarnessBundleLayoutId(canonical),
    getBaseHarnessBundleId(canonical),
  ];
  for (const key of candidates) {
    if (key in map) return map[key];
    const asBranch = key.replaceAll(LEGACY_MERGE_REF_PREFIX, BRANCH_REF_PREFIX);
    if (asBranch !== key && asBranch in map) return map[asBranch];
    const asLegacy = key.replaceAll(BRANCH_REF_PREFIX, LEGACY_MERGE_REF_PREFIX);
    if (asLegacy !== key && asLegacy in map) return map[asLegacy];
  }
  return undefined;
}

/**
 * Inverse of `getHarnessBundleIdForWire`.  Returns the two endpoint ref keys, or
 * null when the id does not match the current bundle format.
 */
export function parseHarnessBundleId(
  bundleId: string,
): { sourceRefKey: string; targetRefKey: string } | null {
  const baseId = getBaseHarnessBundleId(bundleId);
  if (!baseId.startsWith('bundle:')) return null;
  const body = baseId.slice('bundle:'.length);
  const pipe = body.indexOf('|');
  if (pipe < 0) return null;
  const a = body.slice(0, pipe);
  const b = body.slice(pipe + 1);
  if (!a || !b) return null;
  return { sourceRefKey: a, targetRefKey: b };
}

export interface HarnessBundleWire {
  path: Path;
  wireIndex: number;
  from: PathNode;
  to: PathNode;
}

/** Segments that make up a graph bundle (one hop per path, often connector↔branch). */
export function getHarnessBundleWires(
  system: SystemData,
  bundleId: string,
  pathIds?: Iterable<string>,
): HarnessBundleWire[] {
  const pathIdSet = pathIds ? new Set(pathIds) : null;
  const matches: HarnessBundleWire[] = [];
  for (const path of system.paths) {
    if (pathIdSet && !pathIdSet.has(path.id)) continue;
    const match = findPathWireForHarnessBundle(path, bundleId);
    if (!match) continue;
    const from = path.nodes[match.index];
    const to = path.nodes[match.index + 1];
    if (!from || !to) continue;
    matches.push({ path, wireIndex: match.index, from, to });
  }
  return matches;
}

/**
 * Find the segment (consecutive node pair) in `path` whose bundle id matches
 * `bundleId`.  `reversed` indicates the path traverses the segment from the
 * bundle's target key toward its source key.  Returns null when the path does
 * not cross this Harness Bundle.
 */
export function findPathWireForHarnessBundle(
  path: Path,
  bundleId: string,
): { index: number; reversed: boolean } | null {
  const parsed = parseHarnessBundleId(canonicalizeHarnessBundleId(bundleId));
  if (!parsed) return null;
  for (let index = 0; index < path.nodes.length - 1; index++) {
    const from = path.nodes[index];
    const to = path.nodes[index + 1];
    const fromKey = canonicalizeRefKey(getPathNodeHarnessBundleKey(from));
    const toKey = canonicalizeRefKey(getPathNodeHarnessBundleKey(to));
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
 * and then refuses the whole save. Length is halved (the branch point's true position
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
 * Insert a branch-point node into a path's node list inside the segment that
 * matches `bundleId`.  Because promoting a shared anchor always splits its Harness Bundle
 * into sub-bundles (so no two coupled merges ever coexist on the same
 * segment), we always insert directly between the two endpoint nodes.
 * Any measurement recorded for that segment is split across the two new hops.
 * Returns a new Path with updated `nodes[]`; the original is not mutated.
 */
export function insertBranchPointOnPath(
  path: Path,
  bundleId: string,
  branchPointId: string,
): Path {
  const match = findPathWireForHarnessBundle(path, bundleId);
  if (!match) return path;
  const thru = parseHarnessBundleThruKey(bundleId);
  if (thru) {
    const pathThru = getSegmentThroughKey(path, match.index);
    if (pathThru !== thru) return path;
  }
  const mid: PathNode = { kind: 'branch', branch_point_id: branchPointId };
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
export function insertConnectorOnPath(
  path: Path,
  bundleId: string,
  connectorId: string,
  pinNumber: number,
): Path {
  const match = findPathWireForHarnessBundle(path, bundleId);
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
  system: SystemData,
  connectorId: string,
): SystemData {
  if (!system.connectors.some((connector) => connector.id === connectorId)) {
    return system;
  }
  const paths = system.paths
    .map((path) => removeConnectorFromPath(path, connectorId))
    .filter((path) => path.nodes.length >= 2);
  return {
    ...system,
    connectors: system.connectors.filter((connector) => connector.id !== connectorId),
    paths,
  };
}

/**
 * Remove every reference to `branchPointId` from a path's node list.  Returns a
 * new Path even when nothing changed, to keep call sites simple.
 */
export function removeBranchFromPath(path: Path, branchPointId: string): Path {
  let next = path;
  for (let index = next.nodes.length - 1; index >= 0; index -= 1) {
    const node = next.nodes[index];
    if (node.kind === 'branch' && node.branch_point_id === branchPointId) {
      next = removePathNodeAt(next, index);
    }
  }
  return next;
}

/**
 * Delete a branch point and reconnect whatever was on either side, as if it
 * never existed:
 * - Through-paths (`A → branch → B`) become `A → B`.
 * - Exactly two stub paths that only meet at the branch point are stitched into one
 *   continuous path.
 * - Unpairable stubs (0 or 3+ one-sided remnants) are dropped.
 * - The runs on either side of the branch point are folded back into one measurement.
 */
export function dissolveBranchPoint(system: SystemData, branchPointId: string): SystemData {
  if (!system.branchPoints.some((branchPoint) => branchPoint.id === branchPointId)) {
    return system;
  }

  type Stub = { path: Path; nodes: PathNode[]; mergeAtStart: boolean };
  const stubs: Stub[] = [];
  const nextPaths: Path[] = [];

  for (const path of system.paths) {
    const mergeIndexes: number[] = [];
    for (let index = 0; index < path.nodes.length; index += 1) {
      const node = path.nodes[index];
      if (node.kind === 'branch' && node.branch_point_id === branchPointId) {
        mergeIndexes.push(index);
      }
    }
    if (mergeIndexes.length === 0) {
      nextPaths.push(path);
      continue;
    }

    const stripped = removeBranchFromPath(path, branchPointId);
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
    ...system,
    branchPoints: system.branchPoints.filter((branchPoint) => branchPoint.id !== branchPointId),
    paths: nextPaths,
  };
}

export function renumberConnectorPins(
  system: SystemData,
  connectorId: string,
  orderedOldPinNumbers: number[],
): SystemData {
  const mapping = new Map(orderedOldPinNumbers.map((oldPin, index) => [oldPin, index + 1]));
  if (mapping.size !== orderedOldPinNumbers.length) {
    throw new Error('Cavity order must contain each physical cavity exactly once');
  }
  const next = structuredClone(system);
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
 * True when two connectors can be absorbed into one by overlapping them:
 * same parent, same pass-through role (inline or bulkhead), and no shared path.
 */
export function canMergePassThroughConnectors(
  system: Pick<SystemData, 'connectors' | 'hierarchy' | 'paths'>,
  sourceId: string,
  targetId: string,
): boolean {
  if (sourceId === targetId) return false;
  const source = system.connectors.find((connector) => connector.id === sourceId);
  const target = system.connectors.find((connector) => connector.id === targetId);
  if (!source || !target || source.parent !== target.parent) return false;
  if (
    (isBulkheadDot(source) && !isTerminalVisualDot(system, sourceId))
    || (isBulkheadDot(target) && !isTerminalVisualDot(system, targetId))
  ) {
    return false;
  }
  const sourceRole = getConnectorRole(system, source);
  const targetRole = getConnectorRole(system, target);
  if (
    sourceRole !== targetRole
    || (sourceRole !== 'inline' && sourceRole !== 'bulkhead')
  ) {
    return false;
  }
  for (const wirePath of system.paths) {
    let refsSource = false;
    let refsTarget = false;
    for (const node of wirePath.nodes) {
      if (node.kind !== 'connector') continue;
      if (node.connector_id === sourceId) refsSource = true;
      if (node.connector_id === targetId) refsTarget = true;
    }
    if (refsSource && refsTarget) return false;
  }
  return true;
}

/**
 * Absorb `sourceId` into `targetId`: remap every path/measurement cavity on the
 * source onto free cavities on the target, grow the target's pin_count as needed,
 * then delete the source connector. Both connectors must share a parent.
 */
export function mergeConnectors(
  system: SystemData,
  sourceId: string,
  targetId: string,
  options: MergeConnectorsOptions = {},
): SystemData {
  if (sourceId === targetId) {
    throw new Error('Cannot merge a connector into itself');
  }
  const source = system.connectors.find((connector) => connector.id === sourceId);
  const target = system.connectors.find((connector) => connector.id === targetId);
  if (!source || !target) {
    throw new Error('Both connectors must exist to merge');
  }
  if (source.parent !== target.parent) {
    throw new Error('Connectors must share the same parent enclosure to merge');
  }

  for (const wirePath of system.paths) {
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
    getConnectorOccupancy(system, sourceId).map((entry) => entry.pinNumber),
  )].sort((left, right) => left - right);

  const usedPins = new Set(
    getConnectorOccupancy(system, targetId).map((entry) => entry.pinNumber),
  );
  const pinMapping = new Map<number, number>();
  let cursor = 1;
  for (const oldPin of sourcePins) {
    while (usedPins.has(cursor)) cursor += 1;
    pinMapping.set(oldPin, cursor);
    usedPins.add(cursor);
    cursor += 1;
  }

  const next = structuredClone(system);
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

export type HierarchyEntityKind = 'enclosure' | 'connector' | 'branchPoint';

/**
 * Move an enclosure, connector, or branch point to a new parent and/or sibling
 * position. Sibling order is array order among entities that share the same
 * `parent`. `beforeId` inserts immediately before that same-kind sibling under
 * the new parent; `null` appends after the last sibling.
 */
export function moveHierarchyEntity(
  system: SystemData,
  type: HierarchyEntityKind,
  id: string,
  newParentId: string | null,
  beforeId: string | null = null,
): SystemData {
  if (beforeId === id) {
    throw new Error('Cannot insert an entity before itself.');
  }

  if (newParentId !== null) {
    const parent = system.hierarchy.find((item) => item.id === newParentId);
    if (!parent) {
      throw new Error('Target parent does not exist.');
    }
    if (type === 'enclosure' && parent.kind === 'device') {
      throw new Error('Devices and enclosures can only be placed inside an enclosure.');
    }
  }

  const items =
    type === 'enclosure' ? system.hierarchy
      : type === 'connector' ? system.connectors
        : system.branchPoints;
  const fromIndex = items.findIndex((item) => item.id === id);
  if (fromIndex < 0) {
    throw new Error(
      type === 'enclosure' ? 'Enclosure not found.'
        : type === 'connector' ? 'Connector not found.'
          : 'Branch point not found.',
    );
  }

  if (type === 'enclosure') {
    if (newParentId === id) {
      throw new Error('An enclosure cannot be placed inside itself.');
    }
    if (newParentId !== null) {
      const parentById = new Map(system.hierarchy.map((item) => [item.id, item.parent]));
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
      if (siblings.at(-1)?.id === id) return system;
    } else {
      const beforeSiblingIndex = siblings.findIndex((item) => item.id === beforeId);
      if (
        beforeSiblingIndex >= 0
        && (beforeSiblingIndex === currentSiblingIndex || beforeSiblingIndex === currentSiblingIndex + 1)
      ) {
        return system;
      }
    }
  }

  const next = structuredClone(system);
  const nextItems =
    type === 'enclosure' ? next.hierarchy
      : type === 'connector' ? next.connectors
        : next.branchPoints;
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
