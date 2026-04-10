import type { HarnessData, Connector, Enclosure, Wire } from '../types';
import { getWireAppearance, type WireAppearance } from './colors';

/**
 * Walk up the parent chain to find the nearest enclosure ancestor of a
 * connector.  Returns null when the connector sits in the root space.
 */
export function getConnectorEnclosure(
  harness: HarnessData,
  conId: string,
): string | null {
  const con = harness.connectors.find((c) => c.id === conId);
  if (!con) return null;
  return con.parent;
}

/**
 * Direct child enclosures of a given space.
 * `parentId === null` means the root space.
 */
export function getChildEnclosures(
  harness: HarnessData,
  parentId: string | null,
): Enclosure[] {
  return harness.enclosures.filter((e) => e.parent === parentId);
}

/**
 * Connectors that should appear as port tabs on a given enclosure when
 * viewed from the parent space.  This is any connector whose parent is
 * this enclosure, OR whose parent is a non-container child of this
 * enclosure (i.e. connectors on a "PCB" surface are surfaced as ports
 * on the PCB enclosure node).
 */
export function getEnclosurePorts(
  harness: HarnessData,
  encId: string,
): Connector[] {
  return harness.connectors.filter((c) => c.parent === encId);
}

/**
 * All connectors reachable inside an enclosure — direct children plus
 * connectors on non-container child enclosures.
 */
export function getEnclosureConnectors(
  harness: HarnessData,
  encId: string,
): Connector[] {
  const childEncIds = new Set(
    harness.enclosures
      .filter((e) => e.parent === encId)
      .map((e) => e.id),
  );
  return harness.connectors.filter((c) => {
    if (c.parent === encId) return true;
    return c.parent !== null && childEncIds.has(c.parent);
  });
}

/**
 * Free-floating connectors within a space — connectors whose parent IS
 * the current space (null for root).
 */
export function getSpaceFreeConnectors(
  harness: HarnessData,
  spaceId: string | null,
): Connector[] {
  return harness.connectors.filter((c) => c.parent === spaceId);
}

export function getPortWireAppearance(
  harness: HarnessData,
  con: Connector,
): WireAppearance | null {
  const pinIds = new Set(con.pins.map((p) => p.id));
  const connectedWires = harness.wires.filter(
    (w) => pinIds.has(w.from) || pinIds.has(w.to),
  );
  const appearances = connectedWires.map((wire) => getWireAppearance(wire));
  if (appearances.length === 0) return null;

  const first = appearances[0];
  const allMatch = appearances.every((appearance) => appearance.key === first.key);
  return allMatch ? first : null;
}

/**
 * Determine which space (enclosure ID or null for root) a connector
 * is visible in when looking from a parent perspective.
 */
function connectorSpace(
  harness: HarnessData,
  conId: string,
): string | null {
  const con = harness.connectors.find((c) => c.id === conId);
  if (!con) return null;
  if (con.parent === null) return null;
  const parentEnc = harness.enclosures.find((e) => e.id === con.parent);
  if (!parentEnc) return null;
  return parentEnc.parent;
}

/**
 * Classify wires relative to a viewed space into internal (both ends
 * visible) and external (one end outside).
 */
export function getSpaceWires(
  harness: HarnessData,
  spaceId: string | null,
  findPinOwner: (pinId: string) => Connector | undefined,
) {
  const childEncIds = new Set(
    harness.enclosures
      .filter((e) => e.parent === spaceId)
      .map((e) => e.id),
  );

  const isVisible = (conId: string): boolean => {
    const con = harness.connectors.find((c) => c.id === conId);
    if (!con) return false;
    if (con.parent === spaceId) return true;
    return con.parent !== null && childEncIds.has(con.parent);
  };

  const internal: Wire[] = [];
  const external: {
    wire: Wire;
    internalConId: string;
    externalConId: string;
  }[] = [];

  for (const wire of harness.wires) {
    const fromCon = findPinOwner(wire.from);
    const toCon = findPinOwner(wire.to);
    if (!fromCon || !toCon) continue;

    const fromVis = isVisible(fromCon.id);
    const toVis = isVisible(toCon.id);

    if (fromVis && toVis) {
      internal.push(wire);
    } else if (fromVis) {
      external.push({ wire, internalConId: fromCon.id, externalConId: toCon.id });
    } else if (toVis) {
      external.push({ wire, internalConId: toCon.id, externalConId: fromCon.id });
    }
  }

  return { internal, external };
}
