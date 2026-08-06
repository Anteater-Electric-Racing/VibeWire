import type {
  Connector,
  ConnectorCavityVariant,
  ConnectorType,
} from '../types';

/** Library type used for newly created connectors; cavity floor is 1. */
export const GENERIC_MULTIPIN_TYPE_ID = 'generic_multipin';

type ConnectorCapacity = Pick<Connector, 'pin_count'>;
type ConnectorDefinition = Pick<
  ConnectorType,
  | 'id'
  | 'pin_count'
  | 'cavity_variants'
  | 'image'
  | 'male_image'
  | 'female_image'
  | 'side_image'
  | 'male_side_image'
  | 'female_side_image'
>;

function uniqueSortedPositive(values: readonly number[]): number[] {
  return Array.from(new Set(
    values
      .filter((value) => Number.isInteger(value) && value > 0)
      .map((value) => Math.floor(value)),
  )).sort((a, b) => a - b);
}

/** True when a catalog entry represents a selectable family rather than one fixed housing. */
export function isConnectorFamily(
  type: Pick<ConnectorType, 'cavity_variants'> | undefined | null,
): boolean {
  return (type?.cavity_variants?.length ?? 0) > 0;
}

/** Sorted physical housing capacities declared by a connector family. */
export function getConnectorSupportedPinCounts(
  type: Pick<ConnectorType, 'cavity_variants'> | undefined | null,
): number[] {
  return uniqueSortedPositive((type?.cavity_variants ?? []).map((variant) => variant.pin_count));
}

/**
 * Resolve a requested capacity to the smallest real housing that can fit it.
 * Requests above the family maximum stay at that maximum so validation can
 * report any occupied pins that cannot be represented by real hardware.
 */
export function resolveConnectorFamilyPinCount(
  type: Pick<ConnectorType, 'cavity_variants'> | undefined | null,
  requestedCount: number,
): number {
  const supported = getConnectorSupportedPinCounts(type);
  if (supported.length === 0) return Math.max(1, Math.floor(requestedCount));
  const requested = Math.max(1, Math.floor(requestedCount));
  return supported.find((count) => count >= requested) ?? supported[supported.length - 1];
}

/** Minimum physical capacity for a type. */
export function getConnectorTypeCavityFloor(
  type: Pick<ConnectorType, 'id' | 'pin_count' | 'cavity_variants'> | undefined | null,
): number {
  if (!type) return 1;
  const supported = getConnectorSupportedPinCounts(type);
  if (supported.length > 0) return supported[0];
  if (type.id === GENERIC_MULTIPIN_TYPE_ID) return 1;
  return Math.max(0, type.pin_count);
}

/** Capacity represented by the connector instance and its catalog definition. */
export function getEffectivePinCount(
  connector: ConnectorCapacity,
  type: Pick<ConnectorType, 'id' | 'pin_count' | 'cavity_variants'> | undefined | null,
): number {
  if (isConnectorFamily(type)) {
    return resolveConnectorFamilyPinCount(
      type,
      connector.pin_count ?? getConnectorTypeCavityFloor(type),
    );
  }
  const floor = getConnectorTypeCavityFloor(type);
  const base = connector.pin_count ?? type?.pin_count ?? 0;
  return Math.max(floor, base);
}

/**
 * Persist an instance capacity. Families always retain their selected physical
 * housing; fixed types only retain a true override.
 */
export function applyConnectorPinCount(
  connector: Connector,
  type: Pick<ConnectorType, 'id' | 'pin_count' | 'cavity_variants'> | undefined | null,
  nextCount: number,
): void {
  const safeNext = Number.isFinite(nextCount) ? nextCount : 1;
  if (isConnectorFamily(type)) {
    connector.pin_count = resolveConnectorFamilyPinCount(type, safeNext);
    return;
  }
  const floor = getConnectorTypeCavityFloor(type);
  const count = Math.max(floor, Math.floor(safeNext));
  if (
    type &&
    type.id !== GENERIC_MULTIPIN_TYPE_ID &&
    type.pin_count > 0 &&
    count === type.pin_count
  ) {
    delete connector.pin_count;
  } else {
    connector.pin_count = count;
  }
}

/** Next real housing capacity, or the current value at the family maximum. */
export function getNextConnectorPinCount(
  type: Pick<ConnectorType, 'cavity_variants'> | undefined | null,
  currentCount: number,
): number {
  const supported = getConnectorSupportedPinCounts(type);
  if (supported.length === 0) return currentCount + 1;
  return supported.find((count) => count > currentCount) ?? currentCount;
}

/**
 * Previous real housing that still fits `minimumCount`, or the current value
 * when shrinking would strand an occupied cavity.
 */
export function getPreviousConnectorPinCount(
  type: Pick<ConnectorType, 'id' | 'pin_count' | 'cavity_variants'> | undefined | null,
  currentCount: number,
  minimumCount: number,
): number {
  const floor = Math.max(getConnectorTypeCavityFloor(type), minimumCount);
  const supported = getConnectorSupportedPinCounts(type);
  if (supported.length === 0) return Math.max(floor, currentCount - 1);
  return [...supported].reverse().find((count) => count < currentCount && count >= floor)
    ?? currentCount;
}

/** Family variant for the connector's resolved physical capacity. */
export function getConnectorCavityVariant(
  connector: ConnectorCapacity,
  type: ConnectorDefinition | undefined | null,
): ConnectorCavityVariant | undefined {
  if (!type?.cavity_variants?.length) return undefined;
  const pinCount = getEffectivePinCount(connector, type);
  return type.cavity_variants.find((variant) => variant.pin_count === pinCount);
}

/** Keys valid for the connector's currently selected housing. */
export function getConnectorSupportedKeyings(
  connector: ConnectorCapacity,
  type: ConnectorDefinition | undefined | null,
): string[] {
  return Array.from(new Set(
    (getConnectorCavityVariant(connector, type)?.keyings ?? [])
      .map((keying) => keying.trim())
      .filter(Boolean),
  ));
}

/** Remove a key that is no longer valid after a family or housing change. */
export function normalizeConnectorKeying(
  connector: Pick<Connector, 'pin_count' | 'keying'>,
  type: ConnectorDefinition | undefined | null,
): void {
  if (!connector.keying) return;
  if (!getConnectorSupportedKeyings(connector, type).includes(connector.keying)) {
    delete connector.keying;
  }
}

export function getConnectorPinGuideImage(
  connector: ConnectorCapacity,
  type: ConnectorDefinition | undefined | null,
  gender?: 'male' | 'female',
): string | undefined {
  const variant = getConnectorCavityVariant(connector, type);
  if (gender === 'male') {
    return variant?.male_image ?? variant?.image ?? type?.male_image ?? type?.image;
  }
  if (gender === 'female') {
    return variant?.female_image ?? variant?.image ?? type?.female_image ?? type?.image;
  }
  return variant?.image ?? type?.image;
}

export function getConnectorSideImage(
  connector: ConnectorCapacity,
  type: ConnectorDefinition | undefined | null,
  gender?: 'male' | 'female',
): string | undefined {
  const variant = getConnectorCavityVariant(connector, type);
  if (gender === 'male') {
    return variant?.male_side_image
      ?? variant?.side_image
      ?? type?.male_side_image
      ?? type?.side_image;
  }
  if (gender === 'female') {
    return variant?.female_side_image
      ?? variant?.side_image
      ?? type?.female_side_image
      ?? type?.side_image;
  }
  return variant?.side_image ?? type?.side_image;
}

/**
 * Image shown on schematic connector nodes.
 * Bulkheads (wall-mounted on enclosure boxes) use the type side view.
 * Free-hanging / non-bulkhead connectors use the instance free-hanging image.
 * Pin guides never appear on schematics — only in the inspector / manufacturing.
 */
export function getConnectorSchematicImage(
  connector: ConnectorCapacity & { properties?: Record<string, string> },
  type: ConnectorDefinition | undefined | null,
  options: { bulkhead: boolean },
): string | undefined {
  if (options.bulkhead) {
    return getConnectorSideImage(connector, type);
  }
  const freeHanging = connector.properties?.image?.trim();
  return freeHanging || undefined;
}

export function getConnectorHousingPartNumber(
  connector: ConnectorCapacity,
  type: ConnectorDefinition | undefined | null,
  gender?: 'male' | 'female',
): string | undefined {
  const variant = getConnectorCavityVariant(connector, type);
  if (gender === 'male') {
    return variant?.male_housing_part_number ?? variant?.housing_part_number;
  }
  if (gender === 'female') {
    return variant?.female_housing_part_number ?? variant?.housing_part_number;
  }
  return variant?.housing_part_number;
}

/**
 * Short product-series label for occupancy summaries.
 * "Deutsch DT" → "DT"; "Molex Mini-Fit Jr. (dual-row)" → "Mini-Fit Jr".
 */
export function getConnectorFamilyCode(
  type: Pick<ConnectorType, 'id' | 'name'> | undefined | null,
): string {
  if (!type) return 'Unknown';
  const base = type.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const tokens = base.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    return tokens.slice(1).join(' ').replace(/\.+$/, '');
  }
  if (tokens.length === 1) return tokens[0].replace(/\.+$/, '');
  const idParts = type.id.split('_').filter(Boolean);
  if (idParts.length >= 2) {
    return idParts.slice(1).join('-').toUpperCase();
  }
  return type.id || 'Unknown';
}

/** e.g. "2/6, DT-6" — occupied/capacity and family-pin count. */
export function formatConnectorOccupancySummary(
  occupied: number,
  connector: ConnectorCapacity,
  type: Pick<ConnectorType, 'id' | 'name' | 'pin_count' | 'cavity_variants'> | undefined | null,
): string {
  const capacity = getEffectivePinCount(connector, type);
  const family = getConnectorFamilyCode(type);
  return `${occupied}/${capacity}, ${family}-${capacity}`;
}
