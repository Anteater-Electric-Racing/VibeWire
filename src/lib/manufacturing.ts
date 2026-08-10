import type {
  Connector,
  ConnectorLibrary,
  ConnectorPathNode,
  ConnectorType,
  HarnessData,
  ManufacturingBundleProgress,
  ManufacturingDocument,
  ManufacturingStep,
  ManufacturingTaskUpdate,
  ManufacturingWorkAttribution,
  Path,
  PathNode,
} from '../types';
import {
  getPathNodeLabel,
  getPathNodeRefKey,
  getPathSegmentMeasurement,
  getPathSignalId,
  getPathSignalName,
  isBulkheadConnector,
  isInlineConnector,
  isInteriorToEnclosure,
} from './harness';
import {
  getConnectorCavityVariant,
  getConnectorFamilyCode,
  getConnectorHousingPartNumber,
  getEffectivePinCount,
} from './connectorFamily';
import { inferGaugeFromEnds } from './gauge';

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
  schema_version: '1.2.0',
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
  familyCode?: string;
  pinCount?: number;
  terminalGender?: 'male' | 'female';
  housingPartNumber?: string;
  maleHousingPartNumber?: string;
  femaleHousingPartNumber?: string;
  pinGuideImage?: string;
  malePinGuideImage?: string;
  femalePinGuideImage?: string;
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
  fromKey: string;
  toKey: string;
  fromLabel: string;
  toLabel: string;
  fromKind: 'connector' | 'merge';
  toKind: 'connector' | 'merge';
  lengthMm?: number;
}

/** True when two hops describe the same undirected connector/splice run. */
export function manufacturingHopsMatch(
  a: Pick<ManufacturingLengthHop, 'fromKey' | 'toKey'>,
  b: Pick<ManufacturingLengthHop, 'fromKey' | 'toKey'>,
): boolean {
  return (a.fromKey === b.fromKey && a.toKey === b.toKey)
    || (a.fromKey === b.toKey && a.toKey === b.fromKey);
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
  harnessTag?: string;
  wires: ManufacturingWire[];
  connectorIds: string[];
  knownLengthMm: number;
  missingLengthCount: number;
  issueCount: number;
}

export interface ManufacturingHarness {
  id: string;
  name: string;
  trunkBundleId: string;
  bundles: ManufacturingBundle[];
  bundleIds: string[];
  pathIds: string[];
  connectorIds: string[];
  spliceIds: string[];
  wireCount: number;
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
    familyCode: getConnectorFamilyCode(type),
    pinCount: getEffectivePinCount(connector, type),
    housingPartNumber:
      clean(connector.properties.housing_part_number)
      ?? clean(connector.properties.part_number)
      ?? clean(variant?.housing_part_number),
    maleHousingPartNumber:
      clean(connector.properties.male_housing_part_number)
      ?? clean(variant?.male_housing_part_number)
      ?? clean(variant?.housing_part_number),
    femaleHousingPartNumber:
      clean(connector.properties.female_housing_part_number)
      ?? clean(variant?.female_housing_part_number)
      ?? clean(variant?.housing_part_number),
    pinGuideImage: clean(variant?.image) ?? clean(type?.image),
    malePinGuideImage:
      clean(variant?.male_image)
      ?? clean(variant?.image)
      ?? clean(type?.male_image)
      ?? clean(type?.image),
    femalePinGuideImage:
      clean(variant?.female_image)
      ?? clean(variant?.image)
      ?? clean(type?.female_image)
      ?? clean(type?.image),
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
  return inferGaugeFromEnds(from.crimpGauge, to.crimpGauge);
}

/**
 * Path-level gauge resolution for inspector hints: explicit `wire_gauge`, else
 * the intersection of the first and last connector types' crimp ranges.
 */
export function getPathInferredGauge(
  harness: HarnessData,
  path: Path,
  library: ConnectorLibrary | null | undefined,
): { gauge: string; inferred: boolean } {
  const explicit = clean(path.properties.wire_gauge);
  if (explicit) return { gauge: explicit, inferred: false };
  const stops = path.nodes.filter((node): node is ConnectorPathNode => node.kind === 'connector');
  if (stops.length === 0) return { gauge: '', inferred: false };
  const typeById = new Map(
    (library?.connector_types ?? []).map((type) => [type.id, type]),
  );
  const first = harness.connectors.find((item) => item.id === stops[0].connector_id);
  const last = harness.connectors.find((item) => item.id === stops[stops.length - 1].connector_id);
  return inferGaugeFromEnds(
    typeById.get(first?.connector_type ?? '')?.wire_gauge,
    typeById.get(last?.connector_type ?? '')?.wire_gauge,
  );
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
    housingPartNumber: terminalGender === 'male'
      ? endpoint.maleHousingPartNumber ?? endpoint.housingPartNumber
      : terminalGender === 'female'
        ? endpoint.femaleHousingPartNumber ?? endpoint.housingPartNumber
        : endpoint.housingPartNumber,
    pinGuideImage: terminalGender === 'male'
      ? endpoint.malePinGuideImage ?? endpoint.pinGuideImage
      : terminalGender === 'female'
        ? endpoint.femalePinGuideImage ?? endpoint.pinGuideImage
        : endpoint.pinGuideImage,
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

export function manufacturingNodeKey(node: PathNode): string {
  return node.kind === 'connector'
    ? `connector:${node.connector_id}`
    : `merge:${node.merge_point_id}`;
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
      fromKey: manufacturingNodeKey(from),
      toKey: manufacturingNodeKey(to),
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
    harnessTag: string | undefined,
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
      tagged: !!harnessTag,
      ...(harnessTag ? { harnessTag } : {}),
      wires: [],
      connectorIds: [],
      knownLengthMm: 0,
      missingLengthCount: 0,
      issueCount: 0,
    };
    current.tagged ||= !!harnessTag;
    if (!current.harnessTag && harnessTag) current.harnessTag = harnessTag;
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
    const harnessTag = bundleTag(path.tags);
    if (stops.length >= 2) {
      for (let index = 0; index < stops.length - 1; index += 1) {
        addRun(path, stops[index].index, stops[index + 1].index, harnessTag);
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
    addRun(path, only.index, farthestMergeIndex, harnessTag);
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

function bundleSpliceIds(bundle: ManufacturingBundle): string[] {
  return Array.from(new Set(bundle.wires.flatMap((wire) => [
    ...(wire.from.mergePointId ? [wire.from.mergePointId] : []),
    ...(wire.to.mergePointId ? [wire.to.mergePointId] : []),
    ...wire.viaSplices.map((splice) => splice.id),
  ])));
}

/**
 * Group physical runs into operator-facing harnesses through real splices.
 * Merely sharing a connector or a label does not make two independently
 * mateable harnesses one assembly.
 */
export function deriveManufacturingHarnesses(
  bundles: ManufacturingBundle[],
): ManufacturingHarness[] {
  const parent = bundles.map((_, index) => index);
  const findRoot = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  const join = (left: number, right: number) => {
    const leftRoot = findRoot(left);
    const rightRoot = findRoot(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const spliceSets = bundles.map((bundle) => new Set(bundleSpliceIds(bundle)));

  for (let left = 0; left < bundles.length; left += 1) {
    for (let right = left + 1; right < bundles.length; right += 1) {
      const sharedSplice = [...spliceSets[left]].some((id) => spliceSets[right].has(id));
      if (sharedSplice) join(left, right);
    }
  }

  const members = new Map<number, ManufacturingBundle[]>();
  bundles.forEach((bundle, index) => {
    const root = findRoot(index);
    members.set(root, [...(members.get(root) ?? []), bundle]);
  });

  return [...members.values()].map((groupBundles) => {
    const sortedByTrunk = [...groupBundles].sort(
      (a, b) => b.wires.length - a.wires.length
        || b.knownLengthMm - a.knownLengthMm
        || a.id.localeCompare(b.id),
    );
    const trunk = sortedByTrunk[0];
    const spliceIds = Array.from(new Set(groupBundles.flatMap(bundleSpliceIds))).sort();
    const pathIds = Array.from(new Set(
      groupBundles.flatMap((bundle) => bundle.wires.map((wire) => wire.pathId)),
    )).sort();
    const connectorIds = Array.from(new Set(
      groupBundles.flatMap((bundle) => bundle.connectorIds),
    )).sort();
    const harnessTag = trunk.harnessTag
      ?? groupBundles.map((bundle) => bundle.harnessTag).find(Boolean);
    return {
      id: `harness:${trunk.id}`,
      name: harnessTag ?? trunk.name,
      trunkBundleId: trunk.id,
      bundles: groupBundles,
      bundleIds: groupBundles.map((bundle) => bundle.id).sort(),
      pathIds,
      connectorIds,
      spliceIds,
      wireCount: groupBundles.reduce((sum, bundle) => sum + bundle.wires.length, 0),
      knownLengthMm: groupBundles.reduce((sum, bundle) => sum + bundle.knownLengthMm, 0),
      missingLengthCount: groupBundles.reduce(
        (sum, bundle) => sum + bundle.missingLengthCount,
        0,
      ),
      issueCount: groupBundles.reduce((sum, bundle) => sum + bundle.issueCount, 0),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
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
    const endpointGenders = bundles
      .filter((bundle) => bundle.connectorIds.includes(connector.id))
      .map((bundle) =>
        bundle.wires
          .flatMap((wire) => [wire.from, wire.to])
          .find((endpoint) => endpoint.connectorId === connector.id)?.terminalGender
      );
    const housingGenders: Array<'male' | 'female' | undefined> =
      isInlineConnector(harness, connector)
        ? [...endpointGenders.slice(0, 2), ...Array(Math.max(0, 2 - endpointGenders.length)).fill(undefined)]
        : [endpointGenders[0]];
    for (const terminalGender of housingGenders) {
      const partNumber =
        clean(connector.properties.housing_part_number)
        ?? clean(connector.properties.part_number)
        ?? clean(getConnectorHousingPartNumber(connector, type, terminalGender))
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
        notes: [
          connector.keying ? `Keying ${connector.keying}` : '',
          isInlineConnector(harness, connector) ? 'Inline mating interface' : '',
        ].filter(Boolean).join(' · '),
      }, 1);
    }
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

export type ManufacturingConnectorPhysicalSide = 'internal' | 'external' | 'mixed';

export interface ManufacturingGenderBundleRelationship {
  physicalSide?: ManufacturingConnectorPhysicalSide;
  assignable: boolean;
  sameSideBundleIds: string[];
  mateBundleIds: string[];
}

function manufacturingBundleBulkheadSide(
  harness: HarnessData,
  bundle: ManufacturingBundle,
  connectorId: string,
): ManufacturingConnectorPhysicalSide | undefined {
  const connector = harness.connectors.find((item) => item.id === connectorId);
  if (!connector?.parent || !isBulkheadConnector(harness, connectorId)) return undefined;
  const sides = new Set<'internal' | 'external'>();

  for (const wire of bundle.wires) {
    const selectedNodeIndex = wire.from.connectorId === connectorId
      ? wire.fromNodeIndex
      : wire.to.connectorId === connectorId
        ? wire.toNodeIndex
        : undefined;
    const otherNodeIndex = wire.from.connectorId === connectorId
      ? wire.toNodeIndex
      : wire.to.connectorId === connectorId
        ? wire.fromNodeIndex
        : undefined;
    if (selectedNodeIndex === undefined || otherNodeIndex === undefined) continue;
    const direction = Math.sign(otherNodeIndex - selectedNodeIndex);
    const path = harness.paths.find((item) => item.id === wire.pathId);
    const neighbor = direction ? path?.nodes[selectedNodeIndex + direction] : undefined;
    if (!neighbor) continue;
    sides.add(
      isInteriorToEnclosure(harness, neighbor, connector.parent)
        ? 'internal'
        : 'external',
    );
  }

  if (sides.size > 1) return 'mixed';
  return [...sides][0];
}

/**
 * Resolve bundle relationships at a connector. Bulkhead bundles on the same
 * physical side share a contact gender; bundles across the wall get the
 * opposite. Non-bulkhead connectors retain the legacy one-bundle-per-side
 * behavior.
 */
export function manufacturingGenderBundleRelationship(
  harness: HarnessData,
  bundles: ManufacturingBundle[],
  bundleId: string,
  connectorId: string,
): ManufacturingGenderBundleRelationship {
  const owner = bundles.find((bundle) => bundle.id === bundleId);
  const otherBundles = bundles.filter((bundle) =>
    bundle.id !== bundleId && bundle.connectorIds.includes(connectorId)
  );
  if (!owner || !isBulkheadConnector(harness, connectorId)) {
    return {
      assignable: true,
      sameSideBundleIds: [],
      mateBundleIds: otherBundles.map((bundle) => bundle.id),
    };
  }

  const physicalSide = manufacturingBundleBulkheadSide(harness, owner, connectorId);
  if (physicalSide !== 'internal' && physicalSide !== 'external') {
    return {
      physicalSide,
      assignable: false,
      sameSideBundleIds: [],
      mateBundleIds: [],
    };
  }

  const sameSideBundleIds: string[] = [];
  const mateBundleIds: string[] = [];
  for (const bundle of otherBundles) {
    const otherSide = manufacturingBundleBulkheadSide(harness, bundle, connectorId);
    if (otherSide === physicalSide) {
      sameSideBundleIds.push(bundle.id);
    } else if (otherSide === 'internal' || otherSide === 'external') {
      mateBundleIds.push(bundle.id);
    }
  }
  return {
    physicalSide,
    assignable: true,
    sameSideBundleIds,
    mateBundleIds,
  };
}

export function assignManufacturingEndpointGender(
  document: ManufacturingDocument,
  bundleId: string,
  connectorId: string,
  gender: 'male' | 'female' | undefined,
  mateBundleIds: string[],
  sameSideBundleIds: string[] = [],
): ManufacturingDocument {
  const next = structuredClone(document);
  next.schema_version = '1.2.0';
  const sameSideIds = [...new Set(sameSideBundleIds)]
    .filter((sameSideBundleId) => sameSideBundleId !== bundleId);
  const sameSideIdSet = new Set(sameSideIds);
  const assignments = [
    { bundleId, gender },
    ...sameSideIds.map((sameSideBundleId) => ({
      bundleId: sameSideBundleId,
      gender,
    })),
    ...[...new Set(mateBundleIds)]
      .filter((mateBundleId) =>
        mateBundleId !== bundleId && !sameSideIdSet.has(mateBundleId)
      )
      .map((mateBundleId) => ({
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

export function manufacturingTaskKey(update: ManufacturingTaskUpdate): string {
  switch (update.kind) {
    case 'wire-cut':
      return `wire:${update.wireId}:cut`;
    case 'wire-end':
      return `wire:${update.wireId}:end:${update.end}`;
    case 'splice-measured':
      return `splice:${update.spliceId}:measured`;
    case 'connector-guide':
      return `connector:${update.connectorId}:guide`;
  }
}

export function manufacturingTaskCompleted(
  progress: ManufacturingBundleProgress | undefined,
  update: ManufacturingTaskUpdate,
): boolean {
  if (!progress) return false;
  switch (update.kind) {
    case 'wire-cut':
      return !!progress.wire_progress?.[update.wireId]?.cut;
    case 'wire-end':
      return !!progress.wire_progress?.[update.wireId]?.ends?.[update.end];
    case 'splice-measured':
      return !!progress.splice_measured?.[update.spliceId];
    case 'connector-guide':
      return !!progress.connector_guide_states?.[update.connectorId];
  }
}

function setComponentStep(
  progress: ManufacturingBundleProgress,
  componentKey: string,
  step: ManufacturingStep,
  completed: boolean,
) {
  const stepIndex = MANUFACTURING_STEPS.findIndex((candidate) => candidate.id === step);
  if (stepIndex < 0) return;
  const componentSteps = {
    ...(progress.component_steps?.[componentKey] ?? {}),
  };
  for (let index = 0; index < MANUFACTURING_STEPS.length; index += 1) {
    const candidate = MANUFACTURING_STEPS[index].id;
    if (completed && index <= stepIndex) componentSteps[candidate] = true;
    if (!completed && index >= stepIndex) delete componentSteps[candidate];
  }
  progress.component_steps = {
    ...(progress.component_steps ?? {}),
    [componentKey]: componentSteps,
  };
}

function cleanVisualProgress(progress: ManufacturingBundleProgress) {
  if (progress.wire_progress) {
    for (const [wireId, wire] of Object.entries(progress.wire_progress)) {
      if (wire.ends && !wire.ends.from && !wire.ends.to) delete wire.ends;
      if (!wire.cut && !wire.ends) delete progress.wire_progress[wireId];
    }
    if (Object.keys(progress.wire_progress).length === 0) delete progress.wire_progress;
  }
  if (progress.splice_measured && Object.keys(progress.splice_measured).length === 0) {
    delete progress.splice_measured;
  }
  if (
    progress.connector_guide_states
    && Object.keys(progress.connector_guide_states).length === 0
  ) {
    delete progress.connector_guide_states;
  }
  if (progress.task_attribution && Object.keys(progress.task_attribution).length === 0) {
    delete progress.task_attribution;
  }
}

/**
 * Apply visual-workbench tasks as one atomic document update. Every transition
 * records the operator and day while preserving the existing boolean workflow.
 */
export function applyManufacturingTaskUpdates(
  document: ManufacturingDocument,
  bundleId: string,
  updates: ManufacturingTaskUpdate[],
  actor: ManufacturingWorkAttribution,
  eventTime = Date.now(),
): ManufacturingDocument {
  const next = structuredClone(document);
  next.schema_version = '1.2.0';
  const progress = next.bundles[bundleId] ?? { steps: {} };
  let eventSequence = progress.work_log?.length ?? 0;

  for (const update of updates) {
    const previousCompleted = manufacturingTaskCompleted(progress, update);
    const previousGuideState = update.kind === 'connector-guide'
      ? progress.connector_guide_states?.[update.connectorId]
      : undefined;
    let completed = false;

    if (update.kind === 'wire-cut') {
      const wire = progress.wire_progress?.[update.wireId] ?? {};
      wire.cut = update.completed || undefined;
      progress.wire_progress = {
        ...(progress.wire_progress ?? {}),
        [update.wireId]: wire,
      };
      completed = update.completed;
      setComponentStep(progress, `wire:${update.wireId}`, 'cut', completed);
    } else if (update.kind === 'wire-end') {
      const wire = progress.wire_progress?.[update.wireId] ?? {};
      wire.ends = { ...(wire.ends ?? {}), [update.end]: update.completed || undefined };
      progress.wire_progress = {
        ...(progress.wire_progress ?? {}),
        [update.wireId]: wire,
      };
      completed = update.completed;
      setComponentStep(progress, `wire:${update.wireId}:end:${update.end}`, 'crimped', completed);
    } else if (update.kind === 'splice-measured') {
      progress.splice_measured = { ...(progress.splice_measured ?? {}) };
      if (update.completed) progress.splice_measured[update.spliceId] = true;
      else delete progress.splice_measured[update.spliceId];
      completed = update.completed;
      setComponentStep(progress, `splice:${update.spliceId}`, 'cut', completed);
    } else {
      progress.connector_guide_states = { ...(progress.connector_guide_states ?? {}) };
      if (update.state) progress.connector_guide_states[update.connectorId] = update.state;
      else delete progress.connector_guide_states[update.connectorId];
      completed = !!update.state;
      const componentKey = `connector:${update.connectorId}`;
      if (update.state === 'verified') {
        setComponentStep(progress, componentKey, 'qc', true);
      } else {
        setComponentStep(progress, componentKey, 'qc', false);
        if (update.state === 'checking') {
          setComponentStep(progress, componentKey, 'populated', true);
        } else {
          setComponentStep(progress, componentKey, 'populated', false);
        }
      }
    }

    const changed = update.kind === 'connector-guide'
      ? previousGuideState !== update.state
      : previousCompleted !== completed;
    if (!changed) continue;

    const taskKey = manufacturingTaskKey(update);
    progress.task_attribution = { ...(progress.task_attribution ?? {}) };
    if (completed) progress.task_attribution[taskKey] = actor;
    else delete progress.task_attribution[taskKey];

    const quantity = update.kind === 'wire-cut'
      ? update.lengthMm
      : update.kind === 'wire-end'
        ? 1
        : undefined;
    progress.work_log = [
      ...(progress.work_log ?? []),
      {
        id: `work:${bundleId}:${eventTime}:${eventSequence++}`,
        task_key: taskKey,
        kind: update.kind,
        action: completed ? 'complete' : 'reopen',
        ...(update.kind === 'connector-guide' && update.state
          ? { state: update.state }
          : {}),
        ...(quantity !== undefined ? { quantity } : {}),
        ...(quantity !== undefined
          ? { unit: update.kind === 'wire-cut' ? 'mm' as const : 'ea' as const }
          : {}),
        ...actor,
      },
    ];
  }

  cleanVisualProgress(progress);
  next.bundles[bundleId] = progress;
  return next;
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
