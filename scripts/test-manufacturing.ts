#!/usr/bin/env -S npx tsx
import assert from 'node:assert/strict';
import {
  applyManufacturingTaskUpdates,
  applySpanTotalLength,
  assignManufacturingEndpointGender,
  completedManufacturingComponentStepCount,
  deriveManufacturingBom,
  deriveManufacturingBundles,
  deriveManufacturingHarnesses,
  manufacturingComponentSteps,
  manufacturingGenderBundleRelationship,
  manufacturingHopsMatch,
  manufacturingTaskCompleted,
  manufacturingBomToCsv,
  matingBundleIdsForConnector,
} from '../src/lib/manufacturing.js';
import {
  manufacturingBranchDirection,
  scaleManufacturingRun,
} from '../src/components/manufacturing/manufacturingLayout.js';
import type {
  ConnectorLibrary,
  SystemData,
  ManufacturingDocument,
} from '../src/types/index.js';

const library: ConnectorLibrary = {
  schema_version: '1.1.0',
  connector_types: [{
    id: 'test_family',
    name: 'Test Family',
    pin_count: 0,
    crimp_spec: '',
    male_crimp_part_number: 'CONTACT-M',
    female_crimp_part_number: 'CONTACT-F',
    wire_gauge: '22-18 AWG',
    notes: '',
    cavity_variants: [{
      pin_count: 2,
      housing_part_number: 'HOUSING-2',
    }],
  }],
};

const system: SystemData = {
  signalPropertyDefinitions: [],
  schema_version: '0.2.0-sheets',
  hierarchy: [],
  connectors: [
    {
      id: 'con_a',
      name: 'Connector A',
      parent: null,
      connector_type: 'test_family',
      pin_count: 2,
      tags: [],
      properties: {},
    },
    {
      id: 'con_b',
      name: 'Connector B',
      parent: null,
      connector_type: 'test_family',
      pin_count: 2,
      tags: [],
      properties: {},
    },
  ],
  branchPoints: [],
  paths: [{
    id: 'path_1',
    name: 'CAN high',
    signal_id: 'sig_can_h',
    tags: ['bundle:Main Harness'],
    properties: {
      wire_id: 'W1',
      wire_color: 'Yellow',
      wire_gauge: '20 AWG',
    },
    nodes: [
      { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
      { kind: 'connector', connector_id: 'con_b', pin_number: 2 },
    ],
    measurements: [{
      from: { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
      to: { kind: 'connector', connector_id: 'con_b', pin_number: 2 },
      length_mm: 1250,
    }],
  }],
  signals: [{
    id: 'sig_can_h',
    name: 'CAN_H',
    tags: [],
    properties: { preferred_wire_color: 'Blue' },
  }],
};

const manufacturing: ManufacturingDocument = {
  schema_version: '1.1.0',
  bundles: {
    'bundle:connectors:con_a|con_b': {
      steps: {},
      endpoint_genders: {
        con_a: 'male',
        con_b: 'female',
      },
    },
  },
};
const bundles = deriveManufacturingBundles(system, library, manufacturing);
assert.equal(bundles.length, 1);
assert.equal(bundles[0].id, 'bundle:connectors:con_a|con_b');
assert.equal(bundles[0].wires.length, 1);
assert.equal(bundles[0].wires[0].wireIndex, 0);
assert.equal(bundles[0].knownLengthMm, 1250);
assert.equal(bundles[0].issueCount, 0);
assert.equal(bundles[0].wires[0].from.crimpPartNumber, 'CONTACT-M');
assert.equal(bundles[0].wires[0].to.crimpPartNumber, 'CONTACT-F');

const bom = deriveManufacturingBom(system, library, bundles);
assert.equal(bom.find((row) => row.category === 'Wire')?.quantity, 1.25);
assert.equal(bom.find((row) => row.category === 'Wire')?.color, 'Yellow');
assert.equal(bom.find((row) => row.partNumber === 'HOUSING-2')?.quantity, 2);
assert.equal(bom.find((row) => row.partNumber === 'CONTACT-M')?.quantity, 1);
assert.equal(bom.find((row) => row.partNumber === 'CONTACT-F')?.quantity, 1);

const csv = manufacturingBomToCsv(bom);
assert(csv.startsWith('Category,Description,Part number,Color,Quantity,Unit,Notes'));
assert(csv.includes('CONTACT-M'));

const unresolved = structuredClone(system);
delete unresolved.paths[0].properties.wire_gauge;
delete unresolved.paths[0].properties.wire_color;
unresolved.paths[0].measurements = [];
const unresolvedBundle = deriveManufacturingBundles(
  unresolved,
  library,
  { schema_version: '1.1.0', bundles: {} },
)[0];
assert.equal(unresolvedBundle.wires[0].gauge, '22-18 AWG');
assert.equal(unresolvedBundle.wires[0].gaugeInferred, true);

const mixedLibrary: ConnectorLibrary = {
  schema_version: '1.1.0',
  connector_types: [
    { ...library.connector_types[0], id: 'family_a', wire_gauge: '22-18 AWG' },
    { ...library.connector_types[0], id: 'family_b', wire_gauge: '20-16 AWG' },
  ],
};
const mixedSystem = structuredClone(unresolved);
mixedSystem.connectors[0].connector_type = 'family_a';
mixedSystem.connectors[1].connector_type = 'family_b';
const mixedBundle = deriveManufacturingBundles(
  mixedSystem,
  mixedLibrary,
  { schema_version: '1.1.0', bundles: {} },
)[0];
assert.equal(mixedBundle.wires[0].gauge, '20-18 AWG');
assert.equal(mixedBundle.wires[0].gaugeInferred, true);
assert.equal(unresolvedBundle.wires[0].color, 'Blue');
assert.equal(unresolvedBundle.wires[0].colorInferred, true);
assert.equal(
  deriveManufacturingBom(unresolved, library, [unresolvedBundle])
    .find((row) => row.category === 'Wire')?.color,
  'Blue',
);
assert(unresolvedBundle.wires[0].issues.some((issue) => issue.includes('contact gender missing')));
assert(unresolvedBundle.wires[0].issues.includes('Cut length missing'));

const chainSystem = structuredClone(system);
chainSystem.connectors.push({
  id: 'con_c',
  name: 'Connector C',
  parent: null,
  connector_type: 'test_family',
  pin_count: 2,
  tags: [],
  properties: {},
});
chainSystem.paths.push({
  id: 'path_2',
  name: 'CAN return',
  tags: ['bundle:Next Harness'],
  properties: {
    wire_id: 'W2',
    wire_color: 'Green',
    wire_gauge: '20 AWG',
  },
  nodes: [
    { kind: 'connector', connector_id: 'con_b', pin_number: 1 },
    { kind: 'connector', connector_id: 'con_c', pin_number: 1 },
  ],
  measurements: [],
});
const chainBundles = deriveManufacturingBundles(chainSystem, library);
const mateBundleIds = matingBundleIdsForConnector(
  chainBundles,
  'bundle:connectors:con_a|con_b',
  'con_b',
);
assert.deepEqual(mateBundleIds, ['bundle:connectors:con_b|con_c']);
const propagated = assignManufacturingEndpointGender(
  { schema_version: '1.1.0', bundles: {} },
  'bundle:connectors:con_a|con_b',
  'con_b',
  'male',
  mateBundleIds,
);
assert.equal(
  propagated.bundles['bundle:connectors:con_a|con_b'].endpoint_genders?.con_b,
  'male',
);
assert.equal(
  propagated.bundles['bundle:connectors:con_b|con_c'].endpoint_genders?.con_b,
  'female',
);
const cleared = assignManufacturingEndpointGender(
  propagated,
  'bundle:connectors:con_a|con_b',
  'con_b',
  undefined,
  mateBundleIds,
);
assert.equal(
  cleared.bundles['bundle:connectors:con_a|con_b'].endpoint_genders?.con_b,
  undefined,
);
assert.equal(
  cleared.bundles['bundle:connectors:con_b|con_c'].endpoint_genders?.con_b,
  undefined,
);

// A bulkhead has two physical sides even when one side spans several bundles.
// Same-side bundles share a gender; bundles across the wall get the opposite.
const bulkheadSystem: SystemData = {
  ...structuredClone(system),
  hierarchy: [
    {
      id: 'enc_box',
      name: 'Accumulator',
      parent: null,
      kind: 'enclosure',
      tags: [],
      properties: {},
    },
    {
      id: 'dev_inside',
      name: 'Internal PCB',
      parent: 'enc_box',
      kind: 'device',
      tags: [],
      properties: {},
    },
  ],
  connectors: [
    {
      ...structuredClone(system.connectors[0]),
      id: 'con_outside',
      name: 'Outside Connector',
      parent: null,
    },
    {
      ...structuredClone(system.connectors[0]),
      id: 'con_bulkhead',
      name: 'Bulkhead Connector',
      parent: 'enc_box',
    },
    {
      ...structuredClone(system.connectors[1]),
      id: 'con_inside',
      name: 'Inside Connector',
      parent: 'dev_inside',
    },
    {
      ...structuredClone(system.connectors[1]),
      id: 'con_inside_2',
      name: 'Second Inside Connector',
      parent: 'dev_inside',
    },
  ],
  paths: [
    {
      id: 'path_outside',
      name: 'Outside leg',
      tags: [],
      properties: { wire_gauge: '20 AWG' },
      nodes: [
        { kind: 'connector', connector_id: 'con_outside', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_bulkhead', pin_number: 1 },
      ],
      measurements: [],
    },
    {
      id: 'path_inside',
      name: 'Inside leg',
      tags: [],
      properties: { wire_gauge: '20 AWG' },
      nodes: [
        { kind: 'connector', connector_id: 'con_bulkhead', pin_number: 2 },
        { kind: 'connector', connector_id: 'con_inside', pin_number: 1 },
      ],
      measurements: [],
    },
    {
      id: 'path_inside_2',
      name: 'Second inside leg',
      tags: [],
      properties: { wire_gauge: '20 AWG' },
      nodes: [
        { kind: 'connector', connector_id: 'con_bulkhead', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_inside_2', pin_number: 1 },
      ],
      measurements: [],
    },
  ],
};
const bulkheadBundles = deriveManufacturingBundles(bulkheadSystem, library);
const outsideBundle = bulkheadBundles.find((bundle) =>
  bundle.connectorIds.includes('con_outside')
);
const insideBundle = bulkheadBundles.find((bundle) =>
  bundle.connectorIds.includes('con_inside')
);
const secondInsideBundle = bulkheadBundles.find((bundle) =>
  bundle.connectorIds.includes('con_inside_2')
);
assert.ok(outsideBundle);
assert.ok(insideBundle);
assert.ok(secondInsideBundle);
const insideRelationship = manufacturingGenderBundleRelationship(
  bulkheadSystem,
  bulkheadBundles,
  insideBundle.id,
  'con_bulkhead',
);
assert.equal(insideRelationship.physicalSide, 'internal');
assert.equal(insideRelationship.assignable, true);
assert.deepEqual(insideRelationship.sameSideBundleIds, [secondInsideBundle.id]);
assert.deepEqual(insideRelationship.mateBundleIds, [outsideBundle.id]);
const mixedBulkheadBundle = {
  ...outsideBundle,
  id: 'bundle:test:mixed-bulkhead',
  name: 'Mixed bulkhead topology',
  wires: [...outsideBundle.wires, ...insideBundle.wires],
};
const mixedRelationship = manufacturingGenderBundleRelationship(
  bulkheadSystem,
  [mixedBulkheadBundle, secondInsideBundle],
  mixedBulkheadBundle.id,
  'con_bulkhead',
);
assert.equal(mixedRelationship.physicalSide, 'mixed');
assert.equal(mixedRelationship.assignable, false);
assert.deepEqual(mixedRelationship.sameSideBundleIds, []);
assert.deepEqual(mixedRelationship.mateBundleIds, []);
const bulkheadMates = matingBundleIdsForConnector(
  bulkheadBundles,
  outsideBundle.id,
  'con_bulkhead',
);
assert.deepEqual(
  [...bulkheadMates].sort(),
  [insideBundle.id, secondInsideBundle.id].sort(),
);
const bulkheadGenderDocument = assignManufacturingEndpointGender(
  { schema_version: '1.2.0', bundles: {} },
  insideBundle.id,
  'con_bulkhead',
  'female',
  [outsideBundle.id],
  [secondInsideBundle.id],
);
const resolvedBulkheadBundles = deriveManufacturingBundles(
  bulkheadSystem,
  library,
  bulkheadGenderDocument,
);
const outsideBulkheadEndpoint = resolvedBulkheadBundles
  .find((bundle) => bundle.id === outsideBundle.id)
  ?.wires.flatMap((wire) => [wire.from, wire.to])
  .find((endpoint) => endpoint.connectorId === 'con_bulkhead');
const insideBulkheadEndpoint = resolvedBulkheadBundles
  .find((bundle) => bundle.id === insideBundle.id)
  ?.wires.flatMap((wire) => [wire.from, wire.to])
  .find((endpoint) => endpoint.connectorId === 'con_bulkhead');
const secondInsideBulkheadEndpoint = resolvedBulkheadBundles
  .find((bundle) => bundle.id === secondInsideBundle.id)
  ?.wires.flatMap((wire) => [wire.from, wire.to])
  .find((endpoint) => endpoint.connectorId === 'con_bulkhead');
assert.equal(outsideBulkheadEndpoint?.terminalGender, 'male');
assert.equal(outsideBulkheadEndpoint?.crimpPartNumber, 'CONTACT-M');
assert.equal(insideBulkheadEndpoint?.terminalGender, 'female');
assert.equal(insideBulkheadEndpoint?.crimpPartNumber, 'CONTACT-F');
assert.equal(secondInsideBulkheadEndpoint?.terminalGender, 'female');
assert.equal(secondInsideBulkheadEndpoint?.crimpPartNumber, 'CONTACT-F');

// A path crossing a connector is two independent harness runs.
const serialSystem = structuredClone(system);
serialSystem.connectors.push(structuredClone(chainSystem.connectors[2]));
serialSystem.paths[0].nodes = [
  { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
  { kind: 'connector', connector_id: 'con_b', pin_number: 2 },
  { kind: 'connector', connector_id: 'con_c', pin_number: 1 },
];
serialSystem.paths[0].measurements = [
  {
    from: { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
    to: { kind: 'connector', connector_id: 'con_b', pin_number: 2 },
    length_mm: 400,
  },
  {
    from: { kind: 'connector', connector_id: 'con_b', pin_number: 2 },
    to: { kind: 'connector', connector_id: 'con_c', pin_number: 1 },
    length_mm: 600,
  },
];
const serialBundles = deriveManufacturingBundles(serialSystem, library);
assert.deepEqual(
  serialBundles.map((bundle) => bundle.id),
  ['bundle:connectors:con_a|con_b', 'bundle:connectors:con_b|con_c'],
);
assert.deepEqual(
  serialBundles.map((bundle) => bundle.wires[0].lengthMm),
  [400, 600],
);
assert.ok(serialBundles.every((bundle) => bundle.wires[0].hops.length === 1));

// New connector-end progress falls back to legacy whole-harness progress.
const componentProgress: ManufacturingDocument = {
  schema_version: '1.1.0',
  bundles: {
    'bundle:connectors:con_a|con_b': {
      steps: { ordered: true },
      component_steps: {
        'connector:con_a': { ordered: true, cut: true },
      },
    },
  },
};
assert.deepEqual(
  manufacturingComponentSteps(
    componentProgress,
    'bundle:connectors:con_a|con_b',
    'connector:con_b',
  ),
  { ordered: true },
);
assert.equal(
  completedManufacturingComponentStepCount(
    componentProgress,
    'bundle:connectors:con_a|con_b',
    'connector:con_a',
  ),
  2,
);

// Through-path with a mid-span branch point collapses to one connector↔connector cut.
const branchedSystem = structuredClone(system);
branchedSystem.branchPoints = [{
  id: 'mp_1',
  name: 'Tap branch',
  parent: null,
  tags: [],
  properties: {},
}];
branchedSystem.paths[0] = {
  ...branchedSystem.paths[0],
  tags: [],
  nodes: [
    { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
    { kind: 'branch', branch_point_id: 'mp_1' },
    { kind: 'connector', connector_id: 'con_b', pin_number: 2 },
  ],
  measurements: [
    {
      from: { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
      to: { kind: 'branch', branch_point_id: 'mp_1' },
      length_mm: 400,
    },
    {
      from: { kind: 'branch', branch_point_id: 'mp_1' },
      to: { kind: 'connector', connector_id: 'con_b', pin_number: 2 },
      length_mm: 850,
    },
  ],
};
const branchedBundles = deriveManufacturingBundles(branchedSystem, library);
assert.equal(branchedBundles.length, 1);
assert.equal(branchedBundles[0].wires.length, 1);
assert.equal(branchedBundles[0].wires[0].from.connectorId, 'con_a');
assert.equal(branchedBundles[0].wires[0].to.connectorId, 'con_b');
assert.equal(branchedBundles[0].wires[0].lengthMm, 1250);
assert.equal(branchedBundles[0].wires[0].hops.length, 2);
assert.equal(branchedBundles[0].wires[0].hops[0].lengthMm, 400);
assert.equal(branchedBundles[0].wires[0].hops[1].lengthMm, 850);
assert.equal(branchedBundles[0].wires[0].hops[0].toKind, 'branch');
assert.equal(branchedBundles[0].wires[0].hops[1].fromKind, 'branch');
assert.equal(branchedBundles[0].wires[0].hops[0].fromKey, 'connector:con_a');
assert.equal(branchedBundles[0].wires[0].hops[0].toKey, 'branch:mp_1');
assert.deepEqual(
  branchedBundles[0].wires[0].viaBranchPoints.map((point) => point.id),
  ['mp_1'],
);
assert.equal(branchedBundles[0].wires[0].fromCrimpOnly, false);

// Applying a new total preserves hop proportions.
const scaled = structuredClone(branchedSystem.paths[0]);
assert.equal(applySpanTotalLength(scaled, 0, 2, 2500), true);
assert.equal(
  scaled.measurements.find((measurement) => measurement.from.kind === 'connector')?.length_mm,
  800,
);
assert.equal(
  scaled.measurements.find((measurement) => measurement.to.kind === 'connector')?.length_mm,
  1700,
);

// Matching branch-point sections is undirected and segment-keyed (not total-length based).
assert.equal(
  manufacturingHopsMatch(
    { fromKey: 'connector:con_a', toKey: 'branch:mp_1' },
    { fromKey: 'connector:con_a', toKey: 'branch:mp_1' },
  ),
  true,
);
assert.equal(
  manufacturingHopsMatch(
    { fromKey: 'connector:con_a', toKey: 'branch:mp_1' },
    { fromKey: 'branch:mp_1', toKey: 'connector:con_a' },
  ),
  true,
);
assert.equal(
  manufacturingHopsMatch(
    { fromKey: 'connector:con_a', toKey: 'branch:mp_1' },
    { fromKey: 'branch:mp_1', toKey: 'connector:con_b' },
  ),
  false,
);

// Stub legs remain explicit connector-to-branch-point runs instead of inventing a mate.
const stubSystem: SystemData = {
  signalPropertyDefinitions: [],
  schema_version: '0.2.0-sheets',
  hierarchy: [],
  connectors: [
    {
      id: 'con_a',
      name: 'Connector A',
      parent: null,
      connector_type: 'test_family',
      pin_count: 2,
      tags: [],
      properties: {},
    },
    {
      id: 'con_b',
      name: 'Connector B',
      parent: null,
      connector_type: 'test_family',
      pin_count: 2,
      tags: [],
      properties: {},
    },
    {
      id: 'con_c',
      name: 'Connector C',
      parent: null,
      connector_type: 'test_family',
      pin_count: 2,
      tags: [],
      properties: {},
    },
  ],
  branchPoints: [{
    id: 'mp_star',
    name: 'Star branch',
    parent: null,
    tags: [],
    properties: {},
  }],
  paths: [
    {
      id: 'path_a',
      name: 'Leg A',
      signal_id: 'sig_gnd',
      tags: [],
      properties: { wire_id: 'WA', wire_color: 'Black', wire_gauge: '20 AWG' },
      nodes: [
        { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
        { kind: 'branch', branch_point_id: 'mp_star' },
      ],
      measurements: [{
        from: { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
        to: { kind: 'branch', branch_point_id: 'mp_star' },
        length_mm: 100,
      }],
    },
    {
      id: 'path_b',
      name: 'Leg B',
      signal_id: 'sig_gnd',
      tags: [],
      properties: { wire_id: 'WB', wire_color: 'Black', wire_gauge: '20 AWG' },
      nodes: [
        { kind: 'connector', connector_id: 'con_b', pin_number: 1 },
        { kind: 'branch', branch_point_id: 'mp_star' },
      ],
      measurements: [{
        from: { kind: 'connector', connector_id: 'con_b', pin_number: 1 },
        to: { kind: 'branch', branch_point_id: 'mp_star' },
        length_mm: 200,
      }],
    },
    {
      id: 'path_c',
      name: 'Leg C',
      signal_id: 'sig_gnd',
      tags: [],
      properties: { wire_id: 'WC', wire_color: 'Black', wire_gauge: '20 AWG' },
      nodes: [
        { kind: 'connector', connector_id: 'con_c', pin_number: 1 },
        { kind: 'branch', branch_point_id: 'mp_star' },
      ],
      measurements: [{
        from: { kind: 'connector', connector_id: 'con_c', pin_number: 1 },
        to: { kind: 'branch', branch_point_id: 'mp_star' },
        length_mm: 300,
      }],
    },
  ],
  signals: [{
    id: 'sig_gnd',
    name: 'GND',
    tags: [],
    properties: {},
  }],
};
const stubBundles = deriveManufacturingBundles(stubSystem, library);
assert.equal(stubBundles.length, 3);
assert.ok(stubBundles.every((bundle) => bundle.wires.length === 1));
assert.deepEqual(
  stubBundles.flatMap((bundle) => bundle.connectorIds).sort(),
  ['con_a', 'con_b', 'con_c'],
);
assert.ok(stubBundles.every((bundle) => bundle.wires[0].from.kind === 'connector'));
assert.ok(stubBundles.every((bundle) => bundle.wires[0].to.kind === 'branch'));
assert.ok(stubBundles.every((bundle) => bundle.wires[0].fromCrimpOnly));
assert.equal(
  stubBundles.flatMap((bundle) => bundle.wires)
    .find((wire) => wire.pathId === 'path_a')?.lengthMm,
  100,
);

// Branch-point-connected runs are one operator-facing physical harness.
const groupedStubHarnesses = deriveManufacturingHarnesses(stubBundles);
assert.equal(groupedStubHarnesses.length, 1);
assert.equal(groupedStubHarnesses[0].bundles.length, 3);
assert.deepEqual(groupedStubHarnesses[0].branchPointIds, ['mp_star']);
assert.equal(groupedStubHarnesses[0].wireCount, 3);

// Visual task transitions retain current attribution and an append-only day log.
const actor = {
  user_id: 'user_joe',
  user_name: 'Joe',
  day: '2026-08-04',
};
const visualProgress = applyManufacturingTaskUpdates(
  { schema_version: '1.1.0', bundles: {} },
  bundles[0].id,
  [
    {
      kind: 'wire-cut',
      wireId: bundles[0].wires[0].id,
      completed: true,
      lengthMm: bundles[0].wires[0].lengthMm,
    },
    {
      kind: 'wire-end',
      wireId: bundles[0].wires[0].id,
      end: 'from',
      connectorId: 'con_a',
      completed: true,
    },
  ],
  actor,
  1_722_833_400_000,
);
assert.equal(visualProgress.schema_version, '1.2.0');
assert.equal(
  visualProgress.bundles[bundles[0].id].wire_progress?.[bundles[0].wires[0].id]?.cut,
  true,
);
assert.equal(
  visualProgress.bundles[bundles[0].id].work_log?.[0].quantity,
  1250,
);
assert.equal(
  visualProgress.bundles[bundles[0].id].task_attribution?.[
    `wire:${bundles[0].wires[0].id}:cut`
  ]?.user_name,
  'Joe',
);
assert.equal(
  manufacturingTaskCompleted(
    visualProgress.bundles[bundles[0].id],
    {
      kind: 'wire-end',
      wireId: bundles[0].wires[0].id,
      end: 'from',
      completed: true,
    },
  ),
  true,
);

// Diagram runs retain useful minimum stretches while compressing large values.
assert(scaleManufacturingRun(220) > scaleManufacturingRun(80));
assert.equal(scaleManufacturingRun(0), scaleManufacturingRun(1));
assert(scaleManufacturingRun(100_000) <= 320);

// A crowded side must not make a branch reverse into its incoming connector.
assert.equal(manufacturingBranchDirection(1000, 400, 1200), -1);
assert.equal(manufacturingBranchDirection(200, 800, 1200), 1);
assert.equal(manufacturingBranchDirection(300, 300, 1200), -1);
assert.equal(manufacturingBranchDirection(900, 900, 1200), 1);

console.log('Manufacturing tests passed.');
