/**
 * Hierarchical per-sheet System storage.
 *
 * A sheeted System lives in a directory (instead of one flat JSON file):
 *
 *   public/user-data/systems/<name>/
 *     root.json              -- the root/car-level sheet (sheet_enclosure_id: null)
 *     signals.json           -- flat array of Signal, shared across every sheet
 *     sheets/<enc_id>.json   -- one sheet per enclosure that has been split out
 *
 * A sheet only describes its own interior: enclosures/connectors/branchPoints/paths
 * that are directly owned by it, plus `ports[]` declaring where its own wiring
 * reaches into a *direct* child enclosure's sheet. An enclosure "has its own sheet"
 * purely by the presence of `sheets/<enc_id>.json` on disk -- any enclosure without
 * that file is simply inlined in its owning ancestor's sheet. This makes the split
 * fully recursive/opt-in with no fixed depth limit.
 *
 * A `SheetBoundaryPort` (declared on the *parent* sheet) represents "a wire from this
 * sheet that terminates inside a specific child sheet." Paths on the parent sheet
 * that reach into a child terminate at a `port` node instead of an ordinary
 * `connector`/`branch` node. On load, `assembleFromSheetMap` synthesizes a
 * `derived: true` Connector or BranchPoint inside the child's scope from each port,
 * and rewrites the parent's `port` node into an ordinary node -- so by the time the
 * data reaches the rest of the app it is one ordinary flat `SystemData`, exactly
 * as before. On save, `splitSystem` does the inverse.
 *
 * Known limitation: crossing more than one sheet boundary in a single path, or
 * crossing into a sheet that is not a *direct* child of the referencing sheet
 * (i.e. chained/multi-level derivation), is not implemented yet -- `splitSystem`
 * throws a clear error rather than silently mis-splitting. Today's data is only
 * ever two sheet-levels deep (root -> top-level container), so this never triggers.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface Enclosure {
  id: string;
  name: string;
  parent: string | null;
  kind: 'enclosure';
  tags: string[];
  properties: Record<string, string>;
}

export interface Device {
  id: string;
  name: string;
  parent: string | null;
  kind: 'device';
  tags: string[];
  properties: Record<string, string>;
}

export type HierarchyEntity = Device | Enclosure;

export interface Connector {
  id: string;
  name: string;
  parent: string | null;
  connector_type: string;
  /**
   * Optional placement override. Missing values preserve the legacy rule that
   * direct children of container enclosures are bulkheads.
   */
  mounting?: 'inline' | 'bulkhead';
  /** Selected family housing capacity, or an optional fixed-type override. */
  pin_count?: number;
  /** Optional mechanical key selected for a family housing. */
  keying?: string;
  tags: string[];
  properties: Record<string, string>;
  derived?: boolean;
  derived_from_port?: string;
}

export interface BranchPoint {
  id: string;
  name: string;
  parent: string | null;
  tags: string[];
  properties: Record<string, string>;
  derived?: boolean;
  derived_from_port?: string;
}

export interface Signal {
  id: string;
  name: string;
  tags: string[];
  properties: Record<string, string>;
}

export interface SignalPropertyDefinition {
  id: string;
  key: string;
  name: string;
  type: 'select';
  options: string[];
}

export interface ConnectorPathNode {
  kind: 'connector';
  connector_id: string;
  pin_number: number;
}

export interface BranchPointPathNode {
  kind: 'branch';
  branch_point_id: string;
}

/** On-disk-only node kind: a reference to a `SheetBoundaryPort` declared in this same sheet file. */
export interface PortPathNode {
  kind: 'port';
  port_id: string;
  pin_number?: number;
}

/** Runtime/assembled node shape -- identical to the historical flat schema. */
export type PathNode = ConnectorPathNode | BranchPointPathNode;
/** On-disk sheet node shape -- may additionally reference a local port. */
export type SheetPathNode = ConnectorPathNode | BranchPointPathNode | PortPathNode;

export interface PathMeasurement<TNode = PathNode> {
  from: TNode;
  to: TNode;
  length_mm?: number;
  note?: string;
}

export interface PathEntity {
  id: string;
  name: string;
  signal_id?: string;
  tags: string[];
  properties: Record<string, string>;
  nodes: PathNode[];
  measurements: PathMeasurement[];
}

export interface SheetPath {
  id: string;
  name: string;
  signal_id?: string;
  tags: string[];
  properties: Record<string, string>;
  nodes: SheetPathNode[];
  measurements: PathMeasurement<SheetPathNode>[];
}

export interface SheetBoundaryPort {
  id: string;
  name: string;
  /** Which sheet file materializes the derived entity (a sheet-owning enclosure id). */
  target_child_id: string;
  /**
   * The `.parent` the derived entity is given once materialized. Usually equal to
   * `target_child_id`, but may be a nested device enclosure *within* that sheet's
   * scope (e.g. a PCB like "Safety Board" that lives inside the "FOC" sheet) --
   * preserving this is what keeps the enclosure tree intact across a round trip.
   */
  entity_parent: string;
  entity_kind: 'connector' | 'branch';
  connector_id?: string;
  connector_type?: string;
  /** Placement override copied from a connector when present. */
  mounting?: 'inline' | 'bulkhead';
  /** Instance cavity override copied from the derived connector when present. */
  pin_count?: number;
  /** Mechanical key copied from the derived connector when present. */
  keying?: string;
  branch_point_id?: string;
  tags: string[];
  properties: Record<string, string>;
}

export interface SystemSheet {
  schema_version: string;
  /** Present on root.json only; this is a display name, not the directory key. */
  name?: string;
  sheet_enclosure_id: string | null;
  hierarchy: HierarchyEntity[];
  connectors: Connector[];
  branchPoints: BranchPoint[];
  paths: SheetPath[];
  ports: SheetBoundaryPort[];
  /** Root-sheet-only schema for structured signal properties. */
  signalPropertyDefinitions?: SignalPropertyDefinition[];
}

export interface SystemData {
  schema_version: string;
  name?: string;
  hierarchy: HierarchyEntity[];
  connectors: Connector[];
  branchPoints: BranchPoint[];
  paths: PathEntity[];
  signals: Signal[];
  signalPropertyDefinitions: SignalPropertyDefinition[];
}

const SHEET_SCHEMA_VERSION = '0.3.0-sheets';

function emptySheet(sheetEnclosureId: string | null): SystemSheet {
  return {
    schema_version: SHEET_SCHEMA_VERSION,
    sheet_enclosure_id: sheetEnclosureId,
    hierarchy: [],
    connectors: [],
    branchPoints: [],
    paths: [],
    ports: [],
  };
}

function asHierarchyEntity(raw: unknown): HierarchyEntity | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id) return null;
  const kind = record.kind === 'device' || record.kind === 'enclosure'
    ? record.kind
    : record.container === false ? 'device' : 'enclosure';
  return {
    id: record.id,
    name: typeof record.name === 'string' ? record.name : record.id,
    parent: typeof record.parent === 'string' ? record.parent : null,
    kind,
    tags: Array.isArray(record.tags) ? record.tags.filter((item): item is string => typeof item === 'string') : [],
    properties: record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)
      ? Object.fromEntries(
        Object.entries(record.properties as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
      : {},
  };
}

function normalizeSheet(raw: unknown, sheetEnclosureId: string | null): SystemSheet {
  const sheet = emptySheet(sheetEnclosureId);
  if (!raw || typeof raw !== 'object') return sheet;
  const record = raw as Record<string, unknown>;
  if (sheetEnclosureId === null && typeof record.name === 'string' && record.name.trim()) {
    sheet.name = record.name.trim();
  }
  const hierarchySource = Array.isArray(record.hierarchy)
    ? record.hierarchy
    : Array.isArray(record.enclosures)
      ? record.enclosures
      : [];
  sheet.hierarchy = hierarchySource.flatMap((item) => {
    const entity = asHierarchyEntity(item);
    return entity ? [entity] : [];
  });
  sheet.connectors = Array.isArray(record.connectors) ? (record.connectors as Connector[]) : [];
  const branchSource = Array.isArray(record.branchPoints)
    ? record.branchPoints
    : Array.isArray(record.mergePoints)
      ? record.mergePoints
      : [];
  sheet.branchPoints = branchSource.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const branchPoint = item as Record<string, unknown>;
    const match = typeof branchPoint.name === 'string'
      ? /^Splice (\d+)$/.exec(branchPoint.name)
      : null;
    return match ? { ...branchPoint, name: `Branch ${match[1]}` } : branchPoint;
  }) as BranchPoint[];
  sheet.paths = Array.isArray(record.paths) ? (record.paths as SheetPath[]) : [];
  sheet.ports = Array.isArray(record.ports) ? (record.ports as SheetBoundaryPort[]) : [];
  if (sheetEnclosureId === null) {
    sheet.signalPropertyDefinitions = Array.isArray(record.signalPropertyDefinitions)
      ? (record.signalPropertyDefinitions as SignalPropertyDefinition[])
      : [];
  }
  return sheet;
}

// ---------------------------------------------------------------------------
// Directory / System-format helpers
// ---------------------------------------------------------------------------

export function systemsDir(projectRoot: string): string {
  return path.join(projectRoot, 'public', 'user-data', 'systems');
}

export function legacySystemsDir(projectRoot: string): string {
  return path.join(projectRoot, 'public', 'user-data', 'harnesses');
}

export function flatSystemFile(projectRoot: string, name: string): string {
  const canonical = path.join(systemsDir(projectRoot), `${name}.json`);
  if (fs.existsSync(canonical)) return canonical;
  return path.join(legacySystemsDir(projectRoot), `${name}.json`);
}

export function sheetSystemDir(projectRoot: string, name: string): string {
  const canonical = path.join(systemsDir(projectRoot), name);
  if (fs.existsSync(path.join(canonical, 'root.json'))) return canonical;
  const legacy = path.join(legacySystemsDir(projectRoot), name);
  if (fs.existsSync(path.join(legacy, 'root.json'))) return legacy;
  return canonical;
}

function rootSheetFile(systemDir: string): string {
  return path.join(systemDir, 'root.json');
}

function signalsFile(systemDir: string): string {
  return path.join(systemDir, 'signals.json');
}

function childSheetFile(systemDir: string, enclosureId: string): string {
  return path.join(systemDir, 'sheets', `${enclosureId}.json`);
}

export function isSheetedSystem(projectRoot: string, name: string): boolean {
  return fs.existsSync(rootSheetFile(sheetSystemDir(projectRoot, name)));
}

function readJSON<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/** Enclosure ids that currently have their own sheet file on disk. */
export function discoverSheetEnclosureIds(systemDir: string): Set<string> {
  const dir = path.join(systemDir, 'sheets');
  if (!fs.existsSync(dir)) return new Set();
  return new Set(
    fs.readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.slice(0, -'.json'.length)),
  );
}

// ---------------------------------------------------------------------------
// Assembler: many sheet files -> one flat SystemData
// ---------------------------------------------------------------------------

type SheetLoader = (sheetEnclosureId: string | null) => SystemSheet;

interface PathFragment {
  name: string;
  signal_id?: string;
  tags: string[];
  properties: Record<string, string>;
  nodes: PathNode[];
  measurements: PathMeasurement[];
}

/**
 * Stitches every sheet fragment sharing a path id back into one logical `Path`.
 * A path only ever produces more than one fragment when *both* sides of a sheet
 * boundary have local content of their own (see `splitSystem`'s "common===scopeA"
 * / "common===scopeB" branches) -- each fragment shares exactly one boundary node
 * with its neighbor (represented identically in both, once as a real node and once
 * via a resolved port), so fragments are re-joined by matching that shared endpoint
 * and deduplicating it.
 */
function stitchPathFragments(id: string, fragments: PathFragment[]): PathEntity {
  const first = fragments[0];
  if (fragments.length === 1) {
    return { id, name: first.name, ...(first.signal_id ? { signal_id: first.signal_id } : {}), tags: first.tags, properties: first.properties, nodes: first.nodes, measurements: first.measurements };
  }

  let chain = [...first.nodes];
  const remaining = fragments.slice(1);
  let progressed = true;
  while (remaining.length > 0 && progressed) {
    progressed = false;
    for (let i = 0; i < remaining.length; i++) {
      const frag = remaining[i];
      if (refKey(chain[chain.length - 1]) === refKey(frag.nodes[0])) {
        chain = [...chain, ...frag.nodes.slice(1)];
        remaining.splice(i, 1);
        progressed = true;
        break;
      }
      if (refKey(chain[0]) === refKey(frag.nodes[frag.nodes.length - 1])) {
        chain = [...frag.nodes.slice(0, -1), ...chain];
        remaining.splice(i, 1);
        progressed = true;
        break;
      }
    }
  }
  if (remaining.length > 0) {
    throw new Error(`Path '${id}' has ${fragments.length} sheet fragments that don't chain into a single path (${remaining.length} left over after stitching)`);
  }

  const seenMeasurements = new Set<string>();
  const measurements: PathMeasurement[] = [];
  for (const measurement of fragments.flatMap((f) => f.measurements)) {
    const key = `${refKey(measurement.from)}|${refKey(measurement.to)}|${measurement.length_mm ?? ''}|${measurement.note ?? ''}`;
    if (seenMeasurements.has(key)) continue;
    seenMeasurements.add(key);
    measurements.push(measurement);
  }

  return { id, name: first.name, ...(first.signal_id ? { signal_id: first.signal_id } : {}), tags: first.tags, properties: first.properties, nodes: chain, measurements };
}

function assembleFromLoader(
  loadSheet: SheetLoader,
  sheetEnclosureIds: Set<string>,
  signals: Signal[],
): SystemData {
  const hierarchy: HierarchyEntity[] = [];
  const connectors: Connector[] = [];
  const branchPoints: BranchPoint[] = [];
  const pathFragmentsById = new Map<string, PathFragment[]>();
  const seenIds = new Map<string, string>();
  let systemName: string | undefined;
  let signalPropertyDefinitions: SignalPropertyDefinition[] = [];

  const registerId = (entityType: string, id: string) => {
    const existing = seenIds.get(id);
    if (existing) {
      throw new Error(`Duplicate id '${id}' used by both ${existing} and ${entityType} while assembling sheets`);
    }
    seenIds.set(id, entityType);
  };

  function toRuntimeNode(node: SheetPathNode, connectorIdByPort: Map<string, string>, mergeIdByPort: Map<string, string>, pathId: string): PathNode {
    if ((node as { kind?: string }).kind === 'merge') {
      const id = (node as { branch_point_id?: string; merge_point_id?: string }).branch_point_id
        ?? (node as { merge_point_id?: string }).merge_point_id;
      if (!id) throw new Error(`Path '${pathId}' has a merge node without a branch point id`);
      return { kind: 'branch', branch_point_id: id };
    }
    if (node.kind !== 'port') return node;
    if (connectorIdByPort.has(node.port_id)) {
      // Some Systems (for example, fsae-car.json) genuinely omit pin_number on many
      // connector nodes -- preserve that as-is rather than defaulting it, so the
      // resulting node's refKey still matches its counterpart in another sheet
      // fragment when stitching multi-fragment paths back together.
      return { kind: 'connector', connector_id: connectorIdByPort.get(node.port_id)!, pin_number: node.pin_number as number };
    }
    if (mergeIdByPort.has(node.port_id)) {
      return { kind: 'branch', branch_point_id: mergeIdByPort.get(node.port_id)! };
    }
    throw new Error(`Path '${pathId}' references unknown port '${node.port_id}'`);
  }

  function processSheet(sheetEnclosureId: string | null) {
    const sheet = loadSheet(sheetEnclosureId);
    if (sheetEnclosureId === null) {
      systemName = sheet.name;
      signalPropertyDefinitions = sheet.signalPropertyDefinitions ?? [];
    }

    for (const enc of sheet.hierarchy) {
      registerId('enclosure', enc.id);
      hierarchy.push(enc);
    }
    for (const con of sheet.connectors) {
      registerId('connector', con.id);
      connectors.push(con);
    }
    for (const branchPoint of sheet.branchPoints) {
      registerId('branchPoint', branchPoint.id);
      branchPoints.push(branchPoint);
    }

    const connectorIdByPort = new Map<string, string>();
    const mergeIdByPort = new Map<string, string>();
    for (const port of sheet.ports) {
      if (port.entity_kind === 'connector') {
        if (!port.connector_id) throw new Error(`Port '${port.id}' has entity_kind 'connector' but no connector_id`);
        registerId('connector (derived)', port.connector_id);
        connectorIdByPort.set(port.id, port.connector_id);
        connectors.push({
          id: port.connector_id,
          name: port.name,
          parent: port.entity_parent ?? port.target_child_id,
          connector_type: port.connector_type ?? '',
          ...(port.mounting ? { mounting: port.mounting } : {}),
          ...(port.pin_count != null ? { pin_count: port.pin_count } : {}),
          ...(port.keying ? { keying: port.keying } : {}),
          tags: port.tags ?? [],
          properties: port.properties ?? {},
          derived: true,
          derived_from_port: port.id,
        });
      } else {
        if (!port.branch_point_id && typeof (port as { merge_point_id?: string }).merge_point_id === 'string') {
          port.branch_point_id = (port as { merge_point_id?: string }).merge_point_id;
        }
        if (!port.branch_point_id) throw new Error(`Port '${port.id}' has entity_kind 'branch' but no branch_point_id`);
        registerId('branchPoint (derived)', port.branch_point_id);
        mergeIdByPort.set(port.id, port.branch_point_id);
        branchPoints.push({
          id: port.branch_point_id,
          name: port.name,
          parent: port.entity_parent ?? port.target_child_id,
          tags: port.tags ?? [],
          properties: port.properties ?? {},
          derived: true,
          derived_from_port: port.id,
        });
      }
    }

    for (const sheetPath of sheet.paths) {
      const nodes = sheetPath.nodes.map((node) => toRuntimeNode(node, connectorIdByPort, mergeIdByPort, sheetPath.id));
      const measurements = sheetPath.measurements.map((measurement) => ({
        from: toRuntimeNode(measurement.from, connectorIdByPort, mergeIdByPort, sheetPath.id),
        to: toRuntimeNode(measurement.to, connectorIdByPort, mergeIdByPort, sheetPath.id),
        ...(measurement.length_mm !== undefined ? { length_mm: measurement.length_mm } : {}),
        ...(measurement.note !== undefined ? { note: measurement.note } : {}),
      }));
      if (!pathFragmentsById.has(sheetPath.id)) pathFragmentsById.set(sheetPath.id, []);
      pathFragmentsById.get(sheetPath.id)!.push({ name: sheetPath.name, signal_id: sheetPath.signal_id, tags: sheetPath.tags, properties: sheetPath.properties, nodes, measurements });
    }

    for (const child of sheet.hierarchy) {
      if (sheetEnclosureIds.has(child.id)) processSheet(child.id);
    }
  }

  processSheet(null);

  const paths = [...pathFragmentsById.entries()].map(([id, fragments]) => stitchPathFragments(id, fragments));

  return {
    schema_version: SHEET_SCHEMA_VERSION,
    ...(systemName ? { name: systemName } : {}),
    hierarchy,
    connectors,
    branchPoints,
    paths,
    signals,
    signalPropertyDefinitions,
  };
}

export function assembleSystemFromDisk(systemDir: string): SystemData {
  const sheetEnclosureIds = discoverSheetEnclosureIds(systemDir);
  const signals = fs.existsSync(signalsFile(systemDir)) ? readJSON<Signal[]>(signalsFile(systemDir)) : [];
  const loadSheet: SheetLoader = (sheetEnclosureId) => {
    const file = sheetEnclosureId === null ? rootSheetFile(systemDir) : childSheetFile(systemDir, sheetEnclosureId);
    return normalizeSheet(readJSON<unknown>(file), sheetEnclosureId);
  };
  return assembleFromLoader(loadSheet, sheetEnclosureIds, signals);
}

function assembleFromSheetMap(
  sheets: Map<string | null, SystemSheet>,
  sheetEnclosureIds: Set<string>,
  signals: Signal[],
): SystemData {
  const loadSheet: SheetLoader = (sheetEnclosureId) => sheets.get(sheetEnclosureId) ?? emptySheet(sheetEnclosureId);
  return assembleFromLoader(loadSheet, sheetEnclosureIds, signals);
}

// ---------------------------------------------------------------------------
// Splitter: one flat SystemData -> many sheet files
// ---------------------------------------------------------------------------

interface RunNode {
  scope: string | null;
  index: number;
}

interface Fragment {
  localNodes: SheetPathNode[];
  originalNodes: PathNode[];
}

function refKey(node: PathNode): string {
  return node.kind === 'connector' ? `c:${node.connector_id}:${node.pin_number}` : `m:${node.branch_point_id}`;
}

/** Strips the `derived`/`derived_from_port` bookkeeping fields before writing a plain entity to disk. */
function omitDerivedFields<T extends { derived?: boolean; derived_from_port?: string }>(entity: T): Omit<T, 'derived' | 'derived_from_port'> {
  const clean: Partial<T> = { ...entity };
  delete clean.derived;
  delete clean.derived_from_port;
  return clean as Omit<T, 'derived' | 'derived_from_port'>;
}

export interface SplitResult {
  sheets: Map<string | null, SystemSheet>;
  signals: Signal[];
}

export function splitSystem(system: SystemData, sheetEnclosureIds: Set<string>): SplitResult {
  const enclosureById = new Map(system.hierarchy.map((e) => [e.id, e]));
  const connectorById = new Map(system.connectors.map((c) => [c.id, c]));
  const branchPointById = new Map(system.branchPoints.map((m) => [m.id, m]));

  function ownerScopeOfParent(parentId: string | null): string | null {
    let cur = parentId;
    while (cur !== null) {
      if (sheetEnclosureIds.has(cur)) return cur;
      const enc = enclosureById.get(cur);
      if (!enc) throw new Error(`Dangling enclosure parent reference '${cur}'`);
      cur = enc.parent;
    }
    return null;
  }

  function sheetParentOf(scope: string | null): string | null | undefined {
    if (scope === null) return undefined;
    const enc = enclosureById.get(scope);
    if (!enc) throw new Error(`Unknown sheet-owning enclosure '${scope}'`);
    return ownerScopeOfParent(enc.parent);
  }

  function scopeChainToRoot(scope: string | null): (string | null)[] {
    const chain: (string | null)[] = [];
    let cur: string | null | undefined = scope;
    while (cur !== undefined) {
      chain.push(cur);
      if (cur === null) break;
      cur = sheetParentOf(cur);
    }
    return chain;
  }

  function lca(a: string | null, b: string | null): string | null {
    if (a === b) return a;
    const chainB = new Set(scopeChainToRoot(b));
    for (const s of scopeChainToRoot(a)) {
      if (chainB.has(s)) return s;
    }
    return null;
  }

  function nodeScope(node: PathNode): string | null {
    if (node.kind === 'connector') {
      const con = connectorById.get(node.connector_id);
      if (!con) throw new Error(`Path references missing connector '${node.connector_id}'`);
      return ownerScopeOfParent(con.parent);
    }
    const branchPoint = branchPointById.get(node.branch_point_id);
    if (!branchPoint) throw new Error(`Path references missing branch point '${node.branch_point_id}'`);
    return ownerScopeOfParent(branchPoint.parent);
  }

  function toLocalNode(node: PathNode): SheetPathNode {
    return node.kind === 'connector'
      ? { kind: 'connector', connector_id: node.connector_id, pin_number: node.pin_number }
      : { kind: 'branch', branch_point_id: node.branch_point_id };
  }

  const sheets = new Map<string | null, SystemSheet>();
  function getSheet(scope: string | null): SystemSheet {
    if (!sheets.has(scope)) sheets.set(scope, emptySheet(scope));
    return sheets.get(scope)!;
  }
  getSheet(null);
  if (system.name) getSheet(null).name = system.name;
  getSheet(null).signalPropertyDefinitions = system.signalPropertyDefinitions ?? [];
  for (const id of sheetEnclosureIds) getSheet(id);

  const derivedConnectorIds = new Set<string>();
  const derivedBranchPointIds = new Set<string>();

  function registerPort(
    declaringScope: string | null,
    targetChildScope: string,
    node: PathNode,
  ): string {
    const sheet = getSheet(declaringScope);
    const entityId = node.kind === 'connector' ? node.connector_id : node.branch_point_id;
    const portId = `port_${entityId}`;
    let port = sheet.ports.find((p) => p.id === portId);
    if (!port) {
      if (node.kind === 'connector') {
        const con = connectorById.get(node.connector_id)!;
        if (con.parent === null) throw new Error(`Connector '${con.id}' has no parent but is used across a sheet boundary into '${targetChildScope}'`);
        port = {
          id: portId,
          name: con.name,
          target_child_id: targetChildScope,
          entity_parent: con.parent,
          entity_kind: 'connector',
          connector_id: con.id,
          connector_type: con.connector_type || undefined,
          ...(con.mounting ? { mounting: con.mounting } : {}),
          ...(con.pin_count != null ? { pin_count: con.pin_count } : {}),
          ...(con.keying ? { keying: con.keying } : {}),
          tags: con.tags,
          properties: con.properties,
        };
        derivedConnectorIds.add(con.id);
      } else {
        const branchPoint = branchPointById.get(node.branch_point_id)!;
        if (branchPoint.parent === null) throw new Error(`Branch point '${branchPoint.id}' has no parent but is used across a sheet boundary into '${targetChildScope}'`);
        port = {
          id: portId,
          name: branchPoint.name,
          target_child_id: targetChildScope,
          entity_parent: branchPoint.parent,
          entity_kind: 'branch',
          branch_point_id: branchPoint.id,
          tags: branchPoint.tags,
          properties: branchPoint.properties,
        };
        derivedBranchPointIds.add(branchPoint.id);
      }
      sheet.ports.push(port);
    } else if (port.target_child_id !== targetChildScope) {
      throw new Error(
        `Port conflict in scope '${declaringScope ?? 'root'}': entity '${entityId}' would need to target both '${port.target_child_id}' and '${targetChildScope}'`,
      );
    }
    return portId;
  }

  // --- enclosures ---
  for (const enc of system.hierarchy) {
    const scope = ownerScopeOfParent(enc.parent);
    getSheet(scope).hierarchy.push({ ...enc });
  }

  // --- branch points (plain placement; may later be excluded if derived) ---
  for (const branchPoint of system.branchPoints) {
    const scope = ownerScopeOfParent(branchPoint.parent);
    getSheet(scope).branchPoints.push(omitDerivedFields(branchPoint));
  }

  // --- paths (the hard part) ---
  for (const p of system.paths) {
    const scopes = p.nodes.map(nodeScope);
    const runs: RunNode[][] = [];
    for (let i = 0; i < p.nodes.length; i++) {
      if (runs.length > 0 && scopes[runs[runs.length - 1][0].index] === scopes[i]) {
        runs[runs.length - 1].push({ scope: scopes[i], index: i });
      } else {
        runs.push([{ scope: scopes[i], index: i }]);
      }
    }

    // General path fragmentation: represent every adjacent logical segment in
    // the nearest common sheet. Route creation inserts a placeholder connector
    // at every crossed sheet boundary, so adjacent scopes are always equal,
    // parent/child, or siblings under one common parent. Emitting two-node
    // fragments is intentionally simple; assembly stitches them by their shared
    // endpoint identity into the original ordered logical Path.
    if (runs.length > 2) {
      const toNodeInHost = (
        host: string | null,
        scope: string | null,
        node: PathNode,
      ): SheetPathNode => {
        if (scope === host) return toLocalNode(node);
        if (scope === null || sheetParentOf(scope) !== host) {
          throw new Error(
            `Path '${p.id}' has adjacent scopes '${host ?? 'root'}' and '${scope ?? 'root'}' without a placeholder at each intervening sheet boundary.`,
          );
        }
        if (node.kind === 'branch') {
          throw new Error(`Path '${p.id}' cannot cross a sheet boundary at branch point '${node.branch_point_id}'.`);
        }
        const portId = registerPort(host, scope, node);
        return { kind: 'port', port_id: portId, pin_number: node.pin_number };
      };

      for (let index = 0; index < p.nodes.length - 1; index++) {
        const from = p.nodes[index];
        const to = p.nodes[index + 1];
        const fromScope = scopes[index];
        const toScope = scopes[index + 1];
        const host = lca(fromScope, toScope);
        const localFrom = toNodeInHost(host, fromScope, from);
        const localTo = toNodeInHost(host, toScope, to);
        const pairKeys = new Set([refKey(from), refKey(to)]);
        const measurements = (p.measurements ?? [])
          .filter((measurement) => pairKeys.has(refKey(measurement.from)) && pairKeys.has(refKey(measurement.to)))
          .map((measurement) => ({
            from: refKey(measurement.from) === refKey(from) ? localFrom : localTo,
            to: refKey(measurement.to) === refKey(from) ? localFrom : localTo,
            ...(measurement.length_mm !== undefined ? { length_mm: measurement.length_mm } : {}),
            ...(measurement.note !== undefined ? { note: measurement.note } : {}),
          }));
        getSheet(host).paths.push({
          id: p.id,
          name: p.name,
          ...(p.signal_id ? { signal_id: p.signal_id } : {}),
          tags: p.tags,
          properties: p.properties,
          nodes: [localFrom, localTo],
          measurements,
        });
      }
      continue;
    }
    const fragments = new Map<string | null, Fragment>();
    const ensureFrag = (scope: string | null): Fragment => {
      if (!fragments.has(scope)) fragments.set(scope, { localNodes: [], originalNodes: [] });
      return fragments.get(scope)!;
    };
    const pushRun = (frag: Fragment, run: RunNode[]) => {
      for (const r of run) {
        frag.localNodes.push(toLocalNode(p.nodes[r.index]));
        frag.originalNodes.push(p.nodes[r.index]);
      }
    };

    if (runs.length === 1) {
      pushRun(ensureFrag(runs[0][0].scope), runs[0]);
    } else if (runs.length > 2 && runs.every((run) => run.length === 1)) {
      // A chain of pure pass-through boundary hops in a single path (e.g. a wire
      // authored as one 3-node path FOC-C1 -> ROC-C1 -> HVB-C1 instead of two
      // separate 2-node paths). None of the intermediate hops have any other
      // local content, so nothing along the chain gets its own fragment -- the
      // whole path collapses into a single all-port fragment declared in the
      // common ancestor of every scope it touches.
      const chainScopes = runs.map((run) => run[0].scope);
      const host = chainScopes.reduce((acc, s) => lca(acc, s));
      const chainErr = () =>
        new Error(`Path '${p.id}': multi-hop chain through [${chainScopes.map((s) => s ?? 'root').join(' -> ')}] needs deeper sheet nesting than is supported yet.`);
      for (const scope of chainScopes) {
        if (scope !== host && sheetParentOf(scope) !== host) throw chainErr();
      }
      const bridge = ensureFrag(host);
      for (const run of runs) {
        const node = p.nodes[run[0].index];
        const scope = run[0].scope;
        if (scope === host) {
          bridge.localNodes.push(toLocalNode(node));
        } else {
          if (scope === null) throw chainErr();
          if (node.kind === 'branch') throw new Error(`Path '${p.id}' crosses a sheet boundary at a branch point inside a multi-hop chain -- not supported yet.`);
          const portId = registerPort(host, scope, node);
          bridge.localNodes.push({ kind: 'port', port_id: portId, pin_number: node.pin_number });
        }
        bridge.originalNodes.push(node);
      }
    } else if (runs.length > 2) {
      throw new Error(`Path '${p.id}' crosses more than one sheet boundary in a way that isn't supported yet (mixes local content with pass-through hops).`);
    } else {
      const [runA, runB] = runs;
      const scopeA = runA[0].scope;
      const scopeB = runB[0].scope;
      const nodeA = p.nodes[runA[runA.length - 1].index];
      const nodeB = p.nodes[runB[0].index];
      const common = lca(scopeA, scopeB);

      const crossingErr = (from: string | null, to: string | null) =>
        new Error(`Path '${p.id}': crossing from '${from ?? 'root'}' to '${to ?? 'root'}' needs multi-level sheet nesting, which isn't supported yet.`);

      // A scope can only be an lca-child (i.e. the non-common side of a boundary) if
      // it is a real sheet-owning enclosure -- root (null) is always an ancestor of
      // everything else, so it can never be the "child" side of a crossing.
      const requireChild = (scope: string | null): string => {
        if (scope === null) throw crossingErr(scopeA, scopeB);
        return scope;
      };

      if (common === scopeA) {
        const childScope = requireChild(scopeB);
        if (sheetParentOf(childScope) !== scopeA) throw crossingErr(scopeA, scopeB);
        const fragA = ensureFrag(scopeA);
        pushRun(fragA, runA);
        const portId = registerPort(scopeA, childScope, nodeB);
        fragA.localNodes.push({ kind: 'port', port_id: portId, ...(nodeB.kind === 'connector' ? { pin_number: nodeB.pin_number } : {}) });
        fragA.originalNodes.push(nodeB);
        if (runB.length >= 2) pushRun(ensureFrag(scopeB), runB);
      } else if (common === scopeB) {
        const childScope = requireChild(scopeA);
        if (sheetParentOf(childScope) !== scopeB) throw crossingErr(scopeA, scopeB);
        const fragB = ensureFrag(scopeB);
        const portId = registerPort(scopeB, childScope, nodeA);
        fragB.localNodes.push({ kind: 'port', port_id: portId, ...(nodeA.kind === 'connector' ? { pin_number: nodeA.pin_number } : {}) });
        fragB.originalNodes.push(nodeA);
        pushRun(fragB, runB);
        if (runA.length >= 2) pushRun(ensureFrag(scopeA), runA);
      } else {
        const childA = requireChild(scopeA);
        const childB = requireChild(scopeB);
        if (sheetParentOf(childA) !== common || sheetParentOf(childB) !== common) throw crossingErr(scopeA, scopeB);
        if (runA.length >= 2) pushRun(ensureFrag(scopeA), runA);
        if (runB.length >= 2) pushRun(ensureFrag(scopeB), runB);
        const portIdA = registerPort(common, childA, nodeA);
        const portIdB = registerPort(common, childB, nodeB);
        const bridge = ensureFrag(common);
        bridge.localNodes.push({ kind: 'port', port_id: portIdA, ...(nodeA.kind === 'connector' ? { pin_number: nodeA.pin_number } : {}) });
        bridge.originalNodes.push(nodeA);
        bridge.localNodes.push({ kind: 'port', port_id: portIdB, ...(nodeB.kind === 'connector' ? { pin_number: nodeB.pin_number } : {}) });
        bridge.originalNodes.push(nodeB);
      }
    }

    const emittedScopes = [...fragments.entries()].filter(([, frag]) => frag.localNodes.length >= 2).map(([scope]) => scope);
    if (emittedScopes.length === 0) {
      console.warn(`[sheets] Path '${p.id}' produced no sheet fragment (degenerate path, skipped).`);
    }
    for (const scope of emittedScopes) {
      const frag = fragments.get(scope)!;
      const measurements: PathMeasurement<SheetPathNode>[] = [];
      for (const measurement of p.measurements ?? []) {
        const fromIdx = frag.originalNodes.findIndex((n) => refKey(n) === refKey(measurement.from));
        const toIdx = frag.originalNodes.findIndex((n) => refKey(n) === refKey(measurement.to));
        if (fromIdx === -1 || toIdx === -1) continue;
        measurements.push({
          from: frag.localNodes[fromIdx],
          to: frag.localNodes[toIdx],
          ...(measurement.length_mm !== undefined ? { length_mm: measurement.length_mm } : {}),
          ...(measurement.note !== undefined ? { note: measurement.note } : {}),
        });
      }
      getSheet(scope).paths.push({ id: p.id, name: p.name, ...(p.signal_id ? { signal_id: p.signal_id } : {}), tags: p.tags, properties: p.properties, nodes: frag.localNodes, measurements });
    }
    for (const measurement of p.measurements ?? []) {
      const placed = emittedScopes.some((scope) => {
        const frag = fragments.get(scope)!;
        return frag.originalNodes.some((n) => refKey(n) === refKey(measurement.from)) && frag.originalNodes.some((n) => refKey(n) === refKey(measurement.to));
      });
      if (!placed) {
        console.warn(`[sheets] Measurement on path '${p.id}' spans multiple sheet fragments; dropped (not supported yet).`);
      }
    }
  }

  // --- connectors (skip any that ended up derived from a port) ---
  for (const con of system.connectors) {
    if (derivedConnectorIds.has(con.id)) continue;
    const scope = ownerScopeOfParent(con.parent);
    getSheet(scope).connectors.push(omitDerivedFields(con));
  }

  // --- drop branch points that ended up derived from a port ---
  if (derivedBranchPointIds.size > 0) {
    for (const sheet of sheets.values()) {
      sheet.branchPoints = sheet.branchPoints.filter((branchPoint) => !derivedBranchPointIds.has(branchPoint.id));
    }
  }

  return { sheets, signals: system.signals };
}

// ---------------------------------------------------------------------------
// Round-trip safety check
// ---------------------------------------------------------------------------

function sortedIds<T extends { id: string }>(items: T[]): string[] {
  return items.map((i) => i.id).sort();
}

/**
 * Re-assembles `split` in-memory (no disk I/O) and compares it against `original`.
 * Returns a list of human-readable mismatches; empty means the split is safe to write.
 */
export function verifyRoundTrip(original: SystemData, split: SplitResult, sheetEnclosureIds: Set<string>): string[] {
  const problems: string[] = [];
  let reassembled: SystemData;
  try {
    reassembled = assembleFromSheetMap(split.sheets, sheetEnclosureIds, split.signals);
  } catch (error) {
    return [`Round-trip assembly threw: ${error instanceof Error ? error.message : String(error)}`];
  }
  if ((original.name ?? '') !== (reassembled.name ?? '')) {
    problems.push(`system name mismatch after split: '${original.name ?? ''}' vs '${reassembled.name ?? ''}'`);
  }

  const compareIdSets = (label: string, a: { id: string }[], b: { id: string }[]) => {
    const idsA = sortedIds(a);
    const idsB = sortedIds(b);
    if (JSON.stringify(idsA) !== JSON.stringify(idsB)) {
      const missing = idsA.filter((id) => !idsB.includes(id));
      const extra = idsB.filter((id) => !idsA.includes(id));
      problems.push(`${label} id set mismatch — missing after split: [${missing.join(', ')}], unexpected after split: [${extra.join(', ')}]`);
    }
  };
  compareIdSets('hierarchy', original.hierarchy, reassembled.hierarchy);
  compareIdSets('connectors', original.connectors, reassembled.connectors);
  compareIdSets('branchPoints', original.branchPoints, reassembled.branchPoints);
  compareIdSets('paths', original.paths, reassembled.paths);
  compareIdSets('signals', original.signals, reassembled.signals);
  compareIdSets(
    'signal property definitions',
    original.signalPropertyDefinitions ?? [],
    reassembled.signalPropertyDefinitions,
  );
  if (
    JSON.stringify(original.signalPropertyDefinitions ?? [])
    !== JSON.stringify(reassembled.signalPropertyDefinitions)
  ) {
    problems.push('signal property definitions changed after sheet round trip');
  }

  const byId = <T extends { id: string }>(items: T[]) => new Map(items.map((i) => [i.id, i]));
  const origConnectors = byId(original.connectors);
  const newConnectors = byId(reassembled.connectors);
  for (const [id, con] of origConnectors) {
    const next = newConnectors.get(id);
    if (!next) continue;
    const origPinCount = Number.isFinite(con.pin_count) ? con.pin_count! : null;
    const nextPinCount = Number.isFinite(next.pin_count) ? next.pin_count! : null;
    if (
      con.parent !== next.parent
      || con.name !== next.name
      || (con.connector_type || '') !== (next.connector_type || '')
      || (con.mounting ?? null) !== (next.mounting ?? null)
      || origPinCount !== nextPinCount
      || (con.keying ?? null) !== (next.keying ?? null)
    ) {
      problems.push(`connector '${id}' mismatch after round trip: ${JSON.stringify(con)} vs ${JSON.stringify(next)}`);
    }
  }

  const origPaths = byId(original.paths);
  const newPaths = byId(reassembled.paths);
  for (const [id, p] of origPaths) {
    const next = newPaths.get(id);
    if (!next) continue;
    const origKeys = p.nodes.map(refKey);
    const nextKeys = next.nodes.map(refKey);
    if (JSON.stringify(origKeys) !== JSON.stringify(nextKeys)) {
      problems.push(`path '${id}' node sequence mismatch after round trip: [${origKeys.join(' -> ')}] vs [${nextKeys.join(' -> ')}]`);
    }
    if ((p.measurements ?? []).length !== (next.measurements ?? []).length) {
      problems.push(`path '${id}' measurement count mismatch after round trip: ${p.measurements?.length ?? 0} vs ${next.measurements?.length ?? 0}`);
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Disk I/O for sheeted systems
// ---------------------------------------------------------------------------

export function writeSheetsToDisk(systemDir: string, split: SplitResult) {
  const pending: Array<{ temp: string; target: string }> = [];
  for (const [scope, sheet] of split.sheets) {
    const file = scope === null ? rootSheetFile(systemDir) : childSheetFile(systemDir, scope);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(sheet, null, 2) + '\n', 'utf-8');
    pending.push({ temp, target: file });
  }
  const signalTarget = signalsFile(systemDir);
  const signalTemp = `${signalTarget}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(signalTemp, JSON.stringify(split.signals, null, 2) + '\n', 'utf-8');
  pending.push({ temp: signalTemp, target: signalTarget });
  try {
    for (const item of pending) fs.renameSync(item.temp, item.target);
  } finally {
    for (const item of pending) {
      if (fs.existsSync(item.temp)) fs.unlinkSync(item.temp);
    }
  }
}

export function readSheetedSystem(systemDir: string): SystemData {
  return assembleSystemFromDisk(systemDir);
}

export interface SheetedWritePlan {
  split: SplitResult;
  staleSheetIds: string[];
}

/**
 * Splits `system` and verifies the split round-trips cleanly, returning the
 * work needed to persist it. Throws if the round trip fails.
 *
 * This performs no disk writes, so callers can validate a payload before taking
 * a history snapshot or bumping the revision -- a rejected save must leave the
 * system exactly as it was rather than needing to be rolled back.
 */
export function planSheetedWrite(systemDir: string, system: SystemData): SheetedWritePlan {
  const sheetEnclosureIds = discoverSheetEnclosureIds(systemDir);
  const liveEnclosureIds = new Set(system.hierarchy.map((enclosure) => enclosure.id));
  const staleSheetIds = [...sheetEnclosureIds].filter((id) => !liveEnclosureIds.has(id));
  for (const staleId of staleSheetIds) sheetEnclosureIds.delete(staleId);
  const split = splitSystem(system, sheetEnclosureIds);
  const problems = verifyRoundTrip(system, split, sheetEnclosureIds);
  if (problems.length > 0) {
    throw new Error(`Refusing to save: sheet split failed its round-trip check:\n${problems.join('\n')}`);
  }
  return { split, staleSheetIds };
}

/** Writes an already-verified plan from `planSheetedWrite` to `systemDir`. */
export function commitSheetedWrite(systemDir: string, plan: SheetedWritePlan) {
  writeSheetsToDisk(systemDir, plan.split);
  for (const staleId of plan.staleSheetIds) {
    const file = childSheetFile(systemDir, staleId);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

/**
 * Splits `system`, verifies the split round-trips cleanly, and writes it to
 * `systemDir`. Throws (without touching disk) if the round trip fails.
 */
export function writeSheetedSystem(systemDir: string, system: SystemData) {
  commitSheetedWrite(systemDir, planSheetedWrite(systemDir, system));
}
