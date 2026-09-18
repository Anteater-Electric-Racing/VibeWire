import {
  BULKHEAD_DOT_SIZE,
  DEFAULT_BULKHEAD_SIZE,
} from './bulkheadRouting';
import { projectNodeToEnclosureWall, type GraphRect } from './parentResize';

export type RoutingDraftKind = 'dot' | 'bulkhead';

export type RoutingPreviewPoint = { x: number; y: number };

export type RoutingPreviewTarget = {
  nodeId: string;
  entityId: string;
  kind: 'device' | 'enclosure';
  rect: GraphRect;
};

export type RoutingPreviewExisting = {
  rect: GraphRect;
  isDot: boolean;
};

export type RoutingDraftPreview = {
  kind: RoutingDraftKind;
  parentId: string;
  parentNodeId: string;
  parentIsContainer: boolean;
  /** Relative to the parent node, or sheet-absolute when `layout` is `free`. */
  position: RoutingPreviewPoint;
  center: RoutingPreviewPoint;
  size: { w: number; h: number };
  layout: 'port' | 'free';
};

/** Cursor must be this close to a wall to preview a visual dot. */
export const ROUTING_WALL_BAND_PX = 16;
/**
 * Stay this far from an existing pass-through before offering a new draft.
 * Creates a dead zone so a nearby dot or bulkhead is not an accidental drop.
 */
export const ROUTING_EXISTING_EXCLUSION_PX = 36;
/** Existing visual dots only accept a drop this close to their center. */
export const ROUTING_EXISTING_DOT_SNAP_PX = 10;
/** Blank-space bulkheads magnet to a nearby box within this distance. */
export const ROUTING_BULKHEAD_MAGNET_PX = 80;

export function distanceToRect(point: RoutingPreviewPoint, rect: GraphRect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.w));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.h));
  return Math.hypot(dx, dy);
}

export function distanceToRectBoundary(point: RoutingPreviewPoint, rect: GraphRect): number {
  const outsideDistance = distanceToRect(point, rect);
  if (outsideDistance > 0) return outsideDistance;
  return Math.min(
    point.x - rect.x,
    rect.x + rect.w - point.x,
    point.y - rect.y,
    rect.y + rect.h - point.y,
  );
}

export function rectCenter(rect: GraphRect): RoutingPreviewPoint {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function tooCloseToExisting(
  cursor: RoutingPreviewPoint,
  existing: readonly RoutingPreviewExisting[],
): boolean {
  return existing.some((item) => {
    if (item.isDot) {
      const center = rectCenter(item.rect);
      return Math.hypot(cursor.x - center.x, cursor.y - center.y) <= ROUTING_EXISTING_EXCLUSION_PX;
    }
    return distanceToRect(cursor, item.rect) <= ROUTING_EXISTING_EXCLUSION_PX;
  });
}

function wallDraft(
  target: RoutingPreviewTarget,
  cursor: RoutingPreviewPoint,
  kind: RoutingDraftKind,
): RoutingDraftPreview {
  const size = kind === 'dot' ? { w: BULKHEAD_DOT_SIZE, h: BULKHEAD_DOT_SIZE } : DEFAULT_BULKHEAD_SIZE;
  const relative = {
    x: cursor.x - target.rect.x - size.w / 2,
    y: cursor.y - target.rect.y - size.h / 2,
  };
  const position = projectNodeToEnclosureWall(relative, size, {
    w: target.rect.w,
    h: target.rect.h,
  });
  return {
    kind,
    parentId: target.entityId,
    parentNodeId: target.nodeId,
    parentIsContainer: target.kind === 'enclosure',
    position,
    center: {
      x: target.rect.x + position.x + size.w / 2,
      y: target.rect.y + position.y + size.h / 2,
    },
    size,
    layout: 'port',
  };
}

function freeDraft(
  parentId: string,
  cursor: RoutingPreviewPoint,
): RoutingDraftPreview {
  const size = DEFAULT_BULKHEAD_SIZE;
  return {
    kind: 'bulkhead',
    parentId,
    parentNodeId: '',
    parentIsContainer: true,
    position: {
      x: cursor.x - size.w / 2,
      y: cursor.y - size.h / 2,
    },
    center: cursor,
    size,
    layout: 'free',
  };
}

/**
 * Decide whether a routing cursor should preview a wall visual dot, a greyed
 * bulkhead, or nothing. Callers pass already-resolved absolute rects.
 */
export function resolveRoutingDraftPreview(input: {
  cursor: RoutingPreviewPoint;
  targets: readonly RoutingPreviewTarget[];
  existing: readonly RoutingPreviewExisting[];
  sheetParentId: string | null;
  routing: boolean;
}): RoutingDraftPreview | null {
  if (tooCloseToExisting(input.cursor, input.existing)) return null;

  const ranked = input.targets
    .map((target) => ({
      target,
      wallDistance: distanceToRectBoundary(input.cursor, target.rect),
      area: target.rect.w * target.rect.h,
      inside: distanceToRect(input.cursor, target.rect) === 0,
    }))
    .sort((left, right) => {
      if (left.inside !== right.inside) return left.inside ? -1 : 1;
      if (left.wallDistance !== right.wallDistance) return left.wallDistance - right.wallDistance;
      return left.area - right.area;
    });
  const nearest = ranked[0];

  if (nearest && nearest.wallDistance <= ROUTING_WALL_BAND_PX) {
    return wallDraft(nearest.target, input.cursor, 'dot');
  }

  if (!input.routing) return null;

  if (nearest && (nearest.inside || nearest.wallDistance <= ROUTING_BULKHEAD_MAGNET_PX)) {
    return wallDraft(nearest.target, input.cursor, 'bulkhead');
  }

  if (input.sheetParentId) {
    return freeDraft(input.sheetParentId, input.cursor);
  }

  return null;
}

export type RoutingDraftPlacement = RoutingDraftPreview & { id: string };
type RoutingEndpoint = { connector_id: string; pin_number: number };

/** Commit the same destination offered by a draft-origin drag preview. */
export function resolveDraftRouteDrop(
  source: RoutingDraftPlacement,
  endpoint: RoutingEndpoint | null,
  preview: RoutingDraftPreview | null,
  createId: () => string = () => `con_${crypto.randomUUID()}`,
): { from: RoutingEndpoint; to: RoutingEndpoint; drafts: RoutingDraftPlacement[] } | null {
  const from = { connector_id: source.id, pin_number: 1 };
  if (endpoint) {
    if (endpoint.connector_id === source.id) return null;
    return { from, to: endpoint, drafts: [source] };
  }
  if (!preview) return null;
  const target = { ...preview, id: createId() };
  return { from, to: { connector_id: target.id, pin_number: 1 }, drafts: [source, target] };
}
