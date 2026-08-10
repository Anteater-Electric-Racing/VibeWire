import assert from 'node:assert/strict';
import { validateHarnessData } from '../server/api.js';
import { splitHarness, verifyRoundTrip } from '../server/sheets.js';
import {
  deriveSegments,
  getBundleIdForSegment,
  getEnclosurePorts,
  getConnectorRole,
} from '../src/lib/harness.js';
import {
  deriveManufacturingBom,
  deriveManufacturingBundles,
} from '../src/lib/manufacturing.js';
import { useHarnessStore } from '../src/store/index.js';
import type {
  ConnectorLibrary,
  HarnessData,
  Path,
} from '../src/types/index.js';

const library: ConnectorLibrary = {
  schema_version: '1.1.0',
  connector_types: [{
    id: 'generic_multipin',
    name: 'Generic Multi-pin',
    pin_count: 1,
    crimp_spec: 'GENERIC-CONTACT',
    male_crimp_part_number: 'CONTACT-M',
    female_crimp_part_number: 'CONTACT-F',
    wire_gauge: '18-22 AWG',
    notes: '',
    default_properties: {},
  }],
};

const path = (
  id: string,
  pinNumber: number,
  lengthMm: number,
): Path => ({
  id,
  name: id,
  signal_id: 'sig_power',
  tags: [],
  properties: { wire_gauge: '20 AWG' },
  nodes: [
    { kind: 'connector', connector_id: 'con_a', pin_number: pinNumber },
    { kind: 'connector', connector_id: 'con_b', pin_number: pinNumber },
  ],
  measurements: [{
    from: { kind: 'connector', connector_id: 'con_a', pin_number: pinNumber },
    to: { kind: 'connector', connector_id: 'con_b', pin_number: pinNumber },
    length_mm: lengthMm,
  }],
});

const fixture: HarnessData = {
  schema_version: '0.2.0-sheets',
  name: 'Inline connector fixture',
  enclosures: [
    {
      id: 'enc_box',
      name: 'Box',
      parent: null,
      container: true,
      tags: [],
      properties: {},
    },
    {
      id: 'dev_a',
      name: 'Device A',
      parent: null,
      container: false,
      tags: [],
      properties: {},
    },
    {
      id: 'dev_b',
      name: 'Device B',
      parent: null,
      container: false,
      tags: [],
      properties: {},
    },
  ],
  connectors: [
    {
      id: 'con_a',
      name: 'A',
      parent: 'dev_a',
      connector_type: 'generic_multipin',
      pin_count: 2,
      tags: [],
      properties: {},
    },
    {
      id: 'con_b',
      name: 'B',
      parent: 'dev_b',
      connector_type: 'generic_multipin',
      pin_count: 2,
      tags: [],
      properties: {},
    },
    {
      id: 'con_bulkhead',
      name: 'Legacy bulkhead',
      parent: 'enc_box',
      connector_type: 'generic_multipin',
      pin_count: 1,
      tags: [],
      properties: {},
    },
  ],
  mergePoints: [],
  paths: [
    path('path_1', 1, 100),
    path('path_2', 2, 200),
  ],
  signals: [{ id: 'sig_power', name: 'Power', tags: [], properties: {} }],
  signalPropertyDefinitions: [],
};

useHarnessStore.getState().resetForHarnessSwitch();
useHarnessStore.getState().setCollabAvailable(false);
useHarnessStore.getState().loadHarness(structuredClone(fixture));
useHarnessStore.getState().loadConnectorLibrary(structuredClone(library));
useHarnessStore.setState({ undoStack: [], redoStack: [] });

const firstSegment = deriveSegments(fixture)[0];
const bundleId = getBundleIdForSegment(firstSegment);
useHarnessStore.setState({
  waypointLayouts: {
    [bundleId]: [{ x: 20, y: 30 }, { x: 80, y: 70 }],
  },
});
const connectorId = useHarnessStore.getState().addInlineConnector({
  parent: null,
  position: { x: 120, y: 80 },
  bundle: {
    id: bundleId,
    pathIds: ['path_1', 'path_2'],
  },
  bundleLayout: {
    before: [{ x: 20, y: 30 }],
    after: [{ x: 80, y: 70 }],
  },
});
assert.ok(connectorId);

let harness = useHarnessStore.getState().harness!;
const inline = harness.connectors.find((connector) => connector.id === connectorId);
assert.equal(inline?.mounting, 'inline');
assert.equal(inline?.parent, null);
assert.equal(inline?.pin_count, 2);
assert.equal(getConnectorRole(harness, connectorId), 'inline');
assert.deepEqual(
  harness.paths.map((wirePath) => wirePath.nodes.map((node) =>
    node.kind === 'connector' ? `${node.connector_id}:${node.pin_number}` : node.merge_point_id
  )),
  [
    ['con_a:1', `${connectorId}:1`, 'con_b:1'],
    ['con_a:2', `${connectorId}:2`, 'con_b:2'],
  ],
);
assert.deepEqual(
  harness.paths.map((wirePath) =>
    wirePath.measurements.map((measurement) => measurement.length_mm)
  ),
  [[50, 50], [100, 100]],
);
assert.deepEqual(
  useHarnessStore.getState().freePortLayouts[connectorId],
  { x: 120, y: 80 },
);
assert.equal(useHarnessStore.getState().waypointLayouts[bundleId], undefined);
assert.equal(
  Object.values(useHarnessStore.getState().waypointLayouts).flat().length,
  2,
  'bundle waypoints must be split across the two new edges',
);
assert.equal(
  validateHarnessData(harness, library as never).valid,
  true,
  'inline insertion must preserve strict connector occupancy',
);

const impact = useHarnessStore.getState().getDeleteImpact('connector', connectorId);
assert.deepEqual(impact.pathIds, [], 'complete through paths must survive inline deletion');
useHarnessStore.getState().deleteEntityCascade('connector', connectorId);
harness = useHarnessStore.getState().harness!;
assert.equal(harness.connectors.some((connector) => connector.id === connectorId), false);
assert.deepEqual(
  harness.paths.map((wirePath) => wirePath.nodes.map((node) =>
    node.kind === 'connector' ? node.connector_id : node.merge_point_id
  )),
  [['con_a', 'con_b'], ['con_a', 'con_b']],
);
assert.deepEqual(
  harness.paths.map((wirePath) => wirePath.measurements[0]?.length_mm),
  [100, 200],
);
assert.deepEqual(
  useHarnessStore.getState().waypointLayouts[bundleId],
  [{ x: 20, y: 30 }, { x: 80, y: 70 }],
  'deleting an inline connector must rejoin its two edge routes',
);

useHarnessStore.getState().undo();
harness = useHarnessStore.getState().harness!;
assert.equal(harness.connectors.some((connector) => connector.id === connectorId), true);
assert.equal(harness.paths.every((wirePath) => wirePath.nodes.length === 3), true);

const insideInlineId = useHarnessStore.getState().addInlineConnector({
  parent: 'enc_box',
  position: { x: 40, y: 60 },
});
assert.ok(insideInlineId);
harness = useHarnessStore.getState().harness!;
assert.equal(getConnectorRole(harness, insideInlineId), 'inline');
assert.deepEqual(
  getEnclosurePorts(harness, 'enc_box').map((connector) => connector.id),
  ['con_bulkhead'],
  'an enclosure-inline connector must not appear as a wall port in the parent view',
);

const split = splitHarness(harness, new Set(['enc_box']));
assert.equal(
  split.sheets.get('enc_box')?.connectors.find(
    (connector) => connector.id === insideInlineId,
  )?.mounting,
  'inline',
);
assert.deepEqual(
  verifyRoundTrip(harness, split, new Set(['enc_box'])),
  [],
  'inline mounting must survive sheet splitting and assembly',
);

const bomHarness = structuredClone(harness);
const bomInline = bomHarness.connectors.find((connector) => connector.id === connectorId)!;
bomInline.properties.housing_part_number = 'INLINE-PAIR';
const bundles = deriveManufacturingBundles(bomHarness, library);
const bom = deriveManufacturingBom(bomHarness, library, bundles);
assert.equal(
  bom.find((row) => row.category === 'Housing' && row.partNumber === 'INLINE-PAIR')?.quantity,
  2,
  'an inline mating interface must contribute both physical housings',
);

console.log('Inline connector tests passed.');
