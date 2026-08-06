import { useHarnessStore } from '../src/store/index.js';
import { deriveBundles, deriveSegments } from '../src/lib/harness.js';
import type { HarnessData } from '../src/types/index.js';

const fixture: HarnessData = {
  signalPropertyDefinitions: [],
  schema_version: '0.1.0',
  name: 'Undo fixture',
  enclosures: [
    { id: 'dev_a', name: 'Device A', parent: null, container: false, tags: [], properties: {} },
    { id: 'dev_b', name: 'Device B', parent: null, container: false, tags: [], properties: {} },
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
  mergePoints: [],
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

function reset(data: HarnessData = fixture) {
  useHarnessStore.getState().resetForHarnessSwitch();
  useHarnessStore.getState().setCollabAvailable(false);
  useHarnessStore.getState().loadHarness(structuredClone(data));
  useHarnessStore.setState({
    undoStack: [],
    redoStack: [],
    selectedItem: null,
    selectedBundle: null,
    selectedTextBoxId: null,
  });
}

reset();
useHarnessStore.getState().setSelectedBundle({ id: 'bundle:test', pathIds: ['path_wire'] });
useHarnessStore.getState().deletePathBundle('bundle:test', ['path_wire']);
check('deleting a path removes it', useHarnessStore.getState().harness?.paths.length === 0);
useHarnessStore.getState().undo();
check(
  'undo restores a deleted path',
  useHarnessStore.getState().harness?.paths.some((path) => path.id === 'path_wire') === true,
);
check(
  'undo restores deleted path selection',
  useHarnessStore.getState().selectedBundle?.pathIds.includes('path_wire') === true,
);

reset();
useHarnessStore.getState().renameEntity('connector', 'con_a', 'Renamed A');
useHarnessStore.getState().undo();
check(
  'undo reverts a rename',
  useHarnessStore.getState().harness?.connectors.find((item) => item.id === 'con_a')?.name
    === 'Connector A',
);

reset();
useHarnessStore.getState().renameEntity('connector', 'con_a', 'My rename');
const concurrentHarness = structuredClone(useHarnessStore.getState().harness!);
concurrentHarness.connectors.find((item) => item.id === 'con_b')!.name = 'Concurrent rename';
useHarnessStore.setState({ harness: concurrentHarness });
useHarnessStore.getState().undo();
check(
  'scoped undo reverts my entity',
  useHarnessStore.getState().harness?.connectors.find((item) => item.id === 'con_a')?.name
    === 'Connector A',
);
check(
  'scoped undo preserves an unrelated concurrent entity',
  useHarnessStore.getState().harness?.connectors.find((item) => item.id === 'con_b')?.name
    === 'Concurrent rename',
);

reset();
useHarnessStore.getState().pushUndoSnapshot('typing:no-change');
useHarnessStore.getState().commitUndoSnapshot();
check('an unchanged editing session creates no entry', useHarnessStore.getState().undoStack.length === 0);

reset();
for (const notes of ['t', 'ty', 'typ', 'typi', 'typin', 'typing']) {
  useHarnessStore.getState().updateManufacturingNotes('bundle_1', notes);
}
check('a simulated typing burst creates one entry', useHarnessStore.getState().undoStack.length === 1);
useHarnessStore.getState().undo();
check(
  'typing burst undo removes the whole edit',
  useHarnessStore.getState().manufacturing.bundles.bundle_1?.notes === undefined,
);

reset();
useHarnessStore.getState().renameEntity('connector', 'con_a', 'Redo name');
useHarnessStore.getState().undo();
useHarnessStore.getState().redo();
check(
  'redo reapplies an undone edit',
  useHarnessStore.getState().harness?.connectors.find((item) => item.id === 'con_a')?.name
    === 'Redo name',
);
useHarnessStore.getState().undo();
useHarnessStore.getState().updateConnectorProperty('con_b', 'note', 'new edit');
check('a new edit clears redo', useHarnessStore.getState().redoStack.length === 0);

reset();
for (let index = 0; index < 65; index += 1) {
  useHarnessStore.getState().updateNodePosition(`node_${index}`, index, index);
}
check('undo depth caps at 60', useHarnessStore.getState().undoStack.length === 60);

const junctionFixture = structuredClone(fixture);
junctionFixture.connectors[0].pin_count = 2;
junctionFixture.connectors[1].pin_count = 2;
junctionFixture.enclosures.push(
  { id: 'dev_c', name: 'Device C', parent: null, container: false, tags: [], properties: {} },
  { id: 'dev_d', name: 'Device D', parent: null, container: false, tags: [], properties: {} },
);
junctionFixture.connectors.push(
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
junctionFixture.signals.push({
  id: 'sig_ground',
  name: 'Ground',
  tags: [],
  properties: {},
});
junctionFixture.paths.push(
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

reset(junctionFixture);
const sourceEdgeId = 'bundle:connector:con_a|connector:con_b';
const targetEdgeId = 'bundle:connector:con_c|connector:con_d';
const signalIdsBeforeJunctions = useHarnessStore.getState().harness!.paths.map(
  (path) => [path.id, path.signal_id],
);
useHarnessStore.getState().setEdgeWaypoints(sourceEdgeId, [{ x: 25, y: 30 }]);
const firstJunctionId = useHarnessStore.getState().createJunction(
  { x: 50, y: 60 },
  sourceEdgeId,
  0,
);
useHarnessStore.getState().linkEdgeToJunction(
  firstJunctionId,
  targetEdgeId,
  -1,
  { x: 50, y: 60 },
);
const firstMergePointId = useHarnessStore.getState().junctionLayouts[firstJunctionId]?.mergePointId;
const firstJoinHarness = useHarnessStore.getState().harness!;
check(
  'any two harness bundles can meet at one splice point',
  !!firstMergePointId
    && firstJoinHarness.paths.every((path) =>
      path.nodes.some(
        (node) => node.kind === 'merge' && node.merge_point_id === firstMergePointId,
      ),
    ),
);
check(
  'a bundle splice preserves each wire signal',
  JSON.stringify(firstJoinHarness.paths.map((path) => [path.id, path.signal_id]))
    === JSON.stringify(signalIdsBeforeJunctions),
);

const sourceToFirstMergeEdgeId =
  `bundle:connector:con_a|merge:${firstMergePointId}`;
const targetToFirstMergeEdgeId =
  `bundle:connector:con_c|merge:${firstMergePointId}`;
useHarnessStore.getState().setEdgeWaypoints(
  sourceToFirstMergeEdgeId,
  [{ x: 75, y: 80 }],
);
const secondJunctionId = useHarnessStore.getState().createJunction(
  { x: 90, y: 100 },
  sourceToFirstMergeEdgeId,
  0,
);
useHarnessStore.getState().linkEdgeToJunction(
  secondJunctionId,
  targetToFirstMergeEdgeId,
  -1,
  { x: 90, y: 100 },
);
const junctionState = useHarnessStore.getState();
const secondMergePointId = junctionState.junctionLayouts[secondJunctionId]?.mergePointId;
const mergeRefKeys = [`merge:${firstMergePointId}`, `merge:${secondMergePointId}`].sort();
const commonBundleId = `bundle:${mergeRefKeys[0]}|${mergeRefKeys[1]}`;
const commonBundle = deriveBundles(deriveSegments(junctionState.harness!))
  .find((bundle) => bundle.id === commonBundleId);
check(
  'successive point joins create distinct splice points',
  !!secondMergePointId && firstMergePointId !== secondMergePointId,
);
check(
  'two splice points derive one combined harness segment',
  commonBundle?.pathIds.length === junctionFixture.paths.length,
);

if (failures > 0) {
  console.error(`\nFAIL ${failures} undo test${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\nPASS all undo tests');
process.exit(0);
