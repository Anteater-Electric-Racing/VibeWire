import assert from 'node:assert/strict';
import { deriveGraphWireGroups } from '../src/components/graph/graphModel.js';
import {
  harnessBundleIdWithThru,
  canFuseBranchPoints,
  deriveWires,
  getBaseHarnessBundleId,
  getHarnessBundleLayoutId,
  getHarnessBundleLayoutValue,
  getBranchPointSignalGroups,
  getSegmentThroughKey,
  getBranchPointHarnessBundleFamilies,
  getBranchPointWireFamilies,
  fuseBranchPoints,
  parseHarnessBundleThruKey,
  insertBranchPointOnPath,
  separateBranchPointOccurrences,
} from '../src/lib/systemTopology.js';
import type { SystemData } from '../src/types/index.js';

const system: SystemData = {
  schema_version: '0.1.0',
  name: 'Branch Point families',
  hierarchy: [
    { id: 'dev_a', name: 'Device A', parent: null, kind: 'device', tags: [], properties: {} },
    { id: 'dev_b', name: 'Device B', parent: null, kind: 'device', tags: [], properties: {} },
    { id: 'dev_c', name: 'Device C', parent: null, kind: 'device', tags: [], properties: {} },
  ],
  connectors: [
    { id: 'con_a', name: 'A', parent: 'dev_a', connector_type: 'generic', pin_count: 3, tags: [], properties: {} },
    { id: 'con_b', name: 'B', parent: 'dev_b', connector_type: 'generic', pin_count: 2, tags: [], properties: {} },
    { id: 'con_c', name: 'C', parent: 'dev_c', connector_type: 'generic', pin_count: 1, tags: [], properties: {} },
  ],
  branchPoints: [
    { id: 'mp_1', name: 'Main branch', parent: null, tags: [], properties: {} },
  ],
  paths: [
    {
      id: 'path_12v_ab_1',
      name: '12V A-B 1',
      signal_id: 'sig_12v',
      tags: [],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
        { kind: 'branch', branch_point_id: 'mp_1' },
        { kind: 'connector', connector_id: 'con_b', pin_number: 1 },
      ],
      measurements: [],
    },
    {
      id: 'path_12v_ab_2',
      name: '12V A-B 2',
      signal_id: 'sig_12v',
      tags: [],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'con_a', pin_number: 2 },
        { kind: 'branch', branch_point_id: 'mp_1' },
        { kind: 'connector', connector_id: 'con_b', pin_number: 2 },
      ],
      measurements: [],
    },
    {
      id: 'path_can_ab',
      name: 'CAN A-B',
      signal_id: 'sig_can',
      tags: [],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'con_a', pin_number: 3 },
        { kind: 'branch', branch_point_id: 'mp_1' },
        { kind: 'connector', connector_id: 'con_b', pin_number: 1 },
      ],
      measurements: [],
    },
    {
      id: 'path_12v_ac',
      name: '12V A-C',
      signal_id: 'sig_12v',
      tags: [],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'con_a', pin_number: 3 },
        { kind: 'branch', branch_point_id: 'mp_1' },
        { kind: 'connector', connector_id: 'con_c', pin_number: 1 },
      ],
      measurements: [],
    },
  ],
  signals: [
    { id: 'sig_12v', name: '12V', tags: [], properties: {} },
    { id: 'sig_can', name: 'CAN_H', tags: [], properties: {} },
  ],
  signalPropertyDefinitions: [],
};

const abPath = system.paths[0];
assert.equal(
  getSegmentThroughKey(abPath, 0),
  'connector:con_b',
  'A→branch hop of an A-B wire is keyed by B',
);
assert.equal(
  getSegmentThroughKey(abPath, 1),
  'connector:con_a',
  'branch→B hop of an A-B wire is keyed by A',
);
assert.equal(
  getSegmentThroughKey(system.paths[3], 0),
  'connector:con_c',
  'A→branch hop of an A-C wire is keyed by C',
);

assert.equal(
  getBaseHarnessBundleId('bundle:branch:mp_1|connector:con_a~thru:connector:con_c#pin:1|'),
  'bundle:branch:mp_1|connector:con_a',
);
assert.equal(
  getHarnessBundleLayoutId('bundle:branch:mp_1|connector:con_a~thru:connector:con_c#pin:1|'),
  'bundle:branch:mp_1|connector:con_a~thru:connector:con_c',
);
assert.equal(
  parseHarnessBundleThruKey('bundle:branch:mp_1|connector:con_a~thru:connector:con_c'),
  'connector:con_c',
);

const familyLayouts = {
  'bundle:branch:mp_1|connector:con_a': [{ x: 1, y: 1 }],
  'bundle:branch:mp_1|connector:con_a~thru:connector:con_c': [{ x: 9, y: 9 }],
};
assert.deepEqual(
  getHarnessBundleLayoutValue(familyLayouts, 'bundle:branch:mp_1|connector:con_a~thru:connector:con_c'),
  [{ x: 9, y: 9 }],
  'pulled family waypoints win over the shared branch hop',
);
assert.deepEqual(
  getHarnessBundleLayoutValue(familyLayouts, 'bundle:branch:mp_1|connector:con_a~thru:connector:con_b'),
  [{ x: 1, y: 1 }],
  'unpulled family still inherits the shared branch hop',
);

const segments = deriveWires(system);
const groups = deriveGraphWireGroups(segments);
const approachGroups = groups.filter((group) =>
  getBaseHarnessBundleId(group.id) === 'bundle:branch:mp_1|connector:con_a',
);
assert.equal(approachGroups.length, 2, 'distinct through-routes split the shared A→branch approach');

const towardB = approachGroups.find((group) => parseHarnessBundleThruKey(group.id) === 'connector:con_b');
const towardC = approachGroups.find((group) => parseHarnessBundleThruKey(group.id) === 'connector:con_c');
assert(towardB, 'A→B family must exist');
assert(towardC, 'A→C family must exist');
assert.deepEqual(
  [...towardB.pathIds].sort(),
  ['path_12v_ab_1', 'path_12v_ab_2', 'path_can_ab'],
  'same A→branch→B destinations stay in one system bundle even across signals',
);
assert.deepEqual(towardC.pathIds, ['path_12v_ac']);

const families = getBranchPointWireFamilies(system, 'bundle:branch:mp_1|connector:con_a');
assert.equal(families.length, 2);
assert.deepEqual(
  families.map((family) => family.throughKey).sort(),
  ['connector:con_b', 'connector:con_c'],
);

const inspector = getBranchPointSignalGroups(system, 'mp_1');
assert.equal(inspector.length, 2);
const twelveVolt = inspector.find((group) => group.signalId === 'sig_12v');
const can = inspector.find((group) => group.signalId === 'sig_can');
assert(twelveVolt && can);
assert.equal(twelveVolt.paths.length, 3, 'multiple 12V lines list as separate paths');
assert.equal(
  twelveVolt.paths.find((path) => path.pathId === 'path_12v_ac')?.stops.map((stop) => stop.label).join(' → '),
  'Device A → Main branch → Device C',
);
assert.equal(
  twelveVolt.paths.find((path) => path.pathId === 'path_12v_ab_1')?.stops.map((stop) => stop.label).join(' → '),
  'Device A → Main branch → Device B',
);
assert.equal(can.paths.length, 1);
assert.equal(
  can.paths[0].stops.map((stop) => stop.label).join(' → '),
  'Device A → Main branch → Device B',
);

const familyEdge = harnessBundleIdWithThru('bundle:branch:mp_1|connector:con_a', 'connector:con_c');
const inserted = system.paths.map((path) => insertBranchPointOnPath(path, familyEdge, 'mp_new'));
const affected = inserted.filter((path, index) => path !== system.paths[index]);
assert.equal(affected.length, 1, 'splicing a pulled family must not touch the A-B wires');
assert.equal(affected[0].id, 'path_12v_ac');
assert.equal(
  affected[0].nodes.filter((node) => node.kind === 'branch' && node.branch_point_id === 'mp_new').length,
  1,
);

console.log('PASS branch-point family grouping, inspector chains, and family-scoped insert');

// Undoing a branch-point fuse: getBranchPointHarnessBundleFamilies groups by the full neighbor
// pair (both directions), independent of which specific approach edge was
// used to discover it — this is what the inspector's explicit "Split out"
// button and the drag-pull gesture both build on.
{
  const bundleFamilies = getBranchPointHarnessBundleFamilies(system, 'mp_1');
  assert.equal(bundleFamilies.length, 2, 'A-B (2x 12V + CAN, same destinations) and A-C are the only distinct bundles');
  const abFamily = bundleFamilies.find((family) =>
    family.sides.some((side) => side?.refKey === 'connector:con_b'));
  const acFamily = bundleFamilies.find((family) =>
    family.sides.some((side) => side?.refKey === 'connector:con_c'));
  assert(abFamily && acFamily, 'both A-B and A-C families must be present');
  assert.equal(abFamily.label, 'Device A ↔ Device B');
  assert.deepEqual([...abFamily.pathIds].sort(), ['path_12v_ab_1', 'path_12v_ab_2', 'path_can_ab']);
  assert.equal(acFamily.label, 'Device A ↔ Device C');
  assert.deepEqual(acFamily.pathIds, ['path_12v_ac']);

  // Separate the A-C family off mp_1 onto a brand new branch point.
  const afterSplit = separateBranchPointOccurrences(
    system,
    'mp_1',
    acFamily.occurrences.map((occurrence) => ({ pathId: occurrence.pathId, nodeIndex: occurrence.nodeIndex })),
    'mp_split',
    'Branch 2',
  );
  assert.equal(afterSplit.branchPoints.length, 2, 'the original branch point remains alongside the new one');
  const acPathAfter = afterSplit.paths.find((path) => path.id === 'path_12v_ac')!;
  assert(
    acPathAfter.nodes.some((node) => node.kind === 'branch' && node.branch_point_id === 'mp_split'),
    'the split-off path now threads through the new branch point',
  );
  const abPathAfter = afterSplit.paths.find((path) => path.id === 'path_12v_ab_1')!;
  assert(
    abPathAfter.nodes.some((node) => node.kind === 'branch' && node.branch_point_id === 'mp_1'),
    'every other connection through the original branch point is untouched',
  );
  assert.equal(
    getBranchPointHarnessBundleFamilies(afterSplit, 'mp_1').length,
    1,
    'only the A-B family (2x 12V + CAN, same destinations) remains on the original branch point',
  );
  console.log('PASS splitting one Harness Bundle family off a branch point leaves the rest intact (undo the fuse)');

  // Undo the split: fusing mp_1 and mp_split back together recombines every path.
  const remerged = fuseBranchPoints(afterSplit, 'mp_split', 'mp_1');
  assert.equal(remerged.branchPoints.length, 1, 'the absorbed branch point is gone');
  assert.equal(remerged.branchPoints[0].id, 'mp_1');
  const acPathRemerged = remerged.paths.find((path) => path.id === 'path_12v_ac')!;
  assert(
    acPathRemerged.nodes.some((node) => node.kind === 'branch' && node.branch_point_id === 'mp_1'),
    'the re-fused path is back on the original branch-point id',
  );
  console.log('PASS re-fusing two branch points undoes a split');
}

// canFuseBranchPoints / fuseBranchPoints guardrails.
{
  const disjointSystem: SystemData = {
    ...system,
    branchPoints: [
      { id: 'mp_x', name: 'Branch Point X', parent: null, tags: ['generated'], properties: {} },
      { id: 'mp_y', name: 'Branch Point Y', parent: 'dev_a', tags: [], properties: {} },
      { id: 'mp_z', name: 'Branch Point Z', parent: null, tags: [], properties: {} },
    ],
    paths: [
      {
        id: 'path_z1',
        name: 'Z1',
        tags: [],
        properties: {},
        nodes: [
          { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
          { kind: 'branch', branch_point_id: 'mp_z' },
          { kind: 'connector', connector_id: 'con_b', pin_number: 1 },
        ],
        measurements: [],
      },
      {
        id: 'path_z2',
        name: 'Z2',
        tags: [],
        properties: {},
        nodes: [
          { kind: 'connector', connector_id: 'con_c', pin_number: 1 },
          { kind: 'branch', branch_point_id: 'mp_z' },
          { kind: 'connector', connector_id: 'con_a', pin_number: 2 },
        ],
        measurements: [],
      },
    ],
    signals: [],
  };
  assert.equal(
    canFuseBranchPoints(disjointSystem, 'mp_x', 'mp_y'),
    false,
    'branch points with different parents cannot fuse',
  );
  assert.equal(
    canFuseBranchPoints(disjointSystem, 'mp_x', 'mp_z'),
    true,
    'two free branch points that share no path can fuse',
  );
  const mergedFree = fuseBranchPoints(disjointSystem, 'mp_x', 'mp_z');
  assert.equal(mergedFree.branchPoints.length, 2);
  assert(mergedFree.branchPoints.every((mp) => mp.id !== 'mp_x'));
  assert(
    mergedFree.branchPoints.find((mp) => mp.id === 'mp_z')?.tags.includes('generated'),
    'tags from the absorbed branch point are unioned onto the survivor',
  );

  const sameBranchPointSystem: SystemData = {
    ...disjointSystem,
    paths: [
      ...disjointSystem.paths,
      {
        id: 'path_xz',
        name: 'X-Z bridge',
        tags: [],
        properties: {},
        nodes: [
          { kind: 'branch', branch_point_id: 'mp_x' },
          { kind: 'connector', connector_id: 'con_a', pin_number: 3 },
          { kind: 'branch', branch_point_id: 'mp_z' },
        ],
        measurements: [],
      },
    ],
  };
  assert.equal(
    canFuseBranchPoints(sameBranchPointSystem, 'mp_x', 'mp_z'),
    false,
    'branch points that already share a path cannot fuse',
  );
  assert.throws(() => fuseBranchPoints(sameBranchPointSystem, 'mp_x', 'mp_z'));
  console.log('PASS canFuseBranchPoints/fuseBranchPoints guardrails');
}
