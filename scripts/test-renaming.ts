import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createApiMiddleware } from '../server/api.js';
import { splitHarness, verifyRoundTrip } from '../server/sheets.js';
import {
  renameConnectorType,
  renameHarnessEntity,
  renameSubsystem,
  renameSystem,
} from '../src/lib/rename.js';
import type {
  ConnectorLibrary,
  HarnessData,
  SubsystemDocument,
} from '../src/types/index.js';

const original: HarnessData = {
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

const library: ConnectorLibrary = {
  connector_types: [{
    id: 'type_2p',
    name: 'Two Pin',
    pin_count: 2,
    crimp_spec: '',
    wire_gauge: '',
    notes: '',
  }],
};
const renamedLibrary = renameConnectorType(library, 'type_2p', 'Two-Cavity Connector');
assert.equal(renamedLibrary.connector_types[0].id, 'type_2p');
assert.equal(renamedLibrary.connector_types[0].name, 'Two-Cavity Connector');

const sheetIds = new Set(['enc_box']);
const split = splitHarness(renamed, sheetIds);
assert.equal(split.sheets.get(null)?.name, 'Renamed System');
assert.deepEqual(verifyRoundTrip(renamed, split, sheetIds), []);

async function testAmbiguousLegacyNameLookup() {
  const projectRoot = path.join(process.cwd(), `.tmp-rename-test-${process.pid}`);
  const harnessDir = path.join(projectRoot, 'public', 'user-data', 'harnesses');
  fs.mkdirSync(harnessDir, { recursive: true });
  fs.writeFileSync(path.join(harnessDir, 'rename-test.json'), JSON.stringify(renamed));

  const middleware = createApiMiddleware(projectRoot);
  const server = http.createServer((request, response) => middleware(request, response, () => {
    response.statusCode = 404;
    response.end();
  }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const endpoint = `http://127.0.0.1:${address.port}/api/path-by-name?harness=rename-test`;

  try {
    const ambiguous = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_connector: 'Shared Display Name',
        from_pin: 1,
        to_connector: 'Shared Display Name',
        to_pin: 2,
      }),
    });
    assert.equal(ambiguous.status, 404, 'duplicate display names must never resolve by guessing');

    const stableIds = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_connector: 'con_root',
        from_pin: 2,
        to_connector: 'con_ecu',
        to_pin: 2,
      }),
    });
    assert.equal(stableIds.status, 201, 'stable connector IDs remain valid after renaming');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    );
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

await testAmbiguousLegacyNameLookup();
console.log('Rename integrity tests passed');
