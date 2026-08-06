import { create, type StateCreator } from 'zustand';
import type {
  AppView,
  BackgroundLayout,
  BackgroundLayouts,
  Connector,
  ConnectorLibrary,
  ConnectorTypeSizes,
  Enclosure,
  FreePortLayouts,
  HarnessData,
  JunctionLayouts,
  ManufacturingDocument,
  ManufacturingStep,
  ManufacturingTaskUpdate,
  MergePoint,
  MergePointLayouts,
  NodeLayout,
  Path,
  PathMeasurement,
  PathNode,
  PortLayouts,
  RotationLayouts,
  SelectedBundle,
  SelectedItem,
  Signal,
  SignalPropertyDefinition,
  SizeLayouts,
  SubsystemDocument,
  SubsystemEntityLayout,
  EditingSurface,
  ManufacturingTab,
  TextBoxFontFamily,
  TextBoxFontWeight,
  TextBoxLayout,
  TextBoxLayouts,
  TextBoxTextAlign,
  WaypointItem,
  WaypointLayouts,
} from '../types';
import {
  applyManufacturingTaskUpdates,
  applySpanTotalLength,
  assignManufacturingEndpointGender,
  EMPTY_MANUFACTURING_DOCUMENT,
  MANUFACTURING_STEPS,
} from '../lib/manufacturing';
import {
  getLastManufacturingBundleId,
  setLastManufacturingBundleId,
} from '../lib/userPrefs';
import {
  applyConnectorPinCount,
  deriveBundles,
  findPathSegmentForBundle,
  GENERIC_MULTIPIN_TYPE_ID,
  getBundleSegments,
  getConnectorPairSegments,
  getConnectorOccupancy,
  getConnectorSupportedKeyings,
  getConnectorTypeCavityFloor,
  getEntityRevealContext,
  getEffectivePinCount,
  getNextConnectorPinCount,
  getPathNodeBundleKey,
  getPathSegmentMeasurement,
  getPathsTouchingConnector,
  getPreviousConnectorPinCount,
  getVisibleSegments,
  isConnectorFamily,
  nextMergePointId,
  normalizeConnectorKeying,
  parseBundleId,
  dissolveMergePoint,
  mergeConnectors,
  moveHierarchyEntity as relocateHierarchyEntity,
  removePathNodeAt,
  renumberConnectorPins,
  splicePathWithMerge,
  type BulkheadWireSide,
  type HierarchyEntityKind,
} from '../lib/harness';
import {
  getConnectorTablePinCount,
  resolveConnectorRenderedSize,
} from '../lib/connectorSize';
import {
  resolveParentResizeWithConnectorShove,
  type GraphNodeSize,
  type GraphRect,
  type ParentResizeConnector,
} from '../lib/parentResize';
import {
  normalizeDisplayName,
  renameHarnessEntity,
  renameSubsystem as renameSubsystemDocument,
  renameSystem as renameSystemDocument,
} from '../lib/rename';
import { ensureSubsystemAncestorFrames } from '../lib/subsystem';
import {
  applyHarnessDiff,
  applyLibraryDiff,
  applyLayoutPatch,
  applyRecordDiff,
  changedHarnessEntityIds,
  deepEqual,
  diffHarness,
  diffLayouts,
  diffLibrary,
  diffRecord,
  emptyLayouts,
  isHarnessDiffEmpty,
  isLayoutPatchEmpty,
  isLibraryDiffEmpty,
  isRecordDiffEmpty,
  mergeRemoteLayouts,
  mergeRemoteRecord,
  normalizeLayouts,
  rebaseHarness,
  rebaseLibrary,
} from '../lib/sync/diff';
import type {
  AttributionEntry,
  CollaborationDocumentState,
  CollaborationLayouts,
  CollaborationSession,
  CreateAccountOutcome,
  LoginOutcome,
  MapPatch,
  PeerPresence,
  PresenceTargetKind,
  PresenceUpdate,
  RevisionConflictResponse,
  RevisionWriter,
  SessionUser,
  SyncConflict,
  SyncPayload,
  SyncStatus,
  UndoStaleness,
  UserRole,
} from '../types/collab';

interface UndoSnapshot {
  harness: HarnessData | null;
  connectorLibrary: ConnectorLibrary | null;
  manufacturing: ManufacturingDocument;
  nodeLayouts: NodeLayout;
  portLayouts: PortLayouts;
  sizeLayouts: SizeLayouts;
  freePortLayouts: FreePortLayouts;
  backgroundLayouts: BackgroundLayouts;
  connectorTypeSizes: ConnectorTypeSizes;
  textBoxLayouts: TextBoxLayouts;
  waypointLayouts: WaypointLayouts;
  junctionLayouts: JunctionLayouts;
  mergePointLayouts: MergePointLayouts;
  rotationLayouts: RotationLayouts;
  subsystems: Record<string, SubsystemDocument>;
  selectedItem: SelectedItem | null;
  selectedBundle: SelectedBundle | null;
  selectedTextBoxId: string | null;
  serverRev: number;
  libraryRev: number;
  capturedAt: number;
}

interface UndoEntry {
  before: UndoSnapshot;
  after: UndoSnapshot;
  actionKey: string;
  capturedAt: number;
  updatedAt: number;
  active: boolean;
}

export interface DeleteImpact {
  enclosureIds: string[];
  connectorIds: string[];
  mergePointIds: string[];
  pathIds: string[];
  signalIds: string[];
}

const MAX_HISTORY = 60;

export interface HarnessStore {
  harness: HarnessData | null;
  serverHarness: HarnessData | null;
  connectorLibrary: ConnectorLibrary | null;
  serverConnectorLibrary: ConnectorLibrary | null;
  manufacturing: ManufacturingDocument;
  serverManufacturing: ManufacturingDocument;
  serverLayouts: CollaborationLayouts;
  serverSubsystems: Record<string, SubsystemDocument>;
  manufacturingTargetBundleId: string | null;
  manufacturingTab: ManufacturingTab;
  appView: AppView;
  connectorLibraryTargetId: string | null;
  signalLibraryTargetId: string | null;
  activeHarnessName: string;
  availableHarnesses: Array<{ id: string; name: string }>;
  selectedItem: SelectedItem | null;
  nodeLayouts: NodeLayout;
  isDirty: boolean;
  expandedNodes: Set<string>;
  /** Session-only sizes while a connector table is expanded; cleared on collapse. */
  expandedSizeOverrides: SizeLayouts;
  settingsOpen: boolean;
  drillDownEnclosure: string | null;
  portLayouts: PortLayouts;
  sizeLayouts: SizeLayouts;
  freePortLayouts: FreePortLayouts;
  backgroundLayouts: BackgroundLayouts;
  connectorTypeSizes: ConnectorTypeSizes;
  textBoxLayouts: TextBoxLayouts;
  selectedTextBoxId: string | null;
  selectedBundle: SelectedBundle | null;
  /** Hide the inspector while keeping the current selection (e.g. while editing waypoints). */
  inspectorDismissed: boolean;
  revealRequest: { item: SelectedItem; requestId: number } | null;
  revealRequestSequence: number;
  waypointLayouts: WaypointLayouts;
  junctionLayouts: JunctionLayouts;
  mergePointLayouts: MergePointLayouts;
  rotationLayouts: RotationLayouts;
  editingSurface: EditingSurface;
  subsystems: Record<string, SubsystemDocument>;
  activeSubsystemId: string | null;
  mutationError: string | null;
  session: CollaborationSession;
  peers: Record<string, PeerPresence>;
  serverRev: number;
  libraryRev: number;
  lastWriter: RevisionWriter | null;
  lastWriterAt: number | null;
  syncStatus: SyncStatus;
  conflict: SyncConflict | null;
  collabAvailable: boolean;
  attribution: Record<string, AttributionEntry>;
  interactingEntities: Set<string>;
  queuedRemoteUpdates: SyncPayload[];

  setActiveHarnessName: (name: string) => Promise<boolean>;
  setAvailableHarnesses: (harnesses: Array<{ id: string; name: string }>) => void;
  renameSystem: (name: string) => void;
  openConnectorLibrary: (typeId?: string | null) => void;
  openSignalLibrary: (signalId?: string | null) => void;
  openManufacturing: (bundleId?: string | null) => void;
  /** Remember the manufacturing harness selection for this user without changing app view. */
  setManufacturingTargetBundle: (bundleId: string | null) => void;
  setManufacturingTab: (tab: ManufacturingTab) => void;
  showBundleInHierarchy: (pathIds: string[]) => void;
  inspectEntity: (item: SelectedItem) => void;
  /** Select for the inspector without changing view or issuing a camera reveal. */
  inspectEntityQuiet: (item: SelectedItem) => void;
  closeConnectorLibrary: () => void;
  setEditingSurface: (surface: EditingSurface) => void;
  loadSubsystems: (documents: SubsystemDocument[]) => void;
  setActiveSubsystem: (id: string | null) => void;
  upsertSubsystem: (document: SubsystemDocument) => void;
  acceptSavedSubsystem: (document: SubsystemDocument) => void;
  renameSubsystem: (id: string, name: string) => void;
  updateSubsystemEntityLayout: (kind: 'enclosures' | 'devices' | 'connectors', id: string, layout: SubsystemEntityLayout) => void;
  resizeSubsystemEntityLayout: (
    kind: 'enclosures' | 'devices',
    id: string,
    layout: SubsystemEntityLayout,
    previousRenderedLayout?: SubsystemEntityLayout,
  ) => void;
  addEntityToActiveSubsystem: (type: 'enclosure' | 'connector', id: string) => void;
  removeEntityFromActiveSubsystem: (type: 'enclosure' | 'connector', id: string) => void;
  renumberConnectorCavities: (connectorId: string, orderedOldPinNumbers: number[]) => void;
  /**
   * Absorb `sourceId` into `targetId` (same parent bulkheads). Prefers keeping
   * non-generated hardware. Returns the surviving connector id, or null on failure.
   */
  mergeBulkheadConnectors: (sourceId: string, targetId: string) => string | null;
  getDeleteImpact: (type: 'enclosure' | 'connector' | 'mergePoint' | 'path' | 'signal', id: string) => DeleteImpact;
  deleteEntityCascade: (type: 'enclosure' | 'connector' | 'mergePoint' | 'path' | 'signal', id: string) => void;
  deletePathBundle: (bundleId: string, pathIds: string[]) => void;
  addSignal: (input: Pick<Signal, 'name' | 'tags' | 'properties'>) => string | null;
  addSignalPropertyDefinition: (
    input: Pick<SignalPropertyDefinition, 'name' | 'options'>,
  ) => string | null;
  updateSignalPropertyDefinition: (
    id: string,
    patch: Partial<Pick<SignalPropertyDefinition, 'name' | 'options'>>,
  ) => void;
  deleteSignalPropertyDefinition: (id: string) => void;
  addEnclosure: (input: Pick<Enclosure, 'name' | 'parent' | 'container'>) => string | null;
  addConnector: (parentId: string) => string | null;
  /**
   * Reparent and/or reorder an enclosure, connector, or merge point in the
   * hierarchy tree. `beforeId` inserts before that same-kind sibling under
   * `newParentId`; omit/null to append.
   */
  moveHierarchyEntity: (
    type: HierarchyEntityKind,
    id: string,
    newParentId: string | null,
    beforeId?: string | null,
  ) => boolean;
  setConnectorType: (connectorId: string, typeId: string) => void;
  setConnectorKeying: (connectorId: string, keying: string | undefined) => void;
  updateManufacturingEndpointGender: (
    bundleId: string,
    connectorId: string,
    gender: 'male' | 'female' | undefined,
    mateBundleIds: string[],
  ) => void;
  addConnectorCavity: (connectorId: string) => void;
  removeConnectorCavity: (connectorId: string) => void;
  renameEntity: (type: 'enclosure' | 'connector' | 'mergePoint' | 'path' | 'signal', id: string, name: string) => void;
  updateSignalName: (signalId: string, name: string) => void;
  updateSignalProperty: (signalId: string, key: string, value: string) => void;
  updatePathSignal: (pathId: string, signalId: string | null) => void;
  updatePathProperty: (pathId: string, key: string, value: string) => void;
  /**
   * Set `wire_gauge` on every path landing on a connector.
   * For bulkheads, `side` limits the update to internal, external, or both.
   */
  updateConnectorPathsGauge: (
    connectorId: string,
    gauge: string,
    side?: BulkheadWireSide,
  ) => void;
  updatePathSegmentLength: (pathId: string, segmentIndex: number, lengthMm: number | undefined) => void;
  updatePathSegmentLengths: (
    updates: Array<{
      pathId: string;
      segmentIndex: number;
      lengthMm: number | undefined;
    }>,
  ) => void;
  updatePathSpanLengths: (
    updates: Array<{
      pathId: string;
      fromNodeIndex: number;
      toNodeIndex: number;
      lengthMm: number | undefined;
    }>,
  ) => void;
  updateConnectorPairSegmentLengths: (pathId: string, segmentIndex: number, lengthMm: number) => void;
  updateBundleSegmentLengths: (
    bundleId: string,
    pathIds: string[],
    lengthMm: number | undefined,
  ) => void;
  setMutationError: (message: string | null) => void;
  resetForHarnessSwitch: () => void;
  login: (login: string) => Promise<LoginOutcome>;
  createAccount: (login: string, displayName: string, role: UserRole) => Promise<CreateAccountOutcome>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  /** Arms editing for a remembered identity. Requires an explicit user action. */
  activateEditSession: () => void;
  publishPresence: (partial: PresenceUpdate) => void;
  setInteracting: (kind: PresenceTargetKind, id: string, active: boolean) => void;
  dismissConflict: () => void;
  setCollabAvailable: (available: boolean) => void;
  setSyncStatus: (status: SyncStatus) => void;
  replacePeers: (peers: PeerPresence[]) => void;
  loadCollaborationMeta: (meta: {
    serverRev: number;
    libraryRev: number;
    lastWriter: RevisionWriter | null;
    attribution: Record<string, AttributionEntry>;
    collabAvailable: boolean;
  }) => void;
  applyRemoteSync: (payload: SyncPayload) => void;

  loadHarness: (data: HarnessData) => void;
  loadConnectorLibrary: (data: ConnectorLibrary) => void;
  loadManufacturing: (data: ManufacturingDocument) => void;
  updateManufacturingStep: (
    bundleId: string,
    componentKey: string,
    step: ManufacturingStep,
    completed: boolean,
  ) => void;
  updateManufacturingTasks: (
    bundleId: string,
    updates: ManufacturingTaskUpdate[],
  ) => void;
  updateManufacturingNotes: (bundleId: string, notes: string) => void;
  updateConnectorLibrary: (data: ConnectorLibrary) => void;
  loadLayouts: (layouts: NodeLayout) => void;
  loadPortLayouts: (ports: PortLayouts) => void;
  loadSizeLayouts: (sizes: SizeLayouts) => void;
  loadFreePortLayouts: (free: FreePortLayouts) => void;
  loadBackgroundLayouts: (bg: BackgroundLayouts) => void;
  loadTextBoxLayouts: (tbs: TextBoxLayouts) => void;
  loadWaypointLayouts: (wps: WaypointLayouts) => void;
  loadJunctionLayouts: (junctions: JunctionLayouts) => void;
  loadMergePointLayouts: (layouts: MergePointLayouts) => void;
  loadRotationLayouts: (rotations: RotationLayouts) => void;
  rotateConnector: (connectorId: string) => void;
  rotateEnclosure: (enclosureId: string) => void;

  updateBackground: (contextKey: string, patch: Partial<BackgroundLayout>) => void;
  removeBackground: (contextKey: string) => void;

  addTextBox: (x: number, y: number) => void;
  updateTextBox: (id: string, patch: Partial<Omit<TextBoxLayout, 'id'>>) => void;
  removeTextBox: (id: string) => void;
  selectTextBox: (id: string | null) => void;

  selectItem: (item: SelectedItem | null) => void;
  revealItem: (item: SelectedItem) => void;
  toggleNodeExpanded: (nodeId: string) => void;
  updateExpandedNodeSize: (nodeId: string, w: number, h: number) => void;

  updateNodePosition: (nodeId: string, x: number, y: number) => void;
  resizeHierarchyEntityLayout: (
    nodeId: string,
    previousLayout: GraphRect,
    layout: GraphRect,
  ) => void;
  updatePortLayout: (connectorId: string, x: number, y: number) => void;
  updateNodeSize: (nodeId: string, w: number, h: number) => void;
  updateFreePortLayout: (connectorId: string, x: number, y: number) => void;
  updateMergePointLayout: (contextKey: string, mergePointId: string, x: number, y: number) => void;

  setDrillDown: (encId: string | null) => void;
  setSelectedBundle: (bundle: SelectedBundle | null) => void;
  dismissInspector: () => void;

  setEdgeWaypoints: (edgeId: string, waypoints: WaypointItem[]) => void;
  createJunction: (pos: { x: number; y: number }, edgeId: string, waypointIndex: number) => string;
  moveJunction: (junctionId: string, pos: { x: number; y: number }) => void;
  deleteJunction: (junctionId: string) => void;
  linkEdgeToJunction: (junctionId: string, edgeId: string, insertAfterIndex: number, pos: { x: number; y: number }) => void;
  unlinkEdgeFromJunction: (junctionId: string, edgeId: string) => void;

  draggingEdgeInfo: { edgeId: string; position: { x: number; y: number }; waypointIndex?: number } | null;
  setDraggingEdgeInfo: (info: { edgeId: string; position: { x: number; y: number }; waypointIndex?: number } | null) => void;

  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  pushUndoSnapshot: (actionKey?: string) => void;
  commitUndoSnapshot: () => void;
  cancelUndoSnapshot: () => void;
  getUndoAffectedEntities: () => string[];
  undo: () => void;
  redo: () => void;

  loadConnectorTypeSizes: (sizes: ConnectorTypeSizes) => void;
  updateConnectorTypeImage: (typeId: string, image: string, pinCount?: number) => void;
  updateConnectorTypeSideImage: (typeId: string, image: string, pinCount?: number) => void;
  updateEnclosureProperty: (encId: string, key: string, value: string) => void;
  updateConnectorProperty: (conId: string, key: string, value: string) => void;

  addTag: (entityType: string, entityId: string, tag: string) => void;
  removeTag: (entityType: string, entityId: string, tag: string) => void;

  setSettingsOpen: (open: boolean) => void;

  getAllExistingTags: () => string[];
  findEntity: (type: string, id: string) => Enclosure | Connector | MergePoint | Path | Signal | undefined;
}

function normalizeHarness(data: HarnessData): HarnessData {
  type LegacyPcb = {
    id: string;
    name: string;
    parent?: string | null;
    tags?: string[];
    properties?: Record<string, string>;
  };
  type LegacyPathNode = PathNode & { id?: string };
  type LegacyMeasurement = Partial<PathMeasurement> & {
    from_node_id?: string;
    to_node_id?: string;
    length_mm?: number;
    note?: string;
  };
  const normalized = structuredClone(data) as HarnessData & {
    pcbs?: LegacyPcb[];
    wires?: unknown[];
  };

  if (Array.isArray(normalized.pcbs)) {
    for (const pcb of normalized.pcbs) {
      normalized.enclosures.push({
        id: pcb.id,
        name: pcb.name,
        parent: pcb.parent ?? null,
        container: false,
        tags: pcb.tags ?? [],
        properties: pcb.properties ?? {},
      });
    }
    delete normalized.pcbs;
  }

  normalized.mergePoints ??= [];
  normalized.paths ??= [];
  normalized.signals ??= [];
  normalized.signalPropertyDefinitions ??= [];

  for (const enclosure of normalized.enclosures) {
    enclosure.tags ??= [];
    enclosure.properties ??= {};
    enclosure.container ??= true;
  }

  for (const connector of normalized.connectors) {
    connector.tags ??= [];
    connector.properties ??= {};
    connector.parent ??= null;
    delete (connector as Connector & { pins?: unknown }).pins;
  }

  for (const mergePoint of normalized.mergePoints) {
    mergePoint.name ??= mergePoint.id;
    mergePoint.parent ??= null;
    mergePoint.tags ??= [];
    mergePoint.properties ??= {};
  }

  for (const path of normalized.paths) {
    path.name ??= path.id;
    path.tags ??= [];
    path.properties ??= {};
    const rawNodes = (path.nodes ?? []) as LegacyPathNode[];
    const legacyNodeById = new Map<string, LegacyPathNode>();
    for (const rawNode of rawNodes) {
      if (typeof rawNode.id === 'string') legacyNodeById.set(rawNode.id, rawNode);
    }
    path.nodes = rawNodes.map((rawNode) => {
      const nodeWithoutId = { ...rawNode };
      delete nodeWithoutId.id;
      return nodeWithoutId;
    });
    path.measurements = ((path.measurements ?? []) as LegacyMeasurement[]).map((measurement) => {
      if (measurement.from && measurement.to) return measurement as PathMeasurement;
      const fromNode = typeof measurement.from_node_id === 'string'
        ? legacyNodeById.get(measurement.from_node_id)
        : null;
      const toNode = typeof measurement.to_node_id === 'string'
        ? legacyNodeById.get(measurement.to_node_id)
        : null;
      if (!fromNode || !toNode) return measurement as PathMeasurement;
      return {
        from: fromNode.kind === 'connector'
          ? { kind: 'connector', connector_id: fromNode.connector_id, pin_number: fromNode.pin_number }
          : { kind: 'merge', merge_point_id: fromNode.merge_point_id },
        to: toNode.kind === 'connector'
          ? { kind: 'connector', connector_id: toNode.connector_id, pin_number: toNode.pin_number }
          : { kind: 'merge', merge_point_id: toNode.merge_point_id },
        ...(measurement.length_mm !== undefined ? { length_mm: measurement.length_mm } : {}),
        ...(measurement.note !== undefined ? { note: measurement.note } : {}),
      };
    });
  }

  for (const signal of normalized.signals) {
    signal.tags ??= [];
    signal.properties ??= {};
  }

  return normalized;
}

function setPathSegmentLength(
  path: Path,
  segmentIndex: number,
  lengthMm: number | undefined,
): boolean {
  const from = path.nodes[segmentIndex];
  const to = path.nodes[segmentIndex + 1];
  if (!from || !to) return false;

  const measurement = getPathSegmentMeasurement(path, segmentIndex);
  if (measurement?.length_mm === lengthMm) return false;
  if (measurement) {
    if (lengthMm === undefined) {
      if (measurement.note) delete measurement.length_mm;
      else path.measurements.splice(path.measurements.indexOf(measurement), 1);
    } else {
      measurement.length_mm = lengthMm;
    }
  } else if (lengthMm !== undefined) {
    path.measurements.push({
      from: structuredClone(from),
      to: structuredClone(to),
      length_mm: lengthMm,
    });
  }
  return true;
}

function makeSnapshot(state: HarnessStore): UndoSnapshot {
  return {
    harness: state.harness,
    connectorLibrary: state.connectorLibrary,
    manufacturing: state.manufacturing,
    nodeLayouts: state.nodeLayouts,
    portLayouts: state.portLayouts,
    sizeLayouts: state.sizeLayouts,
    freePortLayouts: state.freePortLayouts,
    backgroundLayouts: state.backgroundLayouts,
    connectorTypeSizes: state.connectorTypeSizes,
    textBoxLayouts: state.textBoxLayouts,
    waypointLayouts: state.waypointLayouts,
    junctionLayouts: state.junctionLayouts,
    mergePointLayouts: state.mergePointLayouts,
    rotationLayouts: state.rotationLayouts,
    subsystems: state.subsystems,
    selectedItem: state.selectedItem,
    selectedBundle: state.selectedBundle,
    selectedTextBoxId: state.selectedTextBoxId,
    serverRev: state.serverRev,
    libraryRev: state.libraryRev,
    capturedAt: Date.now(),
  };
}

function applyNullableHarnessDelta(
  current: HarnessData | null,
  from: HarnessData | null,
  to: HarnessData | null,
): HarnessData | null {
  if (from && to && current) {
    const diff = diffHarness(from, to);
    return isHarnessDiffEmpty(diff) ? current : applyHarnessDiff(current, diff);
  }
  return from === to ? current : to;
}

function applyNullableLibraryDelta(
  current: ConnectorLibrary | null,
  from: ConnectorLibrary | null,
  to: ConnectorLibrary | null,
): ConnectorLibrary | null {
  if (from && to && current) {
    const diff = diffLibrary(from, to);
    return isLibraryDiffEmpty(diff) ? current : applyLibraryDiff(current, diff);
  }
  return from === to ? current : to;
}

function applySnapshotDelta(
  base: UndoSnapshot,
  from: UndoSnapshot,
  to: UndoSnapshot,
): UndoSnapshot {
  const layouts = applyLayoutPatch(
    {
      nodes: base.nodeLayouts,
      ports: base.portLayouts,
      sizes: base.sizeLayouts,
      free: base.freePortLayouts,
      backgrounds: base.backgroundLayouts,
      connectorTypeSizes: base.connectorTypeSizes,
      textBoxes: base.textBoxLayouts,
      waypoints: base.waypointLayouts,
      junctions: base.junctionLayouts,
      mergePoints: base.mergePointLayouts,
      rotations: base.rotationLayouts,
    },
    diffLayouts(
      {
        nodes: from.nodeLayouts,
        ports: from.portLayouts,
        sizes: from.sizeLayouts,
        free: from.freePortLayouts,
        backgrounds: from.backgroundLayouts,
        connectorTypeSizes: from.connectorTypeSizes,
        textBoxes: from.textBoxLayouts,
        waypoints: from.waypointLayouts,
        junctions: from.junctionLayouts,
        mergePoints: from.mergePointLayouts,
        rotations: from.rotationLayouts,
      },
      {
        nodes: to.nodeLayouts,
        ports: to.portLayouts,
        sizes: to.sizeLayouts,
        free: to.freePortLayouts,
        backgrounds: to.backgroundLayouts,
        connectorTypeSizes: to.connectorTypeSizes,
        textBoxes: to.textBoxLayouts,
        waypoints: to.waypointLayouts,
        junctions: to.junctionLayouts,
        mergePoints: to.mergePointLayouts,
        rotations: to.rotationLayouts,
      },
    ),
  );
  const manufacturingDiff = diffRecord(
    from.manufacturing.bundles,
    to.manufacturing.bundles,
  );
  const subsystemDiff = diffRecord(from.subsystems, to.subsystems);
  return {
    ...base,
    harness: applyNullableHarnessDelta(base.harness, from.harness, to.harness),
    connectorLibrary: applyNullableLibraryDelta(
      base.connectorLibrary,
      from.connectorLibrary,
      to.connectorLibrary,
    ),
    manufacturing: isRecordDiffEmpty(manufacturingDiff)
      ? base.manufacturing
      : {
          ...base.manufacturing,
          bundles: applyRecordDiff(base.manufacturing.bundles, manufacturingDiff),
        },
    nodeLayouts: layouts.nodes,
    portLayouts: layouts.ports,
    sizeLayouts: layouts.sizes,
    freePortLayouts: layouts.free,
    backgroundLayouts: layouts.backgrounds,
    connectorTypeSizes: layouts.connectorTypeSizes,
    textBoxLayouts: layouts.textBoxes,
    waypointLayouts: layouts.waypoints,
    junctionLayouts: layouts.junctions,
    mergePointLayouts: layouts.mergePoints,
    rotationLayouts: layouts.rotations,
    subsystems: isRecordDiffEmpty(subsystemDiff)
      ? base.subsystems
      : applyRecordDiff(base.subsystems, subsystemDiff),
    selectedItem: deepEqual(from.selectedItem, to.selectedItem) ? base.selectedItem : to.selectedItem,
    selectedBundle: deepEqual(from.selectedBundle, to.selectedBundle) ? base.selectedBundle : to.selectedBundle,
    selectedTextBoxId: from.selectedTextBoxId === to.selectedTextBoxId
      ? base.selectedTextBoxId
      : to.selectedTextBoxId,
    capturedAt: Date.now(),
  };
}

function snapshotsEqual(left: UndoSnapshot, right: UndoSnapshot): boolean {
  return left.harness === right.harness
    && left.connectorLibrary === right.connectorLibrary
    && left.manufacturing === right.manufacturing
    && left.nodeLayouts === right.nodeLayouts
    && left.portLayouts === right.portLayouts
    && left.sizeLayouts === right.sizeLayouts
    && left.freePortLayouts === right.freePortLayouts
    && left.backgroundLayouts === right.backgroundLayouts
    && left.connectorTypeSizes === right.connectorTypeSizes
    && left.textBoxLayouts === right.textBoxLayouts
    && left.waypointLayouts === right.waypointLayouts
    && left.junctionLayouts === right.junctionLayouts
    && left.mergePointLayouts === right.mergePointLayouts
    && left.rotationLayouts === right.rotationLayouts
    && left.subsystems === right.subsystems
    && deepEqual(left.selectedItem, right.selectedItem)
    && deepEqual(left.selectedBundle, right.selectedBundle)
    && left.selectedTextBoxId === right.selectedTextBoxId;
}

function appendUndoEntry(stack: UndoEntry[], entry: UndoEntry): UndoEntry[] {
  const next = [...stack, entry];
  return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
}

function historyPatch(
  state: HarnessStore,
  patch: Partial<HarnessStore>,
  actionKey: string,
): Partial<HarnessStore> {
  const beforeMutation = makeSnapshot(state);
  const afterMutation = makeSnapshot({ ...state, ...patch } as HarnessStore);
  if (snapshotsEqual(beforeMutation, afterMutation)) return patch;

  const now = Date.now();
  const top = state.undoStack.at(-1);
  if (top?.active) {
    const after = applySnapshotDelta(top.after, beforeMutation, afterMutation);
    const entry = { ...top, after, updatedAt: now };
    return {
      ...patch,
      undoStack: [...state.undoStack.slice(0, -1), entry],
      redoStack: [],
    };
  }
  if (top?.actionKey === actionKey && now - top.updatedAt <= 2_000) {
    const after = applySnapshotDelta(top.after, beforeMutation, afterMutation);
    const entry = { ...top, after, updatedAt: now };
    return {
      ...patch,
      undoStack: [...state.undoStack.slice(0, -1), entry],
      redoStack: [],
    };
  }
  const entry: UndoEntry = {
    before: beforeMutation,
    after: afterMutation,
    actionKey,
    capturedAt: now,
    updatedAt: now,
    active: false,
  };
  return {
    ...patch,
    undoStack: appendUndoEntry(state.undoStack, entry),
    redoStack: [],
  };
}

function changedLayoutIds(from: UndoSnapshot, to: UndoSnapshot): string[] {
  const diff = diffLayouts({
    nodes: from.nodeLayouts,
    ports: from.portLayouts,
    sizes: from.sizeLayouts,
    free: from.freePortLayouts,
    backgrounds: from.backgroundLayouts,
    connectorTypeSizes: from.connectorTypeSizes,
    textBoxes: from.textBoxLayouts,
    waypoints: from.waypointLayouts,
    junctions: from.junctionLayouts,
    mergePoints: from.mergePointLayouts,
    rotations: from.rotationLayouts,
  }, {
    nodes: to.nodeLayouts,
    ports: to.portLayouts,
    sizes: to.sizeLayouts,
    free: to.freePortLayouts,
    backgrounds: to.backgroundLayouts,
    connectorTypeSizes: to.connectorTypeSizes,
    textBoxes: to.textBoxLayouts,
    waypoints: to.waypointLayouts,
    junctions: to.junctionLayouts,
    mergePoints: to.mergePointLayouts,
    rotations: to.rotationLayouts,
  });
  const ids = new Set<string>();
  for (const value of Object.values(diff.patch)) {
    for (const id of Object.keys(value ?? {})) ids.add(id);
  }
  for (const value of Object.values(diff.removed)) {
    if (Array.isArray(value)) value.forEach((id) => ids.add(id));
    else Object.values(value ?? {}).flat().forEach((id) => ids.add(id));
  }
  return [...ids];
}

function getEntryAffectedEntities(entry: UndoEntry): string[] {
  const affected: string[] = [];
  if (entry.before.harness && entry.after.harness) {
    const diff = diffHarness(entry.before.harness, entry.after.harness);
    if (diff.metadata) affected.push('system name');
    affected.push(...changedHarnessEntityIds(diff));
  } else if (entry.before.harness !== entry.after.harness) {
    affected.push('harness');
  }
  if (entry.before.connectorLibrary && entry.after.connectorLibrary) {
    const diff = diffLibrary(entry.before.connectorLibrary, entry.after.connectorLibrary);
    affected.push(...Object.keys(diff.connectorTypes.patch), ...diff.connectorTypes.removed);
  } else if (entry.before.connectorLibrary !== entry.after.connectorLibrary) {
    affected.push('connector library');
  }
  affected.push(...changedLayoutIds(entry.before, entry.after));
  const subsystemDiff = diffRecord(entry.before.subsystems, entry.after.subsystems);
  affected.push(...Object.keys(subsystemDiff.patch), ...subsystemDiff.removed);
  const manufacturingDiff = diffRecord(
    entry.before.manufacturing.bundles,
    entry.after.manufacturing.bundles,
  );
  affected.push(...Object.keys(manufacturingDiff.patch), ...manufacturingDiff.removed);
  return [...new Set(affected)];
}

function findAffectedHarnessItem(
  harness: HarnessData | null,
  affectedIds: string[],
): SelectedItem | null {
  if (!harness) return null;
  for (const id of affectedIds) {
    if (harness.enclosures.some((item) => item.id === id)) return { type: 'enclosure', id };
    if (harness.connectors.some((item) => item.id === id)) return { type: 'connector', id };
    if (harness.mergePoints.some((item) => item.id === id)) return { type: 'mergePoint', id };
    if (harness.paths.some((item) => item.id === id)) return { type: 'path', id };
    if (harness.signals.some((item) => item.id === id)) return { type: 'signal', id };
  }
  return null;
}

function scopedHistoryPatch(
  state: HarnessStore,
  entry: UndoEntry,
  direction: 'undo' | 'redo',
): Partial<HarnessStore> {
  const from = direction === 'undo' ? entry.after : entry.before;
  const to = direction === 'undo' ? entry.before : entry.after;
  const applied = applySnapshotDelta(makeSnapshot(state), from, to);
  const affectedIds = getEntryAffectedEntities(entry);
  const selectedItem = to.selectedItem
    && findAffectedHarnessItem(applied.harness, [to.selectedItem.id])
      ? to.selectedItem
      : null;
  const selectedBundle = to.selectedBundle
    && to.selectedBundle.pathIds.some((id) => applied.harness?.paths.some((path) => path.id === id))
      ? to.selectedBundle
      : null;
  const selectedTextBoxId = to.selectedTextBoxId && applied.textBoxLayouts[to.selectedTextBoxId]
    ? to.selectedTextBoxId
    : null;
  const patch: Partial<HarnessStore> = {
    harness: applied.harness,
    connectorLibrary: applied.connectorLibrary,
    manufacturing: applied.manufacturing,
    nodeLayouts: applied.nodeLayouts,
    portLayouts: applied.portLayouts,
    sizeLayouts: applied.sizeLayouts,
    freePortLayouts: applied.freePortLayouts,
    backgroundLayouts: applied.backgroundLayouts,
    connectorTypeSizes: applied.connectorTypeSizes,
    textBoxLayouts: applied.textBoxLayouts,
    waypointLayouts: applied.waypointLayouts,
    junctionLayouts: applied.junctionLayouts,
    mergePointLayouts: applied.mergePointLayouts,
    rotationLayouts: applied.rotationLayouts,
    subsystems: applied.subsystems,
    selectedItem,
    selectedBundle,
    selectedTextBoxId,
    isDirty: true,
  };

  const revealItem = selectedItem
    ?? (!selectedBundle && !selectedTextBoxId
      ? findAffectedHarnessItem(applied.harness, affectedIds)
      : null);
  if (revealItem && applied.harness) {
    const requestId = state.revealRequestSequence + 1;
    patch.appView = 'canvas';
    patch.editingSurface = 'hierarchy';
    patch.drillDownEnclosure = getEntityRevealContext(
      applied.harness,
      revealItem,
      state.drillDownEnclosure,
    );
    patch.selectedItem = revealItem;
    patch.selectedBundle = null;
    patch.selectedTextBoxId = null;
    patch.revealRequest = { item: revealItem, requestId };
    patch.revealRequestSequence = requestId;
  } else if (selectedBundle && applied.harness) {
    const firstPathId = selectedBundle.pathIds.find((id) =>
      applied.harness?.paths.some((path) => path.id === id)
    );
    if (firstPathId) {
      patch.appView = 'canvas';
      patch.editingSurface = 'hierarchy';
      patch.drillDownEnclosure = getEntityRevealContext(
        applied.harness,
        { type: 'path', id: firstPathId },
        state.drillDownEnclosure,
      );
    }
  } else if (selectedTextBoxId) {
    const contextKey = applied.textBoxLayouts[selectedTextBoxId]?.contextKey ?? 'graph';
    patch.appView = 'canvas';
    patch.editingSurface = 'hierarchy';
    patch.drillDownEnclosure = contextKey === 'graph' ? null : contextKey;
  } else {
    const libraryDiff = from.connectorLibrary && to.connectorLibrary
      ? diffLibrary(from.connectorLibrary, to.connectorLibrary)
      : null;
    const connectorTypeId = libraryDiff
      ? [...Object.keys(libraryDiff.connectorTypes.patch), ...libraryDiff.connectorTypes.removed][0]
      : null;
    const manufacturingDiff = diffRecord(from.manufacturing.bundles, to.manufacturing.bundles);
    const manufacturingBundleId = [
      ...Object.keys(manufacturingDiff.patch),
      ...manufacturingDiff.removed,
    ][0];
    const subsystemDiff = diffRecord(from.subsystems, to.subsystems);
    const subsystemId = [...Object.keys(subsystemDiff.patch), ...subsystemDiff.removed][0];
    if (connectorTypeId) {
      patch.appView = 'connectorLibrary';
      patch.connectorLibraryTargetId = connectorTypeId;
    } else if (manufacturingBundleId) {
      patch.appView = 'manufacturing';
      patch.manufacturingTargetBundleId = manufacturingBundleId;
    } else if (subsystemId && applied.subsystems[subsystemId]) {
      patch.appView = 'canvas';
      patch.editingSurface = 'subsystem';
      patch.activeSubsystemId = subsystemId;
    }
  }
  return patch;
}

function clampToRange(value: number, max: number): number {
  return Math.max(0, Math.min(value, Math.max(0, max)));
}

function rotateChildClockwise(
  position: { x: number; y: number },
  childSize: { w: number; h: number },
  oldParentSize: { w: number; h: number },
  newParentSize: { w: number; h: number },
): { x: number; y: number } {
  const centeredOffsetX = (newParentSize.w - oldParentSize.h) / 2;
  const centeredOffsetY = (newParentSize.h - oldParentSize.w) / 2;
  return {
    x: clampToRange(
      oldParentSize.h - position.y - childSize.h + centeredOffsetX,
      newParentSize.w - childSize.w,
    ),
    y: clampToRange(
      position.x + centeredOffsetY,
      newParentSize.h - childSize.h,
    ),
  };
}

function getInitialHarnessName(): string {
  try { return localStorage.getItem('vw-active-harness') ?? 'fsae-car'; } catch { return 'fsae-car'; }
}

const TRUSTED_DOCUMENT_UPDATE = Symbol('trusted-document-update');
type TrustedDocumentPatch = {
  readonly [TRUSTED_DOCUMENT_UPDATE]?: true;
};

const DOCUMENT_SLICES = [
  'harness',
  'connectorLibrary',
  'manufacturing',
  'subsystems',
  'nodeLayouts',
  'portLayouts',
  'sizeLayouts',
  'freePortLayouts',
  'backgroundLayouts',
  'connectorTypeSizes',
  'textBoxLayouts',
  'waypointLayouts',
  'junctionLayouts',
  'mergePointLayouts',
  'rotationLayouts',
] as const satisfies readonly (keyof HarnessStore)[];

function trustedDocumentPatch<T extends object>(patch: T): T {
  Object.defineProperty(patch, TRUSTED_DOCUMENT_UPDATE, {
    value: true,
    enumerable: false,
  });
  return patch;
}

function readOnlyMiddleware(
  config: StateCreator<HarnessStore, [], []>,
): StateCreator<HarnessStore, [], []> {
  return (set, get, api) => {
    const guardedSet = ((
      update: Parameters<typeof set>[0],
      replace?: boolean,
    ) => {
      const current = get();
      const patch = typeof update === 'function' ? update(current) : update;
      if (!patch) return;
      const candidate = patch as Partial<HarnessStore> & TrustedDocumentPatch;
      const isTrusted = candidate[TRUSTED_DOCUMENT_UPDATE] === true;
      const touchesDocument = DOCUMENT_SLICES.some(
        (key) => Object.hasOwn(candidate, key) && candidate[key] !== current[key],
      );
      if (
        touchesDocument
        && !isTrusted
        // Without a collaboration-capable server there are no accounts to log
        // into, so the app stays editable as a single user. Individual mutators
        // (addSignal, addEnclosure) already gate on this; the middleware has to
        // agree or it silently blocks edits the mutators would have allowed.
        && current.collabAvailable
        && !current.session.isEditor
      ) {
        set({ mutationError: 'Log in to edit' });
        return;
      }
      if (replace) set(candidate as HarnessStore, true);
      else set(candidate);
    }) as typeof set;
    api.setState = guardedSet;
    return config(guardedSet, get, api);
  };
}

function getLayouts(state: HarnessStore): CollaborationLayouts {
  return {
    nodes: state.nodeLayouts,
    ports: state.portLayouts,
    sizes: state.sizeLayouts,
    free: state.freePortLayouts,
    backgrounds: state.backgroundLayouts,
    connectorTypeSizes: state.connectorTypeSizes,
    textBoxes: state.textBoxLayouts,
    waypoints: state.waypointLayouts,
    junctions: state.junctionLayouts,
    mergePoints: state.mergePointLayouts,
    rotations: state.rotationLayouts,
  };
}

function layoutStatePatch(layouts: CollaborationLayouts): Pick<
  HarnessStore,
  | 'nodeLayouts'
  | 'portLayouts'
  | 'sizeLayouts'
  | 'freePortLayouts'
  | 'backgroundLayouts'
  | 'connectorTypeSizes'
  | 'textBoxLayouts'
  | 'waypointLayouts'
  | 'junctionLayouts'
  | 'mergePointLayouts'
  | 'rotationLayouts'
> {
  return {
    nodeLayouts: layouts.nodes,
    portLayouts: layouts.ports,
    sizeLayouts: layouts.sizes,
    freePortLayouts: layouts.free,
    backgroundLayouts: layouts.backgrounds,
    connectorTypeSizes: layouts.connectorTypeSizes,
    textBoxLayouts: layouts.textBoxes,
    waypointLayouts: layouts.waypoints,
    junctionLayouts: layouts.junctions,
    mergePointLayouts: layouts.mergePoints,
    rotationLayouts: layouts.rotations,
  };
}

function subsystemRecord(
  documents: SubsystemDocument[] | Record<string, SubsystemDocument>,
): Record<string, SubsystemDocument> {
  return Array.isArray(documents)
    ? Object.fromEntries(documents.map((document) => [document.id, document]))
    : documents;
}

function normalizeSubsystemDocument(
  harness: HarnessData | null,
  document: SubsystemDocument,
): SubsystemDocument {
  if (!harness) return document;
  const entities = new Map(harness.enclosures.map((entity) => [entity.id, entity]));
  const enclosures = { ...document.enclosures };
  const devices = { ...document.devices };
  let deviceConnectorMode = document.device_connector_mode;
  let changed = false;

  for (const [id, layout] of Object.entries(document.enclosures)) {
    const entity = entities.get(id);
    if (!entity || entity.container) continue;
    if (!Object.hasOwn(devices, id)) devices[id] = layout;
    delete enclosures[id];
    changed = true;
  }
  for (const [id, layout] of Object.entries(document.devices)) {
    const entity = entities.get(id);
    if (!entity?.container) continue;
    if (!Object.hasOwn(enclosures, id)) enclosures[id] = layout;
    delete devices[id];
    if (deviceConnectorMode && Object.hasOwn(deviceConnectorMode, id)) {
      deviceConnectorMode = { ...deviceConnectorMode };
      delete deviceConnectorMode[id];
    }
    changed = true;
  }

  return changed
    ? { ...document, enclosures, devices, device_connector_mode: deviceConnectorMode }
    : document;
}

type SubsystemMapKey = 'enclosures' | 'devices' | 'connectors' | 'device_connector_mode';

export function buildSubsystemSavePayload(
  serverDocument: SubsystemDocument | undefined,
  localDocument: SubsystemDocument,
): {
  patch: SubsystemDocument;
  removed: Partial<Record<SubsystemMapKey, string[]>>;
} {
  if (!serverDocument) return { patch: localDocument, removed: {} };

  const removed: Partial<Record<SubsystemMapKey, string[]>> = {};
  const mapKeys: SubsystemMapKey[] = [
    'enclosures',
    'devices',
    'connectors',
    'device_connector_mode',
  ];
  for (const key of mapKeys) {
    const serverMap = serverDocument[key] ?? {};
    const localMap = localDocument[key] ?? {};
    const removedIds = Object.keys(serverMap).filter((id) => !Object.hasOwn(localMap, id));
    if (removedIds.length > 0) removed[key] = removedIds;
  }
  return { patch: localDocument, removed };
}

function connectorRenderedSizeForResize(
  state: HarnessStore,
  connector: Connector,
  layout: { w?: number; h?: number } | undefined,
  fallback: GraphNodeSize,
): GraphNodeSize {
  const systemSize = state.sizeLayouts[connector.id];
  const collapsedSize = {
    w: layout?.w ?? systemSize?.w ?? fallback.w,
    h: layout?.h ?? systemSize?.h ?? fallback.h,
  };
  const connectorType = state.connectorLibrary?.connector_types.find(
    (item) => item.id === connector.connector_type,
  );
  const occupiedPins = state.harness
    ? getConnectorOccupancy(state.harness, connector.id)
    : [];
  return resolveConnectorRenderedSize(
    collapsedSize,
    state.expandedNodes.has(connector.id),
    getConnectorTablePinCount(
      connector,
      connectorType,
      occupiedPins.map((pin) => pin.pinNumber),
    ),
    state.expandedSizeOverrides[connector.id],
  );
}

export const useHarnessStore = create<HarnessStore>(readOnlyMiddleware((set, get) => ({
  harness: null,
  serverHarness: null,
  connectorLibrary: null,
  serverConnectorLibrary: null,
  manufacturing: structuredClone(EMPTY_MANUFACTURING_DOCUMENT),
  serverManufacturing: structuredClone(EMPTY_MANUFACTURING_DOCUMENT),
  serverLayouts: emptyLayouts(),
  serverSubsystems: {},
  manufacturingTargetBundleId: null,
  manufacturingTab: 'cutlists',
  appView: 'canvas',
  connectorLibraryTargetId: null,
  signalLibraryTargetId: null,
  activeHarnessName: getInitialHarnessName(),
  availableHarnesses: [],
  selectedItem: null,
  nodeLayouts: {},
  isDirty: false,
  expandedNodes: new Set<string>(),
  expandedSizeOverrides: {},
  settingsOpen: false,
  drillDownEnclosure: null,
  portLayouts: {},
  sizeLayouts: {},
  freePortLayouts: {},
  backgroundLayouts: {},
  connectorTypeSizes: {},
  textBoxLayouts: {},
  selectedTextBoxId: null,
  selectedBundle: null,
  inspectorDismissed: false,
  revealRequest: null,
  revealRequestSequence: 0,
  waypointLayouts: {},
  junctionLayouts: {},
  mergePointLayouts: {},
  rotationLayouts: {},
  editingSurface: 'hierarchy',
  subsystems: {},
  activeSubsystemId: null,
  mutationError: null,
  session: { user: null, editSessionActive: false, isEditor: false },
  peers: {},
  serverRev: 0,
  libraryRev: 0,
  lastWriter: null,
  lastWriterAt: null,
  syncStatus: 'offline',
  conflict: null,
  collabAvailable: true,
  attribution: {},
  interactingEntities: new Set<string>(),
  queuedRemoteUpdates: [],
  draggingEdgeInfo: null,
  undoStack: [],
  redoStack: [],

  setActiveHarnessName: async (name) => {
    if (name === get().activeHarnessName) return true;
    const saved = await flushAutoSave();
    if (!saved) return false;
    try { localStorage.setItem('vw-active-harness', name); } catch { /* ignore */ }
    set({ activeHarnessName: name });
    return true;
  },
  setAvailableHarnesses: (harnesses) => set({ availableHarnesses: harnesses }),
  login: async (login) => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login }),
      });
      if (response.status === 404) {
        set({ collabAvailable: false });
        return { ok: false, reason: 'unavailable' };
      }
      if (response.status === 429) return { ok: false, reason: 'rateLimited' };
      if (response.status === 401) return { ok: false, reason: 'unknown' };
      if (!response.ok) return { ok: false, reason: 'error' };
      const body = await response.json() as { user: SessionUser };
      const user: SessionUser = {
        id: body.user.id,
        displayName: body.user.displayName,
        role: body.user.role,
        color: body.user.color,
      };
      set({
        session: {
          user,
          // Typing your name IS the explicit activation.
          editSessionActive: true,
          isEditor: user.role === 'editor',
        },
        collabAvailable: true,
        mutationError: null,
      });
      queuePresencePublish({});
      return { ok: true };
    } catch {
      return { ok: false, reason: 'error' };
    }
  },
  createAccount: async (login, displayName, role) => {
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, displayName, role }),
      });
      if (response.status === 404) {
        set({ collabAvailable: false });
        return { ok: false, reason: 'unavailable' };
      }
      if (response.status === 429) return { ok: false, reason: 'rateLimited' };
      if (response.status === 409) return { ok: false, reason: 'taken' };
      if (response.status === 400) return { ok: false, reason: 'invalid' };
      if (!response.ok) return { ok: false, reason: 'error' };
      const body = await response.json() as { user: SessionUser };
      const user: SessionUser = {
        id: body.user.id,
        displayName: body.user.displayName,
        role: body.user.role,
        color: body.user.color,
      };
      set({
        session: {
          user,
          // Creating your own account IS the explicit activation.
          editSessionActive: true,
          isEditor: user.role === 'editor',
        },
        collabAvailable: true,
        mutationError: null,
      });
      queuePresencePublish({});
      return { ok: true };
    } catch {
      return { ok: false, reason: 'error' };
    }
  },
  logout: async () => {
    try {
      if (get().collabAvailable) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'same-origin',
        });
      }
    } finally {
      resetPresencePublisher();
      set({
        session: { user: null, editSessionActive: false, isEditor: false },
        peers: {},
      });
    }
  },
  refreshSession: async () => {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (response.status === 404) {
        set({
          session: { user: null, editSessionActive: false, isEditor: false },
          collabAvailable: false,
        });
        return;
      }
      if (!response.ok) throw new Error(`Session request failed: ${response.status}`);
      const body = await response.json() as { user: SessionUser | null };
      const user: SessionUser | null = body.user
        ? {
            id: body.user.id,
            displayName: body.user.displayName,
            role: body.user.role,
            color: body.user.color,
          }
        : null;
      // A remembered cookie tells us who you are so the UI can offer
      // "Continue as <name>" / E, but editing stays disarmed until you activate it.
      const previous = get().session;
      const stillSameUser = !!user && previous.user?.id === user.id;
      const editSessionActive = stillSameUser && previous.editSessionActive;
      set({
        session: {
          user,
          editSessionActive,
          isEditor: editSessionActive && user?.role === 'editor',
        },
        collabAvailable: true,
      });
    } catch {
      set({
        session: { user: null, editSessionActive: false, isEditor: false },
      });
    }
  },
  activateEditSession: () => {
    const user = get().session.user;
    if (!user) return;
    set({
      session: {
        user,
        editSessionActive: true,
        isEditor: user.role === 'editor',
      },
      mutationError: null,
    });
    queuePresencePublish({});
  },
  publishPresence: (partial) => {
    queuePresencePublish(partial);
  },
  setInteracting: (kind, id, active) => {
    const key = `${kind}:${id}`;
    set((state) => {
      const interactingEntities = new Set(state.interactingEntities);
      if (active) interactingEntities.add(key);
      else interactingEntities.delete(key);
      return { interactingEntities };
    });
    if (!active && get().interactingEntities.size === 0) {
      const queued = get().queuedRemoteUpdates;
      if (queued.length > 0) {
        set({ queuedRemoteUpdates: [] });
        for (const payload of queued) applyRemoteSyncPayload(payload);
      }
    }
    get().publishPresence({
      editing: active ? { kind, id } : null,
    });
  },
  dismissConflict: () => set({ conflict: null }),
  setCollabAvailable: (available) => {
    if (!available) resetPresencePublisher();
    set({
      collabAvailable: available,
      ...(!available ? { peers: {}, syncStatus: 'offline' as const } : {}),
    });
  },
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  replacePeers: (peers) => set((state) => ({
    peers: Object.fromEntries(
      peers
        .filter((peer) => peer.userId !== state.session.user?.id)
        .map((peer) => [peer.sessionId, peer]),
    ),
  })),
  loadCollaborationMeta: ({
    serverRev,
    libraryRev,
    lastWriter,
    attribution,
    collabAvailable,
  }) => set({
    serverRev,
    libraryRev,
    lastWriter,
    lastWriterAt: lastWriter ? Date.now() : null,
    attribution,
    collabAvailable,
    conflict: null,
  }),
  applyRemoteSync: (payload) => applyRemoteSyncPayload(payload),
  renameSystem: (name) => set((state) => {
    if (!state.harness) return state;
    try {
      const harness = renameSystemDocument(state.harness, name);
      if (harness === state.harness) return state;
      const availableHarnesses = state.availableHarnesses.map((item) => (
        item.id === state.activeHarnessName && harness.name
          ? { ...item, name: harness.name }
          : item
      ));
      return historyPatch(
        state,
        { harness, availableHarnesses, isDirty: true, mutationError: null },
        'rename:system',
      );
    } catch (error) {
      return { mutationError: error instanceof Error ? error.message : 'System rename failed.' };
    }
  }),
  openConnectorLibrary: (typeId = null) => set({
    appView: 'connectorLibrary',
    connectorLibraryTargetId: typeId,
    signalLibraryTargetId: null,
  }),
  openSignalLibrary: (signalId = null) => set({
    appView: 'signalLibrary',
    connectorLibraryTargetId: null,
    signalLibraryTargetId: signalId,
    manufacturingTargetBundleId: null,
  }),
  openManufacturing: (bundleId = null) => set((state) => {
    const userId = state.session.user?.id ?? null;
    const harnessName = state.activeHarnessName;
    if (bundleId) {
      setLastManufacturingBundleId(userId, harnessName, bundleId);
    }
    const resolved = bundleId
      ?? getLastManufacturingBundleId(userId, harnessName);
    return {
      appView: 'manufacturing' as const,
      connectorLibraryTargetId: null,
      signalLibraryTargetId: null,
      manufacturingTargetBundleId: resolved,
    };
  }),
  setManufacturingTargetBundle: (bundleId) => set((state) => {
    if (bundleId) {
      setLastManufacturingBundleId(
        state.session.user?.id ?? null,
        state.activeHarnessName,
        bundleId,
      );
    }
    return { manufacturingTargetBundleId: bundleId };
  }),
  setManufacturingTab: (tab) => set({ manufacturingTab: tab }),
  showBundleInHierarchy: (pathIds) => set((state) => {
    const firstPathId = pathIds.find((pathId) =>
      state.harness?.paths.some((path) => path.id === pathId)
    );
    const drillDownEnclosure =
      state.harness && firstPathId
        ? getEntityRevealContext(
            state.harness,
            { type: 'path', id: firstPathId },
            state.drillDownEnclosure,
          )
        : state.drillDownEnclosure;
    const visibleBundles = state.harness
      ? deriveBundles(getVisibleSegments(state.harness, drillDownEnclosure))
      : [];
    const requested = new Set(pathIds);
    const visibleBundle = visibleBundles
      .map((bundle) => ({
        bundle,
        overlap: bundle.pathIds.filter((pathId) => requested.has(pathId)).length,
      }))
      .filter((entry) => entry.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)[0]?.bundle;
    const requestId = (state.revealRequestSequence ?? 0) + 1;
    return {
      appView: 'canvas',
      editingSurface: 'hierarchy',
      drillDownEnclosure,
      selectedBundle: visibleBundle
        ? { id: visibleBundle.id, pathIds: visibleBundle.pathIds }
        : firstPathId
          ? { id: '', pathIds: [firstPathId] }
          : null,
      selectedItem: null,
      selectedTextBoxId: null,
      revealRequest: firstPathId
        ? { item: { type: 'path' as const, id: firstPathId }, requestId }
        : null,
      revealRequestSequence: firstPathId ? requestId : state.revealRequestSequence,
      manufacturingTargetBundleId: null,
    };
  }),
  inspectEntity: (item) => set((state) => {
    const requestId = (state.revealRequestSequence ?? 0) + 1;
    const drillDownEnclosure = state.harness
      ? getEntityRevealContext(state.harness, item, state.drillDownEnclosure)
      : state.drillDownEnclosure;
    return {
      appView: 'canvas',
      editingSurface: 'hierarchy',
      connectorLibraryTargetId: null,
      signalLibraryTargetId: null,
      manufacturingTargetBundleId: null,
      selectedItem: item,
      selectedBundle: null,
      selectedTextBoxId: null,
      revealRequest: { item, requestId },
      revealRequestSequence: requestId,
      drillDownEnclosure,
    };
  }),
  inspectEntityQuiet: (item) => set({
    selectedItem: item,
    selectedBundle: null,
    selectedTextBoxId: null,
    revealRequest: null,
  }),
  closeConnectorLibrary: () => set({
    appView: 'canvas',
    connectorLibraryTargetId: null,
    signalLibraryTargetId: null,
    manufacturingTargetBundleId: null,
  }),
  setEditingSurface: (surface) => set({ editingSurface: surface }),
  loadSubsystems: (documents) => set((state) => {
    const serverRecords = Object.fromEntries(documents.map((document) => [document.id, document]));
    const normalizedDocuments = documents.map((document) =>
      normalizeSubsystemDocument(state.harness, document));
    const records = Object.fromEntries(normalizedDocuments.map((document) => [document.id, document]));
    return trustedDocumentPatch({
      harness: tagHarnessForSubsystems(state.harness, normalizedDocuments),
      subsystems: records,
      serverSubsystems: structuredClone(serverRecords),
      activeSubsystemId: documents[0]?.id ?? null,
    });
  }),
  setActiveSubsystem: (id) => set({ activeSubsystemId: id }),
  upsertSubsystem: (document) => set((state) => historyPatch(state, {
    subsystems: { ...state.subsystems, [document.id]: document },
    activeSubsystemId: document.id,
  }, `subsystem:${document.id}:upsert`)),
  acceptSavedSubsystem: (document) => set((state) => trustedDocumentPatch({
    subsystems: { ...state.subsystems, [document.id]: document },
    serverSubsystems: {
      ...state.serverSubsystems,
      [document.id]: structuredClone(document),
    },
  })),
  renameSubsystem: (id, name) => set((state) => {
    const subsystem = state.subsystems[id];
    if (!subsystem) return { mutationError: `Cannot rename missing subsystem '${id}'.` };
    try {
      const renamed = renameSubsystemDocument(subsystem, name);
      if (renamed === subsystem) return state;
      return historyPatch(state, {
        subsystems: { ...state.subsystems, [id]: renamed },
        isDirty: true,
        mutationError: null,
      }, `subsystem:${id}:rename`);
    } catch (error) {
      return { mutationError: error instanceof Error ? error.message : 'Subsystem rename failed.' };
    }
  }),
  updateSubsystemEntityLayout: (kind, id, layout) => set((state) => {
    const activeId = state.activeSubsystemId;
    if (!activeId || !state.subsystems[activeId]) return state;
    const document = state.subsystems[activeId];
    if (kind !== 'connectors') {
      const entity = state.harness?.enclosures.find((item) => item.id === id);
      const correctKind = entity?.container ? 'enclosures' : 'devices';
      if (!entity || kind !== correctKind) return state;
    }
    if (!Object.hasOwn(document[kind], id)) {
      if (kind !== 'connectors') return state;
      const connector = state.harness?.connectors.find((item) => item.id === id);
      const parentId = connector?.parent;
      const connectorIsImplicitlyVisible = !!parentId
        && Object.hasOwn(document.devices, parentId)
        && (document.device_connector_mode?.[parentId] ?? 'all') === 'all'
        && !(document.hidden_connectors ?? []).includes(id);
      if (!connectorIsImplicitlyVisible) return state;
    }
    return historyPatch(state, {
      subsystems: {
        ...state.subsystems,
        [activeId]: {
          ...document,
          [kind]: { ...document[kind], [id]: layout },
        },
      },
    }, `subsystem:${activeId}:${kind}:${id}:layout`);
  }),
  resizeSubsystemEntityLayout: (
    kind,
    id,
    layout,
    previousRenderedLayout,
  ) => set((state) => {
    const activeId = state.activeSubsystemId;
    const document = activeId ? state.subsystems[activeId] : undefined;
    const previousStoredLayout = document?.[kind][id];
    const harness = state.harness;
    if (!activeId || !document || !previousStoredLayout || !harness) return state;

    const inheritedDeviceSize = kind === 'devices' ? state.sizeLayouts[id] : undefined;
    const previousParent: GraphRect = {
      x: previousRenderedLayout?.x ?? previousStoredLayout.x,
      y: previousRenderedLayout?.y ?? previousStoredLayout.y,
      w: previousRenderedLayout?.w
        ?? previousStoredLayout.w
        ?? inheritedDeviceSize?.w
        ?? (kind === 'enclosures' ? 520 : 220),
      h: previousRenderedLayout?.h
        ?? previousStoredLayout.h
        ?? inheritedDeviceSize?.h
        ?? (kind === 'enclosures' ? 360 : 180),
    };
    const requestedParent: GraphRect = {
      x: layout.x,
      y: layout.y,
      w: layout.w ?? previousParent.w,
      h: layout.h ?? previousParent.h,
    };
    const hiddenConnectorIds = new Set(document.hidden_connectors ?? []);
    const connectorLayouts = new Map<string, SubsystemEntityLayout>();
    const connectorInputs: ParentResizeConnector[] = [];

    if (kind === 'devices') {
      const connectorMode = document.device_connector_mode?.[id] ?? 'all';
      const visibleConnectors = harness.connectors.filter((connector) =>
        connector.parent === id
        && !hiddenConnectorIds.has(connector.id)
        && (connectorMode === 'all' || !!document.connectors[connector.id]));
      visibleConnectors.forEach((connector, index) => {
        const storedLayout = document.connectors[connector.id];
        const systemPosition = state.portLayouts[connector.id];
        const resolvedLayout: SubsystemEntityLayout = {
          x: storedLayout?.x ?? systemPosition?.x ?? 12 + (index % 2) * 100,
          y: storedLayout?.y ?? systemPosition?.y ?? 48 + Math.floor(index / 2) * 44,
          ...(storedLayout?.w !== undefined ? { w: storedLayout.w } : {}),
          ...(storedLayout?.h !== undefined ? { h: storedLayout.h } : {}),
        };
        connectorLayouts.set(connector.id, resolvedLayout);
        connectorInputs.push({
          id: connector.id,
          position: { x: resolvedLayout.x, y: resolvedLayout.y },
          size: connectorRenderedSizeForResize(
            state,
            connector,
            storedLayout,
            { w: 96, h: 36 },
          ),
        });
      });
    } else {
      const representedDeviceIds = new Set(Object.keys(document.devices));
      for (const [connectorId, connectorLayout] of Object.entries(document.connectors)) {
        if (hiddenConnectorIds.has(connectorId)) continue;
        const connector = harness.connectors.find((entity) => entity.id === connectorId);
        const parentEntity = connector?.parent
          ? harness.enclosures.find((entity) => entity.id === connector.parent)
          : undefined;
        const isDirectFrameChild =
          connector?.parent === id
          || (
            parentEntity?.container === false
            && parentEntity.parent === id
            && !representedDeviceIds.has(parentEntity.id)
          );
        if (!connector || !isDirectFrameChild) continue;
        connectorLayouts.set(connector.id, connectorLayout);
        connectorInputs.push({
          id: connector.id,
          position: { x: connectorLayout.x, y: connectorLayout.y },
          size: connectorRenderedSizeForResize(
            state,
            connector,
            connectorLayout,
            { w: 96, h: 36 },
          ),
          wallMounted: parentEntity?.container === true,
        });
      }
    }

    const resolvedResize = resolveParentResizeWithConnectorShove(
      previousParent,
      requestedParent,
      connectorInputs,
    );
    const resolvedLayout: SubsystemEntityLayout = {
      ...layout,
      x: resolvedResize.parent.x,
      y: resolvedResize.parent.y,
      w: resolvedResize.parent.w,
      h: resolvedResize.parent.h,
    };
    let connectors = document.connectors;
    if (connectorInputs.length > 0) {
      connectors = { ...connectors };
      for (const connectorInput of connectorInputs) {
        const position = resolvedResize.connectorPositions[connectorInput.id];
        const previousConnectorLayout = connectorLayouts.get(connectorInput.id);
        if (!position || !previousConnectorLayout) continue;
        connectors[connectorInput.id] = {
          ...previousConnectorLayout,
          x: position.x,
          y: position.y,
        };
      }
    }

    let devices = document.devices;
    let enclosures = document.enclosures;
    if (kind === 'enclosures') {
      devices = { ...devices };
      enclosures = { ...enclosures, [id]: resolvedLayout };
      const deltaX = resolvedResize.parent.x - previousParent.x;
      const deltaY = resolvedResize.parent.y - previousParent.y;
      for (const [deviceId, deviceLayout] of Object.entries(document.devices)) {
        const device = harness.enclosures.find((entity) => entity.id === deviceId);
        if (device?.parent !== id) continue;
        const systemDeviceSize = state.sizeLayouts[deviceId];
        const deviceW = deviceLayout.w ?? systemDeviceSize?.w ?? 220;
        const deviceH = deviceLayout.h ?? systemDeviceSize?.h ?? 180;
        const nextX = deviceLayout.x - deltaX;
        const nextY = deviceLayout.y - deltaY;
        const maxX = Math.max(0, resolvedResize.parent.w - deviceW);
        const maxY = Math.max(0, resolvedResize.parent.h - deviceH);
        devices[deviceId] = {
          ...deviceLayout,
          x: Math.min(maxX, Math.max(0, nextX)),
          y: Math.min(maxY, Math.max(0, nextY)),
        };
      }
      for (const [childFrameId, childLayout] of Object.entries(document.enclosures)) {
        if (childFrameId === id) continue;
        const childFrame = harness.enclosures.find((entity) => entity.id === childFrameId);
        if (!childFrame?.container || childFrame.parent !== id) continue;
        const childW = childLayout.w ?? 520;
        const childH = childLayout.h ?? 360;
        const nextX = childLayout.x - deltaX;
        const nextY = childLayout.y - deltaY;
        const maxX = Math.max(0, resolvedResize.parent.w - childW);
        const maxY = Math.max(0, resolvedResize.parent.h - childH);
        enclosures[childFrameId] = {
          ...childLayout,
          x: Math.min(maxX, Math.max(0, nextX)),
          y: Math.min(maxY, Math.max(0, nextY)),
        };
      }
    }

    return historyPatch(state, {
      subsystems: {
        ...state.subsystems,
        [activeId]: {
          ...document,
          enclosures: kind === 'enclosures'
            ? enclosures
            : document.enclosures,
          devices: kind === 'devices'
            ? { ...devices, [id]: resolvedLayout }
            : devices,
          connectors,
        },
      },
    }, `subsystem:${activeId}:${kind}:${id}:resize`);
  }),
  addEntityToActiveSubsystem: (type, id) => set((state) => {
    const subsystemId = state.activeSubsystemId;
    const harness = state.harness;
    const current = subsystemId ? state.subsystems[subsystemId] : undefined;
    if (!subsystemId || !harness || !current) return state;
    const document = structuredClone(current);
    const nextHarness = structuredClone(harness);
    const systemTag = `system:${document.id}`;
    const tagEnclosure = (enclosureId: string | null | undefined) => {
      if (!enclosureId) return;
      const mutable = nextHarness.enclosures.find((item) => item.id === enclosureId);
      if (mutable && !mutable.tags.includes(systemTag)) mutable.tags.push(systemTag);
    };
    const ensureFrames = (startId: string | null) => {
      ensureSubsystemAncestorFrames(nextHarness, document, startId, (frame) => {
        if (!frame.tags.includes(systemTag)) frame.tags.push(systemTag);
      });
    };
    const nextDeviceLayout = (_deviceId: string, frameId: string | null) => {
      const index = Object.keys(document.devices).filter((deviceKey) =>
        harness.enclosures.find((item) => item.id === deviceKey)?.parent === frameId,
      ).length;
      // Omit w/h so the subsystem canvas inherits the system device size until locally resized.
      return {
        x: 40 + (index % 2) * 240,
        y: 60 + Math.floor(index / 2) * 200,
      };
    };
    const nextConnectorLayout = (connectorId: string) => {
      const systemPort = state.portLayouts[connectorId];
      const systemSize = state.sizeLayouts[connectorId];
      if (systemPort) {
        return {
          x: systemPort.x,
          y: systemPort.y,
          ...(systemSize ? { w: systemSize.w, h: systemSize.h } : {}),
        };
      }
      const index = Object.keys(document.connectors).length;
      return {
        x: 40 + (index % 3) * 112,
        y: 80 + Math.floor(index / 3) * 52,
        ...(systemSize ? { w: systemSize.w, h: systemSize.h } : { w: 96, h: 36 }),
      };
    };
    if (type === 'enclosure') {
      const entity = harness.enclosures.find((item) => item.id === id);
      if (!entity) return state;
      const mutableEntity = nextHarness.enclosures.find((item) => item.id === id);
      if (mutableEntity && !mutableEntity.tags.includes(systemTag)) mutableEntity.tags.push(systemTag);
      const isDevice = !entity.container;
      const frameId = isDevice ? entity.parent : entity.id;
      if (isDevice) delete document.enclosures[id];
      else {
        delete document.devices[id];
        if (document.device_connector_mode) delete document.device_connector_mode[id];
      }
      // Walk every container above the placed entity so nested boxes appear recursively.
      ensureFrames(isDevice ? entity.parent : entity.id);
      if (isDevice && !document.devices[id]) {
        document.devices[id] = nextDeviceLayout(id, frameId);
      }
      if (isDevice) {
        document.device_connector_mode = {
          ...(document.device_connector_mode ?? {}),
          [id]: 'all',
        };
      }
      if (isDevice) {
        for (const connector of nextHarness.connectors.filter((item) => item.parent === id)) {
          if (!connector.tags.includes(systemTag)) connector.tags.push(systemTag);
        }
      }
      return historyPatch(state, {
        harness: nextHarness,
        subsystems: { ...state.subsystems, [subsystemId]: document },
        isDirty: true,
      }, `subsystem:${subsystemId}:add:${type}:${id}`);
    }

    const connector = harness.connectors.find((item) => item.id === id);
    if (!connector) return state;
    const parentEntity = connector.parent
      ? harness.enclosures.find((item) => item.id === connector.parent)
      : undefined;
    const deviceId = parentEntity && !parentEntity.container ? parentEntity.id : null;
    const frameId = deviceId ? parentEntity?.parent ?? null : connector.parent;
    ensureFrames(frameId);
    if (deviceId && !document.devices[deviceId]) {
      document.devices[deviceId] = nextDeviceLayout(deviceId, frameId);
      document.device_connector_mode = {
        ...(document.device_connector_mode ?? {}),
        [deviceId]: 'selected',
      };
    }
    if (!document.connectors[id]) {
      document.connectors[id] = nextConnectorLayout(id);
    }
    document.hidden_connectors = (document.hidden_connectors ?? []).filter((connectorId) => connectorId !== id);
    const mutableConnector = nextHarness.connectors.find((item) => item.id === id);
    if (mutableConnector && !mutableConnector.tags.includes(systemTag)) mutableConnector.tags.push(systemTag);
    tagEnclosure(deviceId);
    return historyPatch(state, {
      harness: nextHarness,
      subsystems: { ...state.subsystems, [subsystemId]: document },
      isDirty: true,
    }, `subsystem:${subsystemId}:add:${type}:${id}`);
  }),
  removeEntityFromActiveSubsystem: (type, id) => set((state) => {
    const subsystemId = state.activeSubsystemId;
    const current = subsystemId ? state.subsystems[subsystemId] : undefined;
    if (!subsystemId || !current || !state.harness) return state;
    const document = structuredClone(current);
    const harness = structuredClone(state.harness);
    const systemTag = `system:${subsystemId}`;
    const stripTag = (tags: string[]) => tags.filter((tag) => tag !== systemTag);

    if (type === 'connector') {
      delete document.connectors[id];
      const connector = harness.connectors.find((item) => item.id === id);
      if (connector) {
        connector.tags = stripTag(connector.tags);
        if (connector.parent && document.devices[connector.parent]) {
          const mode = document.device_connector_mode?.[connector.parent] ?? 'all';
          if (mode === 'all') {
            document.hidden_connectors = Array.from(new Set([...(document.hidden_connectors ?? []), id]));
          }
        }
      }
    } else {
      const enclosure = harness.enclosures.find((item) => item.id === id);
      if (!enclosure) return state;
      enclosure.tags = stripTag(enclosure.tags);
      if (!enclosure.container) {
        delete document.enclosures[id];
        delete document.devices[id];
        if (document.device_connector_mode) delete document.device_connector_mode[id];
        const associatedConnectorIds = new Set(
          harness.connectors.filter((item) => item.parent === id).map((item) => item.id),
        );
        for (const connectorId of associatedConnectorIds) {
          delete document.connectors[connectorId];
          const connector = harness.connectors.find((item) => item.id === connectorId);
          if (connector) connector.tags = stripTag(connector.tags);
        }
        document.hidden_connectors = (document.hidden_connectors ?? []).filter((connectorId) => !associatedConnectorIds.has(connectorId));
      } else {
        const frameIdsToRemove = new Set<string>([id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const frameId of Object.keys(document.enclosures)) {
            if (frameIdsToRemove.has(frameId)) continue;
            const frame = harness.enclosures.find((item) => item.id === frameId);
            if (frame?.parent && frameIdsToRemove.has(frame.parent)) {
              frameIdsToRemove.add(frameId);
              grew = true;
            }
          }
        }
        for (const frameId of frameIdsToRemove) {
          delete document.enclosures[frameId];
          const frame = harness.enclosures.find((item) => item.id === frameId);
          if (frame) frame.tags = stripTag(frame.tags);
        }
        delete document.devices[id];
        if (document.device_connector_mode) delete document.device_connector_mode[id];
        const removedDeviceIds = harness.enclosures
          .filter((item) =>
            item.parent
            && frameIdsToRemove.has(item.parent)
            && document.devices[item.id]
          )
          .map((item) => item.id);
        for (const deviceId of removedDeviceIds) {
          delete document.devices[deviceId];
          if (document.device_connector_mode) delete document.device_connector_mode[deviceId];
          const device = harness.enclosures.find((item) => item.id === deviceId);
          if (device) device.tags = stripTag(device.tags);
        }
        for (const connector of harness.connectors) {
          const parent = connector.parent
            ? harness.enclosures.find((item) => item.id === connector.parent)
            : undefined;
          const frameId = parent && !parent.container ? parent.parent : connector.parent;
          if (!frameId || !frameIdsToRemove.has(frameId)) continue;
          delete document.connectors[connector.id];
          connector.tags = stripTag(connector.tags);
        }
      }
    }
    return historyPatch(state, {
      harness,
      subsystems: { ...state.subsystems, [subsystemId]: document },
      selectedItem: null,
      isDirty: true,
    }, `subsystem:${subsystemId}:remove:${type}:${id}`);
  }),
  renumberConnectorCavities: (connectorId, orderedOldPinNumbers) => set((state) => {
    if (!state.harness) return state;
    return historyPatch(state, {
      harness: renumberConnectorPins(state.harness, connectorId, orderedOldPinNumbers),
      isDirty: true,
    }, `connector:${connectorId}:renumber-cavities`);
  }),
  mergeBulkheadConnectors: (sourceId, targetId) => {
    const state = get();
    if (!state.harness) return null;
    const sourceConnector = state.harness.connectors.find((connector) => connector.id === sourceId);
    const targetConnector = state.harness.connectors.find((connector) => connector.id === targetId);
    if (!sourceConnector || !targetConnector) {
      set({ mutationError: 'Both bulkheads must exist to merge.' });
      return null;
    }
    // Prefer keeping authored hardware over a generated placeholder.
    let absorbId = sourceId;
    let keepId = targetId;
    if (
      !sourceConnector.tags.includes('generated')
      && targetConnector.tags.includes('generated')
    ) {
      absorbId = targetId;
      keepId = sourceId;
    }
    const surviving = keepId === targetId ? targetConnector : sourceConnector;
    const targetType = state.connectorLibrary?.connector_types.find(
      (item) => item.id === surviving.connector_type,
    );
    try {
      const harness = mergeConnectors(state.harness, absorbId, keepId, { targetType });
      const subsystems = Object.fromEntries(
        Object.entries(state.subsystems).map(([subsystemId, subsystem]) => {
          const connectors = { ...subsystem.connectors };
          const absorbedLayout = connectors[absorbId];
          delete connectors[absorbId];
          // When the drop target was the generated placeholder we swapped away,
          // keep the surviving connector at the drop position if it had no layout.
          if (absorbedLayout && !connectors[keepId]) {
            connectors[keepId] = absorbedLayout;
          }
          return [
            subsystemId,
            {
              ...subsystem,
              connectors,
              hidden_connectors: (subsystem.hidden_connectors ?? []).filter(
                (connectorId) => connectorId !== absorbId,
              ),
            },
          ];
        }),
      );
      const portLayouts = { ...state.portLayouts };
      delete portLayouts[absorbId];
      const freePortLayouts = { ...state.freePortLayouts };
      delete freePortLayouts[absorbId];
      const sizeLayouts = { ...state.sizeLayouts };
      delete sizeLayouts[absorbId];
      const rotationLayouts = { ...state.rotationLayouts };
      delete rotationLayouts[absorbId];
      set(historyPatch(state, {
        harness,
        subsystems,
        portLayouts,
        freePortLayouts,
        sizeLayouts,
        rotationLayouts,
        selectedItem: { type: 'connector', id: keepId },
        selectedBundle: null,
        mutationError: null,
        isDirty: true,
      }, `connector:${keepId}:merge`));
      return keepId;
    } catch (error) {
      set({
        mutationError: error instanceof Error ? error.message : 'Bulkhead merge failed.',
      });
      return null;
    }
  },
  getDeleteImpact: (type, id) => {
    const harness = get().harness;
    return harness ? collectDeleteImpact(harness, type, id) : emptyDeleteImpact();
  },
  deleteEntityCascade: (type, id) => set((state) => {
    if (!state.harness) return state;
    const impact = collectDeleteImpact(state.harness, type, id);
    const enclosureIds = new Set(impact.enclosureIds);
    const connectorIds = new Set(impact.connectorIds);
    const mergePointIds = new Set(impact.mergePointIds);
    const pathIds = new Set(impact.pathIds);
    const signalIds = new Set(impact.signalIds);

    // Dissolve splices first so neighbors reconnect (A–splice–B → A–B) instead
    // of wiping every path that touched the merge point.
    let harness = structuredClone(state.harness);
    for (const mergePointId of impact.mergePointIds) {
      harness = dissolveMergePoint(harness, mergePointId);
    }
    harness = {
      ...harness,
      enclosures: harness.enclosures.filter((item) => !enclosureIds.has(item.id)),
      connectors: harness.connectors.filter((item) => !connectorIds.has(item.id)),
      mergePoints: harness.mergePoints.filter((item) => !mergePointIds.has(item.id)),
      paths: harness.paths.filter((item) => !pathIds.has(item.id)),
      signals: harness.signals.filter((item) => !signalIds.has(item.id)),
    };

    const layoutCleanup = cleanLayoutsForRemovedMergePoints(state, impact.mergePointIds);
    const subsystems = Object.fromEntries(Object.entries(state.subsystems).map(([subsystemId, subsystem]) => [
      subsystemId,
      {
        ...subsystem,
        enclosures: Object.fromEntries(Object.entries(subsystem.enclosures).filter(([entityId]) => !enclosureIds.has(entityId))),
        devices: Object.fromEntries(Object.entries(subsystem.devices).filter(([entityId]) => !enclosureIds.has(entityId))),
        connectors: Object.fromEntries(Object.entries(subsystem.connectors).filter(([entityId]) => !connectorIds.has(entityId))),
      },
    ]));
    return historyPatch(state, {
      harness,
      subsystems,
      ...layoutCleanup,
      selectedItem: null,
      selectedBundle: null,
      isDirty: true,
    }, `delete:${type}:${id}`);
  }),
  deletePathBundle: (bundleId, pathIds) => set((state) => {
    if (!state.harness || pathIds.length === 0) return state;
    const ids = new Set(pathIds);
    const existingIds = state.harness.paths
      .filter((path) => ids.has(path.id))
      .map((path) => path.id);
    if (existingIds.length === 0) return state;
    const removedPathIds = new Set(existingIds);

    const harness = structuredClone(state.harness);
    harness.paths = harness.paths.filter((path) => !removedPathIds.has(path.id));
    const removedGeneratedConnectorIds = new Set(
      harness.connectors
        .filter((connector) =>
          removedPathIds.has(connector.properties.generated_by_route)
          && !harness.paths.some((path) => path.nodes.some((node) =>
            node.kind === 'connector' && node.connector_id === connector.id
          ))
        )
        .map((connector) => connector.id),
    );
    harness.connectors = harness.connectors.filter(
      (connector) => !removedGeneratedConnectorIds.has(connector.id),
    );
    const subsystems = Object.fromEntries(
      Object.entries(state.subsystems).map(([subsystemId, subsystem]) => [
        subsystemId,
        {
          ...subsystem,
          connectors: Object.fromEntries(
            Object.entries(subsystem.connectors).filter(
              ([connectorId]) => !removedGeneratedConnectorIds.has(connectorId),
            ),
          ),
          hidden_connectors: (subsystem.hidden_connectors ?? []).filter(
            (connectorId) => !removedGeneratedConnectorIds.has(connectorId),
          ),
        },
      ]),
    );

    // Bundle waypoints are presentation data. Remove the selected edge's
    // geometry so recreating the same endpoint pair starts with a clean route.
    const waypointLayouts = { ...state.waypointLayouts };
    delete waypointLayouts[bundleId];
    const junctionLayouts = structuredClone(state.junctionLayouts);
    for (const [junctionId, junction] of Object.entries(junctionLayouts)) {
      junction.memberEdgeIds = junction.memberEdgeIds.filter((edgeId) => edgeId !== bundleId);
      if (junction.memberEdgeIds.length === 0) delete junctionLayouts[junctionId];
    }

    return historyPatch(state, {
      harness,
      subsystems,
      waypointLayouts,
      junctionLayouts,
      selectedItem:
        (
          state.selectedItem?.type === 'path' && removedPathIds.has(state.selectedItem.id)
        ) || (
          state.selectedItem?.type === 'connector'
          && removedGeneratedConnectorIds.has(state.selectedItem.id)
        )
          ? null
          : state.selectedItem,
      selectedBundle: null,
      mutationError: null,
      isDirty: true,
    }, `delete:bundle:${bundleId}`);
  }),
  addSignal: (input) => {
    const state = get();
    if (!state.harness) return null;
    if (state.collabAvailable && !state.session.isEditor) {
      set({ mutationError: 'Log in to edit' });
      return null;
    }

    let name: string;
    try {
      name = normalizeDisplayName(input.name);
    } catch (error) {
      set({
        mutationError: error instanceof Error ? error.message : 'Enter a signal name.',
      });
      return null;
    }

    const slug = name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48);
    const baseId = `sig_${slug || 'NEW'}`;
    const existingIds = new Set(state.harness.signals.map((signal) => signal.id));
    let signalId = baseId;
    let suffix = 2;
    while (existingIds.has(signalId)) {
      signalId = `${baseId}_${suffix}`;
      suffix += 1;
    }

    const signal: Signal = {
      id: signalId,
      name,
      tags: Array.from(new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))),
      properties: { ...input.properties },
    };
    set((current) => {
      if (!current.harness) return current;
      const harness = structuredClone(current.harness);
      harness.signals.push(signal);
      return historyPatch(current, {
        harness,
        selectedItem: null,
        selectedBundle: null,
        mutationError: null,
        isDirty: true,
      }, `signal:${signalId}:add`);
    });
    return signalId;
  },
  addSignalPropertyDefinition: (input) => {
    const state = get();
    if (!state.harness) return null;
    if (state.collabAvailable && !state.session.isEditor) {
      set({ mutationError: 'Log in to edit' });
      return null;
    }

    let name: string;
    try {
      name = normalizeDisplayName(input.name);
    } catch (error) {
      set({
        mutationError: error instanceof Error ? error.message : 'Enter a property name.',
      });
      return null;
    }
    const options = Array.from(new Set(
      input.options.map((option) => option.trim()).filter(Boolean),
    ));
    if (options.length === 0) {
      set({ mutationError: 'Add at least one dropdown option.' });
      return null;
    }

    const keyBase = name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'property';
    const existingKeys = new Set(
      [
        'preferred_wire_color',
        ...state.harness.signalPropertyDefinitions.map((definition) => definition.key),
      ],
    );
    let key = keyBase;
    let keySuffix = 2;
    while (existingKeys.has(key)) {
      key = `${keyBase}_${keySuffix}`;
      keySuffix += 1;
    }

    const existingIds = new Set([
      ...state.harness.enclosures.map((item) => item.id),
      ...state.harness.connectors.map((item) => item.id),
      ...state.harness.mergePoints.map((item) => item.id),
      ...state.harness.paths.map((item) => item.id),
      ...state.harness.signals.map((item) => item.id),
      ...state.harness.signalPropertyDefinitions.map((item) => item.id),
    ]);
    const idBase = `signal_property_${key}`;
    let id = idBase;
    let idSuffix = 2;
    while (existingIds.has(id)) {
      id = `${idBase}_${idSuffix}`;
      idSuffix += 1;
    }

    const existingValues = state.harness.signals
      .map((signal) => signal.properties[key]?.trim())
      .filter((value): value is string => !!value);
    const definition: SignalPropertyDefinition = {
      id,
      key,
      name,
      type: 'select',
      options: Array.from(new Set([...options, ...existingValues])),
    };
    set((current) => {
      if (!current.harness) return current;
      const harness = structuredClone(current.harness);
      harness.signalPropertyDefinitions.push(definition);
      return historyPatch(current, {
        harness,
        mutationError: null,
        isDirty: true,
      }, `signal-property:${id}:add`);
    });
    return id;
  },
  updateSignalPropertyDefinition: (id, patch) => set((state) => {
    if (!state.harness) return state;
    const current = state.harness.signalPropertyDefinitions.find(
      (definition) => definition.id === id,
    );
    if (!current) {
      return { mutationError: `Cannot update missing signal property '${id}'.` };
    }

    let name = current.name;
    if (patch.name !== undefined) {
      try {
        name = normalizeDisplayName(patch.name);
      } catch (error) {
        return {
          mutationError: error instanceof Error ? error.message : 'Enter a property name.',
        };
      }
    }
    let options = current.options;
    if (patch.options !== undefined) {
      const requested = Array.from(new Set(
        patch.options.map((option) => option.trim()).filter(Boolean),
      ));
      if (requested.length === 0) {
        return { mutationError: 'A dropdown property needs at least one option.' };
      }
      const inUse = state.harness.signals
        .map((signal) => signal.properties[current.key]?.trim())
        .filter((value): value is string => !!value);
      options = Array.from(new Set([...requested, ...inUse]));
    }

    const harness = structuredClone(state.harness);
    const definition = harness.signalPropertyDefinitions.find((item) => item.id === id)!;
    definition.name = name;
    definition.options = options;
    return historyPatch(state, {
      harness,
      mutationError: null,
      isDirty: true,
    }, `signal-property:${id}:update`);
  }),
  deleteSignalPropertyDefinition: (id) => set((state) => {
    if (!state.harness) return state;
    const current = state.harness.signalPropertyDefinitions.find(
      (definition) => definition.id === id,
    );
    if (!current) return state;
    const harness = structuredClone(state.harness);
    harness.signalPropertyDefinitions = harness.signalPropertyDefinitions.filter(
      (definition) => definition.id !== id,
    );
    for (const signal of harness.signals) delete signal.properties[current.key];
    return historyPatch(state, {
      harness,
      mutationError: null,
      isDirty: true,
    }, `signal-property:${id}:delete`);
  }),
  addEnclosure: (input) => {
    const state = get();
    if (!state.harness) return null;
    if (state.collabAvailable && !state.session.isEditor) {
      set({ mutationError: 'Log in to edit' });
      return null;
    }

    const name = input.name.trim();
    if (!name) {
      set({ mutationError: 'Enter a name for the device or enclosure.' });
      return null;
    }

    if (input.parent !== null) {
      const parent = state.harness.enclosures.find((item) => item.id === input.parent);
      if (!parent?.container) {
        set({ mutationError: 'Devices and enclosures can only be placed inside an enclosure.' });
        return null;
      }
    }

    const slug = name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48);
    const prefix = input.container ? 'enc' : 'dev';
    const baseId = `${prefix}_${slug || 'new'}`;
    const existingIds = new Set([
      ...state.harness.enclosures.map((item) => item.id),
      ...state.harness.connectors.map((item) => item.id),
      ...state.harness.mergePoints.map((item) => item.id),
      ...state.harness.paths.map((item) => item.id),
      ...state.harness.signals.map((item) => item.id),
    ]);
    let enclosureId = baseId;
    let suffix = 2;
    while (existingIds.has(enclosureId)) {
      enclosureId = `${baseId}_${suffix}`;
      suffix += 1;
    }

    const enclosure: Enclosure = {
      id: enclosureId,
      name,
      parent: input.parent,
      container: input.container,
      tags: [],
      properties: {},
    };

    set((prev) => {
      if (!prev.harness) return prev;
      const harness = structuredClone(prev.harness);
      harness.enclosures.push(enclosure);
      return historyPatch(prev, {
        harness,
        selectedItem: { type: 'enclosure', id: enclosureId },
        selectedBundle: null,
        selectedTextBoxId: null,
        mutationError: null,
        isDirty: true,
      }, `enclosure:${enclosureId}:add`);
    });

    return enclosureId;
  },
  addConnector: (parentId) => {
    const state = get();
    if (!state.harness) return null;
    const parent = state.harness.enclosures.find((item) => item.id === parentId);
    if (!parent) return null;

    // Ownership is entirely via `parent`. On save, sheet split places the
    // connector on the nearest sheet-owning ancestor of that parent. Do not
    // mark `derived` or invent BulkheadPorts here — those are computed from
    // cross-sheet path usage when writing.
    const isBulkhead = parent.container;
    const genericDefaults = state.connectorLibrary?.connector_types.find(
      (type) => type.id === GENERIC_MULTIPIN_TYPE_ID,
    )?.default_properties ?? {};

    const existingIds = new Set(state.harness.connectors.map((item) => item.id));
    let n = state.harness.connectors.length + 1;
    let connectorId = `con_${String(n).padStart(3, '0')}`;
    while (existingIds.has(connectorId)) {
      n += 1;
      connectorId = `con_${String(n).padStart(3, '0')}`;
    }

    const siblingCount = state.harness.connectors.filter((item) => item.parent === parentId).length;
    const nameIndex = siblingCount + 1;
    const baseName = isBulkhead ? 'New Bulkhead' : 'New Connector';
    const siblingNames = new Set(
      state.harness.connectors.filter((item) => item.parent === parentId).map((item) => item.name),
    );
    let name = nameIndex === 1 ? baseName : `${baseName} ${nameIndex}`;
    let suffix = nameIndex;
    while (siblingNames.has(name)) {
      suffix += 1;
      name = `${baseName} ${suffix}`;
    }

    const connector: Connector = {
      id: connectorId,
      name,
      parent: parentId,
      connector_type: GENERIC_MULTIPIN_TYPE_ID,
      pin_count: 1,
      tags: isBulkhead ? ['zone:bulkhead'] : [],
      properties: { ...genericDefaults },
    };

    set((prev) => {
      if (!prev.harness) return prev;
      const harness = structuredClone(prev.harness);
      harness.connectors.push(connector);

      const portLayouts = {
        ...prev.portLayouts,
        [connectorId]: {
          x: 12 + (siblingCount % 3) * 90,
          y: 48 + Math.floor(siblingCount / 3) * 52,
        },
      };

      let subsystems = prev.subsystems;
      if (
        prev.editingSurface === 'subsystem' &&
        prev.activeSubsystemId &&
        prev.subsystems[prev.activeSubsystemId]
      ) {
        const document = structuredClone(prev.subsystems[prev.activeSubsystemId]);
        const systemTag = `system:${document.id}`;
        const mutable = harness.connectors.find((item) => item.id === connectorId);
        const nextConnectorLayout = () => ({
          x: 12 + (siblingCount % 2) * 100,
          y: 48 + Math.floor(siblingCount / 2) * 44,
          w: 96,
          h: 36,
        });

        if (document.devices[parentId]) {
          // Device connector: visible under device_connector_mode.
          const mode = document.device_connector_mode?.[parentId] ?? 'all';
          if (mode === 'selected') {
            document.connectors[connectorId] = nextConnectorLayout();
          }
          document.hidden_connectors = (document.hidden_connectors ?? []).filter((id) => id !== connectorId);
          if (mutable && !mutable.tags.includes(systemTag)) mutable.tags.push(systemTag);
          subsystems = { ...prev.subsystems, [document.id]: document };
        } else if (document.enclosures[parentId]) {
          // Enclosure bulkhead on a subsystem frame. Frame-level connectors are
          // only rendered when explicitly listed in subsystem.connectors.
          document.connectors[connectorId] = nextConnectorLayout();
          document.hidden_connectors = (document.hidden_connectors ?? []).filter((id) => id !== connectorId);
          if (mutable && !mutable.tags.includes(systemTag)) mutable.tags.push(systemTag);
          subsystems = { ...prev.subsystems, [document.id]: document };
        }
      }

      return historyPatch(prev, {
        harness,
        subsystems,
        portLayouts,
        selectedItem: { type: 'connector', id: connectorId },
        selectedBundle: null,
        selectedTextBoxId: null,
        isDirty: true,
      }, `connector:${connectorId}:add`);
    });

    return connectorId;
  },
  moveHierarchyEntity: (type, id, newParentId, beforeId = null) => {
    const state = get();
    if (!state.harness) return false;
    if (state.collabAvailable && !state.session.isEditor) {
      set({ mutationError: 'Log in to edit' });
      return false;
    }
    try {
      const harness = relocateHierarchyEntity(state.harness, type, id, newParentId, beforeId ?? null);
      if (harness === state.harness) return true;
      set((prev) => historyPatch(prev, {
        harness,
        isDirty: true,
        mutationError: null,
      }, `hierarchy:${type}:${id}:move`));
      return true;
    } catch (error) {
      set({
        mutationError: error instanceof Error ? error.message : 'Could not move hierarchy entity.',
      });
      return false;
    }
  },
  setConnectorType: (connectorId, typeId) => set((state) => {
    if (!state.harness) return state;
    const libraryType = state.connectorLibrary?.connector_types.find((item) => item.id === typeId);
    if (!libraryType) {
      return { mutationError: `Unknown connector type '${typeId}'.` };
    }
    const harness = structuredClone(state.harness);
    const connector = harness.connectors.find((item) => item.id === connectorId);
    if (!connector) return state;
    const maxUsedPin = Math.max(
      0,
      ...getConnectorOccupancy(harness, connectorId).map((entry) => entry.pinNumber),
    );
    connector.connector_type = typeId;
    connector.properties = {
      ...(libraryType.default_properties ?? {}),
      ...connector.properties,
    };
    const floor = getConnectorTypeCavityFloor(libraryType);
    const requested = isConnectorFamily(libraryType)
      ? Math.max(floor, connector.pin_count ?? 0, maxUsedPin)
      : Math.max(
          libraryType.id === GENERIC_MULTIPIN_TYPE_ID
            ? 1
            : Math.max(floor, libraryType.pin_count),
          maxUsedPin,
        );
    applyConnectorPinCount(connector, libraryType, requested);
    normalizeConnectorKeying(connector, libraryType);
    return historyPatch(
      state,
      { harness, isDirty: true, mutationError: null },
      `connector:${connectorId}:type`,
    );
  }),
  setConnectorKeying: (connectorId, keying) => set((state) => {
    if (!state.harness) return state;
    const harness = structuredClone(state.harness);
    const connector = harness.connectors.find((item) => item.id === connectorId);
    if (!connector) return state;
    const type = state.connectorLibrary?.connector_types.find(
      (item) => item.id === connector.connector_type,
    );
    const supported = getConnectorSupportedKeyings(connector, type);
    if (keying && !supported.includes(keying)) {
      return { mutationError: `Key '${keying}' is not available for this connector housing.` };
    }
    if (keying) connector.keying = keying;
    else delete connector.keying;
    return historyPatch(
      state,
      { harness, isDirty: true, mutationError: null },
      `connector:${connectorId}:keying`,
    );
  }),
  addConnectorCavity: (connectorId) => set((state) => {
    if (!state.harness) return state;
    const harness = structuredClone(state.harness);
    const connector = harness.connectors.find((item) => item.id === connectorId);
    if (!connector) return state;
    const type = state.connectorLibrary?.connector_types.find(
      (item) => item.id === connector.connector_type,
    );
    const current = getEffectivePinCount(connector, type);
    const next = getNextConnectorPinCount(type, current);
    if (next === current) return state;
    applyConnectorPinCount(connector, type, next);
    normalizeConnectorKeying(connector, type);
    return historyPatch(state, { harness, isDirty: true }, `connector:${connectorId}:add-cavity`);
  }),
  removeConnectorCavity: (connectorId) => set((state) => {
    if (!state.harness) return state;
    const harness = structuredClone(state.harness);
    const connector = harness.connectors.find((item) => item.id === connectorId);
    if (!connector) return state;
    const type = state.connectorLibrary?.connector_types.find(
      (item) => item.id === connector.connector_type,
    );
    const current = getEffectivePinCount(connector, type);
    const maxUsedPin = Math.max(
      0,
      ...getConnectorOccupancy(harness, connectorId).map((entry) => entry.pinNumber),
    );
    const next = getPreviousConnectorPinCount(type, current, maxUsedPin);
    if (next === current) return state;
    applyConnectorPinCount(connector, type, next);
    normalizeConnectorKeying(connector, type);
    return historyPatch(state, { harness, isDirty: true }, `connector:${connectorId}:remove-cavity`);
  }),
  renameEntity: (type, id, name) => set((state) => {
    if (!state.harness) return state;
    try {
      const harness = renameHarnessEntity(state.harness, type, id, name);
      return harness === state.harness
        ? state
        : historyPatch(
            state,
            { harness, isDirty: true, mutationError: null },
            `rename:${type}:${id}`,
          );
    } catch (error) {
      return { mutationError: error instanceof Error ? error.message : 'Rename failed.' };
    }
  }),
  updateSignalName: (signalId, name) => get().renameEntity('signal', signalId, name),
  updateSignalProperty: (signalId, key, value) => set((state) => {
    if (!state.harness) return state;
    const harness = structuredClone(state.harness);
    const signal = harness.signals.find((item) => item.id === signalId);
    if (signal) {
      if (value === '') delete signal.properties[key];
      else signal.properties[key] = value;
    }
    return historyPatch(
      state,
      { harness, isDirty: true },
      `signal:${signalId}:property:${key}`,
    );
  }),
  updatePathSignal: (pathId, signalId) => set((state) => {
    if (!state.harness) return state;
    if (signalId && !state.harness.signals.some((signal) => signal.id === signalId)) {
      return { mutationError: `Cannot assign missing signal '${signalId}'.` };
    }

    const harness = structuredClone(state.harness);
    const path = harness.paths.find((item) => item.id === pathId);
    if (!path) return state;

    path.tags = path.tags.filter((tag) => !tag.startsWith('signal:'));
    if (signalId) {
      path.signal_id = signalId;
      path.tags.push(`signal:${signalId.replace(/^sig_/, '')}`);
    } else {
      delete path.signal_id;
    }

    return historyPatch(
      state,
      { harness, isDirty: true, mutationError: null },
      `path:${pathId}:signal`,
    );
  }),
  updatePathProperty: (pathId, key, value) => set((state) => {
    if (!state.harness) return state;
    const harness = structuredClone(state.harness);
    const path = harness.paths.find((item) => item.id === pathId);
    if (path) {
      path.properties ??= {};
      if (value === '') delete path.properties[key];
      else path.properties[key] = value;
      // Keep wire_color as the canonical key; drop legacy `color` whenever either changes.
      if (key === 'wire_color') delete path.properties.color;
    }
    return historyPatch(
      state,
      { harness, isDirty: true },
      `path:${pathId}:property:${key}`,
    );
  }),
  updateConnectorPathsGauge: (connectorId, gauge, side = 'both') => set((state) => {
    if (!state.harness) return state;
    const trimmed = gauge.trim();
    const harness = structuredClone(state.harness);
    const targets = getPathsTouchingConnector(harness, connectorId, side);
    if (targets.length === 0) return state;
    let changed = false;
    for (const path of targets) {
      path.properties ??= {};
      const current = path.properties.wire_gauge ?? '';
      if (trimmed === '') {
        if (path.properties.wire_gauge !== undefined) {
          delete path.properties.wire_gauge;
          changed = true;
        }
      } else if (current !== trimmed) {
        path.properties.wire_gauge = trimmed;
        changed = true;
      }
    }
    return changed
      ? historyPatch(
          state,
          { harness, isDirty: true, mutationError: null },
          `connector:${connectorId}:paths-gauge:${side}`,
        )
      : state;
  }),
  updatePathSegmentLength: (pathId, segmentIndex, lengthMm) => set((state) => {
    if (!state.harness) return state;
    if (lengthMm !== undefined && (!Number.isFinite(lengthMm) || lengthMm < 0)) {
      return { mutationError: 'Stretch length must be a non-negative number.' };
    }

    const currentPath = state.harness.paths.find((item) => item.id === pathId);
    if (!currentPath || !currentPath.nodes[segmentIndex + 1]) return state;
    if (getPathSegmentMeasurement(currentPath, segmentIndex)?.length_mm === lengthMm) return state;

    const harness = structuredClone(state.harness);
    const path = harness.paths.find((item) => item.id === pathId)!;
    setPathSegmentLength(path, segmentIndex, lengthMm);

    return historyPatch(
      state,
      { harness, isDirty: true, mutationError: null },
      `path:${pathId}:segment:${segmentIndex}:length`,
    );
  }),
  updatePathSegmentLengths: (updates) => set((state) => {
    if (!state.harness || updates.length === 0) return state;
    for (const update of updates) {
      if (update.lengthMm !== undefined && (!Number.isFinite(update.lengthMm) || update.lengthMm < 0)) {
        return { mutationError: 'Stretch length must be a non-negative number.' };
      }
    }

    const harness = structuredClone(state.harness);
    let changed = false;
    for (const update of updates) {
      const path = harness.paths.find((item) => item.id === update.pathId);
      if (!path || !path.nodes[update.segmentIndex + 1]) continue;
      changed = setPathSegmentLength(path, update.segmentIndex, update.lengthMm) || changed;
    }
    return changed
      ? historyPatch(
          state,
          { harness, isDirty: true, mutationError: null },
          `paths:${updates.map((update) => update.pathId).sort().join(',')}:segment-lengths`,
        )
      : state;
  }),
  updatePathSpanLengths: (updates) => set((state) => {
    if (!state.harness || updates.length === 0) return state;
    for (const update of updates) {
      if (update.lengthMm !== undefined && (!Number.isFinite(update.lengthMm) || update.lengthMm < 0)) {
        return { mutationError: 'Stretch length must be a non-negative number.' };
      }
    }

    const harness = structuredClone(state.harness);
    let changed = false;
    for (const update of updates) {
      const path = harness.paths.find((item) => item.id === update.pathId);
      if (!path) continue;
      changed = applySpanTotalLength(
        path,
        update.fromNodeIndex,
        update.toNodeIndex,
        update.lengthMm,
      ) || changed;
    }
    return changed
      ? historyPatch(
          state,
          { harness, isDirty: true, mutationError: null },
          `paths:${updates.map((update) => update.pathId).sort().join(',')}:span-lengths`,
        )
      : state;
  }),
  updateConnectorPairSegmentLengths: (pathId, segmentIndex, lengthMm) => set((state) => {
    if (!state.harness) return state;
    if (!Number.isFinite(lengthMm) || lengthMm < 0) {
      return { mutationError: 'Stretch length must be a non-negative number.' };
    }

    const currentPath = state.harness.paths.find((item) => item.id === pathId);
    const from = currentPath?.nodes[segmentIndex];
    const to = currentPath?.nodes[segmentIndex + 1];
    if (!currentPath || !from || !to) return state;
    if (from.kind !== 'connector' || to.kind !== 'connector') {
      const harness = structuredClone(state.harness);
      const path = harness.paths.find((item) => item.id === pathId)!;
      return setPathSegmentLength(path, segmentIndex, lengthMm)
        ? historyPatch(
            state,
            { harness, isDirty: true, mutationError: null },
            `path:${pathId}:segment:${segmentIndex}:pair-length`,
          )
        : state;
    }

    const harness = structuredClone(state.harness);
    const matches = getConnectorPairSegments(harness, from.connector_id, to.connector_id);
    let changed = false;
    for (const match of matches) {
      changed = setPathSegmentLength(match.path, match.segmentIndex, lengthMm) || changed;
    }
    return changed
      ? historyPatch(
          state,
          { harness, isDirty: true, mutationError: null },
          `path:${pathId}:segment:${segmentIndex}:pair-length`,
        )
      : state;
  }),
  updateBundleSegmentLengths: (bundleId, pathIds, lengthMm) => set((state) => {
    if (!state.harness) return state;
    if (lengthMm !== undefined && (!Number.isFinite(lengthMm) || lengthMm < 0)) {
      return { mutationError: 'Stretch length must be a non-negative number.' };
    }
    if (!bundleId || pathIds.length === 0) return state;

    const harness = structuredClone(state.harness);
    const matches = getBundleSegments(harness, bundleId, pathIds);
    let changed = false;
    for (const match of matches) {
      changed = setPathSegmentLength(match.path, match.segmentIndex, lengthMm) || changed;
    }
    return changed
      ? historyPatch(
          state,
          { harness, isDirty: true, mutationError: null },
          `bundle:${bundleId}:length`,
        )
      : state;
  }),
  setMutationError: (message) => set({ mutationError: message }),
  resetForHarnessSwitch: () => set(trustedDocumentPatch({
    harness: null,
    serverHarness: null,
    nodeLayouts: {},
    portLayouts: {},
    sizeLayouts: {},
    freePortLayouts: {},
    backgroundLayouts: {},
    connectorTypeSizes: {},
    textBoxLayouts: {},
    waypointLayouts: {},
    junctionLayouts: {},
    mergePointLayouts: {},
    rotationLayouts: {},
    editingSurface: 'hierarchy',
    subsystems: {},
    activeSubsystemId: null,
    mutationError: null,
    undoStack: [],
    redoStack: [],
    selectedItem: null,
    selectedBundle: null,
    selectedTextBoxId: null,
    revealRequest: null,
    drillDownEnclosure: null,
    expandedNodes: new Set(),
    expandedSizeOverrides: {},
    isDirty: false,
    draggingEdgeInfo: null,
    manufacturing: structuredClone(EMPTY_MANUFACTURING_DOCUMENT),
    serverManufacturing: structuredClone(EMPTY_MANUFACTURING_DOCUMENT),
    serverLayouts: emptyLayouts(),
    serverSubsystems: {},
    manufacturingTargetBundleId: null,
    signalLibraryTargetId: null,
    serverRev: 0,
    lastWriter: null,
    lastWriterAt: null,
    attribution: {},
    peers: {},
    conflict: null,
    interactingEntities: new Set(),
    queuedRemoteUpdates: [],
  })),

  loadHarness: (data) => set((state) => {
    const harness = normalizeHarness(data);
    const availableHarnesses = harness.name
      ? state.availableHarnesses.map((item) => (
        item.id === state.activeHarnessName
          ? { ...item, name: harness.name as string }
          : item
      ))
      : state.availableHarnesses;
    const patch = {
      harness,
      serverHarness: structuredClone(harness),
      availableHarnesses,
      isDirty: false,
    };
    if (!state.harness) return trustedDocumentPatch(patch);
    const changedIds = changedHarnessEntityIds(diffHarness(state.harness, harness)).sort();
    return trustedDocumentPatch(historyPatch(
      state,
      patch,
      `server:harness:${changedIds.join(',') || 'metadata'}`,
    ));
  }),
  loadConnectorLibrary: (data) => set((state) => {
    const patch = {
      connectorLibrary: data,
      serverConnectorLibrary: structuredClone(data),
    };
    if (!state.connectorLibrary) return trustedDocumentPatch(patch);
    const diff = diffLibrary(state.connectorLibrary, data);
    const changedIds = [
      ...Object.keys(diff.connectorTypes.patch),
      ...diff.connectorTypes.removed,
    ].sort();
    return trustedDocumentPatch(historyPatch(
      state,
      patch,
      `server:library:${changedIds.join(',') || 'metadata'}`,
    ));
  }),
  loadManufacturing: (data) => set(trustedDocumentPatch({
    manufacturing: {
      schema_version: '1.2.0',
      bundles: data?.bundles ?? {},
    },
    serverManufacturing: {
      schema_version: '1.2.0',
      bundles: structuredClone(data?.bundles ?? {}),
    },
  })),
  updateManufacturingEndpointGender: (
    bundleId,
    connectorId,
    gender,
    mateBundleIds,
  ) => set((state) => historyPatch(state, {
    manufacturing: assignManufacturingEndpointGender(
      state.manufacturing,
      bundleId,
      connectorId,
      gender,
      mateBundleIds,
    ),
    isDirty: true,
  }, `manufacturing:${bundleId}:gender:${connectorId}`)),
  updateManufacturingStep: (bundleId, componentKey, step, completed) => set((state) => {
    const document = structuredClone(state.manufacturing);
    const progress = document.bundles[bundleId] ?? { steps: {} };
    const stepIndex = MANUFACTURING_STEPS.findIndex((candidate) => candidate.id === step);
    if (stepIndex < 0) return state;
    const componentSteps = {
      ...(progress.component_steps?.[componentKey] ?? progress.steps),
    };
    const wasCompleted = !!componentSteps[step];
    for (let index = 0; index < MANUFACTURING_STEPS.length; index += 1) {
      const candidate = MANUFACTURING_STEPS[index].id;
      if (completed && index <= stepIndex) componentSteps[candidate] = true;
      if (!completed && index >= stepIndex) delete componentSteps[candidate];
    }
    progress.component_steps = {
      ...(progress.component_steps ?? {}),
      [componentKey]: componentSteps,
    };
    if (wasCompleted !== completed) {
      const user = state.session.user;
      const actor = {
        user_id: user?.id ?? 'unattributed',
        user_name: user?.displayName ?? 'Unattributed',
        day: new Date().toISOString().slice(0, 10),
      };
      const taskKey = `component:${componentKey}:step:${step}`;
      progress.task_attribution = { ...(progress.task_attribution ?? {}) };
      if (completed) progress.task_attribution[taskKey] = actor;
      else delete progress.task_attribution[taskKey];
      const now = Date.now();
      progress.work_log = [
        ...(progress.work_log ?? []),
        {
          id: `work:${bundleId}:${now}:${progress.work_log?.length ?? 0}`,
          task_key: taskKey,
          kind: 'component-step',
          action: completed ? 'complete' : 'reopen',
          state: step,
          ...actor,
        },
      ];
    }
    document.schema_version = '1.2.0';
    document.bundles[bundleId] = progress;
    return historyPatch(
      state,
      { manufacturing: document, isDirty: true },
      `manufacturing:${bundleId}:${componentKey}:${step}`,
    );
  }),
  updateManufacturingTasks: (bundleId, updates) => set((state) => {
    if (updates.length === 0) return state;
    const user = state.session.user;
    const manufacturing = applyManufacturingTaskUpdates(
      state.manufacturing,
      bundleId,
      updates,
      {
        user_id: user?.id ?? 'unattributed',
        user_name: user?.displayName ?? 'Unattributed',
        day: new Date().toISOString().slice(0, 10),
      },
    );
    if (deepEqual(manufacturing, state.manufacturing)) return state;
    return historyPatch(
      state,
      { manufacturing, isDirty: true },
      `manufacturing:${bundleId}:visual-tasks`,
    );
  }),
  updateManufacturingNotes: (bundleId, notes) => set((state) => {
    const document = structuredClone(state.manufacturing);
    const progress = document.bundles[bundleId] ?? { steps: {} };
    const normalized = notes.trim();
    if (normalized) progress.notes = notes;
    else delete progress.notes;
    document.bundles[bundleId] = progress;
    return historyPatch(
      state,
      { manufacturing: document, isDirty: true },
      `manufacturing:${bundleId}:notes`,
    );
  }),
  updateConnectorLibrary: (data) => set((state) => {
    if (!state.connectorLibrary) return { connectorLibrary: data, isDirty: true };
    const diff = diffLibrary(state.connectorLibrary, data);
    const changedIds = [
      ...Object.keys(diff.connectorTypes.patch),
      ...diff.connectorTypes.removed,
    ].sort();
    return historyPatch(
      state,
      { connectorLibrary: data, isDirty: true },
      `library:${changedIds.join(',') || 'metadata'}`,
    );
  }),
  loadLayouts: (layouts) => set((state) => trustedDocumentPatch({
    nodeLayouts: layouts,
    serverLayouts: { ...state.serverLayouts, nodes: structuredClone(layouts) },
  })),
  loadPortLayouts: (ports) => {
    const clean: PortLayouts = {};
    for (const [key, value] of Object.entries(ports)) {
      if (typeof value.x === 'number' && typeof value.y === 'number') {
        clean[key] = value;
      }
    }
    set((state) => trustedDocumentPatch({
      portLayouts: clean,
      serverLayouts: { ...state.serverLayouts, ports: structuredClone(clean) },
    }));
  },
  loadSizeLayouts: (sizes) => set((state) => trustedDocumentPatch({
    sizeLayouts: sizes,
    serverLayouts: { ...state.serverLayouts, sizes: structuredClone(sizes) },
  })),
  loadFreePortLayouts: (free) => set((state) => trustedDocumentPatch({
    freePortLayouts: free,
    serverLayouts: { ...state.serverLayouts, free: structuredClone(free) },
  })),
  loadBackgroundLayouts: (bg) => set((state) => trustedDocumentPatch({
    backgroundLayouts: bg,
    serverLayouts: { ...state.serverLayouts, backgrounds: structuredClone(bg) },
  })),
  loadConnectorTypeSizes: (sizes) => set((state) => trustedDocumentPatch({
    connectorTypeSizes: sizes,
    serverLayouts: { ...state.serverLayouts, connectorTypeSizes: structuredClone(sizes) },
  })),
  loadTextBoxLayouts: (tbs) =>
    set((state) => {
      const textBoxLayouts = Object.fromEntries(
        Object.entries(tbs).map(([id, tb]) => [id, { ...tb, contextKey: tb.contextKey ?? 'graph' }]),
      );
      return trustedDocumentPatch({
        textBoxLayouts,
        serverLayouts: {
          ...state.serverLayouts,
          textBoxes: structuredClone(textBoxLayouts),
        },
      });
    }),
  loadWaypointLayouts: (wps) => set((state) => trustedDocumentPatch({
    waypointLayouts: wps,
    serverLayouts: { ...state.serverLayouts, waypoints: structuredClone(wps) },
  })),
  loadJunctionLayouts: (junctions) => set((state) => trustedDocumentPatch({
    junctionLayouts: junctions,
    serverLayouts: { ...state.serverLayouts, junctions: structuredClone(junctions) },
  })),
  loadMergePointLayouts: (layouts) => set((state) => trustedDocumentPatch({
    mergePointLayouts: layouts,
    serverLayouts: { ...state.serverLayouts, mergePoints: structuredClone(layouts) },
  })),
  loadRotationLayouts: (rotations) => set((state) => trustedDocumentPatch({
    rotationLayouts: rotations,
    serverLayouts: { ...state.serverLayouts, rotations: structuredClone(rotations) },
  })),
  rotateConnector: (connectorId) =>
    set((state) => {
      const current = state.rotationLayouts[connectorId] ?? 0;
      const next = (current + 90) % 360;
      return historyPatch(state, {
        rotationLayouts: { ...state.rotationLayouts, [connectorId]: next },
        isDirty: true,
      }, `connector:${connectorId}:rotate`);
    }),
  rotateEnclosure: (enclosureId) =>
    set((state) => {
      const current = state.rotationLayouts[enclosureId] ?? 0;
      const next = (current + 90) % 360;
      const rotationLayouts = { ...state.rotationLayouts, [enclosureId]: next };
      const harness = state.harness;

      if (
        state.editingSurface === 'subsystem' &&
        state.activeSubsystemId &&
        harness
      ) {
        const subsystem = state.subsystems[state.activeSubsystemId];
        const deviceLayout = subsystem?.devices[enclosureId];
        if (subsystem && deviceLayout) {
          const oldSize = {
            w: deviceLayout.w ?? 220,
            h: deviceLayout.h ?? 180,
          };
          const hiddenConnectorIds = new Set(subsystem.hidden_connectors ?? []);
          const connectorMode = subsystem.device_connector_mode?.[enclosureId] ?? 'all';
          const connectors = harness.connectors.filter((connector) =>
            connector.parent === enclosureId &&
            !hiddenConnectorIds.has(connector.id) &&
            (connectorMode === 'all' || !!subsystem.connectors[connector.id]),
          );
          const connectorLayouts = { ...subsystem.connectors };
          const childLayouts = connectors.map((connector, index) => {
            const layout = connectorLayouts[connector.id] ?? {
              x: 12 + (index % 2) * 100,
              y: 48 + Math.floor(index / 2) * 44,
            };
            const savedSize = {
              w: layout.w ?? 96,
              h: layout.h ?? 36,
            };
            const type = state.connectorLibrary?.connector_types.find(
              (item) => item.id === connector.connector_type,
            );
            const occupancy = getConnectorOccupancy(state.harness!, connector.id);
            const pinCount = getConnectorTablePinCount(
              connector,
              type,
              occupancy.map((pin) => pin.pinNumber),
            );
            const renderedSize = resolveConnectorRenderedSize(
              savedSize,
              state.expandedNodes.has(connector.id),
              pinCount,
              state.expandedSizeOverrides[connector.id],
            );
            return { connector, layout, renderedSize };
          });
          const newSize = {
            w: Math.max(oldSize.h, ...childLayouts.map(({ renderedSize }) => renderedSize.w)),
            h: Math.max(oldSize.w, ...childLayouts.map(({ renderedSize }) => renderedSize.h)),
          };

          for (const { connector, layout, renderedSize } of childLayouts) {
            connectorLayouts[connector.id] = {
              ...layout,
              ...rotateChildClockwise(layout, renderedSize, oldSize, newSize),
            };
          }

          const parentEnclosureId = harness.enclosures.find(
            (enclosure) => enclosure.id === enclosureId,
          )?.parent;
          const parentLayout = parentEnclosureId
            ? subsystem.enclosures[parentEnclosureId]
            : undefined;
          const centeredX = deviceLayout.x + (oldSize.w - newSize.w) / 2;
          const centeredY = deviceLayout.y + (oldSize.h - newSize.h) / 2;
          const nextDeviceLayout = {
            ...deviceLayout,
            x: parentLayout
              ? clampToRange(centeredX, (parentLayout.w ?? 520) - newSize.w)
              : centeredX,
            y: parentLayout
              ? clampToRange(centeredY, (parentLayout.h ?? 360) - newSize.h)
              : centeredY,
            w: newSize.w,
            h: newSize.h,
          };
          const nextSubsystem = {
            ...subsystem,
            devices: {
              ...subsystem.devices,
              [enclosureId]: nextDeviceLayout,
            },
            connectors: connectorLayouts,
          };

          return historyPatch(state, {
            rotationLayouts,
            subsystems: {
              ...state.subsystems,
              [subsystem.id]: nextSubsystem,
            },
            isDirty: true,
          }, `enclosure:${enclosureId}:rotate`);
        }
      }

      if (!harness) {
        return historyPatch(
          state,
          { rotationLayouts, isDirty: true },
          `enclosure:${enclosureId}:rotate`,
        );
      }

      const oldSize = state.sizeLayouts[enclosureId] ?? { w: 220, h: 180 };
      const connectors = harness.connectors.filter(
        (connector) => connector.parent === enclosureId,
      );
      const childLayouts = connectors.map((connector, index) => {
        const position = state.portLayouts[connector.id] ?? {
          x: 12 + (index % 3) * 90,
          y: 48 + Math.floor(index / 3) * 52,
        };
        const savedSize = state.sizeLayouts[connector.id] ?? { w: 100, h: 32 };
        const type = state.connectorLibrary?.connector_types.find(
          (item) => item.id === connector.connector_type,
        );
        const occupancy = getConnectorOccupancy(harness, connector.id);
        const pinCount = getConnectorTablePinCount(
          connector,
          type,
          occupancy.map((pin) => pin.pinNumber),
        );
        const renderedSize = resolveConnectorRenderedSize(
          savedSize,
          state.expandedNodes.has(connector.id),
          pinCount,
          state.expandedSizeOverrides[connector.id],
        );
        return { connector, position, renderedSize };
      });
      const newSize = {
        w: Math.max(oldSize.h, ...childLayouts.map(({ renderedSize }) => renderedSize.w)),
        h: Math.max(oldSize.w, ...childLayouts.map(({ renderedSize }) => renderedSize.h)),
      };
      const portLayouts = { ...state.portLayouts };
      for (const { connector, position, renderedSize } of childLayouts) {
        portLayouts[connector.id] = rotateChildClockwise(
          position,
          renderedSize,
          oldSize,
          newSize,
        );
      }
      const oldPosition = state.nodeLayouts[enclosureId];
      const nodeLayouts = oldPosition
        ? {
            ...state.nodeLayouts,
            [enclosureId]: {
              x: oldPosition.x + (oldSize.w - newSize.w) / 2,
              y: oldPosition.y + (oldSize.h - newSize.h) / 2,
            },
          }
        : state.nodeLayouts;

      return historyPatch(state, {
        rotationLayouts,
        nodeLayouts,
        portLayouts,
        sizeLayouts: {
          ...state.sizeLayouts,
          [enclosureId]: newSize,
        },
        isDirty: true,
      }, `enclosure:${enclosureId}:rotate`);
    }),

  updateBackground: (contextKey, patch) =>
    set((state) => {
      const prev = state.backgroundLayouts[contextKey];
      return historyPatch(state, {
        backgroundLayouts: {
          ...state.backgroundLayouts,
          [contextKey]: { ...(prev ?? { x: 0, y: 0, w: 800, h: 600, locked: false, image: '' }), ...patch },
        },
      }, `background:${contextKey}`);
    }),
  removeBackground: (contextKey) =>
    set((state) => {
      const next = { ...state.backgroundLayouts };
      delete next[contextKey];
      return historyPatch(
        state,
        { backgroundLayouts: next },
        `background:${contextKey}:remove`,
      );
    }),

  addTextBox: (x, y) => {
    const id = `tb_${Date.now()}`;
    set((state) => historyPatch(state, {
      textBoxLayouts: {
        ...state.textBoxLayouts,
        [id]: {
          id,
          contextKey: state.drillDownEnclosure ?? 'graph',
          x,
          y,
          w: 220,
          h: 110,
          text: 'Text',
          bgColor: '#1e293b',
          textColor: '#f8fafc',
          fontSize: 14,
          fontFamily: 'sans' as TextBoxFontFamily,
          fontWeight: 'normal' as TextBoxFontWeight,
          textAlign: 'left' as TextBoxTextAlign,
          borderColor: '#4b5563',
          borderWidth: 0,
          borderRadius: 4,
          opacity: 1,
          padding: 10,
        },
      },
      selectedTextBoxId: id,
      selectedItem: null,
      selectedBundle: null,
    }, `textBox:${id}:add`));
  },
  updateTextBox: (id, patch) =>
    set((state) => {
      const prev = state.textBoxLayouts[id];
      if (!prev) return state;
      return historyPatch(state, {
        textBoxLayouts: { ...state.textBoxLayouts, [id]: { ...prev, ...patch } },
      }, `textBox:${id}:${Object.keys(patch).sort().join(',')}`);
    }),
  removeTextBox: (id) =>
    set((state) => {
      const next = { ...state.textBoxLayouts };
      delete next[id];
      return historyPatch(state, {
        textBoxLayouts: next,
        selectedTextBoxId: state.selectedTextBoxId === id ? null : state.selectedTextBoxId,
      }, `textBox:${id}:remove`);
    }),
  selectTextBox: (id) => set({
    selectedTextBoxId: id,
    selectedItem: null,
    selectedBundle: null,
    inspectorDismissed: false,
    revealRequest: null,
  }),

  selectItem: (item) => set({
    selectedItem: item,
    selectedBundle: null,
    selectedTextBoxId: null,
    inspectorDismissed: false,
    revealRequest: null,
  }),
  revealItem: (item) => set((state) => {
    const requestId = (state.revealRequestSequence ?? 0) + 1;
    const drillDownEnclosure =
      state.editingSurface === 'hierarchy' && state.harness
        ? getEntityRevealContext(state.harness, item, state.drillDownEnclosure)
        : state.drillDownEnclosure;
    return {
      selectedItem: item,
      selectedBundle: null,
      selectedTextBoxId: null,
      inspectorDismissed: false,
      revealRequest: { item, requestId },
      revealRequestSequence: requestId,
      drillDownEnclosure,
    };
  }),
  toggleNodeExpanded: (nodeId) =>
    set((state) => {
      const next = new Set(state.expandedNodes);
      const expandedSizeOverrides = { ...state.expandedSizeOverrides };
      if (next.has(nodeId)) {
        next.delete(nodeId);
        delete expandedSizeOverrides[nodeId];
      } else {
        next.add(nodeId);
      }
      return { expandedNodes: next, expandedSizeOverrides };
    }),
  updateExpandedNodeSize: (nodeId, w, h) =>
    set((state) => ({
      expandedSizeOverrides: { ...state.expandedSizeOverrides, [nodeId]: { w, h } },
    })),

  updateNodePosition: (nodeId, x, y) => set((state) => historyPatch(state, {
    nodeLayouts: { ...state.nodeLayouts, [nodeId]: { x, y } },
  }, `node:${nodeId}:position`)),
  resizeHierarchyEntityLayout: (nodeId, previousLayout, layout) =>
    set((state) => {
      const harness = state.harness;
      const entity = harness?.enclosures.find((candidate) => candidate.id === nodeId);
      if (!harness || !entity) {
        return historyPatch(state, {
          nodeLayouts: {
            ...state.nodeLayouts,
            [nodeId]: { x: layout.x, y: layout.y },
          },
          sizeLayouts: {
            ...state.sizeLayouts,
            [nodeId]: { w: layout.w, h: layout.h },
          },
        }, `node:${nodeId}:resize`);
      }

      const directConnectors = harness.connectors.filter(
        (connector) => connector.parent === nodeId,
      );
      const connectorInputs = directConnectors.map((connector, index) => {
        const position = state.portLayouts[connector.id] ?? {
          x: 12 + (index % 3) * 90,
          y: 48 + Math.floor(index / 3) * 52,
        };
        return {
          id: connector.id,
          position,
          size: connectorRenderedSizeForResize(
            state,
            connector,
            state.sizeLayouts[connector.id],
            { w: 100, h: 32 },
          ),
          wallMounted: entity.container,
        } satisfies ParentResizeConnector;
      });
      const resolvedResize = resolveParentResizeWithConnectorShove(
        previousLayout,
        layout,
        connectorInputs,
      );
      const portLayouts = { ...state.portLayouts };
      for (const connector of directConnectors) {
        const position = resolvedResize.connectorPositions[connector.id];
        if (position) portLayouts[connector.id] = position;
      }

      return historyPatch(state, {
        nodeLayouts: {
          ...state.nodeLayouts,
          [nodeId]: {
            x: resolvedResize.parent.x,
            y: resolvedResize.parent.y,
          },
        },
        portLayouts,
        sizeLayouts: {
          ...state.sizeLayouts,
          [nodeId]: {
            w: resolvedResize.parent.w,
            h: resolvedResize.parent.h,
          },
        },
      }, `node:${nodeId}:resize`);
    }),
  updatePortLayout: (connectorId, x, y) => set((state) => historyPatch(state, {
    portLayouts: { ...state.portLayouts, [connectorId]: { x, y } },
  }, `connector:${connectorId}:port-position`)),
  updateNodeSize: (nodeId, w, h) => set((state) => historyPatch(state, {
    sizeLayouts: { ...state.sizeLayouts, [nodeId]: { w, h } },
  }, `node:${nodeId}:size`)),
  updateFreePortLayout: (connectorId, x, y) => set((state) => historyPatch(state, {
    freePortLayouts: { ...state.freePortLayouts, [connectorId]: { x, y } },
  }, `connector:${connectorId}:free-position`)),
  updateMergePointLayout: (contextKey, mergePointId, x, y) =>
    set((state) => historyPatch(state, {
      mergePointLayouts: {
        ...state.mergePointLayouts,
        [contextKey]: {
          ...(state.mergePointLayouts[contextKey] ?? {}),
          [mergePointId]: { x, y },
        },
      },
    }, `mergePoint:${mergePointId}:position`)),

  setDrillDown: (encId) => set({
    drillDownEnclosure: encId,
    selectedItem: null,
    selectedBundle: null,
    selectedTextBoxId: null,
    revealRequest: null,
  }),
  setSelectedBundle: (bundle) => set({
    selectedBundle: bundle,
    selectedItem: null,
    selectedTextBoxId: null,
    inspectorDismissed: false,
    revealRequest: null,
  }),
  dismissInspector: () => set({ inspectorDismissed: true }),

  setEdgeWaypoints: (edgeId, waypoints) => set((state) => historyPatch(state, {
    waypointLayouts: { ...state.waypointLayouts, [edgeId]: waypoints },
  }, `edge:${edgeId}:waypoints`)),
  createJunction: (pos, edgeId, waypointIndex) => {
    const id = `jct_${crypto.randomUUID()}`;
    set((state) => {
      const waypoints = [...(state.waypointLayouts[edgeId] ?? [])];
      waypoints[waypointIndex] = { junctionId: id };
      const harness = state.harness;
      const parsed = harness ? parseBundleId(edgeId) : null;
      let mergePointId: string | undefined;
      let nextHarness = harness;
      let nextMergePointLayouts = state.mergePointLayouts;
      let nextWaypointLayouts = { ...state.waypointLayouts, [edgeId]: waypoints };

      if (harness && parsed) {
        const matchingPaths = harness.paths.filter((path) =>
          findPathSegmentForBundle(path, edgeId) !== null,
        );
        if (matchingPaths.length > 0) {
          mergePointId = nextMergePointId(harness);
          const spliceCount = harness.mergePoints.length + 1;
          const parentEnclosure = state.drillDownEnclosure;
          const contextKey = parentEnclosure ?? 'graph';
          const newMerge: MergePoint = {
            id: mergePointId,
            name: `Splice ${spliceCount}`,
            parent: parentEnclosure,
            tags: [],
            properties: {},
          };
          const updatedPaths = harness.paths.map((path) =>
            splicePathWithMerge(path, edgeId, mergePointId!),
          );
          nextHarness = {
            ...harness,
            mergePoints: [...harness.mergePoints, newMerge],
            paths: updatedPaths,
          };
          nextMergePointLayouts = {
            ...state.mergePointLayouts,
            [contextKey]: {
              ...(state.mergePointLayouts[contextKey] ?? {}),
              [mergePointId]: { x: pos.x, y: pos.y },
            },
          };
          // The semantic merge splits this bundle into new sub-bundle ids.
          nextWaypointLayouts = { ...state.waypointLayouts };
          delete nextWaypointLayouts[edgeId];
        }
      }

      return historyPatch(state, {
        junctionLayouts: {
          ...state.junctionLayouts,
          [id]: { id, x: pos.x, y: pos.y, memberEdgeIds: [edgeId], mergePointId },
        },
        waypointLayouts: nextWaypointLayouts,
        mergePointLayouts: nextMergePointLayouts,
        harness: nextHarness,
      }, `junction:${id}:create`);
    });
    return id;
  },
  moveJunction: (junctionId, pos) =>
    set((state) => {
      const junction = state.junctionLayouts[junctionId];
      if (!junction) return state;
      return historyPatch(state, {
        junctionLayouts: {
          ...state.junctionLayouts,
          [junctionId]: { ...junction, x: pos.x, y: pos.y },
        },
      }, `junction:${junctionId}:position`);
    }),
  deleteJunction: (junctionId) =>
    set((state) => {
      const junction = state.junctionLayouts[junctionId];
      if (!junction) return state;
      const waypointLayouts = { ...state.waypointLayouts };
      for (const edgeId of junction.memberEdgeIds) {
        const edgeWaypoints = waypointLayouts[edgeId];
        if (!edgeWaypoints) continue;
        waypointLayouts[edgeId] = edgeWaypoints.map((waypoint) =>
          'junctionId' in waypoint && waypoint.junctionId === junctionId
            ? { x: junction.x, y: junction.y }
            : waypoint,
        );
      }
      const nextJunctions = { ...state.junctionLayouts };
      delete nextJunctions[junctionId];

      // Coupled junction: dissolve the MergePoint so neighbors reconnect.
      const harness = state.harness;
      const mergePointId = junction.mergePointId;
      let nextHarness = harness;
      let nextMergePointLayouts = state.mergePointLayouts;
      if (harness && mergePointId) {
        nextHarness = dissolveMergePoint(harness, mergePointId);
        nextMergePointLayouts = stripMergePointLayouts(state.mergePointLayouts, [mergePointId]);
      }

      return historyPatch(state, {
        junctionLayouts: nextJunctions,
        waypointLayouts,
        harness: nextHarness,
        mergePointLayouts: nextMergePointLayouts,
      }, `junction:${junctionId}:delete`);
    }),
  linkEdgeToJunction: (junctionId, edgeId, insertAfterIndex) =>
    set((state) => {
      const junction = state.junctionLayouts[junctionId];
      if (!junction || junction.memberEdgeIds.includes(edgeId)) return state;
      const waypoints = [...(state.waypointLayouts[edgeId] ?? [])];
      const insertAt = Math.min(waypoints.length, Math.max(0, insertAfterIndex + 1));
      waypoints.splice(insertAt, 0, { junctionId });
      const harness = state.harness;
      const mergePointId = junction.mergePointId;
      let nextHarness = harness;
      let nextWaypointLayouts: WaypointLayouts = {
        ...state.waypointLayouts,
        [edgeId]: waypoints,
      };

      if (harness && mergePointId) {
        const parsed = parseBundleId(edgeId);
        if (parsed) {
          const updatedPaths = harness.paths.map((path) => {
            const alreadyLinked = path.nodes.some(
              (node) => node.kind === 'merge' && node.merge_point_id === mergePointId,
            );
            return alreadyLinked
              ? path
              : splicePathWithMerge(path, edgeId, mergePointId);
          });
          if (updatedPaths.some((path, index) => path !== harness.paths[index])) {
            nextHarness = { ...harness, paths: updatedPaths };
            // The semantic merge splits this bundle into new sub-bundle ids.
            nextWaypointLayouts = { ...state.waypointLayouts };
            delete nextWaypointLayouts[edgeId];
          }
        }
      }

      return historyPatch(state, {
        junctionLayouts: {
          ...state.junctionLayouts,
          [junctionId]: { ...junction, memberEdgeIds: [...junction.memberEdgeIds, edgeId] },
        },
        waypointLayouts: nextWaypointLayouts,
        harness: nextHarness,
      }, `junction:${junctionId}:link:${edgeId}`);
    }),
  unlinkEdgeFromJunction: (junctionId, edgeId) =>
    set((state) => {
      const junction = state.junctionLayouts[junctionId];
      if (!junction) return state;
      const waypoints = (state.waypointLayouts[edgeId] ?? []).map((waypoint) =>
        'junctionId' in waypoint && waypoint.junctionId === junctionId
          ? { x: junction.x, y: junction.y }
          : waypoint,
      );
      const remaining = junction.memberEdgeIds.filter((memberEdgeId) => memberEdgeId !== edgeId);

      // When the junction is coupled, drop the MergePoint reference from any
      // path whose nodes[] still flows through this edge's endpoints around
      // the merge.  A path is only affected here if its endpoint connectors
      // on either side of the merge match this edge's bundle endpoints.
      const harness = state.harness;
      const mergePointId = junction.mergePointId;
      let nextHarness = harness;
      let nextMergePointLayouts = state.mergePointLayouts;
      if (harness && mergePointId) {
        const parsed = parseBundleId(edgeId);
        const updatedPaths = harness.paths.map((path) => {
          if (!parsed) return path;
          const nodes = path.nodes;
          for (let i = 1; i < nodes.length - 1; i++) {
            const mid = nodes[i];
            if (mid.kind !== 'merge' || mid.merge_point_id !== mergePointId) continue;
            const prevKey = getPathNodeBundleKey(nodes[i - 1]);
            const nextKey = getPathNodeBundleKey(nodes[i + 1]);
            const matches =
              (prevKey === parsed.sourceRefKey && nextKey === parsed.targetRefKey) ||
              (prevKey === parsed.targetRefKey && nextKey === parsed.sourceRefKey);
            if (matches) {
              return removePathNodeAt(path, i);
            }
          }
          return path;
        });

        if (remaining.length === 0) {
          // Last edge: dissolve the MergePoint so any remaining references reconnect.
          nextHarness = dissolveMergePoint({ ...harness, paths: updatedPaths }, mergePointId);
          nextMergePointLayouts = stripMergePointLayouts(state.mergePointLayouts, [mergePointId]);
        } else {
          nextHarness = { ...harness, paths: updatedPaths };
        }
      }

      if (remaining.length === 0) {
        const nextJunctions = { ...state.junctionLayouts };
        delete nextJunctions[junctionId];
        return historyPatch(state, {
          junctionLayouts: nextJunctions,
          waypointLayouts: { ...state.waypointLayouts, [edgeId]: waypoints },
          harness: nextHarness,
          mergePointLayouts: nextMergePointLayouts,
        }, `junction:${junctionId}:unlink:${edgeId}`);
      }
      return historyPatch(state, {
        junctionLayouts: {
          ...state.junctionLayouts,
          [junctionId]: { ...junction, memberEdgeIds: remaining },
        },
        waypointLayouts: { ...state.waypointLayouts, [edgeId]: waypoints },
        harness: nextHarness,
        mergePointLayouts: nextMergePointLayouts,
      }, `junction:${junctionId}:unlink:${edgeId}`);
    }),
  setDraggingEdgeInfo: (info) => set({ draggingEdgeInfo: info }),

  pushUndoSnapshot: (actionKey = 'manual') =>
    set((state) => {
      const now = Date.now();
      const current = makeSnapshot(state);
      const top = state.undoStack.at(-1);
      if (top?.active) return state;
      if (top?.actionKey === actionKey && now - top.updatedAt <= 2_000) {
        return {
          undoStack: [
            ...state.undoStack.slice(0, -1),
            { ...top, active: true, updatedAt: now },
          ],
          redoStack: [],
        };
      }
      return {
        undoStack: appendUndoEntry(state.undoStack, {
          before: current,
          after: current,
          actionKey,
          capturedAt: now,
          updatedAt: now,
          active: true,
        }),
        redoStack: [],
      };
    }),
  commitUndoSnapshot: () =>
    set((state) => {
      const top = state.undoStack.at(-1);
      if (!top?.active) return state;
      const current = makeSnapshot(state);
      const after = applySnapshotDelta(top.after, top.after, current);
      if (snapshotsEqual(top.before, after)) {
        return { undoStack: state.undoStack.slice(0, -1) };
      }
      return {
        undoStack: [
          ...state.undoStack.slice(0, -1),
          { ...top, after, active: false, updatedAt: Date.now() },
        ],
      };
    }),
  cancelUndoSnapshot: () =>
    set((state) => {
      const top = state.undoStack.at(-1);
      if (!top?.active) return state;
      const current = makeSnapshot(state);
      return snapshotsEqual(top.before, current)
        ? { undoStack: state.undoStack.slice(0, -1) }
        : {
            undoStack: [
              ...state.undoStack.slice(0, -1),
              { ...top, after: current, active: false, updatedAt: Date.now() },
            ],
          };
    }),
  getUndoAffectedEntities: () => {
    const entry = get().undoStack.at(-1);
    return entry ? getEntryAffectedEntities(entry) : [];
  },
  undo: () =>
    set((state) => {
      if (state.undoStack.length === 0) return state;
      const current = makeSnapshot(state);
      const pending = state.undoStack[state.undoStack.length - 1];
      const entry = pending.active
        ? { ...pending, after: current, active: false, updatedAt: Date.now() }
        : pending;
      if (snapshotsEqual(entry.before, entry.after)) {
        return { undoStack: state.undoStack.slice(0, -1) };
      }
      return {
        ...scopedHistoryPatch(state, entry, 'undo'),
        undoStack: state.undoStack.slice(0, -1),
        redoStack: appendUndoEntry(state.redoStack, entry),
      };
    }),
  redo: () =>
    set((state) => {
      if (state.redoStack.length === 0) return state;
      const entry = state.redoStack[state.redoStack.length - 1];
      return {
        ...scopedHistoryPatch(state, entry, 'redo'),
        undoStack: appendUndoEntry(state.undoStack, entry),
        redoStack: state.redoStack.slice(0, -1),
      };
    }),
  updateConnectorTypeImage: (typeId, image, pinCount) =>
    set((state) => {
      if (!state.connectorLibrary) return state;
      const library = structuredClone(state.connectorLibrary);
      const connectorType = library.connector_types.find((item) => item.id === typeId);
      const variant = connectorType?.cavity_variants?.find((item) => item.pin_count === pinCount);
      if (variant) variant.image = image || undefined;
      else if (connectorType) connectorType.image = image || undefined;
      return historyPatch(
        state,
        { connectorLibrary: library, isDirty: true },
        `connectorType:${typeId}:image:${pinCount ?? 'default'}`,
      );
    }),
  updateConnectorTypeSideImage: (typeId, image, pinCount) =>
    set((state) => {
      if (!state.connectorLibrary) return state;
      const library = structuredClone(state.connectorLibrary);
      const connectorType = library.connector_types.find((item) => item.id === typeId);
      const variant = connectorType?.cavity_variants?.find((item) => item.pin_count === pinCount);
      if (variant) variant.side_image = image || undefined;
      else if (connectorType) connectorType.side_image = image || undefined;
      return historyPatch(
        state,
        { connectorLibrary: library, isDirty: true },
        `connectorType:${typeId}:side-image:${pinCount ?? 'default'}`,
      );
    }),
  updateEnclosureProperty: (encId, key, value) =>
    set((state) => {
      if (!state.harness) return state;
      const harness = structuredClone(state.harness);
      const enclosure = harness.enclosures.find((item) => item.id === encId);
      if (enclosure) {
        if (value === '') delete enclosure.properties[key];
        else enclosure.properties[key] = value;
      }
      return historyPatch(
        state,
        { harness, isDirty: true },
        `enclosure:${encId}:property:${key}`,
      );
    }),
  updateConnectorProperty: (conId, key, value) =>
    set((state) => {
      if (!state.harness) return state;
      const harness = structuredClone(state.harness);
      const connector = harness.connectors.find((item) => item.id === conId);
      if (connector) {
        if (value === '') delete connector.properties[key];
        else connector.properties[key] = value;
      }
      return historyPatch(
        state,
        { harness, isDirty: true },
        `connector:${conId}:property:${key}`,
      );
    }),

  addTag: (entityType, entityId, tag) =>
    set((state) => {
      if (!state.harness) return state;
      const harness = structuredClone(state.harness);
      const target = findMutableEntity(harness, entityType, entityId);
      if (target && !target.tags.includes(tag)) target.tags.push(tag);
      return historyPatch(
        state,
        { harness, isDirty: true },
        `${entityType}:${entityId}:tag`,
      );
    }),
  removeTag: (entityType, entityId, tag) =>
    set((state) => {
      if (!state.harness) return state;
      const harness = structuredClone(state.harness);
      const target = findMutableEntity(harness, entityType, entityId);
      if (target) target.tags = target.tags.filter((item) => item !== tag);
      return historyPatch(
        state,
        { harness, isDirty: true },
        `${entityType}:${entityId}:tag`,
      );
    }),

  setSettingsOpen: (open) => set({ settingsOpen: open }),

  getAllExistingTags: () => {
    const harness = get().harness;
    if (!harness) return [];
    const tagSet = new Set<string>();
    for (const item of [...harness.enclosures, ...harness.connectors, ...harness.mergePoints, ...harness.paths, ...harness.signals]) {
      for (const tag of item.tags) tagSet.add(tag);
    }
    return [...tagSet].sort();
  },
  findEntity: (type, id) => {
    const harness = get().harness;
    if (!harness) return undefined;
    switch (type) {
      case 'enclosure':
        return harness.enclosures.find((item) => item.id === id);
      case 'connector':
        return harness.connectors.find((item) => item.id === id);
      case 'mergePoint':
        return harness.mergePoints.find((item) => item.id === id);
      case 'path':
        return harness.paths.find((item) => item.id === id);
      case 'signal':
        return harness.signals.find((item) => item.id === id);
      default:
        return undefined;
    }
  },
})));

function tagHarnessForSubsystems(
  source: HarnessData | null,
  documents: SubsystemDocument[],
): HarnessData | null {
  if (!source) return null;
  const harness = structuredClone(source);
  const addSystemTag = (tags: string[], subsystemId: string) => {
    const tag = `system:${subsystemId}`;
    if (!tags.includes(tag)) tags.push(tag);
  };
  for (const document of documents) {
    const enclosureMembership = new Set([
      ...Object.keys(document.enclosures),
      ...Object.keys(document.devices),
    ]);
    for (const enclosure of harness.enclosures) {
      if (enclosureMembership.has(enclosure.id)) addSystemTag(enclosure.tags, document.id);
    }
    for (const connector of harness.connectors) {
      const deviceMode = connector.parent
        ? document.device_connector_mode?.[connector.parent] ?? 'all'
        : 'all';
      if (
        document.connectors[connector.id]
        || (connector.parent !== null && document.devices[connector.parent] && deviceMode === 'all')
      ) {
        addSystemTag(connector.tags, document.id);
      }
    }
  }
  return harness;
}

function emptyDeleteImpact(): DeleteImpact {
  return { enclosureIds: [], connectorIds: [], mergePointIds: [], pathIds: [], signalIds: [] };
}

function stripMergePointLayouts(
  layouts: MergePointLayouts,
  mergePointIds: Iterable<string>,
): MergePointLayouts {
  const removed = new Set(mergePointIds);
  if (removed.size === 0) return layouts;
  return Object.fromEntries(
    Object.entries(layouts).map(([ctxKey, mpMap]) => {
      const nextMap = Object.fromEntries(
        Object.entries(mpMap).filter(([mergePointId]) => !removed.has(mergePointId)),
      );
      return [ctxKey, nextMap];
    }),
  );
}

function cleanLayoutsForRemovedMergePoints(
  state: {
    mergePointLayouts: MergePointLayouts;
    junctionLayouts: JunctionLayouts;
    waypointLayouts: WaypointLayouts;
  },
  mergePointIds: Iterable<string>,
): {
  mergePointLayouts: MergePointLayouts;
  junctionLayouts: JunctionLayouts;
  waypointLayouts: WaypointLayouts;
} {
  const removed = new Set(mergePointIds);
  if (removed.size === 0) {
    return {
      mergePointLayouts: state.mergePointLayouts,
      junctionLayouts: state.junctionLayouts,
      waypointLayouts: state.waypointLayouts,
    };
  }

  const mergePointLayouts = stripMergePointLayouts(state.mergePointLayouts, removed);
  const junctionLayouts = { ...state.junctionLayouts };
  const waypointLayouts = { ...state.waypointLayouts };
  for (const [junctionId, junction] of Object.entries(state.junctionLayouts)) {
    if (!junction.mergePointId || !removed.has(junction.mergePointId)) continue;
    for (const edgeId of junction.memberEdgeIds) {
      const edgeWaypoints = waypointLayouts[edgeId];
      if (!edgeWaypoints) continue;
      waypointLayouts[edgeId] = edgeWaypoints.map((waypoint) =>
        'junctionId' in waypoint && waypoint.junctionId === junctionId
          ? { x: junction.x, y: junction.y }
          : waypoint,
      );
    }
    delete junctionLayouts[junctionId];
  }

  return { mergePointLayouts, junctionLayouts, waypointLayouts };
}

function collectDeleteImpact(
  harness: HarnessData,
  type: 'enclosure' | 'connector' | 'mergePoint' | 'path' | 'signal',
  id: string,
): DeleteImpact {
  const impact = emptyDeleteImpact();
  const enclosureIds = new Set<string>();
  const connectorIds = new Set<string>();
  const mergePointIds = new Set<string>();
  const pathIds = new Set<string>();

  if (type === 'enclosure') {
    enclosureIds.add(id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const enclosure of harness.enclosures) {
        if (enclosure.parent && enclosureIds.has(enclosure.parent) && !enclosureIds.has(enclosure.id)) {
          enclosureIds.add(enclosure.id);
          changed = true;
        }
      }
    }
    for (const connector of harness.connectors) {
      if (connector.parent && enclosureIds.has(connector.parent)) connectorIds.add(connector.id);
    }
    for (const mergePoint of harness.mergePoints) {
      if (mergePoint.parent && enclosureIds.has(mergePoint.parent)) mergePointIds.add(mergePoint.id);
    }
  } else if (type === 'connector') {
    connectorIds.add(id);
  } else if (type === 'mergePoint') {
    mergePointIds.add(id);
  } else if (type === 'path') {
    pathIds.add(id);
  }

  // Paths are cascade-deleted when they touch deleted connectors. Merge points
  // are dissolved instead — only unpairable remnants disappear.
  for (const wirePath of harness.paths) {
    if (wirePath.nodes.some((node) =>
      node.kind === 'connector' && connectorIds.has(node.connector_id),
    )) {
      pathIds.add(wirePath.id);
    }
  }

  let harnessAfterDissolve = harness;
  for (const mergePointId of mergePointIds) {
    const beforeIds = new Set(harnessAfterDissolve.paths.map((path) => path.id));
    harnessAfterDissolve = dissolveMergePoint(harnessAfterDissolve, mergePointId);
    const afterIds = new Set(harnessAfterDissolve.paths.map((path) => path.id));
    for (const pathId of beforeIds) {
      if (!afterIds.has(pathId)) pathIds.add(pathId);
    }
  }

  if (type === 'signal') {
    impact.signalIds.push(id);
    const legacyTag = `signal:${id.replace(/^sig_/, '')}`;
    for (const wirePath of harness.paths) {
      if (wirePath.signal_id === id || wirePath.tags.includes(legacyTag)) pathIds.add(wirePath.id);
    }
  }

  impact.enclosureIds = [...enclosureIds];
  impact.connectorIds = [...connectorIds];
  impact.mergePointIds = [...mergePointIds];
  impact.pathIds = [...pathIds];
  return impact;
}

function findMutableEntity(
  harness: HarnessData,
  entityType: string,
  entityId: string,
): { tags: string[] } | undefined {
  switch (entityType) {
    case 'enclosure':
      return harness.enclosures.find((item) => item.id === entityId);
    case 'connector':
      return harness.connectors.find((item) => item.id === entityId);
    case 'mergePoint':
      return harness.mergePoints.find((item) => item.id === entityId);
    case 'path':
      return harness.paths.find((item) => item.id === entityId);
    case 'signal':
      return harness.signals.find((item) => item.id === entityId);
    default:
      return undefined;
  }
}

function isMapPatch<T>(value: unknown): value is MapPatch<T> {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MapPatch<T>>;
  return !!candidate.patch
    && typeof candidate.patch === 'object'
    && Array.isArray(candidate.removed);
}

function payloadDocuments(payload: SyncPayload): CollaborationDocumentState {
  return payload.full ? payload : (payload.changed ?? payload);
}

function payloadTouchesInteraction(payload: SyncPayload, state: HarnessStore): boolean {
  if (state.interactingEntities.size === 0) return false;
  const ids = new Set(
    [...state.interactingEntities].map((key) => key.slice(key.indexOf(':') + 1)),
  );
  if (payload.changedEntityIds && payload.changedEntityIds.length > 0) {
    return payload.changedEntityIds.some((id) => ids.has(id));
  }
  const documents = payloadDocuments(payload);
  return !!(
    documents.harness
    || documents.connectorLibrary
    || documents.library
    || documents.layouts
    || documents.manufacturing
    || documents.subsystems
  );
}

function remoteLayouts(
  current: CollaborationLayouts,
  incoming: CollaborationDocumentState['layouts'],
  full: boolean,
): CollaborationLayouts | null {
  if (!incoming) return null;
  if ('patch' in incoming && 'removed' in incoming) {
    return applyLayoutPatch(current, incoming, 'contexts');
  }
  return full
    ? normalizeLayouts(incoming)
    : normalizeLayouts({ ...current, ...incoming });
}

function remoteManufacturing(
  current: ManufacturingDocument,
  incoming: CollaborationDocumentState['manufacturing'],
): ManufacturingDocument | null {
  if (!incoming) return null;
  if (isMapPatch<ManufacturingDocument['bundles'][string]>(incoming)) {
    return {
      schema_version: '1.2.0',
      bundles: applyRecordDiff(current.bundles, incoming),
    };
  }
  return {
    schema_version: '1.2.0',
    bundles: incoming.bundles ?? {},
  };
}

function remoteSubsystems(
  current: Record<string, SubsystemDocument>,
  incoming: CollaborationDocumentState['subsystems'],
  full: boolean,
): Record<string, SubsystemDocument> | null {
  if (!incoming) return null;
  if (isMapPatch<SubsystemDocument>(incoming)) return applyRecordDiff(current, incoming);
  const records = subsystemRecord(incoming);
  return full ? records : { ...current, ...records };
}

function applyRemoteSyncPayload(payload: SyncPayload): void {
  const state = useHarnessStore.getState();
  if (payloadTouchesInteraction(payload, state)) {
    useHarnessStore.setState({
      queuedRemoteUpdates: [...state.queuedRemoteUpdates, payload],
    });
    return;
  }

  const documents = payloadDocuments(payload);
  const incomingLibrary = documents.connectorLibrary ?? documents.library;
  const libraryOnly = !!incomingLibrary
    && !documents.harness
    && !documents.layouts
    && !documents.manufacturing
    && !documents.subsystems;
  const patch: Partial<HarnessStore> = {
    serverRev: libraryOnly ? state.serverRev : Math.max(state.serverRev, payload.rev),
    libraryRev: Math.max(
      state.libraryRev,
      payload.libraryRev ?? (libraryOnly ? payload.rev : state.libraryRev),
    ),
  };
  let nextConflict: SyncConflict | null = null;

  if (documents.harness) {
    const remote = normalizeHarness(documents.harness);
    if (!state.serverHarness || !state.harness) {
      patch.serverHarness = remote;
      patch.harness = structuredClone(remote);
    } else {
      const localDiff = diffHarness(state.serverHarness, state.harness);
      patch.serverHarness = remote;
      if (isHarnessDiffEmpty(localDiff)) {
        patch.harness = structuredClone(remote);
      } else {
        const rebased = rebaseHarness(state.serverHarness, state.harness, remote);
        if (rebased.value) {
          patch.harness = rebased.value;
        } else {
          nextConflict = {
            kind: 'rebase',
            server: {
              error: 'remote-deletion',
              currentRev: payload.rev,
              lastWriter: documents.lastWriter ?? payload.by ?? state.lastWriter,
              changedEntityIds: rebased.conflictIds,
            },
            localDiffJson: JSON.stringify(localDiff, null, 2),
          };
        }
      }
    }
  }

  if (incomingLibrary) {
    if (!state.serverConnectorLibrary || !state.connectorLibrary) {
      patch.serverConnectorLibrary = incomingLibrary;
      patch.connectorLibrary = structuredClone(incomingLibrary);
    } else {
      const localDiff = diffLibrary(state.serverConnectorLibrary, state.connectorLibrary);
      patch.serverConnectorLibrary = incomingLibrary;
      if (isLibraryDiffEmpty(localDiff)) {
        patch.connectorLibrary = structuredClone(incomingLibrary);
      } else {
        const rebased = rebaseLibrary(
          state.serverConnectorLibrary,
          state.connectorLibrary,
          incomingLibrary,
        );
        if (rebased.value) {
          patch.connectorLibrary = rebased.value;
        } else {
          nextConflict = {
            kind: 'rebase',
            server: {
              error: 'remote-deletion',
              currentRev: payload.libraryRev ?? state.libraryRev,
              lastWriter: documents.lastWriter ?? payload.by ?? state.lastWriter,
              changedEntityIds: rebased.conflictIds,
            },
            localDiffJson: JSON.stringify(localDiff, null, 2),
          };
        }
      }
    }
  }

  const nextRemoteLayouts = remoteLayouts(state.serverLayouts, documents.layouts, payload.full);
  if (nextRemoteLayouts) {
    const merged = mergeRemoteLayouts(state.serverLayouts, getLayouts(state), nextRemoteLayouts);
    patch.serverLayouts = merged.server;
    Object.assign(patch, layoutStatePatch(merged.live));
  }

  const nextRemoteManufacturing = remoteManufacturing(
    state.serverManufacturing,
    documents.manufacturing,
  );
  if (nextRemoteManufacturing) {
    const merged = mergeRemoteRecord(
      state.serverManufacturing.bundles,
      state.manufacturing.bundles,
      nextRemoteManufacturing.bundles,
    );
    patch.serverManufacturing = nextRemoteManufacturing;
    patch.manufacturing = {
      schema_version: '1.2.0',
      bundles: merged.live,
    };
  }

  const nextRemoteSubsystems = remoteSubsystems(
    state.serverSubsystems,
    documents.subsystems,
    payload.full,
  );
  if (nextRemoteSubsystems) {
    const merged = mergeRemoteRecord(
      state.serverSubsystems,
      state.subsystems,
      nextRemoteSubsystems,
    );
    patch.serverSubsystems = merged.server;
    const subsystemHarness = patch.harness ?? state.harness;
    patch.subsystems = Object.fromEntries(
      Object.entries(merged.live).map(([id, document]) => [
        id,
        normalizeSubsystemDocument(subsystemHarness, document),
      ]),
    );
  }

  if (documents.attribution) {
    patch.attribution = payload.full
      ? documents.attribution
      : { ...state.attribution, ...documents.attribution };
  }
  const writer = documents.lastWriter !== undefined
    ? documents.lastWriter
    : payload.by;
  if (writer !== undefined) {
    patch.lastWriter = writer;
    patch.lastWriterAt = writer ? Date.now() : null;
  }
  if (nextConflict) patch.conflict = nextConflict;

  useHarnessStore.setState(trustedDocumentPatch(patch));
  useHarnessStore.setState({ isDirty: hasOutstandingChanges(useHarnessStore.getState()) });
}

const PRESENCE_HEARTBEAT_MS = 10_000;
const PRESENCE_COALESCE_MS = 50;
let pendingPresence: PresenceUpdate = {};
let presenceTimer: ReturnType<typeof setTimeout> | null = null;
let presenceHeartbeat: ReturnType<typeof setInterval> | null = null;
let lastPresenceSentAt = 0;

function resetPresencePublisher(): void {
  if (presenceTimer) clearTimeout(presenceTimer);
  if (presenceHeartbeat) clearInterval(presenceHeartbeat);
  presenceTimer = null;
  presenceHeartbeat = null;
  pendingPresence = {};
  lastPresenceSentAt = 0;
}

function sendPresence(): void {
  if (presenceTimer) {
    clearTimeout(presenceTimer);
    presenceTimer = null;
  }
  const state = useHarnessStore.getState();
  if (!state.collabAvailable || !state.session.user) return;
  lastPresenceSentAt = Date.now();
  void fetch('/api/presence', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      harness: state.activeHarnessName,
      appView: state.appView,
      editingSurface: state.editingSurface,
      drillDownEnclosure: state.drillDownEnclosure,
      activeSubsystemId: state.activeSubsystemId,
      focus: null,
      editing: null,
      ...pendingPresence,
    }),
  }).then((response) => {
    if (response.status === 404) state.setCollabAvailable(false);
  }).catch(() => {
    // Presence is advisory and never blocks document editing or saving.
  });
}

function queuePresencePublish(partial: PresenceUpdate): void {
  pendingPresence = { ...pendingPresence, ...partial };
  const state = useHarnessStore.getState();
  if (!state.collabAvailable || !state.session.user) return;
  if (!presenceHeartbeat) {
    presenceHeartbeat = setInterval(
      () => queuePresencePublish({}),
      PRESENCE_HEARTBEAT_MS,
    );
  }
  const immediate = Object.hasOwn(partial, 'focus') || Object.hasOwn(partial, 'editing');
  if (presenceTimer) clearTimeout(presenceTimer);
  const delay = immediate
    ? PRESENCE_COALESCE_MS
    : Math.max(0, PRESENCE_HEARTBEAT_MS - (Date.now() - lastPresenceSentAt));
  presenceTimer = setTimeout(sendPresence, delay);
}

let peerIndexSource: Record<string, PeerPresence> | null = null;
let peerIndex = new Map<string, PeerPresence[]>();
const EMPTY_PEERS: PeerPresence[] = [];

function getPeerIndex(peers: Record<string, PeerPresence>): Map<string, PeerPresence[]> {
  if (peerIndexSource === peers) return peerIndex;
  const next = new Map<string, PeerPresence[]>();
  for (const peer of Object.values(peers)) {
    const targets = [peer.focus, peer.editing].filter(
      (target): target is NonNullable<typeof target> => target !== null,
    );
    const seen = new Set<string>();
    for (const target of targets) {
      const key = `${target.kind}:${target.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entries = next.get(key) ?? [];
      entries.push(peer);
      next.set(key, entries);
    }
  }
  peerIndexSource = peers;
  peerIndex = next;
  return peerIndex;
}

export function usePeersForEntity(
  kind: PresenceTargetKind,
  id: string,
): PeerPresence[] {
  return useHarnessStore((state) => getPeerIndex(state.peers).get(`${kind}:${id}`) ?? EMPTY_PEERS);
}

let undoStalenessInputs: readonly unknown[] = [];
let undoStalenessValue: UndoStaleness = {
  state: 'none',
  lastWriter: null,
  since: null,
};

function selectUndoStaleness(state: HarnessStore): UndoStaleness {
  const snapshot = state.undoStack.at(-1);
  const inputs = [
    snapshot,
    state.serverRev,
    state.lastWriter,
    state.lastWriterAt,
    state.session.user,
  ] as const;
  if (
    inputs.length === undoStalenessInputs.length
    && inputs.every((value, index) => value === undoStalenessInputs[index])
  ) return undoStalenessValue;
  undoStalenessInputs = inputs;
  if (!snapshot) {
    undoStalenessValue = { state: 'none', lastWriter: state.lastWriter, since: null };
  } else {
    const writtenBySomeoneElse =
      (
        state.serverRev > snapshot.before.serverRev
        || state.libraryRev > snapshot.before.libraryRev
      )
      && state.lastWriter?.id !== state.session.user?.id;
    undoStalenessValue = {
      state: writtenBySomeoneElse ? 'red' : 'green',
      lastWriter: state.lastWriter,
      since: writtenBySomeoneElse ? state.lastWriterAt : snapshot.capturedAt,
    };
  }
  return undoStalenessValue;
}

export function useUndoStaleness(): UndoStaleness {
  return useHarnessStore(selectUndoStaleness);
}

const FAST_AUTO_SAVE_DELAY = 300;
const SLOW_AUTO_SAVE_DELAY = 1_000;
const AUTO_SAVE_ERROR_MIN_VISIBLE_MS = 15_000;
type AutoSaveType =
  | 'harness'
  | 'layouts'
  | 'library'
  | 'manufacturing'
  | 'subsystem';
const ALL_AUTO_SAVE_TYPES = new Set<AutoSaveType>([
  'harness',
  'layouts',
  'library',
  'manufacturing',
  'subsystem',
]);
let fastAutoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let slowAutoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingFastSaveTypes = new Set<AutoSaveType>();
let pendingSlowSaveTypes = new Set<AutoSaveType>();
let autoSaveActive = false;
let activeAutoSave: Promise<boolean> | null = null;
let autoSaveErrorShownAt = 0;
let autoSaveErrorClearTimer: ReturnType<typeof setTimeout> | null = null;

interface SaveResponseBody {
  ok?: boolean;
  rev?: number;
  error?: string;
}

async function readSaveBody(response: Response): Promise<SaveResponseBody> {
  try {
    return await response.json() as SaveResponseBody;
  } catch {
    return {};
  }
}

function updateConfirmedRevision(body: SaveResponseBody): void {
  const state = useHarnessStore.getState();
  const writer = state.session.user
    ? { id: state.session.user.id, displayName: state.session.user.displayName }
    : state.lastWriter;
  useHarnessStore.setState({
    serverRev: typeof body.rev === 'number' ? Math.max(state.serverRev, body.rev) : state.serverRev,
    lastWriter: writer,
    lastWriterAt: writer ? Date.now() : state.lastWriterAt,
  });
}

function showAutoSaveFailure(message: string): void {
  autoSaveErrorShownAt = Date.now();
  if (autoSaveErrorClearTimer) {
    clearTimeout(autoSaveErrorClearTimer);
    autoSaveErrorClearTimer = null;
  }
  useHarnessStore.getState().setMutationError(message);
}

function scheduleAutoSaveFailureClear(message: string): void {
  if (autoSaveErrorClearTimer) clearTimeout(autoSaveErrorClearTimer);
  const clearIfResolved = () => {
    autoSaveErrorClearTimer = null;
    const state = useHarnessStore.getState();
    if (state.mutationError === message && !hasOutstandingChanges(state)) {
      state.setMutationError(null);
    }
  };
  const remaining = Math.max(
    0,
    AUTO_SAVE_ERROR_MIN_VISIBLE_MS - (Date.now() - autoSaveErrorShownAt),
  );
  if (remaining === 0) {
    clearIfResolved();
  } else {
    autoSaveErrorClearTimer = setTimeout(clearIfResolved, remaining);
  }
}

function reportSaveFailure(response: Response, body: SaveResponseBody): false {
  showAutoSaveFailure(
    `Autosave failed: ${body.error ?? `${response.status} ${response.statusText}`}`,
  );
  return false;
}

function normalizeConflict(
  body: SaveResponseBody,
  fallbackRev: number,
  fallbackWriter: RevisionWriter | null,
): RevisionConflictResponse {
  const candidate = body as Partial<RevisionConflictResponse>;
  return {
    error: candidate.error ?? 'conflict',
    currentRev: candidate.currentRev ?? fallbackRev,
    baseRev: candidate.baseRev ?? fallbackRev,
    lastWriter: candidate.lastWriter ?? fallbackWriter,
    changedEntityIds: candidate.changedEntityIds ?? [],
  };
}

function hasOutstandingChanges(state: HarnessStore): boolean {
  if (
    state.harness
    && state.serverHarness
    && !isHarnessDiffEmpty(diffHarness(state.serverHarness, state.harness))
  ) return true;
  if (
    state.connectorLibrary
    && state.serverConnectorLibrary
    && !isLibraryDiffEmpty(diffLibrary(state.serverConnectorLibrary, state.connectorLibrary))
  ) return true;
  if (!isLayoutPatchEmpty(diffLayouts(state.serverLayouts, getLayouts(state)))) return true;
  if (!isRecordDiffEmpty(diffRecord(
    state.serverManufacturing.bundles,
    state.manufacturing.bundles,
  ))) return true;
  return !isRecordDiffEmpty(diffRecord(state.serverSubsystems, state.subsystems));
}

async function performAutoSave(what: Set<AutoSaveType>): Promise<boolean> {
  let saved = true;
  try {
    let state = useHarnessStore.getState();
    if (!state.harness) return true;
    const nameParam = `?harness=${encodeURIComponent(state.activeHarnessName)}`;

    if (what.has('harness') && state.serverHarness) {
      const localDiff = diffHarness(state.serverHarness, state.harness);
      if (!isHarnessDiffEmpty(localDiff)) {
        if (state.conflict?.kind === 'harness' || state.conflict?.kind === 'rebase') return false;
        const snapshot = structuredClone(state.harness);
        const response = await fetch(`/api/save-harness${nameParam}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Base-Rev': String(state.serverRev),
          },
          body: JSON.stringify(snapshot, null, 2),
        });
        const body = await readSaveBody(response);
        if (response.status === 409) {
          useHarnessStore.setState({
            conflict: {
              kind: 'harness',
              server: normalizeConflict(body, state.serverRev, state.lastWriter),
              localDiffJson: JSON.stringify(localDiff, null, 2),
            },
          });
          saved = false;
        } else if (!response.ok) {
          saved = reportSaveFailure(response, body);
        } else {
          useHarnessStore.setState({ serverHarness: snapshot });
          updateConfirmedRevision(body);
        }
      }
    }

    state = useHarnessStore.getState();
    if (what.has('library') && state.connectorLibrary && state.serverConnectorLibrary) {
      const localDiff = diffLibrary(state.serverConnectorLibrary, state.connectorLibrary);
      if (!isLibraryDiffEmpty(localDiff)) {
        if (state.conflict?.kind === 'library' || state.conflict?.kind === 'rebase') return false;
        const snapshot = structuredClone(state.connectorLibrary);
        const response = await fetch('/api/save-library', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Base-Rev': String(state.libraryRev),
          },
          body: JSON.stringify(snapshot, null, 2),
        });
        const body = await readSaveBody(response);
        if (response.status === 409) {
          useHarnessStore.setState({
            conflict: {
              kind: 'library',
              server: normalizeConflict(body, state.libraryRev, state.lastWriter),
              localDiffJson: JSON.stringify(localDiff, null, 2),
            },
          });
          saved = false;
        } else if (!response.ok) {
          saved = reportSaveFailure(response, body);
        } else {
          useHarnessStore.setState({
            serverConnectorLibrary: snapshot,
            libraryRev: typeof body.rev === 'number'
              ? Math.max(state.libraryRev, body.rev)
              : state.libraryRev,
          });
        }
      }
    }

    state = useHarnessStore.getState();
    if (what.has('layouts')) {
      const snapshot = structuredClone(getLayouts(state));
      const localDiff = diffLayouts(state.serverLayouts, snapshot);
      if (!isLayoutPatchEmpty(localDiff)) {
        const response = await fetch(`/api/save-layouts${nameParam}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state.collabAvailable ? localDiff : snapshot, null, 2),
        });
        const body = await readSaveBody(response);
        if (!response.ok) {
          saved = reportSaveFailure(response, body);
        } else {
          useHarnessStore.setState({ serverLayouts: snapshot });
          updateConfirmedRevision(body);
        }
      }
    }

    state = useHarnessStore.getState();
    if (what.has('manufacturing')) {
      const snapshot = structuredClone(state.manufacturing);
      const localDiff = diffRecord(
        state.serverManufacturing.bundles,
        snapshot.bundles,
      );
      if (!isRecordDiffEmpty(localDiff)) {
        const response = await fetch(`/api/save-manufacturing${nameParam}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            state.collabAvailable
              ? { patch: localDiff.patch, removed: localDiff.removed }
              : snapshot,
            null,
            2,
          ),
        });
        const body = await readSaveBody(response);
        if (!response.ok) {
          saved = reportSaveFailure(response, body);
        } else {
          useHarnessStore.setState({ serverManufacturing: snapshot });
          updateConfirmedRevision(body);
        }
      }
    }

    state = useHarnessStore.getState();
    if (what.has('subsystem')) {
      const localDiff = diffRecord(state.serverSubsystems, state.subsystems);
      for (const [id, subsystem] of Object.entries(localDiff.patch)) {
        const savePayload = buildSubsystemSavePayload(state.serverSubsystems[id], subsystem);
        const response = await fetch(`/api/subsystems/${encodeURIComponent(id)}${nameParam}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(savePayload, null, 2),
        });
        const body = await readSaveBody(response);
        if (!response.ok) {
          saved = reportSaveFailure(response, body);
          continue;
        }
        useHarnessStore.setState((current) => ({
          serverSubsystems: {
            ...current.serverSubsystems,
            [id]: structuredClone(subsystem),
          },
        }));
        updateConfirmedRevision(body);
      }
      for (const id of localDiff.removed) {
        const response = await fetch(`/api/subsystems/${encodeURIComponent(id)}${nameParam}`, {
          method: 'DELETE',
        });
        const body = await readSaveBody(response);
        if (!response.ok) {
          saved = reportSaveFailure(response, body);
          continue;
        }
        useHarnessStore.setState((current) => {
          const serverSubsystems = { ...current.serverSubsystems };
          delete serverSubsystems[id];
          return { serverSubsystems };
        });
        updateConfirmedRevision(body);
      }
    }

    const current = useHarnessStore.getState();
    const dirty = hasOutstandingChanges(current);
    useHarnessStore.setState({ isDirty: dirty });
    if (saved && !dirty && current.mutationError?.startsWith('Autosave failed:')) {
      scheduleAutoSaveFailureClear(current.mutationError);
    }
    return saved;
  } catch (error) {
    showAutoSaveFailure(
      `Autosave failed: ${error instanceof Error ? error.message : 'API unavailable'}`,
    );
    return false;
  }
}

function startAutoSave(what: Set<AutoSaveType>): Promise<boolean> {
  const previous = activeAutoSave;
  const save = (previous ?? Promise.resolve(true))
    .catch(() => false)
    .then(() => performAutoSave(what));
  activeAutoSave = save;
  void save.finally(() => {
    if (activeAutoSave === save) activeAutoSave = null;
  });
  return save;
}

function scheduleAutoSave(types: Set<AutoSaveType>, delay: number): void {
  const fast = delay === FAST_AUTO_SAVE_DELAY;
  const pending = fast ? pendingFastSaveTypes : pendingSlowSaveTypes;
  for (const type of types) pending.add(type);
  const currentTimer = fast ? fastAutoSaveTimer : slowAutoSaveTimer;
  if (currentTimer) clearTimeout(currentTimer);
  const timer = setTimeout(() => {
    const toSave = new Set(fast ? pendingFastSaveTypes : pendingSlowSaveTypes);
    if (fast) {
      fastAutoSaveTimer = null;
      pendingFastSaveTypes = new Set();
    } else {
      slowAutoSaveTimer = null;
      pendingSlowSaveTypes = new Set();
    }
    void startAutoSave(toSave);
  }, delay);
  if (fast) fastAutoSaveTimer = timer;
  else slowAutoSaveTimer = timer;
}

export async function flushAutoSave(): Promise<boolean> {
  if (fastAutoSaveTimer) clearTimeout(fastAutoSaveTimer);
  if (slowAutoSaveTimer) clearTimeout(slowAutoSaveTimer);
  fastAutoSaveTimer = null;
  slowAutoSaveTimer = null;
  pendingFastSaveTypes = new Set();
  pendingSlowSaveTypes = new Set();

  if (activeAutoSave && !(await activeAutoSave)) return false;
  while (hasOutstandingChanges(useHarnessStore.getState())) {
    if (!(await startAutoSave(new Set(ALL_AUTO_SAVE_TYPES)))) return false;
  }
  return true;
}

export function initAutoSave(): void {
  if (autoSaveActive) return;
  autoSaveActive = true;

  useHarnessStore.subscribe((state, prev) => {
    const fast = new Set<AutoSaveType>();
    const slow = new Set<AutoSaveType>();
    if (state.harness !== prev.harness) fast.add('harness');
    if (state.connectorLibrary !== prev.connectorLibrary) fast.add('library');
    if (
      state.nodeLayouts !== prev.nodeLayouts
      || state.portLayouts !== prev.portLayouts
      || state.sizeLayouts !== prev.sizeLayouts
      || state.freePortLayouts !== prev.freePortLayouts
      || state.backgroundLayouts !== prev.backgroundLayouts
      || state.connectorTypeSizes !== prev.connectorTypeSizes
      || state.textBoxLayouts !== prev.textBoxLayouts
      || state.waypointLayouts !== prev.waypointLayouts
      || state.junctionLayouts !== prev.junctionLayouts
      || state.mergePointLayouts !== prev.mergePointLayouts
      || state.rotationLayouts !== prev.rotationLayouts
    ) slow.add('layouts');
    if (state.manufacturing !== prev.manufacturing) slow.add('manufacturing');
    if (state.subsystems !== prev.subsystems) slow.add('subsystem');

    if (fast.size > 0) scheduleAutoSave(fast, FAST_AUTO_SAVE_DELAY);
    if (slow.size > 0) scheduleAutoSave(slow, SLOW_AUTO_SAVE_DELAY);

    if (
      state.selectedItem !== prev.selectedItem
      || state.selectedTextBoxId !== prev.selectedTextBoxId
      || state.selectedBundle !== prev.selectedBundle
    ) {
      const focus = state.selectedItem
        ? { kind: state.selectedItem.type, id: state.selectedItem.id }
        : state.selectedTextBoxId
          ? { kind: 'textBox' as const, id: state.selectedTextBoxId }
          : state.selectedBundle?.id
            ? { kind: 'bundle' as const, id: state.selectedBundle.id }
            : state.selectedBundle?.pathIds[0]
              ? { kind: 'path' as const, id: state.selectedBundle.pathIds[0] }
            : null;
      queuePresencePublish({ focus });
    }
    if (
      state.appView !== prev.appView
      || state.editingSurface !== prev.editingSurface
      || state.drillDownEnclosure !== prev.drillDownEnclosure
      || state.activeSubsystemId !== prev.activeSubsystemId
    ) {
      queuePresencePublish({
        appView: state.appView,
        editingSurface: state.editingSurface,
        drillDownEnclosure: state.drillDownEnclosure,
        activeSubsystemId: state.activeSubsystemId,
      });
    }
  });
}
