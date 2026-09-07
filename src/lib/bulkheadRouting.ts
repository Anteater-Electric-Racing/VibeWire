import type {
  Connector,
  SystemData,
  Path,
  PathNode,
} from '../types';
import { GENERIC_MULTIPIN_TYPE_ID } from './connectorFamily';

export const AUTO_BULKHEAD_REASON = 'missing_enclosure_bulkhead';
export const BULKHEAD_DISPLAY_PROPERTY = 'bulkhead_display';
export const BULKHEAD_DOT_DISPLAY = 'dot';
export const BULKHEAD_DOT_SIZE = 18;

export interface EnclosureRoutePlan {
  fromScope: string | null;
  toScope: string | null;
  commonScope: string | null;
  /** Boundary enclosures crossed while travelling outward from the source. */
  fromCrossedChildScopes: string[];
  /** Boundary enclosures crossed while travelling outward from the destination. */
  toCrossedChildScopes: string[];
  /** Boundary order as it appears in a source-to-destination path. */
  crossedChildScopes: string[];
}

type ParentOwned = Pick<Connector, 'parent'>;

/**
 * Plan a route across an explicit set of enclosure boundaries.
 *
 * Each side-specific list is ordered from its endpoint toward the common
 * scope. The combined list is ordered from source to destination.
 */
export function planBoundaryRoute(
  system: Pick<SystemData, 'hierarchy'>,
  boundaryIds: ReadonlySet<string>,
  fromEntity: ParentOwned,
  toEntity: ParentOwned,
): EnclosureRoutePlan {
  const enclosureById = new Map(
    system.hierarchy.map((enclosure) => [enclosure.id, enclosure]),
  );
  const ownerScope = (parentId: string | null): string | null => {
    let current = parentId;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      if (boundaryIds.has(current)) return current;
      current = enclosureById.get(current)?.parent ?? null;
    }
    return null;
  };
  const boundaryParent = (scope: string | null): string | null | undefined => {
    if (scope === null) return undefined;
    return ownerScope(enclosureById.get(scope)?.parent ?? null);
  };
  const chain = (scope: string | null): Array<string | null> => {
    const result: Array<string | null> = [];
    const visited = new Set<string | null>();
    let current: string | null | undefined = scope;
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      result.push(current);
      current = boundaryParent(current);
    }
    if (!result.includes(null)) result.push(null);
    return result;
  };

  const fromScope = ownerScope(fromEntity.parent);
  const toScope = ownerScope(toEntity.parent);
  const fromChain = chain(fromScope);
  const toChain = chain(toScope);
  const toSet = new Set(toChain);
  const commonScope = fromChain.find((scope) => toSet.has(scope)) ?? null;
  const fromCrossedChildScopes = fromChain
    .slice(0, fromChain.indexOf(commonScope))
    .filter((scope): scope is string => scope !== null);
  const toCrossedChildScopes = toChain
    .slice(0, toChain.indexOf(commonScope))
    .filter((scope): scope is string => scope !== null);

  return {
    fromScope,
    toScope,
    commonScope,
    fromCrossedChildScopes,
    toCrossedChildScopes,
    crossedChildScopes: [
      ...fromCrossedChildScopes,
      ...[...toCrossedChildScopes].reverse(),
    ],
  };
}

/** Plan a bulkhead for every container enclosure wall crossed by a route. */
export function planEnclosureRoute(
  system: Pick<SystemData, 'hierarchy'>,
  fromEntity: ParentOwned,
  toEntity: ParentOwned,
): EnclosureRoutePlan {
  const boundaryIds = new Set(
    system.hierarchy
      .filter((enclosure) => enclosure.kind === 'enclosure')
      .map((enclosure) => enclosure.id),
  );
  return planBoundaryRoute(system, boundaryIds, fromEntity, toEntity);
}

function isBulkheadConnector(
  enclosureById: ReadonlyMap<string, SystemData['hierarchy'][number]>,
  connector: Connector | undefined,
): connector is Connector {
  if (!connector) return false;
  if (connector.mounting === 'inline') return false;
  if (connector.mounting === 'bulkhead') return true;
  return connector.parent !== null && enclosureById.get(connector.parent)?.kind === 'enclosure';
}

/** Generated placeholders are safe to prune once no path references them. */
export function isAutoBulkheadPlaceholder(
  connector: Pick<Connector, 'tags' | 'properties'>,
): boolean {
  return connector.properties.placeholder_reason === AUTO_BULKHEAD_REASON
    || (
      connector.tags.includes('generated')
      && connector.tags.includes('unresolved')
      && connector.tags.includes('bulkhead')
    );
}

/** A dot is a visual form of a bulkhead connector, not a separate path-node kind. */
export function isBulkheadDot(
  connector: Pick<Connector, 'properties'> | null | undefined,
): boolean {
  return connector?.properties[BULKHEAD_DISPLAY_PROPERTY] === BULKHEAD_DOT_DISPLAY;
}

/** A terminal dot is referenced only at path ends, never between two nodes. */
export function isTerminalVisualDot(
  system: Pick<SystemData, 'connectors' | 'paths'>,
  connectorId: string,
): boolean {
  const connector = system.connectors.find((candidate) => candidate.id === connectorId);
  if (!isBulkheadDot(connector)) return false;
  const occurrences = system.paths.flatMap((path) =>
    path.nodes.flatMap((node, index) =>
      node.kind === 'connector' && node.connector_id === connectorId
        ? [{ index, lastIndex: path.nodes.length - 1 }]
        : []
    )
  );
  return occurrences.length > 0
    && occurrences.every(({ index, lastIndex }) => index === 0 || index === lastIndex);
}

/** Cavity used when routing to or from a terminal dot as a single hit target. */
export function getVisualDotRoutePin(
  system: Pick<SystemData, 'connectors' | 'paths'>,
  connectorId: string,
): number | null {
  if (!isTerminalVisualDot(system, connectorId)) return null;
  const terminalPins = new Set<number>();
  const usedPins = new Set<number>();
  for (const path of system.paths) {
    path.nodes.forEach((node, index) => {
      if (node.kind !== 'connector' || node.connector_id !== connectorId) return;
      usedPins.add(node.pin_number);
      if (index === 0 || index === path.nodes.length - 1) {
        terminalPins.add(node.pin_number);
      }
    });
  }
  if (terminalPins.size === 1) return [...terminalPins][0];
  let freePin = 1;
  while (usedPins.has(freePin)) freePin += 1;
  return freePin;
}

/**
 * Move one routed wire from a merged bulkhead dot onto a new sibling dot.
 *
 * The path remains electrically continuous; only its connector hop and cavity
 * reference change. The new grouping anchor is intentionally unique so a later
 * auto-repair does not fold the wire back into the original generated group.
 */
export function splitBulkheadDotPath(
  input: SystemData,
  connectorId: string,
  pathId: string,
  newConnectorId: string,
  newConnectorName: string,
): SystemData {
  const source = input.connectors.find((connector) => connector.id === connectorId);
  if (!source || !isBulkheadDot(source)) {
    throw new Error('Only a visual dot can release a wire.');
  }
  const parent = source.parent
    ? input.hierarchy.find((enclosure) => enclosure.id === source.parent)
    : undefined;
  if (!parent) {
    throw new Error('The visual dot must belong to a device or enclosure.');
  }
  const wallMounted = parent.kind === 'enclosure';
  if ([
    ...input.hierarchy,
    ...input.connectors,
    ...input.branchPoints,
    ...input.paths,
    ...input.signals,
  ].some((entity) => entity.id === newConnectorId)) {
    throw new Error('The new bulkhead dot ID is already in use.');
  }

  const connectedPathIds = new Set(
    input.paths
      .filter((path) => path.nodes.some((node) =>
        node.kind === 'connector' && node.connector_id === connectorId
      ))
      .map((path) => path.id),
  );
  if (connectedPathIds.size <= 1) {
    throw new Error('This bulkhead dot contains only one wire.');
  }

  const selectedPath = input.paths.find((path) => path.id === pathId);
  const sourceNode = selectedPath?.nodes.find((node) =>
    node.kind === 'connector' && node.connector_id === connectorId
  );
  if (!selectedPath || sourceNode?.kind !== 'connector') {
    throw new Error('The selected wire does not pass through this bulkhead dot.');
  }

  const next = structuredClone(input);
  const nextSource = next.connectors.find((connector) => connector.id === connectorId)!;
  const nextPath = next.paths.find((path) => path.id === pathId)!;
  const remap = (node: PathNode) => {
    if (node.kind !== 'connector' || node.connector_id !== connectorId) return;
    node.connector_id = newConnectorId;
    node.pin_number = 1;
  };
  nextPath.nodes.forEach(remap);
  nextPath.measurements.forEach((measurement) => {
    remap(measurement.from);
    remap(measurement.to);
  });

  const remainingRouteIds = new Set(
    (nextSource.properties.generated_by_routes ?? '')
      .split(',')
      .filter((candidate) => candidate && candidate !== pathId),
  );
  if (nextSource.properties.generated_by_route === pathId) {
    nextSource.properties.generated_by_route = [...remainingRouteIds].sort()[0] ?? '';
  }
  nextSource.properties.generated_by_routes = [...remainingRouteIds].sort().join(',');

  const properties: Record<string, string> = {
    ...nextSource.properties,
    [BULKHEAD_DISPLAY_PROPERTY]: BULKHEAD_DOT_DISPLAY,
    generated_by_route: pathId,
    generated_by_routes: pathId,
  };
  if (wallMounted) {
    Object.assign(properties, {
      placeholder_reason: AUTO_BULKHEAD_REASON,
      bulkhead_group_anchor: `dot:${newConnectorId}`,
      boundary_enclosure: parent.id,
      boundary_sheet: parent.id,
    });
  } else {
    delete properties.placeholder_reason;
    delete properties.bulkhead_group_anchor;
    delete properties.boundary_enclosure;
    delete properties.boundary_sheet;
    delete properties.boundary_name;
  }
  delete properties.generated_for_connector;
  delete properties.generated_for_merge_point;
  delete properties.generated_for_branch_point;

  next.connectors.push({
    ...nextSource,
    id: newConnectorId,
    name: newConnectorName,
    connector_type: GENERIC_MULTIPIN_TYPE_ID,
    mounting: wallMounted ? 'bulkhead' : 'inline',
    pin_count: 1,
    tags: Array.from(new Set([
      ...nextSource.tags.filter((tag) => tag !== 'bulkhead' && tag !== 'inline'),
      'generated',
      'unresolved',
      wallMounted ? 'bulkhead' : 'inline',
    ])),
    properties,
  });
  return next;
}

export interface VisualDotUnmergeResult {
  system: SystemData;
  created: Array<{ connectorId: string; sourceConnectorId: string; pathId: string }>;
}

/**
 * Once one wire passes through a merged dot, separate every other wire so the
 * through-dot can become a single, automatically positioned visual crossing.
 */
export function unmergeNonTerminalVisualDots(
  input: SystemData,
  connectorIds?: ReadonlySet<string>,
): VisualDotUnmergeResult {
  let system = input;
  const created: VisualDotUnmergeResult['created'] = [];
  const candidates = input.connectors
    .filter((connector) =>
      isBulkheadDot(connector)
      && (!connectorIds || connectorIds.has(connector.id))
    )
    .map((connector) => connector.id);

  for (const connectorId of candidates) {
    const pathOccurrences = system.paths.flatMap((path) =>
      path.nodes.flatMap((node, index) =>
        node.kind === 'connector' && node.connector_id === connectorId
          ? [{ pathId: path.id, pathName: path.name, index, lastIndex: path.nodes.length - 1 }]
          : []
      )
    );
    const throughPath = pathOccurrences.find(
      ({ index, lastIndex }) => index > 0 && index < lastIndex,
    );
    const pathIds = [...new Set(pathOccurrences.map(({ pathId }) => pathId))];
    if (!throughPath || pathIds.length <= 1) continue;

    for (const pathId of pathIds.filter((candidate) => candidate !== throughPath.pathId)) {
      const pathName = system.paths.find((path) => path.id === pathId)?.name ?? pathId;
      const baseId = `con_dot_${stableIdToken(`${connectorId}|${pathId}`)}`;
      let newConnectorId = baseId;
      let suffix = 2;
      const usedIds = new Set([
        ...system.hierarchy.map((entity) => entity.id),
        ...system.connectors.map((entity) => entity.id),
        ...system.branchPoints.map((entity) => entity.id),
        ...system.paths.map((entity) => entity.id),
        ...system.signals.map((entity) => entity.id),
      ]);
      while (usedIds.has(newConnectorId)) {
        newConnectorId = `${baseId}_${suffix}`;
        suffix += 1;
      }
      system = splitBulkheadDotPath(
        system,
        connectorId,
        pathId,
        newConnectorId,
        `${pathName} dot`,
      );
      created.push({ connectorId: newConnectorId, sourceConnectorId: connectorId, pathId });
    }
  }
  return { system, created };
}

function stableIdToken(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function nodeRefKey(node: PathNode): string {
  return node.kind === 'connector'
    ? `connector:${node.connector_id}`
    : `branch:${node.branch_point_id}`;
}

function connectorPin(node: PathNode): number | null {
  return node.kind === 'connector'
    && Number.isInteger(node.pin_number)
    && node.pin_number > 0
    ? node.pin_number
    : null;
}

export interface BulkheadRepairOptions {
  /** Repair all paths by default, or only the listed paths when provided. */
  pathIds?: ReadonlySet<string>;
}

export interface BulkheadRepairResult {
  system: SystemData;
  /** Legacy route-scoped placeholders replaced by connector-grouped placeholders. */
  removedConnectorIds: string[];
  /** Connector entities created by this repair. */
  createdConnectorIds: string[];
  /** Existing or new placeholders inserted into repaired path node lists. */
  insertedConnectorIds: string[];
  changedPathIds: string[];
}

/**
 * Insert missing enclosure-wall bulkheads and share them by the connector
 * immediately inside each enclosure.
 *
 * Every signal receives its own cavity on the shared placeholder. For nested
 * enclosures, the inner placeholder becomes the grouping connector for the
 * next outer wall, matching the physical connector chain.
 */
export function ensureEnclosureBulkheadPlaceholders(
  input: SystemData,
  options: BulkheadRepairOptions = {},
): BulkheadRepairResult {
  const system = structuredClone(input);
  const removedConnectorIds = options.pathIds
    ? []
    : system.connectors
        .filter((connector) =>
          isAutoBulkheadPlaceholder(connector)
          && !connector.properties.bulkhead_group_anchor
        )
        .map((connector) => connector.id);
  if (removedConnectorIds.length > 0) {
    const removedIds = new Set(removedConnectorIds);
    system.connectors = system.connectors.filter(
      (connector) => !removedIds.has(connector.id),
    );
    for (const path of system.paths) {
      path.nodes = path.nodes.filter((node) =>
        node.kind !== 'connector' || !removedIds.has(node.connector_id)
      );
      path.measurements = path.measurements.filter((measurement) => {
        const referencesRemovedConnector = (node: PathNode) =>
          node.kind === 'connector' && removedIds.has(node.connector_id);
        return !referencesRemovedConnector(measurement.from)
          && !referencesRemovedConnector(measurement.to);
      });
    }
  }
  const enclosureById = new Map(
    system.hierarchy.map((enclosure) => [enclosure.id, enclosure]),
  );
  const connectorById = new Map(
    system.connectors.map((connector) => [connector.id, connector]),
  );
  const branchPointById = new Map(
    system.branchPoints.map((branchPoint) => [branchPoint.id, branchPoint]),
  );
  const allEntityIds = new Set([
    ...system.hierarchy.map((entity) => entity.id),
    ...system.connectors.map((entity) => entity.id),
    ...system.branchPoints.map((entity) => entity.id),
    ...system.paths.map((entity) => entity.id),
    ...system.signals.map((entity) => entity.id),
  ]);
  const groupConnector = new Map<string, Connector>();
  const usedPins = new Map<string, Set<number>>();

  const nodeParent = (node: PathNode): string | null | undefined => (
    node.kind === 'connector'
      ? connectorById.get(node.connector_id)?.parent
      : branchPointById.get(node.branch_point_id)?.parent
  );
  const nodeIsBoundaryBulkhead = (node: PathNode, boundaryId: string): boolean => {
    if (node.kind !== 'connector') return false;
    const connector = connectorById.get(node.connector_id);
    return connector?.parent === boundaryId
      && isBulkheadConnector(enclosureById, connector);
  };

  for (const connector of system.connectors) {
    const anchor = connector.properties.bulkhead_group_anchor;
    const boundary = connector.properties.boundary_enclosure
      ?? connector.properties.boundary_sheet;
    if (isAutoBulkheadPlaceholder(connector) && anchor && boundary) {
      groupConnector.set(`${boundary}|${anchor}`, connector);
    }
    usedPins.set(connector.id, new Set());
  }
  for (const path of system.paths) {
    for (const node of path.nodes) {
      if (node.kind !== 'connector') continue;
      const pin = connectorPin(node);
      if (pin !== null) usedPins.get(node.connector_id)?.add(pin);
    }
  }

  const createdConnectorIds: string[] = [];
  const insertedConnectorIds = new Set<string>();
  const changedPathIds: string[] = [];

  const uniqueConnectorId = (groupKey: string): string => {
    const base = `con_auto_bulkhead_${stableIdToken(groupKey)}`;
    let candidate = base;
    let suffix = 2;
    while (allEntityIds.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    allEntityIds.add(candidate);
    return candidate;
  };

  const ensureGroupConnector = (
    boundaryId: string,
    anchorNode: PathNode,
    path: Path,
  ): Connector => {
    const anchor = nodeRefKey(anchorNode);
    const groupKey = `${boundaryId}|${anchor}`;
    const existing = groupConnector.get(groupKey);
    if (existing) {
      existing.tags = Array.from(new Set([
        ...existing.tags,
        ...path.tags.filter((tag) => tag.startsWith('system:')),
      ]));
      return existing;
    }

    const anchorConnector = anchorNode.kind === 'connector'
      ? connectorById.get(anchorNode.connector_id)
      : undefined;
    const boundaryName = enclosureById.get(boundaryId)?.name ?? boundaryId;
    const anchorName = anchorConnector?.name
      ?? (anchorNode.kind === 'branch'
        ? branchPointById.get(anchorNode.branch_point_id)?.name
        : undefined)
      ?? anchor;
    const connector: Connector = {
      id: uniqueConnectorId(groupKey),
      name: `Unresolved bulkhead — ${anchorName}`,
      parent: boundaryId,
      connector_type: GENERIC_MULTIPIN_TYPE_ID,
      mounting: 'bulkhead',
      pin_count: 1,
      tags: Array.from(new Set([
        'generated',
        'unresolved',
        'bulkhead',
        ...path.tags.filter((tag) => tag.startsWith('system:')),
      ])),
      properties: {
        placeholder_reason: AUTO_BULKHEAD_REASON,
        bulkhead_group_anchor: anchor,
        ...(anchorNode.kind === 'connector'
          ? { generated_for_connector: anchorNode.connector_id }
          : { generated_for_branch_point: anchorNode.branch_point_id }),
        generated_by_route: path.id,
        generated_by_routes: path.id,
        boundary_enclosure: boundaryId,
        // Legacy key retained for sheet-format and inspector compatibility.
        boundary_sheet: boundaryId,
        boundary_name: boundaryName,
      },
    };
    system.connectors.push(connector);
    connectorById.set(connector.id, connector);
    groupConnector.set(groupKey, connector);
    usedPins.set(connector.id, new Set());
    createdConnectorIds.push(connector.id);
    return connector;
  };

  const allocateNode = (connector: Connector, pathId: string): PathNode => {
    const occupied = usedPins.get(connector.id) ?? new Set<number>();
    let pinNumber = 1;
    while (occupied.has(pinNumber)) pinNumber += 1;
    occupied.add(pinNumber);
    usedPins.set(connector.id, occupied);
    connector.pin_count = Math.max(connector.pin_count ?? 1, pinNumber);
    const routeIds = new Set(
      (connector.properties.generated_by_routes ?? '')
        .split(',')
        .filter(Boolean),
    );
    routeIds.add(pathId);
    connector.properties.generated_by_routes = [...routeIds].sort().join(',');
    insertedConnectorIds.add(connector.id);
    return {
      kind: 'connector',
      connector_id: connector.id,
      pin_number: pinNumber,
    };
  };

  const nearestConnectorAnchor = (
    path: Path,
    startIndex: number,
    direction: -1 | 1,
  ): PathNode => {
    for (
      let index = startIndex;
      index >= 0 && index < path.nodes.length;
      index += direction
    ) {
      const node = path.nodes[index];
      if (node?.kind === 'connector') return node;
    }
    return path.nodes[startIndex];
  };

  for (const path of system.paths) {
    if (options.pathIds && !options.pathIds.has(path.id)) continue;
    if (path.nodes.length < 2) continue;
    const originalNodes = [...path.nodes];
    const repairedNodes: PathNode[] = [originalNodes[0]];
    let changed = false;

    for (let index = 0; index < originalNodes.length - 1; index += 1) {
      const from = originalNodes[index];
      const to = originalNodes[index + 1];
      const fromParent = nodeParent(from);
      const toParent = nodeParent(to);
      if (fromParent === undefined || toParent === undefined) {
        repairedNodes.push(to);
        continue;
      }

      const plan = planEnclosureRoute(
        system,
        { parent: fromParent },
        { parent: toParent },
      );
      const fromBoundaries = plan.fromCrossedChildScopes.filter(
        (boundaryId) => !nodeIsBoundaryBulkhead(from, boundaryId),
      );
      const toBoundaries = plan.toCrossedChildScopes.filter(
        (boundaryId) => !nodeIsBoundaryBulkhead(to, boundaryId),
      );
      if (fromBoundaries.length === 0 && toBoundaries.length === 0) {
        repairedNodes.push(to);
        continue;
      }

      let fromAnchor = nearestConnectorAnchor(path, index, -1);
      const fromNodes = fromBoundaries.map((boundaryId) => {
        const connector = ensureGroupConnector(boundaryId, fromAnchor, path);
        const node = allocateNode(connector, path.id);
        fromAnchor = node;
        return node;
      });
      let toAnchor = nearestConnectorAnchor(path, index + 1, 1);
      const toNodesInsideOut = toBoundaries.map((boundaryId) => {
        const connector = ensureGroupConnector(boundaryId, toAnchor, path);
        const node = allocateNode(connector, path.id);
        toAnchor = node;
        return node;
      });

      repairedNodes.push(...fromNodes, ...toNodesInsideOut.reverse(), to);
      changed = true;
    }

    if (changed) {
      path.nodes = repairedNodes;
      changedPathIds.push(path.id);
    }
  }

  return {
    system,
    removedConnectorIds,
    createdConnectorIds,
    insertedConnectorIds: [...insertedConnectorIds],
    changedPathIds,
  };
}
