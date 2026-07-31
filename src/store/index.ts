import { create } from 'zustand';
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
  JunctionLayout,
  JunctionLayouts,
  ManufacturingDocument,
  ManufacturingStep,
  MergePoint,
  MergePointLayouts,
  NodeLayout,
  Path,
  PortLayouts,
  RotationLayouts,
  SelectedItem,
  Signal,
  SizeLayouts,
  SubsystemDocument,
  SubsystemEntityLayout,
  EditingSurface,
  TextBoxFontFamily,
  TextBoxFontWeight,
  TextBoxLayout,
  TextBoxLayouts,
  TextBoxTextAlign,
  WaypointItem,
  WaypointLayouts,
} from '../types';
import {
  assignManufacturingEndpointGender,
  EMPTY_MANUFACTURING_DOCUMENT,
  MANUFACTURING_STEPS,
} from '../lib/manufacturing';
import { collectAllTags, itemMatchesFilters } from '../lib/tags';
import {
  applyConnectorPinCount,
  deriveBundles,
  findPathSegmentForBundle,
  GENERIC_MULTIPIN_TYPE_ID,
  getConnectorPairSegments,
  getConnectorOccupancy,
  getConnectorSupportedKeyings,
  getConnectorTypeCavityFloor,
  getEntityRevealContext,
  getEffectivePinCount,
  getNextConnectorPinCount,
  getPathNodeBundleKey,
  getPathSegmentMeasurement,
  getPreviousConnectorPinCount,
  getVisibleSegments,
  isConnectorFamily,
  nextMergePointId,
  normalizeConnectorKeying,
  parseBundleId,
  dissolveMergePoint,
  renumberConnectorPins,
  splicePathWithMerge,
} from '../lib/harness';
import {
  getConnectorTablePinCount,
  resolveConnectorRenderedSize,
} from '../lib/connectorSize';
import {
  renameConnectorType as renameConnectorTypeInLibrary,
  renameHarnessEntity,
  renameSubsystem as renameSubsystemDocument,
  renameSystem as renameSystemDocument,
} from '../lib/rename';

interface LayoutSnapshot {
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
  subsystemLayouts: Record<string, Pick<SubsystemDocument, 'enclosures' | 'devices' | 'connectors'>>;
}

interface StructuralSnapshot {
  harness: HarnessData;
  subsystems: Record<string, SubsystemDocument>;
}

export interface DeleteImpact {
  enclosureIds: string[];
  connectorIds: string[];
  mergePointIds: string[];
  pathIds: string[];
  signalIds: string[];
}

const MAX_HISTORY = 60;

interface HarnessStore {
  harness: HarnessData | null;
  connectorLibrary: ConnectorLibrary | null;
  manufacturing: ManufacturingDocument;
  manufacturingTargetBundleId: string | null;
  appView: AppView;
  connectorLibraryTargetId: string | null;
  activeHarnessName: string;
  availableHarnesses: string[];
  selectedItem: SelectedItem | null;
  nodeLayouts: NodeLayout;
  isDirty: boolean;
  expandedNodes: Set<string>;
  /** Session-only sizes while a connector table is expanded; cleared on collapse. */
  expandedSizeOverrides: SizeLayouts;
  activeFilters: Map<string, Set<string>>;
  settingsOpen: boolean;
  drillDownEnclosure: string | null;
  portLayouts: PortLayouts;
  sizeLayouts: SizeLayouts;
  freePortLayouts: FreePortLayouts;
  backgroundLayouts: BackgroundLayouts;
  connectorTypeSizes: ConnectorTypeSizes;
  textBoxLayouts: TextBoxLayouts;
  selectedTextBoxId: string | null;
  selectedBundle: string[] | null;
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
  structuralUndoStack: StructuralSnapshot[];

  setActiveHarnessName: (name: string) => Promise<boolean>;
  setAvailableHarnesses: (harnesses: string[]) => void;
  renameSystem: (name: string) => void;
  openConnectorLibrary: (typeId?: string | null) => void;
  openManufacturing: (bundleId?: string | null) => void;
  showBundleInHierarchy: (pathIds: string[]) => void;
  closeConnectorLibrary: () => void;
  setEditingSurface: (surface: EditingSurface) => void;
  loadSubsystems: (documents: SubsystemDocument[]) => void;
  setActiveSubsystem: (id: string | null) => void;
  upsertSubsystem: (document: SubsystemDocument) => void;
  renameSubsystem: (id: string, name: string) => void;
  updateSubsystemEntityLayout: (kind: 'enclosures' | 'devices' | 'connectors', id: string, layout: SubsystemEntityLayout) => void;
  resizeSubsystemEntityLayout: (kind: 'enclosures' | 'devices', id: string, layout: SubsystemEntityLayout) => void;
  addEntityToActiveSubsystem: (type: 'enclosure' | 'connector', id: string) => void;
  removeEntityFromActiveSubsystem: (type: 'enclosure' | 'connector', id: string) => void;
  renumberConnectorCavities: (connectorId: string, orderedOldPinNumbers: number[]) => void;
  getDeleteImpact: (type: 'enclosure' | 'connector' | 'mergePoint' | 'path' | 'signal', id: string) => DeleteImpact;
  deleteEntityCascade: (type: 'enclosure' | 'connector' | 'mergePoint' | 'path' | 'signal', id: string) => void;
  addConnector: (parentId: string) => string | null;
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
  updatePathProperty: (pathId: string, key: string, value: string) => void;
  updatePathSegmentLength: (pathId: string, segmentIndex: number, lengthMm: number | undefined) => void;
  updateConnectorPairSegmentLengths: (pathId: string, segmentIndex: number, lengthMm: number) => void;
  setMutationError: (message: string | null) => void;
  pushStructuralSnapshot: () => void;
  undoStructuralMutation: () => void;
  resetForHarnessSwitch: () => void;

  loadHarness: (data: HarnessData) => void;
  loadConnectorLibrary: (data: ConnectorLibrary) => void;
  loadManufacturing: (data: ManufacturingDocument) => void;
  updateManufacturingStep: (
    bundleId: string,
    step: ManufacturingStep,
    completed: boolean,
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
  updatePortLayout: (connectorId: string, x: number, y: number) => void;
  updateNodeSize: (nodeId: string, w: number, h: number) => void;
  updateFreePortLayout: (connectorId: string, x: number, y: number) => void;
  updateMergePointLayout: (contextKey: string, mergePointId: string, x: number, y: number) => void;

  setDrillDown: (encId: string | null) => void;
  setSelectedBundle: (pathIds: string[] | null) => void;

  setEdgeWaypoints: (edgeId: string, waypoints: WaypointItem[]) => void;
  clearEdgeWaypoints: (edgeId: string) => void;
  createJunction: (pos: { x: number; y: number }, edgeId: string, waypointIndex: number) => string;
  moveJunction: (junctionId: string, pos: { x: number; y: number }) => void;
  deleteJunction: (junctionId: string) => void;
  linkEdgeToJunction: (junctionId: string, edgeId: string, insertAfterIndex: number, pos: { x: number; y: number }) => void;
  unlinkEdgeFromJunction: (junctionId: string, edgeId: string) => void;
  findJunctionForEdgeWaypoint: (edgeId: string, waypointIndex: number) => JunctionLayout | undefined;
  getJunctionsForEdge: (edgeId: string) => JunctionLayout[];

  draggingEdgeInfo: { edgeId: string; position: { x: number; y: number }; waypointIndex?: number } | null;
  setDraggingEdgeInfo: (info: { edgeId: string; position: { x: number; y: number }; waypointIndex?: number } | null) => void;

  undoStack: LayoutSnapshot[];
  redoStack: LayoutSnapshot[];
  pushUndoSnapshot: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  loadConnectorTypeSizes: (sizes: ConnectorTypeSizes) => void;
  updateConnectorTypeSize: (typeId: string, w: number, h: number) => void;
  updateConnectorTypeImage: (typeId: string, image: string, pinCount?: number) => void;
  updateConnectorTypeSideImage: (typeId: string, image: string, pinCount?: number) => void;
  renameConnectorType: (typeId: string, name: string) => void;
  updateEnclosureProperty: (encId: string, key: string, value: string) => void;
  updateConnectorProperty: (conId: string, key: string, value: string) => void;

  addTag: (entityType: string, entityId: string, tag: string) => void;
  removeTag: (entityType: string, entityId: string, tag: string) => void;

  toggleFilter: (namespace: string, value: string) => void;
  clearFilters: () => void;
  setSettingsOpen: (open: boolean) => void;
  markClean: () => void;

  getAllTagNamespaces: () => Map<string, Set<string>>;
  getAllExistingTags: () => string[];
  getFilteredMatch: (tags: string[]) => boolean;
  findEntity: (type: string, id: string) => Enclosure | Connector | MergePoint | Path | Signal | undefined;
  getParentName: (parentId: string) => string;
}

function normalizeHarness(data: HarnessData): HarnessData {
  const normalized = structuredClone(data) as HarnessData & { pcbs?: unknown[]; wires?: unknown[] };

  if (Array.isArray((normalized as any).pcbs)) {
    for (const pcb of (normalized as any).pcbs) {
      normalized.enclosures.push({
        id: pcb.id,
        name: pcb.name,
        parent: pcb.parent ?? null,
        container: false,
        tags: pcb.tags ?? [],
        properties: pcb.properties ?? {},
      });
    }
    delete (normalized as any).pcbs;
  }

  normalized.mergePoints ??= [];
  normalized.paths ??= [];
  normalized.signals ??= [];

  for (const enclosure of normalized.enclosures) {
    enclosure.tags ??= [];
    enclosure.properties ??= {};
    enclosure.container ??= true;
  }

  for (const connector of normalized.connectors) {
    connector.tags ??= [];
    connector.properties ??= {};
    connector.parent ??= null;
    delete (connector as any).pins;
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
    const rawNodes = (path.nodes ?? []) as Array<any>;
    const legacyNodeById = new Map<string, any>();
    for (const rawNode of rawNodes) {
      if (typeof rawNode?.id === 'string') legacyNodeById.set(rawNode.id, rawNode);
    }
    path.nodes = rawNodes.map((rawNode) => {
      const { id: _legacyId, ...nodeWithoutId } = rawNode ?? {};
      return nodeWithoutId;
    });
    path.measurements = (path.measurements ?? []).map((measurement: any) => {
      if (measurement?.from && measurement?.to) return measurement;
      const fromNode = typeof measurement?.from_node_id === 'string'
        ? legacyNodeById.get(measurement.from_node_id)
        : null;
      const toNode = typeof measurement?.to_node_id === 'string'
        ? legacyNodeById.get(measurement.to_node_id)
        : null;
      if (!fromNode || !toNode) return measurement;
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

function makeSnapshot(state: HarnessStore): LayoutSnapshot {
  return {
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
    subsystemLayouts: Object.fromEntries(
      Object.entries(state.subsystems).map(([id, subsystem]) => [id, {
        enclosures: subsystem.enclosures,
        devices: subsystem.devices,
        connectors: subsystem.connectors,
      }]),
    ),
  };
}

function restoreSnapshot(state: HarnessStore, snapshot: LayoutSnapshot) {
  const { subsystemLayouts, ...layoutState } = snapshot;
  const subsystems = { ...state.subsystems };
  for (const [id, layouts] of Object.entries(subsystemLayouts)) {
    const subsystem = subsystems[id];
    if (subsystem) subsystems[id] = { ...subsystem, ...layouts };
  }
  return { ...layoutState, subsystems };
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

export const useHarnessStore = create<HarnessStore>((set, get) => ({
  harness: null,
  connectorLibrary: null,
  manufacturing: structuredClone(EMPTY_MANUFACTURING_DOCUMENT),
  manufacturingTargetBundleId: null,
  appView: 'canvas',
  connectorLibraryTargetId: null,
  activeHarnessName: getInitialHarnessName(),
  availableHarnesses: [],
  selectedItem: null,
  nodeLayouts: {},
  isDirty: false,
  expandedNodes: new Set<string>(),
  expandedSizeOverrides: {},
  activeFilters: new Map<string, Set<string>>(),
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
  structuralUndoStack: [],
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
  renameSystem: (name) => set((state) => {
    if (!state.harness) return state;
    try {
      const harness = renameSystemDocument(state.harness, name);
      return harness === state.harness ? state : { harness, isDirty: true, mutationError: null };
    } catch (error) {
      return { mutationError: error instanceof Error ? error.message : 'System rename failed.' };
    }
  }),
  openConnectorLibrary: (typeId = null) => set({
    appView: 'connectorLibrary',
    connectorLibraryTargetId: typeId,
  }),
  openManufacturing: (bundleId = null) => set({
    appView: 'manufacturing',
    connectorLibraryTargetId: null,
    manufacturingTargetBundleId: bundleId,
  }),
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
    return {
      appView: 'canvas',
      editingSurface: 'hierarchy',
      drillDownEnclosure,
      selectedBundle: visibleBundle?.pathIds ?? (firstPathId ? [firstPathId] : null),
      selectedItem: null,
      selectedTextBoxId: null,
      revealRequest: null,
      manufacturingTargetBundleId: null,
    };
  }),
  closeConnectorLibrary: () => set({
    appView: 'canvas',
    connectorLibraryTargetId: null,
    manufacturingTargetBundleId: null,
  }),
  setEditingSurface: (surface) => set({ editingSurface: surface }),
  loadSubsystems: (documents) => set((state) => {
    const harness = state.harness ? structuredClone(state.harness) : null;
    if (harness) {
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
            document.connectors[connector.id] ||
            (connector.parent !== null && document.devices[connector.parent] && deviceMode === 'all')
          ) {
            addSystemTag(connector.tags, document.id);
          }
        }
      }
    }
    return {
      harness,
      subsystems: Object.fromEntries(documents.map((document) => [document.id, document])),
      activeSubsystemId: documents[0]?.id ?? null,
    };
  }),
  setActiveSubsystem: (id) => set({ activeSubsystemId: id }),
  upsertSubsystem: (document) => set((state) => ({
    subsystems: { ...state.subsystems, [document.id]: document },
    activeSubsystemId: document.id,
  })),
  renameSubsystem: (id, name) => set((state) => {
    const subsystem = state.subsystems[id];
    if (!subsystem) return { mutationError: `Cannot rename missing subsystem '${id}'.` };
    try {
      const renamed = renameSubsystemDocument(subsystem, name);
      if (renamed === subsystem) return state;
      return {
        subsystems: { ...state.subsystems, [id]: renamed },
        isDirty: true,
        mutationError: null,
      };
    } catch (error) {
      return { mutationError: error instanceof Error ? error.message : 'Subsystem rename failed.' };
    }
  }),
  updateSubsystemEntityLayout: (kind, id, layout) => set((state) => {
    const activeId = state.activeSubsystemId;
    if (!activeId || !state.subsystems[activeId]) return state;
    const document = state.subsystems[activeId];
    return {
      subsystems: {
        ...state.subsystems,
        [activeId]: {
          ...document,
          [kind]: { ...document[kind], [id]: layout },
        },
      },
    };
  }),
  resizeSubsystemEntityLayout: (kind, id, layout) => set((state) => {
    const activeId = state.activeSubsystemId;
    const document = activeId ? state.subsystems[activeId] : undefined;
    const previous = document?.[kind][id];
    if (!activeId || !document || !previous) return state;

    const deltaX = layout.x - previous.x;
    const deltaY = layout.y - previous.y;
    let devices = document.devices;
    let connectors = document.connectors;

    if (deltaX !== 0 || deltaY !== 0) {
      if (kind === 'enclosures') {
        devices = { ...devices };
        const representedDeviceIds = new Set(Object.keys(document.devices));
        for (const [deviceId, deviceLayout] of Object.entries(document.devices)) {
          const device = state.harness?.enclosures.find((entity) => entity.id === deviceId);
          if (device?.parent !== id) continue;
          devices[deviceId] = {
            ...deviceLayout,
            x: deviceLayout.x - deltaX,
            y: deviceLayout.y - deltaY,
          };
        }

        connectors = { ...connectors };
        for (const [connectorId, connectorLayout] of Object.entries(document.connectors)) {
          const connector = state.harness?.connectors.find((entity) => entity.id === connectorId);
          const parentEntity = connector?.parent
            ? state.harness?.enclosures.find((entity) => entity.id === connector.parent)
            : undefined;
          const isDirectFrameChild =
            connector?.parent === id ||
            (
              parentEntity?.container === false &&
              parentEntity.parent === id &&
              !representedDeviceIds.has(parentEntity.id)
            );
          if (!isDirectFrameChild) continue;
          connectors[connectorId] = {
            ...connectorLayout,
            x: connectorLayout.x - deltaX,
            y: connectorLayout.y - deltaY,
          };
        }
      } else {
        connectors = { ...connectors };
        const hiddenConnectorIds = new Set(document.hidden_connectors ?? []);
        const connectorMode = document.device_connector_mode?.[id] ?? 'all';
        const visibleConnectors = (state.harness?.connectors ?? []).filter((connector) =>
          connector.parent === id &&
          !hiddenConnectorIds.has(connector.id) &&
          (connectorMode === 'all' || !!document.connectors[connector.id]),
        );
        visibleConnectors.forEach((connector, index) => {
          const connectorLayout = document.connectors[connector.id] ?? {
            x: 12 + (index % 2) * 100,
            y: 48 + Math.floor(index / 2) * 44,
          };
          connectors[connector.id] = {
            ...connectorLayout,
            x: connectorLayout.x - deltaX,
            y: connectorLayout.y - deltaY,
          };
        });
      }
    }

    return {
      subsystems: {
        ...state.subsystems,
        [activeId]: {
          ...document,
          enclosures: kind === 'enclosures'
            ? { ...document.enclosures, [id]: layout }
            : document.enclosures,
          devices: kind === 'devices'
            ? { ...devices, [id]: layout }
            : devices,
          connectors,
        },
      },
    };
  }),
  addEntityToActiveSubsystem: (type, id) => set((state) => {
    const subsystemId = state.activeSubsystemId;
    const harness = state.harness;
    const current = subsystemId ? state.subsystems[subsystemId] : undefined;
    if (!subsystemId || !harness || !current) return state;
    const document = structuredClone(current);
    const systemTag = `system:${document.id}`;
    const nextFrameLayout = () => {
      const index = Object.keys(document.enclosures).length;
      return { x: 40 + (index % 3) * 560, y: 40 + Math.floor(index / 3) * 400, w: 520, h: 360 };
    };
    const nextDeviceLayout = (frameId: string | null) => {
      const index = Object.keys(document.devices).filter((deviceId) =>
        harness.enclosures.find((item) => item.id === deviceId)?.parent === frameId,
      ).length;
      return { x: 40 + (index % 2) * 240, y: 60 + Math.floor(index / 2) * 200, w: 220, h: 180 };
    };
    const nextConnectorLayout = () => {
      const index = Object.keys(document.connectors).length;
      return { x: 40 + (index % 3) * 112, y: 80 + Math.floor(index / 3) * 52, w: 96, h: 36 };
    };
    const nextHarness = structuredClone(harness);
    if (type === 'enclosure') {
      const entity = harness.enclosures.find((item) => item.id === id);
      if (!entity) return state;
      const mutableEntity = nextHarness.enclosures.find((item) => item.id === id);
      if (mutableEntity && !mutableEntity.tags.includes(systemTag)) mutableEntity.tags.push(systemTag);
      const isDevice = !entity.container;
      const frameId = isDevice ? entity.parent : entity.id;
      if (frameId && !document.enclosures[frameId]) {
        document.enclosures[frameId] = nextFrameLayout();
      }
      if (frameId) {
        const mutableFrame = nextHarness.enclosures.find((item) => item.id === frameId);
        if (mutableFrame && !mutableFrame.tags.includes(systemTag)) mutableFrame.tags.push(systemTag);
      }
      if (isDevice && !document.devices[id]) {
        document.devices[id] = nextDeviceLayout(frameId);
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
      return { harness: nextHarness, subsystems: { ...state.subsystems, [subsystemId]: document }, isDirty: true };
    }

    const connector = harness.connectors.find((item) => item.id === id);
    if (!connector) return state;
    const parentEntity = connector.parent
      ? harness.enclosures.find((item) => item.id === connector.parent)
      : undefined;
    const deviceId = parentEntity && !parentEntity.container ? parentEntity.id : null;
    const frameId = deviceId ? parentEntity?.parent ?? null : connector.parent;
    if (frameId && !document.enclosures[frameId]) {
      document.enclosures[frameId] = nextFrameLayout();
    }
    if (deviceId && !document.devices[deviceId]) {
      document.devices[deviceId] = nextDeviceLayout(frameId);
      document.device_connector_mode = {
        ...(document.device_connector_mode ?? {}),
        [deviceId]: 'selected',
      };
    }
    if (!document.connectors[id]) {
      document.connectors[id] = nextConnectorLayout();
    }
    document.hidden_connectors = (document.hidden_connectors ?? []).filter((connectorId) => connectorId !== id);
    const mutableConnector = nextHarness.connectors.find((item) => item.id === id);
    if (mutableConnector && !mutableConnector.tags.includes(systemTag)) mutableConnector.tags.push(systemTag);
    if (deviceId) {
      const mutableDevice = nextHarness.enclosures.find((item) => item.id === deviceId);
      if (mutableDevice && !mutableDevice.tags.includes(systemTag)) mutableDevice.tags.push(systemTag);
      if (frameId) {
        const mutableFrame = nextHarness.enclosures.find((item) => item.id === frameId);
        if (mutableFrame && !mutableFrame.tags.includes(systemTag)) mutableFrame.tags.push(systemTag);
      }
    }
    return { harness: nextHarness, subsystems: { ...state.subsystems, [subsystemId]: document }, isDirty: true };
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
        delete document.enclosures[id];
        const removedDeviceIds = harness.enclosures
          .filter((item) => item.parent === id && document.devices[item.id])
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
          if (frameId !== id) continue;
          delete document.connectors[connector.id];
          connector.tags = stripTag(connector.tags);
        }
      }
    }
    return {
      harness,
      subsystems: { ...state.subsystems, [subsystemId]: document },
      selectedItem: null,
      isDirty: true,
    };
  }),
  renumberConnectorCavities: (connectorId, orderedOldPinNumbers) => set((state) => {
    if (!state.harness) return state;
    return { harness: renumberConnectorPins(state.harness, connectorId, orderedOldPinNumbers), isDirty: true };
  }),
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
    return {
      harness,
      subsystems,
      ...layoutCleanup,
      selectedItem: null,
      selectedBundle: null,
      isDirty: true,
      structuralUndoStack: [
        ...state.structuralUndoStack.slice(-9),
        { harness: structuredClone(state.harness), subsystems: structuredClone(state.subsystems) },
      ],
    };
  }),
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

      return {
        harness,
        subsystems,
        portLayouts,
        selectedItem: { type: 'connector', id: connectorId },
        selectedBundle: null,
        selectedTextBoxId: null,
        isDirty: true,
        structuralUndoStack: [
          ...prev.structuralUndoStack.slice(-9),
          { harness: structuredClone(prev.harness), subsystems: structuredClone(prev.subsystems) },
        ],
      };
    });

    return connectorId;
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
    return { harness, isDirty: true, mutationError: null };
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
    return { harness, isDirty: true, mutationError: null };
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
    return { harness, isDirty: true };
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
    return { harness, isDirty: true };
  }),
  renameEntity: (type, id, name) => set((state) => {
    if (!state.harness) return state;
    try {
      const harness = renameHarnessEntity(state.harness, type, id, name);
      return harness === state.harness ? state : { harness, isDirty: true, mutationError: null };
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
    return { harness, isDirty: true };
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
    return { harness, isDirty: true };
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

    return { harness, isDirty: true, mutationError: null };
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
        ? { harness, isDirty: true, mutationError: null }
        : state;
    }

    const harness = structuredClone(state.harness);
    const matches = getConnectorPairSegments(harness, from.connector_id, to.connector_id);
    let changed = false;
    for (const match of matches) {
      changed = setPathSegmentLength(match.path, match.segmentIndex, lengthMm) || changed;
    }
    return changed ? { harness, isDirty: true, mutationError: null } : state;
  }),
  setMutationError: (message) => set({ mutationError: message }),
  pushStructuralSnapshot: () => set((state) => {
    if (!state.harness) return state;
    return {
      structuralUndoStack: [
        ...state.structuralUndoStack.slice(-9),
        { harness: structuredClone(state.harness), subsystems: structuredClone(state.subsystems) },
      ],
    };
  }),
  undoStructuralMutation: () => set((state) => {
    const previous = state.structuralUndoStack.at(-1);
    if (!previous) return state;
    return {
      harness: structuredClone(previous.harness),
      subsystems: structuredClone(previous.subsystems),
      structuralUndoStack: state.structuralUndoStack.slice(0, -1),
      isDirty: true,
    };
  }),
  resetForHarnessSwitch: () => set({
    harness: null,
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
    structuralUndoStack: [],
    undoStack: [],
    redoStack: [],
    selectedItem: null,
    selectedBundle: null,
    selectedTextBoxId: null,
    revealRequest: null,
    drillDownEnclosure: null,
    expandedNodes: new Set(),
    expandedSizeOverrides: {},
    activeFilters: new Map(),
    isDirty: false,
    draggingEdgeInfo: null,
    manufacturing: structuredClone(EMPTY_MANUFACTURING_DOCUMENT),
    manufacturingTargetBundleId: null,
  }),

  loadHarness: (data) => set({ harness: normalizeHarness(data), isDirty: false }),
  loadConnectorLibrary: (data) => set({ connectorLibrary: data }),
  loadManufacturing: (data) => set({
    manufacturing: {
      schema_version: '1.1.0',
      bundles: data?.bundles ?? {},
    },
  }),
  updateManufacturingEndpointGender: (
    bundleId,
    connectorId,
    gender,
    mateBundleIds,
  ) => set((state) => ({
    manufacturing: assignManufacturingEndpointGender(
      state.manufacturing,
      bundleId,
      connectorId,
      gender,
      mateBundleIds,
    ),
    isDirty: true,
  })),
  updateManufacturingStep: (bundleId, step, completed) => set((state) => {
    const document = structuredClone(state.manufacturing);
    const progress = document.bundles[bundleId] ?? { steps: {} };
    const stepIndex = MANUFACTURING_STEPS.findIndex((candidate) => candidate.id === step);
    if (stepIndex < 0) return state;
    for (let index = 0; index < MANUFACTURING_STEPS.length; index += 1) {
      const candidate = MANUFACTURING_STEPS[index].id;
      if (completed && index <= stepIndex) progress.steps[candidate] = true;
      if (!completed && index >= stepIndex) delete progress.steps[candidate];
    }
    document.bundles[bundleId] = progress;
    return { manufacturing: document, isDirty: true };
  }),
  updateManufacturingNotes: (bundleId, notes) => set((state) => {
    const document = structuredClone(state.manufacturing);
    const progress = document.bundles[bundleId] ?? { steps: {} };
    const normalized = notes.trim();
    if (normalized) progress.notes = notes;
    else delete progress.notes;
    document.bundles[bundleId] = progress;
    return { manufacturing: document, isDirty: true };
  }),
  updateConnectorLibrary: (data) => set({ connectorLibrary: data, isDirty: true }),
  loadLayouts: (layouts) => set({ nodeLayouts: layouts }),
  loadPortLayouts: (ports) => {
    const clean: PortLayouts = {};
    for (const [key, value] of Object.entries(ports)) {
      if (typeof (value as any).x === 'number' && typeof (value as any).y === 'number') {
        clean[key] = value as { x: number; y: number };
      }
    }
    set({ portLayouts: clean });
  },
  loadSizeLayouts: (sizes) => set({ sizeLayouts: sizes }),
  loadFreePortLayouts: (free) => set({ freePortLayouts: free }),
  loadBackgroundLayouts: (bg) => set({ backgroundLayouts: bg }),
  loadConnectorTypeSizes: (sizes) => set({ connectorTypeSizes: sizes }),
  loadTextBoxLayouts: (tbs) =>
    set({
      textBoxLayouts: Object.fromEntries(
        Object.entries(tbs).map(([id, tb]) => [id, { ...tb, contextKey: tb.contextKey ?? 'graph' }]),
      ),
    }),
  loadWaypointLayouts: (wps) => set({ waypointLayouts: wps }),
  loadJunctionLayouts: (junctions) => set({ junctionLayouts: junctions }),
  loadMergePointLayouts: (layouts) => set({ mergePointLayouts: layouts }),
  loadRotationLayouts: (rotations) => set({ rotationLayouts: rotations }),
  rotateConnector: (connectorId) =>
    set((state) => {
      const current = state.rotationLayouts[connectorId] ?? 0;
      const next = (current + 90) % 360;
      return { rotationLayouts: { ...state.rotationLayouts, [connectorId]: next }, isDirty: true };
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

          return {
            rotationLayouts,
            subsystems: {
              ...state.subsystems,
              [subsystem.id]: nextSubsystem,
            },
            isDirty: true,
          };
        }
      }

      if (!harness) return { rotationLayouts, isDirty: true };

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

      return {
        rotationLayouts,
        nodeLayouts,
        portLayouts,
        sizeLayouts: {
          ...state.sizeLayouts,
          [enclosureId]: newSize,
        },
        isDirty: true,
      };
    }),

  updateBackground: (contextKey, patch) =>
    set((state) => {
      const prev = state.backgroundLayouts[contextKey];
      return {
        backgroundLayouts: {
          ...state.backgroundLayouts,
          [contextKey]: { ...(prev ?? { x: 0, y: 0, w: 800, h: 600, locked: false, image: '' }), ...patch },
        },
      };
    }),
  removeBackground: (contextKey) =>
    set((state) => {
      const next = { ...state.backgroundLayouts };
      delete next[contextKey];
      return { backgroundLayouts: next };
    }),

  addTextBox: (x, y) => {
    const id = `tb_${Date.now()}`;
    set((state) => ({
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
    }));
  },
  updateTextBox: (id, patch) =>
    set((state) => {
      const prev = state.textBoxLayouts[id];
      if (!prev) return state;
      return { textBoxLayouts: { ...state.textBoxLayouts, [id]: { ...prev, ...patch } } };
    }),
  removeTextBox: (id) =>
    set((state) => {
      const next = { ...state.textBoxLayouts };
      delete next[id];
      return {
        textBoxLayouts: next,
        selectedTextBoxId: state.selectedTextBoxId === id ? null : state.selectedTextBoxId,
      };
    }),
  selectTextBox: (id) => set({
    selectedTextBoxId: id,
    selectedItem: null,
    selectedBundle: null,
    revealRequest: null,
  }),

  selectItem: (item) => set({
    selectedItem: item,
    selectedBundle: null,
    selectedTextBoxId: null,
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

  updateNodePosition: (nodeId, x, y) => set((state) => ({ nodeLayouts: { ...state.nodeLayouts, [nodeId]: { x, y } } })),
  updatePortLayout: (connectorId, x, y) => set((state) => ({ portLayouts: { ...state.portLayouts, [connectorId]: { x, y } } })),
  updateNodeSize: (nodeId, w, h) => set((state) => ({ sizeLayouts: { ...state.sizeLayouts, [nodeId]: { w, h } } })),
  updateFreePortLayout: (connectorId, x, y) => set((state) => ({ freePortLayouts: { ...state.freePortLayouts, [connectorId]: { x, y } } })),
  updateMergePointLayout: (contextKey, mergePointId, x, y) =>
    set((state) => ({
      mergePointLayouts: {
        ...state.mergePointLayouts,
        [contextKey]: {
          ...(state.mergePointLayouts[contextKey] ?? {}),
          [mergePointId]: { x, y },
        },
      },
    })),

  setDrillDown: (encId) => set({
    drillDownEnclosure: encId,
    selectedItem: null,
    selectedBundle: null,
    selectedTextBoxId: null,
    revealRequest: null,
  }),
  setSelectedBundle: (pathIds) => set({
    selectedBundle: pathIds,
    selectedItem: null,
    selectedTextBoxId: null,
    revealRequest: null,
  }),

  setEdgeWaypoints: (edgeId, waypoints) => set((state) => ({ waypointLayouts: { ...state.waypointLayouts, [edgeId]: waypoints } })),
  clearEdgeWaypoints: (edgeId) =>
    set((state) => {
      const next = { ...state.waypointLayouts };
      delete next[edgeId];
      return { waypointLayouts: next };
    }),
  createJunction: (pos, edgeId, waypointIndex) => {
    const id = `jct_${Date.now()}`;
    set((state) => {
      const waypoints = [...(state.waypointLayouts[edgeId] ?? [])];
      waypoints[waypointIndex] = { junctionId: id };

      // Attempt to couple the junction with a real MergePoint entity. Only
      // succeeds if the edge id parses as a bundle and at least one path
      // actually traverses that bundle — otherwise fall back to an orphan
      // layout-only junction (legacy behavior).
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
          // Bundle has split into sub-bundles; original waypoint entry is stale.
          nextWaypointLayouts = { ...state.waypointLayouts };
          delete nextWaypointLayouts[edgeId];
        }
      }

      return {
        junctionLayouts: {
          ...state.junctionLayouts,
          [id]: { id, x: pos.x, y: pos.y, memberEdgeIds: [edgeId], mergePointId },
        },
        waypointLayouts: nextWaypointLayouts,
        mergePointLayouts: nextMergePointLayouts,
        harness: nextHarness,
      };
    });
    return id;
  },
  moveJunction: (junctionId, pos) =>
    set((state) => {
      const junction = state.junctionLayouts[junctionId];
      if (!junction) return state;
      return {
        junctionLayouts: {
          ...state.junctionLayouts,
          [junctionId]: { ...junction, x: pos.x, y: pos.y },
        },
      };
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

      return {
        junctionLayouts: nextJunctions,
        waypointLayouts,
        harness: nextHarness,
        mergePointLayouts: nextMergePointLayouts,
      };
    }),
  linkEdgeToJunction: (junctionId, edgeId, insertAfterIndex) =>
    set((state) => {
      const junction = state.junctionLayouts[junctionId];
      if (!junction || junction.memberEdgeIds.includes(edgeId)) return state;
      const waypoints = [...(state.waypointLayouts[edgeId] ?? [])];
      const insertAt = Math.min(waypoints.length, Math.max(0, insertAfterIndex + 1));
      waypoints.splice(insertAt, 0, { junctionId });

      // If this junction is coupled with a MergePoint, splice the merge into
      // every path that traverses the newly linked edge's bundle so the
      // harness stays in sync with the visual convergence.
      const harness = state.harness;
      const mergePointId = junction.mergePointId;
      let nextHarness = harness;
      let nextWaypointLayouts: WaypointLayouts = { ...state.waypointLayouts, [edgeId]: waypoints };

      if (harness && mergePointId) {
        const parsed = parseBundleId(edgeId);
        if (parsed) {
          const updatedPaths = harness.paths.map((path) => {
            // Skip paths that already include this merge to avoid duplicates
            // on self-intersecting paths.
            const already = path.nodes.some(
              (node) => node.kind === 'merge' && node.merge_point_id === mergePointId,
            );
            if (already) return path;
            return splicePathWithMerge(path, edgeId, mergePointId);
          });
          if (updatedPaths.some((path, idx) => path !== harness.paths[idx])) {
            nextHarness = { ...harness, paths: updatedPaths };
            // Bundle has split; the waypoint entry pointing at this junction is stale.
            nextWaypointLayouts = { ...state.waypointLayouts };
            delete nextWaypointLayouts[edgeId];
          }
        }
      }

      return {
        junctionLayouts: {
          ...state.junctionLayouts,
          [junctionId]: { ...junction, memberEdgeIds: [...junction.memberEdgeIds, edgeId] },
        },
        waypointLayouts: nextWaypointLayouts,
        harness: nextHarness,
      };
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
              return { ...path, nodes: [...nodes.slice(0, i), ...nodes.slice(i + 1)] };
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
        return {
          junctionLayouts: nextJunctions,
          waypointLayouts: { ...state.waypointLayouts, [edgeId]: waypoints },
          harness: nextHarness,
          mergePointLayouts: nextMergePointLayouts,
        };
      }
      return {
        junctionLayouts: {
          ...state.junctionLayouts,
          [junctionId]: { ...junction, memberEdgeIds: remaining },
        },
        waypointLayouts: { ...state.waypointLayouts, [edgeId]: waypoints },
        harness: nextHarness,
        mergePointLayouts: nextMergePointLayouts,
      };
    }),
  findJunctionForEdgeWaypoint: (edgeId, waypointIndex) => {
    const state = get();
    const waypoint = state.waypointLayouts[edgeId]?.[waypointIndex];
    if (!waypoint || !('junctionId' in waypoint)) return undefined;
    return state.junctionLayouts[waypoint.junctionId];
  },
  getJunctionsForEdge: (edgeId) => {
    const state = get();
    return (state.waypointLayouts[edgeId] ?? [])
      .filter((waypoint): waypoint is { junctionId: string } => 'junctionId' in waypoint)
      .map((waypoint) => state.junctionLayouts[waypoint.junctionId])
      .filter(Boolean) as JunctionLayout[];
  },

  setDraggingEdgeInfo: (info) => set({ draggingEdgeInfo: info }),

  pushUndoSnapshot: () =>
    set((state) => {
      const next = [...state.undoStack, makeSnapshot(state)];
      if (next.length > MAX_HISTORY) next.shift();
      return { undoStack: next, redoStack: [] };
    }),
  undo: () =>
    set((state) => {
      if (state.undoStack.length === 0) return state;
      const prev = state.undoStack[state.undoStack.length - 1];
      return {
        ...restoreSnapshot(state, prev),
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, makeSnapshot(state)],
      };
    }),
  redo: () =>
    set((state) => {
      if (state.redoStack.length === 0) return state;
      const next = state.redoStack[state.redoStack.length - 1];
      return {
        ...restoreSnapshot(state, next),
        undoStack: [...state.undoStack, makeSnapshot(state)],
        redoStack: state.redoStack.slice(0, -1),
      };
    }),
  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  updateConnectorTypeSize: (typeId, w, h) =>
    set((state) => ({
      connectorTypeSizes: { ...state.connectorTypeSizes, [typeId]: { w: Math.round(w), h: Math.round(h) } },
    })),
  updateConnectorTypeImage: (typeId, image, pinCount) =>
    set((state) => {
      if (!state.connectorLibrary) return state;
      const library = structuredClone(state.connectorLibrary);
      const connectorType = library.connector_types.find((item) => item.id === typeId);
      const variant = connectorType?.cavity_variants?.find((item) => item.pin_count === pinCount);
      if (variant) variant.image = image || undefined;
      else if (connectorType) connectorType.image = image || undefined;
      return { connectorLibrary: library, isDirty: true };
    }),
  updateConnectorTypeSideImage: (typeId, image, pinCount) =>
    set((state) => {
      if (!state.connectorLibrary) return state;
      const library = structuredClone(state.connectorLibrary);
      const connectorType = library.connector_types.find((item) => item.id === typeId);
      const variant = connectorType?.cavity_variants?.find((item) => item.pin_count === pinCount);
      if (variant) variant.side_image = image || undefined;
      else if (connectorType) connectorType.side_image = image || undefined;
      return { connectorLibrary: library, isDirty: true };
    }),
  renameConnectorType: (typeId, name) =>
    set((state) => {
      if (!state.connectorLibrary) return state;
      try {
        const connectorLibrary = renameConnectorTypeInLibrary(state.connectorLibrary, typeId, name);
        return connectorLibrary === state.connectorLibrary
          ? state
          : { connectorLibrary, isDirty: true, mutationError: null };
      } catch (error) {
        return { mutationError: error instanceof Error ? error.message : 'Connector type rename failed.' };
      }
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
      return { harness, isDirty: true };
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
      return { harness, isDirty: true };
    }),

  addTag: (entityType, entityId, tag) =>
    set((state) => {
      if (!state.harness) return state;
      const harness = structuredClone(state.harness);
      const target = findMutableEntity(harness, entityType, entityId);
      if (target && !target.tags.includes(tag)) target.tags.push(tag);
      return { harness, isDirty: true };
    }),
  removeTag: (entityType, entityId, tag) =>
    set((state) => {
      if (!state.harness) return state;
      const harness = structuredClone(state.harness);
      const target = findMutableEntity(harness, entityType, entityId);
      if (target) target.tags = target.tags.filter((item) => item !== tag);
      return { harness, isDirty: true };
    }),

  toggleFilter: (namespace, value) =>
    set((state) => {
      const next = new Map(state.activeFilters);
      const values = new Set(next.get(namespace) ?? []);
      if (values.has(value)) values.delete(value);
      else values.add(value);
      if (values.size === 0) next.delete(namespace);
      else next.set(namespace, values);
      return { activeFilters: next };
    }),
  clearFilters: () => set({ activeFilters: new Map() }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  markClean: () => set({ isDirty: false }),

  getAllTagNamespaces: () => {
    const state = get();
    const harness = state.harness;
    if (!harness) return new Map();
    const result = collectAllTags([
      ...harness.enclosures,
      ...harness.connectors,
      ...harness.mergePoints,
      ...harness.paths,
      ...harness.signals,
    ]);
    const signalValues = result.get('signal') ?? new Set<string>();
    for (const signal of harness.signals) signalValues.add(signal.id.replace(/^sig_/, ''));
    if (signalValues.size > 0) result.set('signal', signalValues);
    const systemValues = result.get('system') ?? new Set<string>();
    for (const subsystem of Object.values(state.subsystems)) systemValues.add(subsystem.id);
    if (systemValues.size > 0) result.set('system', systemValues);
    return result;
  },
  getAllExistingTags: () => {
    const harness = get().harness;
    if (!harness) return [];
    const tagSet = new Set<string>();
    for (const item of [...harness.enclosures, ...harness.connectors, ...harness.mergePoints, ...harness.paths, ...harness.signals]) {
      for (const tag of item.tags) tagSet.add(tag);
    }
    return [...tagSet].sort();
  },
  getFilteredMatch: (tags) => itemMatchesFilters(tags, get().activeFilters),
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
  getParentName: (parentId) => {
    const harness = get().harness;
    if (!harness) return parentId;
    return harness.enclosures.find((item) => item.id === parentId)?.name ?? parentId;
  },
}));

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

const AUTO_SAVE_DELAY = 1000;
type AutoSaveType =
  | 'harness'
  | 'layouts'
  | 'library'
  | 'manufacturing'
  | 'subsystem';
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let autoSaveActive = false;
let pendingSaveTypes = new Set<AutoSaveType>();
let pendingSubsystemIds = new Set<string>();
let activeAutoSave: Promise<boolean> | null = null;

async function performAutoSave(
  what: Set<AutoSaveType>,
  subsystemIds: Set<string>,
): Promise<boolean> {
  const state = useHarnessStore.getState();
  if (!state.harness) return true;

  const nameParam = `?harness=${encodeURIComponent(state.activeHarnessName)}`;

  try {
    const saves: Promise<Response>[] = [];
    if (what.has('harness')) {
      saves.push(fetch(`/api/save-harness${nameParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.harness, null, 2),
      }));
    }
    if (what.has('layouts')) {
      saves.push(fetch(`/api/save-layouts${nameParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }, null, 2),
      }));
    }
    if (what.has('library') && state.connectorLibrary) {
      saves.push(fetch('/api/save-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.connectorLibrary, null, 2),
      }));
    }
    if (what.has('manufacturing')) {
      saves.push(fetch(`/api/save-manufacturing${nameParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.manufacturing, null, 2),
      }));
    }
    if (what.has('subsystem')) {
      for (const subsystemId of subsystemIds) {
        const subsystem = state.subsystems[subsystemId];
        if (!subsystem) continue;
        saves.push(fetch(`/api/subsystems/${encodeURIComponent(subsystem.id)}${nameParam}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subsystem, null, 2),
        }));
      }
    }
    const results = await Promise.all(saves);
    if (results.every((result) => result.ok)) {
      const current = useHarnessStore.getState();
      const unchangedSinceSave =
        (!what.has('harness') || current.harness === state.harness) &&
        (!what.has('layouts') || (
          current.nodeLayouts === state.nodeLayouts &&
          current.portLayouts === state.portLayouts &&
          current.sizeLayouts === state.sizeLayouts &&
          current.freePortLayouts === state.freePortLayouts &&
          current.backgroundLayouts === state.backgroundLayouts &&
          current.connectorTypeSizes === state.connectorTypeSizes &&
          current.textBoxLayouts === state.textBoxLayouts &&
          current.waypointLayouts === state.waypointLayouts &&
          current.junctionLayouts === state.junctionLayouts &&
          current.mergePointLayouts === state.mergePointLayouts &&
          current.rotationLayouts === state.rotationLayouts
        )) &&
        (!what.has('library') || current.connectorLibrary === state.connectorLibrary) &&
        (!what.has('manufacturing') || current.manufacturing === state.manufacturing) &&
        (!what.has('subsystem') || [...subsystemIds].every(
          (id) => current.subsystems[id] === state.subsystems[id],
        ));
      if (unchangedSinceSave) current.markClean();
      if (current.mutationError?.startsWith('Autosave failed:')) {
        current.setMutationError(null);
      }
      return true;
    } else {
      const failures = await Promise.all(results
        .filter((result) => !result.ok)
        .map(async (result) => {
          try {
            const body = await result.json() as { error?: string };
            return body.error ?? `${result.status} ${result.statusText}`;
          } catch {
            return `${result.status} ${result.statusText}`;
          }
        }));
      useHarnessStore.getState().setMutationError(`Autosave failed: ${failures.join('; ')}`);
      return false;
    }
  } catch (error) {
    useHarnessStore.getState().setMutationError(
      `Autosave failed: ${error instanceof Error ? error.message : 'API unavailable'}`,
    );
    return false;
  }
}

function startAutoSave(what: Set<AutoSaveType>, subsystemIds: Set<string>): Promise<boolean> {
  const previous = activeAutoSave;
  const save = (previous ?? Promise.resolve(true)).then(() => performAutoSave(what, subsystemIds));
  activeAutoSave = save;
  void save.then((saved) => {
    if (saved) return;
    for (const type of what) pendingSaveTypes.add(type);
    for (const id of subsystemIds) pendingSubsystemIds.add(id);
  }).finally(() => {
    if (activeAutoSave === save) activeAutoSave = null;
  });
  return save;
}

export async function flushAutoSave(): Promise<boolean> {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  if (activeAutoSave && !(await activeAutoSave)) return false;

  while (pendingSaveTypes.size > 0) {
    const toSave = pendingSaveTypes;
    const subsystemIds = pendingSubsystemIds;
    pendingSaveTypes = new Set();
    pendingSubsystemIds = new Set();
    if (!(await startAutoSave(toSave, subsystemIds))) return false;
  }
  return true;
}

export function initAutoSave() {
  if (autoSaveActive) return;
  autoSaveActive = true;

  useHarnessStore.subscribe((state, prev) => {
    const layoutChanged =
      state.nodeLayouts !== prev.nodeLayouts ||
      state.portLayouts !== prev.portLayouts ||
      state.sizeLayouts !== prev.sizeLayouts ||
      state.freePortLayouts !== prev.freePortLayouts ||
      state.backgroundLayouts !== prev.backgroundLayouts ||
      state.connectorTypeSizes !== prev.connectorTypeSizes ||
      state.textBoxLayouts !== prev.textBoxLayouts ||
      state.waypointLayouts !== prev.waypointLayouts ||
      state.junctionLayouts !== prev.junctionLayouts ||
      state.mergePointLayouts !== prev.mergePointLayouts ||
      state.rotationLayouts !== prev.rotationLayouts;
    const harnessChanged = state.harness !== prev.harness;
    const libraryChanged = state.connectorLibrary !== prev.connectorLibrary;
    const manufacturingChanged = state.manufacturing !== prev.manufacturing;
    const subsystemChanged = state.subsystems !== prev.subsystems;

    if (
      !layoutChanged
      && !harnessChanged
      && !libraryChanged
      && !manufacturingChanged
      && !subsystemChanged
    ) return;

    if (layoutChanged) pendingSaveTypes.add('layouts');
    if (harnessChanged) pendingSaveTypes.add('harness');
    if (libraryChanged) pendingSaveTypes.add('library');
    if (manufacturingChanged) pendingSaveTypes.add('manufacturing');
    if (subsystemChanged) {
      pendingSaveTypes.add('subsystem');
      for (const [id, document] of Object.entries(state.subsystems)) {
        if (document !== prev.subsystems[id]) pendingSubsystemIds.add(id);
      }
    }

    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      const toSave = pendingSaveTypes;
      const subsystemIds = pendingSubsystemIds;
      pendingSaveTypes = new Set();
      pendingSubsystemIds = new Set();
      void startAutoSave(toSave, subsystemIds);
    }, AUTO_SAVE_DELAY);
  });
}
