import assert from 'node:assert/strict';
import { validateSystemData } from '../server/api.js';
import { splitSystem, verifyRoundTrip } from '../server/sheets.js';
import {
  canMergePassThroughConnectors,
  deriveWires,
  getHarnessBundleIdForWire,
  getConnectorOccupancy,
  getEnclosurePorts,
  getConnectorRole,
} from '../src/lib/systemTopology.js';
import {
  deriveManufacturingBom,
  deriveManufacturingBundles,
} from '../src/lib/manufacturing.js';
import { useSystemStore } from '../src/store/index.js';
import type {
  ConnectorLibrary,
  SystemData,
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

const fixture: SystemData = {
  schema_version: '0.2.0-sheets',
  name: 'Inline connector fixture',
  hierarchy: [
    {
      id: 'enc_box',
      name: 'Box',
      parent: null,
      kind: 'enclosure',
      tags: [],
      properties: {},
    },
    {
      id: 'dev_a',
      name: 'Device A',
      parent: null,
      kind: 'device',
      tags: [],
      properties: {},
    },
    {
      id: 'dev_b',
      name: 'Device B',
      parent: null,
      kind: 'device',
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
  branchPoints: [],
  paths: [
    path('path_1', 1, 100),
    path('path_2', 2, 200),
  ],
  signals: [{ id: 'sig_power', name: 'Power', tags: [], properties: {} }],
  signalPropertyDefinitions: [],
};

useSystemStore.getState().resetForSystemSwitch();
useSystemStore.getState().setCollabAvailable(false);
useSystemStore.getState().loadSystem(structuredClone(fixture));
useSystemStore.getState().loadConnectorLibrary(structuredClone(library));
useSystemStore.setState({ undoStack: [], redoStack: [] });

const firstSegment = deriveWires(fixture)[0];
const bundleId = getHarnessBundleIdForWire(firstSegment);
useSystemStore.setState({
  waypointLayouts: {
    [bundleId]: [{ x: 20, y: 30 }, { x: 80, y: 70 }],
  },
  routeStyleLayouts: {
    [bundleId]: 'grid',
  },
});
const connectorId = useSystemStore.getState().addInlineConnector({
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

let system = useSystemStore.getState().system!;
const inline = system.connectors.find((connector) => connector.id === connectorId);
assert.equal(inline?.mounting, 'inline');
assert.equal(inline?.parent, null);
assert.equal(inline?.pin_count, 2);
assert.equal(getConnectorRole(system, connectorId), 'inline');
assert.deepEqual(
  system.paths.map((wirePath) => wirePath.nodes.map((node) =>
    node.kind === 'connector' ? `${node.connector_id}:${node.pin_number}` : node.branch_point_id
  )),
  [
    ['con_a:1', `${connectorId}:1`, 'con_b:1'],
    ['con_a:2', `${connectorId}:2`, 'con_b:2'],
  ],
);
assert.deepEqual(
  system.paths.map((wirePath) =>
    wirePath.measurements.map((measurement) => measurement.length_mm)
  ),
  [[50, 50], [100, 100]],
);
assert.deepEqual(
  useSystemStore.getState().freePortLayouts[connectorId],
  { x: 120, y: 80 },
);
assert.equal(useSystemStore.getState().waypointLayouts[bundleId], undefined);
assert.equal(
  Object.values(useSystemStore.getState().waypointLayouts).flat().length,
  2,
  'bundle waypoints must be split across the two new edges',
);
{
  const styles = useSystemStore.getState().routeStyleLayouts;
  assert.equal(styles[bundleId], undefined, 'the original bundle style must move onto the new hops');
  const hopStyles = Object.entries(styles)
    .filter(([edgeId]) => edgeId.startsWith('bundle:'))
    .map(([, style]) => style);
  assert.equal(hopStyles.length, 2);
  assert.ok(
    hopStyles.every((style) => style === 'grid'),
    'both hops after an inline split must keep the parent grid style',
  );
}
assert.equal(
  validateSystemData(system, library as never).valid,
  true,
  'inline insertion must preserve strict connector occupancy',
);

const impact = useSystemStore.getState().getDeleteImpact('connector', connectorId);
assert.deepEqual(impact.pathIds, [], 'complete through paths must survive inline deletion');
useSystemStore.getState().deleteEntityCascade('connector', connectorId);
system = useSystemStore.getState().system!;
assert.equal(system.connectors.some((connector) => connector.id === connectorId), false);
assert.deepEqual(
  system.paths.map((wirePath) => wirePath.nodes.map((node) =>
    node.kind === 'connector' ? node.connector_id : node.branch_point_id
  )),
  [['con_a', 'con_b'], ['con_a', 'con_b']],
);
assert.deepEqual(
  system.paths.map((wirePath) => wirePath.measurements[0]?.length_mm),
  [100, 200],
);
assert.deepEqual(
  useSystemStore.getState().waypointLayouts[bundleId],
  [{ x: 20, y: 30 }, { x: 80, y: 70 }],
  'deleting an inline connector must rejoin its two edge routes',
);
assert.equal(
  useSystemStore.getState().routeStyleLayouts[bundleId],
  'grid',
  'rejoining an inline connector must restore the grid style on the original hop',
);

useSystemStore.getState().undo();
system = useSystemStore.getState().system!;
assert.equal(system.connectors.some((connector) => connector.id === connectorId), true);
assert.equal(system.paths.every((wirePath) => wirePath.nodes.length === 3), true);

const insideInlineId = useSystemStore.getState().addInlineConnector({
  parent: 'enc_box',
  position: { x: 40, y: 60 },
});
assert.ok(insideInlineId);
system = useSystemStore.getState().system!;
assert.equal(getConnectorRole(system, insideInlineId), 'inline');
assert.deepEqual(
  getEnclosurePorts(system, 'enc_box').map((connector) => connector.id),
  ['con_bulkhead'],
  'an enclosure-inline connector must not appear as a wall port in the parent view',
);

const split = splitSystem(system, new Set(['enc_box']));
assert.equal(
  split.sheets.get('enc_box')?.connectors.find(
    (connector) => connector.id === insideInlineId,
  )?.mounting,
  'inline',
);
assert.deepEqual(
  verifyRoundTrip(system, split, new Set(['enc_box'])),
  [],
  'inline mounting must survive sheet splitting and assembly',
);

const bomSystem = structuredClone(system);
const bomInline = bomSystem.connectors.find((connector) => connector.id === connectorId)!;
bomInline.properties.housing_part_number = 'INLINE-PAIR';
const bundles = deriveManufacturingBundles(bomSystem, library);
const bom = deriveManufacturingBom(bomSystem, library, bundles);
assert.equal(
  bom.find((row) => row.category === 'Housing' && row.partNumber === 'INLINE-PAIR')?.quantity,
  2,
  'an inline mating interface must contribute both physical housings',
);

const mergeInlineSystem: SystemData = {
  schema_version: '0.2.0-sheets',
  name: 'Inline merge fixture',
  hierarchy: [
    { id: 'enc_box', name: 'Box', parent: null, kind: 'enclosure', tags: [], properties: {} },
    { id: 'dev_a', name: 'Device A', parent: null, kind: 'device', tags: [], properties: {} },
    { id: 'dev_b', name: 'Device B', parent: null, kind: 'device', tags: [], properties: {} },
  ],
  connectors: [
    { id: 'con_a', name: 'A', parent: 'dev_a', connector_type: 'generic_multipin', pin_count: 1, tags: [], properties: {} },
    { id: 'con_b', name: 'B', parent: 'dev_b', connector_type: 'generic_multipin', pin_count: 1, tags: [], properties: {} },
    { id: 'con_c', name: 'C', parent: 'dev_a', connector_type: 'generic_multipin', pin_count: 1, tags: [], properties: {} },
    { id: 'con_d', name: 'D', parent: 'dev_b', connector_type: 'generic_multipin', pin_count: 1, tags: [], properties: {} },
    {
      id: 'inline_a',
      name: 'Inline A',
      parent: null,
      connector_type: 'generic_multipin',
      pin_count: 1,
      mounting: 'inline',
      tags: [],
      properties: {},
    },
    {
      id: 'inline_b',
      name: 'Inline B',
      parent: null,
      connector_type: 'generic_multipin',
      pin_count: 1,
      mounting: 'inline',
      tags: [],
      properties: {},
    },
    {
      id: 'bh_box',
      name: 'Box bulkhead',
      parent: 'enc_box',
      connector_type: 'generic_multipin',
      pin_count: 1,
      mounting: 'bulkhead',
      tags: [],
      properties: {},
    },
  ],
  branchPoints: [],
  paths: [
    {
      id: 'path_left',
      name: 'Left',
      signal_id: 'sig_power',
      tags: [],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
        { kind: 'connector', connector_id: 'inline_a', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_b', pin_number: 1 },
      ],
      measurements: [],
    },
    {
      id: 'path_right',
      name: 'Right',
      signal_id: 'sig_power',
      tags: [],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'con_c', pin_number: 1 },
        { kind: 'connector', connector_id: 'inline_b', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_d', pin_number: 1 },
      ],
      measurements: [],
    },
  ],
  signals: [{ id: 'sig_power', name: 'Power', tags: [], properties: {} }],
  signalPropertyDefinitions: [],
};

useSystemStore.getState().resetForSystemSwitch();
useSystemStore.getState().setCollabAvailable(false);
useSystemStore.getState().loadSystem(structuredClone(mergeInlineSystem));
useSystemStore.getState().loadConnectorLibrary(structuredClone(library));
useSystemStore.setState({
  freePortLayouts: {
    inline_a: { x: 100, y: 100 },
    inline_b: { x: 110, y: 108 },
  },
  undoStack: [],
  redoStack: [],
});

assert.equal(
  canMergePassThroughConnectors(mergeInlineSystem, 'inline_a', 'inline_b'),
  true,
  'two free inline connectors must be mergeable',
);
assert.equal(
  canMergePassThroughConnectors(mergeInlineSystem, 'inline_a', 'bh_box'),
  false,
  'an inline connector must not merge with a bulkhead',
);
assert.equal(
  canMergePassThroughConnectors(mergeInlineSystem, 'con_a', 'con_b'),
  false,
  'endpoint connectors must not merge',
);

const keptInline = useSystemStore.getState().mergeBulkheadConnectors('inline_a', 'inline_b');
assert.equal(keptInline, 'inline_b');
const mergedInlineSystem = useSystemStore.getState().system!;
assert.equal(mergedInlineSystem.connectors.some((connector) => connector.id === 'inline_a'), false);
assert.equal(mergedInlineSystem.connectors.find((connector) => connector.id === 'inline_b')?.pin_count, 2);
assert.equal(getConnectorOccupancy(mergedInlineSystem, 'inline_b').length, 2);
assert.equal(useSystemStore.getState().freePortLayouts.inline_a, undefined);
assert.deepEqual(
  mergedInlineSystem.paths.find((wirePath) => wirePath.id === 'path_left')?.nodes[1],
  { kind: 'connector', connector_id: 'inline_b', pin_number: 2 },
  'absorbed inline cavities must land on the next free pin of the survivor',
);

const sharedPathSystem = structuredClone(mergeInlineSystem);
sharedPathSystem.paths = [{
  ...mergeInlineSystem.paths[0],
  nodes: [
    { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
    { kind: 'connector', connector_id: 'inline_a', pin_number: 1 },
    { kind: 'connector', connector_id: 'inline_b', pin_number: 1 },
    { kind: 'connector', connector_id: 'con_b', pin_number: 1 },
  ],
}];
assert.equal(
  canMergePassThroughConnectors(sharedPathSystem, 'inline_a', 'inline_b'),
  false,
  'inlines that already share a path must not merge',
);

console.log('Inline connector tests passed.');
