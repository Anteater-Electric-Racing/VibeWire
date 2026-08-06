/**
 * Hierarchical per-sheet harness storage.
 *
 * A "sheeted" harness lives in a directory (instead of one flat JSON file):
 *
 *   public/user-data/harnesses/<name>/
 *     root.json              -- the root/car-level sheet (sheet_enclosure_id: null)
 *     signals.json           -- flat array of Signal, shared across every sheet
 *     sheets/<enc_id>.json   -- one sheet per enclosure that has been split out
 *
 * A sheet only describes its own interior: enclosures/connectors/mergePoints/paths
 * that are directly owned by it, plus `ports[]` declaring where its own wiring
 * reaches into a *direct* child enclosure's sheet. An enclosure "has its own sheet"
 * purely by the presence of `sheets/<enc_id>.json` on disk -- any enclosure without
 * that file is simply inlined in its owning ancestor's sheet. This makes the split
 * fully recursive/opt-in with no fixed depth limit.
 *
 * A `BulkheadPort` (declared on the *parent* sheet) represents "a wire from this
 * sheet that terminates inside a specific child sheet." Paths on the parent sheet
 * that reach into a child terminate at a `port` node instead of an ordinary
 * `connector`/`merge` node. On load, `assembleFromSheetMap` synthesizes a
 * `derived: true` Connector or MergePoint inside the child's scope from each port,
 * and rewrites the parent's `port` node into an ordinary node -- so by the time the
 * data reaches the rest of the app it is one ordinary flat `HarnessData`, exactly
 * as before. On save, `splitHarness` does the inverse.
 *
 * Known limitation: crossing more than one sheet boundary in a single path, or
 * crossing into a sheet that is not a *direct* child of the referencing sheet
 * (i.e. chained/multi-level derivation), is not implemented yet -- `splitHarness`
 * throws a clear error rather than silently mis-splitting. Today's data is only
 * ever two sheet-levels deep (root -> top-level container), so this never triggers.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface Enclosure {
  id: string;
  name: string;
  parent: string | null;
  container: boolean;
  tags: string[];
  properties: Record<string, string>;
}

export interface Connector {
  id: string;
  name: string;
  parent: string | null;
  connector_type: string;
  /** Selected family housing capacity, or an optional fixed-type override. */
  pin_count?: number;
  /** Optional mechanical key selected for a family housing. */
  keying?: string;
  tags: string[];
  properties: Record<string, string>;
  derived?: boolean;
  derived_from_port?: string;
}

export interface MergePoint {
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

export interface MergePointPathNode {
  kind: 'merge';
  merge_point_id: string;
}

/** On-disk-only node kind: a reference to a `BulkheadPort` declared in this same sheet file. */
export interface PortPathNode {
  kind: 'port';
  port_id: string;
  pin_number?: number;
}

/** Runtime/assembled node shape -- identical to the historical flat schema. */
export type PathNode = ConnectorPathNode | MergePointPathNode;
/** On-disk sheet node shape -- may additionally reference a local port. */
export type SheetPathNode = ConnectorPathNode | MergePointPathNode | PortPathNode;

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

export interface BulkheadPort {
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
  entity_kind: 'connector' | 'merge';
  connector_id?: string;
  connector_type?: string;
  /** Instance cavity override copied from the derived connector when present. */
  pin_count?: number;
  /** Mechanical key copied from the derived connector when present. */
  keying?: string;
  merge_point_id?: string;
  tags: string[];
  properties: Record<string, string>;
}

export interface HarnessSheet {
  schema_version: string;
  /** Present on root.json only; this is a display name, not the directory key. */
  name?: string;
  sheet_enclosure_id: string | null;
  enclosures: Enclosure[];
  connectors: Connector[];
  mergePoints: MergePoint[];
  paths: SheetPath[];
  ports: BulkheadPort[];
  /** Root-sheet-only schema for structured signal properties. */
  signalPropertyDefinitions?: SignalPropertyDefinition[];
}

export interface HarnessData {
  schema_version: string;
  name?: string;
  enclosures: Enclosure[];
  connectors: Connector[];
  mergePoints: MergePoint[];
  paths: PathEntity[];
  signals: Signal[];
  signalPropertyDefinitions: SignalPropertyDefinition[];
}

const SHEET_SCHEMA_VERSION = '0.2.0-sheets';

function emptySheet(sheetEnclosureId: string | null): HarnessSheet {
  return {
    schema_version: SHEET_SCHEMA_VERSION,
    sheet_enclosure_id: sheetEnclosureId,
    enclosures: [],
    connectors: [],
    mergePoints: [],
    paths: [],
    ports: [],
  };
}

function normalizeSheet(raw: unknown, sheetEnclosureId: string | null): HarnessSheet {
  const sheet = emptySheet(sheetEnclosureId);
  if (!raw || typeof raw !== 'object') return sheet;
  const record = raw as Record<string, unknown>;
  if (sheetEnclosureId === null && typeof record.name === 'string' && record.name.trim()) {
    sheet.name = record.name.trim();
  }
  sheet.enclosures = Array.isArray(record.enclosures) ? (record.enclosures as Enclosure[]) : [];
  sheet.connectors = Array.isArray(record.connectors) ? (record.connectors as Connector[]) : [];
  sheet.mergePoints = Array.isArray(record.mergePoints) ? (record.mergePoints as MergePoint[]) : [];
  sheet.paths = Array.isArray(record.paths) ? (record.paths as SheetPath[]) : [];
  sheet.ports = Array.isArray(record.ports) ? (record.ports as BulkheadPort[]) : [];
  if (sheetEnclosureId === null) {
    sheet.signalPropertyDefinitions = Array.isArray(record.signalPropertyDefinitions)
      ? (record.signalPropertyDefinitions as SignalPropertyDefinition[])
      : [];
  }
  return sheet;
}

// ---------------------------------------------------------------------------
// Directory / harness-kind helpers
// ---------------------------------------------------------------------------

export function harnessesDir(projectRoot: string): string {
  return path.join(projectRoot, 'public', 'user-data', 'harnesses');
}

export function flatHarnessFile(projectRoot: string, name: string): string {
  return path.join(harnessesDir(projectRoot), `${name}.json`);
}

export function sheetHarnessDir(projectRoot: string, name: string): string {
  return path.join(harnessesDir(projectRoot), name);
}

function rootSheetFile(harnessDir: string): string {
  return path.join(harnessDir, 'root.json');
}

function signalsFile(harnessDir: string): string {
  return path.join(harnessDir, 'signals.json');
}

function childSheetFile(harnessDir: string, enclosureId: string): string {
  return path.join(harnessDir, 'sheets', `${enclosureId}.json`);
}

export function isSheetedHarness(projectRoot: string, name: string): boolean {
  return fs.existsSync(rootSheetFile(sheetHarnessDir(projectRoot, name)));
}

function readJSON<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/** Enclosure ids that currently have their own sheet file on disk. */
export function discoverSheetEnclosureIds(harnessDir: string): Set<string> {
  const dir = path.join(harnessDir, 'sheets');
  if (!fs.existsSync(dir)) return new Set();
  return new Set(
    fs.readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.slice(0, -'.json'.length)),
  );
}

// ---------------------------------------------------------------------------
// Assembler: many sheet files -> one flat HarnessData
// ---------------------------------------------------------------------------

type SheetLoader = (sheetEnclosureId: string | null) => HarnessSheet;

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
 * boundary have local content of their own (see `splitHarness`'s "common===scopeA"
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
): HarnessData {
  const enclosures: Enclosure[] = [];
  const connectors: Connector[] = [];
  const mergePoints: MergePoint[] = [];
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
    if (node.kind !== 'port') return node;
    if (connectorIdByPort.has(node.port_id)) {
      // Some harnesses (e.g. fsae-car.json) genuinely omit pin_number on many
      // connector nodes -- preserve that as-is rather than defaulting it, so the
      // resulting node's refKey still matches its counterpart in another sheet
      // fragment when stitching multi-fragment paths back together.
      return { kind: 'connector', connector_id: connectorIdByPort.get(node.port_id)!, pin_number: node.pin_number as number };
    }
    if (mergeIdByPort.has(node.port_id)) {
      return { kind: 'merge', merge_point_id: mergeIdByPort.get(node.port_id)! };
    }
    throw new Error(`Path '${pathId}' references unknown port '${node.port_id}'`);
  }

  function processSheet(sheetEnclosureId: string | null) {
    const sheet = loadSheet(sheetEnclosureId);
    if (sheetEnclosureId === null) {
      systemName = sheet.name;
      signalPropertyDefinitions = sheet.signalPropertyDefinitions ?? [];
    }

    for (const enc of sheet.enclosures) {
      registerId('enclosure', enc.id);
      enclosures.push(enc);
    }
    for (const con of sheet.connectors) {
      registerId('connector', con.id);
      connectors.push(con);
    }
    for (const mp of sheet.mergePoints) {
      registerId('mergePoint', mp.id);
      mergePoints.push(mp);
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
          ...(port.pin_count != null ? { pin_count: port.pin_count } : {}),
          ...(port.keying ? { keying: port.keying } : {}),
          tags: port.tags ?? [],
          properties: port.properties ?? {},
          derived: true,
          derived_from_port: port.id,
        });
      } else {
        if (!port.merge_point_id) throw new Error(`Port '${port.id}' has entity_kind 'merge' but no merge_point_id`);
        registerId('mergePoint (derived)', port.merge_point_id);
        mergeIdByPort.set(port.id, port.merge_point_id);
        mergePoints.push({
          id: port.merge_point_id,
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

    for (const child of sheet.enclosures) {
      if (sheetEnclosureIds.has(child.id)) processSheet(child.id);
    }
  }

  processSheet(null);

  const paths = [...pathFragmentsById.entries()].map(([id, fragments]) => stitchPathFragments(id, fragments));

  return {
    schema_version: SHEET_SCHEMA_VERSION,
    ...(systemName ? { name: systemName } : {}),
    enclosures,
    connectors,
    mergePoints,
    paths,
    signals,
    signalPropertyDefinitions,
  };
}

export function assembleHarnessFromDisk(harnessDir: string): HarnessData {
  const sheetEnclosureIds = discoverSheetEnclosureIds(harnessDir);
  const signals = fs.existsSync(signalsFile(harnessDir)) ? readJSON<Signal[]>(signalsFile(harnessDir)) : [];
  const loadSheet: SheetLoader = (sheetEnclosureId) => {
    const file = sheetEnclosureId === null ? rootSheetFile(harnessDir) : childSheetFile(harnessDir, sheetEnclosureId);
    return normalizeSheet(readJSON<unknown>(file), sheetEnclosureId);
  };
  return assembleFromLoader(loadSheet, sheetEnclosureIds, signals);
}

function assembleFromSheetMap(
  sheets: Map<string | null, HarnessSheet>,
  sheetEnclosureIds: Set<string>,
  signals: Signal[],
): HarnessData {
  const loadSheet: SheetLoader = (sheetEnclosureId) => sheets.get(sheetEnclosureId) ?? emptySheet(sheetEnclosureId);
  return assembleFromLoader(loadSheet, sheetEnclosureIds, signals);
}

// ---------------------------------------------------------------------------
// Splitter: one flat HarnessData -> many sheet files
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
  return node.kind === 'connector' ? `c:${node.connector_id}:${node.pin_number}` : `m:${node.merge_point_id}`;
}

/** Strips the `derived`/`derived_from_port` bookkeeping fields before writing a plain entity to disk. */
function omitDerivedFields<T extends { derived?: boolean; derived_from_port?: string }>(entity: T): Omit<T, 'derived' | 'derived_from_port'> {
  const clean: Partial<T> = { ...entity };
  delete clean.derived;
  delete clean.derived_from_port;
  return clean as Omit<T, 'derived' | 'derived_from_port'>;
}

export interface SplitResult {
  sheets: Map<string | null, HarnessSheet>;
  signals: Signal[];
}

export function splitHarness(harness: HarnessData, sheetEnclosureIds: Set<string>): SplitResult {
  const enclosureById = new Map(harness.enclosures.map((e) => [e.id, e]));
  const connectorById = new Map(harness.connectors.map((c) => [c.id, c]));
  const mergePointById = new Map(harness.mergePoints.map((m) => [m.id, m]));

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
    const mp = mergePointById.get(node.merge_point_id);
    if (!mp) throw new Error(`Path references missing merge point '${node.merge_point_id}'`);
    return ownerScopeOfParent(mp.parent);
  }

  function toLocalNode(node: PathNode): SheetPathNode {
    return node.kind === 'connector'
      ? { kind: 'connector', connector_id: node.connector_id, pin_number: node.pin_number }
      : { kind: 'merge', merge_point_id: node.merge_point_id };
  }

  const sheets = new Map<string | null, HarnessSheet>();
  function getSheet(scope: string | null): HarnessSheet {
    if (!sheets.has(scope)) sheets.set(scope, emptySheet(scope));
    return sheets.get(scope)!;
  }
  getSheet(null);
  if (harness.name) getSheet(null).name = harness.name;
  getSheet(null).signalPropertyDefinitions = harness.signalPropertyDefinitions ?? [];
  for (const id of sheetEnclosureIds) getSheet(id);

  const derivedConnectorIds = new Set<string>();
  const derivedMergePointIds = new Set<string>();

  function registerPort(
    declaringScope: string | null,
    targetChildScope: string,
    node: PathNode,
  ): string {
    const sheet = getSheet(declaringScope);
    const entityId = node.kind === 'connector' ? node.connector_id : node.merge_point_id;
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
          ...(con.pin_count != null ? { pin_count: con.pin_count } : {}),
          ...(con.keying ? { keying: con.keying } : {}),
          tags: con.tags,
          properties: con.properties,
        };
        derivedConnectorIds.add(con.id);
      } else {
        const mp = mergePointById.get(node.merge_point_id)!;
        if (mp.parent === null) throw new Error(`Merge point '${mp.id}' has no parent but is used across a sheet boundary into '${targetChildScope}'`);
        port = {
          id: portId,
          name: mp.name,
          target_child_id: targetChildScope,
          entity_parent: mp.parent,
          entity_kind: 'merge',
          merge_point_id: mp.id,
          tags: mp.tags,
          properties: mp.properties,
        };
        derivedMergePointIds.add(mp.id);
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
  for (const enc of harness.enclosures) {
    const scope = ownerScopeOfParent(enc.parent);
    getSheet(scope).enclosures.push({ ...enc });
  }

  // --- merge points (plain placement; may later be excluded if derived) ---
  for (const mp of harness.mergePoints) {
    const scope = ownerScopeOfParent(mp.parent);
    getSheet(scope).mergePoints.push(omitDerivedFields(mp));
  }

  // --- paths (the hard part) ---
  for (const p of harness.paths) {
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
        if (node.kind === 'merge') {
          throw new Error(`Path '${p.id}' cannot cross a sheet boundary at merge point '${node.merge_point_id}'.`);
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
          if (node.kind === 'merge') throw new Error(`Path '${p.id}' crosses a sheet boundary at a merge point inside a multi-hop chain -- not supported yet.`);
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
  for (const con of harness.connectors) {
    if (derivedConnectorIds.has(con.id)) continue;
    const scope = ownerScopeOfParent(con.parent);
    getSheet(scope).connectors.push(omitDerivedFields(con));
  }

  // --- drop merge points that ended up derived from a port ---
  if (derivedMergePointIds.size > 0) {
    for (const sheet of sheets.values()) {
      sheet.mergePoints = sheet.mergePoints.filter((mp) => !derivedMergePointIds.has(mp.id));
    }
  }

  return { sheets, signals: harness.signals };
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
export function verifyRoundTrip(original: HarnessData, split: SplitResult, sheetEnclosureIds: Set<string>): string[] {
  const problems: string[] = [];
  let reassembled: HarnessData;
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
  compareIdSets('enclosures', original.enclosures, reassembled.enclosures);
  compareIdSets('connectors', original.connectors, reassembled.connectors);
  compareIdSets('mergePoints', original.mergePoints, reassembled.mergePoints);
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
// Disk I/O for sheeted harnesses
// ---------------------------------------------------------------------------

export function writeSheetsToDisk(harnessDir: string, split: SplitResult) {
  const pending: Array<{ temp: string; target: string }> = [];
  for (const [scope, sheet] of split.sheets) {
    const file = scope === null ? rootSheetFile(harnessDir) : childSheetFile(harnessDir, scope);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(sheet, null, 2) + '\n', 'utf-8');
    pending.push({ temp, target: file });
  }
  const signalTarget = signalsFile(harnessDir);
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

export function readSheetedHarness(harnessDir: string): HarnessData {
  return assembleHarnessFromDisk(harnessDir);
}

export interface SheetedWritePlan {
  split: SplitResult;
  staleSheetIds: string[];
}

/**
 * Splits `harness` and verifies the split round-trips cleanly, returning the
 * work needed to persist it. Throws if the round trip fails.
 *
 * This performs no disk writes, so callers can validate a payload before taking
 * a history snapshot or bumping the revision -- a rejected save must leave the
 * harness exactly as it was rather than needing to be rolled back.
 */
export function planSheetedWrite(harnessDir: string, harness: HarnessData): SheetedWritePlan {
  const sheetEnclosureIds = discoverSheetEnclosureIds(harnessDir);
  const liveEnclosureIds = new Set(harness.enclosures.map((enclosure) => enclosure.id));
  const staleSheetIds = [...sheetEnclosureIds].filter((id) => !liveEnclosureIds.has(id));
  for (const staleId of staleSheetIds) sheetEnclosureIds.delete(staleId);
  const split = splitHarness(harness, sheetEnclosureIds);
  const problems = verifyRoundTrip(harness, split, sheetEnclosureIds);
  if (problems.length > 0) {
    throw new Error(`Refusing to save: sheet split failed its round-trip check:\n${problems.join('\n')}`);
  }
  return { split, staleSheetIds };
}

/** Writes an already-verified plan from `planSheetedWrite` to `harnessDir`. */
export function commitSheetedWrite(harnessDir: string, plan: SheetedWritePlan) {
  writeSheetsToDisk(harnessDir, plan.split);
  for (const staleId of plan.staleSheetIds) {
    const file = childSheetFile(harnessDir, staleId);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

/**
 * Splits `harness`, verifies the split round-trips cleanly, and writes it to
 * `harnessDir`. Throws (without touching disk) if the round trip fails.
 */
export function writeSheetedHarness(harnessDir: string, harness: HarnessData) {
  commitSheetedWrite(harnessDir, planSheetedWrite(harnessDir, harness));
}
