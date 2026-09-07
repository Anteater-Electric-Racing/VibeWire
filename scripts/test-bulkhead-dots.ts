import assert from 'node:assert/strict';
import type { Node } from '@xyflow/react';
import {
  BULKHEAD_DISPLAY_PROPERTY,
  BULKHEAD_DOT_DISPLAY,
  ensureEnclosureBulkheadPlaceholders,
  getVisualDotRoutePin,
  isBulkheadDot,
  isTerminalVisualDot,
  splitBulkheadDotPath,
  unmergeNonTerminalVisualDots,
} from '../src/lib/bulkheadRouting.js';
import {
  canMergePassThroughConnectors,
  mergeConnectors,
} from '../src/lib/systemTopology.js';
import { positionNonAnchoringDots } from '../src/components/graph/graphModel.js';
import { useSystemStore } from '../src/store/index.js';
import type { SystemData } from '../src/types/index.js';

const system: SystemData = {
  schema_version: '0.1.0',
  name: 'Bulkhead dots',
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
      id: 'dev_inside',
      name: 'Inside',
      parent: 'enc_box',
      kind: 'device',
      tags: [],
      properties: {},
    },
    {
      id: 'dev_outside',
      name: 'Outside',
      parent: null,
      kind: 'device',
      tags: [],
      properties: {},
    },
  ],
  connectors: [
    {
      id: 'con_inside',
      name: 'Inside connector',
      parent: 'dev_inside',
      connector_type: 'generic_multipin',
      pin_count: 2,
      tags: [],
      properties: {},
    },
    {
      id: 'con_dot',
      name: 'Shared dot',
      parent: 'enc_box',
      connector_type: 'generic_multipin',
      mounting: 'bulkhead',
      pin_count: 2,
      tags: ['generated', 'unresolved', 'bulkhead'],
      properties: {
        placeholder_reason: 'missing_enclosure_bulkhead',
        bulkhead_group_anchor: 'connector:con_inside',
        boundary_enclosure: 'enc_box',
        boundary_sheet: 'enc_box',
        generated_by_route: 'path_a',
        generated_by_routes: 'path_a,path_b',
        [BULKHEAD_DISPLAY_PROPERTY]: BULKHEAD_DOT_DISPLAY,
      },
    },
    {
      id: 'con_outside',
      name: 'Outside connector',
      parent: 'dev_outside',
      connector_type: 'generic_multipin',
      pin_count: 2,
      tags: [],
      properties: {},
    },
  ],
  branchPoints: [],
  signals: [
    { id: 'sig_a', name: 'A', tags: [], properties: {} },
    { id: 'sig_b', name: 'B', tags: [], properties: {} },
  ],
  signalPropertyDefinitions: [],
  paths: [
    {
      id: 'path_a',
      name: 'Wire A',
      signal_id: 'sig_a',
      tags: [],
      properties: { wire_color: 'red' },
      nodes: [
        { kind: 'connector', connector_id: 'con_inside', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_dot', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_outside', pin_number: 1 },
      ],
      measurements: [
        {
          from: { kind: 'connector', connector_id: 'con_inside', pin_number: 1 },
          to: { kind: 'connector', connector_id: 'con_dot', pin_number: 1 },
          length_mm: 25,
        },
      ],
    },
    {
      id: 'path_b',
      name: 'Wire B',
      signal_id: 'sig_b',
      tags: [],
      properties: { wire_color: 'blue' },
      nodes: [
        { kind: 'connector', connector_id: 'con_inside', pin_number: 2 },
        { kind: 'connector', connector_id: 'con_dot', pin_number: 2 },
        { kind: 'connector', connector_id: 'con_outside', pin_number: 2 },
      ],
      measurements: [],
    },
  ],
};

assert.equal(isBulkheadDot(system.connectors[1]), true);

const split = splitBulkheadDotPath(
  system,
  'con_dot',
  'path_a',
  'con_dot_a',
  'Wire A dot',
);
const splitConnector = split.connectors.find((connector) => connector.id === 'con_dot_a');
assert.ok(splitConnector);
assert.equal(splitConnector.name, 'Wire A dot');
assert.equal(splitConnector.pin_count, 1);
assert.equal(splitConnector.properties.bulkhead_group_anchor, 'dot:con_dot_a');
assert.equal(isBulkheadDot(splitConnector), true);
assert.equal(
  split.paths[0].nodes.some((node) =>
    node.kind === 'connector'
    && node.connector_id === 'con_dot_a'
    && node.pin_number === 1
  ),
  true,
);
assert.equal(
  split.paths[0].measurements[0].to.kind === 'connector'
    ? split.paths[0].measurements[0].to.connector_id
    : null,
  'con_dot_a',
);
assert.equal(
  split.paths[1].nodes.some((node) =>
    node.kind === 'connector' && node.connector_id === 'con_dot'
  ),
  true,
);

const repaired = ensureEnclosureBulkheadPlaceholders(split);
assert.deepEqual(repaired.changedPathIds, []);
assert.deepEqual(repaired.createdConnectorIds, []);

const merged = mergeConnectors(repaired.system, 'con_dot_a', 'con_dot');
assert.equal(merged.connectors.some((connector) => connector.id === 'con_dot_a'), false);
assert.equal(
  merged.paths.every((path) => path.nodes.some((node) =>
    node.kind === 'connector' && node.connector_id === 'con_dot'
  )),
  true,
);

assert.throws(
  () => splitBulkheadDotPath(split, 'con_dot_a', 'path_a', 'con_dot_again', 'Again'),
  /only one wire/i,
);

const singleWire = structuredClone(system);
singleWire.paths = [singleWire.paths[0]];
singleWire.connectors[1].pin_count = 1;
const graphNodes: Node[] = [
  {
    id: 'enc_box',
    type: 'enclosure',
    position: { x: 100, y: 100 },
    style: { width: 200, height: 200 },
    data: { enclosureId: 'enc_box' },
  },
  {
    id: 'con_inside',
    type: 'connector',
    parentId: 'enc_box',
    position: { x: 40, y: 70 },
    style: { width: 20, height: 20 },
    data: { connectorId: 'con_inside' },
  },
  {
    id: 'con_dot',
    type: 'connector',
    parentId: 'enc_box',
    position: { x: -9, y: 20 },
    style: { width: 18, height: 18 },
    data: { connectorId: 'con_dot' },
  },
  {
    id: 'con_outside',
    type: 'connector',
    position: { x: 390, y: 210 },
    style: { width: 20, height: 20 },
    data: { connectorId: 'con_outside' },
  },
];
const nodeIdByConnector = new Map(
  graphNodes.flatMap((node) =>
    typeof node.data.connectorId === 'string'
      ? [[node.data.connectorId, node.id] as const]
      : []
  ),
);
const positioned = positionNonAnchoringDots(
  singleWire,
  graphNodes,
  (node) => node.kind === 'connector'
    ? nodeIdByConnector.get(node.connector_id) ?? null
    : null,
);
const positionedDot = positioned.find((node) => node.id === 'con_dot')!;
assert.equal(positionedDot.draggable, false);
assert.equal(positionedDot.position.x, 191, 'through-dot must move to the crossed wall');
const dotCenter = {
  x: 100 + positionedDot.position.x + 9,
  y: 100 + positionedDot.position.y + 9,
};
const lineA = { x: 150, y: 180 };
const lineB = { x: 400, y: 220 };
const cross = (dotCenter.x - lineA.x) * (lineB.y - lineA.y)
  - (dotCenter.y - lineA.y) * (lineB.x - lineA.x);
assert.ok(Math.abs(cross) < 0.01, 'through-dot must sit on the straight endpoint line');
assert.equal(isTerminalVisualDot(singleWire, 'con_dot'), false);

const routedPositioned = positionNonAnchoringDots(
  singleWire,
  graphNodes,
  (node) => node.kind === 'connector'
    ? nodeIdByConnector.get(node.connector_id) ?? null
    : null,
  () => ({
    previous: { x: 250, y: 130 },
    next: { x: 400, y: 280 },
  }),
);
const routedDot = routedPositioned.find((node) => node.id === 'con_dot')!;
assert.equal(routedDot.position.x, 191);
assert.equal(
  Math.round(routedDot.position.y),
  71,
  'the dot must follow adjacent route points instead of aiming at the final endpoints',
);

const terminalWire = structuredClone(singleWire);
terminalWire.paths[0].nodes = terminalWire.paths[0].nodes.slice(1);
const terminalPositioned = positionNonAnchoringDots(
  terminalWire,
  graphNodes,
  (node) => node.kind === 'connector'
    ? nodeIdByConnector.get(node.connector_id) ?? null
    : null,
);
const terminalDot = terminalPositioned.find((node) => node.id === 'con_dot')!;
assert.deepEqual(terminalDot.position, { x: -9, y: 20 });
assert.notEqual(terminalDot.draggable, false, 'terminal dots must remain draggable');

const mergedTerminal = structuredClone(system);
mergedTerminal.paths[0].nodes = mergedTerminal.paths[0].nodes.slice(0, 2);
mergedTerminal.paths[1].nodes = mergedTerminal.paths[1].nodes.slice(0, 2);
mergedTerminal.connectors.push({
  ...structuredClone(mergedTerminal.connectors[1]),
  id: 'con_dot_peer',
  name: 'Peer dot',
  properties: {
    ...mergedTerminal.connectors[1].properties,
    bulkhead_group_anchor: 'dot:con_dot_peer',
  },
});
mergedTerminal.paths.push({
  ...structuredClone(mergedTerminal.paths[0]),
  id: 'path_peer',
  name: 'Peer wire',
  nodes: [
    { kind: 'connector', connector_id: 'con_inside', pin_number: 3 },
    { kind: 'connector', connector_id: 'con_dot_peer', pin_number: 1 },
  ],
});
assert.equal(isTerminalVisualDot(mergedTerminal, 'con_dot'), true);
assert.equal(
  getVisualDotRoutePin(mergedTerminal, 'con_dot'),
  3,
  'a merged terminal dot exposes its next free cavity as one connection target',
);
assert.equal(getVisualDotRoutePin(mergedTerminal, 'con_dot_peer'), 1);
assert.equal(
  canMergePassThroughConnectors(mergedTerminal, 'con_dot', 'con_dot_peer'),
  true,
  'terminal dots on the same wall may merge',
);
mergedTerminal.paths[0].nodes.push({
  kind: 'connector',
  connector_id: 'con_outside',
  pin_number: 1,
});
assert.equal(isTerminalVisualDot(mergedTerminal, 'con_dot'), false);
assert.equal(getVisualDotRoutePin(mergedTerminal, 'con_dot'), null);
assert.equal(
  canMergePassThroughConnectors(mergedTerminal, 'con_dot', 'con_dot_peer'),
  false,
  'a non-terminal dot must not merge',
);
const automaticallyUnmerged = unmergeNonTerminalVisualDots(
  mergedTerminal,
  new Set(['con_dot']),
);
assert.equal(automaticallyUnmerged.created.length, 1);
const releasedId = automaticallyUnmerged.created[0].connectorId;
assert.equal(
  automaticallyUnmerged.system.paths[0].nodes.some((node) =>
    node.kind === 'connector' && node.connector_id === 'con_dot'
  ),
  true,
);
assert.equal(
  automaticallyUnmerged.system.paths[1].nodes.some((node) =>
    node.kind === 'connector' && node.connector_id === releasedId
  ),
  true,
);
assert.equal(isTerminalVisualDot(automaticallyUnmerged.system, releasedId), true);

useSystemStore.setState({ collabAvailable: false });
useSystemStore.setState({ system: structuredClone(system),
  sizeLayouts: { con_dot: { w: 18, h: 18 } },
  subsystems: {
    test: {
      schema_version: '1.0.0',
      id: 'test',
      name: 'Test',
      tags: [],
      enclosures: {},
      devices: {},
      connectors: { con_dot: { x: 20, y: 30, w: 18, h: 18 } },
    },
  },
  expandedNodes: new Set(['con_dot']),
});
useSystemStore.getState().setConnectorDotDisplay('con_dot', false);
const convertedState = useSystemStore.getState();
assert.equal(
  convertedState.system?.connectors.find((connector) => connector.id === 'con_dot')
    ?.properties.bulkhead_display,
  undefined,
);
assert.deepEqual(convertedState.sizeLayouts.con_dot, { w: 100, h: 32 });
assert.deepEqual(
  convertedState.subsystems.test.connectors.con_dot,
  { x: 20, y: 30, w: 96, h: 36 },
);
assert.equal(convertedState.expandedNodes.has('con_dot'), false);

console.log('bulkhead dot tests passed');
