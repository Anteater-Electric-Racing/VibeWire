/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { createAuth, type PublicUser, type User } from './auth.js';
import {
  LIBRARY_REVISION_KEY,
  bumpRev,
  checkCas,
  configureCollaborationState,
  getCollaborationPaths,
  getRev,
  getRevisionState,
  withHarnessLock,
  type RevisionWriter,
} from './revisions.js';
import {
  checkpointPayloadDir,
  createCheckpoint,
  getCheckpoint,
  listCheckpoints,
  pruneHistory,
  restoreManagedPayload,
  snapshotToHistory,
} from './history.js';
import { aggregateActivity, appendEditLog, type EditKind } from './editlog.js';
import { applyDiffToAttribution, getAttribution } from './attribution.js';
import {
  diffHarness,
  diffKeyedMap,
  type EntityDiff,
} from './harnessDiff.js';
import { createPresenceHandler } from './presence.js';
import { addClient, broadcast } from './sse.js';
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
    splice_measured?: Record<string, boolean>;
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
        | 'splice-measured'
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
  connectorTypeSizes?: Record<string, { w: number; h: number }>;
  textBoxes?: Record<string, any>;
  waypoints?: Record<string, any>;
  junctions?: Record<string, any>;
  mergePoints?: Record<string, Record<string, { x: number; y: number }>>;
  rotations?: Record<string, number>;
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

function normalizeHarness(raw: any): HarnessData {
  const harness = structuredClone(raw ?? {}) as Partial<HarnessData> & { pcbs?: any[] };
  harness.schema_version ??= '0.1.0';
  harness.enclosures ??= [];
  harness.connectors ??= [];
  harness.mergePoints ??= [];
  harness.paths ??= [];
  harness.signals ??= [];
  harness.signalPropertyDefinitions ??= [];

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
      const nodeWithoutId = { ...(rawNode ?? {}) };
      delete nodeWithoutId.id;
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
  for (const definition of harness.signalPropertyDefinitions) {
    definition.type = 'select';
    definition.options = Array.isArray(definition.options) ? definition.options : [];
  }

  return harness as HarnessData;
}

function getPathSignalId(pathItem: Pick<PathEntity, 'signal_id' | 'tags'>): string | null {
  if (pathItem.signal_id) return pathItem.signal_id;
  const slug = pathItem.tags.find((tag) => tag.startsWith('signal:'))?.slice(7);
  return slug ? `sig_${slug}` : null;
}

function getPathNodeRefKey(node: PathNode): string {
  return node.kind === 'connector'
    ? `connector:${node.connector_id}:${node.pin_number}`
    : `merge:${node.merge_point_id}`;
}

type BulkheadSide = 'internal' | 'external';

function isBulkheadConnector(harness: HarnessData, connector: Connector): boolean {
  return connector.parent !== null
    && harness.enclosures.some(
      (enclosure) => enclosure.id === connector.parent && enclosure.container,
    );
}

function isParentInsideEnclosure(
  harness: HarnessData,
  parentId: string | null,
  enclosureId: string,
): boolean {
  const enclosureById = new Map(
    harness.enclosures.map((enclosure) => [enclosure.id, enclosure]),
  );
  let current = parentId;
  while (current) {
    if (current === enclosureId) return true;
    current = enclosureById.get(current)?.parent ?? null;
  }
  return false;
}

function getBulkheadConnectionSide(
  harness: HarnessData,
  bulkhead: Connector,
  other: Connector | PathNode,
): BulkheadSide {
  const parentId = 'kind' in other
    ? other.kind === 'connector'
      ? harness.connectors.find((connector) => connector.id === other.connector_id)?.parent ?? null
      : harness.mergePoints.find((mergePoint) => mergePoint.id === other.merge_point_id)?.parent ?? null
    : other.parent;
  return bulkhead.parent && isParentInsideEnclosure(harness, parentId, bulkhead.parent)
    ? 'internal'
    : 'external';
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

function getOccupiedPinNumbers(harness: HarnessData, connectorId: string): number[] {
  return harness.paths.flatMap((pathItem) =>
    pathItem.nodes
      .filter((node): node is ConnectorPathNode => node.kind === 'connector' && node.connector_id === connectorId)
      // Missing/invalid pin_number (legacy ring terminals) counts as cavity 1.
      .map((node) => (Number.isInteger(node.pin_number) && node.pin_number > 0 ? node.pin_number : 1)),
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
  return { harness: next, migrated };
}

function countPathNodeRefMatches(pathItem: Pick<PathEntity, 'nodes'>, ref: PathNodeRef): number {
  const refKey = getPathNodeRefKey(ref);
  return pathItem.nodes.filter((node) => getPathNodeRefKey(node) === refKey).length;
}

export function validateHarnessData(harness: HarnessData, library: ConnectorLibrary | null) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const signalPropertyDefinitions = harness.signalPropertyDefinitions ?? [];
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
  signalPropertyDefinitions.forEach((entity) =>
    registerId('signal property definition', entity.id)
  );

  const enclosureIds = new Set(harness.enclosures.map((entity) => entity.id));
  const connectorIds = new Set(harness.connectors.map((entity) => entity.id));
  const mergePointIds = new Set(harness.mergePoints.map((entity) => entity.id));
  const signalIds = new Set(harness.signals.map((entity) => entity.id));
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
  for (const signal of harness.signals) {
    for (const definition of signalPropertyDefinitions) {
      const value = signal.properties[definition.key];
      if (value !== undefined && !definition.options.includes(value)) {
        warnings.push(
          `Signal '${signal.id}' uses '${value}' for '${definition.key}', which is not an allowed option`,
        );
      }
    }
  }

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
      if (!auth.requireRole(req, 'editor')) {
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

  function harnessFile(name = 'fsae-car') {
    return path.join(projectRoot, 'public', 'user-data', 'harnesses', `${sanitizeName(name)}.json`);
  }

  function harnessExists(name: string): boolean {
    const resolved = sanitizeName(name);
    return (
      isSheetedHarness(projectRoot, resolved)
      || fs.existsSync(harnessFile(resolved))
    );
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

  /** Display name from harness data; falls back to storage key when unset. */
  function readHarnessDisplayName(name: string): string {
    const resolved = sanitizeName(name);
    try {
      if (isSheetedHarness(projectRoot, resolved)) {
        const root = readJSON<{ name?: unknown }>(
          path.join(sheetHarnessDir(projectRoot, resolved), 'root.json'),
        );
        if (typeof root.name === 'string' && root.name.trim()) return root.name.trim();
      } else {
        const data = readJSON<{ name?: unknown }>(harnessFile(resolved));
        if (typeof data.name === 'string' && data.name.trim()) return data.name.trim();
      }
    } catch {
      // Fall through to storage key.
    }
    return resolved;
  }

  function listHarnesses(): Array<{ id: string; name: string }> {
    return listHarnessNames().map((id) => ({
      id,
      name: readHarnessDisplayName(id),
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

  function subsystemFile(harness: string, subsystemId: string) {
    return path.join(subsystemDir(harness), `${sanitizeName(subsystemId)}.json`);
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
      return {};
    }
  }

  function writeLayouts(data: LayoutData, name = 'fsae-car') {
    writeJSONAtomic(layoutsFile(name), data);
  }

  function readManufacturing(name = 'fsae-car'): ManufacturingDocument {
    try {
      const data = readJSON<Partial<ManufacturingDocument>>(manufacturingFile(name));
      return {
        schema_version: '1.2.0',
        bundles: data.bundles && typeof data.bundles === 'object' ? data.bundles : {},
      };
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
        progress.splice_measured !== undefined
        && (
          !isRecord(progress.splice_measured)
          || Object.entries(progress.splice_measured).some(
            ([spliceId, completed]) => !spliceId || typeof completed !== 'boolean',
          )
        )
      ) {
        throw new Error(`Invalid splice measurements for bundle '${bundleId}'.`);
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
              'splice-measured',
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

  function harnessName(query: URLSearchParams) {
    const value = query.get('harness');
    if (value !== null && (!value || sanitizeName(value) !== value)) {
      throw new Error(`Invalid harness name '${value}'.`);
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
    const user = auth.requireRole(req, 'editor');
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

  function historySnapshotRoot(harness: string, rev: number): string {
    return path.join(
      getCollaborationPaths().stateRoot,
      'history',
      harness,
      String(rev),
    );
  }

  function readHarnessFromPayloadRoot(root: string, harness: string): HarnessData {
    const directory = path.join(root, 'harnesses', harness);
    const flatFile = path.join(root, 'harnesses', `${harness}.json`);
    if (fs.existsSync(path.join(directory, 'root.json'))) {
      return normalizeHarness(readSheetedHarness(directory));
    }
    if (!fs.existsSync(flatFile)) {
      throw new Error(`Harness snapshot '${harness}' is unavailable.`);
    }
    return normalizeHarness(readJSON<unknown>(flatFile));
  }

  function harnessChangesSince(harness: string, baseRev: number, currentRev: number): string[] {
    if (baseRev === currentRev) return [];
    if (!Number.isSafeInteger(baseRev) || baseRev < 0 || baseRev > currentRev) return [];
    try {
      const previous = readHarnessFromPayloadRoot(historySnapshotRoot(harness, baseRev), harness);
      return changedIds(diffHarness(previous, readHarness(harness)));
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

  async function recordHarnessWrite(
    harness: string,
    kind: EditKind,
    rev: number,
    diff: EntityDiff,
    writer: RevisionWriter,
  ): Promise<void> {
    const entityIds = changedIds(diff);
    await applyDiffToAttribution(harness, diff, writer, rev);
    appendEditLog(harness, {
      user: writer.id,
      displayName: writer.displayName,
      kind,
      rev,
      added: diff.added.length,
      modified: diff.modified.length,
      removed: diff.removed.length,
      entityIds,
    });
    await pruneHistory(harness);
    broadcast(harness, 'rev', {
      rev,
      kind,
      by: writer,
      changedEntityIds: entityIds,
    });
  }

  interface HarnessWriteBuild<T> {
    next: HarnessData;
    value: T;
    sidecarWrite?: {
      write: () => void;
      diff: EntityDiff;
    };
  }

  async function commitHarnessDocument<T>(
    req: IncomingMessage,
    harness: string,
    kind: EditKind,
    build: (previous: HarnessData) => HarnessWriteBuild<T> | Promise<HarnessWriteBuild<T>>,
    baseRev: number | null = null,
    allowCreate = false,
  ): Promise<{ rev: number; value: T; diff: EntityDiff }> {
    const writer = writerFor(req);
    return await withHarnessLock(harness, async () => {
      let currentRev: number;
      if (baseRev !== null) {
        const cas = checkCas(harness, baseRev);
        if (!cas.ok) {
          throw new ApiWriteError(409, {
            error: 'conflict',
            currentRev: cas.currentRev,
            baseRev: Number.isSafeInteger(cas.baseRev) ? cas.baseRev : null,
            lastWriter: cas.lastWriter,
            changedEntityIds: harnessChangesSince(harness, cas.baseRev, cas.currentRev),
          });
        }
        currentRev = cas.currentRev;
      } else {
        currentRev = getRev(harness);
      }

      const existed = harnessExists(harness);
      if (!existed && !allowCreate) {
        throw new ApiWriteError(404, { error: `Harness '${harness}' does not exist.` });
      }
      const previous = existed ? readHarness(harness) : normalizeHarness(undefined);
      const validationLibrary = readLibrary();
      const before = validateHarnessData(previous, validationLibrary);
      const built = await build(structuredClone(previous));
      const next = normalizeHarness(built.next);
      const snapshot = existed ? await snapshotToHistory(harness, currentRev) : null;
      const rev = await bumpRev(harness, writer);
      try {
        writeHarness(next, harness);
        built.sidecarWrite?.write();
      } catch (writeFailure) {
        const candidateValidation = validateHarnessData(next, validationLibrary);
        try {
          if (snapshot) restoreManagedPayload(snapshot, harness);
          else removePath(harnessFile(harness));
        } catch (rollbackError) {
          throw new ApiWriteError(500, {
            error: candidateValidation.error_count > before.error_count
              ? 'validation-degradation'
              : 'write-failed',
            errors: candidateValidation.errors,
            writeError: writeFailure instanceof Error
              ? writeFailure.message
              : String(writeFailure),
            rollbackError: rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
          });
        }
        if (candidateValidation.error_count > before.error_count) {
          throw new ApiWriteError(500, {
            error: 'validation-degradation',
            errors: candidateValidation.errors,
          });
        }
        throw writeFailure;
      }
      const after = validateHarnessData(next, validationLibrary);
      if (after.error_count > before.error_count) {
        try {
          if (snapshot) restoreManagedPayload(snapshot, harness);
          else removePath(harnessFile(harness));
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
      const harnessDiff = diffHarness(previous, next);
      const diff = built.sidecarWrite
        ? combineDiffs([harnessDiff, built.sidecarWrite.diff])
        : harnessDiff;
      await recordHarnessWrite(harness, kind, rev, diff, writer);
      return { rev, value: built.value, diff };
    });
  }

  interface SidecarWriteBuild<TDocument, TValue> {
    next: TDocument;
    value: TValue;
    diff: EntityDiff;
  }

  async function commitHarnessSidecar<TDocument, TValue>(
    req: IncomingMessage,
    harness: string,
    kind: EditKind,
    readDocument: () => TDocument,
    build: (
      previous: TDocument,
    ) => SidecarWriteBuild<TDocument, TValue> | Promise<SidecarWriteBuild<TDocument, TValue>>,
    writeDocument: (next: TDocument) => void,
  ): Promise<{ rev: number; value: TValue; diff: EntityDiff }> {
    const writer = writerFor(req);
    return await withHarnessLock(harness, async () => {
      const currentRev = getRev(harness);
      const previousHarness = readHarness(harness);
      const validationLibrary = readLibrary();
      const before = validateHarnessData(previousHarness, validationLibrary);
      const previousDocument = readDocument();
      const built = await build(structuredClone(previousDocument));
      const snapshot = await snapshotToHistory(harness, currentRev);
      const rev = await bumpRev(harness, writer);
      writeDocument(built.next);
      const after = validateHarnessData(readHarness(harness), validationLibrary);
      if (after.error_count > before.error_count) {
        try {
          restoreManagedPayload(snapshot, harness);
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
      await recordHarnessWrite(harness, kind, rev, built.diff, writer);
      return { rev, value: built.value, diff: built.diff };
    });
  }

  async function commitLibrary(
    req: IncomingMessage,
    build: (previous: ConnectorLibrary) => ConnectorLibrary | Promise<ConnectorLibrary>,
    baseRev: number | null,
  ): Promise<{ rev: number; library: ConnectorLibrary; diff: EntityDiff }> {
    const writer = writerFor(req);
    return await withHarnessLock(LIBRARY_REVISION_KEY, async () => {
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
      for (const harness of listHarnessNames()) {
        broadcast(harness, 'rev', {
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
    'connectorTypeSizes',
    'textBoxes',
    'waypoints',
    'junctions',
    'rotations',
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

    if (patch.mergePoints !== undefined || removed.mergePoints !== undefined) {
      if (patch.mergePoints !== undefined && !isRecord(patch.mergePoints)) {
        throw new ApiWriteError(400, { error: 'mergePoints patch must be an object map' });
      }
      const mergePoints = structuredClone(current.mergePoints ?? {});
      for (const [contextKey, contextPatch] of Object.entries(
        (patch.mergePoints ?? {}) as Record<string, unknown>,
      )) {
        if (!isRecord(contextPatch)) {
          throw new ApiWriteError(400, {
            error: `mergePoints patch '${contextKey}' must be an object map`,
          });
        }
        mergePoints[contextKey] = {
          ...(mergePoints[contextKey] ?? {}),
          ...(contextPatch as Record<string, { x: number; y: number }>),
        };
      }

      if (Array.isArray(removed.mergePoints)) {
        for (const contextKey of removed.mergePoints) {
          if (typeof contextKey !== 'string') {
            throw new ApiWriteError(400, { error: 'Removed merge-point contexts must be strings' });
          }
          delete mergePoints[contextKey];
        }
      } else if (removed.mergePoints !== undefined) {
        if (!isRecord(removed.mergePoints)) {
          throw new ApiWriteError(400, { error: 'Removed merge points must be an object map' });
        }
        for (const [contextKey, ids] of Object.entries(removed.mergePoints)) {
          if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
            throw new ApiWriteError(400, {
              error: `Removed merge points for '${contextKey}' must be a string array`,
            });
          }
          const context = { ...(mergePoints[contextKey] ?? {}) };
          for (const id of ids) delete context[id];
          mergePoints[contextKey] = context;
        }
      }
      next.mergePoints = mergePoints;
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
    const previousMergePoints = Object.fromEntries(
      Object.entries(previous.mergePoints ?? {}).flatMap(([context, points]) =>
        Object.entries(points).map(([id, value]) => [`${context}:${id}`, value])
      ),
    );
    const nextMergePoints = Object.fromEntries(
      Object.entries(next.mergePoints ?? {}).flatMap(([context, points]) =>
        Object.entries(points).map(([id, value]) => [`${context}:${id}`, value])
      ),
    );
    const mergePointDiff = diffKeyedMap(previousMergePoints, nextMergePoints);
    const stripContext = (id: string) => id.slice(id.indexOf(':') + 1);
    diffs.push({
      added: mergePointDiff.added.map(stripContext),
      modified: mergePointDiff.modified.map(stripContext),
      removed: mergePointDiff.removed.map(stripContext),
    });
    return combineDiffs(diffs);
  }

  function listSubsystemDocuments(harness: string, root = getCollaborationPaths().userDataRoot) {
    const directory = path.join(root, 'subsystems', harness);
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

  function readLayoutsFromRoot(root: string, harness: string): LayoutData {
    const file = path.join(root, `layouts.${harness}.json`);
    return fs.existsSync(file) ? readJSON<LayoutData>(file) : {};
  }

  function readManufacturingFromRoot(root: string, harness: string): ManufacturingDocument {
    const file = path.join(root, `manufacturing.${harness}.json`);
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
    for (const key of [...LAYOUT_MAP_KEYS, 'mergePoints'] as const) {
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

  function fullState(harness: string) {
    const revision = getRevisionState(harness);
    return {
      rev: revision.rev,
      libraryRev: getRev(LIBRARY_REVISION_KEY),
      connectorLibrary: readLibrary() ?? { connector_types: [] },
      harness: readHarness(harness),
      layouts: readLayouts(harness),
      manufacturing: readManufacturing(harness),
      subsystems: listSubsystemDocuments(harness),
      attribution: getAttribution(harness),
      lastWriter: revision.lastWriter,
    };
  }

  function syncDelta(harness: string, since: number) {
    const current = fullState(harness);
    if (since === current.rev) {
      return {
        rev: current.rev,
        libraryRev: current.libraryRev,
        full: false,
        changed: { connectorLibrary: current.connectorLibrary },
        changedEntityIds: [],
      };
    }
    const snapshotRoot = historySnapshotRoot(harness, since);
    if (
      !Number.isSafeInteger(since)
      || since < 0
      || since > current.rev
      || current.rev - since > 50
      || !fs.existsSync(snapshotRoot)
    ) {
      return { ...current, full: true };
    }

    const previousHarness = readHarnessFromPayloadRoot(snapshotRoot, harness);
    const previousLayouts = readLayoutsFromRoot(snapshotRoot, harness);
    const previousManufacturing = readManufacturingFromRoot(snapshotRoot, harness);
    const previousSubsystems = subsystemRecord(listSubsystemDocuments(harness, snapshotRoot));
    const currentSubsystems = subsystemRecord(current.subsystems);
    const changed: Record<string, unknown> = {};
    const harnessDiff = diffHarness(previousHarness, current.harness);
    const layoutDelta = layoutPatch(previousLayouts, current.layouts);
    const manufacturingDelta = recordPatch(
      previousManufacturing.bundles,
      current.manufacturing.bundles,
    );
    const subsystemDelta = recordPatch(previousSubsystems, currentSubsystems);

    if (!jsonEqual(previousHarness, current.harness)) changed.harness = current.harness;
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
        harnessDiff,
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
  addRoute('GET', '/api/users', auth.handlers.listUsers);
  addRoute('POST', '/api/users', hideLoginInUserResponse(auth.handlers.createUser));
  addRoute('PATCH', '/api/users/:id', hideLoginInUserResponse(auth.handlers.updateUser));
  addRoute('DELETE', '/api/users/:id', auth.handlers.deleteUser);

  addRoute('GET', '/api/state', (_req, res, _params, query) => {
    const name = sanitizeName(harnessName(query) ?? 'fsae-car');
    try {
      json(res, fullState(name));
    } catch (error) {
      err(res, error instanceof Error ? error.message : 'Failed to load state', 404);
    }
  });

  addRoute('GET', '/api/sync', (_req, res, _params, query) => {
    const name = sanitizeName(harnessName(query) ?? 'fsae-car');
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
    const name = sanitizeName(harnessName(query) ?? 'fsae-car');
    addClient(req, res, name);
  });

  addRoute('POST', '/api/presence', presenceHandler);

  addRoute('GET', '/api/checkpoints', (_req, res, _params, query) => {
    const name = sanitizeName(harnessName(query) ?? 'fsae-car');
    try {
      json(res, listCheckpoints(name));
    } catch (error) {
      err(res, error instanceof Error ? error.message : 'Failed to list checkpoints', 500);
    }
  });

  addEditorRoute('POST', '/api/checkpoints', async (req, res, _params, query) => {
    const name = sanitizeName(harnessName(query) ?? 'fsae-car');
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
    const name = sanitizeName(harnessName(query) ?? 'fsae-car');
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
      const name = sanitizeName(harnessName(query) ?? 'fsae-car');
      const writer = writerFor(req);
      try {
        const result = await withHarnessLock(name, async () => {
          const previousHarness = readHarness(name);
          const previousLayouts = readLayouts(name);
          const previousManufacturing = readManufacturing(name);
          const previousSubsystems = subsystemRecord(listSubsystemDocuments(name));
          const validationLibrary = readLibrary();
          const before = validateHarnessData(previousHarness, validationLibrary);
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
          const nextHarness = readHarness(name);
          const after = validateHarnessData(nextHarness, validationLibrary);
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
            diffHarness(previousHarness, nextHarness),
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
          await recordHarnessWrite(name, 'restore', rev, diff, writer);
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
    const name = sanitizeName(harnessName(query) ?? 'fsae-car');
    const rawDays = query.get('days') ?? '30';
    const days = /^(0|[1-9]\d*)$/.test(rawDays) ? Number(rawDays) : Number.NaN;
    try {
      json(res, aggregateActivity(name, days));
    } catch (error) {
      err(res, error instanceof Error ? error.message : 'Failed to load activity');
    }
  });

  addRoute('GET', '/api/harnesses', (_req, res) => {
    json(res, listHarnesses());
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

  addEditorRoute('PUT', '/api/harness', async (req, res, _params, query) => {
    const body = await parseBody(req);
    if (!body?.schema_version) {
      err(res, 'Invalid harness data — must include schema_version');
      return;
    }
    const name = sanitizeName(harnessName(query) ?? 'fsae-car');
    try {
      const result = await commitHarnessDocument(req, name, 'harness', () => ({
        next: body as HarnessData,
        value: undefined,
      }), null, true);
      setRevisionHeader(res, result.rev);
      json(res, { ok: true, rev: result.rev });
    } catch (error) {
      writeError(res, error, 'Failed to save harness');
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

  addEditorRoute('PUT', '/api/subsystems/:id', async (req, res, params, query) => {
    const body = await parseBody(req);
    const id = sanitizeName(params.id);
    if (!id || id !== params.id) {
      err(res, 'Subsystem requires a valid id');
      return;
    }
    const harness = sanitizeName(harnessName(query) ?? 'fsae-car');
    try {
      const result = await commitHarnessSidecar(
        req,
        harness,
        'subsystem',
        () => subsystemRecord(listSubsystemDocuments(harness)),
        (previous) => {
          const document = mergeSubsystem(id, previous[id], body);
          const next = { ...previous, [id]: document };
          return {
            next,
            value: document,
            diff: diffKeyedMap(previous, next),
          };
        },
        (next) => writeJSONAtomic(subsystemFile(harness, id), next[id]),
      );
      setRevisionHeader(res, result.rev);
      json(res, { ...result.value, rev: result.rev });
    } catch (error) {
      writeError(res, error, 'Failed to save subsystem');
    }
  });

  addEditorRoute('DELETE', '/api/subsystems/:id', async (req, res, params, query) => {
    const harness = sanitizeName(harnessName(query) ?? 'fsae-car');
    const file = subsystemFile(harness, params.id);
    try {
      const result = await commitHarnessSidecar(
        req,
        harness,
        'subsystem',
        () => subsystemRecord(listSubsystemDocuments(harness)),
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
    const name = sanitizeName(harnessName(query) ?? 'fsae-car');
    try {
      const result = await commitHarnessDocument(req, name, 'harness', (harness) => {
        const signal: Signal = {
          id: body.id ?? genId('sig'),
          name: body.name,
          tags: body.tags ?? [],
          properties: body.properties ?? {},
        };
        if (harness.signals.some((existing) => existing.id === signal.id)) {
          throw new ApiWriteError(409, {
            error: `Signal with id '${signal.id}' already exists`,
          });
        }
        harness.signals.push(signal);
        return { next: harness, value: signal };
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

    const name = sanitizeName(harnessName(query) ?? 'fsae-car');
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
      await withHarnessLock(name, async () => {
        const current = readHarness(name);
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
            harness: current,
            generated_connectors: [],
            idempotent: true,
            ...(requestedSubsystemId && fs.existsSync(subsystemFile(name, requestedSubsystemId))
              ? { subsystem: readJSON<SubsystemDocument>(subsystemFile(name, requestedSubsystemId)) }
              : {}),
          });
          return;
        }

        const result = await commitHarnessDocument(req, name, 'harness', (harness) => {
          const fromConnector = harness.connectors.find(
            (item) => item.id === body.from.connector_id,
          );
          const toConnector = harness.connectors.find(
            (item) => item.id === body.to.connector_id,
          );
          if (!fromConnector || !toConnector) {
            throw new ApiWriteError(404, {
              error: 'One or both connector endpoints do not exist',
            });
          }
          if (!harness.signals.some((signal) => signal.id === body.signal_id)) {
            throw new ApiWriteError(404, { error: `Signal not found: ${body.signal_id}` });
          }
          if (fromConnector.id === toConnector.id && fromPin === toPin) {
            throw new ApiWriteError(409, {
              error: 'Cannot connect a cavity to itself',
            });
          }

          const enclosureById = new Map(
            harness.enclosures.map((enclosure) => [enclosure.id, enclosure]),
          );
          const sheetIds = isSheetedHarness(projectRoot, name)
            ? discoverSheetEnclosureIds(sheetHarnessDir(projectRoot, name))
            : new Set<string>();
          const routePlan = planSheetRoute(
            harness,
            sheetIds,
            fromConnector,
            toConnector,
          );
          const crossedChildScopes = routePlan.crossedChildScopes.filter((scope) =>
            !(isBulkheadConnector(harness, fromConnector) && fromConnector.parent === scope)
            && !(isBulkheadConnector(harness, toConnector) && toConnector.parent === scope)
          );

          type BulkheadJoin = {
            pathId: string;
            nodeIndex: number;
          };
          const inspectEndpoint = (
            connector: Connector,
            pinNumber: number,
            otherConnector: Connector,
          ): BulkheadJoin | null => {
            const uses = harness.paths.flatMap((wirePath) =>
              wirePath.nodes.flatMap((node, nodeIndex) =>
                node.kind === 'connector'
                && node.connector_id === connector.id
                && node.pin_number === pinNumber
                  ? [{ wirePath, nodeIndex }]
                  : []
              )
            );
            if (uses.length === 0) return null;
            if (!isBulkheadConnector(harness, connector) || uses.length !== 1) {
              throw new ApiWriteError(409, {
                error: `Cannot route from or to occupied cavity ${connector.name}:${pinNumber}`,
              });
            }

            const [{ wirePath, nodeIndex }] = uses;
            if (nodeIndex !== 0 && nodeIndex !== wirePath.nodes.length - 1) {
              throw new ApiWriteError(409, {
                error: `Bulkhead cavity ${connector.name}:${pinNumber} already has internal and external connections`,
              });
            }
            const neighbor = wirePath.nodes[nodeIndex === 0 ? 1 : nodeIndex - 1];
            if (!neighbor) {
              throw new ApiWriteError(409, {
                error: `Bulkhead cavity ${connector.name}:${pinNumber} has an invalid existing path`,
              });
            }
            const existingSide = getBulkheadConnectionSide(harness, connector, neighbor);
            const requestedSide = getBulkheadConnectionSide(harness, connector, otherConnector);
            if (existingSide === requestedSide) {
              throw new ApiWriteError(409, {
                error: `Bulkhead cavity ${connector.name}:${pinNumber} already has an ${requestedSide} connection`,
              });
            }
            const existingSignalId = getPathSignalId(wirePath);
            if (existingSignalId && existingSignalId !== body.signal_id) {
              throw new ApiWriteError(409, {
                error: `The opposite side of bulkhead cavity ${connector.name}:${pinNumber} uses signal ${existingSignalId}`,
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
          if (
            generated.some((connector) =>
              harness.connectors.some((item) => item.id === connector.id)
            )
          ) {
            throw new ApiWriteError(409, {
              error: 'Generated connector ID collision; retry with a distinct request_id',
            });
          }
          const routeNodes: PathNode[] = [
            { kind: 'connector', connector_id: fromConnector.id, pin_number: fromPin },
            ...generated.map((connector) => ({
              kind: 'connector' as const,
              connector_id: connector.id,
              pin_number: 1,
            })),
            { kind: 'connector', connector_id: toConnector.id, pin_number: toPin },
          ];
          const candidate = structuredClone(harness);
          candidate.connectors.push(...generated);

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
          for (const connector of generated) {
            connector.properties.generated_by_route = wirePath.id;
          }

          let savedSubsystem: SubsystemDocument | undefined;
          let sidecarWrite: HarnessWriteBuild<unknown>['sidecarWrite'];
          if (requestedSubsystemId && generated.length > 0) {
            const previousSubsystems = subsystemRecord(listSubsystemDocuments(name));
            const previousSubsystem = previousSubsystems[requestedSubsystemId];
            if (!previousSubsystem) {
              throw new ApiWriteError(404, {
                error: `Subsystem not found: ${requestedSubsystemId}`,
              });
            }
            savedSubsystem = structuredClone(previousSubsystem);
            const systemTag = `system:${requestedSubsystemId}`;
            for (const connector of generated) {
              const frameId = connector.parent;
              if (frameId && !savedSubsystem.enclosures[frameId]) {
                const frameIndex = Object.keys(savedSubsystem.enclosures).length;
                savedSubsystem.enclosures[frameId] = {
                  x: 40 + (frameIndex % 3) * 560,
                  y: 40 + Math.floor(frameIndex / 3) * 400,
                  w: 520,
                  h: 360,
                };
              }
              if (!savedSubsystem.connectors[connector.id]) {
                const connectorIndex = Object.keys(savedSubsystem.connectors).length;
                savedSubsystem.connectors[connector.id] = {
                  x: 40 + (connectorIndex % 3) * 112,
                  y: 80 + Math.floor(connectorIndex / 3) * 52,
                  w: 96,
                  h: 36,
                };
              }
              savedSubsystem.hidden_connectors = (savedSubsystem.hidden_connectors ?? [])
                .filter((connectorId) => connectorId !== connector.id);
              if (!connector.tags.includes(systemTag)) connector.tags.push(systemTag);
              if (frameId) {
                const frame = candidate.enclosures.find((enclosure) => enclosure.id === frameId);
                if (frame && !frame.tags.includes(systemTag)) frame.tags.push(systemTag);
              }
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
              generated: generated.map((connector) => connector.id),
              subsystem: savedSubsystem,
            },
            sidecarWrite,
          };
        });
        const saved = readHarness(name);
        setRevisionHeader(res, result.rev);
        json(res, {
          path: saved.paths.find((item) => item.id === result.value.pathId),
          harness: saved,
          generated_connectors: result.value.generated,
          ...(result.value.subsystem ? { subsystem: result.value.subsystem } : {}),
          validation: validateHarnessData(saved, readLibrary()),
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

  addEditorRoute('DELETE', '/api/library/connector-types/:id', async (req, res, params, query) => {
    const typeId = params.id;
    if (PROTECTED_CONNECTOR_TYPE_IDS.has(typeId)) {
      err(res, `Connector type '${typeId}' is required by VibeWire and cannot be deleted.`, 409);
      return;
    }
    try {
      const response = await withHarnessLock(LIBRARY_REVISION_KEY, async () => {
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
        for (const name of listHarnessNames()) {
          await withHarnessLock(name, async () => {
            const current = readHarness(name);
            const preview = migrateConnectorTypeToGeneric(current, removedType, genericType);
            if (preview.migrated === 0) return;
            const result = await commitHarnessDocument(req, name, 'harness', (harness) => {
              const migrated = migrateConnectorTypeToGeneric(
                harness,
                removedType,
                genericType,
              );
              return { next: migrated.harness, value: migrated.migrated };
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
        const currentHarnessName = sanitizeName(harnessName(query) ?? '');
        const currentHarness = currentHarnessName
          ? readHarness(currentHarnessName)
          : undefined;
        return {
          library: libraryResult.library,
          harness: currentHarness,
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
    json(res, readLayouts(harnessName(query) ?? 'fsae-car'));
  });

  addEditorRoute('POST', '/api/save-harness', async (req, res, _params, query) => {
    const body = await parseBody(req);
    const name = sanitizeName(harnessName(query) ?? 'fsae-car');
    try {
      const result = await commitHarnessDocument(
        req,
        name,
        'harness',
        () => {
          if (!body || !isRecord(body) || typeof body.schema_version !== 'string') {
            throw new ApiWriteError(400, {
              error: 'Invalid harness data — must include schema_version',
            });
          }
          return { next: body as unknown as HarnessData, value: undefined };
        },
        parseBaseRevision(req),
      );
      setRevisionHeader(res, result.rev);
      json(res, { ok: true, rev: result.rev });
    } catch (error) {
      writeError(res, error, 'Failed to save harness');
    }
  });

  addEditorRoute('POST', '/api/save-layouts', async (req, res, _params, query) => {
    const body = await parseBody(req);
    const name = sanitizeName(harnessName(query) ?? 'fsae-car');
    try {
      if (!isRecord(body)) {
        throw new ApiWriteError(400, { error: 'Layout update requires { patch, removed }' });
      }
      const patch = body.patch ?? body;
      const removed = body.patch === undefined ? {} : body.removed;
      const result = await commitHarnessSidecar(
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
    const name = sanitizeName(harnessName(query) ?? 'fsae-car');
    try {
      if (!isRecord(body)) {
        throw new ApiWriteError(400, {
          error: 'Manufacturing update requires { patch, removed }',
        });
      }
      const patch = body.patch ?? (isRecord(body.bundles) ? body.bundles : undefined);
      const removed = body.patch === undefined ? [] : body.removed;
      const result = await commitHarnessSidecar(
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
