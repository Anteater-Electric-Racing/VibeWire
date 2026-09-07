/**
 * Pure Shared Anchor / Branch Point join and conversion.
 * Store actions wrap these in one undoable historyPatch.
 */
import type {
  BranchPoint,
  BranchPointLayouts,
  SharedAnchorLayout,
  SharedAnchorLayouts,
  SystemData,
  WaypointItem,
  WaypointLayouts,
} from '../types';
import type { JoinKind } from './joinChoice';
import {
  canonicalizeHarnessBundleId,
  deriveHarnessBundles,
  deriveWires,
  dissolveBranchPoint,
  getHarnessBundleLayoutId,
  getHarnessBundleLayoutValue,
  getPathNodeHarnessBundleKey,
  insertBranchPointOnPath,
  nextBranchPointId,
  nextBranchPointName,
  parseHarnessBundleId,
  removeBranchFromPath,
} from './systemTopology';

export interface SharedAnchorDocument {
  system: SystemData | null;
  waypointLayouts: WaypointLayouts;
  sharedAnchors: SharedAnchorLayouts;
  branchPointLayouts: BranchPointLayouts;
  openEnclosureId: string | null;
}

export function sharedAnchorIsBranch(anchor: SharedAnchorLayout | undefined): boolean {
  return !!anchor?.branchPointId;
}

function layoutKey(edgeId: string): string {
  return getHarnessBundleLayoutId(edgeId);
}

function writeWaypoints(
  waypoints: WaypointLayouts,
  edgeId: string,
  items: WaypointItem[],
): WaypointLayouts {
  return { ...waypoints, [layoutKey(edgeId)]: items };
}

function readWaypoints(waypoints: WaypointLayouts, edgeId: string): WaypointItem[] {
  return [...(getHarnessBundleLayoutValue(waypoints, edgeId) ?? [])];
}

function contextKey(openEnclosureId: string | null): string {
  return openEnclosureId ?? 'graph';
}

function incidentBundleIds(system: SystemData, branchPointId: string): string[] {
  const ref = `branch:${branchPointId}`;
  const ids = new Set<string>();
  for (const bundle of deriveHarnessBundles(deriveWires(system))) {
    const parsed = parseHarnessBundleId(bundle.id);
    if (!parsed) continue;
    if (parsed.sourceRefKey === ref || parsed.targetRefKey === ref) {
      ids.add(getHarnessBundleLayoutId(bundle.id));
    }
  }
  return [...ids];
}

function resultingBundleIdsAfterDemote(system: SystemData, branchPointId: string): string[] {
  const ids = new Set<string>();
  for (const path of system.paths) {
    for (let index = 0; index < path.nodes.length; index += 1) {
      const node = path.nodes[index];
      if (node.kind !== 'branch' || node.branch_point_id !== branchPointId) continue;
      const prev = path.nodes[index - 1];
      const next = path.nodes[index + 1];
      if (!prev || !next) continue;
      const left = getPathNodeHarnessBundleKey(prev);
      const right = getPathNodeHarnessBundleKey(next);
      const base = left <= right ? `bundle:${left}|${right}` : `bundle:${right}|${left}`;
      ids.add(canonicalizeHarnessBundleId(base));
    }
  }
  return [...ids];
}

function dropWaypointKeys(waypoints: WaypointLayouts, edgeIds: readonly string[]): WaypointLayouts {
  const next = { ...waypoints };
  for (const edgeId of edgeIds) {
    delete next[edgeId];
    delete next[layoutKey(edgeId)];
    delete next[canonicalizeHarnessBundleId(edgeId)];
  }
  return next;
}

function ensureWaypointOnBundle(
  waypoints: WaypointLayouts,
  edgeId: string,
  sharedAnchorId: string,
): WaypointLayouts {
  const items = readWaypoints(waypoints, edgeId);
  if (items.some((item) => 'sharedAnchorId' in item && item.sharedAnchorId === sharedAnchorId)) {
    return writeWaypoints(waypoints, edgeId, items);
  }
  return writeWaypoints(waypoints, edgeId, [...items, { sharedAnchorId }]);
}

export function createVisualSharedAnchor(
  document: SharedAnchorDocument,
  pos: { x: number; y: number },
  edgeId: string,
  waypointIndex: number,
  id: string,
): SharedAnchorDocument {
  const layoutId = layoutKey(edgeId);
  const waypoints = readWaypoints(document.waypointLayouts, layoutId);
  if (waypoints[waypointIndex]) {
    waypoints[waypointIndex] = { sharedAnchorId: id };
  } else {
    waypoints.push({ sharedAnchorId: id });
  }
  return {
    ...document,
    waypointLayouts: writeWaypoints(document.waypointLayouts, layoutId, waypoints),
    sharedAnchors: {
      ...document.sharedAnchors,
      [id]: { id, x: pos.x, y: pos.y, memberEdgeIds: [layoutId] },
    },
  };
}

export function linkVisualOrBranchAnchor(
  document: SharedAnchorDocument,
  sharedAnchorId: string,
  edgeId: string,
  insertAfterIndex: number,
): SharedAnchorDocument {
  const layoutId = layoutKey(edgeId);
  const sharedAnchor = document.sharedAnchors[sharedAnchorId];
  if (
    !sharedAnchor
    || sharedAnchor.memberEdgeIds.includes(layoutId)
    || sharedAnchor.memberEdgeIds.includes(edgeId)
  ) {
    return document;
  }
  const waypoints = readWaypoints(document.waypointLayouts, layoutId);
  const insertAt = Math.min(waypoints.length, Math.max(0, insertAfterIndex + 1));
  waypoints.splice(insertAt, 0, { sharedAnchorId });
  let nextSystem = document.system;
  let nextWaypointLayouts = writeWaypoints(document.waypointLayouts, layoutId, waypoints);
  const branchPointId = sharedAnchor.branchPointId;
  if (nextSystem && branchPointId) {
    const parsed = parseHarnessBundleId(layoutId);
    if (parsed) {
      const updatedPaths = nextSystem.paths.map((path) => {
          const alreadyLinked = path.nodes.some(
          (node) => node.kind === 'branch' && node.branch_point_id === branchPointId,
        );
        return alreadyLinked
          ? path
          : insertBranchPointOnPath(path, layoutId, branchPointId);
      });
      if (updatedPaths.some((path, index) => path !== nextSystem!.paths[index])) {
        nextSystem = { ...nextSystem, paths: updatedPaths };
        nextWaypointLayouts = dropWaypointKeys(document.waypointLayouts, [layoutId]);
      }
    }
  }
  const members = [...sharedAnchor.memberEdgeIds, layoutId];
  return {
    ...document,
    system: nextSystem,
    waypointLayouts: nextWaypointLayouts,
    sharedAnchors: {
      ...document.sharedAnchors,
      [sharedAnchorId]: { ...sharedAnchor, memberEdgeIds: members },
    },
  };
}

export function promoteSharedAnchorToBranchPoint(
  document: SharedAnchorDocument,
  sharedAnchorId: string,
  branchPointId?: string,
): { document: SharedAnchorDocument; branchPointId: string } | { error: string } {
  const sharedAnchor = document.sharedAnchors[sharedAnchorId];
  if (!sharedAnchor) return { error: 'That shared anchor no longer exists.' };
  if (sharedAnchor.branchPointId) {
    return { document, branchPointId: sharedAnchor.branchPointId };
  }
  const system = document.system;
  if (!system) return { error: 'No system is loaded.' };
  const id = branchPointId ?? nextBranchPointId(system);
  const parentEnclosure = document.openEnclosureId;
  const branchPoint: BranchPoint = {
    id,
    name: nextBranchPointName(system),
    parent: parentEnclosure,
    tags: [],
    properties: {},
  };
  let paths = system.paths;
  let inserted = 0;
  for (const memberId of sharedAnchor.memberEdgeIds) {
    paths = paths.map((path) => {
      const next = insertBranchPointOnPath(path, memberId, id);
      if (next !== path) inserted += 1;
      return next;
    });
  }
  if (inserted === 0) {
    return { error: 'No path hops match this shared anchor, so it cannot become a branch point.' };
  }
  const nextSystem: SystemData = {
    ...system,
    branchPoints: [...system.branchPoints, branchPoint],
    paths,
  };
  const members = incidentBundleIds(nextSystem, id);
  const ctx = contextKey(parentEnclosure);
  return {
    branchPointId: id,
    document: {
      ...document,
      system: nextSystem,
      waypointLayouts: dropWaypointKeys(document.waypointLayouts, sharedAnchor.memberEdgeIds),
      sharedAnchors: {
        ...document.sharedAnchors,
        [sharedAnchorId]: {
          ...sharedAnchor,
          memberEdgeIds: members.length > 0 ? members : sharedAnchor.memberEdgeIds,
          branchPointId: id,
        },
      },
      branchPointLayouts: {
        ...document.branchPointLayouts,
        [ctx]: {
          ...(document.branchPointLayouts[ctx] ?? {}),
          [id]: { x: sharedAnchor.x, y: sharedAnchor.y },
        },
      },
    },
  };
}

export function branchPointToSharedAnchorBlockReason(
  system: SystemData,
  branchPointId: string,
): string | null {
  const branchPoint = system.branchPoints.find((item) => item.id === branchPointId);
  if (!branchPoint) return 'That branch point no longer exists.';
  if (branchPoint.derived) {
    return 'This branch point is generated from a sheet port and cannot become a shared anchor.';
  }
  let through = 0;
  let stubs = 0;
  for (const path of system.paths) {
    const mergeIndexes: number[] = [];
    for (let index = 0; index < path.nodes.length; index += 1) {
      const node = path.nodes[index];
      if (node.kind === 'branch' && node.branch_point_id === branchPointId) {
        mergeIndexes.push(index);
      }
    }
    if (mergeIndexes.length === 0) continue;
    const stripped = removeBranchFromPath(path, branchPointId);
    if (stripped.nodes.length >= 2) {
      through += 1;
      continue;
    }
    if (stripped.nodes.length >= 1 && mergeIndexes.length === 1) stubs += 1;
  }
  if (through === 0 && stubs === 0) {
    return 'No paths pass through this branch point.';
  }
  if (stubs === 1 || stubs >= 3) {
    return 'This branch point has unpaired stub paths that cannot become a shared visual join.';
  }
  return null;
}

export function demoteBranchPointToSharedAnchor(
  document: SharedAnchorDocument,
  branchPointId: string,
  newAnchorId?: string,
): { document: SharedAnchorDocument; sharedAnchorId: string } | { error: string } {
  const system = document.system;
  if (!system) return { error: 'No system is loaded.' };
  const blocked = branchPointToSharedAnchorBlockReason(system, branchPointId);
  if (blocked) return { error: blocked };

  const existingId = Object.keys(document.sharedAnchors).find(
    (id) => document.sharedAnchors[id]?.branchPointId === branchPointId,
  );
  const branchPoint = system.branchPoints.find((item) => item.id === branchPointId);
  const ctx = contextKey(document.openEnclosureId);
  const fallbackPos = document.branchPointLayouts[ctx]?.[branchPointId]
    ?? (branchPoint?.parent
      ? document.branchPointLayouts[branchPoint.parent]?.[branchPointId]
      : undefined)
    ?? document.branchPointLayouts.graph?.[branchPointId]
    ?? { x: 160, y: 420 };
  const existing = existingId ? document.sharedAnchors[existingId] : undefined;
  const sharedAnchorId = existingId ?? newAnchorId ?? `sa_${crypto.randomUUID()}`;
  const position = existing
    ? { x: existing.x, y: existing.y }
    : fallbackPos;
  const oldIncident = existing?.memberEdgeIds ?? incidentBundleIds(system, branchPointId);
  const resultMembers = resultingBundleIdsAfterDemote(system, branchPointId);
  const nextSystem = dissolveBranchPoint(system, branchPointId);

  let nextWaypoints = dropWaypointKeys(document.waypointLayouts, oldIncident);
  const members = resultMembers.length > 0 ? resultMembers : oldIncident;
  for (const memberId of members) {
    nextWaypoints = ensureWaypointOnBundle(nextWaypoints, memberId, sharedAnchorId);
  }

  const nextLayouts = { ...document.branchPointLayouts };
  for (const [key, map] of Object.entries(nextLayouts)) {
    if (!map[branchPointId]) continue;
    const copy = { ...map };
    delete copy[branchPointId];
    nextLayouts[key] = copy;
  }

  return {
    sharedAnchorId,
    document: {
      ...document,
      system: nextSystem,
      waypointLayouts: nextWaypoints,
      sharedAnchors: {
        ...document.sharedAnchors,
        [sharedAnchorId]: {
          id: sharedAnchorId,
          x: position.x,
          y: position.y,
          memberEdgeIds: members,
        },
      },
      branchPointLayouts: nextLayouts,
    },
  };
}

export function applyBundleJoin(
  document: SharedAnchorDocument,
  request: {
    sourceEdgeId: string;
    sourceWaypointIndex: number;
    targetEdgeId: string;
    insertAfterIndex: number;
    position: { x: number; y: number };
    kind: JoinKind;
    sharedAnchorId?: string;
    branchPointId?: string;
  },
): { document: SharedAnchorDocument; sharedAnchorId: string } | { error: string } {
  const sharedAnchorId = request.sharedAnchorId ?? `sa_${crypto.randomUUID()}`;
  let next = createVisualSharedAnchor(
    document,
    request.position,
    request.sourceEdgeId,
    request.sourceWaypointIndex,
    sharedAnchorId,
  );
  next = linkVisualOrBranchAnchor(
    next,
    sharedAnchorId,
    request.targetEdgeId,
    request.insertAfterIndex,
  );
  if (request.kind === 'branch-point') {
    const promoted = promoteSharedAnchorToBranchPoint(next, sharedAnchorId, request.branchPointId);
    if ('error' in promoted) return promoted;
    return { document: promoted.document, sharedAnchorId };
  }
  return { document: next, sharedAnchorId };
}
