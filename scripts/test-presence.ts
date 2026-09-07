#!/usr/bin/env -S npx tsx
import assert from 'node:assert/strict';
import {
  createPresenceRegistry,
  normalizePresenceTargetBoundary,
} from '../server/presence.js';
import {
  derivePresenceFocus,
  indexPeersByEntity,
  newestAttribution,
  peerLocationLabel,
} from '../src/lib/collaborationPresence.js';
import type { PeerPresence } from '../src/types/collab.js';

assert.deepEqual(
  normalizePresenceTargetBoundary({ kind: 'image', id: 'img_1' }),
  { kind: 'image', id: 'img_1' },
);
assert.deepEqual(
  normalizePresenceTargetBoundary({ kind: 'harnessBundle', id: 'bundle:a|b' }),
  { kind: 'harnessBundle', id: 'bundle:a|b' },
);
assert.deepEqual(
  normalizePresenceTargetBoundary({ kind: 'bundle', id: 'bundle:a|b' }),
  { kind: 'harnessBundle', id: 'bundle:a|b' },
);
assert.deepEqual(
  normalizePresenceTargetBoundary({ kind: 'mergePoint', id: 'bp_1' }),
  { kind: 'branchPoint', id: 'bp_1' },
);
assert.equal(normalizePresenceTargetBoundary({ kind: 'unknown', id: 'x' }), undefined);
assert.equal(normalizePresenceTargetBoundary({ kind: 'image', id: '' }), undefined);

const registry = createPresenceRegistry({ debounceMs: 0, sweepIntervalMs: 60_000 });
registry.updatePresence('session-a', {
  userId: 'user-a',
  displayName: 'Alex',
  color: '#f00',
  system: 'car',
  appView: 'canvas',
  editingSurface: 'hierarchy',
  openEnclosureId: null,
  activeSubsystemId: null,
  focus: { kind: 'image', id: 'img_1' },
  editing: null,
});
assert.equal(registry.listPeers('car').length, 1);
assert.equal(registry.listPeers('other').length, 0);
registry.dispose();

const peer: PeerPresence = {
  sessionId: 'session-a',
  userId: 'user-a',
  displayName: 'Alex',
  color: '#f00',
  system: 'car',
  appView: 'canvas',
  editingSurface: 'hierarchy',
  openEnclosureId: 'enc_1',
  activeSubsystemId: null,
  focus: { kind: 'connector', id: 'con_1' },
  editing: { kind: 'connector', id: 'con_1', field: 'name' },
  lastSeen: 1,
};
const index = indexPeersByEntity({ [peer.sessionId]: peer });
assert.deepEqual(index.get('connector:con_1'), [peer], 'focus + editing must deduplicate a peer');
assert.equal(peerLocationLabel(peer, {
  enclosureNames: { enc_1: 'Cockpit' },
}), 'Cockpit');
assert.equal(peerLocationLabel({ ...peer, appView: 'manufacturing' }), 'Manufacturing');
assert.equal(peerLocationLabel({
  ...peer,
  editingSurface: 'subsystem',
  activeSubsystemId: 'power',
  openEnclosureId: null,
}, { subsystemNames: { power: 'Power' } }), 'Power');

const baseFocus = {
  appView: 'canvas' as const,
  editingSurface: 'hierarchy' as const,
  selectedItem: null,
  selectedHarnessBundle: null,
  selectedTextBoxId: null,
  selectedImageId: null,
  connectorLibraryTargetId: null,
  signalLibraryTargetId: null,
  manufacturingTargetBundleId: null,
  activeSubsystemId: null,
};
assert.deepEqual(
  derivePresenceFocus({ ...baseFocus, selectedImageId: 'img_1' }),
  { kind: 'image', id: 'img_1' },
);
assert.deepEqual(
  derivePresenceFocus({
    ...baseFocus,
    appView: 'manufacturing',
    manufacturingTargetBundleId: 'bundle:a|b',
  }),
  { kind: 'harnessBundle', id: 'bundle:a|b' },
);
assert.deepEqual(
  derivePresenceFocus({
    ...baseFocus,
    editingSurface: 'subsystem',
    activeSubsystemId: 'power',
  }),
  { kind: 'subsystem', id: 'power' },
);

const old = {
  by: { id: 'user-a', displayName: 'Alex' },
  at: '2026-09-01T00:00:00.000Z',
  rev: 10,
};
const newest = {
  by: { id: 'user-b', displayName: 'Blair' },
  at: '2026-09-02T00:00:00.000Z',
  rev: 12,
};
assert.equal(newestAttribution({ path_a: old, path_b: newest }, ['path_a', 'path_b']), newest);
assert.equal(newestAttribution({}, ['missing']), null);

console.log('PASS collaboration presence and attribution');
