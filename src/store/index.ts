import { create } from 'zustand';
import type {
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
  MergePoint,
  MergePointLayouts,
  NodeLayout,
  Path,
  PortLayouts,
  SelectedItem,
  Signal,
  SizeLayouts,
  TextBoxFontFamily,
  TextBoxFontWeight,
  TextBoxLayout,
  TextBoxLayouts,
  TextBoxTextAlign,
  WaypointItem,
  WaypointLayouts,
} from '../types';
import { collectAllTags, itemMatchesFilters } from '../lib/tags';

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
}

const MAX_HISTORY = 60;

interface HarnessStore {
  harness: HarnessData | null;
  connectorLibrary: ConnectorLibrary | null;
  selectedItem: SelectedItem | null;
  nodeLayouts: NodeLayout;
  isDirty: boolean;
  expandedNodes: Set<string>;
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
  waypointLayouts: WaypointLayouts;
  junctionLayouts: JunctionLayouts;
  mergePointLayouts: MergePointLayouts;

  loadHarness: (data: HarnessData) => void;
  loadConnectorLibrary: (data: ConnectorLibrary) => void;
  loadLayouts: (layouts: NodeLayout) => void;
  loadPortLayouts: (ports: PortLayouts) => void;
  loadSizeLayouts: (sizes: SizeLayouts) => void;
  loadFreePortLayouts: (free: FreePortLayouts) => void;
  loadBackgroundLayouts: (bg: BackgroundLayouts) => void;
  loadTextBoxLayouts: (tbs: TextBoxLayouts) => void;
  loadWaypointLayouts: (wps: WaypointLayouts) => void;
  loadJunctionLayouts: (junctions: JunctionLayouts) => void;
  loadMergePointLayouts: (layouts: MergePointLayouts) => void;

  updateBackground: (contextKey: string, patch: Partial<BackgroundLayout>) => void;
  removeBackground: (contextKey: string) => void;

  addTextBox: (x: number, y: number) => void;
  updateTextBox: (id: string, patch: Partial<Omit<TextBoxLayout, 'id'>>) => void;
  removeTextBox: (id: string) => void;
  selectTextBox: (id: string | null) => void;

  selectItem: (item: SelectedItem | null) => void;
  toggleNodeExpanded: (nodeId: string) => void;

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
  updateConnectorTypeImage: (typeId: string, image: string) => void;
  updateConnectorTypeSideImage: (typeId: string, image: string) => void;
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
  };
}

export const useHarnessStore = create<HarnessStore>((set, get) => ({
  harness: null,
  connectorLibrary: null,
  selectedItem: null,
  nodeLayouts: {},
  isDirty: false,
  expandedNodes: new Set<string>(),
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
  waypointLayouts: {},
  junctionLayouts: {},
  mergePointLayouts: {},
  draggingEdgeInfo: null,
  undoStack: [],
  redoStack: [],

  loadHarness: (data) => set({ harness: normalizeHarness(data), isDirty: false }),
  loadConnectorLibrary: (data) => set({ connectorLibrary: data }),
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
  selectTextBox: (id) => set({ selectedTextBoxId: id, selectedItem: null, selectedBundle: null }),

  selectItem: (item) => set({ selectedItem: item, selectedBundle: null, selectedTextBoxId: null }),
  toggleNodeExpanded: (nodeId) =>
    set((state) => {
      const next = new Set(state.expandedNodes);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return { expandedNodes: next };
    }),

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

  setDrillDown: (encId) => set({ drillDownEnclosure: encId, selectedItem: null, selectedBundle: null, selectedTextBoxId: null }),
  setSelectedBundle: (pathIds) => set({ selectedBundle: pathIds, selectedItem: null, selectedTextBoxId: null }),

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
      return {
        junctionLayouts: {
          ...state.junctionLayouts,
          [id]: { id, x: pos.x, y: pos.y, memberEdgeIds: [edgeId] },
        },
        waypointLayouts: { ...state.waypointLayouts, [edgeId]: waypoints },
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
      return { junctionLayouts: nextJunctions, waypointLayouts };
    }),
  linkEdgeToJunction: (junctionId, edgeId, insertAfterIndex) =>
    set((state) => {
      const junction = state.junctionLayouts[junctionId];
      if (!junction || junction.memberEdgeIds.includes(edgeId)) return state;
      const waypoints = [...(state.waypointLayouts[edgeId] ?? [])];
      const insertAt = Math.min(waypoints.length, Math.max(0, insertAfterIndex + 1));
      waypoints.splice(insertAt, 0, { junctionId });
      return {
        junctionLayouts: {
          ...state.junctionLayouts,
          [junctionId]: { ...junction, memberEdgeIds: [...junction.memberEdgeIds, edgeId] },
        },
        waypointLayouts: { ...state.waypointLayouts, [edgeId]: waypoints },
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
      if (remaining.length === 0) {
        const nextJunctions = { ...state.junctionLayouts };
        delete nextJunctions[junctionId];
        return {
          junctionLayouts: nextJunctions,
          waypointLayouts: { ...state.waypointLayouts, [edgeId]: waypoints },
        };
      }
      return {
        junctionLayouts: {
          ...state.junctionLayouts,
          [junctionId]: { ...junction, memberEdgeIds: remaining },
        },
        waypointLayouts: { ...state.waypointLayouts, [edgeId]: waypoints },
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
        ...prev,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, makeSnapshot(state)],
      };
    }),
  redo: () =>
    set((state) => {
      if (state.redoStack.length === 0) return state;
      const next = state.redoStack[state.redoStack.length - 1];
      return {
        ...next,
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
  updateConnectorTypeImage: (typeId, image) =>
    set((state) => {
      if (!state.connectorLibrary) return state;
      const library = structuredClone(state.connectorLibrary);
      const connectorType = library.connector_types.find((item) => item.id === typeId);
      if (connectorType) connectorType.image = image || undefined;
      return { connectorLibrary: library, isDirty: true };
    }),
  updateConnectorTypeSideImage: (typeId, image) =>
    set((state) => {
      if (!state.connectorLibrary) return state;
      const library = structuredClone(state.connectorLibrary);
      const connectorType = library.connector_types.find((item) => item.id === typeId);
      if (connectorType) connectorType.side_image = image || undefined;
      return { connectorLibrary: library, isDirty: true };
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
    const harness = get().harness;
    if (!harness) return new Map();
    return collectAllTags([
      ...harness.enclosures,
      ...harness.connectors,
      ...harness.mergePoints,
      ...harness.paths,
      ...harness.signals,
    ]);
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
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let autoSaveActive = false;
let pendingSaveTypes = new Set<'harness' | 'layouts' | 'library'>();

async function performAutoSave(what: Set<'harness' | 'layouts' | 'library'>) {
  const state = useHarnessStore.getState();
  if (!state.harness) return;

  try {
    const saves: Promise<Response>[] = [];
    if (what.has('harness')) {
      saves.push(fetch('/api/save-harness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.harness, null, 2),
      }));
    }
    if (what.has('layouts')) {
      saves.push(fetch('/api/save-layouts', {
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
    const results = await Promise.all(saves);
    if (results.every((result) => result.ok)) {
      state.markClean();
    }
  } catch {
    // Keep autosave silent when the API is unavailable.
  }
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
      state.mergePointLayouts !== prev.mergePointLayouts;
    const harnessChanged = state.harness !== prev.harness;
    const libraryChanged = state.connectorLibrary !== prev.connectorLibrary;

    if (!layoutChanged && !harnessChanged && !libraryChanged) return;

    if (layoutChanged) pendingSaveTypes.add('layouts');
    if (harnessChanged) pendingSaveTypes.add('harness');
    if (libraryChanged) pendingSaveTypes.add('library');

    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      const toSave = pendingSaveTypes;
      pendingSaveTypes = new Set();
      void performAutoSave(toSave);
    }, AUTO_SAVE_DELAY);
  });
}
