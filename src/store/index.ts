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
  Connector,
  Pin,
  Enclosure,
  PCB,
  Wire,
  Signal,
} from '../types';
import { collectAllTags, itemMatchesFilters } from '../lib/tags';

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
  selectedBundle: string[] | null;

  loadHarness: (data: HarnessData) => void;
  loadConnectorLibrary: (data: ConnectorLibrary) => void;
  loadLayouts: (layouts: NodeLayout) => void;
  loadPortLayouts: (ports: PortLayouts) => void;
  loadSizeLayouts: (sizes: SizeLayouts) => void;
  loadFreePortLayouts: (free: FreePortLayouts) => void;
  loadBackgroundLayouts: (bg: BackgroundLayouts) => void;
  updateBackground: (contextKey: string, patch: Partial<BackgroundLayout>) => void;
  removeBackground: (contextKey: string) => void;

  addTextBox: (x: number, y: number) => void;
  updateTextBox: (id: string, patch: Partial<Omit<TextBoxLayout, 'id'>>) => void;
  removeTextBox: (id: string) => void;

  selectItem: (item: SelectedItem | null) => void;
  toggleNodeExpanded: (nodeId: string) => void;

  updateNodePosition: (nodeId: string, x: number, y: number) => void;
  updatePortLayout: (connectorId: string, position: PortPosition) => void;
  updateNodeSize: (nodeId: string, w: number, h: number) => void;
  updateFreePortLayout: (connectorId: string, x: number, y: number) => void;

  setDrillDown: (encId: string | null) => void;
  setSelectedBundle: (wireIds: string[] | null) => void;

  loadConnectorTypeSizes: (sizes: ConnectorTypeSizes) => void;
  updateConnectorTypeSize: (typeId: string, w: number, h: number) => void;
  updateConnectorTypeImage: (typeId: string, image: string) => void;

  addTag: (entityType: string, entityId: string, tag: string) => void;
  updatePcbProperty: (pcbId: string, key: string, value: string) => void;
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
    | Enclosure | PCB | Connector | Pin | Wire | Signal | undefined;
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
  selectedBundle: null,

  loadHarness: (data) => set({ harness: data, isDirty: false }),
  loadConnectorLibrary: (data) => set({ connectorLibrary: data }),
  loadLayouts: (layouts) => set({ nodeLayouts: layouts }),
  loadPortLayouts: (ports) => set({ portLayouts: ports }),
  loadSizeLayouts: (sizes) => set({ sizeLayouts: sizes }),
  loadFreePortLayouts: (free) => set({ freePortLayouts: free }),
  loadBackgroundLayouts: (bg) => set({ backgroundLayouts: bg }),
  loadConnectorTypeSizes: (sizes) => set({ connectorTypeSizes: sizes }),
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
          x,
          y,
          w: 220,
          h: 110,
          text: 'Text',
          bgColor: '#1e293b',
          textColor: '#f8fafc',
          fontSize: 14,
        },
      },
    }));
  },

  updateTextBox: (id, patch) =>
    set((state) => {
      const prev = state.textBoxLayouts[id];
      if (!prev) return state;
      return {
        textBoxLayouts: {
          ...state.textBoxLayouts,
          [id]: { ...prev, ...patch },
        },
      };
    }),

  removeTextBox: (id) =>
    set((state) => {
      const next = { ...state.textBoxLayouts };
      delete next[id];
      return { textBoxLayouts: next };
    }),

  selectItem: (item) => set({ selectedItem: item, selectedBundle: null }),

  toggleNodeExpanded: (nodeId) =>
    set((state) => {
      const next = new Set(state.expandedNodes);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return { expandedNodes: next };
    }),

  updateNodePosition: (nodeId, x, y) =>
    set((state) => ({
      nodeLayouts: { ...state.nodeLayouts, [nodeId]: { x, y } },
    })),

  updatePortLayout: (connectorId, position) =>
    set((state) => ({
      portLayouts: { ...state.portLayouts, [connectorId]: position },
    })),

  updateNodeSize: (nodeId, w, h) =>
    set((state) => ({
      sizeLayouts: { ...state.sizeLayouts, [nodeId]: { w, h } },
    })),

  updateFreePortLayout: (connectorId, x, y) =>
    set((state) => ({
      freePortLayouts: { ...state.freePortLayouts, [connectorId]: { x, y } },
    })),

  setDrillDown: (encId) =>
    set({ drillDownEnclosure: encId, selectedItem: null, selectedBundle: null }),

  setSelectedBundle: (wireIds) =>
    set({ selectedBundle: wireIds, selectedItem: null }),

  addTag: (entityType, entityId, tag) =>
    set((state) => {
      if (!state.harness) return state;
      const h = structuredClone(state.harness);
      const target = findMutable(h, entityType, entityId);
      if (target && !target.tags.includes(tag)) {
        target.tags.push(tag);
      }
      return { harness: h, isDirty: true };
    }),

  removeTag: (entityType, entityId, tag) =>
    set((state) => {
      if (!state.harness) return state;
      const h = structuredClone(state.harness);
      const target = findMutable(h, entityType, entityId);
      if (target) {
        target.tags = target.tags.filter((t) => t !== tag);
      }
      return { harness: h, isDirty: true };
    }),

  updatePcbProperty: (pcbId, key, value) =>
    set((state) => {
      if (!state.harness) return state;
      const h = structuredClone(state.harness);
      const pcb = h.pcbs.find((p) => p.id === pcbId);
      if (pcb) {
        if (value === null || value === undefined || value === '') {
          delete pcb.properties[key];
        } else {
          pcb.properties[key] = value;
        }
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
      ...h.enclosures,
      ...h.pcbs,
      ...h.connectors,
      ...h.connectors.flatMap((c) => c.pins),
      ...h.wires,
      ...h.signals,
    ];
    return collectAllTags(allTagged);
  },

  getAllExistingTags: () => {
    const h = get().harness;
    if (!h) return [];
    const tagSet = new Set<string>();
    const addTags = (items: Array<{ tags: string[] }>) =>
      items.forEach((i) => i.tags.forEach((t) => tagSet.add(t)));
    addTags(h.enclosures);
    addTags(h.pcbs);
    addTags(h.connectors);
    addTags(h.connectors.flatMap((c) => c.pins));
    addTags(h.wires);
    addTags(h.signals);
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
      case 'enclosure':
        return h.enclosures.find((e) => e.id === id);
      case 'pcb':
        return h.pcbs.find((p) => p.id === id);
      case 'connector':
        return h.connectors.find((c) => c.id === id);
      case 'pin':
        for (const c of h.connectors) {
          const pin = c.pins.find((p) => p.id === id);
          if (pin) return pin;
        }
        return undefined;
      case 'wire':
        return h.wires.find((w) => w.id === id);
      case 'signal':
        return h.signals.find((s) => s.id === id);
      default:
        return undefined;
    }
  },

  getParentName: (parentId) => {
    const h = get().harness;
    if (!h) return parentId;
    const enc = h.enclosures.find((e) => e.id === parentId);
    if (enc) return enc.name;
    const pcb = h.pcbs.find((p) => p.id === parentId);
    if (pcb) return pcb.name;
    return parentId;
  },
}));

function findMutable(
  h: HarnessData,
  entityType: string,
  entityId: string,
): { tags: string[] } | undefined {
  switch (entityType) {
    case 'enclosure':
      return h.enclosures.find((e) => e.id === entityId);
    case 'pcb':
      return h.pcbs.find((p) => p.id === entityId);
    case 'connector':
      return h.connectors.find((c) => c.id === entityId);
    case 'pin':
      for (const c of h.connectors) {
        const pin = c.pins.find((p) => p.id === entityId);
        if (pin) return pin;
      }
      return undefined;
    case 'wire':
      return h.wires.find((w) => w.id === entityId);
    case 'signal':
      return h.signals.find((s) => s.id === entityId);
    default:
      return undefined;
  }
}
