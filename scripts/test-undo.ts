import { useSystemStore } from '../src/store/index.js';
import { deriveHarnessBundles, deriveWires } from '../src/lib/systemTopology.js';
import type { SystemData } from '../src/types/index.js';

const fixture: SystemData = {
  signalPropertyDefinitions: [],
  schema_version: '0.1.0',
  name: 'Undo fixture',
  hierarchy: [
    { id: 'dev_a', name: 'Device A', parent: null, kind: 'device', tags: [], properties: {} },
    { id: 'dev_b', name: 'Device B', parent: null, kind: 'device', tags: [], properties: {} },
  ],
  connectors: [
    {
      id: 'con_a',
      name: 'Connector A',
      parent: 'dev_a',
      connector_type: 'generic',
      pin_count: 1,
      tags: [],
      properties: {},
    },
    {
      id: 'con_b',
      name: 'Connector B',
      parent: 'dev_b',
      connector_type: 'generic',
      pin_count: 1,
      tags: [],
      properties: {},
    },
  ],
  branchPoints: [],
  paths: [{
    id: 'path_wire',
    name: 'Wire',
    signal_id: 'sig_power',
    tags: [],
    properties: {},
    nodes: [
      { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
      { kind: 'connector', connector_id: 'con_b', pin_number: 1 },
    ],
    measurements: [],
  }],
  signals: [{ id: 'sig_power', name: 'Power', tags: [], properties: {} }],
};

let failures = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}`);
  }
}

function reset(data: SystemData = fixture) {
  useSystemStore.getState().resetForSystemSwitch();
  useSystemStore.getState().setCollabAvailable(false);
  useSystemStore.getState().loadSystem(structuredClone(data));
  useSystemStore.setState({
    undoStack: [],
    redoStack: [],
    selectedItem: null,
    selectedHarnessBundle: null,
    selectedTextBoxId: null,
  });
}

reset();
useSystemStore.getState().setSelectedHarnessBundle({ id: 'bundle:test', pathIds: ['path_wire'] });
useSystemStore.getState().deletePathHarnessBundle('bundle:test', ['path_wire']);
check('deleting a path removes it', useSystemStore.getState().system?.paths.length === 0);
useSystemStore.getState().undo();
check(
  'undo restores a deleted path',
  useSystemStore.getState().system?.paths.some((path) => path.id === 'path_wire') === true,
);
check(
  'undo restores deleted path selection',
  useSystemStore.getState().selectedHarnessBundle?.pathIds.includes('path_wire') === true,
);

reset();
const routePointBundleId = 'bundle:connector:con_a|connector:con_b';
useSystemStore.getState().setEdgeWaypoints(routePointBundleId, [
  { x: 40, y: 50 },
  { x: 80, y: 50 },
]);
useSystemStore.getState().setSelectedHarnessBundle({
  id: routePointBundleId,
  pathIds: ['path_wire'],
  routePoint: { index: 0 },
});
useSystemStore.getState().deleteSelectedRoutePoint();
check(
  'deleting a selected route point removes that bend',
  (useSystemStore.getState().waypointLayouts[routePointBundleId] ?? []).length === 1,
);
check(
  'deleting a selected route point keeps the bundle selected',
  useSystemStore.getState().selectedHarnessBundle?.pathIds.includes('path_wire') === true
    && useSystemStore.getState().selectedHarnessBundle?.routePoint == null,
);
check(
  'deleting a selected route point does not delete the path',
  useSystemStore.getState().system?.paths.some((path) => path.id === 'path_wire') === true,
);

reset();
useSystemStore.getState().renameEntity('connector', 'con_a', 'Renamed A');
useSystemStore.getState().undo();
check(
  'undo reverts a rename',
  useSystemStore.getState().system?.connectors.find((item) => item.id === 'con_a')?.name
    === 'Connector A',
);

reset();
useSystemStore.getState().renameEntity('connector', 'con_a', 'My rename');
const concurrentSystem = structuredClone(useSystemStore.getState().system!);
concurrentSystem.connectors.find((item) => item.id === 'con_b')!.name = 'Concurrent rename';
useSystemStore.setState({ system: concurrentSystem });
useSystemStore.getState().undo();
check(
  'scoped undo reverts my entity',
  useSystemStore.getState().system?.connectors.find((item) => item.id === 'con_a')?.name
    === 'Connector A',
);
check(
  'scoped undo preserves an unrelated concurrent entity',
  useSystemStore.getState().system?.connectors.find((item) => item.id === 'con_b')?.name
    === 'Concurrent rename',
);

reset();
useSystemStore.getState().pushUndoSnapshot('typing:no-change');
useSystemStore.getState().commitUndoSnapshot();
check('an unchanged editing session creates no entry', useSystemStore.getState().undoStack.length === 0);

reset();
for (const notes of ['t', 'ty', 'typ', 'typi', 'typin', 'typing']) {
  useSystemStore.getState().updateManufacturingNotes('bundle_1', notes);
}
check('a simulated typing burst creates one entry', useSystemStore.getState().undoStack.length === 1);
useSystemStore.getState().undo();
check(
  'typing burst undo removes the whole edit',
  useSystemStore.getState().manufacturing.bundles.bundle_1?.notes === undefined,
);

reset();
useSystemStore.getState().renameEntity('connector', 'con_a', 'Redo name');
useSystemStore.getState().undo();
useSystemStore.getState().redo();
check(
  'redo reapplies an undone edit',
  useSystemStore.getState().system?.connectors.find((item) => item.id === 'con_a')?.name
    === 'Redo name',
);
useSystemStore.getState().undo();
useSystemStore.getState().updateConnectorProperty('con_b', 'note', 'new edit');
check('a new edit clears redo', useSystemStore.getState().redoStack.length === 0);

reset();
for (let index = 0; index < 65; index += 1) {
  useSystemStore.getState().updateNodePosition(`node_${index}`, index, index);
}
check('undo depth caps at 60', useSystemStore.getState().undoStack.length === 60);

const sharedAnchorFixture = structuredClone(fixture);
sharedAnchorFixture.connectors[0].pin_count = 2;
sharedAnchorFixture.connectors[1].pin_count = 2;
sharedAnchorFixture.hierarchy.push(
  { id: 'dev_c', name: 'Device C', parent: null, kind: 'device', tags: [], properties: {} },
  { id: 'dev_d', name: 'Device D', parent: null, kind: 'device', tags: [], properties: {} },
);
sharedAnchorFixture.connectors.push(
  {
    id: 'con_c',
    name: 'Connector C',
    parent: 'dev_c',
    connector_type: 'generic',
    pin_count: 1,
    tags: [],
    properties: {},
  },
  {
    id: 'con_d',
    name: 'Connector D',
    parent: 'dev_d',
    connector_type: 'generic',
    pin_count: 1,
    tags: [],
    properties: {},
  },
);
sharedAnchorFixture.signals.push({
  id: 'sig_ground',
  name: 'Ground',
  tags: [],
  properties: {},
});
sharedAnchorFixture.paths.push(
  {
    id: 'path_parallel',
    name: 'Unselected wire in the same bundle',
    signal_id: 'sig_ground',
    tags: [],
    properties: {},
    nodes: [
      { kind: 'connector', connector_id: 'con_a', pin_number: 2 },
      { kind: 'connector', connector_id: 'con_b', pin_number: 2 },
    ],
    measurements: [],
  },
  {
    id: 'path_branch',
    name: 'Power branch',
    signal_id: 'sig_power',
    tags: [],
    properties: {},
    nodes: [
      { kind: 'connector', connector_id: 'con_c', pin_number: 1 },
      { kind: 'connector', connector_id: 'con_d', pin_number: 1 },
    ],
    measurements: [],
  },
);

reset(sharedAnchorFixture);
const sourceEdgeId = 'bundle:connector:con_a|connector:con_b';
const targetEdgeId = 'bundle:connector:con_c|connector:con_d';
const signalIdsBeforeSharedAnchors = useSystemStore.getState().system!.paths.map(
  (path) => [path.id, path.signal_id],
);
useSystemStore.getState().setEdgeWaypoints(sourceEdgeId, [{ x: 25, y: 30 }]);
const firstSharedAnchorId = useSystemStore.getState().createSharedAnchor(
  { x: 50, y: 60 },
  sourceEdgeId,
  0,
  { mode: 'branch' },
);
useSystemStore.getState().linkEdgeToSharedAnchor(
  firstSharedAnchorId,
  targetEdgeId,
  -1,
  { x: 50, y: 60 },
);
const firstBranchPointId = useSystemStore.getState().sharedAnchors[firstSharedAnchorId]?.branchPointId;
const firstJoinSystem = useSystemStore.getState().system!;
check(
  'any two Harness Bundles can meet at one branch point',
  !!firstBranchPointId
    && firstJoinSystem.paths.every((path) =>
      path.nodes.some(
        (node) => node.kind === 'branch' && node.branch_point_id === firstBranchPointId,
      ),
    ),
);
check(
  'joining Harness Bundles preserves each wire signal',
  JSON.stringify(firstJoinSystem.paths.map((path) => [path.id, path.signal_id]))
    === JSON.stringify(signalIdsBeforeSharedAnchors),
);

const sourceToFirstMergeEdgeId =
  `bundle:branch:${firstBranchPointId}|connector:con_a`;
const targetToFirstMergeEdgeId =
  `bundle:branch:${firstBranchPointId}|connector:con_c`;
useSystemStore.getState().setEdgeWaypoints(
  sourceToFirstMergeEdgeId,
  [{ x: 75, y: 80 }],
);
const secondSharedAnchorId = useSystemStore.getState().createSharedAnchor(
  { x: 90, y: 100 },
  sourceToFirstMergeEdgeId,
  0,
  { mode: 'branch' },
);
useSystemStore.getState().linkEdgeToSharedAnchor(
  secondSharedAnchorId,
  targetToFirstMergeEdgeId,
  -1,
  { x: 90, y: 100 },
);
const sharedAnchorState = useSystemStore.getState();
const secondBranchPointId = sharedAnchorState.sharedAnchors[secondSharedAnchorId]?.branchPointId;
const mergeRefKeys = [`branch:${firstBranchPointId}`, `branch:${secondBranchPointId}`].sort();
const commonBundleId = `bundle:${mergeRefKeys[0]}|${mergeRefKeys[1]}`;
const commonBundle = deriveHarnessBundles(deriveWires(sharedAnchorState.system!))
  .find((bundle) => bundle.id === commonBundleId);
check(
  'successive point joins create distinct branch points',
  !!secondBranchPointId && firstBranchPointId !== secondBranchPointId,
);
check(
  'two branch points derive one combined Harness Bundle segment',
  commonBundle?.pathIds.length === sharedAnchorFixture.paths.length,
);

if (failures > 0) {
  console.error(`\nFAIL ${failures} undo test${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\nPASS all undo tests');
process.exit(0);
