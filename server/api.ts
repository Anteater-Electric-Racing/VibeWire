import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  isSheetedHarness,
  sheetHarnessDir,
  readSheetedHarness,
  writeSheetedHarness,
  discoverSheetEnclosureIds,
  type Connector,
  type Enclosure,
  type MergePoint,
  type ConnectorPathNode,
  type MergePointPathNode,
  type PathNode,
  type PathMeasurement,
  type PathEntity,
  type Signal,
  type HarnessData,
} from './sheets.js';
import { planSheetRoute, routeRequestToken } from './routing.js';
import {
  GENERIC_MULTIPIN_TYPE_ID,
  getConnectorSupportedKeyings,
  getConnectorSupportedPinCounts,
  getEffectivePinCount,
  isConnectorFamily,
} from '../src/lib/connectorFamily.js';

export type { Connector, Enclosure, MergePoint, ConnectorPathNode, MergePointPathNode, PathNode, PathMeasurement, PathEntity, Signal, HarnessData };

type PathNodeRef = PathNode;

interface ConnectorType {
  id: string;
  name: string;
  pin_count: number;
  crimp_spec: string;
  male_crimp_part_number?: string;
  female_crimp_part_number?: string;
  wire_gauge: string;
  notes: string;
  cavity_variants?: Array<{
    pin_count: number;
    housing_part_number?: string;
    keyings?: string[];
    image?: string;
    side_image?: string;
  }>;
  image?: string;
  side_image?: string;
  default_properties?: Record<string, string>;
}

interface ConnectorLibrary {
  connector_types: ConnectorType[];
}

interface ManufacturingDocument {
  schema_version: '1.1.0';
  bundles: Record<string, {
    steps: Partial<Record<
      'ordered' | 'cut' | 'crimped' | 'populated' | 'qc' | 'installed',
      boolean
    >>;
    endpoint_genders?: Record<string, 'male' | 'female'>;
    notes?: string;
  }>;
}

const PROTECTED_CONNECTOR_TYPE_IDS = new Set([
  GENERIC_MULTIPIN_TYPE_ID,
]);

export function validateConnectorLibraryData(raw: unknown) {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Connector library must be an object.'] };
  }
  const library = raw as Partial<ConnectorLibrary>;
  if (!Array.isArray(library.connector_types)) {
    return { valid: false, errors: ['connector_types must be an array.'] };
  }

  const ids = new Set<string>();
  for (const [index, candidate] of library.connector_types.entries()) {
    const type = candidate as Partial<ConnectorType>;
    const label = typeof type.id === 'string' && type.id ? `'${type.id}'` : `at index ${index}`;
    if (typeof type.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(type.id)) {
      errors.push(`Connector type ${label} has an invalid ID.`);
    } else if (ids.has(type.id)) {
      errors.push(`Duplicate connector type ID '${type.id}'.`);
    } else {
      ids.add(type.id);
    }
    if (typeof type.name !== 'string' || !type.name.trim()) {
      errors.push(`Connector type ${label} requires a name.`);
    }
    if (!Number.isInteger(type.pin_count) || (type.pin_count ?? -1) < 0) {
      errors.push(`Connector type ${label} has an invalid pin_count.`);
    }
    const variants = type.cavity_variants ?? [];
    if (!Array.isArray(variants)) {
      errors.push(`Connector type ${label} has invalid cavity_variants.`);
      continue;
    }
    if (variants.length > 0 && type.pin_count !== 0) {
      errors.push(`Connector family ${label} must use pin_count 0.`);
    }
    if (variants.length === 0 && type.id !== GENERIC_MULTIPIN_TYPE_ID && type.pin_count === 0) {
      errors.push(`Fixed connector type ${label} must have at least one cavity.`);
    }
    const variantCounts = new Set<number>();
    for (const variant of variants) {
      if (!Number.isInteger(variant.pin_count) || variant.pin_count <= 0) {
        errors.push(`Connector family ${label} has an invalid cavity count.`);
      } else if (variantCounts.has(variant.pin_count)) {
        errors.push(`Connector family ${label} repeats ${variant.pin_count} cavities.`);
      } else {
        variantCounts.add(variant.pin_count);
      }
      if (
        variant.keyings
        && (
          !Array.isArray(variant.keyings)
          || variant.keyings.some((keying) => typeof keying !== 'string' || !keying.trim())
          || new Set(variant.keyings).size !== variant.keyings.length
        )
      ) {
        errors.push(`Connector family ${label} has invalid or duplicate keyings.`);
      }
      for (const field of ['housing_part_number'] as const) {
        if (variant[field] !== undefined && typeof variant[field] !== 'string') {
          errors.push(`Connector family ${label} has invalid ${field}.`);
        }
      }
    }
    for (const field of [
      'male_crimp_part_number',
      'female_crimp_part_number',
    ] as const) {
      if (type[field] !== undefined && typeof type[field] !== 'string') {
        errors.push(`Connector type ${label} has invalid ${field}.`);
      }
    }
    if (
      type.default_properties
      && (
        typeof type.default_properties !== 'object'
        || Array.isArray(type.default_properties)
        || Object.entries(type.default_properties).some(
          ([key, value]) => !key.trim() || typeof value !== 'string',
        )
      )
    ) {
      errors.push(`Connector type ${label} has invalid default properties.`);
    }
  }
  for (const protectedId of PROTECTED_CONNECTOR_TYPE_IDS) {
    if (!ids.has(protectedId)) {
      errors.push(`Connector library must include protected type '${protectedId}'.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

interface LayoutData {
  nodes?: Record<string, { x: number; y: number }>;
  ports?: Record<string, { x: number; y: number }>;
  sizes?: Record<string, { w: number; h: number }>;
  free?: Record<string, { x: number; y: number }>;
  backgrounds?: Record<string, any>;
  connectorTypeSizes?: Record<string, { w: number; h: number }>;
  textBoxes?: Record<string, any>;
  waypoints?: Record<string, any>;
  junctions?: Record<string, any>;
  mergePoints?: Record<string, Record<string, { x: number; y: number }>>;
}

interface SubsystemDocument {
  schema_version: '1.0.0';
  id: string;
  name: string;
  tags: string[];
  enclosures: Record<string, { x: number; y: number; w?: number; h?: number }>;
  devices: Record<string, { x: number; y: number; w?: number; h?: number }>;
  connectors: Record<string, { x: number; y: number; w?: number; h?: number }>;
  hidden_connectors?: string[];
  device_connector_mode?: Record<string, 'all' | 'selected'>;
  viewport?: { x: number; y: number; zoom: number };
}

type Params = Record<string, string>;
type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Params,
  query: URLSearchParams,
) => void | Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

type TaggedEntity = {
  id: string;
  tags: string[];
  properties: Record<string, string>;
};

type HarnessCollectionKey = 'enclosures' | 'connectors' | 'mergePoints' | 'paths' | 'signals';

function normalizeHarness(raw: any): HarnessData {
  const harness = structuredClone(raw ?? {}) as Partial<HarnessData> & { pcbs?: any[] };
  harness.schema_version ??= '0.1.0';
  harness.enclosures ??= [];
  harness.connectors ??= [];
  harness.mergePoints ??= [];
  harness.paths ??= [];
  harness.signals ??= [];

  if (Array.isArray(harness.pcbs)) {
    for (const pcb of harness.pcbs) {
      harness.enclosures.push({
        id: pcb.id,
        name: pcb.name,
        parent: pcb.parent ?? null,
        container: false,
        tags: pcb.tags ?? [],
        properties: pcb.properties ?? {},
      });
    }
    delete harness.pcbs;
  }

  for (const enclosure of harness.enclosures) {
    enclosure.parent ??= null;
    enclosure.container ??= true;
    enclosure.tags ??= [];
    enclosure.properties ??= {};
  }
  for (const connector of harness.connectors) {
    connector.parent ??= null;
    connector.connector_type ??= '';
    connector.tags ??= [];
    connector.properties ??= {};
    if ('pins' in connector) delete (connector as any).pins;
  }
  for (const mergePoint of harness.mergePoints) {
    mergePoint.name ??= mergePoint.id;
    mergePoint.parent ??= null;
    mergePoint.tags ??= [];
    mergePoint.properties ??= {};
  }
  for (const pathItem of harness.paths) {
    pathItem.name ??= pathItem.id;
    pathItem.tags ??= [];
    pathItem.properties ??= {};
    const rawNodes = (pathItem.nodes ?? []) as Array<any>;
    const legacyNodeById = new Map<string, any>();
    for (const rawNode of rawNodes) {
      if (typeof rawNode?.id === 'string') legacyNodeById.set(rawNode.id, rawNode);
    }
    pathItem.nodes = rawNodes.map((rawNode) => {
      const { id: _legacyId, ...nodeWithoutId } = rawNode ?? {};
      return nodeWithoutId;
    });
    pathItem.measurements = (pathItem.measurements ?? []).map((measurement: any) => {
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
  for (const signal of harness.signals) {
    signal.tags ??= [];
    signal.properties ??= {};
  }

  return harness as HarnessData;
}

function getPathSignalId(pathItem: Pick<PathEntity, 'signal_id' | 'tags'>): string | null {
  if (pathItem.signal_id) return pathItem.signal_id;
  const slug = pathItem.tags.find((tag) => tag.startsWith('signal:'))?.slice(7);
  return slug ? `sig_${slug}` : null;
}

function getPathSignalName(
  pathItem: Pick<PathEntity, 'signal_id' | 'tags'>,
  harness?: Pick<HarnessData, 'signals'>,
): string | null {
  const signalId = getPathSignalId(pathItem);
  if (!signalId) return null;
  return harness?.signals.find((signal) => signal.id === signalId)?.name ?? signalId.replace(/^sig_/, '');
}

function getPathNodeRefKey(node: PathNode): string {
  return node.kind === 'connector'
    ? `connector:${node.connector_id}:${node.pin_number}`
    : `merge:${node.merge_point_id}`;
}

function derivePathSegments(harness: HarnessData) {
  return harness.paths.flatMap((pathItem) =>
    pathItem.nodes.slice(0, -1).map((node, index) => ({
      id: `${pathItem.id}::${index}`,
      pathId: pathItem.id,
      from: node,
      to: pathItem.nodes[index + 1],
    })),
  );
}

function getConnectorOccupancy(harness: HarnessData, connectorId: string) {
  return harness.paths.flatMap((pathItem) =>
    pathItem.nodes
      .filter((node): node is ConnectorPathNode => node.kind === 'connector' && node.connector_id === connectorId)
      .map((node) => ({
        connectorId,
        // Missing/invalid pin_number (legacy ring terminals) counts as cavity 1.
        pinNumber: Number.isInteger(node.pin_number) && node.pin_number > 0 ? node.pin_number : 1,
        pathId: pathItem.id,
        pathName: pathItem.name,
        signalName: getPathSignalName(pathItem, harness),
      })),
  );
}

export function migrateConnectorTypeToGeneric(
  harness: HarnessData,
  removedType: ConnectorType,
  genericType: ConnectorType,
): { harness: HarnessData; migrated: number } {
  const next = structuredClone(harness);
  let migrated = 0;
  for (const connector of next.connectors) {
    if (connector.connector_type !== removedType.id) continue;
    const occupiedFloor = Math.max(
      0,
      ...getConnectorOccupancy(next, connector.id).map((entry) => entry.pinNumber),
    );
    const capacity = Math.max(
      1,
      occupiedFloor,
      getEffectivePinCount(connector, removedType),
    );
    connector.connector_type = genericType.id;
    connector.pin_count = capacity;
    delete connector.keying;
    connector.properties = {
      ...(genericType.default_properties ?? {}),
      ...connector.properties,
    };
    migrated += 1;
  }
  return { harness: next, migrated };
}

function getTaggable(harness: HarnessData, entityType: string, entityId: string): TaggedEntity | undefined {
  switch (entityType) {
    case 'enclosure':
      return harness.enclosures.find((entity) => entity.id === entityId);
    case 'connector':
      return harness.connectors.find((entity) => entity.id === entityId);
    case 'mergePoint':
      return harness.mergePoints.find((entity) => entity.id === entityId);
    case 'path':
      return harness.paths.find((entity) => entity.id === entityId);
    case 'signal':
      return harness.signals.find((entity) => entity.id === entityId);
    default:
      return undefined;
  }
}

function findConnector(harness: HarnessData, connectorRef: string): Connector | undefined {
  const byId = harness.connectors.find((connector) => connector.id === connectorRef);
  if (byId) return byId;
  const byName = harness.connectors.filter((connector) => connector.name === connectorRef);
  // Display names are intentionally non-unique and mutable. Never guess when
  // this legacy convenience lookup becomes ambiguous.
  return byName.length === 1 ? byName[0] : undefined;
}

function resolveConnectorPathNode(
  harness: HarnessData,
  connectorRef: string,
  pinRef: string | number,
): ConnectorPathNode | null {
  const connector = findConnector(harness, connectorRef);
  if (!connector) return null;
  const pinNumber = typeof pinRef === 'number' ? pinRef : Number(pinRef);
  if (!Number.isInteger(pinNumber) || pinNumber <= 0) return null;
  return {
    kind: 'connector',
    connector_id: connector.id,
    pin_number: pinNumber,
  };
}

function countPathNodeRefMatches(pathItem: Pick<PathEntity, 'nodes'>, ref: PathNodeRef): number {
  const refKey = getPathNodeRefKey(ref);
  return pathItem.nodes.filter((node) => getPathNodeRefKey(node) === refKey).length;
}

export function validateHarnessData(harness: HarnessData, library: ConnectorLibrary | null) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const allIds = new Map<string, string>();
  const registerId = (entityType: string, id: string) => {
    const existing = allIds.get(id);
    if (existing) errors.push(`Duplicate ID '${id}' used by both ${existing} and ${entityType}`);
    else allIds.set(id, entityType);
  };

  harness.enclosures.forEach((entity) => registerId('enclosure', entity.id));
  harness.connectors.forEach((entity) => registerId('connector', entity.id));
  harness.mergePoints.forEach((entity) => registerId('mergePoint', entity.id));
  harness.paths.forEach((entity) => registerId('path', entity.id));
  harness.signals.forEach((entity) => registerId('signal', entity.id));

  const enclosureIds = new Set(harness.enclosures.map((entity) => entity.id));
  const connectorIds = new Set(harness.connectors.map((entity) => entity.id));
  const mergePointIds = new Set(harness.mergePoints.map((entity) => entity.id));
  const signalIds = new Set(harness.signals.map((entity) => entity.id));
  const connectorTypeById = new Map((library?.connector_types ?? []).map((item) => [item.id, item]));
  const occupancy = new Map<string, string[]>();

  for (const enclosure of harness.enclosures) {
    if (enclosure.parent && !enclosureIds.has(enclosure.parent)) {
      errors.push(`Enclosure '${enclosure.id}' references missing parent enclosure '${enclosure.parent}'`);
    }
  }

  for (const connector of harness.connectors) {
    if (connector.parent && !enclosureIds.has(connector.parent)) {
      warnings.push(`Connector '${connector.id}' parent '${connector.parent}' is not an enclosure`);
    }
    if (connector.connector_type && !connectorTypeById.has(connector.connector_type)) {
      warnings.push(`Connector '${connector.id}' references unknown connector type '${connector.connector_type}'`);
    }
    const connectorType = connectorTypeById.get(connector.connector_type);
    if (connectorType && isConnectorFamily(connectorType)) {
      const supportedCounts = getConnectorSupportedPinCounts(connectorType);
      if (connector.pin_count == null) {
        warnings.push(
          `Connector '${connector.id}' uses family '${connectorType.id}' without a selected cavity count; `
          + `defaulting to ${supportedCounts[0]}`,
        );
      } else if (!supportedCounts.includes(connector.pin_count)) {
        warnings.push(
          `Connector '${connector.id}' selects unsupported ${connector.pin_count}-cavity housing `
          + `for family '${connectorType.id}'`,
        );
      }
      if (
        connector.keying
        && !getConnectorSupportedKeyings(connector, connectorType).includes(connector.keying)
      ) {
        warnings.push(
          `Connector '${connector.id}' selects unsupported key '${connector.keying}' `
          + `for ${getEffectivePinCount(connector, connectorType)}-cavity family '${connectorType.id}'`,
        );
      }
    } else if (connector.keying) {
      warnings.push(`Connector '${connector.id}' has key '${connector.keying}' but its type is not a connector family`);
    }
  }
  for (const mergePoint of harness.mergePoints) {
    if (mergePoint.parent && !enclosureIds.has(mergePoint.parent)) {
      warnings.push(`Merge point '${mergePoint.id}' parent '${mergePoint.parent}' is not an enclosure`);
    }
  }

  for (const pathItem of harness.paths) {
    if (pathItem.nodes.length < 2) {
      warnings.push(`Path '${pathItem.id}' has fewer than 2 nodes`);
    }
    for (const node of pathItem.nodes) {
      if (node.kind === 'connector') {
        if (!connectorIds.has(node.connector_id)) {
          errors.push(`Path '${pathItem.id}' references missing connector '${node.connector_id}'`);
          continue;
        }
        const connector = harness.connectors.find((item) => item.id === node.connector_id);
        const connectorType = connector?.connector_type ? connectorTypeById.get(connector.connector_type) : undefined;
        if (!Number.isInteger(node.pin_number) || node.pin_number <= 0) {
          errors.push(`Path '${pathItem.id}' uses missing or invalid pin number '${node.pin_number}' on connector '${node.connector_id}'`);
          continue;
        }
        if (connector) {
          const effective = getEffectivePinCount(connector, connectorType);
          if (node.pin_number > effective) {
            warnings.push(
              `Path '${pathItem.id}' uses connector '${node.connector_id}' pin ${node.pin_number}, exceeding instance capacity ${effective}`
              + (connectorType ? ` (type '${connectorType.id}')` : ''),
            );
          }
        }
        const key = `${node.connector_id}:${node.pin_number}`;
        const refs = occupancy.get(key) ?? [];
        refs.push(pathItem.id);
        occupancy.set(key, refs);
      } else if (!mergePointIds.has(node.merge_point_id)) {
        errors.push(`Path '${pathItem.id}' references missing merge point '${node.merge_point_id}'`);
      }
    }
    for (const measurement of pathItem.measurements) {
      const fromMatches = countPathNodeRefMatches(pathItem, measurement.from);
      if (fromMatches === 0) {
        errors.push(`Measurement on path '${pathItem.id}' references missing from endpoint '${getPathNodeRefKey(measurement.from)}'`);
      } else if (fromMatches > 1) {
        errors.push(`Measurement on path '${pathItem.id}' references ambiguous from endpoint '${getPathNodeRefKey(measurement.from)}'`);
      }
      const toMatches = countPathNodeRefMatches(pathItem, measurement.to);
      if (toMatches === 0) {
        errors.push(`Measurement on path '${pathItem.id}' references missing to endpoint '${getPathNodeRefKey(measurement.to)}'`);
      } else if (toMatches > 1) {
        errors.push(`Measurement on path '${pathItem.id}' references ambiguous to endpoint '${getPathNodeRefKey(measurement.to)}'`);
      }
      if (measurement.length_mm !== undefined && measurement.length_mm < 0) {
        errors.push(`Measurement on path '${pathItem.id}' has a negative length`);
      }
    }
    const signalId = getPathSignalId(pathItem);
    if (signalId && !signalIds.has(signalId)) {
      warnings.push(`Path '${pathItem.id}' references signal '${signalId}' with no matching signal entity`);
    }
    const signal = signalId ? harness.signals.find((item) => item.id === signalId) : undefined;
    const preferredColor = signal?.properties.preferred_wire_color?.trim().toLowerCase();
    const actualColor = (pathItem.properties.wire_color ?? pathItem.properties.color)?.trim().toLowerCase();
    if (preferredColor && actualColor && preferredColor !== actualColor) {
      warnings.push(`Path '${pathItem.id}' wire color '${actualColor}' deviates from signal '${signalId}' preference '${preferredColor}'`);
    }
  }

  for (const [ref, pathIds] of occupancy.entries()) {
    if (pathIds.length > 1) {
      errors.push(`Connector pin '${ref}' is occupied by multiple paths: ${pathIds.join(', ')}`);
    }
  }

  for (const mergePoint of harness.mergePoints) {
    const incidentSegments = derivePathSegments(harness).filter((segment) =>
      (segment.from.kind === 'merge' && segment.from.merge_point_id === mergePoint.id) ||
      (segment.to.kind === 'merge' && segment.to.merge_point_id === mergePoint.id),
    );
    if (incidentSegments.length < 2) {
      warnings.push(`Merge point '${mergePoint.id}' has fewer than 2 incident path segments`);
    }
  }

  return {
    valid: errors.length === 0,
    error_count: errors.length,
    warning_count: warnings.length,
    errors,
    warnings,
  };
}

export function createApiMiddleware(projectRoot: string) {
  const routes: Route[] = [];

  function addRoute(method: string, urlPath: string, handler: Handler) {
    const paramNames: string[] = [];
    const regexStr = urlPath.replace(/:([a-zA-Z_]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    routes.push({ method: method.toUpperCase(), pattern: new RegExp(`^${regexStr}$`), paramNames, handler });
  }

  function sanitizeName(name: string) {
    return name.replace(/[^a-zA-Z0-9_-]/g, '');
  }

  function harnessFile(name = 'fsae-car') {
    return path.join(projectRoot, 'public', 'user-data', 'harnesses', `${sanitizeName(name)}.json`);
  }

  function listHarnessNames(): string[] {
    const dir = path.join(projectRoot, 'public', 'user-data', 'harnesses');
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const flatNames = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name.replace('.json', ''));
      const sheetedNames = entries
        .filter((entry) => entry.isDirectory() && isSheetedHarness(projectRoot, entry.name))
        .map((entry) => entry.name);
      return [...new Set([...flatNames, ...sheetedNames])].sort();
    } catch {
      return [];
    }
  }

  function layoutsFile(name = 'fsae-car') {
    return path.join(projectRoot, 'public', 'user-data', `layouts.${sanitizeName(name)}.json`);
  }

  function manufacturingFile(name = 'fsae-car') {
    return path.join(
      projectRoot,
      'public',
      'user-data',
      `manufacturing.${sanitizeName(name)}.json`,
    );
  }

  function legacyLayoutsFile() {
    return path.join(projectRoot, 'public', 'user-data', 'layouts.json');
  }

  function libraryFile() {
    return path.join(projectRoot, 'public', 'user-data', 'connectors', 'connector-library.json');
  }

  function subsystemDir(name = 'fsae-car') {
    return path.join(projectRoot, 'public', 'user-data', 'subsystems', sanitizeName(name));
  }

  function subsystemFile(harness: string, subsystemId: string) {
    return path.join(subsystemDir(harness), `${sanitizeName(subsystemId)}.json`);
  }

  function readJSON<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  function writeJSON(filePath: string, data: unknown) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }

  function writeJSONAtomic(filePath: string, data: unknown) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    fs.renameSync(temp, filePath);
  }

  function readHarness(name?: string): HarnessData {
    const resolved = sanitizeName(name ?? 'fsae-car');
    if (isSheetedHarness(projectRoot, resolved)) {
      return normalizeHarness(readSheetedHarness(sheetHarnessDir(projectRoot, resolved)));
    }
    return normalizeHarness(readJSON<any>(harnessFile(name)));
  }

  function writeHarness(data: HarnessData, name?: string) {
    const resolved = sanitizeName(name ?? 'fsae-car');
    const normalized = normalizeHarness(data);
    if (isSheetedHarness(projectRoot, resolved)) {
      writeSheetedHarness(sheetHarnessDir(projectRoot, resolved), normalized);
      return;
    }
    writeJSONAtomic(harnessFile(name), normalized);
  }

  function readLibrary(): ConnectorLibrary | null {
    try {
      return readJSON<ConnectorLibrary>(libraryFile());
    } catch {
      return null;
    }
  }

  function readLayouts(name = 'fsae-car'): LayoutData {
    try {
      return readJSON<LayoutData>(layoutsFile(name));
    } catch {
      if (name === 'fsae-car') {
        try { return readJSON<LayoutData>(legacyLayoutsFile()); } catch { /* fall through */ }
      }
      return {};
    }
  }

  function writeLayouts(data: LayoutData, name = 'fsae-car') {
    writeJSON(layoutsFile(name), data);
  }

  function readManufacturing(name = 'fsae-car'): ManufacturingDocument {
    try {
      const data = readJSON<Partial<ManufacturingDocument>>(manufacturingFile(name));
      return {
        schema_version: '1.1.0',
        bundles: data.bundles && typeof data.bundles === 'object' ? data.bundles : {},
      };
    } catch {
      return { schema_version: '1.1.0', bundles: {} };
    }
  }

  function writeManufacturing(data: Partial<ManufacturingDocument>, name = 'fsae-car') {
    const steps = new Set(['ordered', 'cut', 'crimped', 'populated', 'qc', 'installed']);
    if (!data || typeof data !== 'object' || !data.bundles || typeof data.bundles !== 'object') {
      throw new Error('Manufacturing data must include a bundles object.');
    }
    for (const [bundleId, progress] of Object.entries(data.bundles)) {
      if (!bundleId || !progress || typeof progress !== 'object' || typeof progress.steps !== 'object') {
        throw new Error(`Invalid manufacturing progress for bundle '${bundleId}'.`);
      }
      for (const [step, completed] of Object.entries(progress.steps ?? {})) {
        if (!steps.has(step) || typeof completed !== 'boolean') {
          throw new Error(`Invalid manufacturing step '${step}' for bundle '${bundleId}'.`);
        }
      }
      if (
        progress.endpoint_genders !== undefined
        && (
          typeof progress.endpoint_genders !== 'object'
          || Array.isArray(progress.endpoint_genders)
          || Object.entries(progress.endpoint_genders).some(
            ([connectorId, gender]) =>
              !connectorId || (gender !== 'male' && gender !== 'female'),
          )
        )
      ) {
        throw new Error(`Invalid connector-end genders for bundle '${bundleId}'.`);
      }
      if (progress.notes !== undefined && typeof progress.notes !== 'string') {
        throw new Error(`Invalid manufacturing notes for bundle '${bundleId}'.`);
      }
    }
    writeJSONAtomic(manufacturingFile(name), {
      schema_version: '1.1.0',
      bundles: data.bundles,
    });
  }

  function harnessName(query: URLSearchParams) {
    return query.get('harness') ?? undefined;
  }

  function genId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function parseBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        if (!body) {
          resolve(undefined);
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('Invalid JSON body'));
        }
      });
      req.on('error', reject);
    });
  }

  const IMAGE_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;
  const IMAGE_UPLOAD_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

  function parseRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let rejected = false;
      req.on('data', (chunk: Buffer) => {
        if (rejected) return;
        size += chunk.length;
        if (size > maxBytes) {
          rejected = true;
          reject(new Error(`File too large (max ${Math.round(maxBytes / (1024 * 1024))} MB)`));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (!rejected) resolve(Buffer.concat(chunks));
      });
      req.on('error', (error) => {
        if (!rejected) reject(error);
      });
    });
  }

  function sanitizeImageFilename(raw: string): string | null {
    const base = path.basename(raw).trim();
    if (!base || base === '.' || base === '..') return null;
    const ext = path.extname(base).toLowerCase();
    if (!IMAGE_UPLOAD_EXTENSIONS.has(ext)) return null;
    const stem = path.basename(base, path.extname(base))
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[.-]+|[.-]+$/g, '')
      .slice(0, 80);
    if (!stem) return null;
    return `${stem}${ext}`;
  }

  function uniqueImageFilename(dir: string, filename: string): string {
    const ext = path.extname(filename);
    const stem = path.basename(filename, ext);
    let candidate = filename;
    let i = 1;
    while (fs.existsSync(path.join(dir, candidate))) {
      candidate = `${stem}-${i}${ext}`;
      i += 1;
    }
    return candidate;
  }

  function imagesDir() {
    return path.join(projectRoot, 'public', 'user-data', 'images');
  }

  function listImageFiles(): string[] {
    const dir = imagesDir();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((file) => /\.(png|jpe?g|webp|gif)$/i.test(file));
  }

  function json(res: ServerResponse, data: unknown, status = 200) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data, null, 2));
  }

  function err(res: ServerResponse, message: string, status = 400) {
    json(res, { error: message }, status);
  }

  function entityRoutes<T extends TaggedEntity>(
    basePath: string,
    collectionKey: HarnessCollectionKey,
    idPrefix: string,
    requiredFields: string[],
    defaults: () => Partial<T>,
  ) {
    addRoute('GET', basePath, (_req, res, _params, query) => {
      try {
        const harness = readHarness(harnessName(query));
        let items = harness[collectionKey] as unknown as T[];
        const tagFilter = query.get('tag');
        if (tagFilter) items = items.filter((item) => item.tags.includes(tagFilter));
        json(res, items);
      } catch (error: any) {
        err(res, error.message, 404);
      }
    });

    addRoute('POST', basePath, async (req, res, _params, query) => {
      const body = await parseBody(req);
      if (!body) {
        err(res, 'Request body required');
        return;
      }
      for (const field of requiredFields) {
        if (body[field] === undefined) {
          err(res, `Field '${field}' is required`);
          return;
        }
      }
      const harness = readHarness(harnessName(query));
      const entity = { ...defaults(), ...body, id: body.id ?? genId(idPrefix) } as T;
      entity.tags ??= [];
      entity.properties ??= {};
      const collection = harness[collectionKey] as unknown as T[];
      if (collection.some((item) => item.id === entity.id)) {
        err(res, `Entity with id '${entity.id}' already exists`, 409);
        return;
      }
      collection.push(entity);
      writeHarness(harness, harnessName(query));
      json(res, entity, 201);
    });

    addRoute('GET', `${basePath}/:id`, (_req, res, params, query) => {
      try {
        const harness = readHarness(harnessName(query));
        const item = (harness[collectionKey] as unknown as T[]).find((entity) => entity.id === params.id);
        if (!item) {
          err(res, `Not found: ${params.id}`, 404);
          return;
        }
        json(res, item);
      } catch (error: any) {
        err(res, error.message, 404);
      }
    });

    addRoute('PUT', `${basePath}/:id`, async (req, res, params, query) => {
      const body = await parseBody(req);
      if (!body) {
        err(res, 'Request body required');
        return;
      }
      const harness = readHarness(harnessName(query));
      const collection = harness[collectionKey] as unknown as T[];
      const index = collection.findIndex((entity) => entity.id === params.id);
      if (index === -1) {
        err(res, `Not found: ${params.id}`, 404);
        return;
      }
      collection[index] = { ...body, id: params.id, tags: body.tags ?? [], properties: body.properties ?? {} } as T;
      writeHarness(harness, harnessName(query));
      json(res, collection[index]);
    });
    addRoute('PATCH', `${basePath}/:id`, async (req, res, params, query) => {
      const body = await parseBody(req);
      if (!body) {
        err(res, 'Request body required');
        return;
      }
      const harness = readHarness(harnessName(query));
      const collection = harness[collectionKey] as unknown as T[];
      const index = collection.findIndex((entity) => entity.id === params.id);
      if (index === -1) {
        err(res, `Not found: ${params.id}`, 404);
        return;
      }
      collection[index] = {
        ...collection[index],
        ...body,
        id: params.id,
        tags: body.tags ?? collection[index].tags,
        properties: body.properties ?? collection[index].properties,
      } as T;
      writeHarness(harness, harnessName(query));
      json(res, collection[index]);
    });

    addRoute('DELETE', `${basePath}/:id`, (_req, res, params, query) => {
      const harness = readHarness(harnessName(query));
      const collection = harness[collectionKey] as unknown as T[];
      const index = collection.findIndex((entity) => entity.id === params.id);
      if (index === -1) {
        err(res, `Not found: ${params.id}`, 404);
        return;
      }
      const deleted = collection.splice(index, 1)[0];
      writeHarness(harness, harnessName(query));
      json(res, deleted);
    });
  }

  addRoute('GET', '/api', (_req, res) => {
    json(res, {
      name: 'VibeWire API',
      version: '3.0.0',
      note: 'Entity endpoints accept ?harness=<name> (default: fsae-car)',
      sections: {
        harness_document: {
          'GET /api/harnesses': 'List available harness names',
          'GET /api/harness': 'Get full harness JSON (?harness=name)',
          'PUT /api/harness': 'Replace or create harness JSON (?harness=name)',
          'GET /api/harness/stats': 'Harness summary statistics (?harness=name)',
          'GET /api/layouts': 'Get layout data for a harness (?harness=name)',
          'GET /api/manufacturing': 'Get manufacturing progress for a harness (?harness=name)',
          'GET /api/validate': 'Validate path and merge-point semantics (?harness=name)',
          'POST /api/upload-image': 'Upload an image into public/user-data/images (?filename=name.png; raw body)',
          'GET /api/list-assets': 'List image filenames in public/user-data/images',
        },
        naming: {
          display_names: 'Mutable name fields are labels only; IDs and ?harness= storage keys remain stable',
          connector_references: 'Use connector IDs. Name lookup is accepted only when exactly one connector has that name',
        },
        entities: {
          'GET /api/enclosures': 'List enclosures',
          'GET /api/connectors': 'List connectors',
          'GET /api/merge-points': 'List merge points',
          'GET /api/paths': 'List paths',
          'GET /api/signals': 'List signals',
        },
      },
    });
  });

  addRoute('GET', '/api/harnesses', (_req, res) => {
    json(res, listHarnessNames());
  });

  addRoute('GET', '/api/manufacturing', (_req, res, _params, query) => {
    json(res, readManufacturing(harnessName(query) ?? 'fsae-car'));
  });

  addRoute('GET', '/api/harness', (_req, res, _params, query) => {
    try {
      json(res, readHarness(harnessName(query)));
    } catch (error: any) {
      err(res, error.message, 404);
    }
  });

  addRoute('PUT', '/api/harness', async (req, res, _params, query) => {
    const body = await parseBody(req);
    if (!body?.schema_version) {
      err(res, 'Invalid harness data — must include schema_version');
      return;
    }
    try {
      writeHarness(body as HarnessData, harnessName(query));
      json(res, { ok: true });
    } catch (error: any) {
      err(res, error.message ?? 'Failed to save harness', 500);
    }
  });

  addRoute('GET', '/api/harness/stats', (_req, res, _params, query) => {
    try {
      const harness = readHarness(harnessName(query));
      const allTags = new Set<string>();
      for (const item of [...harness.enclosures, ...harness.connectors, ...harness.mergePoints, ...harness.paths, ...harness.signals]) {
        item.tags.forEach((tag) => allTags.add(tag));
      }
      json(res, {
        schema_version: harness.schema_version,
        counts: {
          enclosures: harness.enclosures.length,
          connectors: harness.connectors.length,
          mergePoints: harness.mergePoints.length,
          paths: harness.paths.length,
          signals: harness.signals.length,
        },
        tags: [...allTags].sort(),
      });
    } catch (error: any) {
      err(res, error.message, 404);
    }
  });

  addRoute('GET', '/api/subsystems', (_req, res, _params, query) => {
    const harness = sanitizeName(harnessName(query) ?? 'fsae-car');
    const dir = subsystemDir(harness);
    try {
      const documents = fs.existsSync(dir)
        ? fs.readdirSync(dir)
            .filter((file) => file.endsWith('.json'))
            .map((file) => readJSON<SubsystemDocument>(path.join(dir, file)))
        : [];
      json(res, documents);
    } catch (error: any) {
      err(res, error.message ?? 'Failed to read subsystems', 500);
    }
  });

  addRoute('GET', '/api/subsystems/:id', (_req, res, params, query) => {
    const harness = sanitizeName(harnessName(query) ?? 'fsae-car');
    const file = subsystemFile(harness, params.id);
    if (!fs.existsSync(file)) {
      err(res, `Subsystem not found: ${params.id}`, 404);
      return;
    }
    json(res, readJSON<SubsystemDocument>(file));
  });

  addRoute('PUT', '/api/subsystems/:id', async (req, res, params, query) => {
    const body = await parseBody(req) as Partial<SubsystemDocument> | undefined;
    const id = sanitizeName(params.id);
    if (!id || !body?.name) {
      err(res, 'Subsystem requires a valid id and name');
      return;
    }
    const document: SubsystemDocument = {
      schema_version: '1.0.0',
      id,
      name: body.name,
      tags: body.tags ?? [],
      enclosures: body.enclosures ?? {},
      devices: body.devices ?? {},
      connectors: body.connectors ?? {},
      hidden_connectors: body.hidden_connectors ?? [],
      device_connector_mode: body.device_connector_mode ?? {},
      ...(body.viewport ? { viewport: body.viewport } : {}),
    };
    const harness = sanitizeName(harnessName(query) ?? 'fsae-car');
    writeJSONAtomic(subsystemFile(harness, id), document);
    json(res, document);
  });

  addRoute('DELETE', '/api/subsystems/:id', (_req, res, params, query) => {
    const harness = sanitizeName(harnessName(query) ?? 'fsae-car');
    const file = subsystemFile(harness, params.id);
    if (!fs.existsSync(file)) {
      err(res, `Subsystem not found: ${params.id}`, 404);
      return;
    }
    fs.unlinkSync(file);
    json(res, { ok: true });
  });

  entityRoutes<Enclosure>('/api/enclosures', 'enclosures', 'enc', ['name'], () => ({ parent: null, container: true, tags: [], properties: {} }));
  entityRoutes<Connector>('/api/connectors', 'connectors', 'con', ['name'], () => ({ parent: null, connector_type: '', tags: [], properties: {} }));
  entityRoutes<MergePoint>('/api/merge-points', 'mergePoints', 'mp', ['name'], () => ({ parent: null, tags: [], properties: {} }));
  entityRoutes<PathEntity>('/api/paths', 'paths', 'path', ['name', 'nodes'], () => ({ tags: [], properties: {}, nodes: [], measurements: [] }));
  entityRoutes<Signal>('/api/signals', 'signals', 'sig', ['name'], () => ({ tags: [], properties: {} }));

  addRoute('GET', '/api/tags', (_req, res, _params, query) => {
    try {
      const harness = readHarness(harnessName(query));
      const tags = new Set<string>();
      for (const item of [...harness.enclosures, ...harness.connectors, ...harness.mergePoints, ...harness.paths, ...harness.signals]) {
        item.tags.forEach((tag) => tags.add(tag));
      }
      json(res, [...tags].sort());
    } catch (error: any) {
      err(res, error.message, 404);
    }
  });

  addRoute('POST', '/api/tags', async (req, res, _params, query) => {
    const body = await parseBody(req);
    if (!body?.entityType || !body?.entityId || !body?.tag) {
      err(res, 'Required fields: entityType, entityId, tag');
      return;
    }
    const harness = readHarness(harnessName(query));
    const entity = getTaggable(harness, body.entityType, body.entityId);
    if (!entity) {
      err(res, `Entity not found: ${body.entityType}/${body.entityId}`, 404);
      return;
    }
    if (!entity.tags.includes(body.tag)) entity.tags.push(body.tag);
    writeHarness(harness, harnessName(query));
    json(res, entity);
  });

  addRoute('DELETE', '/api/tags', async (req, res, _params, query) => {
    const body = await parseBody(req);
    if (!body?.entityType || !body?.entityId || !body?.tag) {
      err(res, 'Required fields: entityType, entityId, tag');
      return;
    }
    const harness = readHarness(harnessName(query));
    const entity = getTaggable(harness, body.entityType, body.entityId);
    if (!entity) {
      err(res, `Entity not found: ${body.entityType}/${body.entityId}`, 404);
      return;
    }
    entity.tags = entity.tags.filter((tag) => tag !== body.tag);
    writeHarness(harness, harnessName(query));
    json(res, entity);
  });

  addRoute('GET', '/api/search', (_req, res, _params, query) => {
    const q = (query.get('q') ?? '').toLowerCase();
    if (!q) {
      err(res, 'Query parameter q is required');
      return;
    }
    try {
      const harness = readHarness(harnessName(query));
      const results: Array<{ type: string; id: string; name?: string; match: string }> = [];
      const matches = (fields: string[]) => fields.some((field) => field.toLowerCase().includes(q));

      for (const enclosure of harness.enclosures) {
        if (matches([enclosure.id, enclosure.name, ...enclosure.tags])) results.push({ type: 'enclosure', id: enclosure.id, name: enclosure.name, match: enclosure.name });
      }
      for (const connector of harness.connectors) {
        const pins = getConnectorOccupancy(harness, connector.id).map((entry) => String(entry.pinNumber));
        if (matches([connector.id, connector.name, ...connector.tags, ...pins])) results.push({ type: 'connector', id: connector.id, name: connector.name, match: connector.name });
      }
      for (const mergePoint of harness.mergePoints) {
        if (matches([mergePoint.id, mergePoint.name, ...mergePoint.tags])) results.push({ type: 'mergePoint', id: mergePoint.id, name: mergePoint.name, match: mergePoint.name });
      }
      for (const pathItem of harness.paths) {
        const nodeLabels = pathItem.nodes.map((node) => getPathNodeRefKey(node));
        if (matches([pathItem.id, pathItem.name, ...pathItem.tags, ...Object.values(pathItem.properties), ...nodeLabels])) {
          results.push({ type: 'path', id: pathItem.id, name: pathItem.name, match: `${pathItem.name} (${pathItem.nodes.length} nodes)` });
        }
      }
      for (const signal of harness.signals) {
        if (matches([signal.id, signal.name, ...signal.tags])) results.push({ type: 'signal', id: signal.id, name: signal.name, match: signal.name });
      }

      json(res, results);
    } catch (error: any) {
      err(res, error.message, 404);
    }
  });

  addRoute('GET', '/api/connectors/:id/paths', (_req, res, params, query) => {
    try {
      const harness = readHarness(harnessName(query));
      const connector = harness.connectors.find((item) => item.id === params.id);
      if (!connector) {
        err(res, `Connector not found: ${params.id}`, 404);
        return;
      }
      const paths = harness.paths.filter((pathItem) => pathItem.nodes.some((node) => node.kind === 'connector' && node.connector_id === params.id));
      json(res, { connector: connector.id, connector_name: connector.name, path_count: paths.length, paths });
    } catch (error: any) {
      err(res, error.message, 404);
    }
  });

  addRoute('GET', '/api/merge-points/:id/paths', (_req, res, params, query) => {
    try {
      const harness = readHarness(harnessName(query));
      const mergePoint = harness.mergePoints.find((item) => item.id === params.id);
      if (!mergePoint) {
        err(res, `Merge point not found: ${params.id}`, 404);
        return;
      }
      const paths = harness.paths.filter((pathItem) => pathItem.nodes.some((node) => node.kind === 'merge' && node.merge_point_id === params.id));
      json(res, { mergePoint: mergePoint.id, merge_point_name: mergePoint.name, path_count: paths.length, paths });
    } catch (error: any) {
      err(res, error.message, 404);
    }
  });

  addRoute('GET', '/api/signals/:id/net', (_req, res, params, query) => {
    try {
      const harness = readHarness(harnessName(query));
      const signal = harness.signals.find((item) => item.id === params.id);
      if (!signal) {
        err(res, `Signal not found: ${params.id}`, 404);
        return;
      }
      const paths = harness.paths.filter((pathItem) => getPathSignalId(pathItem) === signal.id);
      const connectorIds = new Set<string>();
      const mergePointIds = new Set<string>();
      for (const pathItem of paths) {
        for (const node of pathItem.nodes) {
          if (node.kind === 'connector') connectorIds.add(node.connector_id);
          else mergePointIds.add(node.merge_point_id);
        }
      }
      json(res, {
        signal,
        paths,
        connectors: harness.connectors.filter((connector) => connectorIds.has(connector.id)),
        mergePoints: harness.mergePoints.filter((mergePoint) => mergePointIds.has(mergePoint.id)),
      });
    } catch (error: any) {
      err(res, error.message, 404);
    }
  });

  addRoute('GET', '/api/connectivity/:id', (_req, res, params, query) => {
    try {
      const harness = readHarness(harnessName(query));
      const rootId = params.id;
      const adjacency = new Map<string, Set<string>>();
      const addEdge = (a: string, b: string) => {
        if (!adjacency.has(a)) adjacency.set(a, new Set());
        if (!adjacency.has(b)) adjacency.set(b, new Set());
        adjacency.get(a)?.add(b);
        adjacency.get(b)?.add(a);
      };
      for (const segment of derivePathSegments(harness)) {
        addEdge(getPathNodeRefKey(segment.from), getPathNodeRefKey(segment.to));
      }

      const connectorRoot = harness.connectors.find((connector) => connector.id === rootId);
      const mergeRoot = harness.mergePoints.find((mergePoint) => mergePoint.id === rootId);
      const startKeys = connectorRoot
        ? getConnectorOccupancy(harness, connectorRoot.id).map((entry) => `connector:${connectorRoot.id}:${entry.pinNumber}`)
        : mergeRoot
          ? [`merge:${mergeRoot.id}`]
          : [];
      if (startKeys.length === 0) {
        err(res, `Connectivity root not found: ${rootId}`, 404);
        return;
      }

      const visited = new Set<string>();
      const queue = [...startKeys];
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || visited.has(current)) continue;
        visited.add(current);
        for (const next of adjacency.get(current) ?? []) {
          if (!visited.has(next)) queue.push(next);
        }
      }

      const connectedConnectors = new Set<string>();
      const connectedMergePoints = new Set<string>();
      const connectedPaths = new Set<string>();
      for (const ref of visited) {
        if (ref.startsWith('connector:')) connectedConnectors.add(ref.split(':')[1]);
        if (ref.startsWith('merge:')) connectedMergePoints.add(ref.split(':')[1]);
      }
      for (const pathItem of harness.paths) {
        if (pathItem.nodes.some((node) => visited.has(getPathNodeRefKey(node)))) connectedPaths.add(pathItem.id);
      }

      json(res, {
        root: rootId,
        connectors: harness.connectors.filter((connector) => connectedConnectors.has(connector.id)),
        mergePoints: harness.mergePoints.filter((mergePoint) => connectedMergePoints.has(mergePoint.id)),
        paths: harness.paths.filter((pathItem) => connectedPaths.has(pathItem.id)),
      });
    } catch (error: any) {
      err(res, error.message, 404);
    }
  });

  addRoute('GET', '/api/unoccupied-pins', (_req, res, _params, query) => {
    try {
      const harness = readHarness(harnessName(query));
      const library = readLibrary();
      const byType = new Map((library?.connector_types ?? []).map((item) => [item.id, item]));
      const pins: Array<{ connector_id: string; connector_name: string; pin_number: number }> = [];
      for (const connector of harness.connectors) {
        const connectorType = byType.get(connector.connector_type);
        const effective = getEffectivePinCount(connector, connectorType);
        if (effective <= 0) continue;
        const occupied = new Set(getConnectorOccupancy(harness, connector.id).map((entry) => entry.pinNumber));
        for (let pinNumber = 1; pinNumber <= effective; pinNumber++) {
          if (!occupied.has(pinNumber)) {
            pins.push({ connector_id: connector.id, connector_name: connector.name, pin_number: pinNumber });
          }
        }
      }
      json(res, { count: pins.length, pins });
    } catch (error: any) {
      err(res, error.message, 404);
    }
  });

  addRoute('GET', '/api/validate', (_req, res, _params, query) => {
    try {
      json(res, validateHarnessData(readHarness(harnessName(query)), readLibrary()));
    } catch (error: any) {
      err(res, error.message, 404);
    }
  });

  addRoute('PUT', '/api/layouts', async (req, res, _params, query) => {
    const body = await parseBody(req);
    if (!body) {
      err(res, 'Request body required');
      return;
    }
    writeLayouts(body, harnessName(query));
    json(res, { ok: true });
  });

  addRoute('GET', '/api/layouts/merge-points', (_req, res, _params, query) => {
    json(res, readLayouts(harnessName(query) ?? 'fsae-car').mergePoints ?? {});
  });

  addRoute('POST', '/api/path-by-name', async (req, res, _params, query) => {
    const body = await parseBody(req);
    if (!body?.from_connector || body?.from_pin === undefined || !body?.to_connector || body?.to_pin === undefined) {
      err(res, 'Required: from_connector, from_pin, to_connector, to_pin');
      return;
    }
    const harness = readHarness(harnessName(query));
    const fromNode = resolveConnectorPathNode(harness, body.from_connector, body.from_pin);
    const toNode = resolveConnectorPathNode(harness, body.to_connector, body.to_pin);
    if (!fromNode || !toNode) {
      err(res, 'Could not resolve one or both connector pin references', 404);
      return;
    }
    const pathItem: PathEntity = {
      id: body.id ?? genId('path'),
      name: body.name ?? body.id ?? genId('path'),
      tags: body.tags ?? [],
      properties: body.properties ?? {},
      nodes: [fromNode, toNode],
      measurements: body.measurements ?? [],
    };
    harness.paths.push(pathItem);
    writeHarness(harness, harnessName(query));
    json(res, pathItem, 201);
  });

  addRoute('POST', '/api/paths/route', async (req, res, _params, query) => {
    const body = await parseBody(req);
    if (!body?.from?.connector_id || !body?.to?.connector_id || !body?.signal_id) {
      err(res, 'Required: from.connector_id, from.pin_number, to.connector_id, to.pin_number, signal_id');
      return;
    }
    const fromPin = Number(body.from.pin_number);
    const toPin = Number(body.to.pin_number);
    if (!Number.isInteger(fromPin) || fromPin <= 0 || !Number.isInteger(toPin) || toPin <= 0) {
      err(res, 'Cavity numbers must be positive integers');
      return;
    }

    const name = sanitizeName(harnessName(query) ?? 'fsae-car');
    const harness = readHarness(name);
    const fromConnector = harness.connectors.find((item) => item.id === body.from.connector_id);
    const toConnector = harness.connectors.find((item) => item.id === body.to.connector_id);
    if (!fromConnector || !toConnector) {
      err(res, 'One or both connector endpoints do not exist', 404);
      return;
    }
    if (!harness.signals.some((signal) => signal.id === body.signal_id)) {
      err(res, `Signal not found: ${body.signal_id}`, 404);
      return;
    }
    const requestKey = String(body.request_id ?? `${fromConnector.id}-${fromPin}-${toConnector.id}-${toPin}-${body.signal_id}`);
    const token = routeRequestToken(requestKey);
    const pathId = `path_auto_${token}`;
    const existing = harness.paths.find((wirePath) => wirePath.id === pathId);
    if (existing) {
      json(res, { path: existing, harness, generated_connectors: [], idempotent: true });
      return;
    }
    const occupied = (connectorId: string, pinNumber: number) => harness.paths.some((wirePath) =>
      wirePath.nodes.some((node) =>
        node.kind === 'connector' && node.connector_id === connectorId && node.pin_number === pinNumber,
      ),
    );
    if (occupied(fromConnector.id, fromPin) || occupied(toConnector.id, toPin)) {
      err(res, 'Cannot route from or to an occupied cavity', 409);
      return;
    }

    const enclosureById = new Map(harness.enclosures.map((enclosure) => [enclosure.id, enclosure]));
    const sheetIds = isSheetedHarness(projectRoot, name)
      ? discoverSheetEnclosureIds(sheetHarnessDir(projectRoot, name))
      : new Set<string>();
    const { crossedChildScopes } = planSheetRoute(harness, sheetIds, fromConnector, toConnector);

    const generated: Connector[] = crossedChildScopes.map((childScope, index) => ({
      id: `con_auto_${token}_${index + 1}`,
      name: `Unresolved bulkhead — ${enclosureById.get(childScope)?.name ?? childScope}`,
      parent: childScope,
      connector_type: GENERIC_MULTIPIN_TYPE_ID,
      pin_count: 1,
      tags: ['generated', 'unresolved', 'bulkhead'],
      properties: {
        generated_by_route: pathId,
        boundary_sheet: childScope,
      },
    }));
    if (generated.some((connector) => harness.connectors.some((item) => item.id === connector.id))) {
      err(res, 'Generated connector ID collision; retry with a distinct request_id', 409);
      return;
    }

    const wirePath: PathEntity = {
      id: pathId,
      name: body.name ?? `${fromConnector.name}:${fromPin} → ${toConnector.name}:${toPin}`,
      signal_id: body.signal_id,
      tags: Array.from(new Set([...(body.tags ?? []), `signal:${String(body.signal_id).replace(/^sig_/, '')}`])),
      properties: { ...(body.properties ?? {}), route_request_id: requestKey },
      nodes: [
        { kind: 'connector', connector_id: fromConnector.id, pin_number: fromPin },
        ...generated.map((connector) => ({ kind: 'connector' as const, connector_id: connector.id, pin_number: 1 })),
        { kind: 'connector', connector_id: toConnector.id, pin_number: toPin },
      ],
      measurements: [],
    };

    const candidate: HarnessData = {
      ...harness,
      connectors: [...harness.connectors, ...generated],
      paths: [...harness.paths, wirePath],
    };
    try {
      writeHarness(candidate, name);
      const saved = readHarness(name);
      json(res, {
        path: saved.paths.find((item) => item.id === pathId),
        harness: saved,
        generated_connectors: generated.map((connector) => connector.id),
        validation: validateHarnessData(saved, readLibrary()),
      }, 201);
    } catch (error: any) {
      err(res, error.message ?? 'Route preflight failed', 409);
    }
  });

  addRoute('GET', '/api/library', (_req, res) => {
    json(res, readLibrary() ?? { connector_types: [] });
  });

  addRoute('GET', '/api/library/usage', (_req, res) => {
    const library = readLibrary();
    const typeById = new Map(
      (library?.connector_types ?? []).map((type) => [type.id, type]),
    );
    const usage: Record<string, {
      total: number;
      harnesses: Record<string, number>;
      pin_counts: Record<string, number>;
      keyings: Record<string, number>;
    }> = {};
    for (const name of listHarnessNames()) {
      try {
        const harness = readHarness(name);
        for (const connector of harness.connectors) {
          const entry = usage[connector.connector_type] ?? {
            total: 0,
            harnesses: {},
            pin_counts: {},
            keyings: {},
          };
          entry.total += 1;
          entry.harnesses[name] = (entry.harnesses[name] ?? 0) + 1;
          const pinCount = getEffectivePinCount(
            connector,
            typeById.get(connector.connector_type),
          );
          entry.pin_counts[String(pinCount)] = (entry.pin_counts[String(pinCount)] ?? 0) + 1;
          if (connector.keying) {
            const key = `${pinCount}:${connector.keying}`;
            entry.keyings[key] = (entry.keyings[key] ?? 0) + 1;
          }
          usage[connector.connector_type] = entry;
        }
      } catch {
        // A malformed harness should not make the connector library unreadable.
      }
    }
    json(res, usage);
  });

  addRoute('DELETE', '/api/library/connector-types/:id', (_req, res, params, query) => {
    const typeId = params.id;
    if (PROTECTED_CONNECTOR_TYPE_IDS.has(typeId)) {
      err(res, `Connector type '${typeId}' is required by VibeWire and cannot be deleted.`, 409);
      return;
    }
    const library = readLibrary();
    const removedType = library?.connector_types.find((type) => type.id === typeId);
    const genericType = library?.connector_types.find(
      (type) => type.id === GENERIC_MULTIPIN_TYPE_ID,
    );
    if (!library || !removedType) {
      err(res, `Connector type not found: ${typeId}`, 404);
      return;
    }
    if (!genericType) {
      err(res, `Cannot migrate without '${GENERIC_MULTIPIN_TYPE_ID}'.`, 409);
      return;
    }

    const migrations: Record<string, number> = {};
    const migratedHarnesses = new Map<string, HarnessData>();
    try {
      for (const name of listHarnessNames()) {
        const current = readHarness(name);
        const migrated = migrateConnectorTypeToGeneric(current, removedType, genericType);
        if (migrated.migrated > 0) {
          migrations[name] = migrated.migrated;
          migratedHarnesses.set(name, migrated.harness);
        }
      }
      for (const [name, harness] of migratedHarnesses) {
        writeHarness(harness, name);
      }

      const nextLibrary: ConnectorLibrary = {
        ...library,
        connector_types: library.connector_types.filter((type) => type.id !== typeId),
      };
      const validation = validateConnectorLibraryData(nextLibrary);
      if (!validation.valid) {
        err(res, validation.errors.join(' '), 409);
        return;
      }
      writeJSONAtomic(libraryFile(), nextLibrary);

      const currentHarnessName = sanitizeName(harnessName(query) ?? '');
      const currentHarness = currentHarnessName
        ? migratedHarnesses.get(currentHarnessName) ?? readHarness(currentHarnessName)
        : undefined;
      json(res, {
        library: nextLibrary,
        harness: currentHarness,
        migrated: Object.values(migrations).reduce((sum, count) => sum + count, 0),
        migrations,
        replacement_type: GENERIC_MULTIPIN_TYPE_ID,
      });
    } catch (error) {
      err(
        res,
        error instanceof Error ? error.message : 'Failed to delete connector type',
        500,
      );
    }
  });

  addRoute('GET', '/api/layouts', (_req, res, _params, query) => {
    json(res, readLayouts(harnessName(query) ?? 'fsae-car'));
  });

  addRoute('POST', '/api/save-harness', async (req, res, _params, query) => {
    const body = await parseBody(req);
    try {
      writeHarness(body as HarnessData, harnessName(query));
      json(res, { ok: true });
    } catch (error: any) {
      err(res, error.message ?? 'Failed to save harness', 500);
    }
  });

  addRoute('POST', '/api/save-layouts', async (req, res, _params, query) => {
    const body = await parseBody(req);
    writeLayouts(body, harnessName(query));
    json(res, { ok: true });
  });

  addRoute('POST', '/api/save-library', async (req, res) => {
    const body = await parseBody(req);
    const validation = validateConnectorLibraryData(body);
    if (!validation.valid) {
      err(res, validation.errors.join(' '), 400);
      return;
    }
    writeJSONAtomic(libraryFile(), body);
    json(res, { ok: true });
  });

  addRoute('POST', '/api/save-manufacturing', async (req, res, _params, query) => {
    const body = await parseBody(req);
    try {
      writeManufacturing(body, harnessName(query) ?? 'fsae-car');
      json(res, { ok: true });
    } catch (error) {
      err(
        res,
        error instanceof Error ? error.message : 'Failed to save manufacturing progress',
        400,
      );
    }
  });

  addRoute('GET', '/api/list-assets', (_req, res) => {
    try {
      json(res, listImageFiles());
    } catch {
      json(res, []);
    }
  });

  addRoute('GET', '/api/list-connector-assets', (_req, res) => {
    try {
      json(res, listImageFiles());
    } catch {
      json(res, []);
    }
  });

  addRoute('POST', '/api/upload-image', async (req, res, _params, query) => {
    const requestedName = query.get('filename')
      ?? (typeof req.headers['x-filename'] === 'string' ? req.headers['x-filename'] : null);
    if (!requestedName) {
      err(res, 'Missing filename. Pass ?filename=photo.png or an X-Filename header.');
      return;
    }

    const sanitized = sanitizeImageFilename(requestedName);
    if (!sanitized) {
      err(res, 'Invalid filename. Use png, jpg, jpeg, webp, or gif.');
      return;
    }

    try {
      const body = await parseRawBody(req, IMAGE_UPLOAD_MAX_BYTES);
      if (!body.length) {
        err(res, 'Empty file body.');
        return;
      }

      const dir = imagesDir();
      fs.mkdirSync(dir, { recursive: true });
      const filename = uniqueImageFilename(dir, sanitized);
      const dest = path.join(dir, filename);
      fs.writeFileSync(dest, body);
      json(res, { ok: true, filename });
    } catch (error: any) {
      err(res, error.message ?? 'Failed to upload image', 500);
    }
  });

  const USER_DATA_MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
  };

  function tryServeUserData(pathname: string, method: string, res: ServerResponse): boolean {
    // Vite's publicDir snapshot misses files written after boot (uploads), and
    // public/user-data is watch-ignored — so always read these from disk.
    if (!pathname.startsWith('/user-data/')) return false;

    const userDataRoot = path.resolve(projectRoot, 'public', 'user-data');
    const relative = decodeURIComponent(pathname.slice('/user-data/'.length));
    const filePath = path.resolve(userDataRoot, relative);
    if (filePath !== userDataRoot && !filePath.startsWith(userDataRoot + path.sep)) {
      err(res, 'Invalid path', 400);
      return true;
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return false;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = USER_DATA_MIME[ext] ?? 'application/octet-stream';
    const stat = fs.statSync(filePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Last-Modified', stat.mtime.toUTCString());
    if (method === 'HEAD') {
      res.end();
    } else {
      res.end(fs.readFileSync(filePath));
    }
    return true;
  }

  return function apiMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const parsed = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = parsed.pathname;
    const method = req.method?.toUpperCase() ?? 'GET';

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if ((method === 'GET' || method === 'HEAD') && tryServeUserData(pathname, method, res)) {
      return;
    }

    if (!pathname.startsWith('/api')) {
      next();
      return;
    }

    for (const route of routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.pattern);
      if (!match) continue;

      const params: Params = {};
      route.paramNames.forEach((name, index) => {
        params[name] = decodeURIComponent(match[index + 1]);
      });

      try {
        const result = route.handler(req, res, params, parsed.searchParams);
        if (result instanceof Promise) {
          result.catch((error) => {
            console.error('API error:', error);
            if (!res.headersSent) err(res, error.message ?? 'Internal error', 500);
          });
        }
      } catch (error: any) {
        console.error('API error:', error);
        if (!res.headersSent) err(res, error.message ?? 'Internal error', 500);
      }
      return;
    }

    err(res, `No route: ${method} ${pathname}`, 404);
  };
}
