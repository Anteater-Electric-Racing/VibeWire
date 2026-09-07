import { create, type StateCreator } from 'zustand';
import type {
  AppView,
  BackgroundLayouts,
  CanvasImageLayout,
  CanvasImageLayouts,
  Connector,
  ConnectorLibrary,
  ConnectorTypeSizes,
  HierarchyEntity,
  FreePortLayouts,
  SystemData,
  SharedAnchorLayouts,
  ManufacturingDocument,
  ManufacturingStep,
  ManufacturingTaskUpdate,
  BranchPoint,
  BranchPointLayouts,
  NodeLayout,
  Path,
  PortLayouts,
  RotationLayouts,
  RouteStyleLayouts,
  SelectedHarnessBundle,
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
  ViewRouteStyleLayouts,
  WaypointItem,
  WaypointLayouts,
  WireRouteStyle,
} from '../types';
import {
  applyManufacturingTaskUpdates,
  applySpanTotalLength,
  assignManufacturingEndpointGender,
  deriveManufacturingBundles,
  EMPTY_MANUFACTURING_DOCUMENT,
  MANUFACTURING_STEPS,
} from '../lib/manufacturing';
import {
  getLastManufacturingBundleId,
  setLastManufacturingBundleId,
} from '../lib/userPrefs';
import {
  applyConnectorPinCount,
  deriveHarnessBundles,
  findPathWireForHarnessBundle,
  GENERIC_MULTIPIN_TYPE_ID,
  getHarnessBundleWires,
  getConnectorPairSegments,
  getConnectorOccupancy,
  getConnectorSupportedKeyings,
  getConnectorTypeCavityFloor,
  getEntityRevealContext,
  getEffectivePinCount,
  getNextConnectorPinCount,
  getPathNodeHarnessBundleKey,
  getPathSegmentMeasurement,
  getPathsTouchingConnector,
  getPreviousConnectorPinCount,
  getVisibleWires,
  isBulkheadConnector,
  isConnectorFamily,
  isInlineConnector,
  nextBranchPointId,
  nextBranchPointName,
  normalizeConnectorKeying,
  parseHarnessBundleId,
  getBaseHarnessBundleId,
  getHarnessBundleLayoutId,
  getHarnessBundleLayoutValue,
  canMergePassThroughConnectors,
  canFuseBranchPoints,
  dissolveInlineConnector,
  dissolveBranchPoint,
  mergeConnectors,
  fuseBranchPoints as fuseBranchPointsInSystem,
  moveHierarchyEntity as relocateHierarchyEntity,
  removePathNodeAt,
  renumberConnectorPins,
  insertConnectorOnPath,
  separateBranchPointOccurrences,
  type BulkheadWireSide,
  type HierarchyEntityKind,
} from '../lib/systemTopology';
import {
  applyBundleJoin,
  branchPointToSharedAnchorBlockReason as demoteBlockReason,
  createVisualSharedAnchor,
  demoteBranchPointToSharedAnchor,
  linkVisualOrBranchAnchor,
  promoteSharedAnchorToBranchPoint,
  type SharedAnchorDocument,
} from '../lib/sharedAnchorJoin';
import {
  getConnectorTablePinCount,
  resolveConnectorRenderedSize,
} from '../lib/connectorSize';
import {
  BULKHEAD_DISPLAY_PROPERTY,
  BULKHEAD_DOT_DISPLAY,
  ensureEnclosureBulkheadPlaceholders,
  isAutoBulkheadPlaceholder,
  splitBulkheadDotPath as splitBulkheadDotPathInSystem,
} from '../lib/bulkheadRouting';
import {
  resolveParentResizeWithConnectorShove,
  type GraphNodeSize,
  type GraphRect,
  type ParentResizeConnector,
} from '../lib/parentResize';
import {
  normalizeDisplayName,
  renameSystemEntity,
  renameSubsystem as renameSubsystemDocument,
  renameSystem as renameSystemDocument,
} from '../lib/rename';
import {
  applySystemPhysicalLayout,
  connectorLayoutFromSystem,
  enclosureLayoutFromSystem,
  ensureSubsystemAncestorFrames,
  normalizeSubsystemFrameInteriors,
  type SystemLayoutSource,
} from '../lib/subsystem';
import {
  canvasImageContextKey,
  imageMatchesContext,
  migrateCanvasImages,
  nextImageName,
  viewFromImageContextKey,
} from '../lib/canvasImages';
import {
  edgeBelongsToRouteView,
  normalizeRouteStyleMap,
  routeViewKey,
} from '../lib/routeStyle';
import {
  applySystemDiff,
  applyLibraryDiff,
  applyLayoutPatch,
  applyRecordDiff,
  changedSystemEntityIds,
  deepEqual,
  diffSystem,
  diffLayouts,
  diffLibrary,
  diffRecord,
  emptyLayouts,
  isSystemDiffEmpty,
  isLayoutPatchEmpty,
  isLibraryDiffEmpty,
  isRecordDiffEmpty,
  mergeRemoteLayouts,
  mergeRemoteRecord,
  normalizeLayouts,
  rebaseSystem,
  rebaseLibrary,
} from '../lib/sync/diff';
import { normalizeCollaborationDocument, normalizeSystemData } from '../lib/systemNormalize';
import { indexPeersByEntity } from '../lib/collaborationPresence';
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
  system: SystemData | null;
  connectorLibrary: ConnectorLibrary | null;
  manufacturing: ManufacturingDocument;
  nodeLayouts: NodeLayout;
  portLayouts: PortLayouts;
  sizeLayouts: SizeLayouts;
  freePortLayouts: FreePortLayouts;
  imageLayouts: CanvasImageLayouts;
  connectorTypeSizes: ConnectorTypeSizes;
  textBoxLayouts: TextBoxLayouts;
  waypointLayouts: WaypointLayouts;
  sharedAnchors: SharedAnchorLayouts;
  branchPointLayouts: BranchPointLayouts;
  rotationLayouts: RotationLayouts;
  routeStyleLayouts: RouteStyleLayouts;
  viewRouteStyleLayouts: ViewRouteStyleLayouts;
  subsystems: Record<string, SubsystemDocument>;
  selectedItem: SelectedItem | null;
  selectedHarnessBundle: SelectedHarnessBundle | null;
  selectedTextBoxId: string | null;
  selectedImageId: string | null;
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
  branchPointIds: string[];
  pathIds: string[];
  signalIds: string[];
}

export interface EnclosureKindConvertImpact {
  fromEnclosure: boolean;
  nestedDeviceIds: string[];
  nestedEnclosureIds: string[];
  connectorIds: string[];
  branchPointIds: string[];
  pathIds: string[];
}

interface InlineBundleSplitLayout {
  before: WaypointItem[];
  after: WaypointItem[];
}

const MAX_HISTORY = 60;

export interface SystemStore {
  system: SystemData | null;
  serverSystem: SystemData | null;
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
  activeSystemName: string;
  availableSystems: Array<{ id: string; name: string }>;
  selectedItem: SelectedItem | null;
  nodeLayouts: NodeLayout;
  isDirty: boolean;
  expandedNodes: Set<string>;
  /** Session-only sizes while a connector table is expanded; cleared on collapse. */
  expandedSizeOverrides: SizeLayouts;
  settingsOpen: boolean;
  openEnclosureId: string | null;
  portLayouts: PortLayouts;
  sizeLayouts: SizeLayouts;
  freePortLayouts: FreePortLayouts;
  imageLayouts: CanvasImageLayouts;
  connectorTypeSizes: ConnectorTypeSizes;
  textBoxLayouts: TextBoxLayouts;
  selectedTextBoxId: string | null;
  selectedImageId: string | null;
  selectedHarnessBundle: SelectedHarnessBundle | null;
  /** Hide the inspector while keeping the current selection (e.g. while editing waypoints). */
  inspectorDismissed: boolean;
  revealRequest: { item: SelectedItem; requestId: number } | null;
  revealRequestSequence: number;
  waypointLayouts: WaypointLayouts;
  sharedAnchors: SharedAnchorLayouts;
  branchPointLayouts: BranchPointLayouts;
  rotationLayouts: RotationLayouts;
  routeStyleLayouts: RouteStyleLayouts;
  viewRouteStyleLayouts: ViewRouteStyleLayouts;
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

  setActiveSystemName: (name: string) => Promise<boolean>;
  setAvailableSystems: (systems: Array<{ id: string; name: string }>) => void;
  renameSystem: (name: string) => void;
  openConnectorLibrary: (typeId?: string | null) => void;
  openSignalLibrary: (signalId?: string | null) => void;
  setConnectorLibraryTarget: (typeId: string | null) => void;
  setSignalLibraryTarget: (signalId: string | null) => void;
  openManufacturing: (bundleId?: string | null) => void;
  /** Remember the manufacturing system selection for this user without changing app view. */
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
  /** Rewrite the active subsystem canvas from the current system physical layout. */
  resetActiveSubsystemLayoutFromSystem: () => void;
  removeEntityFromActiveSubsystem: (type: 'enclosure' | 'connector', id: string) => void;
  renumberConnectorCavities: (connectorId: string, orderedOldPinNumbers: number[]) => void;
  /**
   * Absorb `sourceId` into `targetId` (same-parent inline connectors or bulkheads).
   * Prefers keeping non-generated hardware. Returns the surviving connector id,
   * or null on failure.
   */
  mergeBulkheadConnectors: (sourceId: string, targetId: string) => string | null;
  /** Move one wire from a merged bulkhead dot onto a new sibling dot. */
  splitBulkheadDotPath: (connectorId: string, pathId: string) => string | null;
  /**
   * Undo a branch-point fuse: move the given node occurrences off `branchPointId`
   * onto a brand-new branch point, leaving every other connection through the
   * original untouched. Returns the new branch point's id, or null on failure.
   */
  separateBranchPointFamily: (
    branchPointId: string,
    occurrences: Array<{ pathId: string; nodeIndex: number }>,
    dropPosition?: { x: number; y: number },
  ) => string | null;
  /** Fuse two same-parent branch points into one. Returns the surviving id, or null on failure. */
  fuseBranchPoints: (sourceId: string, targetId: string) => string | null;
  getDeleteImpact: (type: 'enclosure' | 'connector' | 'branchPoint' | 'path' | 'signal', id: string) => DeleteImpact;
  deleteEntityCascade: (type: 'enclosure' | 'connector' | 'branchPoint' | 'path' | 'signal', id: string) => void;
  getEnclosureKindConvertImpact: (id: string) => EnclosureKindConvertImpact | null;
  /** Flip enclosure ↔ device. Nested contents are deleted when becoming a device. */
  convertEnclosureKind: (id: string) => boolean;
  deletePathHarnessBundle: (bundleId: string, pathIds: string[]) => void;
  addSignal: (input: Pick<Signal, 'name' | 'tags' | 'properties'>) => string | null;
  addSignalPropertyDefinition: (
    input: Pick<SignalPropertyDefinition, 'name' | 'options'>,
  ) => string | null;
  updateSignalPropertyDefinition: (
    id: string,
    patch: Partial<Pick<SignalPropertyDefinition, 'name' | 'options'>>,
  ) => void;
  deleteSignalPropertyDefinition: (id: string) => void;
  addEnclosure: (input: Pick<HierarchyEntity, 'name' | 'parent' | 'kind'>) => string | null;
  addConnector: (parentId: string) => string | null;
  addInlineConnector: (input: {
    parent: string | null;
    position: { x: number; y: number };
    bundle?: SelectedHarnessBundle;
    bundleLayout?: InlineBundleSplitLayout;
  }) => string | null;
  insertInlineConnectorOnBundle: (
    connectorId: string,
    bundle: SelectedHarnessBundle,
    position: { x: number; y: number },
    bundleLayout?: InlineBundleSplitLayout,
  ) => boolean;
  /**
   * Reparent and/or reorder an enclosure, connector, or branch point in the
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
    sameSideBundleIds?: string[],
  ) => void;
  addConnectorCavity: (connectorId: string) => void;
  removeConnectorCavity: (connectorId: string) => void;
  renameEntity: (type: 'enclosure' | 'connector' | 'branchPoint' | 'path' | 'signal', id: string, name: string) => void;
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
      wireIndex: number;
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
  updateHarnessBundleWireLengths: (
    bundleId: string,
    pathIds: string[],
    lengthMm: number | undefined,
  ) => void;
  setMutationError: (message: string | null) => void;
  resetForSystemSwitch: () => void;
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

  loadSystem: (data: SystemData) => void;
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
  loadImageLayouts: (images: CanvasImageLayouts, backgrounds?: BackgroundLayouts) => void;
  loadTextBoxLayouts: (tbs: TextBoxLayouts) => void;
  loadWaypointLayouts: (wps: WaypointLayouts) => void;
  loadSharedAnchorLayouts: (sharedAnchors: SharedAnchorLayouts) => void;
  loadBranchPointLayouts: (layouts: BranchPointLayouts) => void;
  loadRotationLayouts: (rotations: RotationLayouts) => void;
  loadRouteStyleLayouts: (styles: RouteStyleLayouts) => void;
  loadViewRouteStyleLayouts: (styles: ViewRouteStyleLayouts) => void;
  rotateConnector: (connectorId: string) => void;
  rotateEnclosure: (enclosureId: string) => void;

  addImage: (x: number, y: number, filename: string, options?: { w?: number; h?: number }) => void;
  updateImage: (id: string, patch: Partial<Omit<CanvasImageLayout, 'id'>>) => void;
  removeImage: (id: string) => void;
  selectImage: (id: string | null) => void;

  addTextBox: (x: number, y: number, options?: { parentId?: string; w?: number; h?: number }) => void;
  updateTextBox: (id: string, patch: Partial<Omit<TextBoxLayout, 'id'>>) => void;
  removeTextBox: (id: string) => void;
  selectTextBox: (id: string | null) => void;

  selectItem: (item: SelectedItem | null) => void;
  revealItem: (item: SelectedItem) => void;
  setNodeExpanded: (nodeId: string, expanded: boolean) => void;
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
  updateBranchPointLayout: (contextKey: string, branchPointId: string, x: number, y: number) => void;

  setOpenEnclosure: (encId: string | null) => void;
  setSelectedHarnessBundle: (bundle: SelectedHarnessBundle | null) => void;
  dismissInspector: () => void;

  setEdgeWaypoints: (edgeId: string, waypoints: WaypointItem[]) => void;
  /** Remove the selected bend/waypoint. Returns true if a point was deleted. */
  deleteSelectedRoutePoint: () => boolean;
  setEdgeRouteStyle: (edgeId: string, style: WireRouteStyle) => void;
  applyViewRouteStyle: (style: WireRouteStyle, extraEdgeIds?: string[]) => void;
  createSharedAnchor: (
    pos: { x: number; y: number },
    edgeId: string,
    waypointIndex: number,
    options?: { mode?: 'visual' | 'branch' },
  ) => string;
  joinBundlesAtDrop: (request: {
    sourceEdgeId: string;
    sourceWaypointIndex: number;
    targetEdgeId: string;
    insertAfterIndex: number;
    position: { x: number; y: number };
    kind: 'shared-anchor' | 'branch-point';
  }) => string | null;
  convertSharedAnchorToBranchPoint: (sharedAnchorId: string) => string | null;
  convertBranchPointToSharedAnchor: (branchPointId: string) => string | null;
  branchPointToSharedAnchorBlockReason: (branchPointId: string) => string | null;
  moveSharedAnchor: (sharedAnchorId: string, pos: { x: number; y: number }) => void;
  deleteSharedAnchor: (sharedAnchorId: string) => void;
  linkEdgeToSharedAnchor: (sharedAnchorId: string, edgeId: string, insertAfterIndex: number, pos: { x: number; y: number }) => void;
  unlinkEdgeFromSharedAnchor: (sharedAnchorId: string, edgeId: string) => void;

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
  setConnectorDotDisplay: (conId: string, dot: boolean) => void;

  addTag: (entityType: string, entityId: string, tag: string) => void;
  removeTag: (entityType: string, entityId: string, tag: string) => void;

  setSettingsOpen: (open: boolean) => void;

  getAllExistingTags: () => string[];
  findEntity: (type: string, id: string) => HierarchyEntity | Connector | BranchPoint | Path | Signal | undefined;
}

function normalizeSystemDocument(data: unknown): SystemData {
  return ensureEnclosureBulkheadPlaceholders(normalizeSystemData(data)).system;
}

function nextConnectorId(system: SystemData): string {
  const existingIds = new Set([
    ...system.hierarchy.map((item) => item.id),
    ...system.connectors.map((item) => item.id),
    ...system.branchPoints.map((item) => item.id),
    ...system.paths.map((item) => item.id),
    ...system.signals.map((item) => item.id),
  ]);
  let index = system.connectors.length + 1;
  let connectorId = `con_${String(index).padStart(3, '0')}`;
  while (existingIds.has(connectorId)) {
    index += 1;
    connectorId = `con_${String(index).padStart(3, '0')}`;
  }
  return connectorId;
}

function nextInlineConnectorName(system: SystemData, parent: string | null): string {
  const siblingNames = new Set(
    system.connectors
      .filter((connector) => connector.parent === parent)
      .map((connector) => connector.name),
  );
  const baseName = 'New Inline Connector';
  if (!siblingNames.has(baseName)) return baseName;
  let suffix = 2;
  while (siblingNames.has(`${baseName} ${suffix}`)) suffix += 1;
  return `${baseName} ${suffix}`;
}

function insertInlineConnectorIntoSystem(
  source: SystemData,
  connectorId: string,
  bundle: SelectedHarnessBundle,
  connectorLibrary: ConnectorLibrary | null,
): { system?: SystemData; error?: string } {
  if (!parseHarnessBundleId(bundle.id)) {
    return { error: 'This projected Harness Bundle cannot accept an inline connector.' };
  }
  const segments = getHarnessBundleWires(source, bundle.id, bundle.pathIds)
    .sort(
      (left, right) =>
        left.path.id.localeCompare(right.path.id, undefined, { numeric: true })
        || left.wireIndex - right.wireIndex,
    );
  if (segments.length === 0) {
    return { error: 'The selected Harness Bundle no longer contains any insertable wires.' };
  }

  const system = structuredClone(source);
  const connector = system.connectors.find((candidate) => candidate.id === connectorId);
  if (!connector || !isInlineConnector(system, connector)) {
    return { error: 'Only a free-hanging inline connector can be inserted into a Harness Bundle.' };
  }
  if (getConnectorOccupancy(system, connector.id).length > 0) {
    return { error: 'This inline connector is already populated.' };
  }
  if (segments.some((segment) =>
    segment.path.nodes.some(
      (node) => node.kind === 'connector' && node.connector_id === connector.id,
    )
  )) {
    return { error: 'The selected Harness Bundle already passes through this connector.' };
  }

  const connectorType = connectorLibrary?.connector_types.find(
    (candidate) => candidate.id === connector.connector_type,
  );
  applyConnectorPinCount(connector, connectorType, segments.length);
  normalizeConnectorKeying(connector, connectorType);
  if (getEffectivePinCount(connector, connectorType) < segments.length) {
    return {
      error: `${connector.name} cannot fit this ${segments.length}-wire Harness Bundle. Choose a larger connector type.`,
    };
  }

  const pinByPathId = new Map(
    segments.map((segment, index) => [segment.path.id, index + 1]),
  );
  let changedCount = 0;
  system.paths = system.paths.map((path) => {
    const pinNumber = pinByPathId.get(path.id);
    if (pinNumber === undefined) return path;
    const next = insertConnectorOnPath(
      path,
      bundle.id,
      connector.id,
      pinNumber,
    );
    if (next !== path) changedCount += 1;
    return next;
  });
  if (changedCount !== segments.length) {
    return { error: 'The Harness Bundle changed before every wire could be populated.' };
  }
  return { system };
}

function removeBundlePresentation(
  waypointLayouts: WaypointLayouts,
  sharedAnchors: SharedAnchorLayouts,
  edgeIds: ReadonlySet<string>,
): { waypointLayouts: WaypointLayouts; sharedAnchors: SharedAnchorLayouts } {
  if (edgeIds.size === 0) return { waypointLayouts, sharedAnchors };
  const nextWaypoints = { ...waypointLayouts };
  for (const edgeId of edgeIds) delete nextWaypoints[edgeId];
  const nextSharedAnchors = structuredClone(sharedAnchors);
  for (const [sharedAnchorId, sharedAnchor] of Object.entries(nextSharedAnchors)) {
    sharedAnchor.memberEdgeIds = sharedAnchor.memberEdgeIds.filter((edgeId) => !edgeIds.has(edgeId));
    if (sharedAnchor.memberEdgeIds.length === 0) delete nextSharedAnchors[sharedAnchorId];
  }
  return { waypointLayouts: nextWaypoints, sharedAnchors: nextSharedAnchors };
}

function bundleIdForRefs(left: string, right: string): string {
  return left < right
    ? `bundle:${left}|${right}`
    : `bundle:${right}|${left}`;
}

function replaceBundlePresentationForInline(
  waypointLayouts: WaypointLayouts,
  sharedAnchors: SharedAnchorLayouts,
  routeStyleLayouts: RouteStyleLayouts,
  oldEdgeId: string,
  connectorId: string,
  split: InlineBundleSplitLayout | undefined,
): {
  waypointLayouts: WaypointLayouts;
  sharedAnchors: SharedAnchorLayouts;
  routeStyleLayouts: RouteStyleLayouts;
} {
  const parsed = parseHarnessBundleId(oldEdgeId);
  if (!parsed || !split) {
    const nextStyles = { ...routeStyleLayouts };
    delete nextStyles[oldEdgeId];
    return {
      ...removeBundlePresentation(
        waypointLayouts,
        sharedAnchors,
        new Set([oldEdgeId]),
      ),
      routeStyleLayouts: nextStyles,
    };
  }

  const connectorRef = `connector:${connectorId}`;
  const beforeId = bundleIdForRefs(parsed.sourceRefKey, connectorRef);
  const afterId = bundleIdForRefs(connectorRef, parsed.targetRefKey);
  const before = parsed.sourceRefKey < connectorRef
    ? [...split.before]
    : [...split.before].reverse();
  const after = connectorRef < parsed.targetRefKey
    ? [...split.after]
    : [...split.after].reverse();
  const nextWaypoints = { ...waypointLayouts };
  delete nextWaypoints[oldEdgeId];
  if (before.length > 0) nextWaypoints[beforeId] = before;
  if (after.length > 0) nextWaypoints[afterId] = after;

  const sharedAnchorIdsFor = (waypoints: WaypointItem[]) => new Set(
    waypoints.flatMap((waypoint) => (
      'sharedAnchorId' in waypoint ? [waypoint.sharedAnchorId] : []
    )),
  );
  const beforeSharedAnchorIds = sharedAnchorIdsFor(before);
  const afterSharedAnchorIds = sharedAnchorIdsFor(after);
  const nextSharedAnchors = structuredClone(sharedAnchors);
  for (const [sharedAnchorId, sharedAnchor] of Object.entries(nextSharedAnchors)) {
    if (!sharedAnchor.memberEdgeIds.includes(oldEdgeId)) continue;
    const members = sharedAnchor.memberEdgeIds.filter((edgeId) => edgeId !== oldEdgeId);
    if (beforeSharedAnchorIds.has(sharedAnchorId)) members.push(beforeId);
    if (afterSharedAnchorIds.has(sharedAnchorId)) members.push(afterId);
    sharedAnchor.memberEdgeIds = [...new Set(members)];
    if (sharedAnchor.memberEdgeIds.length === 0) delete nextSharedAnchors[sharedAnchorId];
  }

  const nextStyles = { ...routeStyleLayouts };
  const inherited = nextStyles[oldEdgeId];
  delete nextStyles[oldEdgeId];
  if (inherited) {
    nextStyles[beforeId] = inherited;
    nextStyles[afterId] = inherited;
  }
  return {
    waypointLayouts: nextWaypoints,
    sharedAnchors: nextSharedAnchors,
    routeStyleLayouts: nextStyles,
  };
}

function rejoinBundlePresentationAfterInline(
  waypointLayouts: WaypointLayouts,
  sharedAnchors: SharedAnchorLayouts,
  routeStyleLayouts: RouteStyleLayouts,
  system: SystemData,
  connectorId: string,
): {
  waypointLayouts: WaypointLayouts;
  sharedAnchors: SharedAnchorLayouts;
  routeStyleLayouts: RouteStyleLayouts;
} {
  const connectorRef = `connector:${connectorId}`;
  const pairs = new Map<string, { left: string; right: string }>();
  for (const path of system.paths) {
    path.nodes.forEach((node, index) => {
      if (
        node.kind !== 'connector'
        || node.connector_id !== connectorId
        || index === 0
        || index === path.nodes.length - 1
      ) {
        return;
      }
      const left = getPathNodeHarnessBundleKey(path.nodes[index - 1]);
      const right = getPathNodeHarnessBundleKey(path.nodes[index + 1]);
      const key = [left, right].sort().join('|');
      pairs.set(key, { left, right });
    });
  }
  if (pairs.size === 0) {
    return { waypointLayouts, sharedAnchors, routeStyleLayouts };
  }

  const nextWaypoints = { ...waypointLayouts };
  const nextSharedAnchors = structuredClone(sharedAnchors);
  const nextStyles = { ...routeStyleLayouts };
  const oriented = (edgeId: string, from: string): WaypointItem[] => {
    const parsed = parseHarnessBundleId(edgeId);
    const waypoints = nextWaypoints[edgeId] ?? [];
    return parsed?.sourceRefKey === from ? [...waypoints] : [...waypoints].reverse();
  };

  for (const { left, right } of pairs.values()) {
    const leftEdgeId = bundleIdForRefs(left, connectorRef);
    const rightEdgeId = bundleIdForRefs(connectorRef, right);
    const joinedEdgeId = bundleIdForRefs(left, right);
    const joinedInPathOrder = [
      ...oriented(leftEdgeId, left),
      ...oriented(rightEdgeId, connectorRef),
    ];
    const joined = left < right
      ? joinedInPathOrder
      : [...joinedInPathOrder].reverse();
    delete nextWaypoints[leftEdgeId];
    delete nextWaypoints[rightEdgeId];
    if (joined.length > 0) nextWaypoints[joinedEdgeId] = joined;

    const joinedSharedAnchorIds = new Set(
      joined.flatMap((waypoint) => (
        'sharedAnchorId' in waypoint ? [waypoint.sharedAnchorId] : []
      )),
    );
    for (const [sharedAnchorId, sharedAnchor] of Object.entries(nextSharedAnchors)) {
      const touched =
        sharedAnchor.memberEdgeIds.includes(leftEdgeId)
        || sharedAnchor.memberEdgeIds.includes(rightEdgeId);
      if (!touched) continue;
      const members = sharedAnchor.memberEdgeIds.filter(
        (edgeId) => edgeId !== leftEdgeId && edgeId !== rightEdgeId,
      );
      if (joinedSharedAnchorIds.has(sharedAnchorId)) members.push(joinedEdgeId);
      sharedAnchor.memberEdgeIds = [...new Set(members)];
      if (sharedAnchor.memberEdgeIds.length === 0) delete nextSharedAnchors[sharedAnchorId];
    }

    const leftStyle = nextStyles[leftEdgeId];
    const rightStyle = nextStyles[rightEdgeId];
    delete nextStyles[leftEdgeId];
    delete nextStyles[rightEdgeId];
    const joinedStyle = leftStyle === 'grid' || rightStyle === 'grid'
      ? 'grid'
      : (leftStyle ?? rightStyle);
    if (joinedStyle) nextStyles[joinedEdgeId] = joinedStyle;
  }
  return {
    waypointLayouts: nextWaypoints,
    sharedAnchors: nextSharedAnchors,
    routeStyleLayouts: nextStyles,
  };
}

function pruneReplacedManufacturingBundles(
  document: ManufacturingDocument,
  before: SystemData,
  after: SystemData,
  connectorLibrary: ConnectorLibrary | null,
  affectedPathIds: Iterable<string>,
): ManufacturingDocument {
  const affected = new Set(affectedPathIds);
  if (affected.size === 0) return document;
  const replacedIds = new Set(
    deriveManufacturingBundles(before, connectorLibrary, document)
      .filter((bundle) => bundle.wires.some((wire) => affected.has(wire.pathId)))
      .map((bundle) => bundle.id),
  );
  const validAfterIds = new Set(
    deriveManufacturingBundles(after, connectorLibrary, document)
      .map((bundle) => bundle.id),
  );
  const removedIds = [...replacedIds].filter((bundleId) => !validAfterIds.has(bundleId));
  if (removedIds.length === 0) return document;
  const bundles = { ...document.bundles };
  for (const bundleId of removedIds) delete bundles[bundleId];
  return { ...document, bundles };
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

function makeSnapshot(state: SystemStore): UndoSnapshot {
  return {
    system: state.system,
    connectorLibrary: state.connectorLibrary,
    manufacturing: state.manufacturing,
    nodeLayouts: state.nodeLayouts,
    portLayouts: state.portLayouts,
    sizeLayouts: state.sizeLayouts,
    freePortLayouts: state.freePortLayouts,
    imageLayouts: state.imageLayouts,
    connectorTypeSizes: state.connectorTypeSizes,
    textBoxLayouts: state.textBoxLayouts,
    waypointLayouts: state.waypointLayouts,
    sharedAnchors: state.sharedAnchors,
    branchPointLayouts: state.branchPointLayouts,
    rotationLayouts: state.rotationLayouts,
    routeStyleLayouts: state.routeStyleLayouts,
    viewRouteStyleLayouts: state.viewRouteStyleLayouts,
    subsystems: state.subsystems,
    selectedItem: state.selectedItem,
    selectedHarnessBundle: state.selectedHarnessBundle,
    selectedTextBoxId: state.selectedTextBoxId,
    selectedImageId: state.selectedImageId,
    serverRev: state.serverRev,
    libraryRev: state.libraryRev,
    capturedAt: Date.now(),
  };
}

function applyNullableSystemDelta(
  current: SystemData | null,
  from: SystemData | null,
  to: SystemData | null,
): SystemData | null {
  if (from && to && current) {
    const diff = diffSystem(from, to);
    return isSystemDiffEmpty(diff) ? current : applySystemDiff(current, diff);
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

function layoutsFromSnapshot(s: {
  nodeLayouts: NodeLayout;
  portLayouts: PortLayouts;
  sizeLayouts: SizeLayouts;
  freePortLayouts: FreePortLayouts;
  imageLayouts: CanvasImageLayouts;
  connectorTypeSizes: ConnectorTypeSizes;
  textBoxLayouts: TextBoxLayouts;
  waypointLayouts: WaypointLayouts;
  sharedAnchors: SharedAnchorLayouts;
  branchPointLayouts: BranchPointLayouts;
  rotationLayouts: RotationLayouts;
  routeStyleLayouts: RouteStyleLayouts;
  viewRouteStyleLayouts: ViewRouteStyleLayouts;
}): CollaborationLayouts {
  return {
    nodes: s.nodeLayouts,
    ports: s.portLayouts,
    sizes: s.sizeLayouts,
    free: s.freePortLayouts,
    backgrounds: {},
    images: s.imageLayouts,
    connectorTypeSizes: s.connectorTypeSizes,
    textBoxes: s.textBoxLayouts,
    waypoints: s.waypointLayouts,
    sharedAnchors: s.sharedAnchors,
    branchPoints: s.branchPointLayouts,
    rotations: s.rotationLayouts,
    routeStyles: s.routeStyleLayouts,
    viewRouteStyles: s.viewRouteStyleLayouts,
  };
}

function applySnapshotDelta(
  base: UndoSnapshot,
  from: UndoSnapshot,
  to: UndoSnapshot,
): UndoSnapshot {
  const layouts = applyLayoutPatch(
    layoutsFromSnapshot(base),
    diffLayouts(layoutsFromSnapshot(from), layoutsFromSnapshot(to)),
  );
  const manufacturingDiff = diffRecord(
    from.manufacturing.bundles,
    to.manufacturing.bundles,
  );
  const subsystemDiff = diffRecord(from.subsystems, to.subsystems);
  return {
    ...base,
    system: applyNullableSystemDelta(base.system, from.system, to.system),
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
    imageLayouts: migrateCanvasImages(layouts.images, layouts.backgrounds),
    connectorTypeSizes: layouts.connectorTypeSizes,
    textBoxLayouts: layouts.textBoxes,
    waypointLayouts: layouts.waypoints,
    sharedAnchors: layouts.sharedAnchors,
    branchPointLayouts: layouts.branchPoints,
    rotationLayouts: layouts.rotations,
    routeStyleLayouts: layouts.routeStyles,
    viewRouteStyleLayouts: layouts.viewRouteStyles,
    subsystems: isRecordDiffEmpty(subsystemDiff)
      ? base.subsystems
      : applyRecordDiff(base.subsystems, subsystemDiff),
    selectedItem: deepEqual(from.selectedItem, to.selectedItem) ? base.selectedItem : to.selectedItem,
    selectedHarnessBundle: deepEqual(from.selectedHarnessBundle, to.selectedHarnessBundle) ? base.selectedHarnessBundle : to.selectedHarnessBundle,
    selectedTextBoxId: from.selectedTextBoxId === to.selectedTextBoxId
      ? base.selectedTextBoxId
      : to.selectedTextBoxId,
    selectedImageId: from.selectedImageId === to.selectedImageId
      ? base.selectedImageId
      : to.selectedImageId,
    capturedAt: Date.now(),
  };
}

function snapshotsEqual(left: UndoSnapshot, right: UndoSnapshot): boolean {
  return left.system === right.system
    && left.connectorLibrary === right.connectorLibrary
    && left.manufacturing === right.manufacturing
    && left.nodeLayouts === right.nodeLayouts
    && left.portLayouts === right.portLayouts
    && left.sizeLayouts === right.sizeLayouts
    && left.freePortLayouts === right.freePortLayouts
    && left.imageLayouts === right.imageLayouts
    && left.connectorTypeSizes === right.connectorTypeSizes
    && left.textBoxLayouts === right.textBoxLayouts
    && left.waypointLayouts === right.waypointLayouts
    && left.sharedAnchors === right.sharedAnchors
    && left.branchPointLayouts === right.branchPointLayouts
    && left.rotationLayouts === right.rotationLayouts
    && left.routeStyleLayouts === right.routeStyleLayouts
    && left.viewRouteStyleLayouts === right.viewRouteStyleLayouts
    && left.subsystems === right.subsystems
    && deepEqual(left.selectedItem, right.selectedItem)
    && deepEqual(left.selectedHarnessBundle, right.selectedHarnessBundle)
    && left.selectedTextBoxId === right.selectedTextBoxId
    && left.selectedImageId === right.selectedImageId;
}

function appendUndoEntry(stack: UndoEntry[], entry: UndoEntry): UndoEntry[] {
  const next = [...stack, entry];
  return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
}

function sharedAnchorDocumentFromState(state: Pick<
  SystemStore,
  'system' | 'waypointLayouts' | 'sharedAnchors' | 'branchPointLayouts' | 'openEnclosureId'
>): SharedAnchorDocument {
  return {
    system: state.system,
    waypointLayouts: state.waypointLayouts,
    sharedAnchors: state.sharedAnchors,
    branchPointLayouts: state.branchPointLayouts,
    openEnclosureId: state.openEnclosureId,
  };
}

function patchFromSharedAnchorDocument(document: SharedAnchorDocument): Partial<SystemStore> {
  return {
    system: document.system,
    waypointLayouts: document.waypointLayouts,
    sharedAnchors: document.sharedAnchors,
    branchPointLayouts: document.branchPointLayouts,
    isDirty: true,
  };
}

function historyPatch(
  state: SystemStore,
  patch: Partial<SystemStore>,
  actionKey: string,
): Partial<SystemStore> {
  const beforeMutation = makeSnapshot(state);
  const afterMutation = makeSnapshot({ ...state, ...patch } as SystemStore);
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
  const diff = diffLayouts(layoutsFromSnapshot(from), layoutsFromSnapshot(to));
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
  if (entry.before.system && entry.after.system) {
    const diff = diffSystem(entry.before.system, entry.after.system);
    if (diff.metadata) affected.push('system name');
    affected.push(...changedSystemEntityIds(diff));
  } else if (entry.before.system !== entry.after.system) {
    affected.push('system');
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
  system: SystemData | null,
  affectedIds: string[],
): SelectedItem | null {
  if (!system) return null;
  for (const id of affectedIds) {
    if (system.hierarchy.some((item) => item.id === id)) return { type: 'enclosure', id };
    if (system.connectors.some((item) => item.id === id)) return { type: 'connector', id };
    if (system.branchPoints.some((item) => item.id === id)) return { type: 'branchPoint', id };
    if (system.paths.some((item) => item.id === id)) return { type: 'path', id };
    if (system.signals.some((item) => item.id === id)) return { type: 'signal', id };
  }
  return null;
}

function scopedHistoryPatch(
  state: SystemStore,
  entry: UndoEntry,
  direction: 'undo' | 'redo',
): Partial<SystemStore> {
  const from = direction === 'undo' ? entry.after : entry.before;
  const to = direction === 'undo' ? entry.before : entry.after;
  const applied = applySnapshotDelta(makeSnapshot(state), from, to);
  const affectedIds = getEntryAffectedEntities(entry);
  const selectedItem = to.selectedItem
    && findAffectedHarnessItem(applied.system, [to.selectedItem.id])
      ? to.selectedItem
      : null;
  const selectedHarnessBundle = to.selectedHarnessBundle
    && to.selectedHarnessBundle.pathIds.some((id) => applied.system?.paths.some((path) => path.id === id))
      ? to.selectedHarnessBundle
      : null;
  const selectedTextBoxId = to.selectedTextBoxId && applied.textBoxLayouts[to.selectedTextBoxId]
    ? to.selectedTextBoxId
    : null;
  const selectedImageId = to.selectedImageId && applied.imageLayouts[to.selectedImageId]
    ? to.selectedImageId
    : null;
  const patch: Partial<SystemStore> = {
    system: applied.system,
    connectorLibrary: applied.connectorLibrary,
    manufacturing: applied.manufacturing,
    nodeLayouts: applied.nodeLayouts,
    portLayouts: applied.portLayouts,
    sizeLayouts: applied.sizeLayouts,
    freePortLayouts: applied.freePortLayouts,
    imageLayouts: applied.imageLayouts,
    connectorTypeSizes: applied.connectorTypeSizes,
    textBoxLayouts: applied.textBoxLayouts,
    waypointLayouts: applied.waypointLayouts,
    sharedAnchors: applied.sharedAnchors,
    branchPointLayouts: applied.branchPointLayouts,
    rotationLayouts: applied.rotationLayouts,
    routeStyleLayouts: applied.routeStyleLayouts,
    viewRouteStyleLayouts: applied.viewRouteStyleLayouts,
    subsystems: applied.subsystems,
    selectedItem,
    selectedHarnessBundle,
    selectedTextBoxId,
    selectedImageId,
    isDirty: true,
  };

  const revealItem = selectedItem
    ?? (!selectedHarnessBundle && !selectedTextBoxId && !selectedImageId
      ? findAffectedHarnessItem(applied.system, affectedIds)
      : null);
  if (revealItem && applied.system) {
    const requestId = state.revealRequestSequence + 1;
    patch.appView = 'canvas';
    patch.editingSurface = 'hierarchy';
    patch.openEnclosureId = getEntityRevealContext(
      applied.system,
      revealItem,
      state.openEnclosureId,
    );
    patch.selectedItem = revealItem;
    patch.selectedHarnessBundle = null;
    patch.selectedTextBoxId = null;
    patch.selectedImageId = null;
    patch.revealRequest = { item: revealItem, requestId };
    patch.revealRequestSequence = requestId;
  } else if (selectedHarnessBundle && applied.system) {
    const firstPathId = selectedHarnessBundle.pathIds.find((id) =>
      applied.system?.paths.some((path) => path.id === id)
    );
    if (firstPathId) {
      patch.appView = 'canvas';
      patch.editingSurface = 'hierarchy';
      patch.openEnclosureId = getEntityRevealContext(
        applied.system,
        { type: 'path', id: firstPathId },
        state.openEnclosureId,
      );
    }
  } else if (selectedTextBoxId) {
    const contextKey = applied.textBoxLayouts[selectedTextBoxId]?.contextKey ?? 'graph';
    patch.appView = 'canvas';
    patch.editingSurface = 'hierarchy';
    patch.openEnclosureId = contextKey === 'graph' ? null : contextKey;
  } else if (selectedImageId) {
    const contextKey = applied.imageLayouts[selectedImageId]?.contextKey ?? 'graph';
    const view = viewFromImageContextKey(contextKey);
    patch.appView = 'canvas';
    patch.editingSurface = view.editingSurface;
    if (view.editingSurface === 'subsystem' && view.activeSubsystemId) {
      patch.activeSubsystemId = view.activeSubsystemId;
    } else {
      patch.openEnclosureId = view.openEnclosureId;
    }
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
    } else if (subsystemId && applied.subsystems[subsystemId] && view.editingSurface !== 'hierarchy') {
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

const ACTIVE_SYSTEM_STORAGE_KEY = 'vw-active-system';
const LEGACY_ACTIVE_SYSTEM_STORAGE_KEY = 'vw-active-harness';

function getInitialSystemName(): string {
  try {
    return localStorage.getItem(ACTIVE_SYSTEM_STORAGE_KEY)
      ?? localStorage.getItem(LEGACY_ACTIVE_SYSTEM_STORAGE_KEY)
      ?? 'fsae-car';
  } catch {
    return 'fsae-car';
  }
}

const TRUSTED_DOCUMENT_UPDATE = Symbol('trusted-document-update');
type TrustedDocumentPatch = {
  readonly [TRUSTED_DOCUMENT_UPDATE]?: true;
};

const DOCUMENT_SLICES = [
  'system',
  'connectorLibrary',
  'manufacturing',
  'subsystems',
  'nodeLayouts',
  'portLayouts',
  'sizeLayouts',
  'freePortLayouts',
  'imageLayouts',
  'connectorTypeSizes',
  'textBoxLayouts',
  'waypointLayouts',
  'sharedAnchors',
  'branchPointLayouts',
  'rotationLayouts',
  'routeStyleLayouts',
  'viewRouteStyleLayouts',
] as const satisfies readonly (keyof SystemStore)[];

function trustedDocumentPatch<T extends object>(patch: T): T {
  Object.defineProperty(patch, TRUSTED_DOCUMENT_UPDATE, {
    value: true,
    enumerable: false,
  });
  return patch;
}

function readOnlyMiddleware(
  config: StateCreator<SystemStore, [], []>,
): StateCreator<SystemStore, [], []> {
  return (set, get, api) => {
    const guardedSet = ((
      update: Parameters<typeof set>[0],
      replace?: boolean,
    ) => {
      const current = get();
      const patch = typeof update === 'function' ? update(current) : update;
      if (!patch) return;
      const candidate = patch as Partial<SystemStore> & TrustedDocumentPatch;
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
      if (replace) set(candidate as SystemStore, true);
      else set(candidate);
    }) as typeof set;
    api.setState = guardedSet;
    return config(guardedSet, get, api);
  };
}

function getLayouts(state: SystemStore): CollaborationLayouts {
  return layoutsFromSnapshot(state);
}

function layoutStatePatch(layouts: CollaborationLayouts): Pick<
  SystemStore,
  | 'nodeLayouts'
  | 'portLayouts'
  | 'sizeLayouts'
  | 'freePortLayouts'
  | 'imageLayouts'
  | 'connectorTypeSizes'
  | 'textBoxLayouts'
  | 'waypointLayouts'
  | 'sharedAnchors'
  | 'branchPointLayouts'
  | 'rotationLayouts'
  | 'routeStyleLayouts'
  | 'viewRouteStyleLayouts'
> {
  return {
    nodeLayouts: layouts.nodes,
    portLayouts: layouts.ports,
    sizeLayouts: layouts.sizes,
    freePortLayouts: layouts.free,
    imageLayouts: migrateCanvasImages(layouts.images, layouts.backgrounds),
    connectorTypeSizes: layouts.connectorTypeSizes,
    textBoxLayouts: layouts.textBoxes,
    waypointLayouts: layouts.waypoints,
    sharedAnchors: layouts.sharedAnchors,
    branchPointLayouts: layouts.branchPoints,
    rotationLayouts: layouts.rotations,
    routeStyleLayouts: layouts.routeStyles,
    viewRouteStyleLayouts: layouts.viewRouteStyles,
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
  system: SystemData | null,
  document: SubsystemDocument,
): SubsystemDocument {
  if (!system) return document;
  const entities = new Map(system.hierarchy.map((entity) => [entity.id, entity]));
  const enclosures = { ...document.enclosures };
  const devices = { ...document.devices };
  const connectors = { ...document.connectors };
  let deviceConnectorMode = document.device_connector_mode;
  let changed = false;

  for (const [id, layout] of Object.entries(document.enclosures)) {
    const entity = entities.get(id);
    if (!entity || entity.kind === 'enclosure') continue;
    if (!Object.hasOwn(devices, id)) devices[id] = layout;
    delete enclosures[id];
    changed = true;
  }
  for (const [id, layout] of Object.entries(document.devices)) {
    const entity = entities.get(id);
    if (entity?.kind !== 'enclosure') continue;
    if (!Object.hasOwn(enclosures, id)) enclosures[id] = layout;
    delete devices[id];
    if (deviceConnectorMode && Object.hasOwn(deviceConnectorMode, id)) {
      deviceConnectorMode = { ...deviceConnectorMode };
      delete deviceConnectorMode[id];
    }
    changed = true;
  }

  const connectorById = new Map(
    system.connectors.map((connector) => [connector.id, connector]),
  );
  for (const connectorId of Object.keys(connectors)) {
    if (connectorById.has(connectorId)) continue;
    delete connectors[connectorId];
    changed = true;
  }
  const hiddenConnectorIds = new Set(document.hidden_connectors ?? []);
  const representedConnectorIds = new Set(Object.keys(connectors));
  for (const deviceId of Object.keys(devices)) {
    if ((deviceConnectorMode?.[deviceId] ?? 'all') !== 'all') continue;
    for (const connector of system.connectors) {
      if (connector.parent === deviceId && !hiddenConnectorIds.has(connector.id)) {
        representedConnectorIds.add(connector.id);
      }
    }
  }

  const implicitPlaceholderIds = new Set<string>();
  for (const path of system.paths) {
    const pathConnectorIds = path.nodes.flatMap((node) =>
      node.kind === 'connector' ? [node.connector_id] : []
    );
    if (!pathConnectorIds.some((connectorId) => representedConnectorIds.has(connectorId))) {
      continue;
    }
    for (const connectorId of pathConnectorIds) {
      const connector = connectorById.get(connectorId);
      if (
        connector
        && isAutoBulkheadPlaceholder(connector)
        && connector.parent
        && Object.hasOwn(enclosures, connector.parent)
        && !hiddenConnectorIds.has(connector.id)
      ) {
        implicitPlaceholderIds.add(connector.id);
      }
    }
  }

  for (const connectorId of [...implicitPlaceholderIds].sort()) {
    if (Object.hasOwn(connectors, connectorId)) continue;
    const connector = connectorById.get(connectorId);
    const parentId = connector?.parent;
    const parentLayout = parentId ? enclosures[parentId] : undefined;
    if (!connector || !parentId || !parentLayout) continue;
    const siblingIndex = Object.keys(connectors).filter(
      (candidateId) => connectorById.get(candidateId)?.parent === parentId,
    ).length;
    const width = 96;
    const height = 36;
    const onLeft = siblingIndex % 2 === 0;
    connectors[connectorId] = {
      x: onLeft ? -width / 2 : (parentLayout.w ?? 520) - width / 2,
      y: Math.min(
        Math.max(54, 72 + Math.floor(siblingIndex / 2) * 48),
        Math.max(54, (parentLayout.h ?? 360) - height - 18),
      ),
      w: width,
      h: height,
    };
    changed = true;
  }

  return changed
    ? {
        ...document,
        enclosures,
        devices,
        connectors,
        device_connector_mode: deviceConnectorMode,
      }
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

function systemLayoutSourceFromState(state: Pick<
  SystemStore,
  'nodeLayouts' | 'sizeLayouts' | 'portLayouts' | 'freePortLayouts'
>): SystemLayoutSource {
  return {
    nodeLayouts: state.nodeLayouts,
    sizeLayouts: state.sizeLayouts,
    portLayouts: state.portLayouts,
    freePortLayouts: state.freePortLayouts,
  };
}

function connectorRenderedSizeForResize(
  state: SystemStore,
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
  const occupiedPins = state.system
    ? getConnectorOccupancy(state.system, connector.id)
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

export const useSystemStore = create<SystemStore>(readOnlyMiddleware((set, get) => ({
  system: null,
  serverSystem: null,
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
  activeSystemName: getInitialSystemName(),
  availableSystems: [],
  selectedItem: null,
  nodeLayouts: {},
  isDirty: false,
  expandedNodes: new Set<string>(),
  expandedSizeOverrides: {},
  settingsOpen: false,
  openEnclosureId: null,
  portLayouts: {},
  sizeLayouts: {},
  freePortLayouts: {},
  imageLayouts: {},
  connectorTypeSizes: {},
  textBoxLayouts: {},
  selectedTextBoxId: null,
  selectedImageId: null,
  selectedHarnessBundle: null,
  inspectorDismissed: false,
  revealRequest: null,
  revealRequestSequence: 0,
  waypointLayouts: {},
  sharedAnchors: {},
  branchPointLayouts: {},
  rotationLayouts: {},
  routeStyleLayouts: {},
  viewRouteStyleLayouts: {},
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

  setActiveSystemName: async (name) => {
    if (name === get().activeSystemName) return true;
    const saved = await flushAutoSave();
    if (!saved) return false;
    try { localStorage.setItem(ACTIVE_SYSTEM_STORAGE_KEY, name); } catch { /* ignore */ }
    set({ activeSystemName: name });
    return true;
  },
  setAvailableSystems: (systems) => set({ availableSystems: systems }),
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
    if (!state.system) return state;
    try {
      const system = renameSystemDocument(state.system, name);
      if (system === state.system) return state;
      const availableSystems = state.availableSystems.map((item) => (
        item.id === state.activeSystemName && system.name
          ? { ...item, name: system.name }
          : item
      ));
      return historyPatch(
        state,
        { system, availableSystems, isDirty: true, mutationError: null },
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
  setConnectorLibraryTarget: (typeId) => set({ connectorLibraryTargetId: typeId }),
  setSignalLibraryTarget: (signalId) => set({ signalLibraryTargetId: signalId }),
  openManufacturing: (bundleId = null) => set((state) => {
    const userId = state.session.user?.id ?? null;
    const systemKey = state.activeSystemName;
    if (bundleId) {
      setLastManufacturingBundleId(userId, systemKey, bundleId);
    }
    const resolved = bundleId
      ?? getLastManufacturingBundleId(userId, systemKey);
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
        state.activeSystemName,
        bundleId,
      );
    }
    return { manufacturingTargetBundleId: bundleId };
  }),
  setManufacturingTab: (tab) => set({ manufacturingTab: tab }),
  showBundleInHierarchy: (pathIds) => set((state) => {
    const firstPathId = pathIds.find((pathId) =>
      state.system?.paths.some((path) => path.id === pathId)
    );
    const openEnclosureId =
      state.system && firstPathId
        ? getEntityRevealContext(
            state.system,
            { type: 'path', id: firstPathId },
            state.openEnclosureId,
          )
        : state.openEnclosureId;
    const visibleBundles = state.system
      ? deriveHarnessBundles(getVisibleWires(state.system, openEnclosureId))
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
      openEnclosureId,
      selectedHarnessBundle: visibleBundle
        ? { id: visibleBundle.id, pathIds: visibleBundle.pathIds }
        : firstPathId
          ? { id: '', pathIds: [firstPathId] }
          : null,
      selectedItem: null,
      selectedTextBoxId: null,
      selectedImageId: null,
      revealRequest: firstPathId
        ? { item: { type: 'path' as const, id: firstPathId }, requestId }
        : null,
      revealRequestSequence: firstPathId ? requestId : state.revealRequestSequence,
      manufacturingTargetBundleId: null,
    };
  }),
  inspectEntity: (item) => set((state) => {
    const requestId = (state.revealRequestSequence ?? 0) + 1;
    const openEnclosureId = state.system
      ? getEntityRevealContext(state.system, item, state.openEnclosureId)
      : state.openEnclosureId;
    return {
      appView: 'canvas',
      editingSurface: 'hierarchy',
      connectorLibraryTargetId: null,
      signalLibraryTargetId: null,
      manufacturingTargetBundleId: null,
      selectedItem: item,
      selectedHarnessBundle: null,
      selectedTextBoxId: null,
      selectedImageId: null,
      revealRequest: { item, requestId },
      revealRequestSequence: requestId,
      openEnclosureId,
    };
  }),
  inspectEntityQuiet: (item) => set({
    selectedItem: item,
    selectedHarnessBundle: null,
    selectedTextBoxId: null,
    selectedImageId: null,
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
      normalizeSubsystemDocument(state.system, document));
    const records = Object.fromEntries(normalizedDocuments.map((document) => [document.id, document]));
    return trustedDocumentPatch({
      system: tagSystemForSubsystems(state.system, normalizedDocuments),
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
  acceptSavedSubsystem: (document) => set((state) => {
    const normalized = normalizeSubsystemDocument(state.system, document);
    return trustedDocumentPatch({
      subsystems: { ...state.subsystems, [document.id]: normalized },
      serverSubsystems: {
        ...state.serverSubsystems,
        [document.id]: structuredClone(document),
      },
    });
  }),
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
      const entity = state.system?.hierarchy.find((item) => item.id === id);
      const correctKind = entity?.kind === 'enclosure' ? 'enclosures' : 'devices';
      if (!entity || kind !== correctKind) return state;
    }
    if (!Object.hasOwn(document[kind], id)) {
      if (kind !== 'connectors') return state;
      const connector = state.system?.connectors.find((item) => item.id === id);
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
    const system = state.system;
    if (!activeId || !document || !previousStoredLayout || !system) return state;

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
      const visibleConnectors = system.connectors.filter((connector) =>
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
        const connector = system.connectors.find((entity) => entity.id === connectorId);
        const parentEntity = connector?.parent
          ? system.hierarchy.find((entity) => entity.id === connector.parent)
          : undefined;
        const isDirectFrameChild =
          connector?.parent === id
          || (
            parentEntity?.kind === 'device'
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
          wallMounted: isBulkheadConnector(system, connector.id),
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
        const device = system.hierarchy.find((entity) => entity.id === deviceId);
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
        const childFrame = system.hierarchy.find((entity) => entity.id === childFrameId);
        if (childFrame?.kind !== 'enclosure' || childFrame.parent !== id) continue;
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
    const system = state.system;
    const current = subsystemId ? state.subsystems[subsystemId] : undefined;
    if (!subsystemId || !system || !current) return state;
    const document = structuredClone(current);
    const nextSystem = structuredClone(system);
    const layoutSource = systemLayoutSourceFromState(state);
    const systemTag = `system:${document.id}`;
    const createdFrameIds: string[] = [];
    const tagEnclosure = (enclosureId: string | null | undefined) => {
      if (!enclosureId) return;
      const mutable = nextSystem.hierarchy.find((item) => item.id === enclosureId);
      if (mutable && !mutable.tags.includes(systemTag)) mutable.tags.push(systemTag);
    };
    const ensureFrames = (startId: string | null) => {
      createdFrameIds.push(...ensureSubsystemAncestorFrames(
        nextSystem,
        document,
        startId,
        (frame) => {
          if (!frame.tags.includes(systemTag)) frame.tags.push(systemTag);
        },
        layoutSource,
      ));
    };
    const nextDeviceLayout = (deviceId: string, frameId: string | null) => {
      const index = Object.keys(document.devices).filter((deviceKey) =>
        system.hierarchy.find((item) => item.id === deviceKey)?.parent === frameId,
      ).length;
      // Omit w/h so the subsystem canvas inherits the system device size until locally resized.
      return enclosureLayoutFromSystem(deviceId, 'device', layoutSource, {
        x: 40 + (index % 2) * 240,
        y: 60 + Math.floor(index / 2) * 200,
      });
    };
    const nextConnectorLayout = (connectorId: string) => {
      const index = Object.keys(document.connectors).length;
      return connectorLayoutFromSystem(connectorId, layoutSource, {
        x: 40 + (index % 3) * 112,
        y: 80 + Math.floor(index / 3) * 52,
        w: 96,
        h: 36,
      });
    };
    if (type === 'enclosure') {
      const entity = system.hierarchy.find((item) => item.id === id);
      if (!entity) return state;
      const mutableEntity = nextSystem.hierarchy.find((item) => item.id === id);
      if (mutableEntity && !mutableEntity.tags.includes(systemTag)) mutableEntity.tags.push(systemTag);
      const isDevice = entity.kind === 'device';
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
        for (const connector of nextSystem.connectors.filter((item) => item.parent === id)) {
          if (!connector.tags.includes(systemTag)) connector.tags.push(systemTag);
        }
      }
      normalizeSubsystemFrameInteriors(nextSystem, document, createdFrameIds, layoutSource);
      return historyPatch(state, {
        system: nextSystem,
        subsystems: { ...state.subsystems, [subsystemId]: document },
        isDirty: true,
      }, `subsystem:${subsystemId}:add:${type}:${id}`);
    }

    const connector = system.connectors.find((item) => item.id === id);
    if (!connector) return state;
    const parentEntity = connector.parent
      ? system.hierarchy.find((item) => item.id === connector.parent)
      : undefined;
    const deviceId = parentEntity && parentEntity.kind === 'device' ? parentEntity.id : null;
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
    const mutableConnector = nextSystem.connectors.find((item) => item.id === id);
    if (mutableConnector && !mutableConnector.tags.includes(systemTag)) mutableConnector.tags.push(systemTag);
    tagEnclosure(deviceId);
    normalizeSubsystemFrameInteriors(nextSystem, document, createdFrameIds, layoutSource);
    return historyPatch(state, {
      system: nextSystem,
      subsystems: { ...state.subsystems, [subsystemId]: document },
      isDirty: true,
    }, `subsystem:${subsystemId}:add:${type}:${id}`);
  }),
  resetActiveSubsystemLayoutFromSystem: () => set((state) => {
    const subsystemId = state.activeSubsystemId;
    const system = state.system;
    const current = subsystemId ? state.subsystems[subsystemId] : undefined;
    if (!subsystemId || !system || !current) return state;
    const document = applySystemPhysicalLayout(
      system,
      current,
      systemLayoutSourceFromState(state),
    );
    return historyPatch(state, {
      subsystems: { ...state.subsystems, [subsystemId]: document },
      isDirty: true,
    }, `subsystem:${subsystemId}:reset-layout`);
  }),
  removeEntityFromActiveSubsystem: (type, id) => set((state) => {
    const subsystemId = state.activeSubsystemId;
    const current = subsystemId ? state.subsystems[subsystemId] : undefined;
    if (!subsystemId || !current || !state.system) return state;
    const document = structuredClone(current);
    const system = structuredClone(state.system);
    const systemTag = `system:${subsystemId}`;
    const stripTag = (tags: string[]) => tags.filter((tag) => tag !== systemTag);

    if (type === 'connector') {
      delete document.connectors[id];
      const connector = system.connectors.find((item) => item.id === id);
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
      const enclosure = system.hierarchy.find((item) => item.id === id);
      if (!enclosure) return state;
      enclosure.tags = stripTag(enclosure.tags);
      if (enclosure.kind === 'device') {
        delete document.enclosures[id];
        delete document.devices[id];
        if (document.device_connector_mode) delete document.device_connector_mode[id];
        const associatedConnectorIds = new Set(
          system.connectors.filter((item) => item.parent === id).map((item) => item.id),
        );
        for (const connectorId of associatedConnectorIds) {
          delete document.connectors[connectorId];
          const connector = system.connectors.find((item) => item.id === connectorId);
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
            const frame = system.hierarchy.find((item) => item.id === frameId);
            if (frame?.parent && frameIdsToRemove.has(frame.parent)) {
              frameIdsToRemove.add(frameId);
              grew = true;
            }
          }
        }
        for (const frameId of frameIdsToRemove) {
          delete document.enclosures[frameId];
          const frame = system.hierarchy.find((item) => item.id === frameId);
          if (frame) frame.tags = stripTag(frame.tags);
        }
        delete document.devices[id];
        if (document.device_connector_mode) delete document.device_connector_mode[id];
        const removedDeviceIds = system.hierarchy
          .filter((item) =>
            item.parent
            && frameIdsToRemove.has(item.parent)
            && document.devices[item.id]
          )
          .map((item) => item.id);
        for (const deviceId of removedDeviceIds) {
          delete document.devices[deviceId];
          if (document.device_connector_mode) delete document.device_connector_mode[deviceId];
          const device = system.hierarchy.find((item) => item.id === deviceId);
          if (device) device.tags = stripTag(device.tags);
        }
        for (const connector of system.connectors) {
          const parent = connector.parent
            ? system.hierarchy.find((item) => item.id === connector.parent)
            : undefined;
          const frameId = parent && parent.kind === 'device' ? parent.parent : connector.parent;
          if (!frameId || !frameIdsToRemove.has(frameId)) continue;
          delete document.connectors[connector.id];
          connector.tags = stripTag(connector.tags);
        }
      }
    }
    return historyPatch(state, {
      system,
      subsystems: { ...state.subsystems, [subsystemId]: document },
      selectedItem: null,
      isDirty: true,
    }, `subsystem:${subsystemId}:remove:${type}:${id}`);
  }),
  renumberConnectorCavities: (connectorId, orderedOldPinNumbers) => set((state) => {
    if (!state.system) return state;
    return historyPatch(state, {
      system: renumberConnectorPins(state.system, connectorId, orderedOldPinNumbers),
      isDirty: true,
    }, `connector:${connectorId}:renumber-cavities`);
  }),
  mergeBulkheadConnectors: (sourceId, targetId) => {
    const state = get();
    if (!state.system) return null;
    const sourceConnector = state.system.connectors.find((connector) => connector.id === sourceId);
    const targetConnector = state.system.connectors.find((connector) => connector.id === targetId);
    if (!sourceConnector || !targetConnector) {
      set({ mutationError: 'Both connectors must exist to merge.' });
      return null;
    }
    if (!canMergePassThroughConnectors(state.system, sourceId, targetId)) {
      set({ mutationError: 'Only two inline connectors or two bulkheads can be merged.' });
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
      const system = mergeConnectors(state.system, absorbId, keepId, { targetType });
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
        system,
        subsystems,
        portLayouts,
        freePortLayouts,
        sizeLayouts,
        rotationLayouts,
        selectedItem: { type: 'connector', id: keepId },
        selectedHarnessBundle: null,
        mutationError: null,
        isDirty: true,
      }, `connector:${keepId}:merge`));
      return keepId;
    } catch (error) {
      set({
        mutationError: error instanceof Error ? error.message : 'Connector merge failed.',
      });
      return null;
    }
  },
  splitBulkheadDotPath: (connectorId, pathId) => {
    const state = get();
    if (!state.system) return null;
    const path = state.system.paths.find((candidate) => candidate.id === pathId);
    const source = state.system.connectors.find((candidate) => candidate.id === connectorId);
    if (!path || !source) {
      set({ mutationError: 'The bulkhead dot or selected wire no longer exists.' });
      return null;
    }

    const newConnectorId = `con_dot_${crypto.randomUUID()}`;
    try {
      const system = splitBulkheadDotPathInSystem(
        state.system,
        connectorId,
        pathId,
        newConnectorId,
        `${path.name} dot`,
      );
      const offset = <T extends { x: number; y: number }>(layout: T): T => ({
        ...layout,
        x: layout.x + 24,
        y: layout.y + 24,
      });
      const portLayouts = { ...state.portLayouts };
      if (portLayouts[connectorId]) {
        portLayouts[newConnectorId] = offset(portLayouts[connectorId]);
      }
      const subsystems = Object.fromEntries(
        Object.entries(state.subsystems).map(([subsystemId, subsystem]) => {
          const sourceLayout = subsystem.connectors[connectorId];
          if (!sourceLayout) return [subsystemId, subsystem];
          return [
            subsystemId,
            {
              ...subsystem,
              connectors: {
                ...subsystem.connectors,
                [newConnectorId]: offset(sourceLayout),
              },
            },
          ];
        }),
      );
      set(historyPatch(state, {
        system,
        portLayouts,
        subsystems,
        selectedItem: { type: 'connector', id: newConnectorId },
        selectedHarnessBundle: null,
        mutationError: null,
        isDirty: true,
      }, `connector:${connectorId}:split-dot:${pathId}`));
      return newConnectorId;
    } catch (error) {
      set({
        mutationError: error instanceof Error ? error.message : 'Could not release the wire.',
      });
      return null;
    }
  },
  separateBranchPointFamily: (branchPointId, occurrences, dropPosition) => {
    const state = get();
    if (!state.system) return null;
    if (occurrences.length === 0) {
      set({ mutationError: 'Nothing to split off this branch point.' });
      return null;
    }
    const newBranchPointId = nextBranchPointId(state.system);
    const newName = nextBranchPointName(state.system);
    const system = separateBranchPointOccurrences(
      state.system,
      branchPointId,
      occurrences,
      newBranchPointId,
      newName,
    );
    if (system === state.system) {
      set({ mutationError: 'That connection could not be split off this branch point.' });
      return null;
    }
    const contextKey = state.openEnclosureId ?? 'graph';
    const basePos = state.branchPointLayouts[contextKey]?.[branchPointId] ?? { x: 160, y: 420 };
    const newPos = dropPosition ?? { x: basePos.x + 40, y: basePos.y + 40 };
    const branchPointLayouts = {
      ...state.branchPointLayouts,
      [contextKey]: {
        ...(state.branchPointLayouts[contextKey] ?? {}),
        [newBranchPointId]: newPos,
      },
    };
    set(historyPatch(state, {
      system,
      branchPointLayouts,
      selectedItem: { type: 'branchPoint', id: newBranchPointId },
      selectedHarnessBundle: null,
      mutationError: null,
      isDirty: true,
    }, `branchPoint:${branchPointId}:separate`));
    return newBranchPointId;
  },
  fuseBranchPoints: (sourceId, targetId) => {
    const state = get();
    if (!state.system) return null;
    const sourceBranchPoint = state.system.branchPoints.find((branchPoint) => branchPoint.id === sourceId);
    const targetBranchPoint = state.system.branchPoints.find((branchPoint) => branchPoint.id === targetId);
    if (!sourceBranchPoint || !targetBranchPoint) {
      set({ mutationError: 'Both branch points must exist to fuse.' });
      return null;
    }
    if (!canFuseBranchPoints(state.system, sourceId, targetId)) {
      set({ mutationError: 'Only two branch points with the same parent, and no shared path, can be fused.' });
      return null;
    }
    // Prefer keeping an authored branch point over one derived from a sheet port.
    let absorbId = sourceId;
    let keepId = targetId;
    if (!sourceBranchPoint.derived && targetBranchPoint.derived) {
      absorbId = targetId;
      keepId = sourceId;
    }
    try {
      const system = fuseBranchPointsInSystem(state.system, absorbId, keepId);
      const branchPointLayouts = stripBranchPointLayouts(state.branchPointLayouts, [absorbId]);
      const sizeLayouts = { ...state.sizeLayouts };
      delete sizeLayouts[absorbId];
      const sharedAnchors = { ...state.sharedAnchors };
      for (const [sharedAnchorId, sharedAnchor] of Object.entries(sharedAnchors)) {
        if (sharedAnchor.branchPointId === absorbId) {
          sharedAnchors[sharedAnchorId] = { ...sharedAnchor, branchPointId: keepId };
        }
      }
      set(historyPatch(state, {
        system,
        branchPointLayouts,
        sizeLayouts,
        sharedAnchors,
        selectedItem: { type: 'branchPoint', id: keepId },
        selectedHarnessBundle: null,
        mutationError: null,
        isDirty: true,
      }, `branchPoint:${keepId}:fuse`));
      return keepId;
    } catch (error) {
      set({
        mutationError: error instanceof Error ? error.message : 'Branch point fuse failed.',
      });
      return null;
    }
  },
  getDeleteImpact: (type, id) => {
    const system = get().system;
    return system ? collectDeleteImpact(system, type, id) : emptyDeleteImpact();
  },
  deleteEntityCascade: (type, id) => set((state) => {
    if (!state.system) return state;
    const impact = collectDeleteImpact(state.system, type, id);
    const enclosureIds = new Set(impact.enclosureIds);
    const connectorIds = new Set(impact.connectorIds);
    const branchPointIds = new Set(impact.branchPointIds);
    const pathIds = new Set(impact.pathIds);
    const signalIds = new Set(impact.signalIds);
    const dissolveInline =
      type === 'connector' && isInlineConnector(state.system, id);
    const dissolvedPathIds = dissolveInline
      ? state.system.paths
          .filter((path) => path.nodes.some(
            (node) => node.kind === 'connector' && node.connector_id === id,
          ))
          .map((path) => path.id)
      : [];

    // Dissolve semantic pass-throughs first so their neighbors reconnect
    // instead of wiping every path that touched them.
    let system = structuredClone(state.system);
    if (dissolveInline) {
      system = dissolveInlineConnector(system, id);
    }
    for (const branchPointId of impact.branchPointIds) {
      system = dissolveBranchPoint(system, branchPointId);
    }
    system = {
      ...system,
      hierarchy: system.hierarchy.filter((item) => !enclosureIds.has(item.id)),
      connectors: system.connectors.filter((item) => !connectorIds.has(item.id)),
      branchPoints: system.branchPoints.filter((item) => !branchPointIds.has(item.id)),
      paths: system.paths.filter((item) => !pathIds.has(item.id)),
      signals: system.signals.filter((item) => !signalIds.has(item.id)),
    };

    const inlinePresentation = dissolveInline
      ? rejoinBundlePresentationAfterInline(
          state.waypointLayouts,
          state.sharedAnchors,
          state.routeStyleLayouts,
          state.system,
          id,
        )
      : {
          waypointLayouts: state.waypointLayouts,
          sharedAnchors: state.sharedAnchors,
          routeStyleLayouts: state.routeStyleLayouts,
        };
    const mergeLayoutCleanup = cleanLayoutsForRemovedBranchPoints({
      branchPointLayouts: state.branchPointLayouts,
      ...inlinePresentation,
    }, impact.branchPointIds);
    const removedConnectorRefs = new Set(
      [...connectorIds].map((connectorId) => `connector:${connectorId}`),
    );
    const removedEdgeIds = new Set(
      Object.keys(mergeLayoutCleanup.waypointLayouts).filter((edgeId) => {
        const parsed = parseHarnessBundleId(edgeId);
        return !!parsed && (
          removedConnectorRefs.has(parsed.sourceRefKey)
          || removedConnectorRefs.has(parsed.targetRefKey)
        );
      }),
    );
    const presentationCleanup = removeBundlePresentation(
      mergeLayoutCleanup.waypointLayouts,
      mergeLayoutCleanup.sharedAnchors,
      removedEdgeIds,
    );
    const routeStyleLayouts = { ...(inlinePresentation.routeStyleLayouts ?? state.routeStyleLayouts) };
    for (const edgeId of removedEdgeIds) delete routeStyleLayouts[edgeId];
    const portLayouts = { ...state.portLayouts };
    const freePortLayouts = { ...state.freePortLayouts };
    const sizeLayouts = { ...state.sizeLayouts };
    const rotationLayouts = { ...state.rotationLayouts };
    for (const connectorId of connectorIds) {
      delete portLayouts[connectorId];
      delete freePortLayouts[connectorId];
      delete sizeLayouts[connectorId];
      delete rotationLayouts[connectorId];
    }
    const subsystems = Object.fromEntries(Object.entries(state.subsystems).map(([subsystemId, subsystem]) => [
      subsystemId,
      {
        ...subsystem,
        enclosures: Object.fromEntries(Object.entries(subsystem.enclosures).filter(([entityId]) => !enclosureIds.has(entityId))),
        devices: Object.fromEntries(Object.entries(subsystem.devices).filter(([entityId]) => !enclosureIds.has(entityId))),
        connectors: Object.fromEntries(Object.entries(subsystem.connectors).filter(([entityId]) => !connectorIds.has(entityId))),
        hidden_connectors: (subsystem.hidden_connectors ?? []).filter(
          (connectorId) => !connectorIds.has(connectorId),
        ),
      },
    ]));
    const manufacturing = dissolveInline
      ? pruneReplacedManufacturingBundles(
          state.manufacturing,
          state.system,
          system,
          state.connectorLibrary,
          dissolvedPathIds,
        )
      : state.manufacturing;
    return historyPatch(state, {
      system,
      manufacturing,
      subsystems,
      branchPointLayouts: mergeLayoutCleanup.branchPointLayouts,
      ...presentationCleanup,
      routeStyleLayouts,
      portLayouts,
      freePortLayouts,
      sizeLayouts,
      rotationLayouts,
      selectedItem: null,
      selectedHarnessBundle: null,
      isDirty: true,
    }, `delete:${type}:${id}`);
  }),
  getEnclosureKindConvertImpact: (id) => {
    const system = get().system;
    return system ? collectEnclosureKindConvertImpact(system, id) : null;
  },
  convertEnclosureKind: (id) => {
    const state = get();
    if (!state.system) return false;
    if (state.collabAvailable && !state.session.isEditor) {
      set({ mutationError: 'Log in to edit' });
      return false;
    }
    const enclosure = state.system.hierarchy.find((item) => item.id === id);
    if (!enclosure) return false;

    set((current) => {
      if (!current.system) return current;
      const currentEnclosure = current.system.hierarchy.find((item) => item.id === id);
      if (!currentEnclosure) return current;
      const impact = collectEnclosureKindConvertImpact(current.system, id);
      if (!impact) return current;

      const enclosureIds = new Set([
        ...impact.nestedDeviceIds,
        ...impact.nestedEnclosureIds,
      ]);
      const connectorIds = new Set(impact.connectorIds);
      const branchPointIds = new Set(impact.branchPointIds);
      const pathIds = new Set(impact.pathIds);
      for (const connector of current.system.connectors) {
        if (
          !isAutoBulkheadPlaceholder(connector)
          || !connector.parent
          || (connector.parent !== id && !enclosureIds.has(connector.parent))
        ) {
          continue;
        }
        connectorIds.add(connector.id);
        for (const wirePath of current.system.paths) {
          if (wirePath.nodes.some((node) =>
            node.kind === 'connector' && node.connector_id === connector.id
          )) {
            pathIds.add(wirePath.id);
          }
        }
      }

      let system = structuredClone(current.system);
      for (const branchPointId of branchPointIds) {
        system = dissolveBranchPoint(system, branchPointId);
      }
      system = {
        ...system,
        hierarchy: system.hierarchy.filter((item) => !enclosureIds.has(item.id)),
        connectors: system.connectors.filter((item) => !connectorIds.has(item.id)),
        branchPoints: system.branchPoints.filter((item) => !branchPointIds.has(item.id)),
        paths: system.paths.filter((item) => !pathIds.has(item.id)),
      };
      const converted = system.hierarchy.find((item) => item.id === id);
      if (!converted) return current;
      converted.kind = currentEnclosure.kind === 'enclosure' ? 'device' : 'enclosure';
      for (const connector of system.connectors) {
        if (connector.parent !== id) continue;
        if (converted.kind === 'enclosure') {
          if (connector.mounting !== 'inline') connector.mounting = 'bulkhead';
        } else if (connector.mounting === 'bulkhead') {
          delete connector.mounting;
        }
      }

      const mergeLayoutCleanup = cleanLayoutsForRemovedBranchPoints({
        branchPointLayouts: current.branchPointLayouts,
        waypointLayouts: current.waypointLayouts,
        sharedAnchors: current.sharedAnchors,
      }, branchPointIds);
      const removedConnectorRefs = new Set(
        [...connectorIds].map((connectorId) => `connector:${connectorId}`),
      );
      const removedEdgeIds = new Set(
        Object.keys(mergeLayoutCleanup.waypointLayouts).filter((edgeId) => {
          const parsed = parseHarnessBundleId(edgeId);
          return !!parsed && (
            removedConnectorRefs.has(parsed.sourceRefKey)
            || removedConnectorRefs.has(parsed.targetRefKey)
          );
        }),
      );
      const presentationCleanup = removeBundlePresentation(
        mergeLayoutCleanup.waypointLayouts,
        mergeLayoutCleanup.sharedAnchors,
        removedEdgeIds,
      );
      const portLayouts = { ...current.portLayouts };
      const freePortLayouts = { ...current.freePortLayouts };
      const sizeLayouts = { ...current.sizeLayouts };
      const rotationLayouts = { ...current.rotationLayouts };
      for (const connectorId of connectorIds) {
        delete portLayouts[connectorId];
        delete freePortLayouts[connectorId];
        delete sizeLayouts[connectorId];
        delete rotationLayouts[connectorId];
      }
      const subsystems = Object.fromEntries(Object.entries(current.subsystems).map(([subsystemId, subsystem]) => {
        const next = {
          ...subsystem,
          enclosures: Object.fromEntries(
            Object.entries(subsystem.enclosures).filter(([entityId]) => !enclosureIds.has(entityId)),
          ),
          devices: Object.fromEntries(
            Object.entries(subsystem.devices).filter(([entityId]) => !enclosureIds.has(entityId)),
          ),
          connectors: Object.fromEntries(
            Object.entries(subsystem.connectors).filter(([entityId]) => !connectorIds.has(entityId)),
          ),
          hidden_connectors: (subsystem.hidden_connectors ?? []).filter(
            (connectorId) => !connectorIds.has(connectorId),
          ),
          device_connector_mode: Object.fromEntries(
            Object.entries(subsystem.device_connector_mode ?? {}).filter(
              ([entityId]) => !enclosureIds.has(entityId),
            ),
          ),
        };
        return [subsystemId, normalizeSubsystemDocument(system, next)];
      }));

      const removedSpaces = new Set(enclosureIds);
      if (currentEnclosure.kind === 'enclosure') removedSpaces.add(id);
      const openEnclosureId = resolveOpenEnclosureAfterConvert(
        current.system,
        current.openEnclosureId,
        removedSpaces,
      );
      const selectedHarnessBundle = current.selectedHarnessBundle?.pathIds.some((pathId) => pathIds.has(pathId))
        ? null
        : current.selectedHarnessBundle;

      return historyPatch(current, {
        system,
        subsystems,
        branchPointLayouts: mergeLayoutCleanup.branchPointLayouts,
        ...presentationCleanup,
        portLayouts,
        freePortLayouts,
        sizeLayouts,
        rotationLayouts,
        openEnclosureId,
        selectedItem: { type: 'enclosure', id },
        selectedHarnessBundle,
        mutationError: null,
        isDirty: true,
      }, `enclosure:${id}:kind`);
    });

    return get().system?.hierarchy.find((item) => item.id === id)?.kind
      !== enclosure.kind;
  },
  deletePathHarnessBundle: (bundleId, pathIds) => set((state) => {
    if (!state.system || pathIds.length === 0) return state;
    const ids = new Set(pathIds);
    const existingIds = state.system.paths
      .filter((path) => ids.has(path.id))
      .map((path) => path.id);
    if (existingIds.length === 0) return state;
    const removedPathIds = new Set(existingIds);

    const system = structuredClone(state.system);
    system.paths = system.paths.filter((path) => !removedPathIds.has(path.id));
    const removedGeneratedConnectorIds = new Set(
      system.connectors
        .filter((connector) =>
          (
            isAutoBulkheadPlaceholder(connector)
            || removedPathIds.has(connector.properties.generated_by_route)
          )
          && !system.paths.some((path) => path.nodes.some((node) =>
            node.kind === 'connector' && node.connector_id === connector.id
          ))
        )
        .map((connector) => connector.id),
    );
    system.connectors = system.connectors.filter(
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
    delete waypointLayouts[getHarnessBundleLayoutId(bundleId)];
    delete waypointLayouts[getBaseHarnessBundleId(bundleId)];
    const routeStyleLayouts = { ...state.routeStyleLayouts };
    delete routeStyleLayouts[bundleId];
    delete routeStyleLayouts[getHarnessBundleLayoutId(bundleId)];
    delete routeStyleLayouts[getBaseHarnessBundleId(bundleId)];
    const sharedAnchors = structuredClone(state.sharedAnchors);
    for (const [sharedAnchorId, sharedAnchor] of Object.entries(sharedAnchors)) {
      sharedAnchor.memberEdgeIds = sharedAnchor.memberEdgeIds.filter((edgeId) => edgeId !== bundleId);
      if (sharedAnchor.memberEdgeIds.length === 0) delete sharedAnchors[sharedAnchorId];
    }

    return historyPatch(state, {
      system,
      subsystems,
      waypointLayouts,
      routeStyleLayouts,
      sharedAnchors,
      selectedItem:
        (
          state.selectedItem?.type === 'path' && removedPathIds.has(state.selectedItem.id)
        ) || (
          state.selectedItem?.type === 'connector'
          && removedGeneratedConnectorIds.has(state.selectedItem.id)
        )
          ? null
          : state.selectedItem,
      selectedHarnessBundle: null,
      mutationError: null,
      isDirty: true,
    }, `delete:bundle:${bundleId}`);
  }),
  addSignal: (input) => {
    const state = get();
    if (!state.system) return null;
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
    const existingIds = new Set(state.system.signals.map((signal) => signal.id));
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
      if (!current.system) return current;
      const system = structuredClone(current.system);
      system.signals.push(signal);
      return historyPatch(current, {
        system,
        selectedItem: null,
        selectedHarnessBundle: null,
        mutationError: null,
        isDirty: true,
      }, `signal:${signalId}:add`);
    });
    return signalId;
  },
  addSignalPropertyDefinition: (input) => {
    const state = get();
    if (!state.system) return null;
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
        ...state.system.signalPropertyDefinitions.map((definition) => definition.key),
      ],
    );
    let key = keyBase;
    let keySuffix = 2;
    while (existingKeys.has(key)) {
      key = `${keyBase}_${keySuffix}`;
      keySuffix += 1;
    }

    const existingIds = new Set([
      ...state.system.hierarchy.map((item) => item.id),
      ...state.system.connectors.map((item) => item.id),
      ...state.system.branchPoints.map((item) => item.id),
      ...state.system.paths.map((item) => item.id),
      ...state.system.signals.map((item) => item.id),
      ...state.system.signalPropertyDefinitions.map((item) => item.id),
    ]);
    const idBase = `signal_property_${key}`;
    let id = idBase;
    let idSuffix = 2;
    while (existingIds.has(id)) {
      id = `${idBase}_${idSuffix}`;
      idSuffix += 1;
    }

    const existingValues = state.system.signals
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
      if (!current.system) return current;
      const system = structuredClone(current.system);
      system.signalPropertyDefinitions.push(definition);
      return historyPatch(current, {
        system,
        mutationError: null,
        isDirty: true,
      }, `signal-property:${id}:add`);
    });
    return id;
  },
  updateSignalPropertyDefinition: (id, patch) => set((state) => {
    if (!state.system) return state;
    const current = state.system.signalPropertyDefinitions.find(
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
      const inUse = state.system.signals
        .map((signal) => signal.properties[current.key]?.trim())
        .filter((value): value is string => !!value);
      options = Array.from(new Set([...requested, ...inUse]));
    }

    const system = structuredClone(state.system);
    const definition = system.signalPropertyDefinitions.find((item) => item.id === id)!;
    definition.name = name;
    definition.options = options;
    return historyPatch(state, {
      system,
      mutationError: null,
      isDirty: true,
    }, `signal-property:${id}:update`);
  }),
  deleteSignalPropertyDefinition: (id) => set((state) => {
    if (!state.system) return state;
    const current = state.system.signalPropertyDefinitions.find(
      (definition) => definition.id === id,
    );
    if (!current) return state;
    const system = structuredClone(state.system);
    system.signalPropertyDefinitions = system.signalPropertyDefinitions.filter(
      (definition) => definition.id !== id,
    );
    for (const signal of system.signals) delete signal.properties[current.key];
    return historyPatch(state, {
      system,
      mutationError: null,
      isDirty: true,
    }, `signal-property:${id}:delete`);
  }),
  addEnclosure: (input) => {
    const state = get();
    if (!state.system) return null;
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
      const parent = state.system.hierarchy.find((item) => item.id === input.parent);
      if (parent?.kind !== 'enclosure') {
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
    const prefix = input.kind === 'enclosure' ? 'enc' : 'dev';
    const baseId = `${prefix}_${slug || 'new'}`;
    const existingIds = new Set([
      ...state.system.hierarchy.map((item) => item.id),
      ...state.system.connectors.map((item) => item.id),
      ...state.system.branchPoints.map((item) => item.id),
      ...state.system.paths.map((item) => item.id),
      ...state.system.signals.map((item) => item.id),
    ]);
    let enclosureId = baseId;
    let suffix = 2;
    while (existingIds.has(enclosureId)) {
      enclosureId = `${baseId}_${suffix}`;
      suffix += 1;
    }

    const enclosure: HierarchyEntity = {
      id: enclosureId,
      name,
      parent: input.parent,
      kind: input.kind,
      tags: [],
      properties: {},
    };

    set((prev) => {
      if (!prev.system) return prev;
      const system = structuredClone(prev.system);
      system.hierarchy.push(enclosure);
      return historyPatch(prev, {
        system,
        selectedItem: { type: 'enclosure', id: enclosureId },
        selectedHarnessBundle: null,
        selectedTextBoxId: null,
        selectedImageId: null,
        mutationError: null,
        isDirty: true,
      }, `enclosure:${enclosureId}:add`);
    });

    return enclosureId;
  },
  addConnector: (parentId) => {
    const state = get();
    if (!state.system) return null;
    const parent = state.system.hierarchy.find((item) => item.id === parentId);
    if (!parent) return null;

    // Ownership is entirely via `parent`. On save, sheet split places the
    // connector on the nearest sheet-owning ancestor of that parent. Do not
    // mark `derived` or invent SheetBoundaryPorts here — those are computed from
    // cross-sheet path usage when writing.
    const isBulkhead = parent.kind === 'enclosure';
    const genericDefaults = state.connectorLibrary?.connector_types.find(
      (type) => type.id === GENERIC_MULTIPIN_TYPE_ID,
    )?.default_properties ?? {};

    const existingIds = new Set(state.system.connectors.map((item) => item.id));
    let n = state.system.connectors.length + 1;
    let connectorId = `con_${String(n).padStart(3, '0')}`;
    while (existingIds.has(connectorId)) {
      n += 1;
      connectorId = `con_${String(n).padStart(3, '0')}`;
    }

    const siblingCount = state.system.connectors.filter((item) => item.parent === parentId).length;
    const nameIndex = siblingCount + 1;
    const baseName = isBulkhead ? 'New Bulkhead' : 'New Connector';
    const siblingNames = new Set(
      state.system.connectors.filter((item) => item.parent === parentId).map((item) => item.name),
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
      ...(isBulkhead ? { mounting: 'bulkhead' as const } : {}),
      pin_count: 1,
      tags: isBulkhead ? ['zone:bulkhead'] : [],
      properties: { ...genericDefaults },
    };

    set((prev) => {
      if (!prev.system) return prev;
      const system = structuredClone(prev.system);
      system.connectors.push(connector);

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
        const mutable = system.connectors.find((item) => item.id === connectorId);
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
        system,
        subsystems,
        portLayouts,
        selectedItem: { type: 'connector', id: connectorId },
        selectedHarnessBundle: null,
        selectedTextBoxId: null,
        selectedImageId: null,
        isDirty: true,
      }, `connector:${connectorId}:add`);
    });

    return connectorId;
  },
  addInlineConnector: (input) => {
    const state = get();
    if (!state.system) return null;
    if (state.collabAvailable && !state.session.isEditor) {
      set({ mutationError: 'Log in to edit' });
      return null;
    }
    if (input.parent !== null) {
      const parent = state.system.hierarchy.find(
        (candidate) => candidate.id === input.parent,
      );
      if (parent?.kind !== 'enclosure') {
        set({ mutationError: 'Inline connectors can only float at root or inside an enclosure.' });
        return null;
      }
    }

    const connectorId = nextConnectorId(state.system);
    const genericDefaults = state.connectorLibrary?.connector_types.find(
      (type) => type.id === GENERIC_MULTIPIN_TYPE_ID,
    )?.default_properties ?? {};
    const connector: Connector = {
      id: connectorId,
      name: nextInlineConnectorName(state.system, input.parent),
      parent: input.parent,
      connector_type: GENERIC_MULTIPIN_TYPE_ID,
      mounting: 'inline',
      pin_count: 1,
      tags: [],
      properties: { ...genericDefaults },
    };
    const withConnector = structuredClone(state.system);
    withConnector.connectors.push(connector);
    const insertion = input.bundle
      ? insertInlineConnectorIntoSystem(
          withConnector,
          connectorId,
          input.bundle,
          state.connectorLibrary,
        )
      : { system: withConnector };
    if (!insertion.system) {
      set({ mutationError: insertion.error ?? 'Could not insert the inline connector.' });
      return null;
    }

    const presentation = input.bundle
      ? replaceBundlePresentationForInline(
          state.waypointLayouts,
          state.sharedAnchors,
          state.routeStyleLayouts,
          input.bundle.id,
          connectorId,
          input.bundleLayout,
        )
      : {
          waypointLayouts: state.waypointLayouts,
          sharedAnchors: state.sharedAnchors,
        };
    const manufacturing = input.bundle
      ? pruneReplacedManufacturingBundles(
          state.manufacturing,
          state.system,
          insertion.system,
          state.connectorLibrary,
          input.bundle.pathIds,
        )
      : state.manufacturing;
    set((current) => historyPatch(current, {
      system: insertion.system!,
      manufacturing,
      freePortLayouts: {
        ...current.freePortLayouts,
        [connectorId]: input.position,
      },
      ...presentation,
      selectedItem: { type: 'connector', id: connectorId },
      selectedHarnessBundle: null,
      selectedTextBoxId: null,
      selectedImageId: null,
      mutationError: null,
      isDirty: true,
    }, `connector:${connectorId}:add-inline`));
    return connectorId;
  },
  insertInlineConnectorOnBundle: (connectorId, bundle, position, bundleLayout) => {
    const state = get();
    if (!state.system) return false;
    if (state.collabAvailable && !state.session.isEditor) {
      set({ mutationError: 'Log in to edit' });
      return false;
    }
    const insertion = insertInlineConnectorIntoSystem(
      state.system,
      connectorId,
      bundle,
      state.connectorLibrary,
    );
    if (!insertion.system) {
      set({ mutationError: insertion.error ?? 'Could not populate the inline connector.' });
      return false;
    }
    const presentation = replaceBundlePresentationForInline(
      state.waypointLayouts,
      state.sharedAnchors,
      state.routeStyleLayouts,
      bundle.id,
      connectorId,
      bundleLayout,
    );
    const manufacturing = pruneReplacedManufacturingBundles(
      state.manufacturing,
      state.system,
      insertion.system,
      state.connectorLibrary,
      bundle.pathIds,
    );
    set((current) => historyPatch(current, {
      system: insertion.system!,
      manufacturing,
      freePortLayouts: {
        ...current.freePortLayouts,
        [connectorId]: position,
      },
      ...presentation,
      selectedItem: { type: 'connector', id: connectorId },
      selectedHarnessBundle: null,
      selectedTextBoxId: null,
      selectedImageId: null,
      mutationError: null,
      isDirty: true,
    }, `connector:${connectorId}:insert-inline`));
    return true;
  },
  moveHierarchyEntity: (type, id, newParentId, beforeId = null) => {
    const state = get();
    if (!state.system) return false;
    if (state.collabAvailable && !state.session.isEditor) {
      set({ mutationError: 'Log in to edit' });
      return false;
    }
    if (
      type === 'connector'
      && isInlineConnector(state.system, id)
      && newParentId !== null
      && state.system.hierarchy.find((candidate) => candidate.id === newParentId)?.kind !== 'enclosure'
    ) {
      set({ mutationError: 'Inline connectors can only float at root or inside an enclosure.' });
      return false;
    }
    try {
      const system = relocateHierarchyEntity(state.system, type, id, newParentId, beforeId ?? null);
      if (system === state.system) return true;
      set((prev) => historyPatch(prev, {
        system,
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
    if (!state.system) return state;
    const libraryType = state.connectorLibrary?.connector_types.find((item) => item.id === typeId);
    if (!libraryType) {
      return { mutationError: `Unknown connector type '${typeId}'.` };
    }
    const system = structuredClone(state.system);
    const connector = system.connectors.find((item) => item.id === connectorId);
    if (!connector) return state;
    const maxUsedPin = Math.max(
      0,
      ...getConnectorOccupancy(system, connectorId).map((entry) => entry.pinNumber),
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
      { system, isDirty: true, mutationError: null },
      `connector:${connectorId}:type`,
    );
  }),
  setConnectorKeying: (connectorId, keying) => set((state) => {
    if (!state.system) return state;
    const system = structuredClone(state.system);
    const connector = system.connectors.find((item) => item.id === connectorId);
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
      { system, isDirty: true, mutationError: null },
      `connector:${connectorId}:keying`,
    );
  }),
  addConnectorCavity: (connectorId) => set((state) => {
    if (!state.system) return state;
    const system = structuredClone(state.system);
    const connector = system.connectors.find((item) => item.id === connectorId);
    if (!connector) return state;
    const type = state.connectorLibrary?.connector_types.find(
      (item) => item.id === connector.connector_type,
    );
    const current = getEffectivePinCount(connector, type);
    const next = getNextConnectorPinCount(type, current);
    if (next === current) return state;
    applyConnectorPinCount(connector, type, next);
    normalizeConnectorKeying(connector, type);
    return historyPatch(state, { system, isDirty: true }, `connector:${connectorId}:add-cavity`);
  }),
  removeConnectorCavity: (connectorId) => set((state) => {
    if (!state.system) return state;
    const system = structuredClone(state.system);
    const connector = system.connectors.find((item) => item.id === connectorId);
    if (!connector) return state;
    const type = state.connectorLibrary?.connector_types.find(
      (item) => item.id === connector.connector_type,
    );
    const current = getEffectivePinCount(connector, type);
    const maxUsedPin = Math.max(
      0,
      ...getConnectorOccupancy(system, connectorId).map((entry) => entry.pinNumber),
    );
    const next = getPreviousConnectorPinCount(type, current, maxUsedPin);
    if (next === current) return state;
    applyConnectorPinCount(connector, type, next);
    normalizeConnectorKeying(connector, type);
    return historyPatch(state, { system, isDirty: true }, `connector:${connectorId}:remove-cavity`);
  }),
  renameEntity: (type, id, name) => set((state) => {
    if (!state.system) return state;
    try {
      const system = renameSystemEntity(state.system, type, id, name);
      return system === state.system
        ? state
        : historyPatch(
            state,
            { system, isDirty: true, mutationError: null },
            `rename:${type}:${id}`,
          );
    } catch (error) {
      return { mutationError: error instanceof Error ? error.message : 'Rename failed.' };
    }
  }),
  updateSignalName: (signalId, name) => get().renameEntity('signal', signalId, name),
  updateSignalProperty: (signalId, key, value) => set((state) => {
    if (!state.system) return state;
    const system = structuredClone(state.system);
    const signal = system.signals.find((item) => item.id === signalId);
    if (signal) {
      if (value === '') delete signal.properties[key];
      else signal.properties[key] = value;
    }
    return historyPatch(
      state,
      { system, isDirty: true },
      `signal:${signalId}:property:${key}`,
    );
  }),
  updatePathSignal: (pathId, signalId) => set((state) => {
    if (!state.system) return state;
    if (signalId && !state.system.signals.some((signal) => signal.id === signalId)) {
      return { mutationError: `Cannot assign missing signal '${signalId}'.` };
    }

    const system = structuredClone(state.system);
    const path = system.paths.find((item) => item.id === pathId);
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
      { system, isDirty: true, mutationError: null },
      `path:${pathId}:signal`,
    );
  }),
  updatePathProperty: (pathId, key, value) => set((state) => {
    if (!state.system) return state;
    const system = structuredClone(state.system);
    const path = system.paths.find((item) => item.id === pathId);
    if (path) {
      path.properties ??= {};
      if (value === '') delete path.properties[key];
      else path.properties[key] = value;
      // Keep wire_color as the canonical key; drop legacy `color` whenever either changes.
      if (key === 'wire_color') delete path.properties.color;
    }
    return historyPatch(
      state,
      { system, isDirty: true },
      `path:${pathId}:property:${key}`,
    );
  }),
  updateConnectorPathsGauge: (connectorId, gauge, side = 'both') => set((state) => {
    if (!state.system) return state;
    const trimmed = gauge.trim();
    const system = structuredClone(state.system);
    const targets = getPathsTouchingConnector(system, connectorId, side);
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
          { system, isDirty: true, mutationError: null },
          `connector:${connectorId}:paths-gauge:${side}`,
        )
      : state;
  }),
  updatePathSegmentLength: (pathId, segmentIndex, lengthMm) => set((state) => {
    if (!state.system) return state;
    if (lengthMm !== undefined && (!Number.isFinite(lengthMm) || lengthMm < 0)) {
      return { mutationError: 'Stretch length must be a non-negative number.' };
    }

    const currentPath = state.system.paths.find((item) => item.id === pathId);
    if (!currentPath || !currentPath.nodes[segmentIndex + 1]) return state;
    if (getPathSegmentMeasurement(currentPath, segmentIndex)?.length_mm === lengthMm) return state;

    const system = structuredClone(state.system);
    const path = system.paths.find((item) => item.id === pathId)!;
    setPathSegmentLength(path, segmentIndex, lengthMm);

    return historyPatch(
      state,
      { system, isDirty: true, mutationError: null },
      `path:${pathId}:segment:${segmentIndex}:length`,
    );
  }),
  updatePathSegmentLengths: (updates) => set((state) => {
    if (!state.system || updates.length === 0) return state;
    for (const update of updates) {
      if (update.lengthMm !== undefined && (!Number.isFinite(update.lengthMm) || update.lengthMm < 0)) {
        return { mutationError: 'Stretch length must be a non-negative number.' };
      }
    }

    const system = structuredClone(state.system);
    let changed = false;
    for (const update of updates) {
      const path = system.paths.find((item) => item.id === update.pathId);
      if (!path || !path.nodes[update.wireIndex + 1]) continue;
      changed = setPathSegmentLength(path, update.wireIndex, update.lengthMm) || changed;
    }
    return changed
      ? historyPatch(
          state,
          { system, isDirty: true, mutationError: null },
          `paths:${updates.map((update) => update.pathId).sort().join(',')}:segment-lengths`,
        )
      : state;
  }),
  updatePathSpanLengths: (updates) => set((state) => {
    if (!state.system || updates.length === 0) return state;
    for (const update of updates) {
      if (update.lengthMm !== undefined && (!Number.isFinite(update.lengthMm) || update.lengthMm < 0)) {
        return { mutationError: 'Stretch length must be a non-negative number.' };
      }
    }

    const system = structuredClone(state.system);
    let changed = false;
    for (const update of updates) {
      const path = system.paths.find((item) => item.id === update.pathId);
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
          { system, isDirty: true, mutationError: null },
          `paths:${updates.map((update) => update.pathId).sort().join(',')}:span-lengths`,
        )
      : state;
  }),
  updateConnectorPairSegmentLengths: (pathId, segmentIndex, lengthMm) => set((state) => {
    if (!state.system) return state;
    if (!Number.isFinite(lengthMm) || lengthMm < 0) {
      return { mutationError: 'Stretch length must be a non-negative number.' };
    }

    const currentPath = state.system.paths.find((item) => item.id === pathId);
    const from = currentPath?.nodes[segmentIndex];
    const to = currentPath?.nodes[segmentIndex + 1];
    if (!currentPath || !from || !to) return state;
    if (from.kind !== 'connector' || to.kind !== 'connector') {
      const system = structuredClone(state.system);
      const path = system.paths.find((item) => item.id === pathId)!;
      return setPathSegmentLength(path, segmentIndex, lengthMm)
        ? historyPatch(
            state,
            { system, isDirty: true, mutationError: null },
            `path:${pathId}:segment:${segmentIndex}:pair-length`,
          )
        : state;
    }

    const system = structuredClone(state.system);
    const matches = getConnectorPairSegments(system, from.connector_id, to.connector_id);
    let changed = false;
    for (const match of matches) {
      changed = setPathSegmentLength(match.path, match.wireIndex, lengthMm) || changed;
    }
    return changed
      ? historyPatch(
          state,
          { system, isDirty: true, mutationError: null },
          `path:${pathId}:segment:${segmentIndex}:pair-length`,
        )
      : state;
  }),
  updateHarnessBundleWireLengths: (bundleId, pathIds, lengthMm) => set((state) => {
    if (!state.system) return state;
    if (lengthMm !== undefined && (!Number.isFinite(lengthMm) || lengthMm < 0)) {
      return { mutationError: 'Stretch length must be a non-negative number.' };
    }
    if (!bundleId || pathIds.length === 0) return state;

    const system = structuredClone(state.system);
    const matches = getHarnessBundleWires(system, bundleId, pathIds);
    let changed = false;
    for (const match of matches) {
      changed = setPathSegmentLength(match.path, match.wireIndex, lengthMm) || changed;
    }
    return changed
      ? historyPatch(
          state,
          { system, isDirty: true, mutationError: null },
          `bundle:${bundleId}:length`,
        )
      : state;
  }),
  setMutationError: (message) => set({ mutationError: message }),
  resetForSystemSwitch: () => set(trustedDocumentPatch({
    system: null,
    serverSystem: null,
    nodeLayouts: {},
    portLayouts: {},
    sizeLayouts: {},
    freePortLayouts: {},
    imageLayouts: {},
    connectorTypeSizes: {},
    textBoxLayouts: {},
    waypointLayouts: {},
    sharedAnchors: {},
    branchPointLayouts: {},
    rotationLayouts: {},
    routeStyleLayouts: {},
    viewRouteStyleLayouts: {},
    editingSurface: 'hierarchy',
    subsystems: {},
    activeSubsystemId: null,
    mutationError: null,
    undoStack: [],
    redoStack: [],
    selectedItem: null,
    selectedHarnessBundle: null,
    selectedTextBoxId: null,
    selectedImageId: null,
    revealRequest: null,
    openEnclosureId: null,
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

  loadSystem: (data) => set((state) => {
    const system = normalizeSystemDocument(data);
    const availableSystems = system.name
      ? state.availableSystems.map((item) => (
        item.id === state.activeSystemName
          ? { ...item, name: system.name as string }
          : item
      ))
      : state.availableSystems;
    const patch = {
      system: system,
      serverSystem: structuredClone(system),
      availableSystems,
      isDirty: false,
    };
    if (!state.system) return trustedDocumentPatch(patch);
    const changedIds = changedSystemEntityIds(diffSystem(state.system, system)).sort();
    return trustedDocumentPatch(historyPatch(
      state,
      patch,
      `server:system:${changedIds.join(',') || 'metadata'}`,
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
    sameSideBundleIds,
  ) => set((state) => historyPatch(state, {
    manufacturing: assignManufacturingEndpointGender(
      state.manufacturing,
      bundleId,
      connectorId,
      gender,
      mateBundleIds,
      sameSideBundleIds,
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
  loadImageLayouts: (images, backgrounds) =>
    set((state) => {
      const imageLayouts = migrateCanvasImages(images, backgrounds);
      return trustedDocumentPatch({
        imageLayouts,
        serverLayouts: {
          ...state.serverLayouts,
          images: structuredClone(imageLayouts),
          backgrounds: {},
        },
      });
    }),
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
  loadSharedAnchorLayouts: (sharedAnchors) => set((state) => trustedDocumentPatch({
    sharedAnchors,
    serverLayouts: { ...state.serverLayouts, sharedAnchors: structuredClone(sharedAnchors) },
  })),
  loadBranchPointLayouts: (layouts) => set((state) => trustedDocumentPatch({
    branchPointLayouts: layouts,
    serverLayouts: { ...state.serverLayouts, branchPoints: structuredClone(layouts) },
  })),
  loadRotationLayouts: (rotations) => set((state) => trustedDocumentPatch({
    rotationLayouts: rotations,
    serverLayouts: { ...state.serverLayouts, rotations: structuredClone(rotations) },
  })),
  loadRouteStyleLayouts: (styles) => set((state) => trustedDocumentPatch({
    routeStyleLayouts: normalizeRouteStyleMap(styles),
    serverLayouts: {
      ...state.serverLayouts,
      routeStyles: structuredClone(normalizeRouteStyleMap(styles)),
    },
  })),
  loadViewRouteStyleLayouts: (styles) => set((state) => trustedDocumentPatch({
    viewRouteStyleLayouts: normalizeRouteStyleMap(styles),
    serverLayouts: {
      ...state.serverLayouts,
      viewRouteStyles: structuredClone(normalizeRouteStyleMap(styles)),
    },
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
      const system = state.system;

      if (
        state.editingSurface === 'subsystem' &&
        state.activeSubsystemId &&
        system
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
          const connectors = system.connectors.filter((connector) =>
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
            const occupancy = getConnectorOccupancy(state.system!, connector.id);
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

          const parentEnclosureId = system.hierarchy.find(
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

      if (!system) {
        return historyPatch(
          state,
          { rotationLayouts, isDirty: true },
          `enclosure:${enclosureId}:rotate`,
        );
      }

      const oldSize = state.sizeLayouts[enclosureId] ?? { w: 220, h: 180 };
      const connectors = system.connectors.filter(
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
        const occupancy = getConnectorOccupancy(system, connector.id);
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

  addImage: (x, y, filename, options) => {
    const id = `img_${Date.now()}`;
    set((state) => {
      const contextKey = canvasImageContextKey(
        state.editingSurface,
        state.openEnclosureId,
        state.activeSubsystemId,
      );
      const name = nextImageName(
        Object.values(state.imageLayouts)
          .filter((img) => imageMatchesContext(img.contextKey, contextKey))
          .map((img) => img.name),
      );
      return historyPatch(state, {
        imageLayouts: {
          ...state.imageLayouts,
          [id]: {
            id,
            contextKey,
            image: filename,
            name,
            x,
            y,
            w: options?.w ?? 480,
            h: options?.h ?? 320,
            locked: false,
            layer: 'background',
          },
        },
        selectedImageId: id,
        selectedTextBoxId: null,
        selectedItem: null,
        selectedHarnessBundle: null,
      }, `image:${id}:add`);
    });
  },
  updateImage: (id, patch) =>
    set((state) => {
      const prev = state.imageLayouts[id];
      if (!prev) return state;
      return historyPatch(state, {
        imageLayouts: { ...state.imageLayouts, [id]: { ...prev, ...patch } },
      }, `image:${id}:${Object.keys(patch).sort().join(',')}`);
    }),
  removeImage: (id) =>
    set((state) => {
      const next = { ...state.imageLayouts };
      delete next[id];
      return historyPatch(state, {
        imageLayouts: next,
        selectedImageId: state.selectedImageId === id ? null : state.selectedImageId,
      }, `image:${id}:remove`);
    }),
  selectImage: (id) => set((state) => {
    const img = id ? state.imageLayouts[id] : undefined;
    const view = img ? viewFromImageContextKey(img.contextKey) : null;
    return {
      selectedImageId: id,
      selectedTextBoxId: null,
      selectedItem: null,
      selectedHarnessBundle: null,
      inspectorDismissed: false,
      revealRequest: null,
      ...(id && view
        ? {
          appView: 'canvas' as const,
          editingSurface: view.editingSurface,
          ...(view.editingSurface === 'subsystem' && view.activeSubsystemId
            ? { activeSubsystemId: view.activeSubsystemId }
            : { openEnclosureId: view.openEnclosureId }),
        }
        : {}),
    };
  }),

  addTextBox: (x, y, options) => {
    const id = `tb_${Date.now()}`;
    set((state) => historyPatch(state, {
      textBoxLayouts: {
        ...state.textBoxLayouts,
        [id]: {
          id,
          contextKey: state.openEnclosureId ?? 'graph',
          x,
          y,
          w: options?.w ?? 220,
          h: options?.h ?? 110,
          text: 'Text',
          bgColor: '#1e293b',
          textColor: '#f8fafc',
          fontSize: 28,
          fontFamily: 'sans' as TextBoxFontFamily,
          fontWeight: 'bold' as TextBoxFontWeight,
          textAlign: 'center' as TextBoxTextAlign,
          borderColor: '#4b5563',
          borderWidth: 0,
          borderRadius: 4,
          opacity: 1,
          padding: 10,
          autoFit: true,
          ...(options?.parentId ? { parentId: options.parentId } : {}),
        },
      },
      selectedTextBoxId: id,
      selectedImageId: null,
      selectedItem: null,
      selectedHarnessBundle: null,
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
  selectTextBox: (id) => set((state) => {
    const tb = id ? state.textBoxLayouts[id] : undefined;
    const contextKey = tb?.contextKey;
    return {
      selectedTextBoxId: id,
      selectedImageId: null,
      selectedItem: null,
      selectedHarnessBundle: null,
      inspectorDismissed: false,
      revealRequest: null,
      ...(id && state.editingSurface === 'hierarchy' && contextKey && !tb?.parentId
        ? { openEnclosureId: contextKey === 'graph' ? null : contextKey }
        : {}),
    };
  }),

  selectItem: (item) => set({
    selectedItem: item,
    selectedHarnessBundle: null,
    selectedTextBoxId: null,
    selectedImageId: null,
    inspectorDismissed: false,
    revealRequest: null,
  }),
  revealItem: (item) => set((state) => {
    const requestId = (state.revealRequestSequence ?? 0) + 1;
    const openEnclosureId =
      state.editingSurface === 'hierarchy' && state.system
        ? getEntityRevealContext(state.system, item, state.openEnclosureId)
        : state.openEnclosureId;
    return {
      selectedItem: item,
      selectedHarnessBundle: null,
      selectedTextBoxId: null,
      selectedImageId: null,
      inspectorDismissed: false,
      revealRequest: { item, requestId },
      revealRequestSequence: requestId,
      openEnclosureId,
    };
  }),
  setNodeExpanded: (nodeId, expanded) =>
    set((state) => {
      const isExpanded = state.expandedNodes.has(nodeId);
      if (expanded === isExpanded) return state;
      const next = new Set(state.expandedNodes);
      const expandedSizeOverrides = { ...state.expandedSizeOverrides };
      if (expanded) {
        next.add(nodeId);
      } else {
        next.delete(nodeId);
        delete expandedSizeOverrides[nodeId];
      }
      return { expandedNodes: next, expandedSizeOverrides };
    }),
  toggleNodeExpanded: (nodeId) => {
    const expanded = !get().expandedNodes.has(nodeId);
    get().setNodeExpanded(nodeId, expanded);
  },
  updateExpandedNodeSize: (nodeId, w, h) =>
    set((state) => ({
      expandedSizeOverrides: { ...state.expandedSizeOverrides, [nodeId]: { w, h } },
    })),

  updateNodePosition: (nodeId, x, y) => set((state) => historyPatch(state, {
    nodeLayouts: { ...state.nodeLayouts, [nodeId]: { x, y } },
  }, `node:${nodeId}:position`)),
  resizeHierarchyEntityLayout: (nodeId, previousLayout, layout) =>
    set((state) => {
      const system = state.system;
      const entity = system?.hierarchy.find((candidate) => candidate.id === nodeId);
      if (!system || !entity) {
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

      const directConnectors = system.connectors.filter(
        (connector) =>
          connector.parent === nodeId
          && (entity.kind === 'device' || isBulkheadConnector(system, connector.id)),
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
          wallMounted: isBulkheadConnector(system, connector.id),
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
  updateBranchPointLayout: (contextKey, branchPointId, x, y) =>
    set((state) => historyPatch(state, {
      branchPointLayouts: {
        ...state.branchPointLayouts,
        [contextKey]: {
          ...(state.branchPointLayouts[contextKey] ?? {}),
          [branchPointId]: { x, y },
        },
      },
    }, `branchPoint:${branchPointId}:position`)),

  setOpenEnclosure: (encId) => set({
    openEnclosureId: encId,
    selectedItem: null,
    selectedHarnessBundle: null,
    selectedTextBoxId: null,
    selectedImageId: null,
    revealRequest: null,
  }),
  setSelectedHarnessBundle: (bundle) => set({
    selectedHarnessBundle: bundle,
    selectedItem: null,
    selectedTextBoxId: null,
    selectedImageId: null,
    inspectorDismissed: false,
    revealRequest: null,
  }),
  dismissInspector: () => set({ inspectorDismissed: true }),

  setEdgeWaypoints: (edgeId, waypoints) => set((state) => {
    const layoutId = getHarnessBundleLayoutId(edgeId);
    return historyPatch(state, {
      waypointLayouts: { ...state.waypointLayouts, [layoutId]: waypoints },
    }, `edge:${layoutId}:waypoints`);
  }),
  deleteSelectedRoutePoint: () => {
    const state = get();
    const bundle = state.selectedHarnessBundle;
    const routePoint = bundle?.routePoint;
    if (!bundle || routePoint == null) return false;
    const layoutId = getHarnessBundleLayoutId(bundle.id);
    const waypoints = getHarnessBundleLayoutValue(state.waypointLayouts, layoutId) ?? [];
    const item = waypoints[routePoint.index];
    if (!item) {
      set({ selectedHarnessBundle: { id: bundle.id, pathIds: bundle.pathIds } });
      return false;
    }
    if ('sharedAnchorId' in item) {
      const sharedAnchor = state.sharedAnchors[item.sharedAnchorId];
      if (sharedAnchor && sharedAnchor.memberEdgeIds.length <= 1) {
        get().deleteSharedAnchor(item.sharedAnchorId);
      } else {
        get().unlinkEdgeFromSharedAnchor(item.sharedAnchorId, bundle.id);
      }
    } else {
      get().setEdgeWaypoints(
        bundle.id,
        waypoints.filter((_, index) => index !== routePoint.index),
      );
    }
    const next = get().selectedHarnessBundle;
    if (next?.id === bundle.id && next.routePoint) {
      set({ selectedHarnessBundle: { id: next.id, pathIds: next.pathIds } });
    }
    return true;
  },
  setEdgeRouteStyle: (edgeId, style) => set((state) => {
    const layoutId = getHarnessBundleLayoutId(edgeId);
    if (state.routeStyleLayouts[layoutId] === style) return state;
    return historyPatch(state, {
      routeStyleLayouts: { ...state.routeStyleLayouts, [layoutId]: style },
    }, `edge:${layoutId}:route-style`);
  }),
  applyViewRouteStyle: (style, extraEdgeIds = []) => set((state) => {
    const viewKey = routeViewKey(state.editingSurface, state.activeSubsystemId);
    const routeStyleLayouts = { ...state.routeStyleLayouts };
    for (const [edgeId, value] of Object.entries(routeStyleLayouts)) {
      if (edgeBelongsToRouteView(edgeId, viewKey) && value !== style) {
        routeStyleLayouts[edgeId] = style;
      }
    }
    for (const edgeId of extraEdgeIds) {
      routeStyleLayouts[getHarnessBundleLayoutId(edgeId)] = style;
    }
    if (state.selectedHarnessBundle) {
      routeStyleLayouts[getHarnessBundleLayoutId(state.selectedHarnessBundle.id)] = style;
    }
    return historyPatch(state, {
      routeStyleLayouts,
      viewRouteStyleLayouts: { ...state.viewRouteStyleLayouts, [viewKey]: style },
    }, `view:${viewKey}:route-style`);
  }),
  createSharedAnchor: (pos, edgeId, waypointIndex, options) => {
    const id = `sa_${crypto.randomUUID()}`;
    set((state) => {
      let document = createVisualSharedAnchor(
        sharedAnchorDocumentFromState(state),
        pos,
        edgeId,
        waypointIndex,
        id,
      );
      if (options?.mode === 'branch') {
        const promoted = promoteSharedAnchorToBranchPoint(document, id);
        if (!('error' in promoted)) document = promoted.document;
      }
      return historyPatch(state, patchFromSharedAnchorDocument(document), `sharedAnchor:${id}:create`);
    });
    return id;
  },
  joinBundlesAtDrop: (request) => {
    let createdId: string | null = null;
    set((state) => {
      const result = applyBundleJoin(sharedAnchorDocumentFromState(state), request);
      if ('error' in result) {
        return { mutationError: result.error };
      }
      createdId = result.sharedAnchorId;
      return historyPatch(
        state,
        { ...patchFromSharedAnchorDocument(result.document), mutationError: null },
        `sharedAnchor:${result.sharedAnchorId}:join:${request.kind}`,
      );
    });
    return createdId;
  },
  convertSharedAnchorToBranchPoint: (sharedAnchorId) => {
    let branchPointId: string | null = null;
    set((state) => {
      const result = promoteSharedAnchorToBranchPoint(
        sharedAnchorDocumentFromState(state),
        sharedAnchorId,
      );
      if ('error' in result) {
        return { mutationError: result.error };
      }
      branchPointId = result.branchPointId;
      return historyPatch(
        state,
        {
          ...patchFromSharedAnchorDocument(result.document),
          selectedItem: { type: 'branchPoint', id: result.branchPointId },
          selectedHarnessBundle: null,
          mutationError: null,
        },
        `sharedAnchor:${sharedAnchorId}:promote`,
      );
    });
    return branchPointId;
  },
  convertBranchPointToSharedAnchor: (branchPointId) => {
    let sharedAnchorId: string | null = null;
    set((state) => {
      const result = demoteBranchPointToSharedAnchor(
        sharedAnchorDocumentFromState(state),
        branchPointId,
      );
      if ('error' in result) {
        return { mutationError: result.error };
      }
      sharedAnchorId = result.sharedAnchorId;
      const memberId = result.document.sharedAnchors[result.sharedAnchorId]?.memberEdgeIds[0];
      return historyPatch(
        state,
        {
          ...patchFromSharedAnchorDocument(result.document),
          selectedItem: null,
          selectedHarnessBundle: memberId
            ? {
              id: memberId,
              pathIds: result.document.system?.paths
                .filter((path) => findPathWireForHarnessBundle(path, memberId))
                .map((path) => path.id) ?? [],
            }
            : null,
          mutationError: null,
        },
        `branchPoint:${branchPointId}:demote`,
      );
    });
    return sharedAnchorId;
  },
  branchPointToSharedAnchorBlockReason: (branchPointId) => {
    const system = get().system;
    if (!system) return 'No system is loaded.';
    return demoteBlockReason(system, branchPointId);
  },
  moveSharedAnchor: (sharedAnchorId, pos) =>
    set((state) => {
      const sharedAnchor = state.sharedAnchors[sharedAnchorId];
      if (!sharedAnchor) return state;
      return historyPatch(state, {
        sharedAnchors: {
          ...state.sharedAnchors,
          [sharedAnchorId]: { ...sharedAnchor, x: pos.x, y: pos.y },
        },
      }, `sharedAnchor:${sharedAnchorId}:position`);
    }),
  deleteSharedAnchor: (sharedAnchorId) =>
    set((state) => {
      const sharedAnchor = state.sharedAnchors[sharedAnchorId];
      if (!sharedAnchor) return state;
      const waypointLayouts = { ...state.waypointLayouts };
      for (const edgeId of sharedAnchor.memberEdgeIds) {
        const edgeWaypoints = waypointLayouts[edgeId];
        if (!edgeWaypoints) continue;
        waypointLayouts[edgeId] = edgeWaypoints.map((waypoint) =>
          'sharedAnchorId' in waypoint && waypoint.sharedAnchorId === sharedAnchorId
            ? { x: sharedAnchor.x, y: sharedAnchor.y }
            : waypoint,
        );
      }
      const nextSharedAnchors = { ...state.sharedAnchors };
      delete nextSharedAnchors[sharedAnchorId];

      // Coupled shared anchor: dissolve the BranchPoint so neighbors reconnect.
      const system = state.system;
      const branchPointId = sharedAnchor.branchPointId;
      let nextSystem = system;
      let nextBranchPointLayouts = state.branchPointLayouts;
      if (system && branchPointId) {
        nextSystem = dissolveBranchPoint(system, branchPointId);
        nextBranchPointLayouts = stripBranchPointLayouts(state.branchPointLayouts, [branchPointId]);
      }

      return historyPatch(state, {
        sharedAnchors: nextSharedAnchors,
        waypointLayouts,
        system: nextSystem,
        branchPointLayouts: nextBranchPointLayouts,
      }, `sharedAnchor:${sharedAnchorId}:delete`);
    }),
  linkEdgeToSharedAnchor: (sharedAnchorId, edgeId, insertAfterIndex) =>
    set((state) => {
      const layoutId = getHarnessBundleLayoutId(edgeId);
      const document = linkVisualOrBranchAnchor(
        sharedAnchorDocumentFromState(state),
        sharedAnchorId,
        edgeId,
        insertAfterIndex,
      );
      return historyPatch(
        state,
        patchFromSharedAnchorDocument(document),
        `sharedAnchor:${sharedAnchorId}:link:${layoutId}`,
      );
    }),
  unlinkEdgeFromSharedAnchor: (sharedAnchorId, edgeId) =>
    set((state) => {
      const layoutId = getHarnessBundleLayoutId(edgeId);
      const sharedAnchor = state.sharedAnchors[sharedAnchorId];
      if (!sharedAnchor) return state;
      const waypoints = (getHarnessBundleLayoutValue(state.waypointLayouts, layoutId) ?? []).map((waypoint) =>
        'sharedAnchorId' in waypoint && waypoint.sharedAnchorId === sharedAnchorId
          ? { x: sharedAnchor.x, y: sharedAnchor.y }
          : waypoint,
      );
      const remaining = sharedAnchor.memberEdgeIds.filter(
        (memberEdgeId) => memberEdgeId !== edgeId && memberEdgeId !== layoutId,
      );

      // When the shared anchor is coupled, drop the BranchPoint reference from any
      // path whose nodes[] still flows through this edge's endpoints around
      // the merge.  A path is only affected here if its endpoint connectors
      // on either side of the merge match this edge's bundle endpoints.
      const system = state.system;
      const branchPointId = sharedAnchor.branchPointId;
      let nextSystem = system;
      let nextBranchPointLayouts = state.branchPointLayouts;
      if (system && branchPointId) {
        const parsed = parseHarnessBundleId(layoutId);
        const updatedPaths = system.paths.map((path) => {
          if (!parsed) return path;
          const nodes = path.nodes;
          for (let i = 1; i < nodes.length - 1; i++) {
            const mid = nodes[i];
            if (mid.kind !== 'branch' || mid.branch_point_id !== branchPointId) continue;
            const prevKey = getPathNodeHarnessBundleKey(nodes[i - 1]);
            const nextKey = getPathNodeHarnessBundleKey(nodes[i + 1]);
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
          // Last edge: dissolve the BranchPoint so any remaining references reconnect.
          nextSystem = dissolveBranchPoint({ ...system, paths: updatedPaths }, branchPointId);
          nextBranchPointLayouts = stripBranchPointLayouts(state.branchPointLayouts, [branchPointId]);
        } else {
          nextSystem = { ...system, paths: updatedPaths };
        }
      }

      if (remaining.length === 0) {
        const nextSharedAnchors = { ...state.sharedAnchors };
        delete nextSharedAnchors[sharedAnchorId];
        return historyPatch(state, {
          sharedAnchors: nextSharedAnchors,
          waypointLayouts: { ...state.waypointLayouts, [layoutId]: waypoints },
          system: nextSystem,
          branchPointLayouts: nextBranchPointLayouts,
        }, `sharedAnchor:${sharedAnchorId}:unlink:${layoutId}`);
      }
      return historyPatch(state, {
        sharedAnchors: {
          ...state.sharedAnchors,
          [sharedAnchorId]: { ...sharedAnchor, memberEdgeIds: remaining },
        },
        waypointLayouts: { ...state.waypointLayouts, [layoutId]: waypoints },
        system: nextSystem,
        branchPointLayouts: nextBranchPointLayouts,
      }, `sharedAnchor:${sharedAnchorId}:unlink:${edgeId}`);
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
      if (!state.system) return state;
      const system = structuredClone(state.system);
      const enclosure = system.hierarchy.find((item) => item.id === encId);
      if (enclosure) {
        if (value === '') delete enclosure.properties[key];
        else enclosure.properties[key] = value;
      }
      return historyPatch(
        state,
        { system, isDirty: true },
        `enclosure:${encId}:property:${key}`,
      );
    }),
  updateConnectorProperty: (conId, key, value) =>
    set((state) => {
      if (!state.system) return state;
      const system = structuredClone(state.system);
      const connector = system.connectors.find((item) => item.id === conId);
      if (connector) {
        if (value === '') delete connector.properties[key];
        else connector.properties[key] = value;
      }
      return historyPatch(
        state,
        { system, isDirty: true },
        `connector:${conId}:property:${key}`,
      );
    }),
  setConnectorDotDisplay: (conId, dot) =>
    set((state) => {
      if (!state.system) return state;
      const system = structuredClone(state.system);
      const connector = system.connectors.find((item) => item.id === conId);
      if (!connector) return state;
      if (dot) connector.properties[BULKHEAD_DISPLAY_PROPERTY] = BULKHEAD_DOT_DISPLAY;
      else delete connector.properties[BULKHEAD_DISPLAY_PROPERTY];

      const sizeLayouts = { ...state.sizeLayouts };
      if (!dot) sizeLayouts[conId] = { w: 100, h: 32 };
      const subsystems = Object.fromEntries(
        Object.entries(state.subsystems).map(([subsystemId, subsystem]) => {
          const layout = subsystem.connectors[conId];
          if (!layout || dot) return [subsystemId, subsystem];
          return [
            subsystemId,
            {
              ...subsystem,
              connectors: {
                ...subsystem.connectors,
                [conId]: { ...layout, w: 96, h: 36 },
              },
            },
          ];
        }),
      );
      const expandedNodes = new Set(state.expandedNodes);
      expandedNodes.delete(conId);
      return historyPatch(state, {
        system,
        sizeLayouts,
        subsystems,
        expandedNodes,
        isDirty: true,
      }, `connector:${conId}:dot-display`);
    }),

  addTag: (entityType, entityId, tag) =>
    set((state) => {
      if (!state.system) return state;
      const system = structuredClone(state.system);
      const target = findMutableEntity(system, entityType, entityId);
      if (target && !target.tags.includes(tag)) target.tags.push(tag);
      return historyPatch(
        state,
        { system, isDirty: true },
        `${entityType}:${entityId}:tag`,
      );
    }),
  removeTag: (entityType, entityId, tag) =>
    set((state) => {
      if (!state.system) return state;
      const system = structuredClone(state.system);
      const target = findMutableEntity(system, entityType, entityId);
      if (target) target.tags = target.tags.filter((item) => item !== tag);
      return historyPatch(
        state,
        { system, isDirty: true },
        `${entityType}:${entityId}:tag`,
      );
    }),

  setSettingsOpen: (open) => set({ settingsOpen: open }),

  getAllExistingTags: () => {
    const system = get().system;
    if (!system) return [];
    const tagSet = new Set<string>();
    for (const item of [...system.hierarchy, ...system.connectors, ...system.branchPoints, ...system.paths, ...system.signals]) {
      for (const tag of item.tags) tagSet.add(tag);
    }
    return [...tagSet].sort();
  },
  findEntity: (type, id) => {
    const system = get().system;
    if (!system) return undefined;
    switch (type) {
      case 'enclosure':
        return system.hierarchy.find((item) => item.id === id);
      case 'connector':
        return system.connectors.find((item) => item.id === id);
      case 'branchPoint':
        return system.branchPoints.find((item) => item.id === id);
      case 'path':
        return system.paths.find((item) => item.id === id);
      case 'signal':
        return system.signals.find((item) => item.id === id);
      default:
        return undefined;
    }
  },
})));

function tagSystemForSubsystems(
  source: SystemData | null,
  documents: SubsystemDocument[],
): SystemData | null {
  if (!source) return null;
  const system = structuredClone(source);
  const addSystemTag = (tags: string[], subsystemId: string) => {
    const tag = `system:${subsystemId}`;
    if (!tags.includes(tag)) tags.push(tag);
  };
  for (const document of documents) {
    const enclosureMembership = new Set([
      ...Object.keys(document.enclosures),
      ...Object.keys(document.devices),
    ]);
    for (const enclosure of system.hierarchy) {
      if (enclosureMembership.has(enclosure.id)) addSystemTag(enclosure.tags, document.id);
    }
    for (const connector of system.connectors) {
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
  return system;
}

function emptyDeleteImpact(): DeleteImpact {
  return { enclosureIds: [], connectorIds: [], branchPointIds: [], pathIds: [], signalIds: [] };
}

function emptyEnclosureKindConvertImpact(fromEnclosure: boolean): EnclosureKindConvertImpact {
  return {
    fromEnclosure,
    nestedDeviceIds: [],
    nestedEnclosureIds: [],
    connectorIds: [],
    branchPointIds: [],
    pathIds: [],
  };
}

function resolveOpenEnclosureAfterConvert(
  system: SystemData,
  openEnclosureId: string | null,
  removedSpaces: ReadonlySet<string>,
): string | null {
  if (!openEnclosureId) return null;
  let current: string | null = openEnclosureId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const enclosure = system.hierarchy.find((item) => item.id === current);
    if (!enclosure) return null;
    if (!removedSpaces.has(current) && enclosure.kind === 'enclosure') return current;
    current = enclosure.parent;
  }
  return null;
}

function collectEnclosureKindConvertImpact(
  system: SystemData,
  id: string,
): EnclosureKindConvertImpact | null {
  const enclosure = system.hierarchy.find((item) => item.id === id);
  if (!enclosure) return null;
  const impact = emptyEnclosureKindConvertImpact(enclosure.kind === 'enclosure');
  if (enclosure.kind === 'device') return impact;

  const descendantIds = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of system.hierarchy) {
      if (
        candidate.parent
        && (candidate.parent === id || descendantIds.has(candidate.parent))
        && !descendantIds.has(candidate.id)
      ) {
        descendantIds.add(candidate.id);
        changed = true;
      }
    }
  }
  for (const candidate of system.hierarchy) {
    if (!descendantIds.has(candidate.id)) continue;
    if (candidate.kind === 'enclosure') impact.nestedEnclosureIds.push(candidate.id);
    else impact.nestedDeviceIds.push(candidate.id);
  }

  const connectorIds = new Set<string>();
  for (const connector of system.connectors) {
    if (
      connector.parent
      && descendantIds.has(connector.parent)
      && !isAutoBulkheadPlaceholder(connector)
    ) {
      connectorIds.add(connector.id);
    }
  }
  const branchPointIds = new Set<string>();
  for (const branchPoint of system.branchPoints) {
    if (
      branchPoint.parent === id
      || (branchPoint.parent && descendantIds.has(branchPoint.parent))
    ) {
      branchPointIds.add(branchPoint.id);
    }
  }

  const pathIds = new Set<string>();
  for (const wirePath of system.paths) {
    if (wirePath.nodes.some((node) =>
      node.kind === 'connector' && connectorIds.has(node.connector_id),
    )) {
      pathIds.add(wirePath.id);
    }
  }
  let systemAfterDissolve = system;
  for (const branchPointId of branchPointIds) {
    const beforeIds = new Set(systemAfterDissolve.paths.map((path) => path.id));
    systemAfterDissolve = dissolveBranchPoint(systemAfterDissolve, branchPointId);
    const afterIds = new Set(systemAfterDissolve.paths.map((path) => path.id));
    for (const pathId of beforeIds) {
      if (!afterIds.has(pathId)) pathIds.add(pathId);
    }
  }

  impact.connectorIds = [...connectorIds];
  impact.branchPointIds = [...branchPointIds];
  impact.pathIds = [...pathIds];
  return impact;
}

function stripBranchPointLayouts(
  layouts: BranchPointLayouts,
  branchPointIds: Iterable<string>,
): BranchPointLayouts {
  const removed = new Set(branchPointIds);
  if (removed.size === 0) return layouts;
  return Object.fromEntries(
    Object.entries(layouts).map(([ctxKey, mpMap]) => {
      const nextMap = Object.fromEntries(
        Object.entries(mpMap).filter(([branchPointId]) => !removed.has(branchPointId)),
      );
      return [ctxKey, nextMap];
    }),
  );
}

function cleanLayoutsForRemovedBranchPoints(
  state: {
    branchPointLayouts: BranchPointLayouts;
    sharedAnchors: SharedAnchorLayouts;
    waypointLayouts: WaypointLayouts;
  },
  branchPointIds: Iterable<string>,
): {
  branchPointLayouts: BranchPointLayouts;
  sharedAnchors: SharedAnchorLayouts;
  waypointLayouts: WaypointLayouts;
} {
  const removed = new Set(branchPointIds);
  if (removed.size === 0) {
    return {
      branchPointLayouts: state.branchPointLayouts,
      sharedAnchors: state.sharedAnchors,
      waypointLayouts: state.waypointLayouts,
    };
  }

  const branchPointLayouts = stripBranchPointLayouts(state.branchPointLayouts, removed);
  const sharedAnchors = { ...state.sharedAnchors };
  const waypointLayouts = { ...state.waypointLayouts };
  for (const [sharedAnchorId, sharedAnchor] of Object.entries(state.sharedAnchors)) {
    if (!sharedAnchor.branchPointId || !removed.has(sharedAnchor.branchPointId)) continue;
    for (const edgeId of sharedAnchor.memberEdgeIds) {
      const edgeWaypoints = waypointLayouts[edgeId];
      if (!edgeWaypoints) continue;
      waypointLayouts[edgeId] = edgeWaypoints.map((waypoint) =>
        'sharedAnchorId' in waypoint && waypoint.sharedAnchorId === sharedAnchorId
          ? { x: sharedAnchor.x, y: sharedAnchor.y }
          : waypoint,
      );
    }
    delete sharedAnchors[sharedAnchorId];
  }

  return { branchPointLayouts, sharedAnchors, waypointLayouts };
}

function collectDeleteImpact(
  system: SystemData,
  type: 'enclosure' | 'connector' | 'branchPoint' | 'path' | 'signal',
  id: string,
): DeleteImpact {
  const impact = emptyDeleteImpact();
  const enclosureIds = new Set<string>();
  const connectorIds = new Set<string>();
  const branchPointIds = new Set<string>();
  const pathIds = new Set<string>();

  if (type === 'enclosure') {
    enclosureIds.add(id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const enclosure of system.hierarchy) {
        if (enclosure.parent && enclosureIds.has(enclosure.parent) && !enclosureIds.has(enclosure.id)) {
          enclosureIds.add(enclosure.id);
          changed = true;
        }
      }
    }
    for (const connector of system.connectors) {
      if (connector.parent && enclosureIds.has(connector.parent)) connectorIds.add(connector.id);
    }
    for (const branchPoint of system.branchPoints) {
      if (branchPoint.parent && enclosureIds.has(branchPoint.parent)) branchPointIds.add(branchPoint.id);
    }
  } else if (type === 'connector') {
    connectorIds.add(id);
  } else if (type === 'branchPoint') {
    branchPointIds.add(id);
  } else if (type === 'path') {
    pathIds.add(id);
  }

  const dissolvesInline =
    type === 'connector' && isInlineConnector(system, id);
  // Endpoint connectors cascade their paths. A directly deleted inline
  // connector is dissolved instead; enclosure cascades retain the old behavior.
  if (!dissolvesInline) {
    for (const wirePath of system.paths) {
      if (wirePath.nodes.some((node) =>
        node.kind === 'connector' && connectorIds.has(node.connector_id),
      )) {
        pathIds.add(wirePath.id);
      }
    }
  }

  let systemAfterDissolve = dissolvesInline
    ? dissolveInlineConnector(system, id)
    : system;
  if (dissolvesInline) {
    const remainingPathIds = new Set(systemAfterDissolve.paths.map((path) => path.id));
    for (const path of system.paths) {
      if (!remainingPathIds.has(path.id)) pathIds.add(path.id);
    }
  }
  for (const branchPointId of branchPointIds) {
    const beforeIds = new Set(systemAfterDissolve.paths.map((path) => path.id));
    systemAfterDissolve = dissolveBranchPoint(systemAfterDissolve, branchPointId);
    const afterIds = new Set(systemAfterDissolve.paths.map((path) => path.id));
    for (const pathId of beforeIds) {
      if (!afterIds.has(pathId)) pathIds.add(pathId);
    }
  }

  if (type === 'signal') {
    impact.signalIds.push(id);
    const legacyTag = `signal:${id.replace(/^sig_/, '')}`;
    for (const wirePath of system.paths) {
      if (wirePath.signal_id === id || wirePath.tags.includes(legacyTag)) pathIds.add(wirePath.id);
    }
  }

  impact.enclosureIds = [...enclosureIds];
  impact.connectorIds = [...connectorIds];
  impact.branchPointIds = [...branchPointIds];
  impact.pathIds = [...pathIds];
  return impact;
}

function findMutableEntity(
  system: SystemData,
  entityType: string,
  entityId: string,
): { tags: string[] } | undefined {
  switch (entityType) {
    case 'enclosure':
      return system.hierarchy.find((item) => item.id === entityId);
    case 'connector':
      return system.connectors.find((item) => item.id === entityId);
    case 'branchPoint':
      return system.branchPoints.find((item) => item.id === entityId);
    case 'path':
      return system.paths.find((item) => item.id === entityId);
    case 'signal':
      return system.signals.find((item) => item.id === entityId);
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
  const raw = payload.full ? payload : (payload.changed ?? payload);
  return normalizeCollaborationDocument(raw);
}

function payloadTouchesInteraction(payload: SyncPayload, state: SystemStore): boolean {
  if (state.interactingEntities.size === 0) return false;
  const ids = new Set(
    [...state.interactingEntities].map((key) => key.slice(key.indexOf(':') + 1)),
  );
  if (payload.changedEntityIds && payload.changedEntityIds.length > 0) {
    return payload.changedEntityIds.some((id) => ids.has(id));
  }
  const documents = payloadDocuments(payload);
  return !!(
    documents.system
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
  const state = useSystemStore.getState();
  if (payloadTouchesInteraction(payload, state)) {
    useSystemStore.setState({
      queuedRemoteUpdates: [...state.queuedRemoteUpdates, payload],
    });
    return;
  }

  const documents = payloadDocuments(payload);
  const incomingLibrary = documents.connectorLibrary ?? documents.library;
  const libraryOnly = !!incomingLibrary
    && !documents.system
    && !documents.layouts
    && !documents.manufacturing
    && !documents.subsystems;
  const patch: Partial<SystemStore> = {
    serverRev: libraryOnly ? state.serverRev : Math.max(state.serverRev, payload.rev),
    libraryRev: Math.max(
      state.libraryRev,
      payload.libraryRev ?? (libraryOnly ? payload.rev : state.libraryRev),
    ),
  };
  let nextConflict: SyncConflict | null = null;

  if (documents.system) {
    const remote = normalizeSystemDocument(documents.system);
    if (!state.serverSystem || !state.system) {
      patch.serverSystem = remote;
      patch.system = structuredClone(remote);
    } else {
      const localDiff = diffSystem(state.serverSystem, state.system);
      patch.serverSystem = remote;
      if (isSystemDiffEmpty(localDiff)) {
        patch.system = structuredClone(remote);
      } else {
        const rebased = rebaseSystem(state.serverSystem, state.system, remote);
        if (rebased.value) {
          patch.system = rebased.value;
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
    const subsystemSystem = patch.system ?? state.system;
    patch.subsystems = Object.fromEntries(
      Object.entries(merged.live).map(([id, document]) => [
        id,
        normalizeSubsystemDocument(subsystemSystem, document),
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

  useSystemStore.setState(trustedDocumentPatch(patch));
  useSystemStore.setState({ isDirty: hasOutstandingChanges(useSystemStore.getState()) });
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
  const state = useSystemStore.getState();
  if (!state.collabAvailable || !state.session.user) return;
  lastPresenceSentAt = Date.now();
  void fetch('/api/presence', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: state.activeSystemName,
      appView: state.appView,
      editingSurface: state.editingSurface,
      openEnclosureId: state.openEnclosureId,
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
  const state = useSystemStore.getState();
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
  const next = indexPeersByEntity(peers);
  peerIndexSource = peers;
  peerIndex = next;
  return peerIndex;
}

export function usePeersForEntity(
  kind: PresenceTargetKind,
  id: string,
): PeerPresence[] {
  return useSystemStore((state) => getPeerIndex(state.peers).get(`${kind}:${id}`) ?? EMPTY_PEERS);
}

let undoStalenessInputs: readonly unknown[] = [];
let undoStalenessValue: UndoStaleness = {
  state: 'none',
  lastWriter: null,
  since: null,
};

function selectUndoStaleness(state: SystemStore): UndoStaleness {
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
  return useSystemStore(selectUndoStaleness);
}

const FAST_AUTO_SAVE_DELAY = 300;
const SLOW_AUTO_SAVE_DELAY = 1_000;
const AUTO_SAVE_ERROR_MIN_VISIBLE_MS = 15_000;
type AutoSaveType =
  | 'system'
  | 'layouts'
  | 'library'
  | 'manufacturing'
  | 'subsystem';
const ALL_AUTO_SAVE_TYPES = new Set<AutoSaveType>([
  'system',
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
  const state = useSystemStore.getState();
  const writer = state.session.user
    ? { id: state.session.user.id, displayName: state.session.user.displayName }
    : state.lastWriter;
  useSystemStore.setState({
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
  useSystemStore.getState().setMutationError(message);
}

function scheduleAutoSaveFailureClear(message: string): void {
  if (autoSaveErrorClearTimer) clearTimeout(autoSaveErrorClearTimer);
  const clearIfResolved = () => {
    autoSaveErrorClearTimer = null;
    const state = useSystemStore.getState();
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

function hasOutstandingChanges(state: SystemStore): boolean {
  if (
    state.system
    && state.serverSystem
    && !isSystemDiffEmpty(diffSystem(state.serverSystem, state.system))
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
    let state = useSystemStore.getState();
    if (!state.system) return true;
    const nameParam = `?system=${encodeURIComponent(state.activeSystemName)}`;

    if (what.has('system') && state.serverSystem) {
      const localDiff = diffSystem(state.serverSystem, state.system);
      if (!isSystemDiffEmpty(localDiff)) {
        if (state.conflict?.kind === 'system' || state.conflict?.kind === 'rebase') return false;
        const snapshot = structuredClone(state.system);
        const response = await fetch(`/api/save-system${nameParam}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Base-Rev': String(state.serverRev),
          },
          body: JSON.stringify(snapshot, null, 2),
        });
        const body = await readSaveBody(response);
        if (response.status === 409) {
          useSystemStore.setState({
            conflict: {
              kind: 'system',
              server: normalizeConflict(body, state.serverRev, state.lastWriter),
              localDiffJson: JSON.stringify(localDiff, null, 2),
            },
          });
          saved = false;
        } else if (!response.ok) {
          saved = reportSaveFailure(response, body);
        } else {
          useSystemStore.setState({ serverSystem: snapshot });
          updateConfirmedRevision(body);
        }
      }
    }

    state = useSystemStore.getState();
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
          useSystemStore.setState({
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
          useSystemStore.setState({
            serverConnectorLibrary: snapshot,
            libraryRev: typeof body.rev === 'number'
              ? Math.max(state.libraryRev, body.rev)
              : state.libraryRev,
          });
        }
      }
    }

    state = useSystemStore.getState();
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
          useSystemStore.setState({ serverLayouts: snapshot });
          updateConfirmedRevision(body);
        }
      }
    }

    state = useSystemStore.getState();
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
          useSystemStore.setState({ serverManufacturing: snapshot });
          updateConfirmedRevision(body);
        }
      }
    }

    state = useSystemStore.getState();
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
        useSystemStore.setState((current) => ({
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
        useSystemStore.setState((current) => {
          const serverSubsystems = { ...current.serverSubsystems };
          delete serverSubsystems[id];
          return { serverSubsystems };
        });
        updateConfirmedRevision(body);
      }
    }

    const current = useSystemStore.getState();
    const dirty = hasOutstandingChanges(current);
    useSystemStore.setState({ isDirty: dirty });
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
  while (hasOutstandingChanges(useSystemStore.getState())) {
    if (!(await startAutoSave(new Set(ALL_AUTO_SAVE_TYPES)))) return false;
  }
  return true;
}

export function initAutoSave(): void {
  if (autoSaveActive) return;
  autoSaveActive = true;

  useSystemStore.subscribe((state, prev) => {
    const fast = new Set<AutoSaveType>();
    const slow = new Set<AutoSaveType>();
    if (state.system !== prev.system) fast.add('system');
    if (state.connectorLibrary !== prev.connectorLibrary) fast.add('library');
    if (
      state.nodeLayouts !== prev.nodeLayouts
      || state.portLayouts !== prev.portLayouts
      || state.sizeLayouts !== prev.sizeLayouts
      || state.freePortLayouts !== prev.freePortLayouts
      || state.imageLayouts !== prev.imageLayouts
      || state.connectorTypeSizes !== prev.connectorTypeSizes
      || state.textBoxLayouts !== prev.textBoxLayouts
      || state.waypointLayouts !== prev.waypointLayouts
      || state.sharedAnchors !== prev.sharedAnchors
      || state.branchPointLayouts !== prev.branchPointLayouts
      || state.rotationLayouts !== prev.rotationLayouts
    ) slow.add('layouts');
    if (state.manufacturing !== prev.manufacturing) slow.add('manufacturing');
    if (state.subsystems !== prev.subsystems) slow.add('subsystem');

    if (fast.size > 0) scheduleAutoSave(fast, FAST_AUTO_SAVE_DELAY);
    if (slow.size > 0) scheduleAutoSave(slow, SLOW_AUTO_SAVE_DELAY);

    if (
      state.selectedItem !== prev.selectedItem
      || state.selectedTextBoxId !== prev.selectedTextBoxId
      || state.selectedImageId !== prev.selectedImageId
      || state.selectedHarnessBundle !== prev.selectedHarnessBundle
    ) {
      const focus = state.selectedItem
        ? { kind: state.selectedItem.type, id: state.selectedItem.id }
        : state.selectedTextBoxId
          ? { kind: 'textBox' as const, id: state.selectedTextBoxId }
          : state.selectedImageId
            ? { kind: 'image' as const, id: state.selectedImageId }
            : state.selectedHarnessBundle?.id
            ? { kind: 'harnessBundle' as const, id: state.selectedHarnessBundle.id }
            : state.selectedHarnessBundle?.pathIds[0]
              ? { kind: 'path' as const, id: state.selectedHarnessBundle.pathIds[0] }
            : null;
      queuePresencePublish({ focus });
    }
    if (
      state.appView !== prev.appView
      || state.editingSurface !== prev.editingSurface
      || state.openEnclosureId !== prev.openEnclosureId
      || state.activeSubsystemId !== prev.activeSubsystemId
    ) {
      queuePresencePublish({
        appView: state.appView,
        editingSurface: state.editingSurface,
        openEnclosureId: state.openEnclosureId,
        activeSubsystemId: state.activeSubsystemId,
      });
    }
  });
}
