/**
 * Renaming must only ever change display labels. IDs, parents, path nodes,
 * measurements, signal references, subsystem membership, and the sheet split
 * all have to survive a rename untouched.
 */
import assert from 'node:assert/strict';
import { splitHarness, verifyRoundTrip } from '../server/sheets.js';
import {
  renameHarnessEntity,
  renameSubsystem,
  renameSystem,
} from '../src/lib/rename.js';
import type {
  HarnessData,
  SubsystemDocument,
} from '../src/types/index.js';

const original: HarnessData = {
  signalPropertyDefinitions: [],
  schema_version: '0.2.0-sheets',
  name: 'Original System',
  enclosures: [
    { id: 'enc_box', name: 'Box', parent: null, container: true, tags: [], properties: {} },
    { id: 'dev_ecu', name: 'ECU', parent: 'enc_box', container: false, tags: [], properties: {} },
  ],
  connectors: [
    { id: 'con_root', name: 'Root Plug', parent: null, connector_type: 'type_2p', tags: [], properties: {} },
    { id: 'con_ecu', name: 'ECU Plug', parent: 'dev_ecu', connector_type: 'type_2p', tags: ['system:cooling'], properties: {} },
  ],
  mergePoints: [
    { id: 'mp_001', name: 'Splice', parent: 'enc_box', tags: [], properties: {} },
  ],
  paths: [{
    id: 'path_power',
    name: 'Power path',
    signal_id: 'sig_power',
    tags: ['signal:power'],
    properties: { wire_color: 'red' },
    nodes: [
      { kind: 'connector', connector_id: 'con_root', pin_number: 1 },
      { kind: 'connector', connector_id: 'con_ecu', pin_number: 1 },
    ],
    measurements: [{
      from: { kind: 'connector', connector_id: 'con_root', pin_number: 1 },
      to: { kind: 'connector', connector_id: 'con_ecu', pin_number: 1 },
      length_mm: 250,
    }],
  }],
  signals: [
    { id: 'sig_power', name: 'Power', tags: [], properties: {} },
  ],
};

function identityAndReferenceFingerprint(harness: HarnessData) {
  return {
    enclosureIds: harness.enclosures.map((item) => item.id),
    enclosureParents: harness.enclosures.map((item) => [item.id, item.parent]),
    connectorIds: harness.connectors.map((item) => item.id),
    connectorParentsAndTypes: harness.connectors.map((item) => [item.id, item.parent, item.connector_type]),
    mergePointIds: harness.mergePoints.map((item) => item.id),
    pathIds: harness.paths.map((item) => item.id),
    pathReferences: harness.paths.map((item) => ({
      id: item.id,
      signal_id: item.signal_id,
      nodes: item.nodes,
      measurements: item.measurements,
      tags: item.tags,
      properties: item.properties,
    })),
    signalIds: harness.signals.map((item) => item.id),
  };
}

const before = identityAndReferenceFingerprint(original);
let renamed = renameSystem(original, 'Renamed System');
renamed = renameHarnessEntity(renamed, 'enclosure', 'enc_box', 'Main Enclosure');
renamed = renameHarnessEntity(renamed, 'enclosure', 'dev_ecu', 'Vehicle Controller');
renamed = renameHarnessEntity(renamed, 'connector', 'con_root', 'Shared Display Name');
renamed = renameHarnessEntity(renamed, 'connector', 'con_ecu', 'Shared Display Name');
renamed = renameHarnessEntity(renamed, 'mergePoint', 'mp_001', 'Main Splice');
renamed = renameHarnessEntity(renamed, 'path', 'path_power', 'Controller Power');
renamed = renameHarnessEntity(renamed, 'signal', 'sig_power', 'Controller Supply');

assert.equal(renamed.name, 'Renamed System');
assert.deepEqual(identityAndReferenceFingerprint(renamed), before);
assert.equal(renamed.connectors.filter((item) => item.name === 'Shared Display Name').length, 2);
assert.throws(() => renameHarnessEntity(renamed, 'connector', 'missing', 'Anything'), /missing/);
assert.throws(() => renameHarnessEntity(renamed, 'connector', 'con_root', '  '), /empty/);

const subsystem: SubsystemDocument = {
  schema_version: '1.0.0',
  id: 'cooling',
  name: 'Cooling',
  tags: ['system:cooling'],
  enclosures: { enc_box: { x: 10, y: 20 } },
  devices: { dev_ecu: { x: 30, y: 40 } },
  connectors: { con_ecu: { x: 50, y: 60 } },
};
const renamedSubsystem = renameSubsystem(subsystem, 'Thermal Management');
assert.equal(renamedSubsystem.id, 'cooling');
assert.deepEqual(renamedSubsystem.tags, ['system:cooling']);
assert.deepEqual(Object.keys(renamedSubsystem.devices), ['dev_ecu']);

const sheetIds = new Set(['enc_box']);
const split = splitHarness(renamed, sheetIds);
assert.equal(split.sheets.get(null)?.name, 'Renamed System');
assert.deepEqual(verifyRoundTrip(renamed, split, sheetIds), []);

console.log('Rename integrity tests passed');
