import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

interface Connector {
  id: string;
  name: string;
  parent: string | null;
  connector_type: string;
  tags: string[];
  properties: Record<string, string>;
}

interface Enclosure {
  id: string;
  name: string;
  parent: string | null;
  container: boolean;
  tags: string[];
  properties: Record<string, string>;
}

interface MergePoint {
  id: string;
  name: string;
  parent: string | null;
  tags: string[];
  properties: Record<string, string>;
}

interface ConnectorPathNode {
  kind: 'connector';
  connector_id: string;
  pin_number: number;
}

interface MergePointPathNode {
  kind: 'merge';
  merge_point_id: string;
}

type PathNode = ConnectorPathNode | MergePointPathNode;
type PathNodeRef = PathNode;

interface PathMeasurement {
  from: PathNodeRef;
  to: PathNodeRef;
  length_mm?: number;
  note?: string;
}

interface PathEntity {
  id: string;
  name: string;
  tags: string[];
  properties: Record<string, string>;
  nodes: PathNode[];
  measurements: PathMeasurement[];
}

interface Signal {
  id: string;
  name: string;
  tags: string[];
  properties: Record<string, string>;
}

interface HarnessData {
  schema_version: string;
  enclosures: Enclosure[];
  connectors: Connector[];
  mergePoints: MergePoint[];
  paths: PathEntity[];
  signals: Signal[];
}

interface ConnectorType {
  id: string;
  name: string;
  pin_count: number;
  crimp_spec: string;
  wire_gauge: string;
  notes: string;
  image?: string;
  side_image?: string;
}

interface ConnectorLibrary {
  connector_types: ConnectorType[];
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

function getPathSignalName(pathItem: Pick<PathEntity, 'tags'>): string | null {
  return pathItem.tags.find((tag) => tag.startsWith('signal:'))?.slice(7) ?? null;
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
        pinNumber: node.pin_number,
        pathId: pathItem.id,
        pathName: pathItem.name,
        signalName: getPathSignalName(pathItem),
      })),
  );
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
  return harness.connectors.find((connector) => connector.id === connectorRef || connector.name === connectorRef);
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

function validateHarnessData(harness: HarnessData, library: ConnectorLibrary | null) {
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
  const signalNames = new Set(harness.signals.map((entity) => entity.name));
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
        if (connectorType && node.pin_number > connectorType.pin_count) {
          errors.push(`Path '${pathItem.id}' uses connector '${node.connector_id}' pin ${node.pin_number}, exceeding type capacity ${connectorType.pin_count}`);
        }
        if (node.pin_number <= 0) {
          errors.push(`Path '${pathItem.id}' uses invalid pin number ${node.pin_number} on connector '${node.connector_id}'`);
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
    const signalName = getPathSignalName(pathItem);
    if (signalName && !signalNames.has(signalName)) {
      warnings.push(`Path '${pathItem.id}' references signal '${signalName}' with no matching signal entity`);
    }
  }

  for (const [ref, pathIds] of occupancy.entries()) {
    if (pathIds.length > 1) {
      warnings.push(`Connector pin '${ref}' is occupied by multiple paths: ${pathIds.join(', ')}`);
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

  function layoutsFile() {
    return path.join(projectRoot, 'public', 'user-data', 'layouts.json');
  }

  function libraryFile() {
    return path.join(projectRoot, 'public', 'user-data', 'connectors', 'connector-library.json');
  }

  function readJSON<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  function writeJSON(filePath: string, data: unknown) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }

  function readHarness(name?: string): HarnessData {
    return normalizeHarness(readJSON<any>(harnessFile(name)));
  }

  function writeHarness(data: HarnessData, name?: string) {
    writeJSON(harnessFile(name), normalizeHarness(data));
  }

  function readLibrary(): ConnectorLibrary | null {
    try {
      return readJSON<ConnectorLibrary>(libraryFile());
    } catch {
      return null;
    }
  }

  function readLayouts(): LayoutData {
    try {
      return readJSON<LayoutData>(layoutsFile());
    } catch {
      return {};
    }
  }

  function writeLayouts(data: LayoutData) {
    writeJSON(layoutsFile(), data);
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
          'GET /api/harness': 'Get full harness JSON',
          'PUT /api/harness': 'Replace full harness JSON',
          'GET /api/harness/stats': 'Harness summary statistics',
          'GET /api/validate': 'Validate path and merge-point semantics',
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
    const dir = path.join(projectRoot, 'public', 'user-data', 'harnesses');
    try {
      const files = fs.readdirSync(dir).filter((file) => file.endsWith('.json')).map((file) => file.replace('.json', ''));
      json(res, files);
    } catch {
      json(res, []);
    }
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
    writeHarness(body as HarnessData, harnessName(query));
    json(res, { ok: true });
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
      const signalTag = `signal:${signal.name}`;
      const paths = harness.paths.filter((pathItem) => pathItem.tags.includes(signalTag));
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
        if (!connectorType || connectorType.pin_count <= 0) continue;
        const occupied = new Set(getConnectorOccupancy(harness, connector.id).map((entry) => entry.pinNumber));
        for (let pinNumber = 1; pinNumber <= connectorType.pin_count; pinNumber++) {
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

  addRoute('GET', '/api/layouts', (_req, res) => {
    json(res, readLayouts());
  });

  addRoute('PUT', '/api/layouts', async (req, res) => {
    const body = await parseBody(req);
    if (!body) {
      err(res, 'Request body required');
      return;
    }
    writeLayouts(body);
    json(res, { ok: true });
  });

  addRoute('GET', '/api/layouts/merge-points', (_req, res) => {
    json(res, readLayouts().mergePoints ?? {});
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

  addRoute('GET', '/api/library', (_req, res) => {
    json(res, readLibrary() ?? { connector_types: [] });
  });

  addRoute('POST', '/api/save-harness', async (req, res) => {
    const body = await parseBody(req);
    writeJSON(harnessFile(), normalizeHarness(body));
    json(res, { ok: true });
  });

  addRoute('POST', '/api/save-layouts', async (req, res) => {
    const body = await parseBody(req);
    writeJSON(layoutsFile(), body);
    json(res, { ok: true });
  });

  addRoute('POST', '/api/save-library', async (req, res) => {
    const body = await parseBody(req);
    writeJSON(libraryFile(), body);
    json(res, { ok: true });
  });

  addRoute('GET', '/api/list-assets', (_req, res) => {
    const dir = path.join(projectRoot, 'public', 'user-data', 'images');
    try {
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((file) => /\.(png|jpe?g|webp|gif)$/i.test(file)) : [];
      json(res, files);
    } catch {
      json(res, []);
    }
  });

  addRoute('GET', '/api/list-connector-assets', (_req, res) => {
    const dir = path.join(projectRoot, 'public', 'user-data', 'connectors');
    try {
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((file) => /\.(png|jpe?g|webp|gif)$/i.test(file)) : [];
      json(res, files);
    } catch {
      json(res, []);
    }
  });

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
