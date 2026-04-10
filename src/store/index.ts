import { create } from 'zustand';
import type {
  HarnessData,
  ConnectorLibrary,
  SelectedItem,
  NodeLayout,
  PortPosition,
  PortLayouts,
  SizeLayouts,
  FreePortLayouts,
  BackgroundLayout,
  BackgroundLayouts,
  ConnectorTypeSizes,
  TextBoxLayout,
  TextBoxLayouts,
  TextBoxFontFamily,
  TextBoxFontWeight,
  TextBoxTextAlign,
  WaypointItem,
  WaypointLayouts,
  JunctionLayout,
  JunctionLayouts,
  Connector,
  Pin,
  Enclosure,
  Wire,
  Signal,
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

  loadHarness: (data: HarnessData) => void;
  loadConnectorLibrary: (data: ConnectorLibrary) => void;
  loadLayouts: (layouts: NodeLayout) => void;
  loadPortLayouts: (ports: PortLayouts) => void;
  loadSizeLayouts: (sizes: SizeLayouts) => void;
  loadFreePortLayouts: (free: FreePortLayouts) => void;
  loadBackgroundLayouts: (bg: BackgroundLayouts) => void;
  loadTextBoxLayouts: (tbs: TextBoxLayouts) => void;
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

  setDrillDown: (encId: string | null) => void;
  setSelectedBundle: (wireIds: string[] | null) => void;

  loadWaypointLayouts: (wps: WaypointLayouts) => void;
  setEdgeWaypoints: (edgeId: string, waypoints: WaypointItem[]) => void;
  clearEdgeWaypoints: (edgeId: string) => void;

  // Junction system
  loadJunctionLayouts: (junctions: JunctionLayouts) => void;
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

  findPinOwner: (pinId: string) => Connector | undefined;
  findEntity: (type: string, id: string) =>
    | Enclosure | Connector | Pin | Wire | Signal | undefined;
  getParentName: (parentId: string) => string;
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
  draggingEdgeInfo: null,
  undoStack: [],
  redoStack: [],

  loadHarness: (data) => {
    // Normalize: ensure tags/properties/parent defaults for all entities
    for (const enc of data.enclosures) {
      enc.tags ??= [];
      enc.properties ??= {};
      enc.container ??= true;
    }
    for (const conn of data.connectors) {
      conn.tags ??= [];
      conn.properties ??= {};
      conn.parent ??= null;
      for (const pin of conn.pins) {
        pin.tags ??= [];
        pin.properties ??= {};
      }
    }
    for (const w of data.wires) { w.tags ??= []; w.properties ??= {}; }
    for (const s of data.signals) { s.tags ??= []; s.properties ??= {}; }
    // Backward-compat: migrate old pcbs array
    if (Array.isArray((data as any).pcbs)) {
      for (const pcb of (data as any).pcbs) {
        data.enclosures.push({
          id: pcb.id,
          name: pcb.name,
          parent: pcb.parent ?? null,
          container: false,
          tags: pcb.tags ?? [],
          properties: pcb.properties ?? {},
        });
      }
      delete (data as any).pcbs;
    }
    set({ harness: data, isDirty: false });
  },
  loadConnectorLibrary: (data) => set({ connectorLibrary: data }),
  loadLayouts: (layouts) => set({ nodeLayouts: layouts }),
  loadPortLayouts: (ports) => {
    // Drop old {edge, ratio} format entries — keep only {x, y} format
    const clean: PortLayouts = {};
    for (const [k, v] of Object.entries(ports)) {
      if (typeof (v as any).x === 'number' && typeof (v as any).y === 'number') {
        clean[k] = v as PortPosition;
      }
    }
    set({ portLayouts: clean });
  },
  loadSizeLayouts: (sizes) => set({ sizeLayouts: sizes }),
  loadFreePortLayouts: (free) => set({ freePortLayouts: free }),
  loadBackgroundLayouts: (bg) => set({ backgroundLayouts: bg }),
  loadConnectorTypeSizes: (sizes) => set({ connectorTypeSizes: sizes }),
  loadTextBoxLayouts: (tbs) => set({ textBoxLayouts: tbs }),

  updateConnectorTypeSize: (typeId, w, h) =>
    set((state) => ({
      connectorTypeSizes: { ...state.connectorTypeSizes, [typeId]: { w: Math.round(w), h: Math.round(h) } },
    })),
  updateConnectorTypeImage: (typeId, image) =>
    set((state) => {
      if (!state.connectorLibrary) return state;
      const lib = structuredClone(state.connectorLibrary);
      const ct = lib.connector_types.find((t) => t.id === typeId);
      if (ct) ct.image = image;
      return { connectorLibrary: lib, isDirty: true };
    }),
  updateConnectorTypeSideImage: (typeId, image) =>
    set((state) => {
      if (!state.connectorLibrary) return state;
      const lib = structuredClone(state.connectorLibrary);
      const ct = lib.connector_types.find((t) => t.id === typeId);
      if (ct) ct.side_image = image;
      return { connectorLibrary: lib, isDirty: true };
    }),
  updateEnclosureProperty: (encId, key, value) =>
    set((state) => {
      if (!state.harness) return state;
      const h = structuredClone(state.harness);
      const enc = h.enclosures.find((e) => e.id === encId);
      if (enc) {
        if (!enc.properties) enc.properties = {};
        if (value === '') delete enc.properties[key];
        else enc.properties[key] = value;
      }
      return { harness: h, isDirty: true };
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
          id, x, y, w: 220, h: 110, text: 'Text',
          bgColor: '#1e293b', textColor: '#f8fafc', fontSize: 14,
          fontFamily: 'sans' as TextBoxFontFamily,
          fontWeight: 'normal' as TextBoxFontWeight,
          textAlign: 'left' as TextBoxTextAlign,
          borderColor: '#4b5563', borderWidth: 0, borderRadius: 4, opacity: 1, padding: 10,
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

  selectTextBox: (id) =>
    set({ selectedTextBoxId: id, selectedItem: null, selectedBundle: null }),

  selectItem: (item) => set({ selectedItem: item, selectedBundle: null, selectedTextBoxId: null }),

  toggleNodeExpanded: (nodeId) =>
    set((state) => {
      const next = new Set(state.expandedNodes);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return { expandedNodes: next };
    }),

  updateNodePosition: (nodeId, x, y) =>
    set((state) => ({ nodeLayouts: { ...state.nodeLayouts, [nodeId]: { x, y } } })),

  updatePortLayout: (connectorId, x, y) =>
    set((state) => ({ portLayouts: { ...state.portLayouts, [connectorId]: { x, y } } })),

  updateNodeSize: (nodeId, w, h) =>
    set((state) => ({ sizeLayouts: { ...state.sizeLayouts, [nodeId]: { w, h } } })),

  updateFreePortLayout: (connectorId, x, y) =>
    set((state) => ({ freePortLayouts: { ...state.freePortLayouts, [connectorId]: { x, y } } })),

  setDrillDown: (encId) =>
    set({ drillDownEnclosure: encId, selectedItem: null, selectedBundle: null }),

  setSelectedBundle: (wireIds) =>
    set({ selectedBundle: wireIds, selectedItem: null, selectedTextBoxId: null }),

  loadWaypointLayouts: (wps) => set({ waypointLayouts: wps }),

  setEdgeWaypoints: (edgeId, waypoints) =>
    set((state) => ({ waypointLayouts: { ...state.waypointLayouts, [edgeId]: waypoints } })),

  clearEdgeWaypoints: (edgeId) =>
    set((state) => {
      const next = { ...state.waypointLayouts };
      delete next[edgeId];
      return { waypointLayouts: next };
    }),

  // --- Junction system ---

  loadJunctionLayouts: (junctions) => set({ junctionLayouts: junctions }),

  createJunction: (pos, edgeId, waypointIndex) => {
    const id = `jct_${Date.now()}`;
    set((state) => {
      const wps = [...(state.waypointLayouts[edgeId] ?? [])];
      wps[waypointIndex] = { junctionId: id };
      return {
        junctionLayouts: {
          ...state.junctionLayouts,
          [id]: { id, x: pos.x, y: pos.y, memberEdgeIds: [edgeId] },
        },
        waypointLayouts: { ...state.waypointLayouts, [edgeId]: wps },
      };
    });
    return id;
  },

  moveJunction: (junctionId, pos) =>
    set((state) => {
      const j = state.junctionLayouts[junctionId];
      if (!j) return state;
      return {
        junctionLayouts: {
          ...state.junctionLayouts,
          [junctionId]: { ...j, x: pos.x, y: pos.y },
        },
      };
    }),

  deleteJunction: (junctionId) =>
    set((state) => {
      const j = state.junctionLayouts[junctionId];
      if (!j) return state;
      // Replace junction waypoints in all member edges with regular {x,y}
      const newWpLayouts = { ...state.waypointLayouts };
      for (const edgeId of j.memberEdgeIds) {
        const wps = newWpLayouts[edgeId];
        if (wps) {
          newWpLayouts[edgeId] = wps.map((wp) =>
            'junctionId' in wp && wp.junctionId === junctionId
              ? { x: j.x, y: j.y }
              : wp,
          );
        }
      }
      const newJunctions = { ...state.junctionLayouts };
      delete newJunctions[junctionId];
      return { junctionLayouts: newJunctions, waypointLayouts: newWpLayouts };
    }),

  linkEdgeToJunction: (junctionId, edgeId, insertAfterIndex, _pos) =>
    set((state) => {
      const j = state.junctionLayouts[junctionId];
      if (!j || j.memberEdgeIds.includes(edgeId)) return state;
      const wps = [...(state.waypointLayouts[edgeId] ?? [])];
      const insertAt = Math.min(wps.length, Math.max(0, insertAfterIndex + 1));
      wps.splice(insertAt, 0, { junctionId });
      return {
        junctionLayouts: {
          ...state.junctionLayouts,
          [junctionId]: { ...j, memberEdgeIds: [...j.memberEdgeIds, edgeId] },
        },
        waypointLayouts: { ...state.waypointLayouts, [edgeId]: wps },
      };
    }),

  unlinkEdgeFromJunction: (junctionId, edgeId) =>
    set((state) => {
      const j = state.junctionLayouts[junctionId];
      if (!j) return state;
      const wps = (state.waypointLayouts[edgeId] ?? []).map((wp) =>
        'junctionId' in wp && wp.junctionId === junctionId
          ? { x: j.x, y: j.y }
          : wp,
      );
      const remaining = j.memberEdgeIds.filter((id) => id !== edgeId);
      if (remaining.length === 0) {
        const newJ = { ...state.junctionLayouts };
        delete newJ[junctionId];
        return {
          junctionLayouts: newJ,
          waypointLayouts: { ...state.waypointLayouts, [edgeId]: wps },
        };
      }
      return {
        junctionLayouts: {
          ...state.junctionLayouts,
          [junctionId]: { ...j, memberEdgeIds: remaining },
        },
        waypointLayouts: { ...state.waypointLayouts, [edgeId]: wps },
      };
    }),

  findJunctionForEdgeWaypoint: (edgeId, waypointIndex) => {
    const state = get();
    const wps = state.waypointLayouts[edgeId];
    if (!wps) return undefined;
    const wp = wps[waypointIndex];
    if (!wp || !('junctionId' in wp)) return undefined;
    return state.junctionLayouts[wp.junctionId];
  },

  getJunctionsForEdge: (edgeId) => {
    const state = get();
    const wps = state.waypointLayouts[edgeId];
    if (!wps) return [];
    return wps
      .filter((wp): wp is { junctionId: string } => 'junctionId' in wp)
      .map((wp) => state.junctionLayouts[wp.junctionId])
      .filter(Boolean) as JunctionLayout[];
  },

  setDraggingEdgeInfo: (info) => set({ draggingEdgeInfo: info }),

  pushUndoSnapshot: () =>
    set((state) => {
      const snapshot: LayoutSnapshot = {
        nodeLayouts: state.nodeLayouts,
        portLayouts: state.portLayouts,
        sizeLayouts: state.sizeLayouts,
        freePortLayouts: state.freePortLayouts,
        backgroundLayouts: state.backgroundLayouts,
        connectorTypeSizes: state.connectorTypeSizes,
        textBoxLayouts: state.textBoxLayouts,
        waypointLayouts: state.waypointLayouts,
        junctionLayouts: state.junctionLayouts,
      };
      const next = [...state.undoStack, snapshot];
      if (next.length > MAX_HISTORY) next.shift();
      return { undoStack: next, redoStack: [] };
    }),

  undo: () =>
    set((state) => {
      if (state.undoStack.length === 0) return state;
      const prev = state.undoStack[state.undoStack.length - 1];
      const current: LayoutSnapshot = {
        nodeLayouts: state.nodeLayouts,
        portLayouts: state.portLayouts,
        sizeLayouts: state.sizeLayouts,
        freePortLayouts: state.freePortLayouts,
        backgroundLayouts: state.backgroundLayouts,
        connectorTypeSizes: state.connectorTypeSizes,
        textBoxLayouts: state.textBoxLayouts,
        waypointLayouts: state.waypointLayouts,
        junctionLayouts: state.junctionLayouts,
      };
      return {
        ...prev,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, current],
      };
    }),

  redo: () =>
    set((state) => {
      if (state.redoStack.length === 0) return state;
      const next = state.redoStack[state.redoStack.length - 1];
      const current: LayoutSnapshot = {
        nodeLayouts: state.nodeLayouts,
        portLayouts: state.portLayouts,
        sizeLayouts: state.sizeLayouts,
        freePortLayouts: state.freePortLayouts,
        backgroundLayouts: state.backgroundLayouts,
        connectorTypeSizes: state.connectorTypeSizes,
        textBoxLayouts: state.textBoxLayouts,
        waypointLayouts: state.waypointLayouts,
        junctionLayouts: state.junctionLayouts,
      };
      return {
        ...next,
        undoStack: [...state.undoStack, current],
        redoStack: state.redoStack.slice(0, -1),
      };
    }),

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  addTag: (entityType, entityId, tag) =>
    set((state) => {
      if (!state.harness) return state;
      const h = structuredClone(state.harness);
      const target = findMutable(h, entityType, entityId);
      if (target && !target.tags.includes(tag)) target.tags.push(tag);
      return { harness: h, isDirty: true };
    }),

  removeTag: (entityType, entityId, tag) =>
    set((state) => {
      if (!state.harness) return state;
      const h = structuredClone(state.harness);
      const target = findMutable(h, entityType, entityId);
      if (target) target.tags = target.tags.filter((t) => t !== tag);
      return { harness: h, isDirty: true };
    }),

  updateConnectorProperty: (conId, key, value) =>
    set((state) => {
      if (!state.harness) return state;
      const h = structuredClone(state.harness);
      const con = h.connectors.find((c) => c.id === conId);
      if (con) {
        if (!con.properties) con.properties = {};
        if (value === '') delete con.properties[key];
        else con.properties[key] = value;
      }
      return { harness: h, isDirty: true };
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
    const h = get().harness;
    if (!h) return new Map();
    const allTagged: Array<{ tags: string[] }> = [
      ...h.enclosures, ...h.connectors,
      ...h.connectors.flatMap((c) => c.pins), ...h.wires, ...h.signals,
    ];
    return collectAllTags(allTagged);
  },

  getAllExistingTags: () => {
    const h = get().harness;
    if (!h) return [];
    const tagSet = new Set<string>();
    const addTags = (items: Array<{ tags: string[] }>) =>
      items.forEach((i) => i.tags.forEach((t) => tagSet.add(t)));
    addTags(h.enclosures); addTags(h.connectors);
    addTags(h.connectors.flatMap((c) => c.pins)); addTags(h.wires); addTags(h.signals);
    return Array.from(tagSet).sort();
  },

  getFilteredMatch: (tags) => itemMatchesFilters(tags, get().activeFilters),

  findPinOwner: (pinId) => {
    const h = get().harness;
    if (!h) return undefined;
    return h.connectors.find((c) => c.pins.some((p) => p.id === pinId));
  },

  findEntity: (type, id) => {
    const h = get().harness;
    if (!h) return undefined;
    switch (type) {
      case 'enclosure': return h.enclosures.find((e) => e.id === id);
      case 'connector': return h.connectors.find((c) => c.id === id);
      case 'pin':
        for (const c of h.connectors) {
          const pin = c.pins.find((p) => p.id === id);
          if (pin) return pin;
        }
        return undefined;
      case 'wire': return h.wires.find((w) => w.id === id);
      case 'signal': return h.signals.find((s) => s.id === id);
      default: return undefined;
    }
  },

  getParentName: (parentId) => {
    const h = get().harness;
    if (!h) return parentId;
    const enc = h.enclosures.find((e) => e.id === parentId);
    if (enc) return enc.name;
    return parentId;
  },
}));

function findMutable(
  h: HarnessData,
  entityType: string,
  entityId: string,
): { tags: string[] } | undefined {
  switch (entityType) {
    case 'enclosure': return h.enclosures.find((e) => e.id === entityId);
    case 'connector': return h.connectors.find((c) => c.id === entityId);
    case 'pin':
      for (const c of h.connectors) {
        const pin = c.pins.find((p) => p.id === entityId);
        if (pin) return pin;
      }
      return undefined;
    case 'wire': return h.wires.find((w) => w.id === entityId);
    case 'signal': return h.signals.find((s) => s.id === entityId);
    default: return undefined;
  }
}

// ─── Auto-save ────────────────────────────────────────────────────────────────

const AUTO_SAVE_DELAY = 1000;
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let autoSaveActive = false;

async function performAutoSave(
  what: Set<'harness' | 'layouts' | 'library'>,
) {
  const s = useHarnessStore.getState();
  if (!s.harness) return;

  try {
    const saves: Promise<Response>[] = [];

    if (what.has('harness')) {
      saves.push(fetch('/api/save-harness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s.harness, null, 2),
      }));
    }

    if (what.has('layouts')) {
      saves.push(fetch('/api/save-layouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: s.nodeLayouts,
          ports: s.portLayouts,
          sizes: s.sizeLayouts,
          free: s.freePortLayouts,
          backgrounds: s.backgroundLayouts,
          connectorTypeSizes: s.connectorTypeSizes,
          textBoxes: s.textBoxLayouts,
          waypoints: s.waypointLayouts,
          junctions: s.junctionLayouts,
        }, null, 2),
      }));
    }

    if (what.has('library') && s.connectorLibrary) {
      saves.push(fetch('/api/save-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s.connectorLibrary, null, 2),
      }));
    }

    const results = await Promise.all(saves);
    if (results.every((r) => r.ok)) {
      s.markClean();
    }
  } catch {
    // server not available — silently skip
  }
}

let pendingSaveTypes = new Set<'harness' | 'layouts' | 'library'>();

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
      state.junctionLayouts !== prev.junctionLayouts;

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
      performAutoSave(toSave);
    }, AUTO_SAVE_DELAY);
  });
}
