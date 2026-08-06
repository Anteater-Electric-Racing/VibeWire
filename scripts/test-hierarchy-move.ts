/**
 * Hierarchy rearrange: reparent + sibling reorder must preserve IDs and only
 * change parent / array order.
 */
import assert from 'node:assert/strict';
import { moveHierarchyEntity } from '../src/lib/harness.js';
import type { HarnessData } from '../src/types/index.js';

const base: HarnessData = {
  signalPropertyDefinitions: [],
  schema_version: '0.2.0-sheets',
  name: 'Move Test',
  enclosures: [
    { id: 'enc_a', name: 'A', parent: null, container: true, tags: [], properties: {} },
    { id: 'enc_b', name: 'B', parent: null, container: true, tags: [], properties: {} },
    { id: 'dev_1', name: 'Dev', parent: 'enc_a', container: false, tags: [], properties: {} },
  ],
  connectors: [
    { id: 'con_1', name: 'C1', parent: 'enc_a', connector_type: 'type_2p', tags: [], properties: {} },
    { id: 'con_2', name: 'C2', parent: 'enc_a', connector_type: 'type_2p', tags: [], properties: {} },
    { id: 'con_3', name: 'C3', parent: 'enc_b', connector_type: 'type_2p', tags: [], properties: {} },
  ],
  mergePoints: [
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
    next.enclosures.filter((item) => item.parent === null).map((item) => item.id),
    ['enc_b', 'enc_a'],
  );
}

// Nest enclosure under another container
{
  const next = moveHierarchyEntity(base, 'enclosure', 'enc_b', 'enc_a', null);
  assert.equal(next.enclosures.find((item) => item.id === 'enc_b')?.parent, 'enc_a');
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

console.log('test-hierarchy-move: ok');
