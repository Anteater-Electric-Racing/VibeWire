import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// ─── Types (mirrored from src/types for standalone use) ─────────────────────

interface Pin {
  id: string;
  pin_number: number;
  name: string;
  tags: string[];
  properties: Record<string, string>;
}

interface Connector {
  id: string;
  name: string;
  parent: string | null;
  connector_type: string;
  tags: string[];
  pins: Pin[];
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

interface Wire {
  id: string;
  from: string;
  to: string;
  tags: string[];
  properties: Record<string, string>;
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
  wires: Wire[];
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

// ─── Router infrastructure ──────────────────────────────────────────────────

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

// ─── Public API ─────────────────────────────────────────────────────────────

export function createApiMiddleware(projectRoot: string) {
  const routes: Route[] = [];

  function addRoute(method: string, urlPath: string, handler: Handler) {
    const paramNames: string[] = [];
    const regexStr = urlPath.replace(/:([a-zA-Z_]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    routes.push({
      method: method.toUpperCase(),
      pattern: new RegExp(`^${regexStr}$`),
      paramNames,
      handler,
    });
  }

  // ─── File helpers ───────────────────────────────────────────────────────

  function sanitizeName(name: string) {
    return name.replace(/[^a-zA-Z0-9_-]/g, '');
  }

  function harnessFile(name = 'fsae-car') {
    return path.join(projectRoot, 'public', 'harnesses', `${sanitizeName(name)}.json`);
  }
  function layoutsFile() {
    return path.join(projectRoot, 'public', 'layouts.json');
  }
  function libraryFile() {
    return path.join(projectRoot, 'connector_library', 'connector-library.json');
  }

  function readJSON<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  function writeJSON(filePath: string, data: unknown) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }

  function readHarness(name?: string): HarnessData {
    const raw = readJSON<any>(harnessFile(name));
    // Backward-compat: migrate old format with pcbs array
    if (Array.isArray(raw.pcbs)) {
      for (const pcb of raw.pcbs) {
        (raw.enclosures ??= []).push({
          id: pcb.id,
          name: pcb.name,
          parent: pcb.parent,
          container: false,
          tags: pcb.tags ?? [],
          properties: pcb.properties ?? {},
        });
      }
      delete raw.pcbs;
    }
    // Ensure defaults for all entities
    for (const enc of (raw.enclosures ?? [])) {
      enc.container ??= true;
      enc.tags ??= [];
      enc.properties ??= {};
    }
    for (const conn of (raw.connectors ?? [])) {
      conn.tags ??= [];
      conn.properties ??= {};
      conn.parent ??= null;
      for (const pin of (conn.pins ?? [])) {
        pin.tags ??= [];
        pin.properties ??= {};
      }
    }
    return raw as HarnessData;
  }
  function writeHarness(data: HarnessData, name?: string) {
    writeJSON(harnessFile(name), data);
  }

  // ─── HTTP helpers ───────────────────────────────────────────────────────

  function parseBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        if (!body) { resolve(undefined); return; }
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Invalid JSON body')); }
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

  function genId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function harnessName(query: URLSearchParams) {
    return query.get('harness') ?? undefined;
  }

  // ─── Shared entity lookup ──────────────────────────────────────────────

  function findTaggable(
    h: HarnessData,
    type: string,
    id: string,
  ): { tags: string[]; properties: Record<string, string> } | undefined {
    switch (type) {
      case 'enclosure': return h.enclosures.find(e => e.id === id);
      case 'connector': return h.connectors.find(c => c.id === id);
      case 'pin':
        for (const c of h.connectors) {
          const pin = c.pins.find(p => p.id === id);
          if (pin) return pin;
        }
        return undefined;
      case 'wire': return h.wires.find(w => w.id === id);
      case 'signal': return h.signals.find(s => s.id === id);
      default: return undefined;
    }
  }

  // ─── Generic entity CRUD factory ──────────────────────────────────────

  type Tagged = { id: string; tags: string[]; properties: Record<string, string> };

  function entityRoutes<T extends Tagged>(
    basePath: string,
    collectionKey: 'enclosures' | 'connectors' | 'wires' | 'signals',
    idPrefix: string,
    requiredFields: string[],
    defaults: () => Partial<T>,
  ) {
    // List
    addRoute('GET', basePath, (_req, res, _p, query) => {
      try {
        const h = readHarness(harnessName(query));
        let items = h[collectionKey] as T[];
        const tagFilter = query.get('tag');
        if (tagFilter) items = items.filter(i => i.tags.includes(tagFilter));
        json(res, items);
      } catch (e: any) { err(res, e.message, 404); }
    });

    // Create
    addRoute('POST', basePath, async (req, res, _p, query) => {
      const body = await parseBody(req);
      if (!body) { err(res, 'Request body required'); return; }
      for (const f of requiredFields) {
        if (body[f] === undefined) { err(res, `Field '${f}' is required`); return; }
      }
      const hn = harnessName(query);
      const h = readHarness(hn);
      const item = { ...defaults(), ...body, id: body.id ?? genId(idPrefix) } as T;
      if (!item.tags) item.tags = [];
      if (!item.properties) item.properties = {};
      const coll = h[collectionKey] as T[];
      if (coll.some(e => e.id === item.id)) {
        err(res, `Entity with id '${item.id}' already exists`, 409); return;
      }
      coll.push(item);
      writeHarness(h, hn);
      json(res, item, 201);
    });

    // Get by ID
    addRoute('GET', `${basePath}/:id`, (_req, res, params, query) => {
      try {
        const h = readHarness(harnessName(query));
        const item = (h[collectionKey] as T[]).find(e => e.id === params.id);
        if (!item) { err(res, `Not found: ${params.id}`, 404); return; }
        json(res, item);
      } catch (e: any) { err(res, e.message, 404); }
    });

    // Full replace
    addRoute('PUT', `${basePath}/:id`, async (req, res, params, query) => {
      const body = await parseBody(req);
      if (!body) { err(res, 'Request body required'); return; }
      const hn = harnessName(query);
      const h = readHarness(hn);
      const coll = h[collectionKey] as T[];
      const idx = coll.findIndex(e => e.id === params.id);
      if (idx === -1) { err(res, `Not found: ${params.id}`, 404); return; }
      coll[idx] = { ...body, id: params.id } as T;
      if (!coll[idx].tags) coll[idx].tags = [];
      if (!coll[idx].properties) coll[idx].properties = {};
      writeHarness(h, hn);
      json(res, coll[idx]);
    });

    // Partial update
    addRoute('PATCH', `${basePath}/:id`, async (req, res, params, query) => {
      const body = await parseBody(req);
      if (!body) { err(res, 'Request body required'); return; }
      const hn = harnessName(query);
      const h = readHarness(hn);
      const coll = h[collectionKey] as T[];
      const idx = coll.findIndex(e => e.id === params.id);
      if (idx === -1) { err(res, `Not found: ${params.id}`, 404); return; }
      coll[idx] = { ...coll[idx], ...body, id: params.id } as T;
      writeHarness(h, hn);
      json(res, coll[idx]);
    });

    // Delete
    addRoute('DELETE', `${basePath}/:id`, (_req, res, params, query) => {
      const hn = harnessName(query);
      const h = readHarness(hn);
      const coll = h[collectionKey] as T[];
      const idx = coll.findIndex(e => e.id === params.id);
      if (idx === -1) { err(res, `Not found: ${params.id}`, 404); return; }

      const deleted = coll.splice(idx, 1)[0];
      const warnings: string[] = [];

      if (collectionKey === 'enclosures') {
        const childEnc = h.enclosures.filter(e => e.parent === params.id).length;
        const childConn = h.connectors.filter(c => c.parent === params.id).length;
        if (childEnc) warnings.push(`${childEnc} child enclosure(s) still reference this as parent`);
        if (childConn) warnings.push(`${childConn} connector(s) still reference this as parent`);
      }

      writeHarness(h, hn);
      json(res, warnings.length ? { deleted, warnings } : deleted);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  ROUTE DEFINITIONS
  // ═══════════════════════════════════════════════════════════════════════

  // ─── Meta ─────────────────────────────────────────────────────────────

  addRoute('GET', '/api', (_req, res) => {
    json(res, {
      name: 'VibeWire API',
      version: '2.0.0',
      note: 'All entity endpoints accept ?harness=<name> query param (default: fsae-car)',
      sections: {
        harness_files: {
          'GET    /api/harnesses':                       'List available harness files',
          'POST   /api/harnesses':                       'Create new harness file { name, data? }',
          'DELETE /api/harnesses/:name':                 'Delete a harness file',
          'POST   /api/harnesses/:name/copy':            'Copy harness { newName }',
          'POST   /api/harnesses/:name/rename':          'Rename harness { newName }',
        },
        harness_document: {
          'GET    /api/harness':                         'Get full harness JSON',
          'PUT    /api/harness':                         'Replace full harness JSON',
          'GET    /api/harness/stats':                   'Harness summary statistics',
        },
        enclosures: {
          'GET    /api/enclosures':                      'List enclosures (?tag=filter)',
          'POST   /api/enclosures':                      'Create enclosure { name, parent?, container?, tags?, properties? }',
          'GET    /api/enclosures/:id':                  'Get enclosure by ID',
          'PUT    /api/enclosures/:id':                  'Replace enclosure',
          'PATCH  /api/enclosures/:id':                  'Partial-update enclosure',
          'DELETE /api/enclosures/:id':                  'Delete enclosure',
          'GET    /api/enclosures/:id/children':         'Get all children (enclosures, connectors)',
        },
        connectors: {
          'GET    /api/connectors':                      'List connectors (?tag=filter)',
          'POST   /api/connectors':                      'Create connector { name, parent }',
          'POST   /api/connectors-auto':                 'Create connector with auto-generated pins from library { name, parent, connector_type, pin_count?, pin_id_prefix?, pin_name_prefix?, default_pin_tags?, default_pin_properties? }',
          'GET    /api/connectors/:id':                  'Get connector by ID',
          'PUT    /api/connectors/:id':                  'Replace connector',
          'PATCH  /api/connectors/:id':                  'Partial-update connector',
          'DELETE /api/connectors/:id':                  'Delete connector',
          'GET    /api/connectors/:id/wires':            'Get all wires connected to connector',
        },
        pins: {
          'GET    /api/connectors/:id/pins':             'List pins for connector',
          'POST   /api/connectors/:id/pins':             'Add pin to connector',
          'GET    /api/connectors/:cid/pins/:pid':       'Get pin',
          'PUT    /api/connectors/:cid/pins/:pid':       'Replace pin',
          'PATCH  /api/connectors/:cid/pins/:pid':       'Partial-update pin',
          'DELETE /api/connectors/:cid/pins/:pid':       'Delete pin',
          'GET    /api/pins/:id/wires':                  'Get all wires connected to pin',
        },
        wires: {
          'GET    /api/wires':                           'List wires (?tag=filter)',
          'POST   /api/wires':                           'Create wire { from, to } (pin IDs)',
          'POST   /api/wire-by-name':                    'Create wire by connector/pin name { from_connector, from_pin, to_connector, to_pin }',
          'GET    /api/wires/:id':                       'Get wire by ID',
          'PUT    /api/wires/:id':                       'Replace wire',
          'PATCH  /api/wires/:id':                       'Partial-update wire',
          'DELETE /api/wires/:id':                       'Delete wire',
        },
        signals: {
          'GET    /api/signals':                         'List signals (?tag=filter)',
          'POST   /api/signals':                         'Create signal { name }',
          'GET    /api/signals/:id':                     'Get signal by ID',
          'PUT    /api/signals/:id':                     'Replace signal',
          'PATCH  /api/signals/:id':                     'Partial-update signal',
          'DELETE /api/signals/:id':                     'Delete signal',
          'GET    /api/signals/:id/net':                 'Get signal net (all wires & pins with signal tag)',
        },
        batch_operations: {
          'POST   /api/batch/enclosures':                'Bulk-create enclosures (array body)',
          'POST   /api/batch/connectors':                'Bulk-create connectors (array body, supports auto_pins flag)',
          'POST   /api/batch/pins/:cid':                 'Bulk-create pins on connector (array body)',
          'POST   /api/batch/wires':                     'Bulk-create wires (array body)',
          'POST   /api/batch/wire-by-name':              'Bulk-create wires by name (array body)',
          'POST   /api/batch/signals':                   'Bulk-create signals (array body)',
          'POST   /api/batch/delete':                    'Bulk-delete entities { items: [{ type, id }] }',
        },
        tags: {
          'GET    /api/tags':                            'List all unique tags',
          'POST   /api/tags':                            'Add tag { entityType, entityId, tag }',
          'DELETE /api/tags':                             'Remove tag { entityType, entityId, tag }',
        },
        properties: {
          'GET    /api/properties?type=&id=':            'Get properties for entity',
          'PUT    /api/properties':                      'Replace all properties { type, id, properties }',
          'PATCH  /api/properties':                      'Merge properties { type, id, properties }',
          'DELETE /api/properties':                      'Delete property keys { type, id, keys[] }',
        },
        relationships: {
          'GET    /api/connectivity/:pinId':             'Trace full connectivity net from a pin',
          'GET    /api/unconnected-pins':                'List all pins with no wires',
        },
        entity_operations: {
          'POST   /api/move':                            'Reparent entity { type, id, newParent }',
          'POST   /api/duplicate':                       'Clone entity { type, id, newId?, newName?, duplicateWires? }',
        },
        validation: {
          'GET    /api/validate':                        'Validate harness integrity (orphans, dangling refs, duplicates)',
        },
        connector_library: {
          'GET    /api/library':                         'Get full connector library',
          'PUT    /api/library':                         'Replace full connector library',
          'GET    /api/library/types':                   'List connector types',
          'POST   /api/library/types':                   'Create connector type { name, pin_count, ... }',
          'GET    /api/library/types/:id':               'Get connector type',
          'PUT    /api/library/types/:id':               'Update connector type',
          'DELETE /api/library/types/:id':               'Delete connector type',
        },
        layouts: {
          'GET    /api/layouts':                         'Get all layouts',
          'PUT    /api/layouts':                         'Replace all layouts',
          'GET    /api/layouts/nodes':                   'Get all node positions',
          'GET    /api/layouts/nodes/:id':               'Get node position',
          'PUT    /api/layouts/nodes/:id':               'Set node position { x, y }',
          'PATCH  /api/layouts/nodes':                   'Merge multiple node positions { nodeId: {x,y} }',
          'DELETE /api/layouts/nodes/:id':               'Delete node position',
          'GET    /api/layouts/ports':                   'Get all port positions',
          'GET    /api/layouts/ports/:id':               'Get port position',
          'PUT    /api/layouts/ports/:id':               'Set port position { edge, ratio }',
          'PATCH  /api/layouts/ports':                   'Merge multiple port positions',
          'DELETE /api/layouts/ports/:id':               'Delete port position',
          'GET    /api/layouts/sizes':                   'Get all node sizes',
          'GET    /api/layouts/sizes/:id':               'Get node size',
          'PUT    /api/layouts/sizes/:id':               'Set node size { w, h }',
          'DELETE /api/layouts/sizes/:id':               'Delete node size',
          'GET    /api/layouts/free':                    'Get all free connector positions',
          'GET    /api/layouts/free/:id':                'Get free connector position',
          'PUT    /api/layouts/free/:id':                'Set free connector position { x, y }',
          'PATCH  /api/layouts/free':                    'Merge free connector positions',
          'DELETE /api/layouts/free/:id':                'Delete free connector position',
          'GET    /api/layouts/backgrounds':             'Get all backgrounds',
          'GET    /api/layouts/backgrounds/:id':         'Get background',
          'PUT    /api/layouts/backgrounds/:id':         'Set background { image, x, y, w, h, locked }',
          'DELETE /api/layouts/backgrounds/:id':         'Delete background',
          'GET    /api/layouts/textboxes':               'Get all text boxes',
          'GET    /api/layouts/textboxes/:id':           'Get text box',
          'POST   /api/layouts/textboxes':               'Create text box',
          'PUT    /api/layouts/textboxes/:id':           'Replace text box',
          'PATCH  /api/layouts/textboxes/:id':           'Partial-update text box',
          'DELETE /api/layouts/textboxes/:id':           'Delete text box',
          'GET    /api/layouts/waypoints':               'Get all waypoints',
          'GET    /api/layouts/waypoints/:id':           'Get waypoints for edge',
          'PUT    /api/layouts/waypoints/:id':           'Set waypoints for edge (array body)',
          'DELETE /api/layouts/waypoints/:id':           'Delete waypoints for edge',
          'GET    /api/layouts/junctions':               'Get all junctions',
          'GET    /api/layouts/junctions/:id':           'Get junction',
          'POST   /api/layouts/junctions':               'Create junction { x, y, memberEdgeIds }',
          'PUT    /api/layouts/junctions/:id':           'Replace junction',
          'DELETE /api/layouts/junctions/:id':           'Delete junction',
          'GET    /api/layouts/connector-type-sizes':    'Get connector type size overrides',
          'PUT    /api/layouts/connector-type-sizes/:id':'Set connector type size { w, h }',
          'DELETE /api/layouts/connector-type-sizes/:id':'Delete connector type size',
        },
        search: {
          'GET    /api/search?q=...':                    'Search entities by name/id/tag',
        },
        assets: {
          'GET    /api/list-assets':                     'List non-connector image assets',
          'GET    /api/list-connector-assets':           'List connector image assets',
        },
      },
    });
  });

  // ─── Harness files ────────────────────────────────────────────────────

  addRoute('GET', '/api/harnesses', (_req, res) => {
    const dir = path.join(projectRoot, 'public', 'harnesses');
    try {
      const files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
      json(res, files);
    } catch { json(res, []); }
  });

  addRoute('POST', '/api/harnesses', async (req, res) => {
    const body = await parseBody(req);
    const name = body?.name;
    if (!name || typeof name !== 'string') { err(res, 'name is required'); return; }
    const fp = harnessFile(name);
    if (fs.existsSync(fp)) { err(res, `Harness '${name}' already exists`, 409); return; }
    const data: HarnessData = body.data ?? {
      schema_version: '1.0',
      enclosures: [],
      connectors: [],
      wires: [],
      signals: [],
    };
    writeJSON(fp, data);
    json(res, { created: sanitizeName(name), data }, 201);
  });

  // ─── Harness document ─────────────────────────────────────────────────

  addRoute('GET', '/api/harness', (_req, res, _p, query) => {
    try {
      json(res, readHarness(harnessName(query)));
    } catch (e: any) { err(res, e.message, 404); }
  });

  addRoute('PUT', '/api/harness', async (req, res, _p, query) => {
    const body = await parseBody(req);
    if (!body?.schema_version) {
      err(res, 'Invalid harness data — must include schema_version'); return;
    }
    writeHarness(body as HarnessData, harnessName(query));
    json(res, { ok: true });
  });

  addRoute('GET', '/api/harness/stats', (_req, res, _p, query) => {
    try {
      const h = readHarness(harnessName(query));
      const allTags = new Set<string>();
      const addTags = (items: Array<{ tags: string[] }>) =>
        items.forEach(i => i.tags.forEach(t => allTags.add(t)));
      addTags(h.enclosures); addTags(h.connectors);
      addTags(h.connectors.flatMap(c => c.pins)); addTags(h.wires); addTags(h.signals);
      json(res, {
        schema_version: h.schema_version,
        counts: {
          enclosures: h.enclosures.length,
          connectors: h.connectors.length,
          pins: h.connectors.reduce((n, c) => n + c.pins.length, 0),
          wires: h.wires.length,
          signals: h.signals.length,
        },
        enclosure_ids: h.enclosures.map(e => e.id),
        connector_ids: h.connectors.map(c => c.id),
        wire_ids: h.wires.map(w => w.id),
        signal_ids: h.signals.map(s => s.id),
        tags: [...allTags].sort(),
      });
    } catch (e: any) { err(res, e.message, 404); }
  });

  // ─── Entity CRUD (enclosures, connectors, wires, signals) ─────────────

  entityRoutes<Enclosure>('/api/enclosures', 'enclosures', 'enc', ['name'], () => ({
    parent: null, container: true, tags: [], properties: {},
  } as Partial<Enclosure>));

  entityRoutes<Connector>('/api/connectors', 'connectors', 'conn', ['name'], () => ({
    parent: null, connector_type: '', tags: [], pins: [], properties: {},
  } as Partial<Connector>));

  entityRoutes<Wire>('/api/wires', 'wires', 'wire', ['from', 'to'], () => ({
    tags: [], properties: {},
  } as Partial<Wire>));

  entityRoutes<Signal>('/api/signals', 'signals', 'sig', ['name'], () => ({
    tags: [], properties: {},
  } as Partial<Signal>));

  // ─── Pins (nested under connectors) ───────────────────────────────────

  addRoute('GET', '/api/connectors/:cid/pins', (_req, res, params, query) => {
    try {
      const h = readHarness(harnessName(query));
      const conn = h.connectors.find(c => c.id === params.cid);
      if (!conn) { err(res, `Connector not found: ${params.cid}`, 404); return; }
      json(res, conn.pins);
    } catch (e: any) { err(res, e.message, 404); }
  });

  addRoute('POST', '/api/connectors/:cid/pins', async (req, res, params, query) => {
    const body = await parseBody(req);
    if (!body) { err(res, 'Request body required'); return; }
    const hn = harnessName(query);
    const h = readHarness(hn);
    const conn = h.connectors.find(c => c.id === params.cid);
    if (!conn) { err(res, `Connector not found: ${params.cid}`, 404); return; }
    const pin: Pin = {
      id: body.id ?? genId('pin'),
      pin_number: body.pin_number ?? conn.pins.length + 1,
      name: body.name ?? '',
      tags: body.tags ?? [],
      properties: body.properties ?? {},
    };
    if (conn.pins.some(p => p.id === pin.id)) {
      err(res, `Pin '${pin.id}' already exists in connector`, 409); return;
    }
    conn.pins.push(pin);
    writeHarness(h, hn);
    json(res, pin, 201);
  });

  addRoute('GET', '/api/connectors/:cid/pins/:pid', (_req, res, params, query) => {
    try {
      const h = readHarness(harnessName(query));
      const conn = h.connectors.find(c => c.id === params.cid);
      if (!conn) { err(res, `Connector not found: ${params.cid}`, 404); return; }
      const pin = conn.pins.find(p => p.id === params.pid);
      if (!pin) { err(res, `Pin not found: ${params.pid}`, 404); return; }
      json(res, pin);
    } catch (e: any) { err(res, e.message, 404); }
  });

  addRoute('PUT', '/api/connectors/:cid/pins/:pid', async (req, res, params, query) => {
    const body = await parseBody(req);
    if (!body) { err(res, 'Request body required'); return; }
    const hn = harnessName(query);
    const h = readHarness(hn);
    const conn = h.connectors.find(c => c.id === params.cid);
    if (!conn) { err(res, `Connector not found: ${params.cid}`, 404); return; }
    const idx = conn.pins.findIndex(p => p.id === params.pid);
    if (idx === -1) { err(res, `Pin not found: ${params.pid}`, 404); return; }
    conn.pins[idx] = { ...body, id: params.pid };
    if (!conn.pins[idx].tags) conn.pins[idx].tags = [];
    if (!conn.pins[idx].properties) conn.pins[idx].properties = {};
    writeHarness(h, hn);
    json(res, conn.pins[idx]);
  });

  addRoute('PATCH', '/api/connectors/:cid/pins/:pid', async (req, res, params, query) => {
    const body = await parseBody(req);
    if (!body) { err(res, 'Request body required'); return; }
    const hn = harnessName(query);
    const h = readHarness(hn);
    const conn = h.connectors.find(c => c.id === params.cid);
    if (!conn) { err(res, `Connector not found: ${params.cid}`, 404); return; }
    const idx = conn.pins.findIndex(p => p.id === params.pid);
    if (idx === -1) { err(res, `Pin not found: ${params.pid}`, 404); return; }
    conn.pins[idx] = { ...conn.pins[idx], ...body, id: params.pid };
    writeHarness(h, hn);
    json(res, conn.pins[idx]);
  });

  addRoute('DELETE', '/api/connectors/:cid/pins/:pid', (_req, res, params, query) => {
    const hn = harnessName(query);
    const h = readHarness(hn);
    const conn = h.connectors.find(c => c.id === params.cid);
    if (!conn) { err(res, `Connector not found: ${params.cid}`, 404); return; }
    const idx = conn.pins.findIndex(p => p.id === params.pid);
    if (idx === -1) { err(res, `Pin not found: ${params.pid}`, 404); return; }
    const deleted = conn.pins.splice(idx, 1)[0];
    writeHarness(h, hn);
    json(res, deleted);
  });

  // ─── Tags ─────────────────────────────────────────────────────────────

  addRoute('GET', '/api/tags', (_req, res, _p, query) => {
    try {
      const h = readHarness(harnessName(query));
      const tagSet = new Set<string>();
      const add = (items: Array<{ tags: string[] }>) =>
        items.forEach(i => i.tags.forEach(t => tagSet.add(t)));
      add(h.enclosures); add(h.connectors);
      add(h.connectors.flatMap(c => c.pins)); add(h.wires); add(h.signals);
      json(res, [...tagSet].sort());
    } catch (e: any) { err(res, e.message, 404); }
  });

  addRoute('POST', '/api/tags', async (req, res, _p, query) => {
    const body = await parseBody(req);
    if (!body?.entityType || !body?.entityId || !body?.tag) {
      err(res, 'Required fields: entityType, entityId, tag'); return;
    }
    const hn = harnessName(query);
    const h = readHarness(hn);
    const target = findTaggable(h, body.entityType, body.entityId);
    if (!target) { err(res, `Entity not found: ${body.entityType}/${body.entityId}`, 404); return; }
    if (!target.tags.includes(body.tag)) {
      target.tags.push(body.tag);
      writeHarness(h, hn);
    }
    json(res, target);
  });

  addRoute('DELETE', '/api/tags', async (req, res, _p, query) => {
    const body = await parseBody(req);
    if (!body?.entityType || !body?.entityId || !body?.tag) {
      err(res, 'Required fields: entityType, entityId, tag'); return;
    }
    const hn = harnessName(query);
    const h = readHarness(hn);
    const target = findTaggable(h, body.entityType, body.entityId);
    if (!target) { err(res, `Entity not found: ${body.entityType}/${body.entityId}`, 404); return; }
    target.tags = target.tags.filter(t => t !== body.tag);
    writeHarness(h, hn);
    json(res, target);
  });

  // ─── Connector library ────────────────────────────────────────────────

  addRoute('GET', '/api/library', (_req, res) => {
    try { json(res, readJSON<ConnectorLibrary>(libraryFile())); }
    catch { json(res, { connector_types: [] }); }
  });

  addRoute('PUT', '/api/library', async (req, res) => {
    const body = await parseBody(req);
    if (!body) { err(res, 'Request body required'); return; }
    writeJSON(libraryFile(), body);
    json(res, { ok: true });
  });

  addRoute('GET', '/api/library/types', (_req, res) => {
    try { json(res, readJSON<ConnectorLibrary>(libraryFile()).connector_types); }
    catch { json(res, []); }
  });

  addRoute('POST', '/api/library/types', async (req, res) => {
    const body = await parseBody(req);
    if (!body?.name) { err(res, 'name is required'); return; }
    let lib: ConnectorLibrary;
    try { lib = readJSON<ConnectorLibrary>(libraryFile()); }
    catch { lib = { connector_types: [] }; }
    const ct: ConnectorType = {
      id: body.id ?? genId('ct'),
      name: body.name,
      pin_count: body.pin_count ?? 0,
      crimp_spec: body.crimp_spec ?? '',
      wire_gauge: body.wire_gauge ?? '',
      notes: body.notes ?? '',
      ...(body.image && { image: body.image }),
      ...(body.side_image && { side_image: body.side_image }),
    };
    if (lib.connector_types.some(t => t.id === ct.id)) {
      err(res, `Connector type '${ct.id}' already exists`, 409); return;
    }
    lib.connector_types.push(ct);
    writeJSON(libraryFile(), lib);
    json(res, ct, 201);
  });

  addRoute('GET', '/api/library/types/:id', (_req, res, params) => {
    try {
      const lib = readJSON<ConnectorLibrary>(libraryFile());
      const ct = lib.connector_types.find(t => t.id === params.id);
      if (!ct) { err(res, `Not found: ${params.id}`, 404); return; }
      json(res, ct);
    } catch { err(res, 'Library not found', 404); }
  });

  addRoute('PUT', '/api/library/types/:id', async (req, res, params) => {
    const body = await parseBody(req);
    if (!body) { err(res, 'Request body required'); return; }
    let lib: ConnectorLibrary;
    try { lib = readJSON<ConnectorLibrary>(libraryFile()); }
    catch { err(res, 'Library not found', 404); return; }
    const idx = lib.connector_types.findIndex(t => t.id === params.id);
    if (idx === -1) { err(res, `Not found: ${params.id}`, 404); return; }
    lib.connector_types[idx] = { ...body, id: params.id };
    writeJSON(libraryFile(), lib);
    json(res, lib.connector_types[idx]);
  });

  addRoute('DELETE', '/api/library/types/:id', (_req, res, params) => {
    let lib: ConnectorLibrary;
    try { lib = readJSON<ConnectorLibrary>(libraryFile()); }
    catch { err(res, 'Library not found', 404); return; }
    const idx = lib.connector_types.findIndex(t => t.id === params.id);
    if (idx === -1) { err(res, `Not found: ${params.id}`, 404); return; }
    const deleted = lib.connector_types.splice(idx, 1)[0];
    writeJSON(libraryFile(), lib);
    json(res, deleted);
  });

  // ─── Layouts ──────────────────────────────────────────────────────────

  addRoute('GET', '/api/layouts', (_req, res) => {
    try { json(res, readJSON(layoutsFile())); }
    catch { json(res, {}); }
  });

  addRoute('PUT', '/api/layouts', async (req, res) => {
    const body = await parseBody(req);
    if (!body) { err(res, 'Request body required'); return; }
    writeJSON(layoutsFile(), body);
    json(res, { ok: true });
  });

  // ─── Search ───────────────────────────────────────────────────────────

  addRoute('GET', '/api/search', (_req, res, _p, query) => {
    const q = (query.get('q') ?? '').toLowerCase();
    if (!q) { err(res, 'Query parameter q is required'); return; }
    try {
      const h = readHarness(harnessName(query));
      const results: Array<{ type: string; id: string; name?: string; match: string }> = [];

      const matches = (fields: string[]) => fields.some(f => f.toLowerCase().includes(q));

      for (const enc of h.enclosures) {
        if (matches([enc.id, enc.name, ...enc.tags]))
          results.push({ type: 'enclosure', id: enc.id, name: enc.name, match: enc.name });
      }
      for (const conn of h.connectors) {
        if (matches([conn.id, conn.name, ...conn.tags]))
          results.push({ type: 'connector', id: conn.id, name: conn.name, match: conn.name });
        for (const pin of conn.pins) {
          if (matches([pin.id, pin.name, ...pin.tags]))
            results.push({ type: 'pin', id: pin.id, name: pin.name, match: `${conn.name} → ${pin.name}` });
        }
      }
      for (const wire of h.wires) {
        if (matches([wire.id, ...wire.tags, ...Object.values(wire.properties)]))
          results.push({ type: 'wire', id: wire.id, match: `${wire.from} → ${wire.to}` });
      }
      for (const sig of h.signals) {
        if (matches([sig.id, sig.name, ...sig.tags]))
          results.push({ type: 'signal', id: sig.id, name: sig.name, match: sig.name });
      }

      json(res, results);
    } catch (e: any) { err(res, e.message, 404); }
  });

  // ─── Harness file management ──────────────────────────────────────────

  addRoute('DELETE', '/api/harnesses/:name', (_req, res, params) => {
    const fp = harnessFile(params.name);
    if (!fs.existsSync(fp)) { err(res, `Harness '${params.name}' not found`, 404); return; }
    fs.unlinkSync(fp);
    json(res, { deleted: params.name });
  });

  addRoute('POST', '/api/harnesses/:name/copy', async (req, res, params) => {
    const body = await parseBody(req);
    const newName = body?.newName;
    if (!newName || typeof newName !== 'string') { err(res, 'newName is required'); return; }
    const srcFp = harnessFile(params.name);
    if (!fs.existsSync(srcFp)) { err(res, `Harness '${params.name}' not found`, 404); return; }
    const destFp = harnessFile(newName);
    if (fs.existsSync(destFp)) { err(res, `Harness '${sanitizeName(newName)}' already exists`, 409); return; }
    fs.copyFileSync(srcFp, destFp);
    json(res, { copied: params.name, newName: sanitizeName(newName) }, 201);
  });

  addRoute('POST', '/api/harnesses/:name/rename', async (req, res, params) => {
    const body = await parseBody(req);
    const newName = body?.newName;
    if (!newName || typeof newName !== 'string') { err(res, 'newName is required'); return; }
    const srcFp = harnessFile(params.name);
    if (!fs.existsSync(srcFp)) { err(res, `Harness '${params.name}' not found`, 404); return; }
    const destFp = harnessFile(newName);
    if (fs.existsSync(destFp)) { err(res, `Harness '${sanitizeName(newName)}' already exists`, 409); return; }
    fs.renameSync(srcFp, destFp);
    json(res, { renamed: params.name, newName: sanitizeName(newName) });
  });

  // ─── Batch operations ────────────────────────────────────────────────

  addRoute('POST', '/api/batch/enclosures', async (req, res, _p, query) => {
    const body = await parseBody(req);
    if (!Array.isArray(body)) { err(res, 'Request body must be an array'); return; }
    const hn = harnessName(query);
    const h = readHarness(hn);
    const created: Enclosure[] = [];
    for (const item of body) {
      if (!item.name) { err(res, `Each enclosure requires a 'name' field`); return; }
      const enc: Enclosure = {
        id: item.id ?? genId('enc'),
        name: item.name,
        parent: item.parent ?? null,
        container: item.container ?? true,
        tags: item.tags ?? [],
        properties: item.properties ?? {},
      };
      if (h.enclosures.some(e => e.id === enc.id)) {
        err(res, `Enclosure '${enc.id}' already exists`, 409); return;
      }
      h.enclosures.push(enc);
      created.push(enc);
    }
    writeHarness(h, hn);
    json(res, created, 201);
  });

  addRoute('POST', '/api/batch/connectors', async (req, res, _p, query) => {
    const body = await parseBody(req);
    if (!Array.isArray(body)) { err(res, 'Request body must be an array'); return; }
    const hn = harnessName(query);
    const h = readHarness(hn);
    const created: Connector[] = [];
    for (const item of body) {
      if (!item.name) { err(res, `Each connector requires a 'name' field`); return; }
      const conn: Connector = {
        id: item.id ?? genId('conn'),
        name: item.name,
        parent: item.parent ?? null,
        connector_type: item.connector_type ?? '',
        tags: item.tags ?? [],
        pins: item.pins ?? [],
        properties: item.properties ?? {},
      };
      if (h.connectors.some(c => c.id === conn.id)) {
        err(res, `Connector '${conn.id}' already exists`, 409); return;
      }
      // Auto-generate pins if auto_pins flag is set and connector_type references library
      if (item.auto_pins && conn.connector_type) {
        try {
          const lib = readJSON<ConnectorLibrary>(libraryFile());
          const ct = lib.connector_types.find(t => t.id === conn.connector_type);
          if (ct && ct.pin_count > 0 && conn.pins.length === 0) {
            for (let i = 1; i <= ct.pin_count; i++) {
              conn.pins.push({
                id: genId('pin'),
                pin_number: i,
                name: `${conn.name}.${i}`,
                tags: [],
                properties: {},
              });
            }
          }
        } catch { /* library not found, skip auto-gen */ }
      }
      h.connectors.push(conn);
      created.push(conn);
    }
    writeHarness(h, hn);
    json(res, created, 201);
  });

  addRoute('POST', '/api/batch/pins/:cid', async (req, res, params, query) => {
    const body = await parseBody(req);
    if (!Array.isArray(body)) { err(res, 'Request body must be an array'); return; }
    const hn = harnessName(query);
    const h = readHarness(hn);
    const conn = h.connectors.find(c => c.id === params.cid);
    if (!conn) { err(res, `Connector not found: ${params.cid}`, 404); return; }
    const created: Pin[] = [];
    for (const item of body) {
      const pin: Pin = {
        id: item.id ?? genId('pin'),
        pin_number: item.pin_number ?? conn.pins.length + 1,
        name: item.name ?? '',
        tags: item.tags ?? [],
        properties: item.properties ?? {},
      };
      if (conn.pins.some(p => p.id === pin.id)) {
        err(res, `Pin '${pin.id}' already exists in connector`, 409); return;
      }
      conn.pins.push(pin);
      created.push(pin);
    }
    writeHarness(h, hn);
    json(res, created, 201);
  });

  addRoute('POST', '/api/batch/wires', async (req, res, _p, query) => {
    const body = await parseBody(req);
    if (!Array.isArray(body)) { err(res, 'Request body must be an array'); return; }
    const hn = harnessName(query);
    const h = readHarness(hn);
    const created: Wire[] = [];
    for (const item of body) {
      if (!item.from || !item.to) { err(res, `Each wire requires 'from' and 'to'`); return; }
      const wire: Wire = {
        id: item.id ?? genId('wire'),
        from: item.from,
        to: item.to,
        tags: item.tags ?? [],
        properties: item.properties ?? {},
      };
      if (h.wires.some(w => w.id === wire.id)) {
        err(res, `Wire '${wire.id}' already exists`, 409); return;
      }
      h.wires.push(wire);
      created.push(wire);
    }
    writeHarness(h, hn);
    json(res, created, 201);
  });

  addRoute('POST', '/api/batch/signals', async (req, res, _p, query) => {
    const body = await parseBody(req);
    if (!Array.isArray(body)) { err(res, 'Request body must be an array'); return; }
    const hn = harnessName(query);
    const h = readHarness(hn);
    const created: Signal[] = [];
    for (const item of body) {
      if (!item.name) { err(res, `Each signal requires a 'name'`); return; }
      const sig: Signal = {
        id: item.id ?? genId('sig'),
        name: item.name,
        tags: item.tags ?? [],
        properties: item.properties ?? {},
      };
      if (h.signals.some(s => s.id === sig.id)) {
        err(res, `Signal '${sig.id}' already exists`, 409); return;
      }
      h.signals.push(sig);
      created.push(sig);
    }
    writeHarness(h, hn);
    json(res, created, 201);
  });

  addRoute('POST', '/api/batch/delete', async (req, res, _p, query) => {
    const body = await parseBody(req);
    if (!body?.items || !Array.isArray(body.items)) {
      err(res, 'Required: items array of { type, id }'); return;
    }
    const hn = harnessName(query);
    const h = readHarness(hn);
    const deleted: Array<{ type: string; id: string }> = [];
    for (const { type, id } of body.items) {
      let idx: number;
      switch (type) {
        case 'enclosure':
          idx = h.enclosures.findIndex(e => e.id === id);
          if (idx !== -1) { h.enclosures.splice(idx, 1); deleted.push({ type, id }); }
          break;
        case 'connector':
          idx = h.connectors.findIndex(c => c.id === id);
          if (idx !== -1) { h.connectors.splice(idx, 1); deleted.push({ type, id }); }
          break;
        case 'wire':
          idx = h.wires.findIndex(w => w.id === id);
          if (idx !== -1) { h.wires.splice(idx, 1); deleted.push({ type, id }); }
          break;
        case 'signal':
          idx = h.signals.findIndex(s => s.id === id);
          if (idx !== -1) { h.signals.splice(idx, 1); deleted.push({ type, id }); }
          break;
      }
    }
    writeHarness(h, hn);
    json(res, { deleted, count: deleted.length });
  });

  // ─── Auto-pin connector creation ────────────────────────────────────

  addRoute('POST', '/api/connectors-auto', async (req, res, _p, query) => {
    const body = await parseBody(req);
    if (!body) { err(res, 'Request body required'); return; }
    if (!body.name) { err(res, `Field 'name' is required`); return; }
    const hn = harnessName(query);
    const h = readHarness(hn);
    const conn: Connector = {
      id: body.id ?? genId('conn'),
      name: body.name,
      parent: body.parent ?? null,
      connector_type: body.connector_type ?? '',
      tags: body.tags ?? [],
      pins: body.pins ?? [],
      properties: body.properties ?? {},
    };
    if (h.connectors.some(c => c.id === conn.id)) {
      err(res, `Connector '${conn.id}' already exists`, 409); return;
    }
    // Auto-generate pins from library or explicit pin_count
    const pinCount = body.pin_count ?? (() => {
      if (!conn.connector_type) return 0;
      try {
        const lib = readJSON<ConnectorLibrary>(libraryFile());
        return lib.connector_types.find(t => t.id === conn.connector_type)?.pin_count ?? 0;
      } catch { return 0; }
    })();
    if (pinCount > 0 && conn.pins.length === 0) {
      for (let i = 1; i <= pinCount; i++) {
        conn.pins.push({
          id: body.pin_id_prefix ? `${body.pin_id_prefix}_${i}` : genId('pin'),
          pin_number: i,
          name: body.pin_name_prefix ? `${body.pin_name_prefix}.${i}` : `${conn.name}.${i}`,
          tags: body.default_pin_tags ?? [],
          properties: body.default_pin_properties ?? {},
        });
      }
    }
    h.connectors.push(conn);
    writeHarness(h, hn);
    json(res, conn, 201);
  });

  // ─── Granular layout management ──────────────────────────────────────

  interface LayoutData {
    nodes?: Record<string, { x: number; y: number }>;
    ports?: Record<string, { edge: string; ratio: number }>;
    sizes?: Record<string, { w: number; h: number }>;
    free?: Record<string, { x: number; y: number }>;
    backgrounds?: Record<string, any>;
    connectorTypeSizes?: Record<string, { w: number; h: number }>;
    textBoxes?: Record<string, any>;
    waypoints?: Record<string, any>;
    junctions?: Record<string, any>;
  }

  function readLayouts(): LayoutData {
    try { return readJSON<LayoutData>(layoutsFile()); }
    catch { return {}; }
  }
  function writeLayouts(data: LayoutData) {
    writeJSON(layoutsFile(), data);
  }

  // -- Node positions
  addRoute('GET', '/api/layouts/nodes', (_req, res) => {
    json(res, readLayouts().nodes ?? {});
  });
  addRoute('GET', '/api/layouts/nodes/:id', (_req, res, params) => {
    const pos = readLayouts().nodes?.[params.id];
    if (!pos) { err(res, `Node position not found: ${params.id}`, 404); return; }
    json(res, pos);
  });
  addRoute('PUT', '/api/layouts/nodes/:id', async (req, res, params) => {
    const body = await parseBody(req);
    if (body?.x === undefined || body?.y === undefined) { err(res, 'x and y are required'); return; }
    const layouts = readLayouts();
    if (!layouts.nodes) layouts.nodes = {};
    layouts.nodes[params.id] = { x: body.x, y: body.y };
    writeLayouts(layouts);
    json(res, layouts.nodes[params.id]);
  });
  addRoute('DELETE', '/api/layouts/nodes/:id', (_req, res, params) => {
    const layouts = readLayouts();
    if (!layouts.nodes?.[params.id]) { err(res, `Not found: ${params.id}`, 404); return; }
    delete layouts.nodes[params.id];
    writeLayouts(layouts);
    json(res, { deleted: params.id });
  });
  addRoute('PATCH', '/api/layouts/nodes', async (req, res) => {
    const body = await parseBody(req);
    if (!body || typeof body !== 'object') { err(res, 'Object of { nodeId: {x, y} } required'); return; }
    const layouts = readLayouts();
    if (!layouts.nodes) layouts.nodes = {};
    Object.assign(layouts.nodes, body);
    writeLayouts(layouts);
    json(res, layouts.nodes);
  });

  // -- Port positions
  addRoute('GET', '/api/layouts/ports', (_req, res) => {
    json(res, readLayouts().ports ?? {});
  });
  addRoute('GET', '/api/layouts/ports/:id', (_req, res, params) => {
    const port = readLayouts().ports?.[params.id];
    if (!port) { err(res, `Port not found: ${params.id}`, 404); return; }
    json(res, port);
  });
  addRoute('PUT', '/api/layouts/ports/:id', async (req, res, params) => {
    const body = await parseBody(req);
    if (!body?.edge || body?.ratio === undefined) { err(res, 'edge and ratio are required'); return; }
    const layouts = readLayouts();
    if (!layouts.ports) layouts.ports = {};
    layouts.ports[params.id] = { edge: body.edge, ratio: body.ratio };
    writeLayouts(layouts);
    json(res, layouts.ports[params.id]);
  });
  addRoute('DELETE', '/api/layouts/ports/:id', (_req, res, params) => {
    const layouts = readLayouts();
    if (!layouts.ports?.[params.id]) { err(res, `Not found: ${params.id}`, 404); return; }
    delete layouts.ports[params.id];
    writeLayouts(layouts);
    json(res, { deleted: params.id });
  });
  addRoute('PATCH', '/api/layouts/ports', async (req, res) => {
    const body = await parseBody(req);
    if (!body || typeof body !== 'object') { err(res, 'Object required'); return; }
    const layouts = readLayouts();
    if (!layouts.ports) layouts.ports = {};
    Object.assign(layouts.ports, body);
    writeLayouts(layouts);
    json(res, layouts.ports);
  });

  // -- Node sizes
  addRoute('GET', '/api/layouts/sizes', (_req, res) => {
    json(res, readLayouts().sizes ?? {});
  });
  addRoute('GET', '/api/layouts/sizes/:id', (_req, res, params) => {
    const size = readLayouts().sizes?.[params.id];
    if (!size) { err(res, `Size not found: ${params.id}`, 404); return; }
    json(res, size);
  });
  addRoute('PUT', '/api/layouts/sizes/:id', async (req, res, params) => {
    const body = await parseBody(req);
    if (body?.w === undefined || body?.h === undefined) { err(res, 'w and h are required'); return; }
    const layouts = readLayouts();
    if (!layouts.sizes) layouts.sizes = {};
    layouts.sizes[params.id] = { w: body.w, h: body.h };
    writeLayouts(layouts);
    json(res, layouts.sizes[params.id]);
  });
  addRoute('DELETE', '/api/layouts/sizes/:id', (_req, res, params) => {
    const layouts = readLayouts();
    if (!layouts.sizes?.[params.id]) { err(res, `Not found: ${params.id}`, 404); return; }
    delete layouts.sizes[params.id];
    writeLayouts(layouts);
    json(res, { deleted: params.id });
  });

  // -- Free connector positions
  addRoute('GET', '/api/layouts/free', (_req, res) => {
    json(res, readLayouts().free ?? {});
  });
  addRoute('GET', '/api/layouts/free/:id', (_req, res, params) => {
    const pos = readLayouts().free?.[params.id];
    if (!pos) { err(res, `Free position not found: ${params.id}`, 404); return; }
    json(res, pos);
  });
  addRoute('PUT', '/api/layouts/free/:id', async (req, res, params) => {
    const body = await parseBody(req);
    if (body?.x === undefined || body?.y === undefined) { err(res, 'x and y are required'); return; }
    const layouts = readLayouts();
    if (!layouts.free) layouts.free = {};
    layouts.free[params.id] = { x: body.x, y: body.y };
    writeLayouts(layouts);
    json(res, layouts.free[params.id]);
  });
  addRoute('DELETE', '/api/layouts/free/:id', (_req, res, params) => {
    const layouts = readLayouts();
    if (!layouts.free?.[params.id]) { err(res, `Not found: ${params.id}`, 404); return; }
    delete layouts.free[params.id];
    writeLayouts(layouts);
    json(res, { deleted: params.id });
  });
  addRoute('PATCH', '/api/layouts/free', async (req, res) => {
    const body = await parseBody(req);
    if (!body || typeof body !== 'object') { err(res, 'Object required'); return; }
    const layouts = readLayouts();
    if (!layouts.free) layouts.free = {};
    Object.assign(layouts.free, body);
    writeLayouts(layouts);
    json(res, layouts.free);
  });

  // -- Backgrounds
  addRoute('GET', '/api/layouts/backgrounds', (_req, res) => {
    json(res, readLayouts().backgrounds ?? {});
  });
  addRoute('GET', '/api/layouts/backgrounds/:id', (_req, res, params) => {
    const bg = readLayouts().backgrounds?.[params.id];
    if (!bg) { err(res, `Background not found: ${params.id}`, 404); return; }
    json(res, bg);
  });
  addRoute('PUT', '/api/layouts/backgrounds/:id', async (req, res, params) => {
    const body = await parseBody(req);
    if (!body) { err(res, 'Request body required'); return; }
    const layouts = readLayouts();
    if (!layouts.backgrounds) layouts.backgrounds = {};
    layouts.backgrounds[params.id] = body;
    writeLayouts(layouts);
    json(res, layouts.backgrounds[params.id]);
  });
  addRoute('DELETE', '/api/layouts/backgrounds/:id', (_req, res, params) => {
    const layouts = readLayouts();
    if (!layouts.backgrounds?.[params.id]) { err(res, `Not found: ${params.id}`, 404); return; }
    delete layouts.backgrounds[params.id];
    writeLayouts(layouts);
    json(res, { deleted: params.id });
  });

  // -- Text boxes
  addRoute('GET', '/api/layouts/textboxes', (_req, res) => {
    json(res, readLayouts().textBoxes ?? {});
  });
  addRoute('GET', '/api/layouts/textboxes/:id', (_req, res, params) => {
    const tb = readLayouts().textBoxes?.[params.id];
    if (!tb) { err(res, `Text box not found: ${params.id}`, 404); return; }
    json(res, tb);
  });
  addRoute('POST', '/api/layouts/textboxes', async (req, res) => {
    const body = await parseBody(req);
    if (!body) { err(res, 'Request body required'); return; }
    const layouts = readLayouts();
    if (!layouts.textBoxes) layouts.textBoxes = {};
    const id = body.id ?? genId('tb');
    const tb = {
      id,
      x: body.x ?? 0,
      y: body.y ?? 0,
      w: body.w ?? 200,
      h: body.h ?? 100,
      text: body.text ?? '',
      bgColor: body.bgColor ?? '#ffffff',
      textColor: body.textColor ?? '#000000',
      fontSize: body.fontSize ?? 14,
      fontFamily: body.fontFamily ?? 'sans',
      fontWeight: body.fontWeight ?? 'normal',
      textAlign: body.textAlign ?? 'left',
      borderColor: body.borderColor ?? '#cccccc',
      borderWidth: body.borderWidth ?? 1,
      borderRadius: body.borderRadius ?? 4,
      opacity: body.opacity ?? 1,
      padding: body.padding ?? 8,
    };
    layouts.textBoxes[id] = tb;
    writeLayouts(layouts);
    json(res, tb, 201);
  });
  addRoute('PUT', '/api/layouts/textboxes/:id', async (req, res, params) => {
    const body = await parseBody(req);
    if (!body) { err(res, 'Request body required'); return; }
    const layouts = readLayouts();
    if (!layouts.textBoxes) layouts.textBoxes = {};
    layouts.textBoxes[params.id] = { ...body, id: params.id };
    writeLayouts(layouts);
    json(res, layouts.textBoxes[params.id]);
  });
  addRoute('PATCH', '/api/layouts/textboxes/:id', async (req, res, params) => {
    const body = await parseBody(req);
    if (!body) { err(res, 'Request body required'); return; }
    const layouts = readLayouts();
    if (!layouts.textBoxes?.[params.id]) { err(res, `Not found: ${params.id}`, 404); return; }
    layouts.textBoxes[params.id] = { ...layouts.textBoxes[params.id], ...body, id: params.id };
    writeLayouts(layouts);
    json(res, layouts.textBoxes[params.id]);
  });
  addRoute('DELETE', '/api/layouts/textboxes/:id', (_req, res, params) => {
    const layouts = readLayouts();
    if (!layouts.textBoxes?.[params.id]) { err(res, `Not found: ${params.id}`, 404); return; }
    delete layouts.textBoxes[params.id];
    writeLayouts(layouts);
    json(res, { deleted: params.id });
  });

  // -- Waypoints
  addRoute('GET', '/api/layouts/waypoints', (_req, res) => {
    json(res, readLayouts().waypoints ?? {});
  });
  addRoute('GET', '/api/layouts/waypoints/:id', (_req, res, params) => {
    const wp = readLayouts().waypoints?.[params.id];
    if (!wp) { err(res, `Waypoints not found: ${params.id}`, 404); return; }
    json(res, wp);
  });
  addRoute('PUT', '/api/layouts/waypoints/:id', async (req, res, params) => {
    const body = await parseBody(req);
    if (!Array.isArray(body)) { err(res, 'Body must be an array of waypoint items'); return; }
    const layouts = readLayouts();
    if (!layouts.waypoints) layouts.waypoints = {};
    layouts.waypoints[params.id] = body;
    writeLayouts(layouts);
    json(res, layouts.waypoints[params.id]);
  });
  addRoute('DELETE', '/api/layouts/waypoints/:id', (_req, res, params) => {
    const layouts = readLayouts();
    if (!layouts.waypoints?.[params.id]) { err(res, `Not found: ${params.id}`, 404); return; }
    delete layouts.waypoints[params.id];
    writeLayouts(layouts);
    json(res, { deleted: params.id });
  });

  // -- Junctions
  addRoute('GET', '/api/layouts/junctions', (_req, res) => {
    json(res, readLayouts().junctions ?? {});
  });
  addRoute('GET', '/api/layouts/junctions/:id', (_req, res, params) => {
    const jn = readLayouts().junctions?.[params.id];
    if (!jn) { err(res, `Junction not found: ${params.id}`, 404); return; }
    json(res, jn);
  });
  addRoute('POST', '/api/layouts/junctions', async (req, res) => {
    const body = await parseBody(req);
    if (!body) { err(res, 'Request body required'); return; }
    const layouts = readLayouts();
    if (!layouts.junctions) layouts.junctions = {};
    const id = body.id ?? genId('jn');
    const jn = {
      id,
      x: body.x ?? 0,
      y: body.y ?? 0,
      memberEdgeIds: body.memberEdgeIds ?? [],
    };
    layouts.junctions[id] = jn;
    writeLayouts(layouts);
    json(res, jn, 201);
  });
  addRoute('PUT', '/api/layouts/junctions/:id', async (req, res, params) => {
    const body = await parseBody(req);
    if (!body) { err(res, 'Request body required'); return; }
    const layouts = readLayouts();
    if (!layouts.junctions) layouts.junctions = {};
    layouts.junctions[params.id] = { ...body, id: params.id };
    writeLayouts(layouts);
    json(res, layouts.junctions[params.id]);
  });
  addRoute('DELETE', '/api/layouts/junctions/:id', (_req, res, params) => {
    const layouts = readLayouts();
    if (!layouts.junctions?.[params.id]) { err(res, `Not found: ${params.id}`, 404); return; }
    delete layouts.junctions[params.id];
    writeLayouts(layouts);
    json(res, { deleted: params.id });
  });

  // -- Connector type sizes
  addRoute('GET', '/api/layouts/connector-type-sizes', (_req, res) => {
    json(res, readLayouts().connectorTypeSizes ?? {});
  });
  addRoute('PUT', '/api/layouts/connector-type-sizes/:id', async (req, res, params) => {
    const body = await parseBody(req);
    if (body?.w === undefined || body?.h === undefined) { err(res, 'w and h are required'); return; }
    const layouts = readLayouts();
    if (!layouts.connectorTypeSizes) layouts.connectorTypeSizes = {};
    layouts.connectorTypeSizes[params.id] = { w: body.w, h: body.h };
    writeLayouts(layouts);
    json(res, layouts.connectorTypeSizes[params.id]);
  });
  addRoute('DELETE', '/api/layouts/connector-type-sizes/:id', (_req, res, params) => {
    const layouts = readLayouts();
    if (!layouts.connectorTypeSizes?.[params.id]) { err(res, `Not found: ${params.id}`, 404); return; }
    delete layouts.connectorTypeSizes[params.id];
    writeLayouts(layouts);
    json(res, { deleted: params.id });
  });

  // ─── Wiring helpers ──────────────────────────────────────────────────

  addRoute('POST', '/api/wire-by-name', async (req, res, _p, query) => {
    const body = await parseBody(req);
    if (!body) { err(res, 'Request body required'); return; }
    const { from_connector, from_pin, to_connector, to_pin } = body;
    if (!from_connector || !from_pin || !to_connector || !to_pin) {
      err(res, 'Required: from_connector, from_pin, to_connector, to_pin (names or pin numbers)');
      return;
    }
    const hn = harnessName(query);
    const h = readHarness(hn);

    function resolvePin(connectorRef: string, pinRef: string | number): string | null {
      const conn = h.connectors.find(c => c.name === connectorRef || c.id === connectorRef);
      if (!conn) return null;
      const pin = typeof pinRef === 'number'
        ? conn.pins.find(p => p.pin_number === pinRef)
        : conn.pins.find(p => p.name === pinRef || p.id === pinRef || p.pin_number === Number(pinRef));
      return pin?.id ?? null;
    }

    const fromPinId = resolvePin(from_connector, from_pin);
    const toPinId = resolvePin(to_connector, to_pin);
    if (!fromPinId) { err(res, `Could not resolve pin: ${from_connector} / ${from_pin}`, 404); return; }
    if (!toPinId) { err(res, `Could not resolve pin: ${to_connector} / ${to_pin}`, 404); return; }

    const wire: Wire = {
      id: body.id ?? genId('wire'),
      from: fromPinId,
      to: toPinId,
      tags: body.tags ?? [],
      properties: body.properties ?? {},
    };
    if (h.wires.some(w => w.id === wire.id)) {
      err(res, `Wire '${wire.id}' already exists`, 409); return;
    }
    h.wires.push(wire);
    writeHarness(h, hn);
    json(res, wire, 201);
  });

  addRoute('POST', '/api/batch/wire-by-name', async (req, res, _p, query) => {
    const body = await parseBody(req);
    if (!Array.isArray(body)) { err(res, 'Request body must be an array'); return; }
    const hn = harnessName(query);
    const h = readHarness(hn);

    function resolvePin(connectorRef: string, pinRef: string | number): string | null {
      const conn = h.connectors.find(c => c.name === connectorRef || c.id === connectorRef);
      if (!conn) return null;
      const pin = typeof pinRef === 'number'
        ? conn.pins.find(p => p.pin_number === pinRef)
        : conn.pins.find(p => p.name === pinRef || p.id === pinRef || p.pin_number === Number(pinRef));
      return pin?.id ?? null;
    }

    const created: Wire[] = [];
    for (const item of body) {
      const { from_connector, from_pin, to_connector, to_pin } = item;
      if (!from_connector || !from_pin || !to_connector || !to_pin) {
        err(res, `Each wire needs from_connector, from_pin, to_connector, to_pin`); return;
      }
      const fromPinId = resolvePin(from_connector, from_pin);
      const toPinId = resolvePin(to_connector, to_pin);
      if (!fromPinId) { err(res, `Could not resolve: ${from_connector} / ${from_pin}`, 404); return; }
      if (!toPinId) { err(res, `Could not resolve: ${to_connector} / ${to_pin}`, 404); return; }
      const wire: Wire = {
        id: item.id ?? genId('wire'),
        from: fromPinId,
        to: toPinId,
        tags: item.tags ?? [],
        properties: item.properties ?? {},
      };
      if (h.wires.some(w => w.id === wire.id)) {
        err(res, `Wire '${wire.id}' already exists`, 409); return;
      }
      h.wires.push(wire);
      created.push(wire);
    }
    writeHarness(h, hn);
    json(res, created, 201);
  });

  addRoute('GET', '/api/unconnected-pins', (_req, res, _p, query) => {
    try {
      const h = readHarness(harnessName(query));
      const connectedPinIds = new Set<string>();
      for (const w of h.wires) {
        connectedPinIds.add(w.from);
        connectedPinIds.add(w.to);
      }
      const unconnected: Array<{ connector_id: string; connector_name: string; pin: Pin }> = [];
      for (const conn of h.connectors) {
        for (const pin of conn.pins) {
          if (!connectedPinIds.has(pin.id)) {
            unconnected.push({ connector_id: conn.id, connector_name: conn.name, pin });
          }
        }
      }
      json(res, { count: unconnected.length, pins: unconnected });
    } catch (e: any) { err(res, e.message, 404); }
  });

  // ─── Relationship queries ──────────────────────────────────────────

  addRoute('GET', '/api/enclosures/:id/children', (_req, res, params, query) => {
    try {
      const h = readHarness(harnessName(query));
      const enclosure = h.enclosures.find(e => e.id === params.id);
      if (!enclosure) { err(res, `Enclosure not found: ${params.id}`, 404); return; }
      const childEnclosures = h.enclosures.filter(e => e.parent === params.id);
      const childConnectors = h.connectors.filter(c => c.parent === params.id);
      json(res, {
        enclosure,
        children: {
          enclosures: childEnclosures,
          connectors: childConnectors,
        },
      });
    } catch (e: any) { err(res, e.message, 404); }
  });

  addRoute('GET', '/api/connectors/:id/wires', (_req, res, params, query) => {
    try {
      const h = readHarness(harnessName(query));
      const conn = h.connectors.find(c => c.id === params.id);
      if (!conn) { err(res, `Connector not found: ${params.id}`, 404); return; }
      const pinIds = new Set(conn.pins.map(p => p.id));
      const wires = h.wires.filter(w => pinIds.has(w.from) || pinIds.has(w.to));
      json(res, { connector: conn.id, connector_name: conn.name, wire_count: wires.length, wires });
    } catch (e: any) { err(res, e.message, 404); }
  });

  addRoute('GET', '/api/pins/:id/wires', (_req, res, params, query) => {
    try {
      const h = readHarness(harnessName(query));
      const wires = h.wires.filter(w => w.from === params.id || w.to === params.id);
      let pinInfo: { connector_id: string; connector_name: string; pin: Pin } | undefined;
      for (const conn of h.connectors) {
        const pin = conn.pins.find(p => p.id === params.id);
        if (pin) {
          pinInfo = { connector_id: conn.id, connector_name: conn.name, pin };
          break;
        }
      }
      if (!pinInfo) { err(res, `Pin not found: ${params.id}`, 404); return; }
      json(res, { ...pinInfo, wires });
    } catch (e: any) { err(res, e.message, 404); }
  });

  addRoute('GET', '/api/signals/:id/net', (_req, res, params, query) => {
    try {
      const h = readHarness(harnessName(query));
      const signal = h.signals.find(s => s.id === params.id);
      if (!signal) { err(res, `Signal not found: ${params.id}`, 404); return; }
      const signalTag = `signal:${signal.name}`;
      const wires = h.wires.filter(w => w.tags.includes(signalTag));
      const pinIds = new Set<string>();
      wires.forEach(w => { pinIds.add(w.from); pinIds.add(w.to); });
      const pins: Array<{ connector_id: string; connector_name: string; pin: Pin }> = [];
      for (const conn of h.connectors) {
        for (const pin of conn.pins) {
          if (pinIds.has(pin.id) || pin.tags.includes(signalTag)) {
            pins.push({ connector_id: conn.id, connector_name: conn.name, pin });
          }
        }
      }
      json(res, { signal, wires, pins });
    } catch (e: any) { err(res, e.message, 404); }
  });

  addRoute('GET', '/api/connectivity/:id', (_req, res, params, query) => {
    try {
      const h = readHarness(harnessName(query));
      // Find all pins reachable from the given pin through wires (trace the net)
      const visited = new Set<string>();
      const queue = [params.id];
      const traceWires: Wire[] = [];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        for (const w of h.wires) {
          if (w.from === current && !visited.has(w.to)) {
            queue.push(w.to);
            traceWires.push(w);
          } else if (w.to === current && !visited.has(w.from)) {
            queue.push(w.from);
            traceWires.push(w);
          }
        }
      }
      const connectedPins: Array<{ connector_id: string; connector_name: string; pin: Pin }> = [];
      for (const conn of h.connectors) {
        for (const pin of conn.pins) {
          if (visited.has(pin.id)) {
            connectedPins.push({ connector_id: conn.id, connector_name: conn.name, pin });
          }
        }
      }
      json(res, { root_pin: params.id, pins: connectedPins, wires: traceWires });
    } catch (e: any) { err(res, e.message, 404); }
  });

  // ─── Entity operations (move, duplicate, properties) ────────────────

  addRoute('POST', '/api/move', async (req, res, _p, query) => {
    const body = await parseBody(req);
    if (!body?.type || !body?.id || body?.newParent === undefined) {
      err(res, 'Required: type, id, newParent'); return;
    }
    const hn = harnessName(query);
    const h = readHarness(hn);
    let target: any;
    switch (body.type) {
      case 'enclosure':
        target = h.enclosures.find(e => e.id === body.id);
        break;
      case 'connector':
        target = h.connectors.find(c => c.id === body.id);
        break;
      default:
        err(res, `Cannot move type: ${body.type}`); return;
    }
    if (!target) { err(res, `Not found: ${body.type}/${body.id}`, 404); return; }
    target.parent = body.newParent;
    writeHarness(h, hn);
    json(res, target);
  });

  addRoute('POST', '/api/duplicate', async (req, res, _p, query) => {
    const body = await parseBody(req);
    if (!body?.type || !body?.id) { err(res, 'Required: type, id'); return; }
    const hn = harnessName(query);
    const h = readHarness(hn);
    const newIdSuffix = () => `_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    switch (body.type) {
      case 'enclosure': {
        const src = h.enclosures.find(e => e.id === body.id);
        if (!src) { err(res, `Not found: ${body.id}`, 404); return; }
        const dup: Enclosure = {
          ...JSON.parse(JSON.stringify(src)),
          id: body.newId ?? `enc${newIdSuffix()}`,
          name: body.newName ?? `${src.name} (copy)`,
        };
        h.enclosures.push(dup);
        writeHarness(h, hn);
        json(res, dup, 201);
        return;
      }
      case 'connector': {
        const src = h.connectors.find(c => c.id === body.id);
        if (!src) { err(res, `Not found: ${body.id}`, 404); return; }
        const pinIdMap = new Map<string, string>();
        const dupPins = src.pins.map(p => {
          const newPinId = genId('pin');
          pinIdMap.set(p.id, newPinId);
          return { ...JSON.parse(JSON.stringify(p)), id: newPinId };
        });
        const dup: Connector = {
          ...JSON.parse(JSON.stringify(src)),
          id: body.newId ?? `conn${newIdSuffix()}`,
          name: body.newName ?? `${src.name} (copy)`,
          pins: dupPins,
        };
        h.connectors.push(dup);
        // Optionally duplicate wires too
        if (body.duplicateWires) {
          const srcPinIds = new Set(src.pins.map(p => p.id));
          const srcWires = h.wires.filter(w => srcPinIds.has(w.from) || srcPinIds.has(w.to));
          for (const w of srcWires) {
            const newFrom = pinIdMap.get(w.from) ?? w.from;
            const newTo = pinIdMap.get(w.to) ?? w.to;
            h.wires.push({
              ...JSON.parse(JSON.stringify(w)),
              id: genId('wire'),
              from: newFrom,
              to: newTo,
            });
          }
        }
        writeHarness(h, hn);
        json(res, dup, 201);
        return;
      }
      default:
        err(res, `Cannot duplicate type: ${body.type}`); return;
    }
  });

  // Properties CRUD on any entity
  addRoute('GET', '/api/properties', (_req, res, _p, query) => {
    const type = query.get('type');
    const id = query.get('id');
    if (!type || !id) { err(res, 'Query params type and id are required'); return; }
    try {
      const h = readHarness(harnessName(query));
      const entity = findTaggable(h, type, id);
      if (!entity) { err(res, `Not found: ${type}/${id}`, 404); return; }
      json(res, entity.properties);
    } catch (e: any) { err(res, e.message, 404); }
  });

  addRoute('PUT', '/api/properties', async (req, res, _p, query) => {
    const body = await parseBody(req);
    if (!body?.type || !body?.id || !body?.properties) {
      err(res, 'Required: type, id, properties'); return;
    }
    const hn = harnessName(query);
    const h = readHarness(hn);
    const entity = findTaggable(h, body.type, body.id);
    if (!entity) { err(res, `Not found: ${body.type}/${body.id}`, 404); return; }
    entity.properties = body.properties;
    writeHarness(h, hn);
    json(res, entity);
  });

  addRoute('PATCH', '/api/properties', async (req, res, _p, query) => {
    const body = await parseBody(req);
    if (!body?.type || !body?.id || !body?.properties) {
      err(res, 'Required: type, id, properties'); return;
    }
    const hn = harnessName(query);
    const h = readHarness(hn);
    const entity = findTaggable(h, body.type, body.id);
    if (!entity) { err(res, `Not found: ${body.type}/${body.id}`, 404); return; }
    Object.assign(entity.properties, body.properties);
    writeHarness(h, hn);
    json(res, entity);
  });

  addRoute('DELETE', '/api/properties', async (req, res, _p, query) => {
    const body = await parseBody(req);
    if (!body?.type || !body?.id || !body?.keys || !Array.isArray(body.keys)) {
      err(res, 'Required: type, id, keys (array of property names)'); return;
    }
    const hn = harnessName(query);
    const h = readHarness(hn);
    const entity = findTaggable(h, body.type, body.id);
    if (!entity) { err(res, `Not found: ${body.type}/${body.id}`, 404); return; }
    for (const key of body.keys) {
      delete entity.properties[key];
    }
    writeHarness(h, hn);
    json(res, entity);
  });

  // ─── Validation ──────────────────────────────────────────────────────

  addRoute('GET', '/api/validate', (_req, res, _p, query) => {
    try {
      const h = readHarness(harnessName(query));
      const errors: string[] = [];
      const warnings: string[] = [];

      // Check for duplicate IDs
      const allIds = new Map<string, string>();
      const checkId = (type: string, id: string) => {
        if (allIds.has(id)) {
          errors.push(`Duplicate ID '${id}' used by both ${allIds.get(id)} and ${type}`);
        } else {
          allIds.set(id, type);
        }
      };
      h.enclosures.forEach(e => checkId('enclosure', e.id));
      h.connectors.forEach(c => {
        checkId('connector', c.id);
        c.pins.forEach(p => checkId('pin', p.id));
      });
      h.wires.forEach(w => checkId('wire', w.id));
      h.signals.forEach(s => checkId('signal', s.id));

      // Validate parent references for enclosures
      const encIds = new Set(h.enclosures.map(e => e.id));

      for (const e of h.enclosures) {
        if (e.parent && !encIds.has(e.parent)) {
          errors.push(`Enclosure '${e.id}' (${e.name}) references non-existent parent '${e.parent}'`);
        }
      }
      for (const c of h.connectors) {
        if (c.parent && !encIds.has(c.parent)) {
          warnings.push(`Connector '${c.id}' (${c.name}) parent '${c.parent}' not found as enclosure`);
        }
      }

      // Validate wire endpoints
      const allPinIds = new Set<string>();
      h.connectors.forEach(c => c.pins.forEach(p => allPinIds.add(p.id)));
      for (const w of h.wires) {
        if (!allPinIds.has(w.from)) {
          errors.push(`Wire '${w.id}' 'from' references non-existent pin '${w.from}'`);
        }
        if (!allPinIds.has(w.to)) {
          errors.push(`Wire '${w.id}' 'to' references non-existent pin '${w.to}'`);
        }
        if (w.from === w.to) {
          warnings.push(`Wire '${w.id}' connects a pin to itself ('${w.from}')`);
        }
      }

      // Find unconnected pins
      const connectedPinIds = new Set<string>();
      h.wires.forEach(w => { connectedPinIds.add(w.from); connectedPinIds.add(w.to); });
      const unconnectedCount = [...allPinIds].filter(id => !connectedPinIds.has(id)).length;
      if (unconnectedCount > 0) {
        warnings.push(`${unconnectedCount} pin(s) have no wires connected`);
      }

      // Check for duplicate wires (same from/to pair)
      const wireEndpoints = new Set<string>();
      for (const w of h.wires) {
        const key = [w.from, w.to].sort().join('↔');
        if (wireEndpoints.has(key)) {
          warnings.push(`Duplicate wire between '${w.from}' and '${w.to}'`);
        }
        wireEndpoints.add(key);
      }

      // Check connectors with no pins
      for (const c of h.connectors) {
        if (c.pins.length === 0) {
          warnings.push(`Connector '${c.id}' (${c.name}) has no pins`);
        }
      }

      // Check for orphan enclosures (no children)
      for (const e of h.enclosures) {
        const hasChildEnc = h.enclosures.some(c => c.parent === e.id);
        const hasChildConn = h.connectors.some(c => c.parent === e.id);
        if (!hasChildEnc && !hasChildConn) {
          warnings.push(`Enclosure '${e.id}' (${e.name}) has no children`);
        }
      }

      json(res, {
        valid: errors.length === 0,
        error_count: errors.length,
        warning_count: warnings.length,
        errors,
        warnings,
      });
    } catch (e: any) { err(res, e.message, 404); }
  });

  // ─── Legacy save endpoints (used by the UI's Topbar) ──────────────────

  addRoute('POST', '/api/save-harness', async (req, res) => {
    const body = await parseBody(req);
    try {
      JSON.stringify(body);
      writeJSON(path.join(projectRoot, 'public/harnesses/fsae-car.json'), body);
      json(res, { ok: true });
    } catch (e: any) { err(res, e.message); }
  });

  addRoute('POST', '/api/save-layouts', async (req, res) => {
    const body = await parseBody(req);
    try {
      writeJSON(layoutsFile(), body);
      json(res, { ok: true });
    } catch (e: any) { err(res, e.message); }
  });

  addRoute('POST', '/api/save-library', async (req, res) => {
    const body = await parseBody(req);
    try {
      writeJSON(libraryFile(), body);
      json(res, { ok: true });
    } catch (e: any) { err(res, e.message); }
  });

  // ─── Asset listing (used by ImagePickerPanel) ─────────────────────────

  addRoute('GET', '/api/list-assets', (_req, res) => {
    const dir = path.join(projectRoot, 'img_assets_besides_connectors');
    try {
      const files = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f))
        : [];
      json(res, files);
    } catch { json(res, []); }
  });

  addRoute('GET', '/api/list-connector-assets', (_req, res) => {
    const dir = path.join(projectRoot, 'connector_library');
    try {
      const files = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f))
        : [];
      json(res, files);
    } catch { json(res, []); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Middleware dispatch
  // ═══════════════════════════════════════════════════════════════════════

  return function apiMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) {
    const parsed = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = parsed.pathname;
    const method = req.method?.toUpperCase() ?? 'GET';

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    if (!pathname.startsWith('/api')) { next(); return; }

    for (const r of routes) {
      if (r.method !== method) continue;
      const match = pathname.match(r.pattern);
      if (!match) continue;

      const params: Params = {};
      r.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });

      try {
        const result = r.handler(req, res, params, parsed.searchParams);
        if (result instanceof Promise) {
          result.catch(e => {
            console.error('API error:', e);
            if (!res.headersSent) err(res, e.message ?? 'Internal error', 500);
          });
        }
      } catch (e: any) {
        console.error('API error:', e);
        if (!res.headersSent) err(res, e.message ?? 'Internal error', 500);
      }
      return;
    }

    err(res, `No route: ${method} ${pathname}`, 404);
  };
}
