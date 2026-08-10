import assert from 'node:assert/strict';
import { useHarnessStore } from '../src/store/index.js';
import {
  deriveSegments,
  getBundleIdForSegment,
  getLengthSplitDetail,
  getPathNodeSheetName,
  lengthSplitHasExistingLength,
} from '../src/lib/harness.js';
import type { HarnessData } from '../src/types/index.js';

let failures = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}`);
  }
}

// Scenario 1: inserting an inline connector into a bundle that already has
// lengths halves the existing length across the two new hops. The detail the
// inspector's editor renders from must describe both sides (breadcrumb, sheet,
// current per-wire lengths) correctly. Also exercises the "keep total" and
// "reset" apply paths.
{
  const fixture: HarnessData = {
    schema_version: '0.1.0',
    name: 'Length split fixture',
    enclosures: [
      { id: 'dev_a', name: 'Device A', parent: null, container: false, tags: [], properties: {} },
      { id: 'dev_b', name: 'Device B', parent: null, container: false, tags: [], properties: {} },
    ],
    connectors: [
      { id: 'con_a', name: 'A', parent: 'dev_a', connector_type: 'generic', pin_count: 2, tags: [], properties: {} },
      { id: 'con_b', name: 'B', parent: 'dev_b', connector_type: 'generic', pin_count: 2, tags: [], properties: {} },
    ],
    mergePoints: [],
    paths: [
      {
        id: 'path_1',
        name: 'Wire 1',
        signal_id: 'sig_power',
        tags: [],
        properties: {},
        nodes: [
          { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
          { kind: 'connector', connector_id: 'con_b', pin_number: 1 },
        ],
        measurements: [{
          from: { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
          to: { kind: 'connector', connector_id: 'con_b', pin_number: 1 },
          length_mm: 100,
        }],
      },
      {
        id: 'path_2',
        name: 'Wire 2',
        signal_id: 'sig_power',
        tags: [],
        properties: {},
        nodes: [
          { kind: 'connector', connector_id: 'con_a', pin_number: 2 },
          { kind: 'connector', connector_id: 'con_b', pin_number: 2 },
        ],
        measurements: [{
          from: { kind: 'connector', connector_id: 'con_a', pin_number: 2 },
          to: { kind: 'connector', connector_id: 'con_b', pin_number: 2 },
          length_mm: 200,
        }],
      },
    ],
    signals: [{ id: 'sig_power', name: 'Power', tags: [], properties: {} }],
    signalPropertyDefinitions: [],
  };

  useHarnessStore.getState().resetForHarnessSwitch();
  useHarnessStore.getState().setCollabAvailable(false);
  useHarnessStore.getState().loadHarness(structuredClone(fixture));
  useHarnessStore.setState({ undoStack: [], redoStack: [] });

  const firstSegment = deriveSegments(fixture)[0];
  const bundleId = getBundleIdForSegment(firstSegment);
  const connectorId = useHarnessStore.getState().addInlineConnector({
    parent: null,
    position: { x: 0, y: 0 },
    bundle: { id: bundleId, pathIds: ['path_1', 'path_2'] },
  });
  assert.ok(connectorId);

  const harness = useHarnessStore.getState().harness!;
  const detail = getLengthSplitDetail(harness, { kind: 'connector', connectorId: connectorId! });
  check('detail resolves exactly 2 sides', detail?.sides.length === 2);
  check('detail flags an existing length to redistribute', !!detail && lengthSplitHasExistingLength(detail));

  const sideA = detail!.sides.find((side) => side.chain[0]?.label === 'A')!;
  const sideB = detail!.sides.find((side) => side.chain[0]?.label === 'B')!;
  check('side toward A is resolved with its sheet', sideA?.chain[0]?.sheetName === 'Device A');
  check('side toward B is resolved with its sheet', sideB?.chain[0]?.sheetName === 'Device B');
  check(
    'both wires halved onto side A (50 and 100)',
    JSON.stringify(sideA.instances.map((i) => i.lengthMm).sort((a, b) => (a ?? 0) - (b ?? 0))) === '[50,100]',
  );
  check(
    'both wires halved onto side B (50 and 100)',
    JSON.stringify(sideB.instances.map((i) => i.lengthMm).sort((a, b) => (a ?? 0) - (b ?? 0))) === '[50,100]',
  );

  // "Keep total" mode: fix side A to 10mm for every wire; side B should absorb
  // whatever remains of that wire's own original total (100 and 200).
  const sideBByPath = new Map(sideB.instances.map((instance) => [instance.pathId, instance]));
  const keepTotalUpdates = sideA.instances.flatMap((instance) => {
    const counterpart = sideBByPath.get(instance.pathId)!;
    const total = (instance.lengthMm ?? 0) + (counterpart.lengthMm ?? 0);
    return [
      { pathId: instance.pathId, segmentIndex: instance.segmentIndex, lengthMm: 10 },
      { pathId: counterpart.pathId, segmentIndex: counterpart.segmentIndex, lengthMm: total - 10 },
    ];
  });
  useHarnessStore.getState().updatePathSegmentLengths(keepTotalUpdates);

  const afterKeepTotal = useHarnessStore.getState().harness!;
  const totalFor = (pathId: string) =>
    afterKeepTotal.paths.find((path) => path.id === pathId)!.measurements
      .reduce((sum, measurement) => sum + (measurement.length_mm ?? 0), 0);
  check('"keep total" preserves path_1\'s own total (10 + 90 = 100)', totalFor('path_1') === 100);
  check('"keep total" preserves path_2\'s own total (10 + 190 = 200)', totalFor('path_2') === 200);

  // Reset mode: clear every side on every wire.
  const detailAfterKeepTotal = getLengthSplitDetail(afterKeepTotal, { kind: 'connector', connectorId: connectorId! })!;
  const resetUpdates = detailAfterKeepTotal.sides.flatMap((side) =>
    side.instances.map((instance) => ({
      pathId: instance.pathId,
      segmentIndex: instance.segmentIndex,
      lengthMm: undefined,
    })));
  useHarnessStore.getState().updatePathSegmentLengths(resetUpdates);

  const afterReset = useHarnessStore.getState().harness!;
  check('reset clears every measurement on both hops', afterReset.paths.every((path) => path.measurements.length === 0));

  const detailAfterReset = getLengthSplitDetail(afterReset, { kind: 'connector', connectorId: connectorId! });
  check('detail still resolves once lengths are cleared (so it can be set again)', detailAfterReset?.sides.length === 2);
  check('no existing length is flagged once cleared', !!detailAfterReset && !lengthSplitHasExistingLength(detailAfterReset));
}

// Scenario 2: two wires share the same inline connector but their `Path.nodes`
// arrays run in opposite directions. Sides must still group by the neighbor's
// identity (bundle key), not by raw "before"/"after" array position.
{
  const harness: HarnessData = {
    schema_version: '0.1.0',
    name: 'Reversed direction fixture',
    enclosures: [],
    connectors: [
      { id: 'con_a', name: 'A', parent: null, connector_type: 'generic', pin_count: 2, tags: [], properties: {} },
      { id: 'con_b', name: 'B', parent: null, connector_type: 'generic', pin_count: 2, tags: [], properties: {} },
      { id: 'con_mid', name: 'Mid', parent: null, connector_type: 'generic', pin_count: 2, mounting: 'inline', tags: [], properties: {} },
    ],
    mergePoints: [],
    paths: [
      {
        id: 'path_fwd',
        name: 'Forward',
        tags: [],
        properties: {},
        nodes: [
          { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
          { kind: 'connector', connector_id: 'con_mid', pin_number: 1 },
          { kind: 'connector', connector_id: 'con_b', pin_number: 1 },
        ],
        measurements: [
          {
            from: { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
            to: { kind: 'connector', connector_id: 'con_mid', pin_number: 1 },
            length_mm: 10,
          },
          {
            from: { kind: 'connector', connector_id: 'con_mid', pin_number: 1 },
            to: { kind: 'connector', connector_id: 'con_b', pin_number: 1 },
            length_mm: 20,
          },
        ],
      },
      {
        id: 'path_rev',
        name: 'Reversed',
        tags: [],
        properties: {},
        nodes: [
          { kind: 'connector', connector_id: 'con_b', pin_number: 2 },
          { kind: 'connector', connector_id: 'con_mid', pin_number: 2 },
          { kind: 'connector', connector_id: 'con_a', pin_number: 2 },
        ],
        measurements: [
          {
            from: { kind: 'connector', connector_id: 'con_b', pin_number: 2 },
            to: { kind: 'connector', connector_id: 'con_mid', pin_number: 2 },
            length_mm: 30,
          },
          {
            from: { kind: 'connector', connector_id: 'con_mid', pin_number: 2 },
            to: { kind: 'connector', connector_id: 'con_a', pin_number: 2 },
            length_mm: 40,
          },
        ],
      },
    ],
    signals: [],
    signalPropertyDefinitions: [],
  };

  const detail = getLengthSplitDetail(harness, { kind: 'connector', connectorId: 'con_mid' })!;
  check('reversed-direction fixture still resolves exactly 2 sides', detail.sides.length === 2);

  const sideA = detail.sides.find((side) => side.chain[0]?.label === 'A')!;
  const sideB = detail.sides.find((side) => side.chain[0]?.label === 'B')!;
  check(
    'side toward A groups the correct hop from each wire regardless of array direction',
    JSON.stringify(sideA.instances.map((i) => i.lengthMm).sort((a, b) => (a ?? 0) - (b ?? 0))) === '[10,40]',
  );
  check(
    'side toward B groups the correct hop from each wire regardless of array direction',
    JSON.stringify(sideB.instances.map((i) => i.lengthMm).sort((a, b) => (a ?? 0) - (b ?? 0))) === '[20,30]',
  );
}

// Scenario 3: a splice with more than two distinct neighbors (a real N-way
// splice) must resolve one side per distinct neighbor instead of assuming 2.
{
  const harness: HarnessData = {
    schema_version: '0.1.0',
    name: 'Splice fixture',
    enclosures: [
      { id: 'enc_cabin', name: 'Cabin', parent: null, container: true, tags: [], properties: {} },
    ],
    connectors: [
      { id: 'con_x', name: 'X', parent: 'enc_cabin', connector_type: 'generic', pin_count: 1, tags: [], properties: {} },
      { id: 'con_y', name: 'Y', parent: null, connector_type: 'generic', pin_count: 2, tags: [], properties: {} },
      { id: 'con_z', name: 'Z', parent: null, connector_type: 'generic', pin_count: 1, tags: [], properties: {} },
    ],
    mergePoints: [
      { id: 'mp_1', name: 'Splice 1', parent: null, tags: [], properties: {} },
    ],
    paths: [
      {
        id: 'path_xy',
        name: 'X-Y',
        tags: [],
        properties: {},
        nodes: [
          { kind: 'connector', connector_id: 'con_x', pin_number: 1 },
          { kind: 'merge', merge_point_id: 'mp_1' },
          { kind: 'connector', connector_id: 'con_y', pin_number: 1 },
        ],
        measurements: [],
      },
      {
        id: 'path_yz',
        name: 'Y-Z',
        tags: [],
        properties: {},
        nodes: [
          { kind: 'connector', connector_id: 'con_y', pin_number: 2 },
          { kind: 'merge', merge_point_id: 'mp_1' },
          { kind: 'connector', connector_id: 'con_z', pin_number: 1 },
        ],
        measurements: [],
      },
    ],
    signals: [],
    signalPropertyDefinitions: [],
  };

  const detail = getLengthSplitDetail(harness, { kind: 'merge', mergePointId: 'mp_1' })!;
  check('a 3-way splice resolves 3 distinct sides', detail.sides.length === 3);
  check('the splice\'s own label is its name', detail.targetLabel === 'Splice 1');
  check('the splice is reported as a merge target', detail.targetKind === 'merge');

  const sideY = detail.sides.find((side) => side.chain[0]?.label === 'Y')!;
  check('the shared neighbor (Y) collects both of its wires into one side', sideY?.instances.length === 2);

  check(
    'a splice with no parent falls back to the root harness name as its sheet',
    getPathNodeSheetName(harness, { kind: 'merge', merge_point_id: 'mp_1' }) === 'Splice fixture',
  );
  check(
    'a connector owned by an enclosure resolves that enclosure as its sheet',
    getPathNodeSheetName(harness, { kind: 'connector', connector_id: 'con_x', pin_number: 1 }) === 'Cabin',
  );
}

// Scenario 4: a node with only one distinct neighbor (or none at all) has
// nothing to redistribute, and must report no detail rather than a bogus
// single-sided split.
{
  const harness: HarnessData = {
    schema_version: '0.1.0',
    name: 'No-split fixture',
    enclosures: [],
    connectors: [
      { id: 'con_free', name: 'Free', parent: null, connector_type: 'generic', mounting: 'inline', pin_count: 1, tags: [], properties: {} },
    ],
    mergePoints: [],
    paths: [],
    signals: [],
    signalPropertyDefinitions: [],
  };
  check(
    'a free-hanging, unpopulated inline connector has no split detail',
    getLengthSplitDetail(harness, { kind: 'connector', connectorId: 'con_free' }) === null,
  );
}

if (failures > 0) {
  console.error(`${failures} length-split test(s) failed.`);
  process.exit(1);
}
console.log('Length split tests passed.');
