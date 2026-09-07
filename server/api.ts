/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  isSheetedSystem,
  sheetSystemDir,
  flatSystemFile,
  readSheetedSystem,
  planSheetedWrite,
  commitSheetedWrite,
  type Connector,
  type Enclosure,
  type BranchPoint,
  type ConnectorPathNode,
  type BranchPointPathNode,
  type PathNode,
  type PathMeasurement,
  type PathEntity,
  type Signal,
  type SystemData,
} from './sheets.js';
import {
  AUTO_BULKHEAD_REASON,
  BULKHEAD_DISPLAY_PROPERTY,
  BULKHEAD_DOT_DISPLAY,
  ensureEnclosureBulkheadPlaceholders,
  isTerminalVisualDot,
  routeRequestToken,
  unmergeNonTerminalVisualDots,
} from './routing.js';
import { ensureSubsystemAncestorFrames } from '../src/lib/subsystem.js';
import { normalizeSystemData, normalizeLayouts, normalizeManufacturingDocument } from '../src/lib/systemNormalize.js';
import { createAuth, type PublicUser, type User } from './auth.js';
import {
  LIBRARY_REVISION_KEY,
  bumpRev,
  checkCas,
  configureCollaborationState,
  getCollaborationPaths,
  getRev,
  getRevisionState,
  withSystemLock,
  type RevisionWriter,
} from './revisions.js';
import {
  checkpointPayloadDir,
  createCheckpoint,
  ensureDailyCheckpoint,
  getCheckpoint,
  listCheckpoints,
  pruneHistory,
  restoreManagedPayload,
  snapshotToHistory,
} from './history.js';
import { aggregateActivity, appendEditLog, type EditKind } from './editlog.js';
import { applyDiffToAttribution, getAttribution } from './attribution.js';
import {
  diffSystem,
  diffKeyedMap,
  type EntityDiff,
} from './systemDiff.js';
import { createPresenceHandler } from './presence.js';
import { addClient, broadcast } from './sse.js';
import {
  GENERIC_MULTIPIN_TYPE_ID,
  getConnectorSupportedKeyings,
  getConnectorSupportedPinCounts,
  getEffectivePinCount,
  isConnectorFamily,
} from '../src/lib/connectorFamily.js';

export type { Connector, Enclosure, BranchPoint, ConnectorPathNode, BranchPointPathNode, PathNode, PathMeasurement, PathEntity, Signal, SystemData };

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
    male_housing_part_number?: string;
    female_housing_part_number?: string;
    keyings?: string[];
    image?: string;
    male_image?: string;
    female_image?: string;
    side_image?: string;
    male_side_image?: string;
    female_side_image?: string;
  }>;
  image?: string;
  male_image?: string;
  female_image?: string;
  side_image?: string;
  male_side_image?: string;
  female_side_image?: string;
  default_properties?: Record<string, string>;
}

interface ConnectorLibrary {
  connector_types: ConnectorType[];
}

interface ManufacturingDocument {
  schema_version: '1.1.0' | '1.2.0';
  bundles: Record<string, {
    steps: Partial<Record<
      'ordered' | 'cut' | 'crimped' | 'populated' | 'qc' | 'installed',
      boolean
    >>;
    component_steps?: Record<string, Partial<Record<
      'ordered' | 'cut' | 'crimped' | 'populated' | 'qc' | 'installed',
      boolean
    >>>;
    endpoint_genders?: Record<string, 'male' | 'female'>;
    wire_progress?: Record<string, {
      cut?: boolean;
      ends?: Partial<Record<'from' | 'to', boolean>>;
    }>;
    branch_measured?: Record<string, boolean>;
    connector_guide_states?: Record<string, 'checking' | 'verified'>;
    task_attribution?: Record<string, {
      user_id: string;
      user_name: string;
      day: string;
    }>;
    work_log?: Array<{
      id: string;
      task_key: string;
      kind:
        | 'wire-cut'
        | 'wire-end'
        | 'branch-measured'
        | 'connector-guide'
        | 'component-step';
      action: 'complete' | 'reopen';
      state?: string;
      quantity?: number;
      unit?: 'ea' | 'mm';
      user_id: string;
      user_name: string;
      day: string;
    }>;
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
      for (const field of [
        'housing_part_number',
        'male_housing_part_number',
        'female_housing_part_number',
        'image',
        'male_image',
        'female_image',
        'side_image',
        'male_side_image',
        'female_side_image',
      ] as const) {
        if (variant[field] !== undefined && typeof variant[field] !== 'string') {
          errors.push(`Connector family ${label} has invalid ${field}.`);
        }
      }
    }
    for (const field of [
      'male_crimp_part_number',
      'female_crimp_part_number',
      'image',
      'male_image',
      'female_image',
      'side_image',
      'male_side_image',
      'female_side_image',
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
  images?: Record<string, any>;
  connectorTypeSizes?: Record<string, { w: number; h: number }>;
  textBoxes?: Record<string, any>;
  waypoints?: Record<string, any>;
  sharedAnchors?: Record<string, any>;
  branchPoints?: Record<string, Record<string, { x: number; y: number }>>;
  rotations?: Record<string, number>;
  routeStyles?: Record<string, 'grid' | 'straight'>;
  viewRouteStyles?: Record<string, 'grid' | 'straight'>;
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

/** Dual-read incoming payloads (legacy or canonical) into canonical SystemData. */
function normalizeSystem(raw: unknown): SystemData {
  return ensureEnclosureBulkheadPlaceholders(normalizeSystemData(raw)).system;
}

function getPathSignalId(pathItem: Pick<PathEntity, 'signal_id' | 'tags'>): string | null {
  if (pathItem.signal_id) return pathItem.signal_id;
  const slug = pathItem.tags.find((tag) => tag.startsWith('signal:'))?.slice(7);
  return slug ? `sig_${slug}` : null;
}

function getPathNodeRefKey(node: PathNode): string {
  return node.kind === 'connector'
    ? `connector:${node.connector_id}:${node.pin_number}`
    : `branch:${node.branch_point_id}`;
}

type BulkheadSide = 'internal' | 'external';

function isBulkheadConnector(system: SystemData, connector: Connector): boolean {
  if (connector.mounting === 'inline') return false;
  if (connector.mounting === 'bulkhead') return true;
  return connector.parent !== null
    && system.hierarchy.some(
      (enclosure) => enclosure.id === connector.parent && enclosure.kind === 'enclosure',
    );
}

function isInlineConnector(connector: Connector): boolean {
  return connector.mounting === 'inline';
}

function isPassThroughConnector(system: SystemData, connector: Connector): boolean {
  return isInlineConnector(connector) || isBulkheadConnector(system, connector);
}

function isParentInsideEnclosure(
  system: SystemData,
  parentId: string | null,
  enclosureId: string,
): boolean {
  const enclosureById = new Map(
    system.hierarchy.map((enclosure) => [enclosure.id, enclosure]),
  );
  let current = parentId;
  while (current) {
    if (current === enclosureId) return true;
    current = enclosureById.get(current)?.parent ?? null;
  }
  return false;
}

function getBulkheadConnectionSide(
  system: SystemData,
  bulkhead: Connector,
  other: Connector | PathNode,
): BulkheadSide {
  const otherConnector = 'kind' in other
    ? (other.kind === 'connector'
        ? system.connectors.find((connector) => connector.id === other.connector_id)
        : undefined)
    : other;
  if (otherConnector && otherConnector.id !== bulkhead.id && otherConnector.parent === bulkhead.parent) {
    // A sibling connector mounted directly on this bulkhead's own enclosure
    // (e.g. another visual dot on the same wall) is a peer feed-through, not
    // something physically inside it — the parent-chain walk below would
    // otherwise misclassify it as internal on the very first step. Matches
    // the client-side isInteriorToEnclosure convention in src/lib/systemTopology.ts.
    return isInlineConnector(otherConnector) ? 'internal' : 'external';
  }
  const parentId = otherConnector
    ? otherConnector.parent
    : ('kind' in other && other.kind === 'branch'
        ? system.branchPoints.find((branchPoint) => branchPoint.id === other.branch_point_id)?.parent ?? null
        : null);
  return bulkhead.parent && isParentInsideEnclosure(system, parentId, bulkhead.parent)
    ? 'internal'
    : 'external';
}

function derivePathSegments(system: SystemData) {
  return system.paths.flatMap((pathItem) =>
    pathItem.nodes.slice(0, -1).map((node, index) => ({
      id: `${pathItem.id}::${index}`,
      pathId: pathItem.id,
      from: node,
      to: pathItem.nodes[index + 1],
    })),
  );
}

function getOccupiedPinNumbers(system: SystemData, connectorId: string): number[] {
  return system.paths.flatMap((pathItem) =>
    pathItem.nodes
      .filter((node): node is ConnectorPathNode => node.kind === 'connector' && node.connector_id === connectorId)
      // Missing/invalid pin_number (legacy ring terminals) counts as cavity 1.
      .map((node) => (Number.isInteger(node.pin_number) && node.pin_number > 0 ? node.pin_number : 1)),
  );
}

export function migrateConnectorTypeToGeneric(
  system: SystemData,
  removedType: ConnectorType,
  genericType: ConnectorType,
): { system: SystemData; migrated: number } {
  const next = structuredClone(system);
  let migrated = 0;
  for (const connector of next.connectors) {
    if (connector.connector_type !== removedType.id) continue;
    const occupiedFloor = Math.max(0, ...getOccupiedPinNumbers(next, connector.id));
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
  return { system: next, migrated };
}

function countPathNodeRefMatches(pathItem: Pick<PathEntity, 'nodes'>, ref: PathNodeRef): number {
  const refKey = getPathNodeRefKey(ref);
  return pathItem.nodes.filter((node) => getPathNodeRefKey(node) === refKey).length;
}

export function validateSystemData(system: SystemData, library: ConnectorLibrary | null) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const signalPropertyDefinitions = system.signalPropertyDefinitions ?? [];
  const allIds = new Map<string, string>();
  const registerId = (entityType: string, id: string) => {
    const existing = allIds.get(id);
    if (existing) errors.push(`Duplicate ID '${id}' used by both ${existing} and ${entityType}`);
    else allIds.set(id, entityType);
  };

  system.hierarchy.forEach((entity) => registerId('enclosure', entity.id));
  system.connectors.forEach((entity) => registerId('connector', entity.id));
  system.branchPoints.forEach((entity) => registerId('branchPoint', entity.id));
  system.paths.forEach((entity) => registerId('path', entity.id));
  system.signals.forEach((entity) => registerId('signal', entity.id));
  signalPropertyDefinitions.forEach((entity) =>
    registerId('signal property definition', entity.id)
  );

  const enclosureIds = new Set(system.hierarchy.map((entity) => entity.id));
  const connectorIds = new Set(system.connectors.map((entity) => entity.id));
  const branchPointIds = new Set(system.branchPoints.map((entity) => entity.id));
  const signalIds = new Set(system.signals.map((entity) => entity.id));
  const signalPropertyKeys = new Set<string>();
  const connectorTypeById = new Map((library?.connector_types ?? []).map((item) => [item.id, item]));
  const occupancy = new Map<string, string[]>();

  for (const definition of signalPropertyDefinitions) {
    if (!definition.key?.trim()) {
      errors.push(`Signal property definition '${definition.id}' has no property key`);
    } else if (signalPropertyKeys.has(definition.key)) {
      errors.push(`Duplicate signal property key '${definition.key}'`);
    } else {
      signalPropertyKeys.add(definition.key);
    }
    if (!definition.name?.trim()) {
      errors.push(`Signal property definition '${definition.id}' has no display name`);
    }
    if (
      definition.type !== 'select'
      || !Array.isArray(definition.options)
      || definition.options.length === 0
      || definition.options.some((option) => typeof option !== 'string' || !option.trim())
    ) {
      errors.push(`Signal property definition '${definition.id}' must declare selectable options`);
    }
    if (new Set(definition.options).size !== definition.options.length) {
      errors.push(`Signal property definition '${definition.id}' contains duplicate options`);
    }
  }
  for (const signal of system.signals) {
    for (const definition of signalPropertyDefinitions) {
      const value = signal.properties[definition.key];
      if (value !== undefined && !definition.options.includes(value)) {
        warnings.push(
          `Signal '${signal.id}' uses '${value}' for '${definition.key}', which is not an allowed option`,
        );
      }
    }
  }

  for (const enclosure of system.hierarchy) {
    if (enclosure.parent && !enclosureIds.has(enclosure.parent)) {
      errors.push(`Enclosure '${enclosure.id}' references missing parent enclosure '${enclosure.parent}'`);
    }
  }

  for (const connector of system.connectors) {
    if (connector.parent && !enclosureIds.has(connector.parent)) {
      warnings.push(`Connector '${connector.id}' parent '${connector.parent}' is not an enclosure`);
    }
    if (
      connector.mounting !== undefined
      && connector.mounting !== 'inline'
      && connector.mounting !== 'bulkhead'
    ) {
      errors.push(`Connector '${connector.id}' has invalid mounting '${String(connector.mounting)}'`);
    }
    if (connector.mounting === 'bulkhead') {
      const parent = connector.parent
        ? system.hierarchy.find((enclosure) => enclosure.id === connector.parent)
        : undefined;
      if (parent?.kind !== 'enclosure') {
        errors.push(`Connector '${connector.id}' is marked as a bulkhead without a container parent`);
      }
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
  for (const branchPoint of system.branchPoints) {
    if (branchPoint.parent && !enclosureIds.has(branchPoint.parent)) {
      warnings.push(`Branch point '${branchPoint.id}' parent '${branchPoint.parent}' is not an enclosure`);
    }
  }

  for (const pathItem of system.paths) {
    if (pathItem.nodes.length < 2) {
      warnings.push(`Path '${pathItem.id}' has fewer than 2 nodes`);
    }
    for (const node of pathItem.nodes) {
      if (node.kind === 'connector') {
        if (!connectorIds.has(node.connector_id)) {
          errors.push(`Path '${pathItem.id}' references missing connector '${node.connector_id}'`);
          continue;
        }
        const connector = system.connectors.find((item) => item.id === node.connector_id);
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
      } else if (!branchPointIds.has(node.branch_point_id)) {
        errors.push(`Path '${pathItem.id}' references missing branch point '${node.branch_point_id}'`);
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
    const signal = signalId ? system.signals.find((item) => item.id === signalId) : undefined;
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

  for (const branchPoint of system.branchPoints) {
    const incidentSegments = derivePathSegments(system).filter((segment) =>
      (segment.from.kind === 'branch' && segment.from.branch_point_id === branchPoint.id) ||
      (segment.to.kind === 'branch' && segment.to.branch_point_id === branchPoint.id),
    );
    if (incidentSegments.length < 2) {
      warnings.push(`Branch point '${branchPoint.id}' has fewer than 2 incident path segments`);
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
  configureCollaborationState(projectRoot);
  const auth = createAuth(projectRoot);
  const presenceHandler = createPresenceHandler(auth);
  const routes: Route[] = [];

  function addRoute(method: string, urlPath: string, handler: Handler) {
    const paramNames: string[] = [];
    const regexStr = urlPath.replace(/:([a-zA-Z_]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    routes.push({ method: method.toUpperCase(), pattern: new RegExp(`^${regexStr}$`), paramNames, handler });
  }

  function editorOnly(handler: Handler): Handler {
    return (req, res, params, query) => {
      if (!auth.requireEditor(req)) {
        json(res, { error: 'Forbidden' }, 403);
        return;
      }
      return handler(req, res, params, query);
    };
  }

  function addEditorRoute(method: string, urlPath: string, handler: Handler) {
    addRoute(method, urlPath, editorOnly(handler));
  }

  function sanitizeName(name: string) {
    return name.replace(/[^a-zA-Z0-9_-]/g, '');
  }

  function systemFile(name = 'fsae-car') {
    return flatSystemFile(projectRoot, sanitizeName(name));
  }

  function systemExists(name: string): boolean {
    const resolved = sanitizeName(name);
    return isSheetedSystem(projectRoot, resolved) || fs.existsSync(systemFile(resolved));
  }

  function listNamesInDir(dir: string): string[] {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const flatNames = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name.replace('.json', ''));
      const sheetedNames = entries
        .filter((entry) => entry.isDirectory() && (
          fs.existsSync(path.join(dir, entry.name, 'root.json'))
        ))
        .map((entry) => entry.name);
      return [...flatNames, ...sheetedNames];
    } catch {
      return [];
    }
  }

  function listSystemNames(): string[] {
    return [...new Set([
      ...listNamesInDir(path.join(projectRoot, 'public', 'user-data', 'systems')),
      ...listNamesInDir(path.join(projectRoot, 'public', 'user-data', 'harnesses')),
    ])].sort();
  }

  /** Display name from System data; falls back to storage key when unset. */
  function readSystemDisplayName(name: string): string {
    const resolved = sanitizeName(name);
    try {
      if (isSheetedSystem(projectRoot, resolved)) {
        const root = readJSON<{ name?: unknown }>(
          path.join(sheetSystemDir(projectRoot, resolved), 'root.json'),
        );
        if (typeof root.name === 'string' && root.name.trim()) return root.name.trim();
      } else {
        const data = readJSON<{ name?: unknown }>(systemFile(resolved));
        if (typeof data.name === 'string' && data.name.trim()) return data.name.trim();
      }
    } catch {
      // Fall through to storage key.
    }
    return resolved;
  }

  function listSystems(): Array<{ id: string; name: string }> {
    return listSystemNames().map((id) => ({
      id,
      name: readSystemDisplayName(id),
    }));
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

  function libraryFile() {
    return path.join(projectRoot, 'public', 'user-data', 'connectors', 'connector-library.json');
  }

  function subsystemDir(name = 'fsae-car') {
    return path.join(projectRoot, 'public', 'user-data', 'subsystems', sanitizeName(name));
  }

  function subsystemFile(systemKey: string, subsystemId: string) {
    return path.join(subsystemDir(systemKey), `${sanitizeName(subsystemId)}.json`);
  }

  function readJSON<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  function writeJSONAtomic(filePath: string, data: unknown) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    fs.renameSync(temp, filePath);
  }

  function readSystem(name?: string): SystemData {
    const resolved = sanitizeName(name ?? 'fsae-car');
    if (isSheetedSystem(projectRoot, resolved)) {
      return normalizeSystem(readSheetedSystem(sheetSystemDir(projectRoot, resolved)));
    }
    return normalizeSystem(readJSON<any>(systemFile(name)));
  }

  /**
   * Validates `data` and returns the deferred write for it.
   *
   * Anything that can reject a payload has to run here, before the caller takes
   * a history snapshot or bumps the revision, so a refused save never reaches
   * the rollback path -- restoring a payload that was never modified is pure
   * downside risk, since it replaces live files via rename.
   */
  function prepareSystemWrite(data: SystemData, name?: string): { commit: () => void } {
    const resolved = sanitizeName(name ?? 'fsae-car');
    const normalized = normalizeSystem(data);
    if (isSheetedSystem(projectRoot, resolved)) {
      const systemDir = sheetSystemDir(projectRoot, resolved);
      const plan = planSheetedWrite(systemDir, normalized);
      return { commit: () => commitSheetedWrite(systemDir, plan) };
    }
    return { commit: () => writeJSONAtomic(systemFile(name), normalized) };
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
      return normalizeLayouts(readJSON<unknown>(layoutsFile(name))) as LayoutData;
    } catch {
      return {};
    }
  }

  function writeLayouts(data: LayoutData, name = 'fsae-car') {
    writeJSONAtomic(layoutsFile(name), data);
  }

  function readManufacturing(name = 'fsae-car'): ManufacturingDocument {
    try {
      return normalizeManufacturingDocument(readJSON<unknown>(manufacturingFile(name)));
    } catch {
      return { schema_version: '1.2.0', bundles: {} };
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
      if (progress.component_steps !== undefined) {
        if (
          !progress.component_steps
          || typeof progress.component_steps !== 'object'
          || Array.isArray(progress.component_steps)
        ) {
          throw new Error(`Invalid component progress for bundle '${bundleId}'.`);
        }
        for (const [componentKey, componentSteps] of Object.entries(progress.component_steps)) {
          if (
            !componentKey
            || !componentSteps
            || typeof componentSteps !== 'object'
            || Array.isArray(componentSteps)
          ) {
            throw new Error(`Invalid component progress for '${componentKey}' in bundle '${bundleId}'.`);
          }
          for (const [step, completed] of Object.entries(componentSteps)) {
            if (!steps.has(step) || typeof completed !== 'boolean') {
              throw new Error(`Invalid manufacturing step '${step}' for component '${componentKey}'.`);
            }
          }
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
      if (progress.wire_progress !== undefined) {
        if (!isRecord(progress.wire_progress)) {
          throw new Error(`Invalid wire progress for bundle '${bundleId}'.`);
        }
        for (const [wireId, wireProgress] of Object.entries(progress.wire_progress)) {
          if (!wireId || !isRecord(wireProgress)) {
            throw new Error(`Invalid wire progress for '${wireId}' in bundle '${bundleId}'.`);
          }
          if (wireProgress.cut !== undefined && typeof wireProgress.cut !== 'boolean') {
            throw new Error(`Invalid cut state for wire '${wireId}'.`);
          }
          if (wireProgress.ends !== undefined) {
            if (
              !isRecord(wireProgress.ends)
              || Object.entries(wireProgress.ends).some(
                ([end, completed]) =>
                  (end !== 'from' && end !== 'to') || typeof completed !== 'boolean',
              )
            ) {
              throw new Error(`Invalid end progress for wire '${wireId}'.`);
            }
          }
        }
      }
      if (
        progress.branch_measured !== undefined
        && (
          !isRecord(progress.branch_measured)
          || Object.entries(progress.branch_measured).some(
            ([branchPointId, completed]) => !branchPointId || typeof completed !== 'boolean',
          )
        )
      ) {
        throw new Error(`Invalid branch-point measurements for bundle '${bundleId}'.`);
      }
      if (
        progress.connector_guide_states !== undefined
        && (
          !isRecord(progress.connector_guide_states)
          || Object.entries(progress.connector_guide_states).some(
            ([connectorId, guideState]) =>
              !connectorId || (guideState !== 'checking' && guideState !== 'verified'),
          )
        )
      ) {
        throw new Error(`Invalid connector guide states for bundle '${bundleId}'.`);
      }
      if (
        progress.task_attribution !== undefined
        && (
          !isRecord(progress.task_attribution)
          || Object.entries(progress.task_attribution).some(([, attribution]) =>
            !isRecord(attribution)
            || typeof attribution.user_id !== 'string'
            || typeof attribution.user_name !== 'string'
            || typeof attribution.day !== 'string'
            || !/^\d{4}-\d{2}-\d{2}$/.test(attribution.day)
          )
        )
      ) {
        throw new Error(`Invalid manufacturing attribution for bundle '${bundleId}'.`);
      }
      if (
        progress.work_log !== undefined
        && (
          !Array.isArray(progress.work_log)
          || progress.work_log.some((event) =>
            !isRecord(event)
            || typeof event.id !== 'string'
            || typeof event.task_key !== 'string'
            || ![
              'wire-cut',
              'wire-end',
              'branch-measured',
              'connector-guide',
              'component-step',
            ].includes(
              String(event.kind),
            )
            || (event.action !== 'complete' && event.action !== 'reopen')
            || typeof event.user_id !== 'string'
            || typeof event.user_name !== 'string'
            || typeof event.day !== 'string'
            || !/^\d{4}-\d{2}-\d{2}$/.test(event.day)
            || (event.quantity !== undefined
              && (typeof event.quantity !== 'number' || !Number.isFinite(event.quantity)))
            || (event.unit !== undefined && event.unit !== 'ea' && event.unit !== 'mm')
          )
        )
      ) {
        throw new Error(`Invalid manufacturing work log for bundle '${bundleId}'.`);
      }
      if (progress.notes !== undefined && typeof progress.notes !== 'string') {
        throw new Error(`Invalid manufacturing notes for bundle '${bundleId}'.`);
      }
    }
    writeJSONAtomic(manufacturingFile(name), {
      schema_version: '1.2.0',
      bundles: data.bundles,
    });
  }

  function systemName(query: URLSearchParams) {
    const value = query.get('system') ?? query.get('harness');
    if (value !== null && value !== undefined && (!value || sanitizeName(value) !== value)) {
      throw new Error(`Invalid system name '${value}'.`);
    }
    return value ?? undefined;
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

  class ApiWriteError extends Error {
    status: number;
    body: unknown;

    constructor(status: number, body: unknown, message?: string) {
      super(message ?? (body as { error?: string } | null)?.error ?? 'Write failed');
      this.status = status;
      this.body = body;
    }
  }

  function writerFor(req: IncomingMessage): RevisionWriter {
    const user = auth.requireEditor(req);
    if (!user) throw new ApiWriteError(403, { error: 'Forbidden' });
    return { id: user.id, displayName: user.displayName };
  }

  function parseBaseRevision(req: IncomingMessage): number {
    const value = req.headers['x-base-rev'];
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string' || !/^(0|[1-9]\d*)$/.test(raw)) return Number.NaN;
    const revision = Number(raw);
    return Number.isSafeInteger(revision) ? revision : Number.NaN;
  }

  function writeError(res: ServerResponse, error: unknown, fallback: string): void {
    if (error instanceof ApiWriteError) {
      json(res, error.body, error.status);
      return;
    }
    err(res, error instanceof Error ? error.message : fallback, 500);
  }

  function setRevisionHeader(res: ServerResponse, rev: number): void {
    res.setHeader('X-Revision', String(rev));
  }

  function changedIds(diff: Readonly<EntityDiff>): string[] {
    return [...new Set([...diff.added, ...diff.modified, ...diff.removed])].sort();
  }

  function removePath(filePath: string): void {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { recursive: true, force: true });
  }

  function historySnapshotRoot(systemKey: string, rev: number): string {
    return path.join(
      getCollaborationPaths().stateRoot,
      'history',
      systemKey,
      String(rev),
    );
  }

  function readSystemFromPayloadRoot(root: string, systemKey: string): SystemData {
    const canonicalDir = path.join(root, 'systems', systemKey);
    const canonicalFlat = path.join(root, 'systems', `${systemKey}.json`);
    const legacyDir = path.join(root, 'harnesses', systemKey);
    const legacyFlat = path.join(root, 'harnesses', `${systemKey}.json`);
    if (fs.existsSync(path.join(canonicalDir, 'root.json'))) {
      return normalizeSystem(readSheetedSystem(canonicalDir));
    }
    if (fs.existsSync(path.join(legacyDir, 'root.json'))) {
      return normalizeSystem(readSheetedSystem(legacyDir));
    }
    const flatFile = fs.existsSync(canonicalFlat) ? canonicalFlat : legacyFlat;
    if (!fs.existsSync(flatFile)) {
      throw new Error(`System snapshot '${systemKey}' is unavailable.`);
    }
    return normalizeSystem(readJSON<unknown>(flatFile));
  }

  function systemChangesSince(systemKey: string, baseRev: number, currentRev: number): string[] {
    if (baseRev === currentRev) return [];
    if (!Number.isSafeInteger(baseRev) || baseRev < 0 || baseRev > currentRev) return [];
    try {
      const previous = readSystemFromPayloadRoot(historySnapshotRoot(systemKey, baseRev), systemKey);
      return changedIds(diffSystem(previous, readSystem(systemKey)));
    } catch {
      return [];
    }
  }

  function libraryHistoryFile(rev: number): string {
    return path.join(
      getCollaborationPaths().stateRoot,
      'history',
      LIBRARY_REVISION_KEY,
      String(rev),
      'connector-library.json',
    );
  }

  function snapshotLibrary(rev: number): string {
    const source = libraryFile();
    if (!fs.existsSync(source)) throw new Error('Cannot snapshot a missing connector library.');
    const destination = libraryHistoryFile(rev);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(destination)) {
      if (!fs.readFileSync(source).equals(fs.readFileSync(destination))) {
        throw new Error(`Library history revision ${rev} already contains different bytes.`);
      }
      return destination;
    }
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.copyFileSync(source, temporary);
      fs.renameSync(temporary, destination);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return destination;
  }

  function libraryMap(library: ConnectorLibrary): Record<string, ConnectorType> {
    return Object.fromEntries(library.connector_types.map((type) => [type.id, type]));
  }

  function diffLibrary(previous: ConnectorLibrary, next: ConnectorLibrary): EntityDiff {
    return diffKeyedMap(libraryMap(previous), libraryMap(next));
  }

  function libraryChangesSince(baseRev: number, currentRev: number): string[] {
    if (baseRev === currentRev) return [];
    if (!Number.isSafeInteger(baseRev) || baseRev < 0 || baseRev > currentRev) return [];
    try {
      const previous = readJSON<ConnectorLibrary>(libraryHistoryFile(baseRev));
      const current = readLibrary();
      return current ? changedIds(diffLibrary(previous, current)) : [];
    } catch {
      return [];
    }
  }

  async function recordSystemWrite(
    systemKey: string,
    kind: EditKind,
    rev: number,
    diff: EntityDiff,
    writer: RevisionWriter,
  ): Promise<void> {
    const entityIds = changedIds(diff);
    await applyDiffToAttribution(systemKey, diff, writer, rev);
    appendEditLog(systemKey, {
      user: writer.id,
      displayName: writer.displayName,
      kind,
      rev,
      added: diff.added.length,
      modified: diff.modified.length,
      removed: diff.removed.length,
      entityIds,
    });
    await pruneHistory(systemKey);
    try {
      await ensureDailyCheckpoint(systemKey, writer);
    } catch (error) {
      // Best-effort: a failure here must never take down the write it rode
      // in on. It will simply retry on the next edit to this System.
      console.error(`Daily checkpoint failed for '${systemKey}':`, error);
    }
    broadcast(systemKey, 'rev', {
      rev,
      kind,
      by: writer,
      changedEntityIds: entityIds,
    });
  }

  interface SystemWriteBuild<T> {
    next: SystemData;
    value: T;
    sidecarWrite?: {
      write: () => void;
      diff: EntityDiff;
    };
  }

  async function commitSystemDocument<T>(
    req: IncomingMessage,
    systemKey: string,
    kind: EditKind,
    build: (previous: SystemData) => SystemWriteBuild<T> | Promise<SystemWriteBuild<T>>,
    baseRev: number | null = null,
    allowCreate = false,
  ): Promise<{ rev: number; value: T; diff: EntityDiff }> {
    const writer = writerFor(req);
    return await withSystemLock(systemKey, async () => {
      let currentRev: number;
      if (baseRev !== null) {
        const cas = checkCas(systemKey, baseRev);
        if (!cas.ok) {
          throw new ApiWriteError(409, {
            error: 'conflict',
            currentRev: cas.currentRev,
            baseRev: Number.isSafeInteger(cas.baseRev) ? cas.baseRev : null,
            lastWriter: cas.lastWriter,
            changedEntityIds: systemChangesSince(systemKey, cas.baseRev, cas.currentRev),
          });
        }
        currentRev = cas.currentRev;
      } else {
        currentRev = getRev(systemKey);
      }

      const existed = systemExists(systemKey);
      if (!existed && !allowCreate) {
        throw new ApiWriteError(404, { error: `System '${systemKey}' does not exist.` });
      }
      const previous = existed ? readSystem(systemKey) : normalizeSystem(undefined);
      const validationLibrary = readLibrary();
      const before = validateSystemData(previous, validationLibrary);
      const built = await build(structuredClone(previous));
      const next = normalizeSystem(built.next);

      // Both rejection checks run before the snapshot, the revision bump, and
      // any disk write. They used to run against an already-written payload and
      // undo it, but a save that never lands needs no rollback -- and rolling
      // back re-installs live files via rename, so doing it for a write that
      // never happened is pure downside risk. Leaving the revision alone also
      // keeps the client's next save from colliding with a bump it never saw.
      const after = validateSystemData(next, validationLibrary);
      if (after.error_count > before.error_count) {
        throw new ApiWriteError(500, {
          error: 'validation-degradation',
          errors: after.errors,
        });
      }
      const pendingWrite = prepareSystemWrite(next, systemKey);

      const snapshot = existed ? await snapshotToHistory(systemKey, currentRev) : null;
      const rev = await bumpRev(systemKey, writer);
      try {
        pendingWrite.commit();
        built.sidecarWrite?.write();
      } catch (writeFailure) {
        try {
          if (snapshot) restoreManagedPayload(snapshot, systemKey);
          else removePath(systemFile(systemKey));
        } catch (rollbackError) {
          throw new ApiWriteError(500, {
            error: 'write-failed',
            errors: after.errors,
            writeError: writeFailure instanceof Error
              ? writeFailure.message
              : String(writeFailure),
            rollbackError: rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
          });
        }
        throw writeFailure;
      }
      const systemDiff = diffSystem(previous, next);
      const diff = built.sidecarWrite
        ? combineDiffs([systemDiff, built.sidecarWrite.diff])
        : systemDiff;
      await recordSystemWrite(systemKey, kind, rev, diff, writer);
      return { rev, value: built.value, diff };
    });
  }

  interface SidecarWriteBuild<TDocument, TValue> {
    next: TDocument;
    value: TValue;
    diff: EntityDiff;
  }

  async function commitSystemSidecar<TDocument, TValue>(
    req: IncomingMessage,
    systemKey: string,
    kind: EditKind,
    readDocument: () => TDocument,
    build: (
      previous: TDocument,
    ) => SidecarWriteBuild<TDocument, TValue> | Promise<SidecarWriteBuild<TDocument, TValue>>,
    writeDocument: (next: TDocument) => void,
  ): Promise<{ rev: number; value: TValue; diff: EntityDiff }> {
    const writer = writerFor(req);
    return await withSystemLock(systemKey, async () => {
      const currentRev = getRev(systemKey);
      const previousSystem = readSystem(systemKey);
      const validationLibrary = readLibrary();
      const before = validateSystemData(previousSystem, validationLibrary);
      const previousDocument = readDocument();
      const built = await build(structuredClone(previousDocument));
      const snapshot = await snapshotToHistory(systemKey, currentRev);
      const rev = await bumpRev(systemKey, writer);
      writeDocument(built.next);
      const after = validateSystemData(readSystem(systemKey), validationLibrary);
      if (after.error_count > before.error_count) {
        try {
          restoreManagedPayload(snapshot, systemKey);
        } catch (rollbackError) {
          throw new ApiWriteError(500, {
            error: 'validation-degradation',
            errors: after.errors,
            rollbackError: rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
          });
        }
        throw new ApiWriteError(500, {
          error: 'validation-degradation',
          errors: after.errors,
        });
      }
      await recordSystemWrite(systemKey, kind, rev, built.diff, writer);
      return { rev, value: built.value, diff: built.diff };
    });
  }

  async function commitLibrary(
    req: IncomingMessage,
    build: (previous: ConnectorLibrary) => ConnectorLibrary | Promise<ConnectorLibrary>,
    baseRev: number | null,
  ): Promise<{ rev: number; library: ConnectorLibrary; diff: EntityDiff }> {
    const writer = writerFor(req);
    return await withSystemLock(LIBRARY_REVISION_KEY, async () => {
      let currentRev: number;
      if (baseRev !== null) {
        const cas = checkCas(LIBRARY_REVISION_KEY, baseRev);
        if (!cas.ok) {
          throw new ApiWriteError(409, {
            error: 'conflict',
            currentRev: cas.currentRev,
            baseRev: Number.isSafeInteger(cas.baseRev) ? cas.baseRev : null,
            lastWriter: cas.lastWriter,
            changedEntityIds: libraryChangesSince(cas.baseRev, cas.currentRev),
          });
        }
        currentRev = cas.currentRev;
      } else {
        currentRev = getRev(LIBRARY_REVISION_KEY);
      }

      const previous = readLibrary();
      if (!previous) throw new ApiWriteError(404, { error: 'Connector library not found' });
      const next = await build(structuredClone(previous));
      const validation = validateConnectorLibraryData(next);
      if (!validation.valid) {
        throw new ApiWriteError(400, { error: validation.errors.join(' ') });
      }
      snapshotLibrary(currentRev);
      const rev = await bumpRev(LIBRARY_REVISION_KEY, writer);
      writeJSONAtomic(libraryFile(), next);
      const diff = diffLibrary(previous, next);
      const entityIds = changedIds(diff);
      await applyDiffToAttribution(LIBRARY_REVISION_KEY, diff, writer, rev);
      appendEditLog(LIBRARY_REVISION_KEY, {
        user: writer.id,
        displayName: writer.displayName,
        kind: 'library',
        rev,
        added: diff.added.length,
        modified: diff.modified.length,
        removed: diff.removed.length,
        entityIds,
      });
      await pruneHistory(LIBRARY_REVISION_KEY);
      for (const systemKey of listSystemNames()) {
        broadcast(systemKey, 'rev', {
          rev,
          kind: 'library',
          by: writer,
          changedEntityIds: entityIds,
        });
      }
      return { rev, library: next, diff };
    });
  }

  const LAYOUT_MAP_KEYS = [
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
  ] as const;

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function mergeRecordPatch<T>(
    current: Record<string, T>,
    patch: unknown,
    removed: unknown,
  ): Record<string, T> {
    if (patch !== undefined && !isRecord(patch)) {
      throw new ApiWriteError(400, { error: 'Patch values must be object maps' });
    }
    if (removed !== undefined && !Array.isArray(removed)) {
      throw new ApiWriteError(400, { error: 'Removed values must be arrays' });
    }
    const next = { ...current, ...((patch ?? {}) as Record<string, T>) };
    for (const id of (removed ?? []) as unknown[]) {
      if (typeof id !== 'string') {
        throw new ApiWriteError(400, { error: 'Removed keys must be strings' });
      }
      delete next[id];
    }
    return next;
  }

  function mergeLayouts(
    current: LayoutData,
    patchValue: unknown,
    removedValue: unknown,
  ): LayoutData {
    if (!isRecord(patchValue) || !isRecord(removedValue)) {
      throw new ApiWriteError(400, { error: 'Layout update requires { patch, removed }' });
    }
    const patch = patchValue as Record<string, unknown>;
    const removed = removedValue as Record<string, unknown>;
    const next = structuredClone(current);
    for (const key of LAYOUT_MAP_KEYS) {
      if (patch[key] === undefined && removed[key] === undefined) continue;
      Object.assign(next, {
        [key]: mergeRecordPatch(
          (current[key] ?? {}) as Record<string, unknown>,
          patch[key],
          removed[key],
        ),
      });
    }

    if (patch.branchPoints !== undefined || removed.branchPoints !== undefined) {
      if (patch.branchPoints !== undefined && !isRecord(patch.branchPoints)) {
        throw new ApiWriteError(400, { error: 'branchPoints patch must be an object map' });
      }
      const branchPoints = structuredClone(current.branchPoints ?? {});
      for (const [contextKey, contextPatch] of Object.entries(
        (patch.branchPoints ?? {}) as Record<string, unknown>,
      )) {
        if (!isRecord(contextPatch)) {
          throw new ApiWriteError(400, {
            error: `branchPoints patch '${contextKey}' must be an object map`,
          });
        }
        branchPoints[contextKey] = {
          ...(branchPoints[contextKey] ?? {}),
          ...(contextPatch as Record<string, { x: number; y: number }>),
        };
      }

      if (Array.isArray(removed.branchPoints)) {
        for (const contextKey of removed.branchPoints) {
          if (typeof contextKey !== 'string') {
            throw new ApiWriteError(400, { error: 'Removed branch-point contexts must be strings' });
          }
          delete branchPoints[contextKey];
        }
      } else if (removed.branchPoints !== undefined) {
        if (!isRecord(removed.branchPoints)) {
          throw new ApiWriteError(400, { error: 'Removed branch points must be an object map' });
        }
        for (const [contextKey, ids] of Object.entries(removed.branchPoints)) {
          if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
            throw new ApiWriteError(400, {
              error: `Removed branch points for '${contextKey}' must be a string array`,
            });
          }
          const context = { ...(branchPoints[contextKey] ?? {}) };
          for (const id of ids) delete context[id];
          branchPoints[contextKey] = context;
        }
      }
      next.branchPoints = branchPoints;
    }
    return next;
  }

  function combineDiffs(diffs: readonly EntityDiff[]): EntityDiff {
    return {
      added: [...new Set(diffs.flatMap((diff) => diff.added))].sort(),
      modified: [...new Set(diffs.flatMap((diff) => diff.modified))].sort(),
      removed: [...new Set(diffs.flatMap((diff) => diff.removed))].sort(),
    };
  }

  function diffLayouts(previous: LayoutData, next: LayoutData): EntityDiff {
    const diffs = LAYOUT_MAP_KEYS.map((key) =>
      diffKeyedMap(
        (previous[key] ?? {}) as Record<string, unknown>,
        (next[key] ?? {}) as Record<string, unknown>,
      )
    );
    const previousBranchPoints = Object.fromEntries(
      Object.entries(previous.branchPoints ?? {}).flatMap(([context, points]) =>
        Object.entries(points).map(([id, value]) => [`${context}:${id}`, value])
      ),
    );
    const nextBranchPoints = Object.fromEntries(
      Object.entries(next.branchPoints ?? {}).flatMap(([context, points]) =>
        Object.entries(points).map(([id, value]) => [`${context}:${id}`, value])
      ),
    );
    const branchPointDiff = diffKeyedMap(previousBranchPoints, nextBranchPoints);
    const stripContext = (id: string) => id.slice(id.indexOf(':') + 1);
    diffs.push({
      added: branchPointDiff.added.map(stripContext),
      modified: branchPointDiff.modified.map(stripContext),
      removed: branchPointDiff.removed.map(stripContext),
    });
    return combineDiffs(diffs);
  }

  function listSubsystemDocuments(systemKey: string, root = getCollaborationPaths().userDataRoot) {
    const directory = path.join(root, 'subsystems', systemKey);
    if (!fs.existsSync(directory)) return [] as SubsystemDocument[];
    return fs.readdirSync(directory)
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map((file) => readJSON<SubsystemDocument>(path.join(directory, file)));
  }

  function subsystemRecord(documents: readonly SubsystemDocument[]) {
    return Object.fromEntries(documents.map((document) => [document.id, document]));
  }

  function mergeSubsystem(
    id: string,
    previous: SubsystemDocument | undefined,
    body: unknown,
  ): SubsystemDocument {
    if (!isRecord(body)) throw new ApiWriteError(400, { error: 'Request body required' });
    const bodyRecord = body as Record<string, unknown>;
    const patch = isRecord(bodyRecord.patch) ? bodyRecord.patch : bodyRecord;
    const removed = isRecord(bodyRecord.removed) ? bodyRecord.removed : {};
    const name = typeof patch.name === 'string' ? patch.name : previous?.name;
    if (!name) throw new ApiWriteError(400, { error: 'Subsystem requires a valid id and name' });

    const mapValue = <T>(
      key: 'enclosures' | 'devices' | 'connectors' | 'device_connector_mode',
    ): Record<string, T> => mergeRecordPatch(
      ((previous?.[key] ?? {}) as Record<string, T>),
      patch[key],
      removed[key],
    );
    const document: SubsystemDocument = {
      ...(previous ?? {
        schema_version: '1.0.0',
        id,
        name,
        tags: [],
        enclosures: {},
        devices: {},
        connectors: {},
      }),
      ...patch,
      schema_version: '1.0.0',
      id,
      name,
      tags: Array.isArray(patch.tags)
        ? patch.tags.filter((tag): tag is string => typeof tag === 'string')
        : previous?.tags ?? [],
      enclosures: mapValue('enclosures'),
      devices: mapValue('devices'),
      connectors: mapValue('connectors'),
      device_connector_mode: mapValue('device_connector_mode'),
    } as SubsystemDocument;
    if (patch.hidden_connectors !== undefined) {
      if (
        !Array.isArray(patch.hidden_connectors)
        || patch.hidden_connectors.some((idValue) => typeof idValue !== 'string')
      ) {
        throw new ApiWriteError(400, { error: 'hidden_connectors must be a string array' });
      }
      document.hidden_connectors = patch.hidden_connectors;
    }
    return document;
  }

  function readLayoutsFromRoot(root: string, systemKey: string): LayoutData {
    const file = path.join(root, `layouts.${systemKey}.json`);
    return fs.existsSync(file) ? readJSON<LayoutData>(file) : {};
  }

  function readManufacturingFromRoot(root: string, systemKey: string): ManufacturingDocument {
    const file = path.join(root, `manufacturing.${systemKey}.json`);
    if (!fs.existsSync(file)) return { schema_version: '1.2.0', bundles: {} };
    const data = readJSON<Partial<ManufacturingDocument>>(file);
    return {
      schema_version: '1.2.0',
      bundles: data.bundles && typeof data.bundles === 'object' ? data.bundles : {},
    };
  }

  function recordPatch<T>(
    previous: Record<string, T>,
    next: Record<string, T>,
  ): { patch: Record<string, T>; removed: string[]; diff: EntityDiff } {
    const diff = diffKeyedMap(previous, next);
    const patch: Record<string, T> = {};
    for (const id of [...diff.added, ...diff.modified]) patch[id] = next[id];
    return { patch, removed: diff.removed, diff };
  }

  function layoutPatch(previous: LayoutData, next: LayoutData) {
    const patch: Record<string, unknown> = {};
    const removed: Record<string, string[]> = {};
    for (const key of [...LAYOUT_MAP_KEYS, 'branchPoints'] as const) {
      const delta = recordPatch(
        (previous[key] ?? {}) as Record<string, unknown>,
        (next[key] ?? {}) as Record<string, unknown>,
      );
      if (Object.keys(delta.patch).length > 0) patch[key] = delta.patch;
      if (delta.removed.length > 0) removed[key] = delta.removed;
    }
    return { patch, removed };
  }

  function jsonEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function fullState(systemKey: string) {
    const revision = getRevisionState(systemKey);
    return {
      rev: revision.rev,
      libraryRev: getRev(LIBRARY_REVISION_KEY),
      connectorLibrary: readLibrary() ?? { connector_types: [] },
      system: readSystem(systemKey),
      layouts: readLayouts(systemKey),
      manufacturing: readManufacturing(systemKey),
      subsystems: listSubsystemDocuments(systemKey),
      attribution: getAttribution(systemKey),
      lastWriter: revision.lastWriter,
    };
  }

  function syncDelta(systemKey: string, since: number) {
    const current = fullState(systemKey);
    if (since === current.rev) {
      return {
        rev: current.rev,
        libraryRev: current.libraryRev,
        full: false,
        changed: { connectorLibrary: current.connectorLibrary },
        changedEntityIds: [],
      };
    }
    const snapshotRoot = historySnapshotRoot(systemKey, since);
    if (
      !Number.isSafeInteger(since)
      || since < 0
      || since > current.rev
      || current.rev - since > 50
      || !fs.existsSync(snapshotRoot)
    ) {
      return { ...current, full: true };
    }

    const previousSystem = readSystemFromPayloadRoot(snapshotRoot, systemKey);
    const previousLayouts = readLayoutsFromRoot(snapshotRoot, systemKey);
    const previousManufacturing = readManufacturingFromRoot(snapshotRoot, systemKey);
    const previousSubsystems = subsystemRecord(listSubsystemDocuments(systemKey, snapshotRoot));
    const currentSubsystems = subsystemRecord(current.subsystems);
    const changed: Record<string, unknown> = {};
    const systemDiff = diffSystem(previousSystem, current.system);
    const layoutDelta = layoutPatch(previousLayouts, current.layouts);
    const manufacturingDelta = recordPatch(
      previousManufacturing.bundles,
      current.manufacturing.bundles,
    );
    const subsystemDelta = recordPatch(previousSubsystems, currentSubsystems);

    if (!jsonEqual(previousSystem, current.system)) changed.system = current.system;
    if (Object.keys(layoutDelta.patch).length > 0 || Object.keys(layoutDelta.removed).length > 0) {
      changed.layouts = layoutDelta;
    }
    if (Object.keys(manufacturingDelta.patch).length > 0 || manufacturingDelta.removed.length > 0) {
      changed.manufacturing = {
        patch: manufacturingDelta.patch,
        removed: manufacturingDelta.removed,
      };
    }
    if (Object.keys(subsystemDelta.patch).length > 0 || subsystemDelta.removed.length > 0) {
      changed.subsystems = {
        patch: subsystemDelta.patch,
        removed: subsystemDelta.removed,
      };
    }
    changed.attribution = current.attribution;
    changed.lastWriter = current.lastWriter;
    changed.connectorLibrary = current.connectorLibrary;

    return {
      rev: current.rev,
      libraryRev: current.libraryRev,
      full: false,
      changed,
      changedEntityIds: changedIds(combineDiffs([
        systemDiff,
        diffLayouts(previousLayouts, current.layouts),
        manufacturingDelta.diff,
        subsystemDelta.diff,
      ])),
    };
  }

  function withoutLogin(user: User): PublicUser {
    const {
      id,
      displayName,
      role,
      color,
      createdAt,
      createdBy,
    } = user;
    return { id, displayName, role, color, createdAt, createdBy };
  }

  function hideLoginInUserResponse(handler: Handler): Handler {
    return async (req, res, params, query) => {
      const response = new Proxy(res, {
        get(target, property, receiver) {
          if (property !== 'end') {
            const value = Reflect.get(target, property, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
          }
          return (chunk?: string | Buffer, ...args: unknown[]) => {
            let output = chunk;
            if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) {
              try {
                const parsed = JSON.parse(chunk.toString()) as { user?: User };
                if (parsed.user) output = JSON.stringify({ ...parsed, user: withoutLogin(parsed.user) }, null, 2);
              } catch {
                // Preserve non-JSON responses exactly.
              }
            }
            return Reflect.apply(target.end, target, [output, ...args]);
          };
        },
        set(target, property, value, receiver) {
          return Reflect.set(target, property, value, receiver);
        },
      });
      await handler(req, response, params, query);
    };
  }

  addRoute('POST', '/api/auth/login', auth.handlers.login);
  addRoute('POST', '/api/auth/logout', auth.handlers.logout);
  addRoute('GET', '/api/auth/me', auth.handlers.me);
  addRoute('POST', '/api/users', hideLoginInUserResponse(auth.handlers.createUser));

  addRoute('GET', '/api/state', (_req, res, _params, query) => {
    const name = sanitizeName(systemName(query) ?? 'fsae-car');
    try {
      json(res, fullState(name));
    } catch (error) {
      err(res, error instanceof Error ? error.message : 'Failed to load state', 404);
    }
  });

  addRoute('GET', '/api/sync', (_req, res, _params, query) => {
    const name = sanitizeName(systemName(query) ?? 'fsae-car');
    const rawSince = query.get('since');
    const since = rawSince !== null && /^(0|[1-9]\d*)$/.test(rawSince)
      ? Number(rawSince)
      : Number.NaN;
    try {
      json(res, syncDelta(name, since));
    } catch (error) {
      err(res, error instanceof Error ? error.message : 'Failed to synchronize state', 500);
    }
  });

  addRoute('GET', '/api/events', (req, res, _params, query) => {
    if (!auth.resolveUser(req)) {
      err(res, 'Authentication required', 401);
      return;
    }
    const name = sanitizeName(systemName(query) ?? 'fsae-car');
    addClient(req, res, name);
  });

  addRoute('POST', '/api/presence', presenceHandler);

  addRoute('GET', '/api/checkpoints', (_req, res, _params, query) => {
    const name = sanitizeName(systemName(query) ?? 'fsae-car');
    try {
      json(res, listCheckpoints(name));
    } catch (error) {
      err(res, error instanceof Error ? error.message : 'Failed to list checkpoints', 500);
    }
  });

  addEditorRoute('POST', '/api/checkpoints', async (req, res, _params, query) => {
    const name = sanitizeName(systemName(query) ?? 'fsae-car');
    try {
      const body = await parseBody(req);
      if (!isRecord(body) || typeof body.label !== 'string' || !body.label.trim()) {
        err(res, 'Checkpoint label is required');
        return;
      }
      const checkpoint = await createCheckpoint(name, body.label, writerFor(req));
      json(res, checkpoint, 201);
    } catch (error) {
      writeError(res, error, 'Failed to create checkpoint');
    }
  });

  addRoute('GET', '/api/checkpoints/:id', (_req, res, params, query) => {
    const name = sanitizeName(systemName(query) ?? 'fsae-car');
    try {
      json(res, getCheckpoint(name, params.id));
    } catch (error) {
      err(res, error instanceof Error ? error.message : 'Checkpoint not found', 404);
    }
  });

  addEditorRoute(
    'POST',
    '/api/checkpoints/:id/restore',
    async (req, res, params, query) => {
      const name = sanitizeName(systemName(query) ?? 'fsae-car');
      const writer = writerFor(req);
      try {
        const result = await withSystemLock(name, async () => {
          const previousSystem = readSystem(name);
          const previousLayouts = readLayouts(name);
          const previousManufacturing = readManufacturing(name);
          const previousSubsystems = subsystemRecord(listSubsystemDocuments(name));
          const validationLibrary = readLibrary();
          const before = validateSystemData(previousSystem, validationLibrary);
          const restored = getCheckpoint(name, params.id);
          const automaticCheckpoint = await createCheckpoint(
            name,
            `Auto-saved before restoring "${restored.label}"`,
            writer,
            true,
          );
          const currentRev = getRev(name);
          const snapshot = await snapshotToHistory(name, currentRev);
          const rev = await bumpRev(name, writer);
          try {
            restoreManagedPayload(checkpointPayloadDir(name, params.id), name);
          } catch (restoreError) {
            try {
              restoreManagedPayload(snapshot, name);
            } catch (rollbackError) {
              throw new ApiWriteError(500, {
                error: 'restore-failed',
                restoreError: restoreError instanceof Error
                  ? restoreError.message
                  : String(restoreError),
                rollbackError: rollbackError instanceof Error
                  ? rollbackError.message
                  : String(rollbackError),
              });
            }
            throw restoreError;
          }
          const nextSystem = readSystem(name);
          const after = validateSystemData(nextSystem, validationLibrary);
          if (after.error_count > before.error_count) {
            try {
              restoreManagedPayload(snapshot, name);
            } catch (rollbackError) {
              throw new ApiWriteError(500, {
                error: 'validation-degradation',
                errors: after.errors,
                rollbackError: rollbackError instanceof Error
                  ? rollbackError.message
                  : String(rollbackError),
              });
            }
            throw new ApiWriteError(500, {
              error: 'validation-degradation',
              errors: after.errors,
            });
          }
          const diff = combineDiffs([
            diffSystem(previousSystem, nextSystem),
            diffLayouts(previousLayouts, readLayouts(name)),
            diffKeyedMap(
              previousManufacturing.bundles,
              readManufacturing(name).bundles,
            ),
            diffKeyedMap(
              previousSubsystems,
              subsystemRecord(listSubsystemDocuments(name)),
            ),
          ]);
          await recordSystemWrite(name, 'restore', rev, diff, writer);
          return { restored, automaticCheckpoint, rev };
        });
        setRevisionHeader(res, result.rev);
        json(res, result);
      } catch (error) {
        writeError(res, error, 'Failed to restore checkpoint');
      }
    },
  );

  addRoute('GET', '/api/activity', (_req, res, _params, query) => {
    const name = sanitizeName(systemName(query) ?? 'fsae-car');
    const rawDays = query.get('days') ?? '30';
    const days = /^(0|[1-9]\d*)$/.test(rawDays) ? Number(rawDays) : Number.NaN;
    try {
      json(res, aggregateActivity(name, days));
    } catch (error) {
      err(res, error instanceof Error ? error.message : 'Failed to load activity');
    }
  });

  addRoute('GET', '/api/systems', (_req, res) => {
    json(res, listSystems());
  });
  addRoute('GET', '/api/harnesses', (_req, res) => {
    json(res, listSystems());
  });

  addRoute('GET', '/api/manufacturing', (_req, res, _params, query) => {
    json(res, readManufacturing(systemName(query) ?? 'fsae-car'));
  });

  addRoute('GET', '/api/system', (_req, res, _params, query) => {
    try {
      json(res, readSystem(systemName(query) ?? 'fsae-car'));
    } catch (error: any) {
      err(res, error.message, 404);
    }
  });
  addRoute('GET', '/api/harness', (_req, res, _params, query) => {
    try {
      json(res, readSystem(systemName(query) ?? 'fsae-car'));
    } catch (error: any) {
      err(res, error.message, 404);
    }
  });

  addEditorRoute('PUT', '/api/system', async (req, res, _params, query) => {
    const body = await parseBody(req);
    if (!body?.schema_version) {
      err(res, 'Invalid system data — must include schema_version');
      return;
    }
    const name = sanitizeName(systemName(query) ?? 'fsae-car');
    try {
      const result = await commitSystemDocument(req, name, 'system', () => ({
        next: body as SystemData,
        value: undefined,
      }), null, true);
      setRevisionHeader(res, result.rev);
      json(res, { ok: true, rev: result.rev });
    } catch (error) {
      writeError(res, error, 'Failed to save system');
    }
  });
  addEditorRoute('PUT', '/api/harness', async (req, res, _params, query) => {
    const body = await parseBody(req);
    if (!body?.schema_version) {
      err(res, 'Invalid system data — must include schema_version');
      return;
    }
    const name = sanitizeName(systemName(query) ?? 'fsae-car');
    try {
      const result = await commitSystemDocument(req, name, 'system', () => ({
        next: body as SystemData,
        value: undefined,
      }), null, true);
      setRevisionHeader(res, result.rev);
      json(res, { ok: true, rev: result.rev });
    } catch (error) {
      writeError(res, error, 'Failed to save system');
    }
  });

  addRoute('GET', '/api/subsystems', (_req, res, _params, query) => {
    const systemKey = sanitizeName(systemName(query) ?? 'fsae-car');
    const dir = subsystemDir(systemKey);
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

  addEditorRoute('PUT', '/api/subsystems/:id', async (req, res, params, query) => {
    const body = await parseBody(req);
    const id = sanitizeName(params.id);
    if (!id || id !== params.id) {
      err(res, 'Subsystem requires a valid id');
      return;
    }
    const systemKey = sanitizeName(systemName(query) ?? 'fsae-car');
    try {
      const result = await commitSystemSidecar(
        req,
        systemKey,
        'subsystem',
        () => subsystemRecord(listSubsystemDocuments(systemKey)),
        (previous) => {
          const document = mergeSubsystem(id, previous[id], body);
          const next = { ...previous, [id]: document };
          return {
            next,
            value: document,
            diff: diffKeyedMap(previous, next),
          };
        },
        (next) => writeJSONAtomic(subsystemFile(systemKey, id), next[id]),
      );
      setRevisionHeader(res, result.rev);
      json(res, { ...result.value, rev: result.rev });
    } catch (error) {
      writeError(res, error, 'Failed to save subsystem');
    }
  });

  addEditorRoute('DELETE', '/api/subsystems/:id', async (req, res, params, query) => {
    const systemKey = sanitizeName(systemName(query) ?? 'fsae-car');
    const file = subsystemFile(systemKey, params.id);
    try {
      const result = await commitSystemSidecar(
        req,
        systemKey,
        'subsystem',
        () => subsystemRecord(listSubsystemDocuments(systemKey)),
        (previous) => {
          if (!previous[params.id]) {
            throw new ApiWriteError(404, {
              error: `Subsystem not found: ${params.id}`,
            });
          }
          const next = { ...previous };
          delete next[params.id];
          return {
            next,
            value: undefined,
            diff: diffKeyedMap(previous, next),
          };
        },
        () => fs.unlinkSync(file),
      );
      setRevisionHeader(res, result.rev);
      json(res, { ok: true, rev: result.rev });
    } catch (error) {
      writeError(res, error, 'Failed to delete subsystem');
    }
  });

  // Creating a signal is the one entity write the UI performs outside of a full
  // document save: the graph's route picker can mint a signal before routing.
  addEditorRoute('POST', '/api/signals', async (req, res, _params, query) => {
    const body = await parseBody(req);
    if (!body?.name) {
      err(res, "Field 'name' is required");
      return;
    }
    const name = sanitizeName(systemName(query) ?? 'fsae-car');
    try {
      const result = await commitSystemDocument(req, name, 'system', (system) => {
        const signal: Signal = {
          id: body.id ?? genId('sig'),
          name: body.name,
          tags: body.tags ?? [],
          properties: body.properties ?? {},
        };
        if (system.signals.some((existing) => existing.id === signal.id)) {
          throw new ApiWriteError(409, {
            error: `Signal with id '${signal.id}' already exists`,
          });
        }
        system.signals.push(signal);
        return { next: system, value: signal };
      });
      setRevisionHeader(res, result.rev);
      json(res, result.value, 201);
    } catch (error) {
      writeError(res, error, 'Failed to create signal');
    }
  });

  addEditorRoute('POST', '/api/paths/route', async (req, res, _params, query) => {
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

    const name = sanitizeName(systemName(query) ?? 'fsae-car');
    const requestedSubsystemId = typeof body.subsystem_id === 'string' && body.subsystem_id
      ? sanitizeName(body.subsystem_id)
      : null;
    if (
      typeof body.subsystem_id === 'string'
      && body.subsystem_id
      && requestedSubsystemId !== body.subsystem_id
    ) {
      err(res, 'Subsystem requires a valid id');
      return;
    }
    const requestKey = String(
      body.request_id
      ?? `${body.from.connector_id}-${fromPin}-${body.to.connector_id}-${toPin}-${body.signal_id}`,
    );
    const token = routeRequestToken(requestKey);
    const pathId = `path_auto_${token}`;
    try {
      await withSystemLock(name, async () => {
        const current = readSystem(name);
        const existing = current.paths.find((wirePath) => {
          const requestIds = [
            wirePath.properties.route_request_id,
            ...(wirePath.properties.route_request_ids ?? '').split(','),
          ].filter(Boolean);
          return wirePath.id === pathId || requestIds.includes(requestKey);
        });
        if (existing) {
          json(res, {
            path: existing,
            system: current,
            generated_connectors: [],
            idempotent: true,
            ...(requestedSubsystemId && fs.existsSync(subsystemFile(name, requestedSubsystemId))
              ? { subsystem: readJSON<SubsystemDocument>(subsystemFile(name, requestedSubsystemId)) }
              : {}),
          });
          return;
        }

        const result = await commitSystemDocument(req, name, 'system', (system) => {
          const draftSpec = body.draft_connector;
          let draftConnector: Connector | undefined;
          if (draftSpec) {
            const draftId = String(draftSpec.id ?? '');
            const draftParentId = String(draftSpec.parent ?? '');
            if (
              !draftId
              || !draftParentId
              || (
                draftId !== body.from.connector_id
                && draftId !== body.to.connector_id
              )
            ) {
              throw new ApiWriteError(400, {
                error: 'Draft connector must identify one requested route endpoint and parent.',
              });
            }
            const existingDraft = system.connectors.find((item) => item.id === draftId);
            if (existingDraft) {
              draftConnector = existingDraft;
            } else {
              const parent = system.hierarchy.find((item) => item.id === draftParentId);
              if (!parent) {
                throw new ApiWriteError(404, {
                  error: `Draft connector parent not found: ${draftParentId}`,
                });
              }
              const systemTags = requestedSubsystemId ? [`system:${requestedSubsystemId}`] : [];
              const properties: Record<string, string> = {
                [BULKHEAD_DISPLAY_PROPERTY]: BULKHEAD_DOT_DISPLAY,
                generated_by_route: pathId,
                generated_by_routes: pathId,
              };
              if (parent.kind === 'enclosure') {
                Object.assign(properties, {
                  placeholder_reason: AUTO_BULKHEAD_REASON,
                  bulkhead_group_anchor: `dot:${draftId}`,
                  boundary_enclosure: parent.id,
                  boundary_sheet: parent.id,
                  boundary_name: parent.name,
                });
              }
              draftConnector = {
                id: draftId,
                name: typeof draftSpec.name === 'string' && draftSpec.name.trim()
                  ? draftSpec.name.trim()
                  : 'Visual dot',
                parent: parent.id,
                connector_type: GENERIC_MULTIPIN_TYPE_ID,
                mounting: parent.kind === 'enclosure' ? 'bulkhead' : 'inline',
                pin_count: 1,
                tags: Array.from(new Set([
                  'generated',
                  'unresolved',
                  'dot',
                  ...(parent.kind === 'enclosure' ? ['bulkhead'] : ['inline']),
                  ...systemTags,
                ])),
                properties,
              };
              system.connectors.push(draftConnector);
            }
          }
          const fromConnector = system.connectors.find(
            (item) => item.id === body.from.connector_id,
          );
          const toConnector = system.connectors.find(
            (item) => item.id === body.to.connector_id,
          );
          if (!fromConnector || !toConnector) {
            throw new ApiWriteError(404, {
              error: 'One or both connector endpoints do not exist',
            });
          }
          for (const connector of [fromConnector, toConnector]) {
            if (
              connector.id !== draftConnector?.id
              && connector.properties[BULKHEAD_DISPLAY_PROPERTY] === BULKHEAD_DOT_DISPLAY
              && !isTerminalVisualDot(system, connector.id)
            ) {
              throw new ApiWriteError(409, {
                error: `Visual dot ${connector.name} is not a terminal endpoint.`,
              });
            }
          }
          for (const [connector, pinNumber] of [
            [fromConnector, fromPin],
            [toConnector, toPin],
          ] as const) {
            if (
              connector.properties[BULKHEAD_DISPLAY_PROPERTY] === BULKHEAD_DOT_DISPLAY
              && pinNumber > (connector.pin_count ?? 1)
            ) {
              connector.pin_count = pinNumber;
            }
          }
          if (!system.signals.some((signal) => signal.id === body.signal_id)) {
            throw new ApiWriteError(404, { error: `Signal not found: ${body.signal_id}` });
          }
          if (fromConnector.id === toConnector.id && fromPin === toPin) {
            throw new ApiWriteError(409, {
              error: 'Cannot connect a cavity to itself',
            });
          }

          type PassThroughJoin = {
            pathId: string;
            nodeIndex: number;
          };
          const inspectEndpoint = (
            connector: Connector,
            pinNumber: number,
            otherConnector: Connector,
          ): PassThroughJoin | null => {
            const uses = system.paths.flatMap((wirePath) =>
              wirePath.nodes.flatMap((node, nodeIndex) =>
                node.kind === 'connector'
                && node.connector_id === connector.id
                && node.pin_number === pinNumber
                  ? [{ wirePath, nodeIndex }]
                  : []
              )
            );
            if (uses.length === 0) return null;
            if (!isPassThroughConnector(system, connector) || uses.length !== 1) {
              throw new ApiWriteError(409, {
                error: `Cannot route from or to occupied cavity ${connector.name}:${pinNumber}`,
              });
            }

            const [{ wirePath, nodeIndex }] = uses;
            if (nodeIndex !== 0 && nodeIndex !== wirePath.nodes.length - 1) {
              throw new ApiWriteError(409, {
                error: `${isInlineConnector(connector) ? 'Inline connector' : 'Bulkhead'} cavity ${connector.name}:${pinNumber} already has both connections`,
              });
            }
            const neighbor = wirePath.nodes[nodeIndex === 0 ? 1 : nodeIndex - 1];
            if (!neighbor) {
              throw new ApiWriteError(409, {
                error: `Pass-through cavity ${connector.name}:${pinNumber} has an invalid existing path`,
              });
            }
            if (isBulkheadConnector(system, connector)) {
              const existingSide = getBulkheadConnectionSide(system, connector, neighbor);
              const requestedSide = getBulkheadConnectionSide(system, connector, otherConnector);
              if (existingSide === requestedSide) {
                throw new ApiWriteError(409, {
                  error: `Bulkhead cavity ${connector.name}:${pinNumber} already has an ${requestedSide} connection`,
                });
              }
            }
            const existingSignalId = getPathSignalId(wirePath);
            if (existingSignalId && existingSignalId !== body.signal_id) {
              throw new ApiWriteError(409, {
                error: `The opposite side of ${connector.name}:${pinNumber} uses signal ${existingSignalId}`,
              });
            }
            return { pathId: wirePath.id, nodeIndex };
          };

          const fromJoin = inspectEndpoint(fromConnector, fromPin, toConnector);
          const toJoin = inspectEndpoint(toConnector, toPin, fromConnector);
          if (fromJoin && toJoin && fromJoin.pathId === toJoin.pathId) {
            throw new ApiWriteError(409, {
              error: 'These cavities are already connected by the same path',
            });
          }

          const routeNodes: PathNode[] = [
            { kind: 'connector', connector_id: fromConnector.id, pin_number: fromPin },
            { kind: 'connector', connector_id: toConnector.id, pin_number: toPin },
          ];
          let candidate = structuredClone(system);

          const requestIdsFor = (wirePath: PathEntity): string[] => [
            wirePath.properties.route_request_id,
            ...(wirePath.properties.route_request_ids ?? '').split(','),
          ].filter(Boolean);
          const recordRouteRequest = (wirePath: PathEntity, joinedPaths: PathEntity[] = []) => {
            const requestIds = new Set([
              ...requestIdsFor(wirePath),
              ...joinedPaths.flatMap(requestIdsFor),
              requestKey,
            ]);
            wirePath.properties.route_request_ids = [...requestIds].join(',');
            wirePath.signal_id ??= body.signal_id;
            wirePath.tags = Array.from(new Set([
              ...wirePath.tags,
              ...(body.tags ?? []),
              `signal:${String(body.signal_id).replace(/^sig_/, '')}`,
            ]));
          };
          const nodesFromJoin = (wirePath: PathEntity, nodeIndex: number): PathNode[] =>
            nodeIndex === 0 ? [...wirePath.nodes] : [...wirePath.nodes].reverse();

          let wirePath: PathEntity;
          if (!fromJoin && !toJoin) {
            wirePath = {
              id: pathId,
              name: body.name ?? `${fromConnector.name}:${fromPin} → ${toConnector.name}:${toPin}`,
              signal_id: body.signal_id,
              tags: Array.from(new Set([
                ...(body.tags ?? []),
                `signal:${String(body.signal_id).replace(/^sig_/, '')}`,
              ])),
              properties: { ...(body.properties ?? {}), route_request_id: requestKey },
              nodes: routeNodes,
              measurements: [],
            };
            candidate.paths.push(wirePath);
          } else if (fromJoin && toJoin) {
            const fromPath = candidate.paths.find((item) => item.id === fromJoin.pathId)!;
            const toPath = candidate.paths.find((item) => item.id === toJoin.pathId)!;
            const fromOutward = nodesFromJoin(fromPath, fromJoin.nodeIndex);
            const toOutward = nodesFromJoin(toPath, toJoin.nodeIndex);
            fromPath.nodes = [
              ...fromOutward.reverse(),
              ...routeNodes.slice(1, -1),
              ...toOutward,
            ];
            fromPath.measurements = [
              ...fromPath.measurements,
              ...toPath.measurements.filter((measurement) =>
                !fromPath.measurements.some((existingMeasurement) =>
                  JSON.stringify(existingMeasurement) === JSON.stringify(measurement)
                )
              ),
            ];
            recordRouteRequest(fromPath, [toPath]);
            candidate.paths = candidate.paths.filter((item) => item.id !== toPath.id);
            wirePath = fromPath;
          } else {
            const join = fromJoin ?? toJoin!;
            const existingPath = candidate.paths.find((item) => item.id === join.pathId)!;
            const outward = nodesFromJoin(existingPath, join.nodeIndex);
            existingPath.nodes = fromJoin
              ? [...outward.reverse(), ...routeNodes.slice(1)]
              : [...routeNodes.slice(0, -1), ...outward];
            recordRouteRequest(existingPath);
            wirePath = existingPath;
          }
          if (draftConnector) {
            draftConnector = candidate.connectors.find(
              (item) => item.id === draftConnector?.id,
            );
            if (draftConnector) {
              draftConnector.properties.generated_by_route = wirePath.id;
              draftConnector.properties.generated_by_routes = wirePath.id;
            }
          }
          const unmergedDots = unmergeNonTerminalVisualDots(
            candidate,
            new Set([fromConnector.id, toConnector.id]),
          );
          candidate = unmergedDots.system;
          wirePath = candidate.paths.find((item) => item.id === wirePath.id)!;
          if (draftConnector) {
            draftConnector = candidate.connectors.find(
              (item) => item.id === draftConnector?.id,
            );
          }
          const repaired = ensureEnclosureBulkheadPlaceholders(candidate, {
            pathIds: new Set([wirePath.id]),
          });
          candidate = repaired.system;
          wirePath = candidate.paths.find((item) => item.id === wirePath.id)!;
          if (draftConnector) {
            draftConnector = candidate.connectors.find(
              (item) => item.id === draftConnector?.id,
            );
          }
          const bulkheadConnectors = repaired.insertedConnectorIds.flatMap((connectorId) => {
            const connector = candidate.connectors.find((item) => item.id === connectorId);
            return connector ? [connector] : [];
          });
          const subsystemConnectors = Array.from(new Map([
            ...bulkheadConnectors,
            ...(draftConnector ? [draftConnector] : []),
            ...unmergedDots.created.flatMap(({ connectorId }) => {
              const connector = candidate.connectors.find((item) => item.id === connectorId);
              return connector ? [connector] : [];
            }),
          ].map((connector) => [connector.id, connector])).values());

          let savedSubsystem: SubsystemDocument | undefined;
          let sidecarWrite: SystemWriteBuild<unknown>['sidecarWrite'];
          if (requestedSubsystemId && subsystemConnectors.length > 0) {
            const previousSubsystems = subsystemRecord(listSubsystemDocuments(name));
            const previousSubsystem = previousSubsystems[requestedSubsystemId];
            if (!previousSubsystem) {
              throw new ApiWriteError(404, {
                error: `Subsystem not found: ${requestedSubsystemId}`,
              });
            }
            savedSubsystem = structuredClone(previousSubsystem);
            const systemTag = `system:${requestedSubsystemId}`;
            for (const connector of subsystemConnectors) {
              ensureSubsystemAncestorFrames(
                candidate,
                savedSubsystem,
                connector.parent,
                (frame) => {
                  if (!frame.tags.includes(systemTag)) frame.tags.push(systemTag);
                },
              );
              if (!savedSubsystem.connectors[connector.id]) {
                const connectorIndex = Object.keys(savedSubsystem.connectors).length;
                const isDraft = connector.id === draftConnector?.id;
                const splitSourceId = unmergedDots.created.find(
                  ({ connectorId }) => connectorId === connector.id,
                )?.sourceConnectorId;
                const splitSourceLayout = splitSourceId
                  ? savedSubsystem.connectors[splitSourceId]
                  : undefined;
                const draftX = Number(body.draft_connector?.x);
                const draftY = Number(body.draft_connector?.y);
                savedSubsystem.connectors[connector.id] = {
                  x: splitSourceLayout
                    ? splitSourceLayout.x + 24
                    : isDraft && Number.isFinite(draftX)
                    ? draftX
                    : 40 + (connectorIndex % 3) * 112,
                  y: splitSourceLayout
                    ? splitSourceLayout.y + 24
                    : isDraft && Number.isFinite(draftY)
                    ? draftY
                    : 80 + Math.floor(connectorIndex / 3) * 52,
                  w: isDraft ? 18 : 96,
                  h: isDraft ? 18 : 36,
                };
              }
              savedSubsystem.hidden_connectors = (savedSubsystem.hidden_connectors ?? [])
                .filter((connectorId) => connectorId !== connector.id);
              if (!connector.tags.includes(systemTag)) connector.tags.push(systemTag);
            }
            const nextSubsystems = {
              ...previousSubsystems,
              [requestedSubsystemId]: savedSubsystem,
            };
            sidecarWrite = {
              diff: diffKeyedMap(previousSubsystems, nextSubsystems),
              write: () => writeJSONAtomic(
                subsystemFile(name, requestedSubsystemId),
                savedSubsystem,
              ),
            };
          }

          return {
            next: candidate,
            value: {
              pathId: wirePath.id,
              generated: bulkheadConnectors.map((connector) => connector.id),
              created: repaired.createdConnectorIds,
              draftConnectorId: draftConnector?.id,
              unmergedDots: unmergedDots.created,
              subsystem: savedSubsystem,
            },
            sidecarWrite,
          };
        });
        const saved = readSystem(name);
        setRevisionHeader(res, result.rev);
        json(res, {
          path: saved.paths.find((item) => item.id === result.value.pathId),
          system: saved,
          generated_connectors: result.value.generated,
          created_connectors: result.value.created,
          draft_connector_id: result.value.draftConnectorId,
          unmerged_dots: result.value.unmergedDots,
          ...(result.value.subsystem ? { subsystem: result.value.subsystem } : {}),
          validation: validateSystemData(saved, readLibrary()),
        }, 201);
      });
    } catch (error) {
      writeError(res, error, 'Route preflight failed');
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
      systems: Record<string, number>;
      pin_counts: Record<string, number>;
      keyings: Record<string, number>;
    }> = {};
    for (const name of listSystemNames()) {
      try {
        const system = readSystem(name);
        for (const connector of system.connectors) {
          const entry = usage[connector.connector_type] ?? {
            total: 0,
            systems: {},
            pin_counts: {},
            keyings: {},
          };
          entry.total += 1;
          entry.systems[name] = (entry.systems[name] ?? 0) + 1;
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
        // A malformed System should not make the connector library unreadable.
      }
    }
    json(res, usage);
  });

  addEditorRoute('DELETE', '/api/library/connector-types/:id', async (req, res, params, query) => {
    const typeId = params.id;
    if (PROTECTED_CONNECTOR_TYPE_IDS.has(typeId)) {
      err(res, `Connector type '${typeId}' is required by VibeWire and cannot be deleted.`, 409);
      return;
    }
    try {
      const response = await withSystemLock(LIBRARY_REVISION_KEY, async () => {
        const library = readLibrary();
        const removedType = library?.connector_types.find((type) => type.id === typeId);
        const genericType = library?.connector_types.find(
          (type) => type.id === GENERIC_MULTIPIN_TYPE_ID,
        );
        if (!library || !removedType) {
          throw new ApiWriteError(404, { error: `Connector type not found: ${typeId}` });
        }
        if (!genericType) {
          throw new ApiWriteError(409, {
            error: `Cannot migrate without '${GENERIC_MULTIPIN_TYPE_ID}'.`,
          });
        }

        const migrations: Record<string, number> = {};
        for (const name of listSystemNames()) {
          await withSystemLock(name, async () => {
            const current = readSystem(name);
            const preview = migrateConnectorTypeToGeneric(current, removedType, genericType);
            if (preview.migrated === 0) return;
            const result = await commitSystemDocument(req, name, 'system', (system) => {
              const migrated = migrateConnectorTypeToGeneric(
                system,
                removedType,
                genericType,
              );
              return { next: migrated.system, value: migrated.migrated };
            });
            migrations[name] = result.value;
          });
        }

        const libraryResult = await commitLibrary(
          req,
          (current) => ({
            ...current,
            connector_types: current.connector_types.filter((type) => type.id !== typeId),
          }),
          null,
        );
        const currentSystemName = sanitizeName(systemName(query) ?? '');
        const currentSystem = currentSystemName
          ? readSystem(currentSystemName)
          : undefined;
        return {
          library: libraryResult.library,
          system: currentSystem,
          migrated: Object.values(migrations).reduce((sum, count) => sum + count, 0),
          migrations,
          replacement_type: GENERIC_MULTIPIN_TYPE_ID,
          rev: libraryResult.rev,
        };
      });
      setRevisionHeader(res, response.rev);
      json(res, response);
    } catch (error) {
      writeError(res, error, 'Failed to delete connector type');
    }
  });

  addRoute('GET', '/api/layouts', (_req, res, _params, query) => {
    json(res, readLayouts(systemName(query) ?? 'fsae-car'));
  });

  addEditorRoute('POST', '/api/save-system', async (req, res, _params, query) => {
    const body = await parseBody(req);
    const name = sanitizeName(systemName(query) ?? 'fsae-car');
    try {
      const result = await commitSystemDocument(
        req,
        name,
        'system',
        () => {
          if (!body || !isRecord(body) || typeof body.schema_version !== 'string') {
            throw new ApiWriteError(400, {
              error: 'Invalid system data — must include schema_version',
            });
          }
          return { next: body as unknown as SystemData, value: undefined };
        },
        parseBaseRevision(req),
      );
      setRevisionHeader(res, result.rev);
      json(res, { ok: true, rev: result.rev });
    } catch (error) {
      writeError(res, error, 'Failed to save system');
    }
  });
  addEditorRoute('POST', '/api/save-harness', async (req, res, _params, query) => {
    const body = await parseBody(req);
    const name = sanitizeName(systemName(query) ?? 'fsae-car');
    try {
      const result = await commitSystemDocument(
        req,
        name,
        'system',
        () => {
          if (!body || !isRecord(body) || typeof body.schema_version !== 'string') {
            throw new ApiWriteError(400, {
              error: 'Invalid system data — must include schema_version',
            });
          }
          return { next: body as unknown as SystemData, value: undefined };
        },
        parseBaseRevision(req),
      );
      setRevisionHeader(res, result.rev);
      json(res, { ok: true, rev: result.rev });
    } catch (error) {
      writeError(res, error, 'Failed to save system');
    }
  });

  addEditorRoute('POST', '/api/save-layouts', async (req, res, _params, query) => {
    const body = await parseBody(req);
    const name = sanitizeName(systemName(query) ?? 'fsae-car');
    try {
      if (!isRecord(body)) {
        throw new ApiWriteError(400, { error: 'Layout update requires { patch, removed }' });
      }
      const patch = body.patch ?? body;
      const removed = body.patch === undefined ? {} : body.removed;
      const result = await commitSystemSidecar(
        req,
        name,
        'layouts',
        () => readLayouts(name),
        (previous) => {
          const next = mergeLayouts(previous, patch, removed);
          return {
            next,
            value: undefined,
            diff: diffLayouts(previous, next),
          };
        },
        (next) => writeLayouts(next, name),
      );
      setRevisionHeader(res, result.rev);
      json(res, { ok: true, rev: result.rev });
    } catch (error) {
      writeError(res, error, 'Failed to save layouts');
    }
  });

  addEditorRoute('POST', '/api/save-library', async (req, res) => {
    const body = await parseBody(req);
    try {
      const result = await commitLibrary(
        req,
        () => body as ConnectorLibrary,
        parseBaseRevision(req),
      );
      setRevisionHeader(res, result.rev);
      json(res, { ok: true, rev: result.rev });
    } catch (error) {
      writeError(res, error, 'Failed to save connector library');
    }
  });

  addEditorRoute('POST', '/api/save-manufacturing', async (req, res, _params, query) => {
    const body = await parseBody(req);
    const name = sanitizeName(systemName(query) ?? 'fsae-car');
    try {
      if (!isRecord(body)) {
        throw new ApiWriteError(400, {
          error: 'Manufacturing update requires { patch, removed }',
        });
      }
      const patch = body.patch ?? (isRecord(body.bundles) ? body.bundles : undefined);
      const removed = body.patch === undefined ? [] : body.removed;
      const result = await commitSystemSidecar(
        req,
        name,
        'manufacturing',
        () => readManufacturing(name),
        (previous) => {
          const bundles = mergeRecordPatch(previous.bundles, patch, removed);
          const next: ManufacturingDocument = {
            schema_version: '1.2.0',
            bundles,
          };
          return {
            next,
            value: undefined,
            diff: diffKeyedMap(previous.bundles, next.bundles),
          };
        },
        (next) => writeManufacturing(next, name),
      );
      setRevisionHeader(res, result.rev);
      json(res, { ok: true, rev: result.rev });
    } catch (error) {
      if (error instanceof ApiWriteError) writeError(res, error, 'Failed to save manufacturing');
      else err(
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

  addEditorRoute('POST', '/api/upload-image', async (req, res, _params, query) => {
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

    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, X-Base-Rev, X-Filename',
    );
    res.setHeader('Access-Control-Expose-Headers', 'X-Revision');

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
