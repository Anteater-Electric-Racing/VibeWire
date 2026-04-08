import type { HarnessData, Connector, Wire } from '../types';
import { getSignalColor, getSignalFromTags } from './colors';

export function getConnectorEnclosure(
  harness: HarnessData,
  conId: string,
): string | null {
  const con = harness.connectors.find((c) => c.id === conId);
  if (!con) return null;
  if (harness.enclosures.some((e) => e.id === con.parent)) return con.parent;
  const pcb = harness.pcbs.find((p) => p.id === con.parent);
  return pcb?.parent ?? null;
}

export function isBulkhead(harness: HarnessData, con: Connector): boolean {
  return harness.enclosures.some((e) => e.id === con.parent);
}

export function getEnclosureConnectors(
  harness: HarnessData,
  encId: string,
): Connector[] {
  return harness.connectors.filter((c) => {
    if (c.parent === encId) return true;
    const pcb = harness.pcbs.find((p) => p.id === c.parent);
    return pcb?.parent === encId;
  });
}

export function getPortSignalColor(
  harness: HarnessData,
  con: Connector,
): string {
  const pinIds = new Set(con.pins.map((p) => p.id));
  const connectedWires = harness.wires.filter(
    (w) => pinIds.has(w.from) || pinIds.has(w.to),
  );
  const signals = new Set<string>();
  for (const wire of connectedWires) {
    const sig = getSignalFromTags(wire.tags);
    if (sig) signals.add(sig);
  }
  if (signals.size === 1) {
    return getSignalColor([...signals][0]);
  }
  return '#666';
}

export function getEnclosureWires(
  harness: HarnessData,
  encId: string,
  findPinOwner: (pinId: string) => Connector | undefined,
) {
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

    const fromEnc = getConnectorEnclosure(harness, fromCon.id);
    const toEnc = getConnectorEnclosure(harness, toCon.id);

    if (fromEnc === encId && toEnc === encId) {
      internal.push(wire);
    } else if (fromEnc === encId) {
      external.push({
        wire,
        internalConId: fromCon.id,
        externalConId: toCon.id,
      });
    } else if (toEnc === encId) {
      external.push({
        wire,
        internalConId: toCon.id,
        externalConId: fromCon.id,
      });
    }
  }

  return { internal, external };
}
