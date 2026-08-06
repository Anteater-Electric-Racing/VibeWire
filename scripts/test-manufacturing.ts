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
  manufacturingHopsMatch,
  manufacturingTaskCompleted,
  manufacturingBomToCsv,
  matingBundleIdsForConnector,
} from '../src/lib/manufacturing.js';
import type {
  ConnectorLibrary,
  HarnessData,
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

const harness: HarnessData = {
  signalPropertyDefinitions: [],
  schema_version: '0.2.0-sheets',
  enclosures: [],
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
  mergePoints: [],
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
const bundles = deriveManufacturingBundles(harness, library, manufacturing);
assert.equal(bundles.length, 1);
assert.equal(bundles[0].id, 'bundle:connectors:con_a|con_b');
assert.equal(bundles[0].wires.length, 1);
assert.equal(bundles[0].wires[0].segmentIndex, 0);
assert.equal(bundles[0].knownLengthMm, 1250);
assert.equal(bundles[0].issueCount, 0);
assert.equal(bundles[0].wires[0].from.crimpPartNumber, 'CONTACT-M');
assert.equal(bundles[0].wires[0].to.crimpPartNumber, 'CONTACT-F');

const bom = deriveManufacturingBom(harness, library, bundles);
assert.equal(bom.find((row) => row.category === 'Wire')?.quantity, 1.25);
assert.equal(bom.find((row) => row.category === 'Wire')?.color, 'Yellow');
assert.equal(bom.find((row) => row.partNumber === 'HOUSING-2')?.quantity, 2);
assert.equal(bom.find((row) => row.partNumber === 'CONTACT-M')?.quantity, 1);
assert.equal(bom.find((row) => row.partNumber === 'CONTACT-F')?.quantity, 1);

const csv = manufacturingBomToCsv(bom);
assert(csv.startsWith('Category,Description,Part number,Color,Quantity,Unit,Notes'));
assert(csv.includes('CONTACT-M'));

const unresolved = structuredClone(harness);
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
const mixedHarness = structuredClone(unresolved);
mixedHarness.connectors[0].connector_type = 'family_a';
mixedHarness.connectors[1].connector_type = 'family_b';
const mixedBundle = deriveManufacturingBundles(
  mixedHarness,
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

const chainHarness = structuredClone(harness);
chainHarness.connectors.push({
  id: 'con_c',
  name: 'Connector C',
  parent: null,
  connector_type: 'test_family',
  pin_count: 2,
  tags: [],
  properties: {},
});
chainHarness.paths.push({
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
const chainBundles = deriveManufacturingBundles(chainHarness, library);
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

// A path crossing a connector is two independent harness runs.
const serialHarness = structuredClone(harness);
serialHarness.connectors.push(structuredClone(chainHarness.connectors[2]));
serialHarness.paths[0].nodes = [
  { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
  { kind: 'connector', connector_id: 'con_b', pin_number: 2 },
  { kind: 'connector', connector_id: 'con_c', pin_number: 1 },
];
serialHarness.paths[0].measurements = [
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
const serialBundles = deriveManufacturingBundles(serialHarness, library);
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

// Through-path with a mid-span splice collapses to one connector↔connector cut.
const splicedHarness = structuredClone(harness);
splicedHarness.mergePoints = [{
  id: 'mp_1',
  name: 'Tap splice',
  parent: null,
  tags: [],
  properties: {},
}];
splicedHarness.paths[0] = {
  ...splicedHarness.paths[0],
  tags: [],
  nodes: [
    { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
    { kind: 'merge', merge_point_id: 'mp_1' },
    { kind: 'connector', connector_id: 'con_b', pin_number: 2 },
  ],
  measurements: [
    {
      from: { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
      to: { kind: 'merge', merge_point_id: 'mp_1' },
      length_mm: 400,
    },
    {
      from: { kind: 'merge', merge_point_id: 'mp_1' },
      to: { kind: 'connector', connector_id: 'con_b', pin_number: 2 },
      length_mm: 850,
    },
  ],
};
const splicedBundles = deriveManufacturingBundles(splicedHarness, library);
assert.equal(splicedBundles.length, 1);
assert.equal(splicedBundles[0].wires.length, 1);
assert.equal(splicedBundles[0].wires[0].from.connectorId, 'con_a');
assert.equal(splicedBundles[0].wires[0].to.connectorId, 'con_b');
assert.equal(splicedBundles[0].wires[0].lengthMm, 1250);
assert.equal(splicedBundles[0].wires[0].hops.length, 2);
assert.equal(splicedBundles[0].wires[0].hops[0].lengthMm, 400);
assert.equal(splicedBundles[0].wires[0].hops[1].lengthMm, 850);
assert.equal(splicedBundles[0].wires[0].hops[0].toKind, 'merge');
assert.equal(splicedBundles[0].wires[0].hops[1].fromKind, 'merge');
assert.equal(splicedBundles[0].wires[0].hops[0].fromKey, 'connector:con_a');
assert.equal(splicedBundles[0].wires[0].hops[0].toKey, 'merge:mp_1');
assert.deepEqual(
  splicedBundles[0].wires[0].viaSplices.map((splice) => splice.id),
  ['mp_1'],
);
assert.equal(splicedBundles[0].wires[0].fromCrimpOnly, false);

// Applying a new total preserves hop proportions.
const scaled = structuredClone(splicedHarness.paths[0]);
assert.equal(applySpanTotalLength(scaled, 0, 2, 2500), true);
assert.equal(
  scaled.measurements.find((measurement) => measurement.from.kind === 'connector')?.length_mm,
  800,
);
assert.equal(
  scaled.measurements.find((measurement) => measurement.to.kind === 'connector')?.length_mm,
  1700,
);

// Matching splice sections is undirected and segment-keyed (not total-length based).
assert.equal(
  manufacturingHopsMatch(
    { fromKey: 'connector:con_a', toKey: 'merge:mp_1' },
    { fromKey: 'connector:con_a', toKey: 'merge:mp_1' },
  ),
  true,
);
assert.equal(
  manufacturingHopsMatch(
    { fromKey: 'connector:con_a', toKey: 'merge:mp_1' },
    { fromKey: 'merge:mp_1', toKey: 'connector:con_a' },
  ),
  true,
);
assert.equal(
  manufacturingHopsMatch(
    { fromKey: 'connector:con_a', toKey: 'merge:mp_1' },
    { fromKey: 'merge:mp_1', toKey: 'connector:con_b' },
  ),
  false,
);

// Stub legs remain explicit connector-to-splice runs instead of inventing a mate.
const stubHarness: HarnessData = {
  signalPropertyDefinitions: [],
  schema_version: '0.2.0-sheets',
  enclosures: [],
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
  mergePoints: [{
    id: 'mp_star',
    name: 'Star splice',
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
        { kind: 'merge', merge_point_id: 'mp_star' },
      ],
      measurements: [{
        from: { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
        to: { kind: 'merge', merge_point_id: 'mp_star' },
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
        { kind: 'merge', merge_point_id: 'mp_star' },
      ],
      measurements: [{
        from: { kind: 'connector', connector_id: 'con_b', pin_number: 1 },
        to: { kind: 'merge', merge_point_id: 'mp_star' },
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
        { kind: 'merge', merge_point_id: 'mp_star' },
      ],
      measurements: [{
        from: { kind: 'connector', connector_id: 'con_c', pin_number: 1 },
        to: { kind: 'merge', merge_point_id: 'mp_star' },
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
const stubBundles = deriveManufacturingBundles(stubHarness, library);
assert.equal(stubBundles.length, 3);
assert.ok(stubBundles.every((bundle) => bundle.wires.length === 1));
assert.deepEqual(
  stubBundles.flatMap((bundle) => bundle.connectorIds).sort(),
  ['con_a', 'con_b', 'con_c'],
);
assert.ok(stubBundles.every((bundle) => bundle.wires[0].from.kind === 'connector'));
assert.ok(stubBundles.every((bundle) => bundle.wires[0].to.kind === 'merge'));
assert.ok(stubBundles.every((bundle) => bundle.wires[0].fromCrimpOnly));
assert.equal(
  stubBundles.flatMap((bundle) => bundle.wires)
    .find((wire) => wire.pathId === 'path_a')?.lengthMm,
  100,
);

// Splice-connected branches are one operator-facing physical harness.
const groupedStubHarnesses = deriveManufacturingHarnesses(stubBundles);
assert.equal(groupedStubHarnesses.length, 1);
assert.equal(groupedStubHarnesses[0].bundles.length, 3);
assert.deepEqual(groupedStubHarnesses[0].spliceIds, ['mp_star']);
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

console.log('Manufacturing tests passed.');
