import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Node } from '@xyflow/react';
import {
  readSheetedHarness,
  splitHarness,
  verifyRoundTrip,
  writeSheetedHarness,
  writeSheetsToDisk,
  type HarnessData,
} from '../server/sheets.js';
import {
  getConnectorOccupancy,
  getPathSignalId,
  mergeConnectors,
  renumberConnectorPins,
  splicePathWithMerge,
} from '../src/lib/harness.js';
import { planSheetRoute, routeRequestToken } from '../server/routing.js';
import { createApiMiddleware, validateHarnessData } from '../server/api.js';
import {
  buildSubsystemGraphModel,
  clampNodeToParentBounds,
  findOverlappingWallMountedPeer,
  getAbsoluteNodeCenter,
  projectNodeToEnclosureWall,
  SUBSYSTEM_CONNECTOR_PREFIX,
  SUBSYSTEM_DEVICE_PREFIX,
  SUBSYSTEM_FRAME_PREFIX,
} from '../src/components/graph/graphModel.js';
import { resolveParentResizeWithConnectorShove } from '../src/lib/parentResize.js';
import {
  buildSubsystemSavePayload,
  useHarnessStore,
} from '../src/store/index.js';
import type { SubsystemDocument } from '../src/types/index.js';

const harness: HarnessData = {
  signalPropertyDefinitions: [],
  schema_version: '0.2.0-sheets',
  enclosures: [
    { id: 'enc_a', name: 'A', parent: null, container: true, tags: [], properties: {} },
    { id: 'enc_a1', name: 'A1', parent: 'enc_a', container: true, tags: [], properties: {} },
    { id: 'dev_a1', name: 'Device A1', parent: 'enc_a1', container: false, tags: [], properties: {} },
    { id: 'enc_b', name: 'B', parent: null, container: true, tags: [], properties: {} },
    { id: 'dev_b', name: 'Device B', parent: 'enc_b', container: false, tags: [], properties: {} },
  ],
  connectors: [
    { id: 'con_a1', name: 'A1 endpoint', parent: 'dev_a1', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_b', name: 'B endpoint', parent: 'dev_b', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_wall_a1', name: 'A1 wall', parent: 'enc_a1', connector_type: 'generic_multipin', pin_count: 1, tags: ['generated'], properties: {} },
    { id: 'con_wall_a', name: 'A wall', parent: 'enc_a', connector_type: 'generic_multipin', pin_count: 1, tags: ['generated'], properties: {} },
    { id: 'con_wall_b', name: 'B wall', parent: 'enc_b', connector_type: 'generic_multipin', pin_count: 1, tags: ['generated'], properties: {} },
  ],
  mergePoints: [],
  signals: [{ id: 'sig_TEST', name: 'Test', tags: ['noise:sensitive'], properties: { preferred_wire_color: 'white' } }],
  paths: [
    {
      id: 'path_nested',
      name: 'Nested sibling route',
      signal_id: 'sig_TEST',
      tags: ['signal:TEST'],
      properties: { wire_color: 'blue' },
      nodes: [
        { kind: 'connector', connector_id: 'con_a1', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_wall_a1', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_wall_a', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_wall_b', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_b', pin_number: 1 },
      ],
      measurements: [],
    },
  ],
};

const sheetIds = new Set(['enc_a', 'enc_a1', 'enc_b']);
const split = splitHarness(harness, sheetIds);
assert.deepEqual(verifyRoundTrip(harness, split, sheetIds), []);
assert.equal(split.sheets.get(null)?.paths.length, 1, 'root owns the sibling bridge segment');
assert.equal(split.sheets.get('enc_a')?.paths.length, 1, 'parent/child bridge is materialized in enc_a');
assert.equal(split.sheets.get('enc_a1')?.paths.length, 1, 'deep local run remains in enc_a1');
assert.equal(split.sheets.get('enc_b')?.paths.length, 1, 'destination local run remains in enc_b');

const localHarness = structuredClone(harness);
localHarness.paths = [{
  ...harness.paths[0],
  id: 'path_local',
  nodes: [
    { kind: 'connector', connector_id: 'con_a1', pin_number: 1 },
    { kind: 'connector', connector_id: 'con_wall_a1', pin_number: 1 },
  ],
}];
const localSplit = splitHarness(localHarness, sheetIds);
assert.deepEqual(verifyRoundTrip(localHarness, localSplit, sheetIds), []);

const measuredSpliceHarness = structuredClone(harness);
measuredSpliceHarness.mergePoints = [{
  id: 'mp_measured',
  name: 'Measured splice',
  parent: null,
  tags: [],
  properties: {},
}];
measuredSpliceHarness.paths = [{
  ...harness.paths[0],
  id: 'path_measured_splice',
  nodes: [
    { kind: 'connector', connector_id: 'con_wall_a', pin_number: 1 },
    { kind: 'connector', connector_id: 'con_wall_b', pin_number: 1 },
  ],
  measurements: [{
    from: { kind: 'connector', connector_id: 'con_wall_a', pin_number: 1 },
    to: { kind: 'connector', connector_id: 'con_wall_b', pin_number: 1 },
    length_mm: 22,
  }],
}];
measuredSpliceHarness.paths[0] = splicePathWithMerge(
  measuredSpliceHarness.paths[0],
  'bundle:connector:con_wall_a|connector:con_wall_b',
  'mp_measured',
);
const measuredSpliceProblems = verifyRoundTrip(
  measuredSpliceHarness,
  splitHarness(measuredSpliceHarness, sheetIds),
  sheetIds,
);
assert(
  measuredSpliceProblems.some((problem) =>
    problem.includes("path 'path_measured_splice' measurement count mismatch"),
  ),
  'a splice that invalidates an existing measured hop must fail the sheet round-trip check',
);

assert.equal(getPathSignalId({ signal_id: 'sig_TEST', tags: [] }), 'sig_TEST');
assert.equal(getPathSignalId({ signal_id: undefined, tags: ['signal:LEGACY'] }), 'sig_LEGACY');
assert.deepEqual(
  planSheetRoute(harness, sheetIds, harness.connectors[0], harness.connectors[1]).crossedChildScopes,
  ['enc_a1', 'enc_a', 'enc_b'],
);
assert.equal(routeRequestToken('same-request'), routeRequestToken('same-request'));

const library = {
  connector_types: [
    { id: 'generic', name: 'Generic', pin_count: 1, crimp_spec: '', wire_gauge: '', notes: '' },
    { id: 'generic_multipin', name: 'Generic Multi-pin', pin_count: 0, crimp_spec: '', wire_gauge: '', notes: '' },
  ],
};
const overCapacity = structuredClone(localHarness);
overCapacity.paths[0].nodes[0] = { kind: 'connector', connector_id: 'con_a1', pin_number: 2 };
const overCapacityResult = validateHarnessData(overCapacity, library);
assert.equal(overCapacityResult.valid, true);
assert(overCapacityResult.warnings.some((warning) => warning.includes('exceeding instance capacity')));

const missingPin = structuredClone(localHarness);
delete (missingPin.paths[0].nodes[0] as { pin_number?: number }).pin_number;
const missingPinResult = validateHarnessData(missingPin, library);
assert.equal(missingPinResult.valid, false);
assert(missingPinResult.errors.some((error) => error.includes('missing or invalid pin number')));

const duplicate = structuredClone(localHarness);
duplicate.paths.push({ ...structuredClone(duplicate.paths[0]), id: 'path_duplicate' });
const duplicateResult = validateHarnessData(duplicate, library);
assert.equal(duplicateResult.valid, false);
assert(duplicateResult.errors.some((error) => error.includes('occupied by multiple paths')));

const renumbered = renumberConnectorPins(localHarness, 'con_a1', [2, 1]);
assert.equal(
  renumbered.paths[0].nodes
    .filter((node) => node.kind === 'connector')
    .find((node) => node.connector_id === 'con_a1')?.pin_number,
  2,
);

const placementHarness = structuredClone(harness);
placementHarness.enclosures.push({
  id: 'dev_root',
  name: 'Root device',
  parent: null,
  container: false,
  tags: [],
  properties: {},
});
placementHarness.connectors.push({
  id: 'con_root',
  name: 'Root connector',
  parent: 'dev_root',
  connector_type: 'generic',
  tags: [],
  properties: {},
});
const subsystem: SubsystemDocument = {
  schema_version: '1.0.0',
  id: 'test',
  name: 'Test',
  tags: ['system:test'],
  enclosures: { enc_a1: { x: 0, y: 0, w: 400, h: 300 } },
  devices: { dev_root: { x: 500, y: 0, w: 220, h: 180 } },
  connectors: { con_a1: { x: 20, y: 20, w: 160, h: 180 } },
};
const placementGraph = buildSubsystemGraphModel(placementHarness, subsystem);
assert(placementGraph.graphNodes.some((node) => node.id === `${SUBSYSTEM_CONNECTOR_PREFIX}con_a1`));
assert(placementGraph.graphNodes.some((node) => node.id === `${SUBSYSTEM_DEVICE_PREFIX}dev_root`));

const appearanceHarness = structuredClone(placementHarness);
const appearanceDevice = appearanceHarness.enclosures.find((item) => item.id === 'dev_a1');
assert(appearanceDevice);
appearanceDevice.properties = { image: 'device-board.png' };
const appearanceSubsystem: SubsystemDocument = {
  schema_version: '1.0.0',
  id: 'appearance',
  name: 'Appearance',
  tags: [],
  enclosures: { enc_a1: { x: 0, y: 0, w: 520, h: 360 } },
  devices: { dev_a1: { x: 40, y: 60 } },
  connectors: {},
  device_connector_mode: { dev_a1: 'all' },
};
const appearanceGraph = buildSubsystemGraphModel(
  appearanceHarness,
  appearanceSubsystem,
  new Set(),
  null,
  {},
  new Map(),
  {},
  {},
  null,
  { con_a1: { x: 88, y: 64 } },
  { dev_a1: { w: 554, h: 471 }, con_a1: { w: 120, h: 48 } },
);
const appearanceDeviceNode = appearanceGraph.graphNodes.find(
  (node) => node.id === `${SUBSYSTEM_DEVICE_PREFIX}dev_a1`,
);
const appearanceConnectorNode = appearanceGraph.graphNodes.find(
  (node) => node.id === `${SUBSYSTEM_CONNECTOR_PREFIX}con_a1`,
);
assert.equal(appearanceDeviceNode?.data.image, 'device-board.png', 'subsystem devices must reuse the harness image');
assert.deepEqual(
  appearanceDeviceNode?.style,
  { width: 554, height: 471 },
  'subsystem devices without local size must inherit system sizeLayouts',
);
assert.deepEqual(
  appearanceConnectorNode?.position,
  { x: 88, y: 64 },
  'mode-all connectors without subsystem layout must inherit system portLayouts',
);
assert.deepEqual(
  appearanceConnectorNode?.style,
  { width: 120, height: 48 },
  'mode-all connectors without subsystem size must inherit system sizeLayouts',
);

const freeformSubsystem: SubsystemDocument = {
  schema_version: '1.0.0',
  id: 'freeform',
  name: 'Freeform',
  tags: [],
  enclosures: { enc_a1: { x: 10, y: 20, w: 400, h: 300 } },
  devices: { dev_a1: { x: 40, y: 60, w: 220, h: 180 } },
  connectors: {
    con_a1: { x: 30, y: 50, w: 96, h: 36 },
    con_wall_a1: { x: 190, y: 120, w: 96, h: 36 },
  },
  device_connector_mode: { dev_a1: 'all' },
};
const freeformGraph = buildSubsystemGraphModel(placementHarness, freeformSubsystem);
const frameNode = freeformGraph.graphNodes.find((node) => node.id === `${SUBSYSTEM_FRAME_PREFIX}enc_a1`);
const freeDeviceNode = freeformGraph.graphNodes.find((node) => node.id === `${SUBSYSTEM_DEVICE_PREFIX}dev_a1`);
const bulkheadNode = freeformGraph.graphNodes.find((node) => node.id === `${SUBSYSTEM_CONNECTOR_PREFIX}con_wall_a1`);
assert(frameNode);
assert.equal(freeDeviceNode?.parentId, frameNode.id);
assert.equal(freeDeviceNode?.extent, 'parent', 'subsystem devices must stay inside their physical frame');
assert.deepEqual(
  freeDeviceNode?.position,
  { x: 40, y: 60 },
  'in-bounds device layouts must render at their saved position',
);
const overflowSubsystem: SubsystemDocument = {
  ...structuredClone(freeformSubsystem),
  devices: { dev_a1: { x: 500, y: -40, w: 220, h: 180 } },
};
const overflowGraph = buildSubsystemGraphModel(placementHarness, overflowSubsystem);
const overflowDeviceNode = overflowGraph.graphNodes.find((node) => node.id === `${SUBSYSTEM_DEVICE_PREFIX}dev_a1`);
assert.deepEqual(
  overflowDeviceNode?.position,
  clampNodeToParentBounds({ x: 500, y: -40 }, { w: 220, h: 180 }, { w: 400, h: 300 }),
  'out-of-bounds device layouts must clamp into their enclosure frame',
);
assert.deepEqual(
  bulkheadNode?.position,
  { x: 190, y: -18 },
  'bulkheads must project their saved position to the nearest frame boundary',
);
assert.equal(bulkheadNode?.extent, undefined, 'bulkheads use explicit wall projection, not parent clamping');
assert.equal(bulkheadNode?.data.wallMounted, true, 'container bulkheads must remain wall-mounted');

const duplicatedDeviceSubsystem: SubsystemDocument = {
  ...structuredClone(freeformSubsystem),
  enclosures: {
    ...freeformSubsystem.enclosures,
    dev_a1: { x: -300, y: 100, w: 520, h: 360 },
  },
};
const deduplicatedGraph = buildSubsystemGraphModel(
  placementHarness,
  duplicatedDeviceSubsystem,
);
assert(
  !deduplicatedGraph.graphNodes.some((node) => node.id === `${SUBSYSTEM_FRAME_PREFIX}dev_a1`),
  'a device incorrectly listed as an enclosure must not render a duplicate frame',
);
assert.equal(
  deduplicatedGraph.graphNodes.filter((node) => node.id === `${SUBSYSTEM_DEVICE_PREFIX}dev_a1`).length,
  1,
  'a duplicated device must render exactly once',
);

useHarnessStore.setState({ collabAvailable: false });
useHarnessStore.getState().loadHarness(placementHarness as never);
useHarnessStore.getState().loadSubsystems([duplicatedDeviceSubsystem]);
assert(!useHarnessStore.getState().subsystems.freeform.enclosures.dev_a1);
assert.deepEqual(
  useHarnessStore.getState().subsystems.freeform.devices.dev_a1,
  freeformSubsystem.devices.dev_a1,
  'subsystem loading must keep the correctly classified device layout',
);
useHarnessStore.getState().loadSubsystems([freeformSubsystem]);
useHarnessStore.getState().resizeSubsystemEntityLayout(
  'enclosures',
  'enc_a1',
  { x: 25, y: 12, w: 430, h: 320 },
);
let resizedSubsystem = useHarnessStore.getState().subsystems.freeform;
assert.deepEqual(
  resizedSubsystem.devices.dev_a1,
  { x: 25, y: 68, w: 220, h: 180 },
  'top/left frame resize must preserve the child device screen position',
);
assert.deepEqual(
  resizedSubsystem.connectors.con_wall_a1,
  { x: 175, y: -18, w: 96, h: 36 },
  'frame resize must preserve the bulkhead tangent position while following its wall',
);
assert.deepEqual(
  resizedSubsystem.connectors.con_a1,
  freeformSubsystem.connectors.con_a1,
  'frame resize must not double-adjust connectors nested under a represented device',
);
useHarnessStore.getState().resizeSubsystemEntityLayout(
  'enclosures',
  'enc_a1',
  { x: 25, y: 12, w: 200, h: 160 },
);
resizedSubsystem = useHarnessStore.getState().subsystems.freeform;
assert.deepEqual(
  resizedSubsystem.devices.dev_a1,
  { x: 0, y: 0, w: 220, h: 180 },
  'shrinking a frame must clamp child devices back inside the enclosure',
);
useHarnessStore.getState().loadSubsystems([{
  ...freeformSubsystem,
  enclosures: { enc_a1: { x: 25, y: 12, w: 430, h: 320 } },
  devices: { dev_a1: { x: 25, y: 68, w: 220, h: 180 } },
}]);
useHarnessStore.getState().resizeSubsystemEntityLayout(
  'devices',
  'dev_a1',
  { x: 35, y: 78, w: 230, h: 190 },
);
resizedSubsystem = useHarnessStore.getState().subsystems.freeform;
assert.deepEqual(
  resizedSubsystem.connectors.con_a1,
  { x: 20, y: 40, w: 96, h: 36 },
  'top/left device resize must preserve its connector screen positions',
);

const connectorCollisionHarness = structuredClone(placementHarness);
connectorCollisionHarness.connectors.push({
  ...connectorCollisionHarness.connectors.find((connector) => connector.id === 'con_a1')!,
  id: 'con_a2',
  name: 'A1 second endpoint',
});
const connectorCollisionSubsystem: SubsystemDocument = {
  schema_version: '1.0.0',
  id: 'resize-collision',
  name: 'Resize collision',
  tags: [],
  enclosures: { enc_a1: { x: 0, y: 0, w: 500, h: 400 } },
  devices: { dev_a1: { x: 20, y: 20, w: 300, h: 200 } },
  connectors: {
    con_a1: { x: 100, y: 60, w: 50, h: 30 },
    con_a2: { x: 200, y: 60, w: 50, h: 30 },
  },
  device_connector_mode: { dev_a1: 'all' },
};
useHarnessStore.getState().loadHarness(connectorCollisionHarness as never);
useHarnessStore.getState().loadSubsystems([connectorCollisionSubsystem]);
useHarnessStore.getState().setActiveSubsystem('resize-collision');
useHarnessStore.getState().resizeSubsystemEntityLayout(
  'devices',
  'dev_a1',
  { x: 20, y: 20, w: 170, h: 200 },
);
const collisionResizeDocument = useHarnessStore.getState().subsystems['resize-collision'];
assert.deepEqual(
  collisionResizeDocument.devices.dev_a1,
  { x: 20, y: 20, w: 200, h: 200 },
  'subsystem device resize must stop when a shoved connector reaches its peer',
);
assert.deepEqual(
  collisionResizeDocument.connectors.con_a1,
  { x: 100, y: 60, w: 50, h: 30 },
);
assert.deepEqual(
  collisionResizeDocument.connectors.con_a2,
  { x: 150, y: 60, w: 50, h: 30 },
);

useHarnessStore.setState({
  nodeLayouts: { dev_a1: { x: 20, y: 20 } },
  portLayouts: {
    con_a1: { x: 100, y: 60 },
    con_a2: { x: 200, y: 60 },
  },
  sizeLayouts: {
    dev_a1: { w: 300, h: 200 },
    con_a1: { w: 50, h: 30 },
    con_a2: { w: 50, h: 30 },
  },
});
useHarnessStore.getState().resizeHierarchyEntityLayout(
  'dev_a1',
  { x: 20, y: 20, w: 300, h: 200 },
  { x: 20, y: 20, w: 170, h: 200 },
);
assert.deepEqual(
  useHarnessStore.getState().sizeLayouts.dev_a1,
  { w: 200, h: 200 },
  'hierarchy device resize must use the same connector collision stop',
);
assert.deepEqual(useHarnessStore.getState().portLayouts.con_a1, { x: 100, y: 60 });
assert.deepEqual(useHarnessStore.getState().portLayouts.con_a2, { x: 150, y: 60 });

const mergeHarness: HarnessData = {
  signalPropertyDefinitions: [],
  schema_version: '0.2.0-sheets',
  enclosures: [
    { id: 'enc_box', name: 'Box', parent: null, container: true, tags: [], properties: {} },
    { id: 'dev_in', name: 'Inside', parent: 'enc_box', container: false, tags: [], properties: {} },
    { id: 'dev_out', name: 'Outside', parent: null, container: false, tags: [], properties: {} },
  ],
  connectors: [
    {
      id: 'bh_a',
      name: 'Bulkhead A',
      parent: 'enc_box',
      connector_type: 'generic_multipin',
      pin_count: 1,
      tags: ['generated', 'unresolved', 'bulkhead'],
      properties: {},
    },
    {
      id: 'bh_b',
      name: 'Bulkhead B',
      parent: 'enc_box',
      connector_type: 'generic_multipin',
      pin_count: 1,
      tags: ['generated', 'unresolved', 'bulkhead'],
      properties: {},
    },
    {
      id: 'bh_real',
      name: 'Real Bulkhead',
      parent: 'enc_box',
      connector_type: 'generic_multipin',
      pin_count: 2,
      tags: ['bulkhead'],
      properties: {},
    },
    { id: 'con_in', name: 'Inside', parent: 'dev_in', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_out', name: 'Outside', parent: 'dev_out', connector_type: 'generic', tags: [], properties: {} },
  ],
  mergePoints: [],
  signals: [
    { id: 'sig_A', name: 'A', tags: [], properties: {} },
    { id: 'sig_B', name: 'B', tags: [], properties: {} },
  ],
  paths: [
    {
      id: 'path_a',
      name: 'Path A',
      signal_id: 'sig_A',
      tags: [],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'con_in', pin_number: 1 },
        { kind: 'connector', connector_id: 'bh_a', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_out', pin_number: 1 },
      ],
      measurements: [],
    },
    {
      id: 'path_b',
      name: 'Path B',
      signal_id: 'sig_B',
      tags: [],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'con_in', pin_number: 2 },
        { kind: 'connector', connector_id: 'bh_b', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_out', pin_number: 2 },
      ],
      measurements: [],
    },
  ],
};

const merged = mergeConnectors(mergeHarness, 'bh_a', 'bh_b');
assert.equal(merged.connectors.some((connector) => connector.id === 'bh_a'), false);
assert.equal(merged.connectors.find((connector) => connector.id === 'bh_b')?.pin_count, 2);
assert.deepEqual(
  merged.paths.find((path) => path.id === 'path_a')?.nodes[1],
  { kind: 'connector', connector_id: 'bh_b', pin_number: 2 },
  'absorbed path cavity must land on the next free pin of the survivor',
);
assert.deepEqual(
  merged.paths.find((path) => path.id === 'path_b')?.nodes[1],
  { kind: 'connector', connector_id: 'bh_b', pin_number: 1 },
  'survivor cavities must keep their original pin numbers',
);
assert.equal(getConnectorOccupancy(merged, 'bh_b').length, 2);

const nestedGraphNodes: Node[] = [
  {
    id: 'parent',
    position: { x: 400, y: 300 },
    style: { width: 300, height: 200 },
    data: {},
  },
  {
    id: 'child',
    parentId: 'parent',
    position: { x: 25, y: 35 },
    style: { width: 100, height: 40 },
    data: {},
  },
];
assert.deepEqual(
  getAbsoluteNodeCenter('child', nestedGraphNodes),
  { x: 475, y: 355 },
  'junction proximity must use absolute child-node geometry',
);

const enclosureSize = { w: 400, h: 300 };
const size = { w: 96, h: 36 };
const topWallA = projectNodeToEnclosureWall({ x: 100, y: 10 }, size, enclosureSize);
const topWallB = projectNodeToEnclosureWall({ x: 110, y: 12 }, size, enclosureSize);
assert.equal(
  findOverlappingWallMountedPeer(
    {
      id: '__subconnector_bh_a',
      parentId: '__subframe_enc_box',
      position: topWallA,
      size,
      wallMounted: true,
    },
    [
      {
        id: '__subconnector_bh_b',
        parentId: '__subframe_enc_box',
        position: topWallB,
        size,
        wallMounted: true,
      },
    ],
    enclosureSize,
  ),
  '__subconnector_bh_b',
  'nearby bulkheads on the same wall must be merge candidates',
);
assert.equal(
  findOverlappingWallMountedPeer(
    {
      id: '__subconnector_bh_a',
      parentId: '__subframe_enc_box',
      position: projectNodeToEnclosureWall({ x: 10, y: 100 }, size, enclosureSize),
      size,
      wallMounted: true,
    },
    [
      {
        id: '__subconnector_bh_b',
        parentId: '__subframe_enc_box',
        position: projectNodeToEnclosureWall({ x: 300, y: 100 }, size, enclosureSize),
        size,
        wallMounted: true,
      },
    ],
    enclosureSize,
  ),
  null,
  'bulkheads on opposite walls must not merge',
);

const singleShove = resolveParentResizeWithConnectorShove(
  { x: 0, y: 0, w: 300, h: 200 },
  { x: 0, y: 0, w: 180, h: 200 },
  [{
    id: 'rightmost',
    position: { x: 200, y: 60 },
    size: { w: 50, h: 30 },
  }],
);
assert.deepEqual(singleShove.parent, { x: 0, y: 0, w: 180, h: 200 });
assert.deepEqual(
  singleShove.connectorPositions.rightmost,
  { x: 130, y: 60 },
  'an encroaching wall must shove an unblocked connector',
);

const blockedShove = resolveParentResizeWithConnectorShove(
  { x: 0, y: 0, w: 300, h: 200 },
  { x: 0, y: 0, w: 170, h: 200 },
  [
    {
      id: 'blocker',
      position: { x: 100, y: 60 },
      size: { w: 50, h: 30 },
    },
    {
      id: 'shoved',
      position: { x: 200, y: 60 },
      size: { w: 50, h: 30 },
    },
  ],
);
assert.deepEqual(
  blockedShove.parent,
  { x: 0, y: 0, w: 200, h: 200 },
  'the resizing wall must stop when its connector reaches another connector',
);
assert.deepEqual(blockedShove.connectorPositions.blocker, { x: 100, y: 60 });
assert.deepEqual(
  blockedShove.connectorPositions.shoved,
  { x: 150, y: 60 },
  'a shove must stop at contact instead of chain-pushing the next connector',
);

const touchingShove = resolveParentResizeWithConnectorShove(
  { x: 0, y: 0, w: 300, h: 200 },
  { x: 0, y: 0, w: 170, h: 200 },
  [
    {
      id: 'blocker',
      position: { x: 100, y: 60 },
      size: { w: 50, h: 30 },
    },
    {
      id: 'touching',
      position: { x: 150, y: 60 },
      size: { w: 50, h: 30 },
    },
  ],
);
assert.deepEqual(
  touchingShove.parent,
  { x: 0, y: 0, w: 200, h: 200 },
  'a connector already touching a peer must not be shoved',
);
assert.deepEqual(touchingShove.connectorPositions.touching, { x: 150, y: 60 });

const overlappingShove = resolveParentResizeWithConnectorShove(
  { x: 0, y: 0, w: 300, h: 200 },
  { x: 0, y: 0, w: 170, h: 200 },
  [
    {
      id: 'blocker',
      position: { x: 100, y: 60 },
      size: { w: 60, h: 30 },
    },
    {
      id: 'overlapping',
      position: { x: 150, y: 60 },
      size: { w: 50, h: 30 },
    },
  ],
);
assert.deepEqual(
  overlappingShove.parent,
  { x: 0, y: 0, w: 200, h: 200 },
  'an overlapping connector must not be shoved farther',
);
assert.deepEqual(overlappingShove.connectorPositions.overlapping, { x: 150, y: 60 });

const oppositeWallShove = resolveParentResizeWithConnectorShove(
  { x: 0, y: 0, w: 300, h: 200 },
  { x: 0, y: 0, w: 80, h: 200 },
  [{
    id: 'wide',
    position: { x: 0, y: 60 },
    size: { w: 120, h: 30 },
  }],
);
assert.deepEqual(
  oppositeWallShove.parent,
  { x: 0, y: 0, w: 120, h: 200 },
  'a connector must stop the resize when it reaches the opposite wall',
);

const wallMountedShove = resolveParentResizeWithConnectorShove(
  { x: 0, y: 0, w: 300, h: 200 },
  { x: 0, y: 0, w: 170, h: 200 },
  [
    {
      id: 'top-blocker',
      position: { x: 100, y: -10 },
      size: { w: 50, h: 20 },
      wallMounted: true,
    },
    {
      id: 'top-shoved',
      position: { x: 200, y: -10 },
      size: { w: 50, h: 20 },
      wallMounted: true,
    },
  ],
);
assert.deepEqual(
  wallMountedShove.parent,
  { x: 0, y: 0, w: 200, h: 200 },
  'wall-mounted connectors must use the same collision stop along their wall',
);
assert.deepEqual(wallMountedShove.connectorPositions['top-shoved'], { x: 150, y: -10 });

const mergeSubsystem: SubsystemDocument = {
  schema_version: '1.0.0',
  id: 'merge-sub',
  name: 'Merge',
  tags: [],
  enclosures: { enc_box: { x: 0, y: 0, w: 400, h: 300 } },
  devices: {},
  connectors: {
    bh_a: { x: 100, y: -18, w: 96, h: 36 },
    bh_b: { x: 110, y: -18, w: 96, h: 36 },
    bh_real: { x: 200, y: -18, w: 96, h: 36 },
  },
};
useHarnessStore.setState({ collabAvailable: false, connectorLibrary: null });
useHarnessStore.getState().loadHarness(mergeHarness as never);
useHarnessStore.getState().loadSubsystems([mergeSubsystem]);
useHarnessStore.getState().setActiveSubsystem('merge-sub');
const undoDepthBeforeMerge = useHarnessStore.getState().undoStack.length;
const keptGenerated = useHarnessStore.getState().mergeBulkheadConnectors('bh_a', 'bh_b');
assert.equal(keptGenerated, 'bh_b');
assert.equal(
  useHarnessStore.getState().harness?.connectors.some((connector) => connector.id === 'bh_a'),
  false,
);
assert.equal(useHarnessStore.getState().subsystems['merge-sub'].connectors.bh_a, undefined);
assert.equal(
  useHarnessStore.getState().undoStack.length,
  undoDepthBeforeMerge + 1,
  'merging bulkheads must record exactly one undoable entry',
);

useHarnessStore.getState().loadHarness(mergeHarness as never);
useHarnessStore.getState().loadSubsystems([mergeSubsystem]);
const keptReal = useHarnessStore.getState().mergeBulkheadConnectors('bh_real', 'bh_a');
assert.equal(keptReal, 'bh_real', 'authored hardware must survive when merged with a generated placeholder');
assert.equal(
  useHarnessStore.getState().harness?.connectors.some((connector) => connector.id === 'bh_a'),
  false,
);
assert.ok(useHarnessStore.getState().harness?.connectors.some((connector) => connector.id === 'bh_real'));

const projectedHarness: HarnessData = {
  signalPropertyDefinitions: [],
  schema_version: '0.2.0-sheets',
  enclosures: [
    { id: 'dev_left', name: 'Left', parent: null, container: false, tags: [], properties: {} },
    { id: 'dev_hidden', name: 'Hidden', parent: null, container: false, tags: [], properties: {} },
    { id: 'dev_right', name: 'Right', parent: null, container: false, tags: [], properties: {} },
  ],
  connectors: [
    { id: 'con_left', name: 'Left connector', parent: 'dev_left', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_hidden', name: 'Hidden connector', parent: 'dev_hidden', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_right', name: 'Right connector', parent: 'dev_right', connector_type: 'generic', tags: [], properties: {} },
  ],
  mergePoints: [],
  signals: [],
  paths: [{
    id: 'path_projected',
    name: 'Projected connection',
    tags: [],
    properties: {},
    nodes: [
      { kind: 'connector', connector_id: 'con_left', pin_number: 1 },
      { kind: 'connector', connector_id: 'con_hidden', pin_number: 1 },
      { kind: 'connector', connector_id: 'con_right', pin_number: 1 },
    ],
    measurements: [],
  }],
};
const projectedSubsystem: SubsystemDocument = {
  schema_version: '1.0.0',
  id: 'projected',
  name: 'Projected',
  tags: [],
  enclosures: {},
  devices: {
    dev_left: { x: 0, y: 0 },
    dev_right: { x: 400, y: 0 },
  },
  connectors: {},
};
const projectedGraph = buildSubsystemGraphModel(projectedHarness as never, projectedSubsystem);
assert.equal(projectedGraph.graphEdges.length, 1, 'hidden inline entities must not break subsystem connections');
assert.deepEqual(projectedGraph.graphEdges[0].data?.pathIds, ['path_projected']);
assert.equal(projectedGraph.graphEdges[0].sourceHandle, undefined, 'collapsed connectors must use their generic handle');
assert.equal(projectedGraph.graphEdges[0].targetHandle, undefined, 'collapsed connectors must use their generic handle');

const projectedEdgeId = projectedGraph.graphEdges[0].id;
const routedSubsystemGraph = buildSubsystemGraphModel(
  projectedHarness as never,
  projectedSubsystem,
  new Set(),
  null,
  {},
  new Map(),
  { [projectedEdgeId]: [{ x: 120, y: 80 }] },
  {},
  { id: projectedEdgeId, pathIds: ['path_projected'] },
);
assert.equal(routedSubsystemGraph.graphEdges[0].selected, true, 'selected subsystem bundles must mark their edge selected');
assert.deepEqual(
  routedSubsystemGraph.graphEdges[0].data?.resolvedWaypoints,
  [{ x: 120, y: 80 }],
  'subsystem edges must render free route points from waypoint layouts',
);

useHarnessStore.getState().loadHarness(projectedHarness as never);
useHarnessStore.getState().loadSubsystems([projectedSubsystem]);
useHarnessStore.getState().updateSubsystemEntityLayout(
  'connectors',
  'con_left',
  { x: 20, y: 30 },
);
assert.deepEqual(
  useHarnessStore.getState().subsystems.projected.connectors.con_left,
  { x: 20, y: 30 },
  'moving an implicitly visible device connector must persist its first layout',
);
useHarnessStore.getState().setSelectedBundle({
  id: 'subsystem:projected:bundle:connector:con_left|connector:con_right',
  pathIds: ['path_projected'],
});
useHarnessStore.getState().deletePathBundle(
  'subsystem:projected:bundle:connector:con_left|connector:con_right',
  ['path_projected'],
);
assert.equal(
  useHarnessStore.getState().harness?.paths.length,
  0,
  'deleting a selected subsystem bundle must remove its underlying paths',
);
assert.equal(useHarnessStore.getState().selectedBundle, null);
useHarnessStore.getState().undo();
assert(useHarnessStore.getState().harness?.paths.some((wirePath) => wirePath.id === 'path_projected'));
const generatedDeletionHarness = structuredClone(projectedHarness);
generatedDeletionHarness.connectors.find((connector) => connector.id === 'con_hidden')!.properties = {
  generated_by_route: 'path_projected',
};
useHarnessStore.getState().loadHarness(generatedDeletionHarness as never);
useHarnessStore.getState().deletePathBundle(
  'subsystem:projected:bundle:connector:con_left|connector:con_right',
  ['path_projected'],
);
assert(
  !useHarnessStore.getState().harness?.connectors.some((connector) => connector.id === 'con_hidden'),
  'deleting a routed bundle must remove its now-unused generated bulkhead',
);

const mergeProjectedHarness = structuredClone(projectedHarness);
mergeProjectedHarness.mergePoints = [
  { id: 'mp_hidden', name: 'Hidden splice', parent: null, tags: [], properties: {} },
];
mergeProjectedHarness.paths = [
  {
    id: 'path_merge_left',
    name: 'Left to splice',
    tags: [],
    properties: {},
    nodes: [
      { kind: 'connector', connector_id: 'con_left', pin_number: 1 },
      { kind: 'merge', merge_point_id: 'mp_hidden' },
    ],
    measurements: [],
  },
  {
    id: 'path_merge_right',
    name: 'Splice to right',
    tags: [],
    properties: {},
    nodes: [
      { kind: 'merge', merge_point_id: 'mp_hidden' },
      { kind: 'connector', connector_id: 'con_right', pin_number: 1 },
    ],
    measurements: [],
  },
];
const mergeProjectedGraph = buildSubsystemGraphModel(
  mergeProjectedHarness as never,
  projectedSubsystem,
  new Set(['con_left', 'con_right']),
);
assert.equal(mergeProjectedGraph.graphEdges.length, 1, 'shared cavity endpoints must render as one visible wire bundle');
assert.deepEqual(
  mergeProjectedGraph.graphEdges.flatMap((edge) => (edge.data?.pathIds as string[]) ?? []).sort(),
  ['path_merge_left', 'path_merge_right'],
);
assert.equal(mergeProjectedGraph.graphEdges[0].data?.pathCount, 2, 'bundle must render both visible wires');
assert(mergeProjectedGraph.graphEdges.every((edge) =>
  edge.sourceHandle === 'pin:1' && edge.targetHandle === 'pin:1'
), 'editable subsystem edges must retain cavity handles');

useHarnessStore.getState().loadHarness(placementHarness as never);
useHarnessStore.getState().loadSubsystems([subsystem]);
useHarnessStore.getState().removeEntityFromActiveSubsystem('connector', 'con_a1');
assert(useHarnessStore.getState().harness?.connectors.some((connector) => connector.id === 'con_a1'));
assert(!useHarnessStore.getState().subsystems.test.connectors.con_a1);
useHarnessStore.getState().updateSubsystemEntityLayout(
  'connectors',
  'con_a1',
  { x: 999, y: 999 },
);
assert(
  !useHarnessStore.getState().subsystems.test.connectors.con_a1,
  'a stale position event must not restore a removed connector',
);
useHarnessStore.getState().removeEntityFromActiveSubsystem('connector', 'con_root');
assert(useHarnessStore.getState().harness?.connectors.some((connector) => connector.id === 'con_root'));
assert(useHarnessStore.getState().subsystems.test.hidden_connectors?.includes('con_root'));

const connectorOnlySubsystem: SubsystemDocument = {
  schema_version: '1.0.0',
  id: 'connector-only',
  name: 'Connector only',
  tags: [],
  enclosures: {},
  devices: {},
  connectors: {},
};
useHarnessStore.getState().loadHarness(placementHarness as never);
useHarnessStore.setState({
  portLayouts: { con_a1: { x: 77, y: 55 } },
  sizeLayouts: { con_a1: { w: 110, h: 44 }, dev_a1: { w: 400, h: 300 } },
});
useHarnessStore.getState().loadSubsystems([connectorOnlySubsystem]);
useHarnessStore.getState().addEntityToActiveSubsystem('connector', 'con_a1');
const connectorOnlyDocument = useHarnessStore.getState().subsystems['connector-only'];
assert(connectorOnlyDocument.enclosures.enc_a1);
assert(connectorOnlyDocument.devices.dev_a1);
assert.equal(
  connectorOnlyDocument.devices.dev_a1.w,
  undefined,
  'added devices omit size so they inherit system sizeLayouts',
);
assert.equal(connectorOnlyDocument.device_connector_mode?.dev_a1, 'selected');
assert.deepEqual(
  connectorOnlyDocument.connectors.con_a1,
  { x: 77, y: 55, w: 110, h: 44 },
  'explicitly added connectors must seed layout from system port/size layouts',
);
useHarnessStore.getState().removeEntityFromActiveSubsystem('enclosure', 'dev_a1');
assert(!useHarnessStore.getState().subsystems['connector-only'].devices.dev_a1);
assert(!useHarnessStore.getState().subsystems['connector-only'].connectors.con_a1);
assert(useHarnessStore.getState().harness?.connectors.some((connector) => connector.id === 'con_a1'));
useHarnessStore.getState().updateSubsystemEntityLayout(
  'devices',
  'dev_a1',
  { x: 999, y: 999 },
);
assert(
  !useHarnessStore.getState().subsystems['connector-only'].devices.dev_a1,
  'a stale position event must not restore a removed device',
);

const subsystemBeforeDeviceRemoval = structuredClone(subsystem);
const subsystemAfterDeviceRemoval = structuredClone(subsystem);
delete subsystemAfterDeviceRemoval.devices.dev_root;
delete subsystemAfterDeviceRemoval.connectors.con_a1;
const subsystemSavePayload = buildSubsystemSavePayload(
  subsystemBeforeDeviceRemoval,
  subsystemAfterDeviceRemoval,
);
assert.deepEqual(subsystemSavePayload.removed.devices, ['dev_root']);
assert.deepEqual(subsystemSavePayload.removed.connectors, ['con_a1']);

useHarnessStore.getState().loadHarness(harness as never);
const impact = useHarnessStore.getState().getDeleteImpact('enclosure', 'enc_a');
assert(impact.enclosureIds.includes('enc_a1'));
assert(impact.connectorIds.includes('con_a1'));
assert(impact.pathIds.includes('path_nested'));
useHarnessStore.getState().deleteEntityCascade('enclosure', 'enc_a');
assert(!useHarnessStore.getState().harness?.enclosures.some((enclosure) => enclosure.id === 'enc_a1'));
assert(!useHarnessStore.getState().harness?.paths.some((wirePath) => wirePath.id === 'path_nested'));

async function testRouteEndpoint() {
  const projectRoot = path.join(process.cwd(), `.tmp-routing-test-${process.pid}`);
  const harnessDir = path.join(projectRoot, 'public', 'user-data', 'harnesses', 'test');
  const libraryDir = path.join(projectRoot, 'public', 'user-data', 'connectors');
  fs.mkdirSync(libraryDir, { recursive: true });
  fs.writeFileSync(path.join(libraryDir, 'connector-library.json'), JSON.stringify(library));

  const routeHarness = structuredClone(harness);
  routeHarness.paths = [];
  routeHarness.connectors = routeHarness.connectors.filter((connector) => !connector.id.startsWith('con_wall_'));
  routeHarness.enclosures.push(
    { id: 'dev_external_1', name: 'External 1', parent: null, container: false, tags: [], properties: {} },
    { id: 'dev_external_2', name: 'External 2', parent: null, container: false, tags: [], properties: {} },
    { id: 'dev_internal', name: 'Internal', parent: 'enc_a', container: false, tags: [], properties: {} },
  );
  routeHarness.connectors.push(
    { id: 'con_external_1', name: 'External 1', parent: 'dev_external_1', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_external_2', name: 'External 2', parent: 'dev_external_2', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_internal', name: 'Internal', parent: 'dev_internal', connector_type: 'generic', tags: [], properties: {} },
    {
      id: 'con_bulkhead',
      name: 'A bulkhead',
      parent: 'enc_a',
      connector_type: 'generic_multipin',
      pin_count: 1,
      tags: ['zone:bulkhead'],
      properties: {},
    },
  );
  writeSheetsToDisk(harnessDir, splitHarness(routeHarness, sheetIds));
  const routingSubsystem: SubsystemDocument = {
    schema_version: '1.0.0',
    id: 'routing',
    name: 'Routing',
    tags: [],
    enclosures: {},
    devices: {
      dev_a1: { x: 40, y: 60, w: 220, h: 180 },
      dev_b: { x: 40, y: 60, w: 220, h: 180 },
    },
    connectors: {},
    device_connector_mode: {
      dev_a1: 'all',
      dev_b: 'all',
    },
  };
  const routingSubsystemFile = path.join(
    projectRoot,
    'public',
    'user-data',
    'subsystems',
    'test',
    'routing.json',
  );
  fs.mkdirSync(path.dirname(routingSubsystemFile), { recursive: true });
  fs.writeFileSync(routingSubsystemFile, JSON.stringify(routingSubsystem));

  const middleware = createApiMiddleware(projectRoot);
  const server = http.createServer((req, res) => middleware(req, res, () => {
    res.statusCode = 404;
    res.end();
  }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const request = {
    from: { connector_id: 'con_a1', pin_number: 1 },
    to: { connector_id: 'con_b', pin_number: 1 },
    signal_id: 'sig_TEST',
    subsystem_id: 'routing',
    request_id: 'integration-route',
  };
  try {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'RoutingTestAdmin', displayName: 'Routing Test Admin' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
    assert(cookie);

    const response = await fetch(`${base}/api/paths/route?harness=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(request),
    });
    assert.equal(response.status, 201);
    const result = await response.json() as {
      generated_connectors: string[];
      subsystem: SubsystemDocument;
    };
    assert.equal(result.generated_connectors.length, 3);
    const saved = readSheetedHarness(harnessDir);
    assert.equal(saved.paths.length, 1);
    assert.equal(saved.paths[0].nodes.length, 5);
    const savedRoutingSubsystem = JSON.parse(
      fs.readFileSync(routingSubsystemFile, 'utf-8'),
    ) as SubsystemDocument;
    assert.deepEqual(
      result.generated_connectors.filter((connectorId) =>
        !!savedRoutingSubsystem.connectors[connectorId]
      ),
      result.generated_connectors,
      'generated bulkheads must be persisted into the requesting subsystem',
    );
    const routedGraph = buildSubsystemGraphModel(
      saved as never,
      savedRoutingSubsystem,
      new Set(),
    );
    assert(
      result.generated_connectors.every((connectorId) =>
        routedGraph.graphNodes.some((node) =>
          node.id === `${SUBSYSTEM_CONNECTOR_PREFIX}${connectorId}`
          && node.data.wallMounted === true
        )
      ),
      'persisted generated bulkheads must render on subsystem frame walls',
    );
    assert.equal(
      routedGraph.graphEdges.length,
      4,
      'the subsystem path must render through generated bulkheads instead of one projected direct edge',
    );

    const retry = await fetch(`${base}/api/paths/route?harness=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(request),
    });
    assert.equal(retry.status, 200);
    const retryResult = await retry.json() as { idempotent: boolean };
    assert.equal(retryResult.idempotent, true);

    const rejected = await fetch(`${base}/api/paths/route?harness=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ ...request, request_id: 'occupied-route' }),
    });
    assert.equal(rejected.status, 409);
    assert.equal(readSheetedHarness(harnessDir).paths.length, 1, 'rejected route must not mutate files');

    const externalHalf = await fetch(`${base}/api/paths/route?harness=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        from: { connector_id: 'con_external_1', pin_number: 1 },
        to: { connector_id: 'con_bulkhead', pin_number: 1 },
        signal_id: 'sig_TEST',
        request_id: 'bulkhead-external-half',
      }),
    });
    assert.equal(externalHalf.status, 201);
    const externalResult = await externalHalf.json() as { generated_connectors: string[] };
    assert.deepEqual(
      externalResult.generated_connectors,
      [],
      'an explicit bulkhead must satisfy its own enclosure boundary',
    );

    const duplicateExternalSide = await fetch(`${base}/api/paths/route?harness=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        from: { connector_id: 'con_external_2', pin_number: 1 },
        to: { connector_id: 'con_bulkhead', pin_number: 1 },
        signal_id: 'sig_TEST',
        request_id: 'bulkhead-duplicate-external',
      }),
    });
    assert.equal(duplicateExternalSide.status, 409);
    assert.match(
      ((await duplicateExternalSide.json()) as { error: string }).error,
      /already has an external connection/,
    );

    const internalHalf = await fetch(`${base}/api/paths/route?harness=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        from: { connector_id: 'con_bulkhead', pin_number: 1 },
        to: { connector_id: 'con_internal', pin_number: 1 },
        signal_id: 'sig_TEST',
        request_id: 'bulkhead-internal-half',
      }),
    });
    assert.equal(internalHalf.status, 201);
    const internalResult = await internalHalf.json() as {
      path: { nodes: Array<{ kind: string; connector_id?: string }> };
      generated_connectors: string[];
    };
    assert.deepEqual(internalResult.generated_connectors, []);
    assert.deepEqual(
      internalResult.path.nodes.map((node) => node.connector_id),
      ['con_external_1', 'con_bulkhead', 'con_internal'],
      'opposite bulkhead sides must stitch into one continuous path',
    );
    assert.equal(
      readSheetedHarness(harnessDir).paths.length,
      2,
      'adding the second bulkhead side must extend the first path instead of duplicating cavity occupancy',
    );
    const internalRetry = await fetch(`${base}/api/paths/route?harness=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        from: { connector_id: 'con_bulkhead', pin_number: 1 },
        to: { connector_id: 'con_internal', pin_number: 1 },
        signal_id: 'sig_TEST',
        request_id: 'bulkhead-internal-half',
      }),
    });
    assert.equal(internalRetry.status, 200);
    assert.equal(
      ((await internalRetry.json()) as { idempotent: boolean }).idempotent,
      true,
      'a retried second-side route must not extend the path twice',
    );

    assert.equal(readSheetedHarness(harnessDir).paths.length, 2);

    const afterDelete = readSheetedHarness(harnessDir);
    const deletedEnclosures = new Set(['enc_a', 'enc_a1', 'dev_a1', 'dev_internal']);
    const deletedConnectors = new Set(afterDelete.connectors.filter((connector) =>
      connector.parent !== null && deletedEnclosures.has(connector.parent),
    ).map((connector) => connector.id));
    afterDelete.enclosures = afterDelete.enclosures.filter((enclosure) => !deletedEnclosures.has(enclosure.id));
    afterDelete.connectors = afterDelete.connectors.filter((connector) => !deletedConnectors.has(connector.id));
    afterDelete.paths = afterDelete.paths.filter((wirePath) => !wirePath.nodes.some((node) =>
      node.kind === 'connector' && deletedConnectors.has(node.connector_id),
    ));
    writeSheetedHarness(harnessDir, afterDelete);
    assert(!fs.existsSync(path.join(harnessDir, 'sheets', 'enc_a.json')));
    assert(!fs.existsSync(path.join(harnessDir, 'sheets', 'enc_a1.json')));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

await testRouteEndpoint();
console.log('Subsystem routing tests passed');
