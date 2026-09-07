/**
 * Hierarchy rearrange: reparent + sibling reorder must preserve IDs and only
 * change parent / array order.
 */
import assert from 'node:assert/strict';
import { moveHierarchyEntity, getConnectorSignalGroups } from '../src/lib/systemTopology.js';
import { readableColorOnBackground } from '../src/lib/colors.js';
import { buildHierarchySearch } from '../src/lib/hierarchyTree.js';
import type { SystemData } from '../src/types/index.js';

const base: SystemData = {
  signalPropertyDefinitions: [],
  schema_version: '0.2.0-sheets',
  name: 'Move Test',
  hierarchy: [
    { id: 'enc_a', name: 'A', parent: null, kind: 'enclosure', tags: [], properties: {} },
    { id: 'enc_b', name: 'B', parent: null, kind: 'enclosure', tags: [], properties: {} },
    { id: 'dev_1', name: 'Dev', parent: 'enc_a', kind: 'device', tags: [], properties: {} },
  ],
  connectors: [
    { id: 'con_1', name: 'C1', parent: 'enc_a', connector_type: 'type_2p', tags: [], properties: {} },
    { id: 'con_2', name: 'C2', parent: 'enc_a', connector_type: 'type_2p', tags: [], properties: {} },
    { id: 'con_3', name: 'C3', parent: 'enc_b', connector_type: 'type_2p', tags: [], properties: {} },
  ],
  branchPoints: [
    { id: 'mp_1', name: 'M1', parent: 'enc_a', tags: [], properties: {} },
  ],
  paths: [],
  signals: [],
};

// Reorder connectors under enc_a: move con_2 before con_1
{
  const next = moveHierarchyEntity(base, 'connector', 'con_2', 'enc_a', 'con_1');
  const siblings = next.connectors.filter((item) => item.parent === 'enc_a').map((item) => item.id);
  assert.deepEqual(siblings, ['con_2', 'con_1']);
}

// Reparent connector into device
{
  const next = moveHierarchyEntity(base, 'connector', 'con_3', 'dev_1', null);
  assert.equal(next.connectors.find((item) => item.id === 'con_3')?.parent, 'dev_1');
}

// Reorder root enclosures
{
  const next = moveHierarchyEntity(base, 'enclosure', 'enc_b', null, 'enc_a');
  assert.deepEqual(
    next.hierarchy.filter((item) => item.parent === null).map((item) => item.id),
    ['enc_b', 'enc_a'],
  );
}

// Nest enclosure under another container
{
  const next = moveHierarchyEntity(base, 'enclosure', 'enc_b', 'enc_a', null);
  assert.equal(next.hierarchy.find((item) => item.id === 'enc_b')?.parent, 'enc_a');
}

// Reject cycle
assert.throws(
  () => moveHierarchyEntity(
    moveHierarchyEntity(base, 'enclosure', 'enc_b', 'enc_a', null),
    'enclosure',
    'enc_a',
    'enc_b',
    null,
  ),
  /descendants/,
);

// Reject enclosure into device
assert.throws(
  () => moveHierarchyEntity(base, 'enclosure', 'enc_b', 'dev_1', null),
  /only be placed inside an enclosure/,
);

// No-op returns same reference
{
  const next = moveHierarchyEntity(base, 'connector', 'con_2', 'enc_a', null);
  assert.equal(next, base);
}

{
  const wired: SystemData = {
    ...base,
    signals: [
      { id: 'sig_gnd', name: 'GND', tags: [], properties: { preferred_wire_color: 'black' } },
      { id: 'sig_can', name: 'CAN_H', tags: [], properties: {} },
    ],
    paths: [
      {
        id: 'path_a',
        name: 'Ground A',
        signal_id: 'sig_gnd',
        tags: [],
        properties: {},
        nodes: [
          { kind: 'connector', connector_id: 'con_1', pin_number: 1 },
          { kind: 'connector', connector_id: 'con_2', pin_number: 1 },
        ],
        measurements: [],
      },
      {
        id: 'path_b',
        name: 'Ground B',
        signal_id: 'sig_gnd',
        tags: [],
        properties: {},
        nodes: [
          { kind: 'connector', connector_id: 'con_1', pin_number: 2 },
          { kind: 'connector', connector_id: 'con_1', pin_number: 3 },
        ],
        measurements: [],
      },
      {
        id: 'path_c',
        name: 'CAN high',
        signal_id: 'sig_can',
        tags: [],
        properties: {},
        nodes: [{ kind: 'connector', connector_id: 'con_1', pin_number: 4 }],
        measurements: [],
      },
    ],
  };

  const groups = getConnectorSignalGroups(wired, 'con_1');
  assert.deepEqual(groups.map((group) => group.signalName), ['CAN_H', 'GND']);
  const gnd = groups.find((group) => group.signalId === 'sig_gnd');
  assert.ok(gnd);
  assert.deepEqual(gnd.paths.map((path) => path.pathId), ['path_a', 'path_b']);
  assert.deepEqual(gnd.paths.find((path) => path.pathId === 'path_b')?.pinNumbers, [2, 3]);

  const blackOnDark = readableColorOnBackground('#111827', '#18181b');
  assert.notEqual(blackOnDark.toLowerCase(), '#111827');
  const yellowOnDark = readableColorOnBackground('#facc15', '#18181b');
  assert.equal(yellowOnDark.toLowerCase(), '#facc15');
}

{
  const linked: SystemData = {
    ...base,
    hierarchy: base.hierarchy.map((enclosure) => (
      enclosure.id === 'enc_a' ? { ...enclosure, name: 'Alpha Box' } : enclosure
    )),
    paths: [
      {
        id: 'path_cross',
        name: 'From B to Alpha Box',
        tags: [],
        properties: {},
        nodes: [
          { kind: 'connector', connector_id: 'con_3', pin_number: 1 },
          { kind: 'connector', connector_id: 'con_1', pin_number: 1 },
        ],
        measurements: [],
      },
    ],
  };
  const search = buildHierarchySearch(
    'alpha box',
    linked.hierarchy,
    linked.connectors,
    linked.branchPoints,
    linked.paths,
    linked.signals,
  );
  assert.equal(search.expandedIds.has('enc_a'), true);
  assert.equal(search.visibleIds.has('dev_1'), true);
  assert.equal(search.visibleIds.has('con_1'), true);
  assert.equal(search.visibleIds.has('con_2'), true);
  assert.equal(search.visibleIds.has('mp_1'), true);
  assert.equal(search.expandedIds.has('dev_1'), false);
  assert.equal(search.visibleIds.has('enc_b'), false);
  assert.equal(search.visibleIds.has('con_3'), false);
}

console.log('test-hierarchy-move: ok');
