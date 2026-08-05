import type {
  Connector,
  ConnectorLibrary,
  ConnectorPathNode,
  ConnectorType,
  HarnessData,
  ManufacturingDocument,
  ManufacturingStep,
  Path,
  PathNode,
} from '../types';
import {
  getPathNodeLabel,
  getPathNodeRefKey,
  getPathSegmentMeasurement,
  getPathSignalId,
  getPathSignalName,
} from './harness';
import {
  getConnectorCavityVariant,
  getEffectivePinCount,
} from './connectorFamily';

export const MANUFACTURING_STEPS: ReadonlyArray<{
  id: ManufacturingStep;
  label: string;
}> = [
  { id: 'ordered', label: 'Ordered' },
  { id: 'cut', label: 'Cut' },
  { id: 'crimped', label: 'Crimped' },
  { id: 'populated', label: 'Populated' },
  { id: 'qc', label: "QC'd" },
  { id: 'installed', label: 'Installed' },
];

export const EMPTY_MANUFACTURING_DOCUMENT: ManufacturingDocument = {
  schema_version: '1.1.0',
  bundles: {},
};

export interface ManufacturingEndpoint {
  kind: 'connector' | 'merge';
  label: string;
  connectorId?: string;
  connectorName?: string;
  mergePointId?: string;
  pinNumber?: number;
  familyId?: string;
  familyName?: string;
  pinCount?: number;
  terminalGender?: 'male' | 'female';
  housingPartNumber?: string;
  maleCrimpPartNumber?: string;
  femaleCrimpPartNumber?: string;
  crimpPartNumber?: string;
  crimpGauge?: string;
}

export interface ManufacturingSpliceNote {
  id: string;
  label: string;
}

/** One physical run between consecutive path nodes (connector↔splice or connector↔connector). */
export interface ManufacturingLengthHop {
  segmentIndex: number;
  fromLabel: string;
  toLabel: string;
  fromKind: 'connector' | 'merge';
  toKind: 'connector' | 'merge';
  lengthMm?: number;
}

export interface ManufacturingWire {
  id: string;
  pathId: string;
  pathName: string;
  /** First hop index used when editing a single-segment cut length. */
  segmentIndex: number;
  /** Inclusive node indexes on `pathId` spanning this cut (connector→…→connector). */
  fromNodeIndex: number;
  toNodeIndex: number;
  wireId: string;
  signalId: string | null;
  signalName: string;
  color: string;
  colorInferred: boolean;
  gauge: string;
  gaugeInferred: boolean;
  /** Total cut length: sum of hop runs when all hops are known. */
  lengthMm?: number;
  lengthLabel?: string;
  /** Per-run lengths between consecutive connectors/splices along the cut. */
  hops: ManufacturingLengthHop[];
  from: ManufacturingEndpoint;
  to: ManufacturingEndpoint;
  /** Intermediate splices between the connector endpoints. */
  viaSplices: ManufacturingSpliceNote[];
  /** When true, only `from` is a physical crimp end (stub joined through a splice). */
  fromCrimpOnly: boolean;
  issues: string[];
}

export interface ManufacturingBundle {
  id: string;
  name: string;
  tagged: boolean;
  wires: ManufacturingWire[];
  connectorIds: string[];
  knownLengthMm: number;
  missingLengthCount: number;
  issueCount: number;
}

export type BomCategory = 'Wire' | 'Housing' | 'Crimp';

export interface ManufacturingBomRow {
  id: string;
  category: BomCategory;
  description: string;
  partNumber: string;
  color: string;
  quantity: number;
  unit: 'm' | 'ea';
  notes: string;
}

function clean(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function connectorTypeFor(
  connector: Connector,
  typeById: ReadonlyMap<string, ConnectorType>,
): ConnectorType | undefined {
  return typeById.get(connector.connector_type);
}

function crimpForGender(
  endpoint: ManufacturingEndpoint,
  gender: 'male' | 'female' | undefined,
): string | undefined {
  if (gender === 'male') return endpoint.maleCrimpPartNumber;
  if (gender === 'female') return endpoint.femaleCrimpPartNumber;
  return undefined;
}

function resolveEndpoint(
  harness: HarnessData,
  node: PathNode,
  typeById: ReadonlyMap<string, ConnectorType>,
): ManufacturingEndpoint {
  const label = getPathNodeLabel(harness, node);
  if (node.kind === 'merge') {
    return { kind: 'merge', label, mergePointId: node.merge_point_id };
  }

  const connector = harness.connectors.find((candidate) => candidate.id === node.connector_id);
  if (!connector) {
    return {
      kind: 'connector',
      label,
      connectorId: node.connector_id,
      pinNumber: node.pin_number,
    };
  }

  const type = connectorTypeFor(connector, typeById);
  const variant = getConnectorCavityVariant(connector, type);
  return {
    kind: 'connector',
    label,
    connectorId: connector.id,
    connectorName: connector.name,
    pinNumber: node.pin_number,
    familyId: type?.id ?? connector.connector_type,
    familyName: type?.name ?? connector.connector_type,
    pinCount: getEffectivePinCount(connector, type),
    housingPartNumber:
      clean(connector.properties.housing_part_number)
      ?? clean(connector.properties.part_number)
      ?? clean(variant?.housing_part_number),
    maleCrimpPartNumber:
      clean(type?.male_crimp_part_number) ?? clean(type?.crimp_spec),
    femaleCrimpPartNumber:
      clean(type?.female_crimp_part_number) ?? clean(type?.crimp_spec),
    crimpGauge: clean(type?.wire_gauge),
  };
}

function inferGauge(
  explicitGauge: string | undefined,
  from: ManufacturingEndpoint,
  to: ManufacturingEndpoint,
): { gauge: string; inferred: boolean } {
  const explicit = clean(explicitGauge);
  if (explicit) return { gauge: explicit, inferred: false };
  const ranges = Array.from(new Set(
    [from.crimpGauge, to.crimpGauge].map(clean).filter(Boolean) as string[],
  ));
  return {
    gauge: ranges.join(' / '),
    inferred: ranges.length > 0,
  };
}

function endpointNeedsGender(endpoint: ManufacturingEndpoint): boolean {
  return (
    endpoint.kind === 'connector'
    && !endpoint.terminalGender
    && !!(endpoint.maleCrimpPartNumber || endpoint.femaleCrimpPartNumber)
  );
}

function applyEndpointGender(
  endpoint: ManufacturingEndpoint,
  document: ManufacturingDocument | undefined,
  bundleId: string,
): ManufacturingEndpoint {
  if (!endpoint.connectorId) return endpoint;
  const terminalGender = document?.bundles[bundleId]?.endpoint_genders?.[endpoint.connectorId];
  return {
    ...endpoint,
    terminalGender,
    crimpPartNumber: crimpForGender(endpoint, terminalGender),
  };
}

function resolveWireColor(
  path: Path,
  harness: HarnessData,
): { color: string; inferred: boolean } {
  const explicit = clean(path.properties.wire_color ?? path.properties.color);
  if (explicit) return { color: explicit, inferred: false };
  const signalId = getPathSignalId(path);
  const preferred = clean(
    harness.signals.find((signal) => signal.id === signalId)
      ?.properties.preferred_wire_color,
  );
  return { color: preferred ?? '', inferred: !!preferred };
}

function bundleTag(tags: string[]): string | undefined {
  return tags.find((tag) => tag.startsWith('bundle:') && tag.length > 'bundle:'.length);
}

function endpointDisplayName(endpoint: ManufacturingEndpoint): string {
  return endpoint.connectorName ?? endpoint.label.replace(/-\d+$/, '');
}

function fallbackBundleName(
  from: ManufacturingEndpoint,
  to: ManufacturingEndpoint,
): string {
  return `${endpointDisplayName(from)} ↔ ${endpointDisplayName(to)}`;
}

function connectorStops(path: Path): Array<{ node: ConnectorPathNode; index: number }> {
  return path.nodes.flatMap((node, index) =>
    node.kind === 'connector' ? [{ node, index }] : [],
  );
}

function spliceNotesBetween(
  harness: HarnessData,
  path: Path,
  fromIndex: number,
  toIndex: number,
): ManufacturingSpliceNote[] {
  const lo = Math.min(fromIndex, toIndex);
  const hi = Math.max(fromIndex, toIndex);
  const notes: ManufacturingSpliceNote[] = [];
  for (let index = lo + 1; index < hi; index += 1) {
    const node = path.nodes[index];
    if (node?.kind !== 'merge') continue;
    notes.push({
      id: node.merge_point_id,
      label: getPathNodeLabel(harness, node),
    });
  }
  return notes;
}

function measurementBetweenNodes(
  path: Path,
  from: PathNode,
  to: PathNode,
): number | undefined {
  const fromKey = getPathNodeRefKey(from);
  const toKey = getPathNodeRefKey(to);
  return path.measurements.find((measurement) => {
    const measurementFromKey = getPathNodeRefKey(measurement.from);
    const measurementToKey = getPathNodeRefKey(measurement.to);
    return (
      (measurementFromKey === fromKey && measurementToKey === toKey)
      || (measurementFromKey === toKey && measurementToKey === fromKey)
    );
  })?.length_mm;
}

function buildLengthHops(
  harness: HarnessData,
  path: Path,
  fromIndex: number,
  toIndex: number,
): ManufacturingLengthHop[] {
  const lo = Math.min(fromIndex, toIndex);
  const hi = Math.max(fromIndex, toIndex);
  const hops: ManufacturingLengthHop[] = [];
  const segmentIndexes = Array.from({ length: hi - lo }, (_, offset) => lo + offset);
  if (fromIndex > toIndex) segmentIndexes.reverse();
  for (const index of segmentIndexes) {
    const from = path.nodes[fromIndex <= toIndex ? index : index + 1];
    const to = path.nodes[fromIndex <= toIndex ? index + 1 : index];
    if (!from || !to) continue;
    hops.push({
      segmentIndex: index,
      fromLabel: getPathNodeLabel(harness, from),
      toLabel: getPathNodeLabel(harness, to),
      fromKind: from.kind,
      toKind: to.kind,
      lengthMm: getPathSegmentMeasurement(path, index)?.length_mm,
    });
  }
  return hops;
}

function spanLengthMm(
  path: Path,
  fromIndex: number,
  toIndex: number,
  hops: ManufacturingLengthHop[],
): number | undefined {
  // Prefer the sum of each connector/splice run when every hop is known.
  if (hops.length > 0 && hops.every((hop) => hop.lengthMm !== undefined)) {
    return hops.reduce((sum, hop) => sum + (hop.lengthMm ?? 0), 0);
  }

  const from = path.nodes[fromIndex];
  const to = path.nodes[toIndex];
  if (!from || !to) return undefined;
  return measurementBetweenNodes(path, from, to);
}

/**
 * Write a total cut length onto a path span as per-hop runs (sum = total).
 * Preserves relative hop proportions when all hops already have lengths.
 */
export function applySpanTotalLength(
  path: Path,
  fromNodeIndex: number,
  toNodeIndex: number,
  lengthMm: number | undefined,
): boolean {
  const lo = Math.min(fromNodeIndex, toNodeIndex);
  const hi = Math.max(fromNodeIndex, toNodeIndex);
  const from = path.nodes[lo];
  const to = path.nodes[hi];
  if (!from || !to || hi <= lo) return false;

  const hopCount = hi - lo;
  const fromKey = getPathNodeRefKey(from);
  const toKey = getPathNodeRefKey(to);

  // Drop any end-to-end span measurement; cut length is stored as hop runs.
  const nextMeasurements = path.measurements.filter((measurement) => {
    const measurementFromKey = getPathNodeRefKey(measurement.from);
    const measurementToKey = getPathNodeRefKey(measurement.to);
    const isSpan =
      (measurementFromKey === fromKey && measurementToKey === toKey)
      || (measurementFromKey === toKey && measurementToKey === fromKey);
    return !isSpan;
  });
  let changed = nextMeasurements.length !== path.measurements.length;
  if (changed) path.measurements = nextMeasurements;

  if (hopCount === 1) {
    return setPathHopLength(path, lo, lengthMm) || changed;
  }

  if (lengthMm === undefined) {
    for (let index = lo; index < hi; index += 1) {
      changed = setPathHopLength(path, index, undefined) || changed;
    }
    return changed;
  }

  const existing: Array<number | undefined> = [];
  for (let index = lo; index < hi; index += 1) {
    existing.push(getPathSegmentMeasurement(path, index)?.length_mm);
  }
  const known = existing.filter((value): value is number => value !== undefined);
  const knownSum = known.reduce((sum, value) => sum + value, 0);

  let shares: number[];
  if (known.length === hopCount && knownSum > 0) {
    shares = existing.map((value) => ((value ?? 0) / knownSum) * lengthMm);
  } else {
    const share = lengthMm / hopCount;
    shares = Array.from({ length: hopCount }, () => share);
  }

  for (let offset = 0; offset < hopCount; offset += 1) {
    const rounded = Math.round(shares[offset] * 1000) / 1000;
    changed = setPathHopLength(path, lo + offset, rounded) || changed;
  }
  // Fix rounding drift on the last hop so the sum matches the requested total.
  let assigned = 0;
  for (let offset = 0; offset < hopCount - 1; offset += 1) {
    assigned += getPathSegmentMeasurement(path, lo + offset)?.length_mm ?? 0;
  }
  const last = Math.round((lengthMm - assigned) * 1000) / 1000;
  changed = setPathHopLength(path, hi - 1, Math.max(0, last)) || changed;
  return changed;
}

function setPathHopLength(
  path: Path,
  segmentIndex: number,
  lengthMm: number | undefined,
): boolean {
  const from = path.nodes[segmentIndex];
  const to = path.nodes[segmentIndex + 1];
  if (!from || !to) return false;

  const measurement = getPathSegmentMeasurement(path, segmentIndex);
  if (measurement?.length_mm === lengthMm) return false;
  if (measurement) {
    if (lengthMm === undefined) {
      if (measurement.note) delete measurement.length_mm;
      else path.measurements.splice(path.measurements.indexOf(measurement), 1);
    } else {
      measurement.length_mm = lengthMm;
    }
  } else if (lengthMm !== undefined) {
    path.measurements.push({
      from: structuredClone(from),
      to: structuredClone(to),
      length_mm: lengthMm,
    });
  }
  return true;
}

function connectorBundleKey(connectorIds: string[]): string {
  const sorted = [...new Set(connectorIds)].sort();
  return `bundle:connectors:${sorted.join('|')}`;
}

function componentBundleKey(from: PathNode, to: PathNode): string {
  if (from.kind === 'connector' && to.kind === 'connector') {
    return connectorBundleKey([from.connector_id, to.connector_id]);
  }
  const refs = [from, to].map((node) =>
    node.kind === 'connector'
      ? `connector:${node.connector_id}`
      : `merge:${node.merge_point_id}`
  ).sort();
  return `bundle:components:${refs.join('|')}`;
}

export function deriveManufacturingBundles(
  harness: HarnessData,
  library: ConnectorLibrary | null | undefined,
  manufacturing?: ManufacturingDocument,
): ManufacturingBundle[] {
  const typeById = new Map(
    (library?.connector_types ?? []).map((type) => [type.id, type]),
  );
  const bundles = new Map<string, ManufacturingBundle>();

  const addRun = (
    path: Path,
    fromNodeIndex: number,
    toNodeIndex: number,
    tagged: boolean,
  ) => {
    const fromNode = path.nodes[fromNodeIndex];
    const toNode = path.nodes[toNodeIndex];
    if (!fromNode || !toNode || fromNodeIndex === toNodeIndex) return;

    const id = componentBundleKey(fromNode, toNode);
    const unresolvedFrom = resolveEndpoint(harness, fromNode, typeById);
    const unresolvedTo = resolveEndpoint(harness, toNode, typeById);
    const from = applyEndpointGender(unresolvedFrom, manufacturing, id);
    const to = applyEndpointGender(unresolvedTo, manufacturing, id);
    const hops = buildLengthHops(harness, path, fromNodeIndex, toNodeIndex);
    const resolvedLengthMm = spanLengthMm(path, fromNodeIndex, toNodeIndex, hops);
    const legacyLength = path.nodes.length === 2
      ? clean(path.properties.length)
      : undefined;
    const gauge = inferGauge(path.properties.wire_gauge, from, to);
    const signalId = getPathSignalId(path);
    const color = resolveWireColor(path, harness);
    const viaSplices = spliceNotesBetween(
      harness,
      path,
      fromNodeIndex,
      toNodeIndex,
    );
    const fromCrimpOnly = to.kind === 'merge';
    const issues: string[] = [];

    if (resolvedLengthMm === undefined && !legacyLength) issues.push('Cut length missing');
    if (hops.some((hop) => hop.lengthMm === undefined) && hops.length > 1) {
      issues.push('One or more splice runs missing length');
    }
    if (!gauge.gauge) issues.push('Wire gauge missing');
    if (endpointNeedsGender(from)) {
      issues.push(`${from.connectorName ?? from.label}: contact gender missing`);
    }
    if (!fromCrimpOnly && endpointNeedsGender(to)) {
      issues.push(`${to.connectorName ?? to.label}: contact gender missing`);
    }

    const lo = Math.min(fromNodeIndex, toNodeIndex);
    const hi = Math.max(fromNodeIndex, toNodeIndex);
    const wire: ManufacturingWire = {
      id: path.nodes.length === 2 ? path.id : `${path.id}:${lo}-${hi}`,
      pathId: path.id,
      pathName: path.name,
      segmentIndex: lo,
      fromNodeIndex,
      toNodeIndex,
      wireId: clean(path.properties.wire_id) ?? path.id,
      signalId,
      signalName: getPathSignalName(path, harness) ?? '',
      color: color.color,
      colorInferred: color.inferred,
      gauge: gauge.gauge,
      gaugeInferred: gauge.inferred,
      hops,
      ...(resolvedLengthMm !== undefined
        ? { lengthMm: resolvedLengthMm }
        : legacyLength
          ? { lengthLabel: legacyLength }
          : {}),
      from,
      to,
      viaSplices,
      fromCrimpOnly,
      issues,
    };

    const connectorIds = [from.connectorId, to.connectorId]
      .filter((connectorId): connectorId is string => !!connectorId);
    const name = fallbackBundleName(from, to);
    const current = bundles.get(id) ?? {
      id,
      name,
      tagged,
      wires: [],
      connectorIds: [],
      knownLengthMm: 0,
      missingLengthCount: 0,
      issueCount: 0,
    };
    current.tagged ||= tagged;
    current.wires.push(wire);
    current.knownLengthMm += wire.lengthMm ?? 0;
    if (wire.lengthMm === undefined) current.missingLengthCount += 1;
    current.issueCount += wire.issues.length;
    for (const connectorId of connectorIds) {
      if (!current.connectorIds.includes(connectorId)) {
        current.connectorIds.push(connectorId);
      }
    }
    bundles.set(id, current);
  };

  for (const path of harness.paths) {
    const stops = connectorStops(path);
    if (stops.length === 0) continue;
    const tagged = !!bundleTag(path.tags);
    if (stops.length >= 2) {
      for (let index = 0; index < stops.length - 1; index += 1) {
        addRun(path, stops[index].index, stops[index + 1].index, tagged);
      }
      continue;
    }

    // A splice stub has no second connector. Keep the physical leg visible and
    // use its farthest splice as the work end rather than inventing a mate.
    const only = stops[0];
    const mergeIndexes = path.nodes.flatMap((node, index) =>
      node.kind === 'merge' ? [index] : [],
    );
    if (mergeIndexes.length === 0) continue;
    const farthestMergeIndex = [...mergeIndexes].sort(
      (a, b) => Math.abs(b - only.index) - Math.abs(a - only.index),
    )[0];
    addRun(path, only.index, farthestMergeIndex, tagged);
  }

  return [...bundles.values()]
    .map((bundle) => ({
      ...bundle,
      wires: [...bundle.wires].sort(
        (a, b) => a.wireId.localeCompare(b.wireId, undefined, { numeric: true })
          || a.id.localeCompare(b.id),
      ),
      connectorIds: [...bundle.connectorIds].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function addBomQuantity(
  rows: Map<string, ManufacturingBomRow & { missingLengths?: number }>,
  key: string,
  row: ManufacturingBomRow,
  quantity: number,
  missingLengths = 0,
) {
  const existing = rows.get(key);
  if (existing) {
    existing.quantity += quantity;
    existing.missingLengths = (existing.missingLengths ?? 0) + missingLengths;
    return;
  }
  rows.set(key, { ...row, quantity, missingLengths });
}

export function deriveManufacturingBom(
  harness: HarnessData,
  library: ConnectorLibrary | null | undefined,
  bundles = deriveManufacturingBundles(harness, library),
): ManufacturingBomRow[] {
  const rows = new Map<string, ManufacturingBomRow & { missingLengths?: number }>();
  const typeById = new Map(
    (library?.connector_types ?? []).map((type) => [type.id, type]),
  );

  for (const wire of bundles.flatMap((bundle) => bundle.wires)) {
    const partNumber = clean(
      harness.paths.find((path) => path.id === wire.pathId)?.properties.wire_part_number,
    ) ?? '';
    const key = `wire:${partNumber}|${wire.gauge}|${wire.color}`;
    const description = [wire.gauge || 'Unspecified gauge', wire.color, 'wire']
      .filter(Boolean)
      .join(' ');
    addBomQuantity(rows, key, {
      id: key,
      category: 'Wire',
      description,
      partNumber,
      color: wire.color,
      quantity: 0,
      unit: 'm',
      notes: '',
    }, (wire.lengthMm ?? 0) / 1000, wire.lengthMm === undefined ? 1 : 0);
  }

  for (const connector of harness.connectors) {
    const type = connectorTypeFor(connector, typeById);
    const variant = getConnectorCavityVariant(connector, type);
    const pinCount = getEffectivePinCount(connector, type);
    const partNumber =
      clean(connector.properties.housing_part_number)
      ?? clean(connector.properties.part_number)
      ?? clean(variant?.housing_part_number)
      ?? '';
    const key = `housing:${partNumber || `${connector.connector_type}:${pinCount}:${connector.keying ?? ''}`}`;
    const familyName = type?.name ?? connector.connector_type ?? 'Unknown connector';
    const description = `${familyName || 'Unknown connector'} · ${pinCount}-cavity housing`;
    addBomQuantity(rows, key, {
      id: key,
      category: 'Housing',
      description,
      partNumber,
      color: '',
      quantity: 0,
      unit: 'ea',
      notes: connector.keying ? `Keying ${connector.keying}` : '',
    }, 1);
  }

  for (const endpoint of bundles.flatMap((bundle) =>
    bundle.wires.flatMap((wire) => (
      wire.fromCrimpOnly ? [wire.from] : [wire.from, wire.to]
    )),
  )) {
    if (endpoint.kind !== 'connector') continue;
    const gender = endpoint.terminalGender
      ? `${endpoint.terminalGender} contact`
      : 'contact — gender not selected';
    const partNumber = endpoint.crimpPartNumber ?? '';
    const key = `crimp:${endpoint.familyId ?? ''}:${endpoint.terminalGender ?? 'unspecified'}:${partNumber}`;
    addBomQuantity(rows, key, {
      id: key,
      category: 'Crimp',
      description: `${endpoint.familyName ?? endpoint.familyId ?? 'Unknown connector'} · ${gender}`,
      partNumber,
      color: '',
      quantity: 0,
      unit: 'ea',
      notes: [
        endpoint.crimpGauge ? `Compatible wire: ${endpoint.crimpGauge}` : '',
        !endpoint.terminalGender && endpoint.maleCrimpPartNumber
          ? `Male PN: ${endpoint.maleCrimpPartNumber}`
          : '',
        !endpoint.terminalGender && endpoint.femaleCrimpPartNumber
          ? `Female PN: ${endpoint.femaleCrimpPartNumber}`
          : '',
      ].filter(Boolean).join(' · '),
    }, 1);
  }

  const categoryOrder: Record<BomCategory, number> = {
    Wire: 0,
    Housing: 1,
    Crimp: 2,
  };
  return [...rows.values()]
    .map(({ missingLengths, ...row }) => ({
      ...row,
      quantity: row.unit === 'm'
        ? Math.round(row.quantity * 1000) / 1000
        : row.quantity,
      notes: [
        row.notes,
        missingLengths
          ? `${missingLengths} cut${missingLengths === 1 ? '' : 's'} missing length`
          : '',
      ].filter(Boolean).join(' · '),
    }))
    .sort(
      (a, b) => categoryOrder[a.category] - categoryOrder[b.category]
        || a.description.localeCompare(b.description, undefined, { numeric: true }),
    );
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function manufacturingBomToCsv(rows: ManufacturingBomRow[]): string {
  const header = ['Category', 'Description', 'Part number', 'Color', 'Quantity', 'Unit', 'Notes'];
  const body = rows.map((row) => [
    row.category,
    row.description,
    row.partNumber,
    row.color,
    row.quantity,
    row.unit,
    row.notes,
  ]);
  return [header, ...body].map((columns) => columns.map(csvCell).join(',')).join('\r\n');
}

export function matingBundleIdsForConnector(
  bundles: ManufacturingBundle[],
  bundleId: string,
  connectorId: string,
): string[] {
  return bundles
    .filter((bundle) =>
      bundle.id !== bundleId && bundle.connectorIds.includes(connectorId)
    )
    .map((bundle) => bundle.id);
}

export function assignManufacturingEndpointGender(
  document: ManufacturingDocument,
  bundleId: string,
  connectorId: string,
  gender: 'male' | 'female' | undefined,
  mateBundleIds: string[],
): ManufacturingDocument {
  const next = structuredClone(document);
  next.schema_version = '1.1.0';
  const assignments = [
    { bundleId, gender },
    ...mateBundleIds.map((mateBundleId) => ({
      bundleId: mateBundleId,
      gender: gender === 'male'
        ? 'female' as const
        : gender === 'female'
          ? 'male' as const
          : undefined,
    })),
  ];

  for (const assignment of assignments) {
    const progress = next.bundles[assignment.bundleId] ?? { steps: {} };
    const endpointGenders = { ...(progress.endpoint_genders ?? {}) };
    if (assignment.gender) endpointGenders[connectorId] = assignment.gender;
    else delete endpointGenders[connectorId];
    if (Object.keys(endpointGenders).length > 0) {
      progress.endpoint_genders = endpointGenders;
    } else {
      delete progress.endpoint_genders;
    }
    next.bundles[assignment.bundleId] = progress;
  }
  return next;
}

export function completedManufacturingStepCount(
  document: ManufacturingDocument,
  bundleId: string,
): number {
  const steps = document.bundles[bundleId]?.steps ?? {};
  return MANUFACTURING_STEPS.filter((step) => steps[step.id]).length;
}

export function manufacturingComponentSteps(
  document: ManufacturingDocument,
  bundleId: string,
  componentKey: string,
): Partial<Record<ManufacturingStep, boolean>> {
  const progress = document.bundles[bundleId];
  return progress?.component_steps?.[componentKey] ?? progress?.steps ?? {};
}

export function completedManufacturingComponentStepCount(
  document: ManufacturingDocument,
  bundleId: string,
  componentKey: string,
): number {
  const steps = manufacturingComponentSteps(document, bundleId, componentKey);
  return MANUFACTURING_STEPS.filter((step) => steps[step.id]).length;
}
