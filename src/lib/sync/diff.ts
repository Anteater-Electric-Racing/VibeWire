import type {
  ConnectorLibrary,
  ConnectorType,
  SystemData,
} from '../../types';
import type {
  CollaborationLayouts,
  LayoutPatch,
} from '../../types/collab';

export interface RecordDiff<T> {
  patch: Record<string, T>;
  removed: string[];
}

type SystemCollection = Exclude<keyof SystemData, 'schema_version' | 'name'>;

export interface SystemDiff {
  metadata?: {
    schema_version: string;
    hasName: boolean;
    name?: string;
  };
  collections: {
    [K in SystemCollection]: RecordDiff<SystemData[K][number]>;
  };
}

export interface LibraryDiff {
  metadata?: {
    hasSchemaVersion: boolean;
    schema_version?: string;
  };
  connectorTypes: RecordDiff<ConnectorType>;
}

export interface RebaseResult<T> {
  value: T | null;
  conflictIds: string[];
}

export function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => deepEqual(value, right[index]));
  }
  if (typeof left !== 'object' || typeof right !== 'object') return false;

  const leftObject = left as Record<string, unknown>;
  const rightObject = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftObject).sort();
  const rightKeys = Object.keys(rightObject).sort();
  if (
    leftKeys.length !== rightKeys.length
    || leftKeys.some((key, index) => key !== rightKeys[index])
  ) return false;
  return leftKeys.every((key) => deepEqual(leftObject[key], rightObject[key]));
}

export function diffRecord<T>(
  base: Record<string, T>,
  live: Record<string, T>,
): RecordDiff<T> {
  const patch: Record<string, T> = {};
  const removed: string[] = [];
  for (const [id, value] of Object.entries(live)) {
    if (!(id in base) || !deepEqual(base[id], value)) patch[id] = value;
  }
  for (const id of Object.keys(base)) {
    if (!(id in live)) removed.push(id);
  }
  return { patch, removed };
}

export function isRecordDiffEmpty<T>(diff: RecordDiff<T>): boolean {
  return diff.removed.length === 0 && Object.keys(diff.patch).length === 0;
}

export function applyRecordDiff<T>(
  base: Record<string, T>,
  diff: RecordDiff<T>,
): Record<string, T> {
  const next = { ...base, ...diff.patch };
  for (const id of diff.removed) delete next[id];
  return next;
}

export function mergeRemoteRecord<T>(
  serverBase: Record<string, T>,
  live: Record<string, T>,
  remote: Record<string, T>,
): { server: Record<string, T>; live: Record<string, T> } {
  const localDiff = diffRecord(serverBase, live);
  const locallyChanged = new Set([
    ...Object.keys(localDiff.patch),
    ...localDiff.removed,
  ]);
  const remoteDiff = diffRecord(serverBase, remote);
  const nextLive = { ...live };

  for (const [id, value] of Object.entries(remoteDiff.patch)) {
    if (!locallyChanged.has(id)) nextLive[id] = value;
  }
  for (const id of remoteDiff.removed) {
    if (!locallyChanged.has(id)) delete nextLive[id];
  }
  return { server: remote, live: nextLive };
}

function arrayById<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

const SYSTEM_COLLECTIONS = [
  'hierarchy',
  'connectors',
  'branchPoints',
  'paths',
  'signals',
  'signalPropertyDefinitions',
] as const satisfies readonly SystemCollection[];

export function diffSystem(base: SystemData, live: SystemData): SystemDiff {
  const metadataChanged =
    base.schema_version !== live.schema_version
    || base.name !== live.name
    || Object.hasOwn(base, 'name') !== Object.hasOwn(live, 'name');

  return {
    ...(metadataChanged
      ? {
          metadata: {
            schema_version: live.schema_version,
            hasName: Object.hasOwn(live, 'name'),
            ...(live.name !== undefined ? { name: live.name } : {}),
          },
        }
      : {}),
    collections: {
      hierarchy: diffRecord(arrayById(base.hierarchy), arrayById(live.hierarchy)),
      connectors: diffRecord(arrayById(base.connectors), arrayById(live.connectors)),
      branchPoints: diffRecord(arrayById(base.branchPoints), arrayById(live.branchPoints)),
      paths: diffRecord(arrayById(base.paths), arrayById(live.paths)),
      signals: diffRecord(arrayById(base.signals), arrayById(live.signals)),
      signalPropertyDefinitions: diffRecord(
        arrayById(base.signalPropertyDefinitions),
        arrayById(live.signalPropertyDefinitions),
      ),
    },
  };
}

export function isSystemDiffEmpty(diff: SystemDiff): boolean {
  return !diff.metadata
    && SYSTEM_COLLECTIONS.every((key) =>
      isRecordDiffEmpty(diff.collections[key] as RecordDiff<{ id: string }>)
    );
}

export function changedSystemEntityIds(diff: SystemDiff): string[] {
  return SYSTEM_COLLECTIONS.flatMap((key) => [
    ...Object.keys(diff.collections[key].patch),
    ...diff.collections[key].removed,
  ]);
}

function applyArrayDiff<T extends { id: string }>(
  base: T[],
  diff: RecordDiff<T>,
): T[] {
  const removed = new Set(diff.removed);
  const existingIds = new Set(base.map((item) => item.id));
  const next = base
    .filter((item) => !removed.has(item.id))
    .map((item) => diff.patch[item.id] ?? item);
  for (const [id, item] of Object.entries(diff.patch)) {
    if (!existingIds.has(id)) next.push(item);
  }
  return next;
}

export function applySystemDiff(base: SystemData, diff: SystemDiff): SystemData {
  const next: SystemData = {
    ...base,
    hierarchy: applyArrayDiff(base.hierarchy, diff.collections.hierarchy),
    connectors: applyArrayDiff(base.connectors, diff.collections.connectors),
    branchPoints: applyArrayDiff(base.branchPoints, diff.collections.branchPoints),
    paths: applyArrayDiff(base.paths, diff.collections.paths),
    signals: applyArrayDiff(base.signals, diff.collections.signals),
    signalPropertyDefinitions: applyArrayDiff(
      base.signalPropertyDefinitions,
      diff.collections.signalPropertyDefinitions,
    ),
  };
  if (diff.metadata) {
    next.schema_version = diff.metadata.schema_version;
    if (diff.metadata.hasName) next.name = diff.metadata.name;
    else delete next.name;
  }
  return next;
}

export function rebaseSystem(
  serverBase: SystemData,
  local: SystemData,
  remote: SystemData,
): RebaseResult<SystemData> {
  const diff = diffSystem(serverBase, local);
  const conflictIds: string[] = [];

  for (const key of SYSTEM_COLLECTIONS) {
    const baseById = arrayById(serverBase[key] as Array<{ id: string }>);
    const remoteById = arrayById(remote[key] as Array<{ id: string }>);
    for (const [id, localEntity] of Object.entries(diff.collections[key].patch)) {
      if (id in baseById && !(id in remoteById)) {
        conflictIds.push(id);
      } else if (!(id in baseById) && id in remoteById && !deepEqual(localEntity, remoteById[id])) {
        conflictIds.push(id);
      }
    }
  }

  return conflictIds.length > 0
    ? { value: null, conflictIds }
    : { value: applySystemDiff(remote, diff), conflictIds: [] };
}

export function diffLibrary(base: ConnectorLibrary, live: ConnectorLibrary): LibraryDiff {
  const metadataChanged =
    base.schema_version !== live.schema_version
    || Object.hasOwn(base, 'schema_version') !== Object.hasOwn(live, 'schema_version');
  return {
    ...(metadataChanged
      ? {
          metadata: {
            hasSchemaVersion: Object.hasOwn(live, 'schema_version'),
            ...(live.schema_version !== undefined ? { schema_version: live.schema_version } : {}),
          },
        }
      : {}),
    connectorTypes: diffRecord(
      arrayById(base.connector_types),
      arrayById(live.connector_types),
    ),
  };
}

export function isLibraryDiffEmpty(diff: LibraryDiff): boolean {
  return !diff.metadata && isRecordDiffEmpty(diff.connectorTypes);
}

export function applyLibraryDiff(base: ConnectorLibrary, diff: LibraryDiff): ConnectorLibrary {
  const next: ConnectorLibrary = {
    ...base,
    connector_types: applyArrayDiff(base.connector_types, diff.connectorTypes),
  };
  if (diff.metadata) {
    if (diff.metadata.hasSchemaVersion) next.schema_version = diff.metadata.schema_version;
    else delete next.schema_version;
  }
  return next;
}

export function rebaseLibrary(
  serverBase: ConnectorLibrary,
  local: ConnectorLibrary,
  remote: ConnectorLibrary,
): RebaseResult<ConnectorLibrary> {
  const diff = diffLibrary(serverBase, local);
  const baseById = arrayById(serverBase.connector_types);
  const remoteById = arrayById(remote.connector_types);
  const conflictIds: string[] = [];
  for (const [id, localType] of Object.entries(diff.connectorTypes.patch)) {
    if (id in baseById && !(id in remoteById)) {
      conflictIds.push(id);
    } else if (!(id in baseById) && id in remoteById && !deepEqual(localType, remoteById[id])) {
      conflictIds.push(id);
    }
  }
  return conflictIds.length > 0
    ? { value: null, conflictIds }
    : { value: applyLibraryDiff(remote, diff), conflictIds: [] };
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

export function normalizeLayouts(
  layouts: Partial<CollaborationLayouts> | null | undefined,
): CollaborationLayouts {
  return { ...emptyLayouts(), ...(layouts ?? {}) };
}

const FLAT_LAYOUT_KEYS = [
  'nodes',
  'ports',
  'sizes',
  'free',
  'backgrounds',
  'images',
  'connectorTypeSizes',
  'textBoxes',
  'waypoints',
  'sharedAnchors',
  'rotations',
  'routeStyles',
  'viewRouteStyles',
] as const satisfies readonly Exclude<keyof CollaborationLayouts, 'branchPoints'>[];

export function diffLayouts(
  base: CollaborationLayouts,
  live: CollaborationLayouts,
): LayoutPatch {
  const patch: Partial<CollaborationLayouts> = {};
  const removed: LayoutPatch['removed'] = {};
  for (const key of FLAT_LAYOUT_KEYS) {
    const diff = diffRecord(
      base[key] as Record<string, unknown>,
      live[key] as Record<string, unknown>,
    );
    if (Object.keys(diff.patch).length > 0) {
      Object.assign(patch, { [key]: diff.patch });
    }
    if (diff.removed.length > 0) removed[key] = diff.removed;
  }
  const branchPointPatch: CollaborationLayouts['branchPoints'] = {};
  const removedBranchPoints: Record<string, string[]> = {};
  const contextKeys = new Set([
    ...Object.keys(base.branchPoints),
    ...Object.keys(live.branchPoints),
  ]);
  for (const contextKey of contextKeys) {
    const diff = diffRecord(
      base.branchPoints[contextKey] ?? {},
      live.branchPoints[contextKey] ?? {},
    );
    if (Object.keys(diff.patch).length > 0) branchPointPatch[contextKey] = diff.patch;
    if (diff.removed.length > 0) removedBranchPoints[contextKey] = diff.removed;
  }
  if (Object.keys(branchPointPatch).length > 0) patch.branchPoints = branchPointPatch;
  if (Object.keys(removedBranchPoints).length > 0) removed.branchPoints = removedBranchPoints;
  return { patch, removed };
}

export function isLayoutPatchEmpty(diff: LayoutPatch): boolean {
  return Object.keys(diff.patch).length === 0 && Object.keys(diff.removed).length === 0;
}

export function applyLayoutPatch(
  base: CollaborationLayouts,
  diff: LayoutPatch,
  branchPointMode: 'nested' | 'contexts' = 'nested',
): CollaborationLayouts {
  const next = { ...base };
  for (const key of FLAT_LAYOUT_KEYS) {
    const patch = diff.patch[key] as Record<string, CollaborationLayouts[typeof key][string]> | undefined;
    const removed = diff.removed[key] ?? [];
    if (!patch && removed.length === 0) continue;
    Object.assign(next, {
      [key]: applyRecordDiff(
        (base[key] ?? {}) as CollaborationLayouts[typeof key],
        { patch: patch ?? {}, removed },
      ),
    });
  }
  const branchPointPatch = diff.patch.branchPoints ?? {};
  const removedBranchPoints = diff.removed.branchPoints;
  const hasBranchPointChange = Object.keys(branchPointPatch).length > 0
    || (Array.isArray(removedBranchPoints)
      ? removedBranchPoints.length > 0
      : Object.keys(removedBranchPoints ?? {}).length > 0);
  // Callers compare layout maps by reference to detect "nothing changed", so an
  // empty patch has to hand back the exact same object.
  if (!hasBranchPointChange) return next;

  const branchPoints = { ...base.branchPoints };
  if (branchPointMode === 'contexts') {
    for (const [contextKey, context] of Object.entries(branchPointPatch)) {
      branchPoints[contextKey] = context;
    }
    if (Array.isArray(removedBranchPoints)) {
      for (const contextKey of removedBranchPoints) delete branchPoints[contextKey];
    }
    next.branchPoints = branchPoints;
    return next;
  }
  const removedByContext = Array.isArray(removedBranchPoints)
    ? {}
    : (removedBranchPoints ?? {});
  for (const contextKey of new Set([
    ...Object.keys(branchPointPatch),
    ...Object.keys(removedByContext),
  ])) {
    branchPoints[contextKey] = applyRecordDiff(
      base.branchPoints[contextKey] ?? {},
      {
        patch: branchPointPatch[contextKey] ?? {},
        removed: removedByContext[contextKey] ?? [],
      },
    );
  }
  if (Array.isArray(removedBranchPoints)) {
    for (const contextKey of removedBranchPoints) delete branchPoints[contextKey];
  }
  next.branchPoints = branchPoints;
  return next;
}

export function mergeRemoteLayouts(
  serverBase: CollaborationLayouts,
  live: CollaborationLayouts,
  remote: CollaborationLayouts,
): { server: CollaborationLayouts; live: CollaborationLayouts } {
  const nextLive = { ...live };
  for (const key of FLAT_LAYOUT_KEYS) {
    const merged = mergeRemoteRecord(
      (serverBase[key] ?? {}) as Record<string, unknown>,
      (live[key] ?? {}) as Record<string, unknown>,
      (remote[key] ?? {}) as Record<string, unknown>,
    );
    Object.assign(nextLive, { [key]: merged.live });
  }
  const nextBranchPoints: CollaborationLayouts['branchPoints'] = {};
  const contextKeys = new Set([
    ...Object.keys(serverBase.branchPoints),
    ...Object.keys(live.branchPoints),
    ...Object.keys(remote.branchPoints),
  ]);
  for (const contextKey of contextKeys) {
    const merged = mergeRemoteRecord(
      serverBase.branchPoints[contextKey] ?? {},
      live.branchPoints[contextKey] ?? {},
      remote.branchPoints[contextKey] ?? {},
    );
    if (
      Object.keys(merged.live).length > 0
      || Object.hasOwn(remote.branchPoints, contextKey)
    ) {
      nextBranchPoints[contextKey] = merged.live;
    }
  }
  nextLive.branchPoints = nextBranchPoints;
  return { server: remote, live: nextLive };
}
