/**
 * Dual-read / canonical-write adapters for the domain model.
 *
 * In-memory and on-disk canonical names:
 *   SystemData.hierarchy / kind, branchPoints, kind:'branch', sharedAnchors,
 *   SheetBoundaryPort, mounting explicit, openEnclosureId.
 *
 * Legacy names are accepted only here (and other *Normalize helpers).
 */
import type {
  BranchPoint,
  BranchPointLayouts,
  Connector,
  Device,
  Enclosure,
  HierarchyEntity,
  ManufacturingBundleProgress,
  ManufacturingDocument,
  ManufacturingWorkEvent,
  Path,
  PathMeasurement,
  PathNode,
  PathNodeRef,
  SharedAnchorLayout,
  SharedAnchorLayouts,
  SystemData,
  WaypointItem,
  WaypointLayouts,
} from '../types';
import type {
  CollaborationDocumentState,
  CollaborationLayouts,
  LayoutPatch,
  LayoutRemovedKeys,
  PeerPresence,
  PresenceTarget,
  PresenceTargetKind,
  PresenceUpdate,
} from '../types/collab';
import { canonicalizeHarnessBundleId } from './systemTopology';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asProperties(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const next: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') next[key] = entry;
  }
  return next;
}

export function isEnclosure(entity: HierarchyEntity): entity is Enclosure {
  return entity.kind === 'enclosure';
}

export function isDevice(entity: HierarchyEntity): entity is Device {
  return entity.kind === 'device';
}

export function findHierarchyEntity(
  system: Pick<SystemData, 'hierarchy'>,
  id: string | null | undefined,
): HierarchyEntity | undefined {
  if (!id) return undefined;
  return system.hierarchy.find((entity) => entity.id === id);
}

function hierarchyKindFromLegacy(raw: JsonRecord): 'device' | 'enclosure' {
  if (raw.kind === 'device' || raw.kind === 'enclosure') return raw.kind;
  if (raw.container === false) return 'device';
  return 'enclosure';
}

function normalizeHierarchyEntity(raw: unknown): HierarchyEntity | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const base = {
    id: raw.id,
    name: asString(raw.name, raw.id),
    parent: typeof raw.parent === 'string' ? raw.parent : null,
    tags: asStringArray(raw.tags),
    properties: asProperties(raw.properties),
  };
  const kind = hierarchyKindFromLegacy(raw);
  return kind === 'device'
    ? { ...base, kind: 'device' }
    : { ...base, kind: 'enclosure' };
}

function collectHierarchy(raw: JsonRecord): HierarchyEntity[] {
  const source = Array.isArray(raw.hierarchy)
    ? raw.hierarchy
    : Array.isArray(raw.enclosures)
      ? raw.enclosures
      : [];
  const entities: HierarchyEntity[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    const entity = normalizeHierarchyEntity(item);
    if (!entity || seen.has(entity.id)) continue;
    seen.add(entity.id);
    entities.push(entity);
  }

  if (Array.isArray(raw.pcbs)) {
    for (const pcb of raw.pcbs) {
      if (!isRecord(pcb) || typeof pcb.id !== 'string' || seen.has(pcb.id)) continue;
      const entity = normalizeHierarchyEntity({ ...pcb, kind: 'device', container: false });
      if (!entity) continue;
      seen.add(entity.id);
      entities.push(entity);
    }
  }
  return entities;
}

function enclosureIdsOf(hierarchy: HierarchyEntity[]): Set<string> {
  return new Set(hierarchy.filter(isEnclosure).map((entity) => entity.id));
}

function normalizeMounting(
  raw: JsonRecord,
  parent: string | null,
  enclosureIds: Set<string>,
): Connector['mounting'] {
  if (raw.mounting === 'inline' || raw.mounting === 'bulkhead') return raw.mounting;
  if (parent && enclosureIds.has(parent)) return 'bulkhead';
  return undefined;
}

function normalizeConnector(raw: unknown, enclosureIds: Set<string>): Connector | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const parent = typeof raw.parent === 'string' ? raw.parent : null;
  const connector: Connector = {
    id: raw.id,
    name: asString(raw.name, raw.id),
    parent,
    connector_type: asString(raw.connector_type),
    tags: asStringArray(raw.tags),
    properties: asProperties(raw.properties),
  };
  const mounting = normalizeMounting(raw, parent, enclosureIds);
  if (mounting) connector.mounting = mounting;
  if (typeof raw.pin_count === 'number') connector.pin_count = raw.pin_count;
  if (typeof raw.keying === 'string') connector.keying = raw.keying;
  if (raw.derived === true) connector.derived = true;
  if (typeof raw.derived_from_port === 'string') connector.derived_from_port = raw.derived_from_port;
  return connector;
}

function branchPointIdFromRaw(raw: JsonRecord): string | undefined {
  if (typeof raw.branch_point_id === 'string') return raw.branch_point_id;
  if (typeof raw.merge_point_id === 'string') return raw.merge_point_id;
  return undefined;
}

function normalizeBranchPoint(raw: unknown): BranchPoint | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const rawName = asString(raw.name, raw.id);
  const defaultNameMatch = /^Splice (\d+)$/.exec(rawName);
  const point: BranchPoint = {
    id: raw.id,
    name: defaultNameMatch ? `Branch ${defaultNameMatch[1]}` : rawName,
    parent: typeof raw.parent === 'string' ? raw.parent : null,
    tags: asStringArray(raw.tags),
    properties: asProperties(raw.properties),
  };
  if (raw.derived === true) point.derived = true;
  if (typeof raw.derived_from_port === 'string') point.derived_from_port = raw.derived_from_port;
  return point;
}

export function isBranchPathNode(
  node: PathNode | PathNodeRef | { kind?: string },
): node is { kind: 'branch'; branch_point_id: string } {
  return node.kind === 'branch';
}

export function normalizePathNode(raw: unknown): PathNode | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === 'connector' || typeof raw.connector_id === 'string') {
    if (typeof raw.connector_id !== 'string') return null;
    const pin = typeof raw.pin_number === 'number' && Number.isInteger(raw.pin_number) && raw.pin_number > 0
      ? raw.pin_number
      : 1;
    return { kind: 'connector', connector_id: raw.connector_id, pin_number: pin };
  }
  if (raw.kind === 'branch' || raw.kind === 'merge') {
    const id = branchPointIdFromRaw(raw);
    if (!id) return null;
    return { kind: 'branch', branch_point_id: id };
  }
  return null;
}

function normalizePathMeasurement(
  raw: unknown,
  legacyNodeById: Map<string, PathNode>,
): PathMeasurement | null {
  if (!isRecord(raw)) return null;
  let from = normalizePathNode(raw.from);
  let to = normalizePathNode(raw.to);
  if ((!from || !to) && typeof raw.from_node_id === 'string' && typeof raw.to_node_id === 'string') {
    from = legacyNodeById.get(raw.from_node_id) ?? null;
    to = legacyNodeById.get(raw.to_node_id) ?? null;
  }
  if (!from || !to) return null;
  const measurement: PathMeasurement = { from, to };
  if (typeof raw.length_mm === 'number') measurement.length_mm = raw.length_mm;
  if (typeof raw.note === 'string') measurement.note = raw.note;
  return measurement;
}

function normalizePath(raw: unknown): Path | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const legacyNodeById = new Map<string, PathNode>();
  const nodes: PathNode[] = [];
  for (const item of rawNodes) {
    const node = normalizePathNode(item);
    if (!node) continue;
    nodes.push(node);
    if (isRecord(item) && typeof item.id === 'string') legacyNodeById.set(item.id, node);
  }
  const measurements: PathMeasurement[] = [];
  if (Array.isArray(raw.measurements)) {
    for (const item of raw.measurements) {
      const measurement = normalizePathMeasurement(item, legacyNodeById);
      if (measurement) measurements.push(measurement);
    }
  }
  const path: Path = {
    id: raw.id,
    name: asString(raw.name, raw.id),
    tags: asStringArray(raw.tags),
    properties: asProperties(raw.properties),
    nodes,
    measurements,
  };
  if (typeof raw.signal_id === 'string') path.signal_id = raw.signal_id;
  return path;
}

function collectBranchPoints(raw: JsonRecord): BranchPoint[] {
  const source = Array.isArray(raw.branchPoints)
    ? raw.branchPoints
    : Array.isArray(raw.mergePoints)
      ? raw.mergePoints
      : [];
  const points: BranchPoint[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    const point = normalizeBranchPoint(item);
    if (!point || seen.has(point.id)) continue;
    seen.add(point.id);
    points.push(point);
  }
  return points;
}

export function emptySystemData(schemaVersion = '0.3.0'): SystemData {
  return {
    schema_version: schemaVersion,
    hierarchy: [],
    connectors: [],
    branchPoints: [],
    paths: [],
    signals: [],
    signalPropertyDefinitions: [],
  };
}

/** Dual-read any legacy or canonical system payload into canonical SystemData. */
export function normalizeSystemData(raw: unknown): SystemData {
  const record = isRecord(raw) ? raw : {};
  const hierarchy = collectHierarchy(record);
  const enclosureIds = enclosureIdsOf(hierarchy);
  const connectors: Connector[] = [];
  if (Array.isArray(record.connectors)) {
    for (const item of record.connectors) {
      const connector = normalizeConnector(item, enclosureIds);
      if (connector) connectors.push(connector);
    }
  }
  const signals = Array.isArray(record.signals)
    ? record.signals.flatMap((item) => {
        if (!isRecord(item) || typeof item.id !== 'string') return [];
        return [{
          id: item.id,
          name: asString(item.name, item.id),
          tags: asStringArray(item.tags),
          properties: asProperties(item.properties),
        }];
      })
    : [];
  const signalPropertyDefinitions = Array.isArray(record.signalPropertyDefinitions)
    ? record.signalPropertyDefinitions.flatMap((item) => {
        if (!isRecord(item) || typeof item.id !== 'string') return [];
        return [{
          id: item.id,
          key: asString(item.key),
          name: asString(item.name, asString(item.key)),
          type: 'select' as const,
          options: asStringArray(item.options),
        }];
      })
    : [];
  const paths: Path[] = [];
  if (Array.isArray(record.paths)) {
    for (const item of record.paths) {
      const path = normalizePath(item);
      if (path) paths.push(path);
    }
  }
  const system: SystemData = {
    schema_version: '0.3.0',
    hierarchy,
    connectors,
    branchPoints: collectBranchPoints(record),
    paths,
    signals,
    signalPropertyDefinitions,
  };
  if (typeof record.name === 'string' && record.name.trim()) system.name = record.name.trim();
  return system;
}

export function rewriteLegacyRefKey(key: string): string {
  return canonicalizeHarnessBundleId(key);
}

function rewriteMapKeys<T>(map: Record<string, T>): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(map)) {
    next[rewriteLegacyRefKey(key)] = value;
  }
  return next;
}

function normalizeWaypointItem(raw: unknown): WaypointItem | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.sharedAnchorId === 'string') return { sharedAnchorId: raw.sharedAnchorId };
  if (typeof raw.junctionId === 'string') return { sharedAnchorId: raw.junctionId };
  if (typeof raw.x === 'number' && typeof raw.y === 'number') return { x: raw.x, y: raw.y };
  return null;
}

function normalizeWaypointLayouts(raw: unknown): WaypointLayouts {
  if (!isRecord(raw)) return {};
  const next: WaypointLayouts = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) continue;
    next[rewriteLegacyRefKey(key)] = value.flatMap((item) => {
      const waypoint = normalizeWaypointItem(item);
      return waypoint ? [waypoint] : [];
    });
  }
  return next;
}

function normalizeSharedAnchor(raw: unknown, fallbackId: string): SharedAnchorLayout | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id : fallbackId;
  const memberEdgeIds = Array.isArray(raw.memberEdgeIds)
    ? raw.memberEdgeIds
      .filter((item): item is string => typeof item === 'string')
      .map(rewriteLegacyRefKey)
    : [];
  const layout: SharedAnchorLayout = {
    id,
    x: typeof raw.x === 'number' ? raw.x : 0,
    y: typeof raw.y === 'number' ? raw.y : 0,
    memberEdgeIds,
  };
  const branchPointId = typeof raw.branchPointId === 'string'
    ? raw.branchPointId
    : typeof raw.mergePointId === 'string'
      ? raw.mergePointId
      : undefined;
  if (branchPointId) layout.branchPointId = branchPointId;
  return layout;
}

function collectSharedAnchors(raw: JsonRecord): SharedAnchorLayouts {
  const source = isRecord(raw.sharedAnchors)
    ? raw.sharedAnchors
    : isRecord(raw.junctions)
      ? raw.junctions
      : {};
  const next: SharedAnchorLayouts = {};
  for (const [id, value] of Object.entries(source)) {
    const layout = normalizeSharedAnchor(value, id);
    if (layout) next[layout.id] = layout;
  }
  return next;
}

function collectBranchPointLayouts(raw: JsonRecord): BranchPointLayouts {
  const source = isRecord(raw.branchPoints)
    ? raw.branchPoints
    : isRecord(raw.mergePoints)
      ? raw.mergePoints
      : {};
  const next: BranchPointLayouts = {};
  for (const [contextKey, value] of Object.entries(source)) {
    if (!isRecord(value)) continue;
    const context: Record<string, { x: number; y: number }> = {};
    for (const [id, point] of Object.entries(value)) {
      if (!isRecord(point)) continue;
      context[id] = {
        x: typeof point.x === 'number' ? point.x : 0,
        y: typeof point.y === 'number' ? point.y : 0,
      };
    }
    next[contextKey] = context;
  }
  return next;
}

export function emptyLayouts(): CollaborationLayouts {
  return {
    nodes: {},
    ports: {},
    sizes: {},
    free: {},
    backgrounds: {},
    images: {},
    connectorTypeSizes: {},
    textBoxes: {},
    waypoints: {},
    sharedAnchors: {},
    branchPoints: {},
    rotations: {},
    routeStyles: {},
    viewRouteStyles: {},
  };
}

function asStringKeyedRecord<T>(raw: unknown, mapValue: (value: unknown) => T | undefined): Record<string, T> {
  if (!isRecord(raw)) return {};
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(raw)) {
    const mapped = mapValue(value);
    if (mapped !== undefined) next[key] = mapped;
  }
  return next;
}

/** Dual-read layouts (junctions/mergePoints/junctionId) into canonical shared anchors. */
export function normalizeLayouts(raw: unknown): CollaborationLayouts {
  const record = isRecord(raw) ? raw : {};
  const empty = emptyLayouts();
  const routeStyles = asStringKeyedRecord(record.routeStyles, (value) => (
    value === 'grid' || value === 'straight' ? value : undefined
  ));
  return {
    nodes: isRecord(record.nodes) ? record.nodes as CollaborationLayouts['nodes'] : empty.nodes,
    ports: isRecord(record.ports) ? record.ports as CollaborationLayouts['ports'] : empty.ports,
    sizes: isRecord(record.sizes) ? record.sizes as CollaborationLayouts['sizes'] : empty.sizes,
    free: isRecord(record.free) ? record.free as CollaborationLayouts['free'] : empty.free,
    backgrounds: isRecord(record.backgrounds)
      ? record.backgrounds as CollaborationLayouts['backgrounds']
      : empty.backgrounds,
    images: isRecord(record.images) ? record.images as CollaborationLayouts['images'] : empty.images,
    connectorTypeSizes: isRecord(record.connectorTypeSizes)
      ? record.connectorTypeSizes as CollaborationLayouts['connectorTypeSizes']
      : empty.connectorTypeSizes,
    textBoxes: isRecord(record.textBoxes)
      ? record.textBoxes as CollaborationLayouts['textBoxes']
      : empty.textBoxes,
    waypoints: normalizeWaypointLayouts(record.waypoints),
    sharedAnchors: collectSharedAnchors(record),
    branchPoints: collectBranchPointLayouts(record),
    rotations: isRecord(record.rotations)
      ? record.rotations as CollaborationLayouts['rotations']
      : empty.rotations,
    routeStyles: rewriteMapKeys(routeStyles),
    viewRouteStyles: isRecord(record.viewRouteStyles)
      ? record.viewRouteStyles as CollaborationLayouts['viewRouteStyles']
      : empty.viewRouteStyles,
  };
}

function normalizePresenceTargetKind(raw: unknown): PresenceTargetKind | null {
  if (raw === 'mergePoint' || raw === 'branchPoint') return 'branchPoint';
  if (raw === 'bundle' || raw === 'harness' || raw === 'harnessBundle') return 'harnessBundle';
  if (
    raw === 'enclosure'
    || raw === 'connector'
    || raw === 'path'
    || raw === 'signal'
    || raw === 'connectorType'
    || raw === 'subsystem'
    || raw === 'textBox'
    || raw === 'image'
  ) return raw;
  return null;
}

export function normalizePresenceTarget(raw: unknown): PresenceTarget | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  const kind = normalizePresenceTargetKind(raw.kind);
  if (!kind) return null;
  const target: PresenceTarget = { kind, id: raw.id };
  if (typeof raw.field === 'string') target.field = raw.field;
  return target;
}

export function normalizePeerPresence(raw: unknown, fallbackSystem = ''): PeerPresence | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.sessionId !== 'string' || typeof raw.userId !== 'string') return null;
  const system = asString(raw.system) || asString(raw.harness, fallbackSystem);
  const openEnclosureId = raw.openEnclosureId === undefined && raw.currentEnclosureId === undefined
    ? asNullableString(raw.drillDownEnclosure)
    : asNullableString(raw.openEnclosureId ?? raw.currentEnclosureId);
  return {
    sessionId: raw.sessionId,
    userId: raw.userId,
    displayName: asString(raw.displayName),
    color: asString(raw.color),
    system,
    appView: (raw.appView as PeerPresence['appView']) ?? 'canvas',
    editingSurface: raw.editingSurface === 'subsystem' ? 'subsystem' : 'hierarchy',
    openEnclosureId,
    activeSubsystemId: asNullableString(raw.activeSubsystemId),
    focus: normalizePresenceTarget(raw.focus),
    editing: normalizePresenceTarget(raw.editing),
    lastSeen: typeof raw.lastSeen === 'number' ? raw.lastSeen : 0,
  };
}

export function normalizePresenceUpdate(raw: unknown): PresenceUpdate {
  if (!isRecord(raw)) return {};
  const update: PresenceUpdate = {};
  if (raw.appView !== undefined) update.appView = raw.appView as PresenceUpdate['appView'];
  if (raw.editingSurface !== undefined) {
    update.editingSurface = raw.editingSurface as PresenceUpdate['editingSurface'];
  }
  if (raw.openEnclosureId !== undefined || raw.currentEnclosureId !== undefined || raw.drillDownEnclosure !== undefined) {
    update.openEnclosureId = asNullableString(
      raw.openEnclosureId ?? raw.currentEnclosureId ?? raw.drillDownEnclosure,
    );
  }
  if (raw.activeSubsystemId !== undefined) {
    update.activeSubsystemId = asNullableString(raw.activeSubsystemId);
  }
  if (raw.focus !== undefined) update.focus = normalizePresenceTarget(raw.focus);
  if (raw.editing !== undefined) update.editing = normalizePresenceTarget(raw.editing);
  return update;
}

function normalizeWorkEvent(raw: unknown): ManufacturingWorkEvent | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  const kind = raw.kind === 'splice-measured' ? 'branch-measured' : raw.kind;
  if (
    kind !== 'wire-cut'
    && kind !== 'wire-end'
    && kind !== 'branch-measured'
    && kind !== 'connector-guide'
    && kind !== 'component-step'
  ) return null;
  const event: ManufacturingWorkEvent = {
    id: raw.id,
    user_id: asString(raw.user_id),
    user_name: asString(raw.user_name),
    day: asString(raw.day),
    task_key: asString(raw.task_key),
    kind,
    action: raw.action === 'reopen' ? 'reopen' : 'complete',
  };
  if (typeof raw.state === 'string') event.state = raw.state;
  if (typeof raw.quantity === 'number') event.quantity = raw.quantity;
  if (raw.unit === 'ea' || raw.unit === 'mm') event.unit = raw.unit;
  return event;
}

function rewriteManufacturingKey(key: string): string {
  return rewriteLegacyRefKey(key.replaceAll('splice:', 'branch:'));
}

function rewriteKeyedRecord<T>(raw: unknown): Record<string, T> | undefined {
  if (!isRecord(raw)) return undefined;
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(raw)) {
    next[rewriteManufacturingKey(key)] = value as T;
  }
  return next;
}

function normalizeManufacturingBundle(raw: unknown): ManufacturingBundleProgress {
  const record = isRecord(raw) ? raw : {};
  const branchMeasured = isRecord(record.branch_measured)
    ? record.branch_measured as Record<string, boolean>
    : isRecord(record.splice_measured)
      ? record.splice_measured as Record<string, boolean>
      : undefined;
  const workLog = Array.isArray(record.work_log)
    ? record.work_log.flatMap((item) => {
        const event = normalizeWorkEvent(item);
        return event ? [event] : [];
      })
    : undefined;
  const bundle: ManufacturingBundleProgress = {
    steps: isRecord(record.steps) ? record.steps as ManufacturingBundleProgress['steps'] : {},
  };
  if (isRecord(record.component_steps)) {
    bundle.component_steps = rewriteKeyedRecord(record.component_steps) as ManufacturingBundleProgress['component_steps'];
  }
  if (isRecord(record.endpoint_genders)) {
    bundle.endpoint_genders = record.endpoint_genders as ManufacturingBundleProgress['endpoint_genders'];
  }
  if (isRecord(record.wire_progress)) {
    bundle.wire_progress = record.wire_progress as ManufacturingBundleProgress['wire_progress'];
  }
  if (branchMeasured) bundle.branch_measured = branchMeasured;
  if (isRecord(record.connector_guide_states)) {
    bundle.connector_guide_states = record.connector_guide_states as ManufacturingBundleProgress['connector_guide_states'];
  }
  if (isRecord(record.task_attribution)) {
    bundle.task_attribution = rewriteKeyedRecord(record.task_attribution) as ManufacturingBundleProgress['task_attribution'];
  }
  if (workLog) {
    bundle.work_log = workLog.map((event) => ({
      ...event,
      task_key: rewriteManufacturingKey(event.task_key),
    }));
  }
  if (typeof record.notes === 'string') bundle.notes = record.notes;
  return bundle;
}

export function normalizeManufacturingDocument(raw: unknown): ManufacturingDocument {
  const record = isRecord(raw) ? raw : {};
  const bundlesRaw = isRecord(record.bundles) ? record.bundles : {};
  const bundles: ManufacturingDocument['bundles'] = {};
  for (const [id, value] of Object.entries(bundlesRaw)) {
    bundles[rewriteLegacyRefKey(id)] = normalizeManufacturingBundle(value);
  }
  return {
    schema_version: record.schema_version === '1.1.0' ? '1.1.0' : '1.2.0',
    bundles,
  };
}

export function querySystemName(query: { get(name: string): string | null }): string | null {
  return query.get('system') ?? query.get('harness');
}

function pickCanonicalCollection<T>(
  canonical: T | undefined,
  legacy: T | undefined,
): T | undefined {
  return canonical !== undefined ? canonical : legacy;
}

export function normalizeLayoutPatch(raw: unknown): LayoutPatch {
  if (!isRecord(raw)) return { patch: {}, removed: {} };
  const patchRaw = isRecord(raw.patch) ? raw.patch : raw;
  const removedRaw = isRecord(raw.removed) ? raw.removed : {};
  const patch = normalizeLayouts({
    ...patchRaw,
    sharedAnchors: pickCanonicalCollection(patchRaw.sharedAnchors, patchRaw.junctions),
    branchPoints: pickCanonicalCollection(patchRaw.branchPoints, patchRaw.mergePoints),
  });
  const removed: LayoutRemovedKeys = {};
  for (const [key, value] of Object.entries(removedRaw)) {
    const canonicalKey = key === 'junctions' ? 'sharedAnchors' : key === 'mergePoints' ? 'branchPoints' : key;
    (removed as Record<string, unknown>)[canonicalKey] = value;
  }
  return { patch, removed };
}

export function normalizeCollaborationDocument(raw: unknown): CollaborationDocumentState {
  if (!isRecord(raw)) return {};
  const next: CollaborationDocumentState = {};
  const systemRaw = raw.system ?? raw.harness;
  if (systemRaw !== undefined) next.system = normalizeSystemData(systemRaw);
  if (raw.connectorLibrary !== undefined || raw.library !== undefined) {
    next.connectorLibrary = (raw.connectorLibrary ?? raw.library) as CollaborationDocumentState['connectorLibrary'];
  }
  if (raw.layouts !== undefined) {
    if (isRecord(raw.layouts) && (raw.layouts.patch !== undefined || raw.layouts.removed !== undefined)) {
      next.layouts = normalizeLayoutPatch(raw.layouts);
    } else {
      next.layouts = normalizeLayouts(raw.layouts);
    }
  }
  if (raw.manufacturing !== undefined) {
    next.manufacturing = normalizeManufacturingDocument(raw.manufacturing);
  }
  if (raw.subsystems !== undefined) {
    next.subsystems = raw.subsystems as CollaborationDocumentState['subsystems'];
  }
  if (isRecord(raw.attribution)) {
    next.attribution = raw.attribution as CollaborationDocumentState['attribution'];
  }
  if (raw.lastWriter !== undefined) {
    next.lastWriter = raw.lastWriter as CollaborationDocumentState['lastWriter'];
  }
  return next;
}

export const LEGACY_SYSTEM_QUERY_PARAM = 'harness';
export const CANONICAL_SYSTEM_QUERY_PARAM = 'system';
export const LEGACY_SYSTEMS_DIR = 'harnesses';
export const CANONICAL_SYSTEMS_DIR = 'systems';
