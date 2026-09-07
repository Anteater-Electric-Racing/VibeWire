import type {
  Enclosure,
  FreePortLayouts,
  SystemData,
  NodeLayout,
  PortLayouts,
  SizeLayouts,
  SubsystemDocument,
  SubsystemEntityLayout,
} from '../types';

/** System (hierarchy) canvas geometry used to seed subsystem placements. */
export interface SystemLayoutSource {
  nodeLayouts?: NodeLayout;
  sizeLayouts?: SizeLayouts;
  portLayouts?: PortLayouts;
  freePortLayouts?: FreePortLayouts;
}

const ROOT_FRAME_SIZE = { w: 520, h: 360 };
const NESTED_FRAME_MIN = { w: 280, h: 200 };
const FRAME_INTERIOR_PADDING = 16;

/** Container enclosure ids from `startId` upward (innermost first). */
export function collectAncestorContainerIds(
  system: Pick<SystemData, 'hierarchy'>,
  startId: string | null,
): string[] {
  const enclosureById = new Map(system.hierarchy.map((enclosure) => [enclosure.id, enclosure]));
  const chain: string[] = [];
  let current = startId;
  while (current) {
    const enclosure = enclosureById.get(current);
    if (!enclosure) break;
    if (enclosure.kind === 'enclosure') chain.push(enclosure.id);
    current = enclosure.parent;
  }
  return chain;
}

function rootFrameLayout(document: SubsystemDocument): SubsystemEntityLayout {
  const index = Object.keys(document.enclosures).length;
  return {
    x: 40 + (index % 3) * 560,
    y: 40 + Math.floor(index / 3) * 400,
    w: ROOT_FRAME_SIZE.w,
    h: ROOT_FRAME_SIZE.h,
  };
}

function nestedFrameLayout(
  system: Pick<SystemData, 'hierarchy'>,
  document: SubsystemDocument,
  parentId: string,
  parentLayout: SubsystemEntityLayout,
): SubsystemEntityLayout {
  const siblingCount = Object.keys(document.enclosures).filter((id) =>
    system.hierarchy.find((enclosure) => enclosure.id === id)?.parent === parentId
  ).length;
  const parentW = parentLayout.w ?? ROOT_FRAME_SIZE.w;
  const parentH = parentLayout.h ?? ROOT_FRAME_SIZE.h;
  return {
    x: 40 + siblingCount * 24,
    y: 40 + siblingCount * 24,
    w: Math.max(NESTED_FRAME_MIN.w, parentW - 80),
    h: Math.max(NESTED_FRAME_MIN.h, parentH - 80),
  };
}

function shiftedLayout(
  layout: SubsystemEntityLayout,
  deltaX: number,
  deltaY: number,
): SubsystemEntityLayout {
  if (deltaX === 0 && deltaY === 0) return layout;
  return {
    ...layout,
    x: layout.x + deltaX,
    y: layout.y + deltaY,
  };
}

export function enclosureLayoutFromSystem(
  enclosureId: string,
  kind: 'enclosure' | 'device',
  systemLayout: SystemLayoutSource | undefined,
  fallback: SubsystemEntityLayout,
): SubsystemEntityLayout {
  const position = systemLayout?.nodeLayouts?.[enclosureId];
  const size = systemLayout?.sizeLayouts?.[enclosureId];
  const layout: SubsystemEntityLayout = {
    x: position?.x ?? fallback.x,
    y: position?.y ?? fallback.y,
  };
  if (kind === 'enclosure') {
    layout.w = size?.w ?? fallback.w;
    layout.h = size?.h ?? fallback.h;
  }
  return layout;
}

export function connectorLayoutFromSystem(
  connectorId: string,
  systemLayout: SystemLayoutSource | undefined,
  fallback: SubsystemEntityLayout,
): SubsystemEntityLayout {
  const port = systemLayout?.portLayouts?.[connectorId] ?? systemLayout?.freePortLayouts?.[connectorId];
  const size = systemLayout?.sizeLayouts?.[connectorId];
  return {
    x: port?.x ?? fallback.x,
    y: port?.y ?? fallback.y,
    ...(size
      ? { w: size.w, h: size.h }
      : {
          ...(fallback.w !== undefined ? { w: fallback.w } : {}),
          ...(fallback.h !== undefined ? { h: fallback.h } : {}),
        }),
  };
}

function resolvedChildSize(
  layout: SubsystemEntityLayout,
  entityId: string,
  kind: 'enclosure' | 'device' | 'connector',
  systemLayout: SystemLayoutSource | undefined,
): { w: number; h: number } {
  if (kind === 'enclosure') {
    return {
      w: layout.w ?? systemLayout?.sizeLayouts?.[entityId]?.w ?? ROOT_FRAME_SIZE.w,
      h: layout.h ?? systemLayout?.sizeLayouts?.[entityId]?.h ?? ROOT_FRAME_SIZE.h,
    };
  }
  if (kind === 'device') {
    return {
      w: layout.w ?? systemLayout?.sizeLayouts?.[entityId]?.w ?? 220,
      h: layout.h ?? systemLayout?.sizeLayouts?.[entityId]?.h ?? 180,
    };
  }
  return {
    w: layout.w ?? systemLayout?.sizeLayouts?.[entityId]?.w ?? 96,
    h: layout.h ?? systemLayout?.sizeLayouts?.[entityId]?.h ?? 36,
  };
}

/**
 * Shift a frame's direct children into positive space and grow the frame so
 * the copied system interior is not clamped off the card.
 */
export function normalizeSubsystemFrameInterior(
  system: Pick<SystemData, 'hierarchy' | 'connectors'>,
  document: SubsystemDocument,
  frameId: string,
  systemLayout?: SystemLayoutSource,
): void {
  const frame = document.enclosures[frameId];
  if (!frame) return;
  const enclosureById = new Map(system.hierarchy.map((enclosure) => [enclosure.id, enclosure]));
  const representedDeviceIds = new Set(Object.keys(document.devices));
  const children: Array<{
    kind: 'enclosures' | 'devices' | 'connectors';
    id: string;
    layout: SubsystemEntityLayout;
    size: { w: number; h: number };
  }> = [];

  for (const [childId, layout] of Object.entries(document.enclosures)) {
    if (childId === frameId) continue;
    if (enclosureById.get(childId)?.parent !== frameId) continue;
    children.push({
      kind: 'enclosures',
      id: childId,
      layout,
      size: resolvedChildSize(layout, childId, 'enclosure', systemLayout),
    });
  }
  for (const [deviceId, layout] of Object.entries(document.devices)) {
    if (enclosureById.get(deviceId)?.parent !== frameId) continue;
    children.push({
      kind: 'devices',
      id: deviceId,
      layout,
      size: resolvedChildSize(layout, deviceId, 'device', systemLayout),
    });
  }
  for (const [connectorId, layout] of Object.entries(document.connectors)) {
    const connector = system.connectors.find((item) => item.id === connectorId);
    if (!connector) continue;
    const parentEntity = connector.parent ? enclosureById.get(connector.parent) : undefined;
    const isDirectFrameChild =
      connector.parent === frameId
      || (
        parentEntity?.kind === 'device'
        && parentEntity.parent === frameId
        && !representedDeviceIds.has(parentEntity.id)
      );
    if (!isDirectFrameChild) continue;
    children.push({
      kind: 'connectors',
      id: connectorId,
      layout,
      size: resolvedChildSize(layout, connectorId, 'connector', systemLayout),
    });
  }
  if (children.length === 0) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const child of children) {
    minX = Math.min(minX, child.layout.x);
    minY = Math.min(minY, child.layout.y);
    maxX = Math.max(maxX, child.layout.x + child.size.w);
    maxY = Math.max(maxY, child.layout.y + child.size.h);
  }

  const shiftX = minX < FRAME_INTERIOR_PADDING ? FRAME_INTERIOR_PADDING - minX : 0;
  const shiftY = minY < FRAME_INTERIOR_PADDING ? FRAME_INTERIOR_PADDING - minY : 0;
  if (shiftX !== 0 || shiftY !== 0) {
    for (const child of children) {
      document[child.kind][child.id] = shiftedLayout(child.layout, shiftX, shiftY);
    }
  }

  const neededW = maxX + shiftX + FRAME_INTERIOR_PADDING;
  const neededH = maxY + shiftY + FRAME_INTERIOR_PADDING;
  document.enclosures[frameId] = {
    ...document.enclosures[frameId],
    w: Math.max(document.enclosures[frameId].w ?? ROOT_FRAME_SIZE.w, neededW),
    h: Math.max(document.enclosures[frameId].h ?? ROOT_FRAME_SIZE.h, neededH),
  };
}

function enclosureDepth(
  enclosureById: Map<string, { parent: string | null }>,
  enclosureId: string,
): number {
  let depth = 0;
  let current: string | null = enclosureId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    current = enclosureById.get(current)?.parent ?? null;
    depth += 1;
  }
  return depth;
}

export function normalizeSubsystemFrameInteriors(
  system: Pick<SystemData, 'hierarchy' | 'connectors'>,
  document: SubsystemDocument,
  frameIds: Iterable<string>,
  systemLayout?: SystemLayoutSource,
): void {
  const enclosureById = new Map(system.hierarchy.map((enclosure) => [enclosure.id, enclosure]));
  const ordered = [...new Set(frameIds)].sort(
    (left, right) => enclosureDepth(enclosureById, right) - enclosureDepth(enclosureById, left),
  );
  for (const frameId of ordered) {
    normalizeSubsystemFrameInterior(system, document, frameId, systemLayout);
  }
}

/**
 * Ensure every container ancestor of `startId` (including `startId` when it is a
 * container) exists as a subsystem frame, creating outermost frames first so
 * nested boxes receive parent-relative layouts.
 */
export function ensureSubsystemAncestorFrames(
  system: Pick<SystemData, 'hierarchy'>,
  document: SubsystemDocument,
  startId: string | null,
  onFrame?: (enclosure: Enclosure) => void,
  systemLayout?: SystemLayoutSource,
): string[] {
  const createdFrameIds: string[] = [];
  const chain = collectAncestorContainerIds(system, startId);
  // Outermost → innermost so parents exist before nested children are laid out.
  for (const frameId of chain.slice().reverse()) {
    const enclosure = system.hierarchy.find((item) => item.id === frameId);
    if (enclosure?.kind !== 'enclosure') continue;
    if (!document.enclosures[frameId]) {
      const parentId = enclosure.parent;
      const parentLayout = parentId ? document.enclosures[parentId] : undefined;
      const fallback = parentId && parentLayout
        ? nestedFrameLayout(system, document, parentId, parentLayout)
        : rootFrameLayout(document);
      document.enclosures[frameId] = enclosureLayoutFromSystem(
        frameId,
        'enclosure',
        systemLayout,
        fallback,
      );
      createdFrameIds.push(frameId);
    }
    if (enclosure.kind === 'enclosure') onFrame?.(enclosure);
  }
  return createdFrameIds;
}

/** Rewrite existing subsystem membership geometry from the live system layout. */
export function applySystemPhysicalLayout(
  system: Pick<SystemData, 'hierarchy' | 'connectors'>,
  document: SubsystemDocument,
  systemLayout: SystemLayoutSource,
): SubsystemDocument {
  const next = structuredClone(document);
  const enclosureById = new Map(system.hierarchy.map((enclosure) => [enclosure.id, enclosure]));

  for (const [frameId, layout] of Object.entries(next.enclosures)) {
    if (enclosureById.get(frameId)?.kind !== 'enclosure') continue;
    next.enclosures[frameId] = enclosureLayoutFromSystem(frameId, 'enclosure', systemLayout, layout);
  }
  for (const [deviceId, layout] of Object.entries(next.devices)) {
    const entity = enclosureById.get(deviceId);
    if (!entity || entity.kind === 'enclosure') continue;
    next.devices[deviceId] = enclosureLayoutFromSystem(deviceId, 'device', systemLayout, {
      x: layout.x,
      y: layout.y,
    });
  }
  for (const [connectorId, layout] of Object.entries(next.connectors)) {
    next.connectors[connectorId] = connectorLayoutFromSystem(connectorId, systemLayout, layout);
  }

  normalizeSubsystemFrameInteriors(system, next, Object.keys(next.enclosures), systemLayout);
  return next;
}
