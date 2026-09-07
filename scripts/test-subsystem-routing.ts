import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Node } from '@xyflow/react';
import {
  readSheetedSystem,
  splitSystem,
  verifyRoundTrip,
  writeSheetedSystem,
  writeSheetsToDisk,
  type SystemData,
} from '../server/sheets.js';
import {
  dissolveBranchPoint,
  getConnectorOccupancy,
  getPathSignalId,
  getBaseHarnessBundleId,
  getHarnessBundleLayoutValue,
  mergeConnectors,
  renumberConnectorPins,
  insertBranchPointOnPath,
} from '../src/lib/systemTopology.js';
import {
  ensureEnclosureBulkheadPlaceholders,
  planEnclosureRoute,
  planSheetRoute,
  routeRequestToken,
} from '../server/routing.js';
import { createApiMiddleware, validateSystemData } from '../server/api.js';
import {
  buildSubsystemGraphModel,
  clampNodeToParentBounds,
  findOverlappingWallMountedPeer,
  findOverlappingPassThroughPeer,
  getAbsoluteNodeCenter,
  projectNodeToEnclosureWall,
  GRAPH_Z_PIN_WIRE,
  SUBSYSTEM_CONNECTOR_PREFIX,
  SUBSYSTEM_DEVICE_PREFIX,
  SUBSYSTEM_FRAME_PREFIX,
} from '../src/components/graph/graphModel.js';
import { resolveParentResizeWithConnectorShove } from '../src/lib/parentResize.js';
import {
  buildSubsystemSavePayload,
  useSystemStore,
} from '../src/store/index.js';
import type { SubsystemDocument } from '../src/types/index.js';

const system: SystemData = {
  signalPropertyDefinitions: [],
  schema_version: '0.2.0-sheets',
  hierarchy: [
    { id: 'enc_a', name: 'A', parent: null, kind: 'enclosure', tags: [], properties: {} },
    { id: 'enc_a1', name: 'A1', parent: 'enc_a', kind: 'enclosure', tags: [], properties: {} },
    { id: 'dev_a1', name: 'Device A1', parent: 'enc_a1', kind: 'device', tags: [], properties: {} },
    { id: 'enc_b', name: 'B', parent: null, kind: 'enclosure', tags: [], properties: {} },
    { id: 'dev_b', name: 'Device B', parent: 'enc_b', kind: 'device', tags: [], properties: {} },
  ],
  connectors: [
    { id: 'con_a1', name: 'A1 endpoint', parent: 'dev_a1', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_b', name: 'B endpoint', parent: 'dev_b', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_wall_a1', name: 'A1 wall', parent: 'enc_a1', connector_type: 'generic_multipin', pin_count: 1, tags: ['generated'], properties: {} },
    { id: 'con_wall_a', name: 'A wall', parent: 'enc_a', connector_type: 'generic_multipin', pin_count: 1, tags: ['generated'], properties: {} },
    { id: 'con_wall_b', name: 'B wall', parent: 'enc_b', connector_type: 'generic_multipin', pin_count: 1, tags: ['generated'], properties: {} },
  ],
  branchPoints: [],
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
const split = splitSystem(system, sheetIds);
assert.deepEqual(verifyRoundTrip(system, split, sheetIds), []);
assert.equal(split.sheets.get(null)?.paths.length, 1, 'root owns the sibling bridge segment');
assert.equal(split.sheets.get('enc_a')?.paths.length, 1, 'parent/child bridge is materialized in enc_a');
assert.equal(split.sheets.get('enc_a1')?.paths.length, 1, 'deep local run remains in enc_a1');
assert.equal(split.sheets.get('enc_b')?.paths.length, 1, 'destination local run remains in enc_b');

const localSystem = structuredClone(system);
localSystem.paths = [{
  ...system.paths[0],
  id: 'path_local',
  nodes: [
    { kind: 'connector', connector_id: 'con_a1', pin_number: 1 },
    { kind: 'connector', connector_id: 'con_wall_a1', pin_number: 1 },
  ],
}];
const localSplit = splitSystem(localSystem, sheetIds);
assert.deepEqual(verifyRoundTrip(localSystem, localSplit, sheetIds), []);

// Splicing a measured hop must keep the run attached to adjacent node pairs.
// Leaving the original `con_wall_a -> con_wall_b` measurement in place once a
// branch point sits between them makes it unplaceable on any sheet, which used to
// silently drop it and then fail the round-trip check, blocking every save.
const measuredBranchPointSystem = structuredClone(system);
measuredBranchPointSystem.branchPoints = [{
  id: 'mp_measured',
  name: 'Measured branch point',
  parent: null,
  tags: [],
  properties: {},
}];
measuredBranchPointSystem.paths = [{
  ...system.paths[0],
  id: 'path_measured_branch',
  nodes: [
    { kind: 'connector', connector_id: 'con_wall_a', pin_number: 1 },
    { kind: 'connector', connector_id: 'con_wall_b', pin_number: 1 },
  ],
  measurements: [{
    from: { kind: 'connector', connector_id: 'con_wall_a', pin_number: 1 },
    to: { kind: 'connector', connector_id: 'con_wall_b', pin_number: 1 },
    length_mm: 22,
    note: 'sleeve this run',
  }],
}];
const originalMeasuredPath = structuredClone(measuredBranchPointSystem.paths[0]);
measuredBranchPointSystem.paths[0] = insertBranchPointOnPath(
  measuredBranchPointSystem.paths[0],
  'bundle:connector:con_wall_a|connector:con_wall_b',
  'mp_measured',
);
assert.deepEqual(
  measuredBranchPointSystem.paths[0].measurements,
  [
    {
      from: { kind: 'connector', connector_id: 'con_wall_a', pin_number: 1 },
      to: { kind: 'branch', branch_point_id: 'mp_measured' },
      length_mm: 11,
      note: 'sleeve this run',
    },
    {
      from: { kind: 'branch', branch_point_id: 'mp_measured' },
      to: { kind: 'connector', connector_id: 'con_wall_b', pin_number: 1 },
      length_mm: 11,
      note: 'sleeve this run',
    },
  ],
  'inserting a branch point on a measured hop splits the run across the two new hops',
);
assert.deepEqual(
  verifyRoundTrip(
    measuredBranchPointSystem,
    splitSystem(measuredBranchPointSystem, sheetIds),
    sheetIds,
  ),
  [],
  'a branch point on a measured hop must stay saveable',
);

// Dissolving that branch point folds the two runs back into the original hop.
const dissolved = dissolveBranchPoint(measuredBranchPointSystem, 'mp_measured');
assert.deepEqual(
  dissolved.paths[0].nodes,
  originalMeasuredPath.nodes,
  'dissolving the branch point restores the original node sequence',
);
assert.deepEqual(
  dissolved.paths[0].measurements,
  originalMeasuredPath.measurements,
  'dissolving the branch point restores the original measured run',
);
assert.deepEqual(
  verifyRoundTrip(dissolved, splitSystem(dissolved, sheetIds), sheetIds),
  [],
  'dissolving a branch point must stay saveable',
);

// An odd length still round-trips to the exact original total.
const oddPath = insertBranchPointOnPath(
  {
    ...originalMeasuredPath,
    measurements: [{ ...originalMeasuredPath.measurements[0], length_mm: 25 }],
  },
  'bundle:connector:con_wall_a|connector:con_wall_b',
  'mp_measured',
);
assert.deepEqual(
  oddPath.measurements.map((measurement) => measurement.length_mm),
  [12.5, 12.5],
  'an odd run splits without losing millimetres',
);

// A branch point on an unmeasured hop must not invent measurements.
const unmeasured = insertBranchPointOnPath(
  { ...originalMeasuredPath, measurements: [] },
  'bundle:connector:con_wall_a|connector:con_wall_b',
  'mp_measured',
);
assert.deepEqual(unmeasured.measurements, [], 'inserting a branch point on an unmeasured hop adds no measurements');

assert.equal(getPathSignalId({ signal_id: 'sig_TEST', tags: [] }), 'sig_TEST');
assert.equal(getPathSignalId({ signal_id: undefined, tags: ['signal:LEGACY'] }), 'sig_LEGACY');
assert.deepEqual(
  planSheetRoute(system, sheetIds, system.connectors[0], system.connectors[1]).crossedChildScopes,
  ['enc_a1', 'enc_a', 'enc_b'],
);
assert.deepEqual(
  planEnclosureRoute(system, system.connectors[0], system.connectors[1]).crossedChildScopes,
  ['enc_a1', 'enc_a', 'enc_b'],
  'enclosure routing must emit a bulkhead for every container wall crossed',
);
assert.deepEqual(
  planEnclosureRoute(system, system.connectors[0], system.connectors[1])
    .fromCrossedChildScopes,
  ['enc_a1', 'enc_a'],
);
assert.deepEqual(
  planEnclosureRoute(system, system.connectors[0], system.connectors[1])
    .toCrossedChildScopes,
  ['enc_b'],
);
// Nested box without its own sheet must still get a boundary bulkhead.
const inlineNestedSystem = structuredClone(system);
assert.deepEqual(
  planEnclosureRoute(
    inlineNestedSystem,
    inlineNestedSystem.connectors[0],
    inlineNestedSystem.connectors[1],
  ).crossedChildScopes,
  ['enc_a1', 'enc_a', 'enc_b'],
);
assert.deepEqual(
  planSheetRoute(
    inlineNestedSystem,
    new Set(['enc_a', 'enc_b']),
    inlineNestedSystem.connectors[0],
    inlineNestedSystem.connectors[1],
  ).crossedChildScopes,
  ['enc_a', 'enc_b'],
  'sheet-only planning skips inlined nested boxes; enclosure planning does not',
);
assert.equal(routeRequestToken('same-request'), routeRequestToken('same-request'));

const groupedBulkheadSystem: SystemData = {
  schema_version: '0.1.0',
  hierarchy: [
    { id: 'enc_left', name: 'Left box', parent: null, kind: 'enclosure', tags: [], properties: {} },
    { id: 'dev_left', name: 'Left device', parent: 'enc_left', kind: 'device', tags: [], properties: {} },
    { id: 'enc_right', name: 'Right box', parent: null, kind: 'enclosure', tags: [], properties: {} },
    { id: 'dev_right', name: 'Right device', parent: 'enc_right', kind: 'device', tags: [], properties: {} },
  ],
  connectors: [
    { id: 'con_left_1', name: 'Left connector 1', parent: 'dev_left', connector_type: 'generic', pin_count: 2, tags: [], properties: {} },
    { id: 'con_left_2', name: 'Left connector 2', parent: 'dev_left', connector_type: 'generic', pin_count: 1, tags: [], properties: {} },
    { id: 'con_right_1', name: 'Right connector 1', parent: 'dev_right', connector_type: 'generic', pin_count: 2, tags: [], properties: {} },
    { id: 'con_right_2', name: 'Right connector 2', parent: 'dev_right', connector_type: 'generic', pin_count: 1, tags: [], properties: {} },
  ],
  branchPoints: [],
  signals: [],
  signalPropertyDefinitions: [],
  paths: [
    {
      id: 'path_a',
      name: 'Signal A',
      tags: ['system:test'],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'con_left_1', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_right_1', pin_number: 1 },
      ],
      measurements: [],
    },
    {
      id: 'path_b',
      name: 'Signal B',
      tags: ['system:test'],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'con_left_1', pin_number: 2 },
        { kind: 'connector', connector_id: 'con_right_1', pin_number: 2 },
      ],
      measurements: [],
    },
    {
      id: 'path_c',
      name: 'Signal C',
      tags: ['system:test'],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'con_left_2', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_right_2', pin_number: 1 },
      ],
      measurements: [],
    },
  ],
};
const groupedRepair = ensureEnclosureBulkheadPlaceholders(groupedBulkheadSystem);
assert.equal(groupedRepair.createdConnectorIds.length, 4);
assert.deepEqual(groupedRepair.changedPathIds, ['path_a', 'path_b', 'path_c']);
const groupedPaths = new Map(groupedRepair.system.paths.map((wirePath) => [wirePath.id, wirePath]));
const connectorNodes = (pathId: string) =>
  groupedPaths.get(pathId)!.nodes.filter(
    (node): node is Extract<(typeof groupedRepair.system.paths)[number]['nodes'][number], { kind: 'connector' }> =>
      node.kind === 'connector',
  );
const pathANodes = connectorNodes('path_a');
const pathBNodes = connectorNodes('path_b');
const pathCNodes = connectorNodes('path_c');
assert.equal(pathANodes.length, 4);
assert.equal(pathBNodes.length, 4);
assert.equal(pathCNodes.length, 4);
assert.equal(
  pathANodes[1].connector_id,
  pathBNodes[1].connector_id,
  'signals A and B from connector 1 must share the left bulkhead placeholder',
);
assert.equal(
  pathANodes[2].connector_id,
  pathBNodes[2].connector_id,
  'signals A and B into connector 1 must share the right bulkhead placeholder',
);
assert.deepEqual([pathANodes[1].pin_number, pathBNodes[1].pin_number], [1, 2]);
assert.deepEqual([pathANodes[2].pin_number, pathBNodes[2].pin_number], [1, 2]);
assert.notEqual(
  pathANodes[1].connector_id,
  pathCNodes[1].connector_id,
  'signal C from connector 2 must use a separate left bulkhead placeholder',
);
assert.notEqual(
  pathANodes[2].connector_id,
  pathCNodes[2].connector_id,
  'signal C into connector 2 must use a separate right bulkhead placeholder',
);
assert.equal(
  groupedRepair.system.connectors.filter((connector) =>
    connector.properties.boundary_enclosure === 'enc_left'
  ).length,
  2,
);
assert.equal(
  groupedRepair.system.connectors.filter((connector) =>
    connector.properties.boundary_enclosure === 'enc_right'
  ).length,
  2,
);
const repeatedRepair = ensureEnclosureBulkheadPlaceholders(groupedRepair.system);
assert.deepEqual(repeatedRepair.createdConnectorIds, []);
assert.deepEqual(repeatedRepair.changedPathIds, []);
assert.deepEqual(repeatedRepair.system, groupedRepair.system, 'bulkhead repair must be idempotent');
const groupedSheetIds = new Set(['enc_left', 'enc_right']);
assert.deepEqual(
  verifyRoundTrip(
    groupedRepair.system,
    splitSystem(groupedRepair.system, groupedSheetIds),
    groupedSheetIds,
  ),
  [],
  'shared multi-pin placeholders must survive sheet split/assembly',
);

const groupedSubsystem: SubsystemDocument = {
  schema_version: '1.0.0',
  id: 'grouped-bulkheads',
  name: 'Grouped bulkheads',
  tags: [],
  enclosures: {
    enc_left: { x: 0, y: 0, w: 520, h: 360 },
    enc_right: { x: 760, y: 0, w: 520, h: 360 },
  },
  devices: {
    dev_left: { x: 80, y: 80, w: 220, h: 180 },
    dev_right: { x: 80, y: 80, w: 220, h: 180 },
  },
  connectors: {
    con_left_1: { x: 20, y: 50, w: 120, h: 36 },
    con_left_2: { x: 20, y: 100, w: 120, h: 36 },
    con_right_1: { x: 20, y: 50, w: 120, h: 36 },
    con_right_2: { x: 20, y: 100, w: 120, h: 36 },
  },
  device_connector_mode: {
    dev_left: 'selected',
    dev_right: 'selected',
  },
};
useSystemStore.getState().loadSystem(groupedBulkheadSystem as never);
useSystemStore.getState().loadSubsystems([groupedSubsystem]);
const normalizedGroupedSystem = useSystemStore.getState().system!;
const normalizedGroupedSubsystem = useSystemStore.getState().subsystems[groupedSubsystem.id];
const normalizedPlaceholderIds = normalizedGroupedSystem.connectors
  .filter((connector) => connector.properties.placeholder_reason === 'missing_enclosure_bulkhead')
  .map((connector) => connector.id);
assert.equal(normalizedPlaceholderIds.length, 4);
assert(
  normalizedPlaceholderIds.every((connectorId) =>
    Object.hasOwn(normalizedGroupedSubsystem.connectors, connectorId)
  ),
  'automatically repaired placeholders must be added to represented subsystem views',
);
const groupedGraph = buildSubsystemGraphModel(
  normalizedGroupedSystem,
  normalizedGroupedSubsystem,
);
assert(
  normalizedPlaceholderIds.every((connectorId) =>
    groupedGraph.graphNodes.some((node) =>
      node.id === `${SUBSYSTEM_CONNECTOR_PREFIX}${connectorId}`
      && node.data.wallMounted === true
    )
  ),
  'automatically repaired placeholders must render on their enclosure walls',
);
const sharedLeftPlaceholderId = pathANodes[1].connector_id;
useSystemStore.setState({ collabAvailable: false });
useSystemStore.getState().deletePathHarnessBundle('grouped:path-a', ['path_a']);
assert(
  useSystemStore.getState().system?.connectors.some(
    (connector) => connector.id === sharedLeftPlaceholderId,
  ),
  'deleting one signal must retain a placeholder still used by another signal',
);
useSystemStore.getState().deletePathHarnessBundle('grouped:path-b', ['path_b']);
assert(
  !useSystemStore.getState().system?.connectors.some(
    (connector) => connector.id === sharedLeftPlaceholderId,
  ),
  'deleting the final grouped signal must prune its unused generated placeholder',
);

const library = {
  connector_types: [
    { id: 'generic', name: 'Generic', pin_count: 1, crimp_spec: '', wire_gauge: '', notes: '' },
    { id: 'generic_multipin', name: 'Generic Multi-pin', pin_count: 0, crimp_spec: '', wire_gauge: '', notes: '' },
  ],
};
const overCapacity = structuredClone(localSystem);
overCapacity.paths[0].nodes[0] = { kind: 'connector', connector_id: 'con_a1', pin_number: 2 };
const overCapacityResult = validateSystemData(overCapacity, library);
assert.equal(overCapacityResult.valid, true);
assert(overCapacityResult.warnings.some((warning) => warning.includes('exceeding instance capacity')));

const missingPin = structuredClone(localSystem);
delete (missingPin.paths[0].nodes[0] as { pin_number?: number }).pin_number;
const missingPinResult = validateSystemData(missingPin, library);
assert.equal(missingPinResult.valid, false);
assert(missingPinResult.errors.some((error) => error.includes('missing or invalid pin number')));

const duplicate = structuredClone(localSystem);
duplicate.paths.push({ ...structuredClone(duplicate.paths[0]), id: 'path_duplicate' });
const duplicateResult = validateSystemData(duplicate, library);
assert.equal(duplicateResult.valid, false);
assert(duplicateResult.errors.some((error) => error.includes('occupied by multiple paths')));

const renumbered = renumberConnectorPins(localSystem, 'con_a1', [2, 1]);
assert.equal(
  renumbered.paths[0].nodes
    .filter((node) => node.kind === 'connector')
    .find((node) => node.connector_id === 'con_a1')?.pin_number,
  2,
);

const placementSystem = structuredClone(system);
placementSystem.hierarchy.push({
  id: 'dev_root',
  name: 'Root device',
  parent: null,
  kind: 'device',
  tags: [],
  properties: {},
});
placementSystem.connectors.push({
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
const placementGraph = buildSubsystemGraphModel(placementSystem, subsystem);
assert(placementGraph.graphNodes.some((node) => node.id === `${SUBSYSTEM_CONNECTOR_PREFIX}con_a1`));
assert(placementGraph.graphNodes.some((node) => node.id === `${SUBSYSTEM_DEVICE_PREFIX}dev_root`));

const appearanceSystem = structuredClone(placementSystem);
const appearanceDevice = appearanceSystem.hierarchy.find((item) => item.id === 'dev_a1');
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
  appearanceSystem,
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
assert.equal(appearanceDeviceNode?.data.image, 'device-board.png', 'subsystem devices must reuse the system image');
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
const freeformGraph = buildSubsystemGraphModel(placementSystem, freeformSubsystem);
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
const overflowGraph = buildSubsystemGraphModel(placementSystem, overflowSubsystem);
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
  placementSystem,
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

useSystemStore.setState({ collabAvailable: false });
useSystemStore.getState().loadSystem(placementSystem as never);
useSystemStore.getState().loadSubsystems([duplicatedDeviceSubsystem]);
assert(!useSystemStore.getState().subsystems.freeform.enclosures.dev_a1);
assert.deepEqual(
  useSystemStore.getState().subsystems.freeform.devices.dev_a1,
  freeformSubsystem.devices.dev_a1,
  'subsystem loading must keep the correctly classified device layout',
);
useSystemStore.getState().loadSubsystems([freeformSubsystem]);
useSystemStore.getState().resizeSubsystemEntityLayout(
  'enclosures',
  'enc_a1',
  { x: 25, y: 12, w: 430, h: 320 },
);
let resizedSubsystem = useSystemStore.getState().subsystems.freeform;
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
useSystemStore.getState().resizeSubsystemEntityLayout(
  'enclosures',
  'enc_a1',
  { x: 25, y: 12, w: 200, h: 160 },
);
resizedSubsystem = useSystemStore.getState().subsystems.freeform;
assert.deepEqual(
  resizedSubsystem.devices.dev_a1,
  { x: 0, y: 0, w: 220, h: 180 },
  'shrinking a frame must clamp child devices back inside the enclosure',
);
useSystemStore.getState().loadSubsystems([{
  ...freeformSubsystem,
  enclosures: { enc_a1: { x: 25, y: 12, w: 430, h: 320 } },
  devices: { dev_a1: { x: 25, y: 68, w: 220, h: 180 } },
}]);
useSystemStore.getState().resizeSubsystemEntityLayout(
  'devices',
  'dev_a1',
  { x: 35, y: 78, w: 230, h: 190 },
);
resizedSubsystem = useSystemStore.getState().subsystems.freeform;
assert.deepEqual(
  resizedSubsystem.connectors.con_a1,
  { x: 20, y: 40, w: 96, h: 36 },
  'top/left device resize must preserve its connector screen positions',
);

const connectorCollisionSystem = structuredClone(placementSystem);
connectorCollisionSystem.connectors.push({
  ...connectorCollisionSystem.connectors.find((connector) => connector.id === 'con_a1')!,
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
useSystemStore.getState().loadSystem(connectorCollisionSystem as never);
useSystemStore.getState().loadSubsystems([connectorCollisionSubsystem]);
useSystemStore.getState().setActiveSubsystem('resize-collision');
useSystemStore.getState().resizeSubsystemEntityLayout(
  'devices',
  'dev_a1',
  { x: 20, y: 20, w: 170, h: 200 },
);
const collisionResizeDocument = useSystemStore.getState().subsystems['resize-collision'];
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

useSystemStore.setState({
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
useSystemStore.getState().resizeHierarchyEntityLayout(
  'dev_a1',
  { x: 20, y: 20, w: 300, h: 200 },
  { x: 20, y: 20, w: 170, h: 200 },
);
assert.deepEqual(
  useSystemStore.getState().sizeLayouts.dev_a1,
  { w: 200, h: 200 },
  'hierarchy device resize must use the same connector collision stop',
);
assert.deepEqual(useSystemStore.getState().portLayouts.con_a1, { x: 100, y: 60 });
assert.deepEqual(useSystemStore.getState().portLayouts.con_a2, { x: 150, y: 60 });

const mergeSystem: SystemData = {
  signalPropertyDefinitions: [],
  schema_version: '0.2.0-sheets',
  hierarchy: [
    { id: 'enc_box', name: 'Box', parent: null, kind: 'enclosure', tags: [], properties: {} },
    { id: 'dev_in', name: 'Inside', parent: 'enc_box', kind: 'device', tags: [], properties: {} },
    { id: 'dev_out', name: 'Outside', parent: null, kind: 'device', tags: [], properties: {} },
  ],
  connectors: [
    {
      id: 'bh_a',
      name: 'Bulkhead A',
      parent: 'enc_box',
      connector_type: 'generic_multipin',
      pin_count: 1,
      tags: ['generated', 'unresolved', 'bulkhead'],
      properties: {
        placeholder_reason: 'missing_enclosure_bulkhead',
        bulkhead_group_anchor: 'connector:con_in',
        generated_for_connector: 'con_in',
        boundary_enclosure: 'enc_box',
      },
    },
    {
      id: 'bh_b',
      name: 'Bulkhead B',
      parent: 'enc_box',
      connector_type: 'generic_multipin',
      pin_count: 1,
      tags: ['generated', 'unresolved', 'bulkhead'],
      properties: {
        placeholder_reason: 'missing_enclosure_bulkhead',
        bulkhead_group_anchor: 'connector:con_in_2',
        generated_for_connector: 'con_in_2',
        boundary_enclosure: 'enc_box',
      },
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
    { id: 'con_in_2', name: 'Inside 2', parent: 'dev_in', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_out', name: 'Outside', parent: 'dev_out', connector_type: 'generic', tags: [], properties: {} },
  ],
  branchPoints: [],
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
        { kind: 'connector', connector_id: 'con_in_2', pin_number: 1 },
        { kind: 'connector', connector_id: 'bh_b', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_out', pin_number: 2 },
      ],
      measurements: [],
    },
  ],
};

const merged = mergeConnectors(mergeSystem, 'bh_a', 'bh_b');
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
  'shared-anchor proximity must use absolute child-node geometry',
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

assert.equal(
  findOverlappingPassThroughPeer(
    {
      id: '__subconnector_bh_a',
      parentId: '__subframe_enc_box',
      position: topWallA,
      size,
      wallMounted: true,
      passThrough: true,
    },
    [
      {
        id: '__subconnector_bh_b',
        parentId: '__subframe_enc_box',
        position: topWallB,
        size,
        wallMounted: true,
        passThrough: true,
      },
    ],
    enclosureSize,
  ),
  '__subconnector_bh_b',
  'overlapping wall-mounted bulkheads must still merge through the pass-through helper',
);

const inlineSize = { w: 140, h: 32 };
assert.equal(
  findOverlappingPassThroughPeer(
    {
      id: '__freecon_inline_a',
      position: { x: 100, y: 100 },
      size: inlineSize,
      passThrough: true,
    },
    [
      {
        id: '__freecon_inline_b',
        position: { x: 110, y: 108 },
        size: inlineSize,
        passThrough: true,
      },
    ],
  ),
  '__freecon_inline_b',
  'overlapping inline connectors must be merge candidates',
);
assert.equal(
  findOverlappingPassThroughPeer(
    {
      id: '__freecon_inline_a',
      position: { x: 100, y: 100 },
      size: inlineSize,
      passThrough: true,
    },
    [
      {
        id: '__freecon_inline_b',
        position: { x: 400, y: 400 },
        size: inlineSize,
        passThrough: true,
      },
    ],
  ),
  null,
  'distant inline connectors must not merge',
);
assert.equal(
  findOverlappingPassThroughPeer(
    {
      id: '__freecon_inline_a',
      position: { x: 100, y: 100 },
      size: inlineSize,
      passThrough: true,
    },
    [
      {
        id: '__freecon_endpoint',
        position: { x: 110, y: 108 },
        size: inlineSize,
        passThrough: false,
      },
    ],
  ),
  null,
  'endpoint connectors must not merge by overlap',
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
useSystemStore.setState({ collabAvailable: false, connectorLibrary: null });
useSystemStore.getState().loadSystem(mergeSystem as never);
useSystemStore.getState().loadSubsystems([mergeSubsystem]);
useSystemStore.getState().setActiveSubsystem('merge-sub');
const undoDepthBeforeMerge = useSystemStore.getState().undoStack.length;
const keptGenerated = useSystemStore.getState().mergeBulkheadConnectors('bh_a', 'bh_b');
assert.equal(keptGenerated, 'bh_b');
assert.equal(
  useSystemStore.getState().system?.connectors.some((connector) => connector.id === 'bh_a'),
  false,
);
assert.equal(useSystemStore.getState().subsystems['merge-sub'].connectors.bh_a, undefined);
assert.equal(
  useSystemStore.getState().undoStack.length,
  undoDepthBeforeMerge + 1,
  'merging bulkheads must record exactly one undoable entry',
);

useSystemStore.getState().loadSystem(mergeSystem as never);
useSystemStore.getState().loadSubsystems([mergeSubsystem]);
const keptReal = useSystemStore.getState().mergeBulkheadConnectors('bh_real', 'bh_a');
assert.equal(keptReal, 'bh_real', 'authored hardware must survive when merged with a generated placeholder');
assert.equal(
  useSystemStore.getState().system?.connectors.some((connector) => connector.id === 'bh_a'),
  false,
);
assert.ok(useSystemStore.getState().system?.connectors.some((connector) => connector.id === 'bh_real'));

const projectedSystem: SystemData = {
  signalPropertyDefinitions: [],
  schema_version: '0.2.0-sheets',
  hierarchy: [
    { id: 'dev_left', name: 'Left', parent: null, kind: 'device', tags: [], properties: {} },
    { id: 'dev_hidden', name: 'Hidden', parent: null, kind: 'device', tags: [], properties: {} },
    { id: 'dev_right', name: 'Right', parent: null, kind: 'device', tags: [], properties: {} },
  ],
  connectors: [
    { id: 'con_left', name: 'Left connector', parent: 'dev_left', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_hidden', name: 'Hidden connector', parent: 'dev_hidden', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_right', name: 'Right connector', parent: 'dev_right', connector_type: 'generic', tags: [], properties: {} },
  ],
  branchPoints: [],
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
const projectedGraph = buildSubsystemGraphModel(projectedSystem as never, projectedSubsystem);
assert.equal(projectedGraph.graphEdges.length, 1, 'hidden inline entities must not break subsystem connections');
assert.deepEqual(projectedGraph.graphEdges[0].data?.pathIds, ['path_projected']);
assert.equal(projectedGraph.graphEdges[0].sourceHandle, undefined, 'collapsed connectors must use their generic handle');
assert.equal(projectedGraph.graphEdges[0].targetHandle, undefined, 'collapsed connectors must use their generic handle');

const equipmentSummaryGraph = buildSubsystemGraphModel(
  projectedSystem as never,
  {
    ...projectedSubsystem,
    id: 'projected-summary',
    collapse_connectors: true,
  },
);
assert.equal(
  equipmentSummaryGraph.graphNodes.some((node) =>
    node.id.startsWith(SUBSYSTEM_CONNECTOR_PREFIX)
  ),
  false,
  'equipment summaries must hide individual connector cards',
);
assert.deepEqual(
  new Set([
    equipmentSummaryGraph.graphEdges[0].source,
    equipmentSummaryGraph.graphEdges[0].target,
  ]),
  new Set([
    `${SUBSYSTEM_DEVICE_PREFIX}dev_left`,
    `${SUBSYSTEM_DEVICE_PREFIX}dev_right`,
  ]),
  'equipment summaries must route links between owning device cards',
);
assert(
  equipmentSummaryGraph.graphNodes
    .filter((node) => node.id.startsWith(SUBSYSTEM_DEVICE_PREFIX))
    .every((node) => node.data.summaryConnector === true),
  'summary equipment cards must expose graph handles',
);
const equipmentSummaryEdge = equipmentSummaryGraph.graphEdges[0];
assert.equal(equipmentSummaryEdge.sourceHandle, 'summary-right');
assert.equal(equipmentSummaryEdge.targetHandle, 'summary-left');
const summaryRoute = [
  { x: 260, y: 70 },
  { x: 260, y: 90 },
  { x: 360, y: 90 },
  { x: 360, y: 70 },
];
const routedEquipmentSummaryGraph = buildSubsystemGraphModel(
  projectedSystem as never,
  {
    ...projectedSubsystem,
    id: 'projected-summary',
    collapse_connectors: true,
  },
  new Set(),
  null,
  {},
  new Map(),
  { [equipmentSummaryEdge.id]: summaryRoute },
);
assert.deepEqual(
  routedEquipmentSummaryGraph.graphEdges[0].data?.resolvedWaypoints,
  summaryRoute,
  'equipment summaries must render their generated parallel route',
);

const interiorFuseSystem: SystemData = {
  signalPropertyDefinitions: [],
  schema_version: '0.2.0-sheets',
  hierarchy: [
    { id: 'enc_dist', name: 'Distribution Box', parent: null, kind: 'enclosure', tags: [], properties: {} },
    { id: 'dev_fuse', name: 'Fuse Block', parent: 'enc_dist', kind: 'device', tags: [], properties: {} },
    { id: 'dev_out', name: 'Outside', parent: null, kind: 'device', tags: [], properties: {} },
  ],
  connectors: [
    { id: 'con_stud', name: 'Fuse A Ring Terminal', parent: 'dev_fuse', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_bulkhead', name: 'Dist A', parent: 'enc_dist', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_out', name: 'Outside In', parent: 'dev_out', connector_type: 'generic', tags: [], properties: {} },
  ],
  branchPoints: [],
  signals: [],
  paths: [
    {
      id: 'path_internal',
      name: 'Stud to bulkhead',
      tags: [],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'con_stud', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_bulkhead', pin_number: 1 },
      ],
      measurements: [],
    },
    {
      id: 'path_external',
      name: 'Bulkhead to outside',
      tags: [],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'con_bulkhead', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_out', pin_number: 1 },
      ],
      measurements: [],
    },
  ],
};
const interiorFuseSubsystem: SubsystemDocument = {
  schema_version: '1.0.0',
  id: 'fuse-interior',
  name: 'Fuse interior',
  tags: [],
  collapse_connectors: true,
  enclosures: {
    enc_dist: { x: 0, y: 0, w: 520, h: 360 },
  },
  devices: {
    dev_fuse: { x: 80, y: 80, w: 220, h: 160 },
    dev_out: { x: 700, y: 80, w: 220, h: 160 },
  },
  connectors: {
    con_stud: { x: 20, y: 40, w: 120, h: 32 },
    con_bulkhead: { x: -40, y: 80, w: 120, h: 32 },
    con_out: { x: 20, y: 40, w: 120, h: 32 },
  },
};
const interiorFuseGraph = buildSubsystemGraphModel(
  interiorFuseSystem as never,
  interiorFuseSubsystem,
);
assert.equal(
  interiorFuseGraph.graphEdges.length,
  1,
  'only the external distribution feed should remain after collapsing interior fuse wiring',
);
assert.deepEqual(
  new Set([
    interiorFuseGraph.graphEdges[0].source,
    interiorFuseGraph.graphEdges[0].target,
  ]),
  new Set([
    `${SUBSYSTEM_FRAME_PREFIX}enc_dist`,
    `${SUBSYSTEM_DEVICE_PREFIX}dev_out`,
  ]),
  'equipment summaries must not draw internal fuse-block wires to the parent box',
);

const projectedEdgeId = projectedGraph.graphEdges[0].id;
const routedSubsystemGraph = buildSubsystemGraphModel(
  projectedSystem as never,
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

useSystemStore.getState().loadSystem(projectedSystem as never);
useSystemStore.getState().loadSubsystems([projectedSubsystem]);
useSystemStore.getState().updateSubsystemEntityLayout(
  'connectors',
  'con_left',
  { x: 20, y: 30 },
);
assert.deepEqual(
  useSystemStore.getState().subsystems.projected.connectors.con_left,
  { x: 20, y: 30 },
  'moving an implicitly visible device connector must persist its first layout',
);
useSystemStore.getState().setSelectedHarnessBundle({
  id: 'subsystem:projected:bundle:connector:con_left|connector:con_right',
  pathIds: ['path_projected'],
});
useSystemStore.getState().deletePathHarnessBundle(
  'subsystem:projected:bundle:connector:con_left|connector:con_right',
  ['path_projected'],
);
assert.equal(
  useSystemStore.getState().system?.paths.length,
  0,
  'deleting a selected subsystem bundle must remove its underlying paths',
);
assert.equal(useSystemStore.getState().selectedHarnessBundle, null);
useSystemStore.getState().undo();
assert(useSystemStore.getState().system?.paths.some((wirePath) => wirePath.id === 'path_projected'));
const generatedDeletionSystem = structuredClone(projectedSystem);
generatedDeletionSystem.connectors.find((connector) => connector.id === 'con_hidden')!.properties = {
  generated_by_route: 'path_projected',
};
useSystemStore.getState().loadSystem(generatedDeletionSystem as never);
useSystemStore.getState().deletePathHarnessBundle(
  'subsystem:projected:bundle:connector:con_left|connector:con_right',
  ['path_projected'],
);
assert(
  !useSystemStore.getState().system?.connectors.some((connector) => connector.id === 'con_hidden'),
  'deleting a routed bundle must remove its now-unused generated bulkhead',
);

const mergeProjectedSystem = structuredClone(projectedSystem);
mergeProjectedSystem.branchPoints = [
  { id: 'mp_hidden', name: 'Hidden branch point', parent: null, tags: [], properties: {} },
];
mergeProjectedSystem.paths = [
  {
    id: 'path_merge_left',
    name: 'Left to branch point',
    tags: [],
    properties: {},
    nodes: [
      { kind: 'connector', connector_id: 'con_left', pin_number: 1 },
      { kind: 'branch', branch_point_id: 'mp_hidden' },
    ],
    measurements: [],
  },
  {
    id: 'path_merge_right',
    name: 'Branch Point to right',
    tags: [],
    properties: {},
    nodes: [
      { kind: 'branch', branch_point_id: 'mp_hidden' },
      { kind: 'connector', connector_id: 'con_right', pin_number: 1 },
    ],
    measurements: [],
  },
];
const mergeProjectedGraph = buildSubsystemGraphModel(
  mergeProjectedSystem as never,
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
assert.equal(
  mergeProjectedGraph.graphEdges[0].zIndex,
  GRAPH_Z_PIN_WIRE,
  'pin-attached wires must render above the expanded cavity table',
);

{
  assert.equal(
    getBaseHarnessBundleId('bundle:branch:mp_1|connector:con_a#pin:2|'),
    'bundle:branch:mp_1|connector:con_a',
  );
  assert.equal(
    getBaseHarnessBundleId('bundle:branch:mp_1|connector:con_a~thru:connector:con_c#pin:2|'),
    'bundle:branch:mp_1|connector:con_a',
  );
  const layouts = { 'bundle:a|b': [{ x: 10, y: 20 }] };
  assert.deepEqual(
    getHarnessBundleLayoutValue(layouts, 'bundle:a|b#pin:1|'),
    [{ x: 10, y: 20 }],
    'pin-expanded edges must reuse the collapsed bundle route',
  );
}

const routedExpandedGraph = buildSubsystemGraphModel(
  mergeProjectedSystem as never,
  projectedSubsystem,
  new Set(['con_left', 'con_right']),
  null,
  {},
  new Map(),
  {
    'subsystem:projected:bundle:connector:con_left|connector:con_right': [
      { x: 120, y: 40 },
    ],
  },
);
assert.deepEqual(
  routedExpandedGraph.graphEdges[0]?.data?.resolvedWaypoints,
  [{ x: 120, y: 40 }],
  'expanded pin edges must keep waypoints stored on the base bundle id',
);

useSystemStore.getState().loadSystem(placementSystem as never);
useSystemStore.getState().loadSubsystems([subsystem]);
useSystemStore.getState().removeEntityFromActiveSubsystem('connector', 'con_a1');
assert(useSystemStore.getState().system?.connectors.some((connector) => connector.id === 'con_a1'));
assert(!useSystemStore.getState().subsystems.test.connectors.con_a1);
useSystemStore.getState().updateSubsystemEntityLayout(
  'connectors',
  'con_a1',
  { x: 999, y: 999 },
);
assert(
  !useSystemStore.getState().subsystems.test.connectors.con_a1,
  'a stale position event must not restore a removed connector',
);
useSystemStore.getState().removeEntityFromActiveSubsystem('connector', 'con_root');
assert(useSystemStore.getState().system?.connectors.some((connector) => connector.id === 'con_root'));
assert(useSystemStore.getState().subsystems.test.hidden_connectors?.includes('con_root'));

const connectorOnlySubsystem: SubsystemDocument = {
  schema_version: '1.0.0',
  id: 'connector-only',
  name: 'Connector only',
  tags: [],
  enclosures: {},
  devices: {},
  connectors: {},
};
useSystemStore.getState().loadSystem(placementSystem as never);
useSystemStore.setState({
  portLayouts: { con_a1: { x: 77, y: 55 } },
  sizeLayouts: { con_a1: { w: 110, h: 44 }, dev_a1: { w: 400, h: 300 } },
});
useSystemStore.getState().loadSubsystems([connectorOnlySubsystem]);
useSystemStore.getState().addEntityToActiveSubsystem('connector', 'con_a1');
const connectorOnlyDocument = useSystemStore.getState().subsystems['connector-only'];
assert(connectorOnlyDocument.enclosures.enc_a1);
assert(
  connectorOnlyDocument.enclosures.enc_a,
  'adding a nested connector must also spawn every ancestor enclosure frame',
);
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
useSystemStore.getState().removeEntityFromActiveSubsystem('enclosure', 'dev_a1');
assert(!useSystemStore.getState().subsystems['connector-only'].devices.dev_a1);
assert(!useSystemStore.getState().subsystems['connector-only'].connectors.con_a1);
assert(useSystemStore.getState().system?.connectors.some((connector) => connector.id === 'con_a1'));
useSystemStore.getState().updateSubsystemEntityLayout(
  'devices',
  'dev_a1',
  { x: 999, y: 999 },
);
assert(
  !useSystemStore.getState().subsystems['connector-only'].devices.dev_a1,
  'a stale position event must not restore a removed device',
);

const nestedSpawnSubsystem: SubsystemDocument = {
  schema_version: '1.0.0',
  id: 'nested-spawn',
  name: 'Nested spawn',
  tags: [],
  enclosures: {},
  devices: {},
  connectors: {},
};
useSystemStore.getState().loadSystem(placementSystem as never);
useSystemStore.getState().loadSubsystems([nestedSpawnSubsystem]);
useSystemStore.getState().addEntityToActiveSubsystem('enclosure', 'dev_a1');
const nestedSpawnDocument = useSystemStore.getState().subsystems['nested-spawn'];
assert(nestedSpawnDocument.devices.dev_a1, 'spawned device must be present');
assert(nestedSpawnDocument.enclosures.enc_a1, 'immediate parent box must spawn');
assert(nestedSpawnDocument.enclosures.enc_a, 'grandparent box must spawn recursively');
assert.equal(
  nestedSpawnDocument.enclosures.enc_a1.w! < nestedSpawnDocument.enclosures.enc_a.w!,
  true,
  'nested child frames should be laid out smaller than their parent frame',
);
const nestedSpawnGraph = buildSubsystemGraphModel(
  placementSystem as never,
  nestedSpawnDocument,
);
const outerFrameNode = nestedSpawnGraph.graphNodes.find(
  (node) => node.id === `${SUBSYSTEM_FRAME_PREFIX}enc_a`,
);
const innerFrameNode = nestedSpawnGraph.graphNodes.find(
  (node) => node.id === `${SUBSYSTEM_FRAME_PREFIX}enc_a1`,
);
const nestedDeviceNode = nestedSpawnGraph.graphNodes.find(
  (node) => node.id === `${SUBSYSTEM_DEVICE_PREFIX}dev_a1`,
);
assert(outerFrameNode, 'outer ancestor frame must render');
assert.equal(
  innerFrameNode?.parentId,
  `${SUBSYSTEM_FRAME_PREFIX}enc_a`,
  'inner box must nest inside its parent frame',
);
assert.equal(
  nestedDeviceNode?.parentId,
  `${SUBSYSTEM_FRAME_PREFIX}enc_a1`,
  'device must remain parented to its immediate enclosure frame',
);
useSystemStore.getState().removeEntityFromActiveSubsystem('enclosure', 'enc_a');
assert(
  !useSystemStore.getState().subsystems['nested-spawn'].enclosures.enc_a1,
  'removing an outer frame must also remove nested descendant frames',
);
assert(
  !useSystemStore.getState().subsystems['nested-spawn'].devices.dev_a1,
  'removing an outer frame must also remove nested devices',
);

const systemLayoutSubsystem: SubsystemDocument = {
  schema_version: '1.0.0',
  id: 'system-layout',
  name: 'System layout',
  tags: [],
  enclosures: {},
  devices: {},
  connectors: {},
};
useSystemStore.getState().loadSystem(placementSystem as never);
useSystemStore.setState({
  nodeLayouts: {
    enc_a: { x: 120, y: 80 },
    enc_a1: { x: 24, y: 32 },
    dev_a1: { x: 48, y: 64 },
  },
  sizeLayouts: {
    enc_a: { w: 800, h: 600 },
    enc_a1: { w: 500, h: 400 },
    dev_a1: { w: 300, h: 200 },
    con_a1: { w: 88, h: 40 },
  },
  portLayouts: { con_a1: { x: 18, y: 22 } },
  freePortLayouts: {},
});
useSystemStore.getState().loadSubsystems([systemLayoutSubsystem]);
useSystemStore.getState().addEntityToActiveSubsystem('enclosure', 'dev_a1');
const spawnedFromSystem = useSystemStore.getState().subsystems['system-layout'];
assert.deepEqual(
  spawnedFromSystem.enclosures.enc_a,
  { x: 120, y: 80, w: 800, h: 600 },
  'spawned ancestor frames must copy system node and size layouts',
);
assert.deepEqual(
  spawnedFromSystem.enclosures.enc_a1,
  { x: 24, y: 32, w: 500, h: 400 },
  'spawned nested frames must copy their system-relative physical layout',
);
assert.deepEqual(
  spawnedFromSystem.devices.dev_a1,
  { x: 48, y: 64 },
  'spawned devices must copy system position and omit size so they inherit sizeLayouts',
);

useSystemStore.getState().updateSubsystemEntityLayout(
  'enclosures',
  'enc_a',
  { x: 1, y: 2, w: 100, h: 90 },
);
useSystemStore.getState().updateSubsystemEntityLayout(
  'devices',
  'dev_a1',
  { x: 9, y: 10, w: 50, h: 40 },
);
useSystemStore.getState().resetActiveSubsystemLayoutFromSystem();
const resetFromSystem = useSystemStore.getState().subsystems['system-layout'];
assert.deepEqual(
  resetFromSystem.enclosures.enc_a,
  { x: 120, y: 80, w: 800, h: 600 },
  'reset must restore frame geometry from the system physical layout',
);
assert.deepEqual(
  resetFromSystem.devices.dev_a1,
  { x: 48, y: 64 },
  'reset must restore device position and drop local size overrides',
);
assert.deepEqual(
  Object.keys(resetFromSystem.devices).sort(),
  Object.keys(spawnedFromSystem.devices).sort(),
  'reset must not change subsystem membership',
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

useSystemStore.getState().loadSystem(system as never);
const impact = useSystemStore.getState().getDeleteImpact('enclosure', 'enc_a');
assert(impact.enclosureIds.includes('enc_a1'));
assert(impact.connectorIds.includes('con_a1'));
assert(impact.pathIds.includes('path_nested'));
useSystemStore.getState().deleteEntityCascade('enclosure', 'enc_a');
assert(!useSystemStore.getState().system?.hierarchy.some((enclosure) => enclosure.id === 'enc_a1'));
assert(!useSystemStore.getState().system?.paths.some((wirePath) => wirePath.id === 'path_nested'));

async function testRouteEndpoint() {
  const projectRoot = path.join(process.cwd(), `.tmp-routing-test-${process.pid}`);
  const systemDir = path.join(projectRoot, 'public', 'user-data', 'systems', 'test');
  const libraryDir = path.join(projectRoot, 'public', 'user-data', 'connectors');
  fs.mkdirSync(libraryDir, { recursive: true });
  fs.writeFileSync(path.join(libraryDir, 'connector-library.json'), JSON.stringify(library));

  const routeSystem = structuredClone(system);
  routeSystem.paths = [];
  routeSystem.connectors = routeSystem.connectors.filter((connector) => !connector.id.startsWith('con_wall_'));
  routeSystem.hierarchy.push(
    { id: 'dev_external_1', name: 'External 1', parent: null, kind: 'device', tags: [], properties: {} },
    { id: 'dev_external_2', name: 'External 2', parent: null, kind: 'device', tags: [], properties: {} },
    { id: 'dev_inline_left', name: 'Inline left', parent: null, kind: 'device', tags: [], properties: {} },
    { id: 'dev_inline_right', name: 'Inline right', parent: null, kind: 'device', tags: [], properties: {} },
    { id: 'dev_internal', name: 'Internal', parent: 'enc_a', kind: 'device', tags: [], properties: {} },
    { id: 'dev_dot_internal', name: 'Dot internal', parent: 'enc_a', kind: 'device', tags: [], properties: {} },
    { id: 'dev_dot_internal_2', name: 'Dot internal 2', parent: 'enc_a', kind: 'device', tags: [], properties: {} },
  );
  routeSystem.connectors.push(
    { id: 'con_external_1', name: 'External 1', parent: 'dev_external_1', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_external_2', name: 'External 2', parent: 'dev_external_2', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_inline_left', name: 'Inline left', parent: 'dev_inline_left', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_inline_right', name: 'Inline right', parent: 'dev_inline_right', connector_type: 'generic', tags: [], properties: {} },
    {
      id: 'con_inline',
      name: 'Inline disconnect',
      parent: null,
      connector_type: 'generic_multipin',
      mounting: 'inline',
      pin_count: 1,
      tags: [],
      properties: {},
    },
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
    { id: 'con_dot_internal', name: 'Dot internal', parent: 'dev_dot_internal', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_dot_internal_2', name: 'Dot internal 2', parent: 'dev_dot_internal_2', connector_type: 'generic', tags: [], properties: {} },
    {
      id: 'con_dot_1',
      name: 'Dot 1',
      parent: 'enc_a',
      connector_type: 'generic_multipin',
      pin_count: 1,
      // Not tagged 'generated'/'unresolved' — an authored dot, so the
      // orphaned-placeholder prune in ensureEnclosureBulkheadPlaceholders
      // (which targets untethered legacy auto-bulkheads) leaves it alone.
      tags: ['bulkhead', 'dot'],
      properties: { bulkhead_display: 'dot' },
    },
    {
      id: 'con_dot_2',
      name: 'Dot 2',
      parent: 'enc_a',
      connector_type: 'generic_multipin',
      pin_count: 1,
      tags: ['bulkhead', 'dot'],
      properties: { bulkhead_display: 'dot' },
    },
  );
  writeSheetsToDisk(systemDir, splitSystem(routeSystem, sheetIds));
  const routingSubsystem: SubsystemDocument = {
    schema_version: '1.0.0',
    id: 'routing',
    name: 'Routing',
    tags: [],
    enclosures: {},
    devices: {
      dev_a1: { x: 40, y: 60, w: 220, h: 180 },
      dev_b: { x: 40, y: 60, w: 220, h: 180 },
      dev_external_2: { x: 300, y: 60, w: 220, h: 180 },
    },
    connectors: {},
    device_connector_mode: {
      dev_a1: 'all',
      dev_b: 'all',
      dev_external_2: 'all',
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
    const signup = await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'RoutingTestEditor',
        displayName: 'Routing Test Editor',
        role: 'editor',
      }),
    });
    assert.equal(signup.status, 201);
    const cookie = signup.headers.get('set-cookie')?.split(';', 1)[0];
    assert(cookie);

    const response = await fetch(`${base}/api/paths/route?system=test`, {
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
    const saved = readSheetedSystem(systemDir);
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

    const retry = await fetch(`${base}/api/paths/route?system=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(request),
    });
    assert.equal(retry.status, 200);
    const retryResult = await retry.json() as { idempotent: boolean };
    assert.equal(retryResult.idempotent, true);

    const rejected = await fetch(`${base}/api/paths/route?system=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ ...request, request_id: 'occupied-route' }),
    });
    assert.equal(rejected.status, 409);
    assert.equal(readSheetedSystem(systemDir).paths.length, 1, 'rejected route must not mutate files');

    const externalHalf = await fetch(`${base}/api/paths/route?system=test`, {
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

    const duplicateExternalSide = await fetch(`${base}/api/paths/route?system=test`, {
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

    const internalHalf = await fetch(`${base}/api/paths/route?system=test`, {
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
      readSheetedSystem(systemDir).paths.length,
      2,
      'adding the second bulkhead side must extend the first path instead of duplicating cavity occupancy',
    );
    const internalRetry = await fetch(`${base}/api/paths/route?system=test`, {
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

    assert.equal(readSheetedSystem(systemDir).paths.length, 2);

    // Two visual dots mounted on the SAME enclosure wall are peer
    // feed-throughs, not one nested "inside" the other. Joining them must
    // stay on the external side even when both dots' existing wires are
    // genuinely internal — otherwise dot-to-dot routing on one wall always
    // reports a false "already has an internal connection" conflict.
    // Give each dot its first wire via the draft-connector flow (matching
    // how a freshly dragged-out dot is created), so each is already a
    // terminal single-wire dot before the actual dot-to-dot request.
    const dotSeed1 = await fetch(`${base}/api/paths/route?system=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        from: { connector_id: 'con_dot_internal', pin_number: 1 },
        to: { connector_id: 'con_dot_1', pin_number: 1 },
        signal_id: 'sig_TEST',
        request_id: 'dot-seed-1',
        draft_connector: { id: 'con_dot_1', parent: 'enc_a' },
      }),
    });
    assert.equal(
      dotSeed1.status,
      201,
      `dot-seed-1 must succeed, got: ${await dotSeed1.clone().text()}`,
    );
    const dotSeed2 = await fetch(`${base}/api/paths/route?system=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        from: { connector_id: 'con_dot_internal_2', pin_number: 1 },
        to: { connector_id: 'con_dot_2', pin_number: 1 },
        signal_id: 'sig_TEST',
        request_id: 'dot-seed-2',
        draft_connector: { id: 'con_dot_2', parent: 'enc_a' },
      }),
    });
    assert.equal(
      dotSeed2.status,
      201,
      `dot-seed-2 must succeed, got: ${await dotSeed2.clone().text()}`,
    );

    const dotToDot = await fetch(`${base}/api/paths/route?system=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        from: { connector_id: 'con_dot_1', pin_number: 1 },
        to: { connector_id: 'con_dot_2', pin_number: 1 },
        signal_id: 'sig_TEST',
        request_id: 'dot-to-dot',
      }),
    });
    assert.equal(
      dotToDot.status,
      201,
      `dot-to-dot routing on the same wall must succeed, got: ${await dotToDot.clone().text()}`,
    );
    const dotToDotResult = await dotToDot.json() as {
      path: { nodes: Array<{ connector_id?: string }> };
    };
    assert.deepEqual(
      dotToDotResult.path.nodes.map((node) => node.connector_id),
      ['con_dot_internal', 'con_dot_1', 'con_dot_2', 'con_dot_internal_2'],
      'joining two same-wall dots must stitch both existing wires into one continuous path',
    );
    assert.equal(
      readSheetedSystem(systemDir).paths.length,
      3,
      'the two dot-seed paths merge into one when the dots are joined',
    );

    const inlineLeft = await fetch(`${base}/api/paths/route?system=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        from: { connector_id: 'con_inline_left', pin_number: 1 },
        to: { connector_id: 'con_inline', pin_number: 1 },
        signal_id: 'sig_TEST',
        request_id: 'inline-left-half',
      }),
    });
    assert.equal(inlineLeft.status, 201);
    const inlineRight = await fetch(`${base}/api/paths/route?system=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        from: { connector_id: 'con_inline', pin_number: 1 },
        to: { connector_id: 'con_inline_right', pin_number: 1 },
        signal_id: 'sig_TEST',
        request_id: 'inline-right-half',
      }),
    });
    assert.equal(inlineRight.status, 201);
    const inlineResult = await inlineRight.json() as {
      path: { nodes: Array<{ connector_id?: string }> };
    };
    assert.deepEqual(
      inlineResult.path.nodes.map((node) => node.connector_id),
      ['con_inline_left', 'con_inline', 'con_inline_right'],
      'the second side of an inline connector must extend the existing logical path',
    );
    const inlineThirdSide = await fetch(`${base}/api/paths/route?system=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        from: { connector_id: 'con_inline', pin_number: 1 },
        to: { connector_id: 'con_external_2', pin_number: 1 },
        signal_id: 'sig_TEST',
        request_id: 'inline-third-side',
      }),
    });
    assert.equal(inlineThirdSide.status, 409);
    assert.match(
      ((await inlineThirdSide.json()) as { error: string }).error,
      /already has both connections/,
    );
    assert.equal(readSheetedSystem(systemDir).paths.length, 4);

    const draftDotRoute = await fetch(`${base}/api/paths/route?system=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        from: { connector_id: 'con_external_2', pin_number: 1 },
        to: { connector_id: 'con_dot_draft', pin_number: 1 },
        signal_id: 'sig_TEST',
        subsystem_id: 'routing',
        request_id: 'draft-dot-route',
        draft_connector: {
          id: 'con_dot_draft',
          name: 'Draft visual dot',
          parent: 'dev_external_2',
          x: 84,
          y: 66,
        },
      }),
    });
    assert.equal(draftDotRoute.status, 201);
    const draftDotResult = await draftDotRoute.json() as {
      draft_connector_id: string;
      path: { nodes: Array<{ connector_id?: string }> };
      subsystem: SubsystemDocument;
    };
    assert.equal(draftDotResult.draft_connector_id, 'con_dot_draft');
    assert.equal(
      draftDotResult.path.nodes.some((node) => node.connector_id === 'con_dot_draft'),
      true,
      'the provisional dot must become a real endpoint only with its routed wire',
    );
    const savedDraftDot = readSheetedSystem(systemDir).connectors.find(
      (connector) => connector.id === 'con_dot_draft',
    );
    assert.equal(savedDraftDot?.properties.bulkhead_display, 'dot');
    assert.equal(savedDraftDot?.mounting, 'inline');
    assert.deepEqual(
      draftDotResult.subsystem.connectors.con_dot_draft,
      { x: 84, y: 66, w: 18, h: 18 },
      'the committed dot must keep its preview position',
    );

    const afterDelete = readSheetedSystem(systemDir);
    const deletedEnclosures = new Set([
      'enc_a', 'enc_a1', 'dev_a1', 'dev_internal', 'dev_dot_internal', 'dev_dot_internal_2',
    ]);
    const deletedConnectors = new Set(afterDelete.connectors.filter((connector) =>
      connector.parent !== null && deletedEnclosures.has(connector.parent),
    ).map((connector) => connector.id));
    afterDelete.hierarchy = afterDelete.hierarchy.filter((enclosure) => !deletedEnclosures.has(enclosure.id));
    afterDelete.connectors = afterDelete.connectors.filter((connector) => !deletedConnectors.has(connector.id));
    afterDelete.paths = afterDelete.paths.filter((wirePath) => !wirePath.nodes.some((node) =>
      node.kind === 'connector' && deletedConnectors.has(node.connector_id),
    ));
    writeSheetedSystem(systemDir, afterDelete);
    assert(!fs.existsSync(path.join(systemDir, 'sheets', 'enc_a.json')));
    assert(!fs.existsSync(path.join(systemDir, 'sheets', 'enc_a1.json')));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

await testRouteEndpoint();
console.log('Subsystem routing tests passed');
