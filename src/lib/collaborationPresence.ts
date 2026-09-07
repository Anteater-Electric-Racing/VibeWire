import type {
  AttributionEntry,
  PeerPresence,
  PresenceTarget,
} from '../types/collab';
import type { AppView, EditingSurface, SelectedHarnessBundle, SelectedItem } from '../types';

export interface PresenceFocusInput {
  appView: AppView;
  editingSurface: EditingSurface;
  selectedItem: SelectedItem | null;
  selectedHarnessBundle: SelectedHarnessBundle | null;
  selectedTextBoxId: string | null;
  selectedImageId: string | null;
  connectorLibraryTargetId: string | null;
  signalLibraryTargetId: string | null;
  manufacturingTargetBundleId: string | null;
  activeSubsystemId: string | null;
}

export function derivePresenceFocus(input: PresenceFocusInput): PresenceTarget | null {
  if (input.appView === 'connectorLibrary') {
    return input.connectorLibraryTargetId
      ? { kind: 'connectorType', id: input.connectorLibraryTargetId }
      : null;
  }
  if (input.appView === 'signalLibrary') {
    return input.signalLibraryTargetId
      ? { kind: 'signal', id: input.signalLibraryTargetId }
      : null;
  }
  if (input.appView === 'manufacturing') {
    return input.manufacturingTargetBundleId
      ? { kind: 'harnessBundle', id: input.manufacturingTargetBundleId }
      : null;
  }
  if (input.selectedImageId) return { kind: 'image', id: input.selectedImageId };
  if (input.selectedTextBoxId) return { kind: 'textBox', id: input.selectedTextBoxId };
  if (input.selectedHarnessBundle) {
    return { kind: 'harnessBundle', id: input.selectedHarnessBundle.id };
  }
  if (input.selectedItem) {
    return { kind: input.selectedItem.type, id: input.selectedItem.id };
  }
  if (input.editingSurface === 'subsystem' && input.activeSubsystemId) {
    return { kind: 'subsystem', id: input.activeSubsystemId };
  }
  return null;
}

export function peerLocationLabel(
  peer: Pick<
    PeerPresence,
    'appView' | 'editingSurface' | 'openEnclosureId' | 'activeSubsystemId'
  >,
  names: {
    enclosureNames?: Readonly<Record<string, string>>;
    subsystemNames?: Readonly<Record<string, string>>;
  } = {},
): string {
  if (peer.appView === 'connectorLibrary') return 'Connectors';
  if (peer.appView === 'signalLibrary') return 'Signals';
  if (peer.appView === 'manufacturing') return 'Manufacturing';
  if (peer.editingSurface === 'subsystem') {
    return peer.activeSubsystemId
      ? names.subsystemNames?.[peer.activeSubsystemId] ?? 'Subsystem'
      : 'Subsystem';
  }
  if (peer.openEnclosureId) {
    return names.enclosureNames?.[peer.openEnclosureId] ?? 'Opened enclosure';
  }
  return 'System';
}

export function indexPeersByEntity(
  peers: Readonly<Record<string, PeerPresence>>,
): Map<string, PeerPresence[]> {
  const index = new Map<string, PeerPresence[]>();
  for (const peer of Object.values(peers)) {
    const seen = new Set<string>();
    for (const target of [peer.focus, peer.editing]) {
      if (!target) continue;
      const key = `${target.kind}:${target.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      index.set(key, [...(index.get(key) ?? []), peer]);
    }
  }
  return index;
}

export function newestAttribution(
  attribution: Readonly<Record<string, AttributionEntry>>,
  entityIds: readonly string[],
): AttributionEntry | null {
  let newest: AttributionEntry | null = null;
  for (const id of new Set(entityIds)) {
    const candidate = attribution[id];
    if (!candidate) continue;
    if (
      !newest
      || Date.parse(candidate.at) > Date.parse(newest.at)
      || (
        Date.parse(candidate.at) === Date.parse(newest.at)
        && candidate.rev > newest.rev
      )
    ) {
      newest = candidate;
    }
  }
  return newest;
}

