#!/usr/bin/env -S npx tsx
/**
 * Dual-read / canonical-write coverage for the domain model migration.
 */
import assert from 'node:assert/strict';
import { splitSystem } from '../server/sheets.js';
import {
  normalizeCollaborationDocument,
  normalizeLayouts,
  normalizeManufacturingDocument,
  normalizePeerPresence,
  normalizeSystemData,
} from '../src/lib/systemNormalize.js';

const legacyFlat = {
  schema_version: '0.1.0',
  name: 'Legacy Flat',
  enclosures: [
    { id: 'enc_box', name: 'Box', parent: null, container: true, tags: [], properties: {} },
    { id: 'dev_a', name: 'Device A', parent: 'enc_box', container: false, tags: [], properties: {} },
  ],
  connectors: [
    { id: 'con_wall', name: 'Wall', parent: 'enc_box', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_a', name: 'A', parent: 'dev_a', connector_type: 'generic', tags: [], properties: {} },
  ],
  mergePoints: [
    { id: 'mp_001', name: 'Splice 1', parent: 'enc_box', tags: [], properties: {} },
  ],
  paths: [{
    id: 'path_1',
    name: 'Wire',
    tags: [],
    properties: {},
    nodes: [
      { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
      { kind: 'merge', merge_point_id: 'mp_001' },
      { kind: 'connector', connector_id: 'con_wall', pin_number: 1 },
    ],
    measurements: [],
  }],
  signals: [],
  signalPropertyDefinitions: [],
};

const canonical = normalizeSystemData(legacyFlat);
assert.equal(canonical.schema_version, '0.3.0');
assert.equal('enclosures' in canonical, false);
assert.equal('mergePoints' in canonical, false);
assert.deepEqual(canonical.hierarchy.map((item) => item.id), ['enc_box', 'dev_a']);
assert.equal(canonical.hierarchy[0].kind, 'enclosure');
assert.equal(canonical.hierarchy[1].kind, 'device');
assert.equal(canonical.branchPoints[0].id, 'mp_001');
assert.equal(canonical.branchPoints[0].name, 'Branch 1');
assert.equal(canonical.connectors.find((item) => item.id === 'con_wall')?.mounting, 'bulkhead');
assert.equal(canonical.connectors.find((item) => item.id === 'con_a')?.mounting, undefined);
const branchNode = canonical.paths[0].nodes[1];
assert.equal(branchNode.kind, 'branch');
if (branchNode.kind !== 'branch') throw new Error('expected branch node');
assert.equal(branchNode.branch_point_id, 'mp_001');
assert.equal(JSON.stringify(canonical).includes('"container"'), false);
assert.equal(JSON.stringify(canonical).includes('merge_point_id'), false);
assert.equal(JSON.stringify(canonical).includes('"kind":"merge"'), false);
assert.deepEqual(normalizeSystemData(canonical), canonical);

const layouts = normalizeLayouts({
  nodes: { enc_box: { x: 1, y: 2 } },
  junctions: {
    jct_1: {
      id: 'jct_1',
      x: 10,
      y: 20,
      memberEdgeIds: ['bundle:merge:mp_001|connector:con_a'],
      mergePointId: 'mp_001',
    },
  },
  waypoints: {
    'bundle:merge:mp_001|connector:con_a': [{ junctionId: 'jct_1' }],
  },
  mergePoints: { graph: { mp_001: { x: 3, y: 4 } } },
});
assert.ok(layouts.sharedAnchors.jct_1);
assert.equal(layouts.sharedAnchors.jct_1.id, 'jct_1');
assert.equal(layouts.sharedAnchors.jct_1.branchPointId, 'mp_001');
assert.deepEqual(layouts.waypoints['bundle:branch:mp_001|connector:con_a'], [{ sharedAnchorId: 'jct_1' }]);
assert.deepEqual(layouts.branchPoints.graph.mp_001, { x: 3, y: 4 });
assert.equal(JSON.stringify(layouts).includes('"junctions"'), false);
assert.equal(JSON.stringify(layouts).includes('junctionId'), false);

const resorted = normalizeLayouts({
  waypoints: {
    'bundle:connector:con_a|branch:mp_001': [{ x: 1, y: 2 }],
  },
});
assert.deepEqual(resorted.waypoints['bundle:branch:mp_001|connector:con_a'], [{ x: 1, y: 2 }]);
assert.equal('bundle:connector:con_a|branch:mp_001' in resorted.waypoints, false);

const manufacturing = normalizeManufacturingDocument({
  schema_version: '1.1.0',
  bundles: {
    'bundle:merge:mp_001|connector:con_a': {
      steps: {},
      splice_measured: { mp_001: true },
      work_log: [{
        id: 'evt_1',
        user_id: 'u',
        user_name: 'U',
        day: '2026-09-04',
        task_key: 'splice:mp_001:measured',
        kind: 'splice-measured',
        action: 'complete',
      }],
    },
  },
});
const mfgBundle = manufacturing.bundles['bundle:branch:mp_001|connector:con_a'];
assert.ok(mfgBundle);
assert.equal(mfgBundle.branch_measured?.mp_001, true);
assert.equal(mfgBundle.work_log?.[0].kind, 'branch-measured');
assert.equal(mfgBundle.work_log?.[0].task_key, 'branch:mp_001:measured');

const presence = normalizePeerPresence({
  sessionId: 's',
  userId: 'u',
  displayName: 'U',
  color: '#fff',
  harness: 'demo',
  drillDownEnclosure: 'enc_box',
  focus: { kind: 'mergePoint', id: 'mp_001' },
  editing: { kind: 'harness', id: 'bundle:legacy' },
  lastSeen: 1,
});
assert.equal(presence?.system, 'demo');
assert.equal(presence?.openEnclosureId, 'enc_box');
assert.equal(presence?.focus?.kind, 'branchPoint');
assert.equal(presence?.editing?.kind, 'harnessBundle');

const collab = normalizeCollaborationDocument({
  harness: legacyFlat,
  layouts: { junctions: { jct_1: { id: 'jct_1', x: 0, y: 0, memberEdgeIds: [] } } },
});
assert.equal(collab.system?.hierarchy[0].kind, 'enclosure');
assert.ok(collab.layouts && 'sharedAnchors' in collab.layouts && !('patch' in collab.layouts));
if (collab.layouts && !('patch' in collab.layouts)) {
  assert.ok(collab.layouts.sharedAnchors?.jct_1);
}

const split = splitSystem(canonical, new Set(['enc_box']));
const root = split.sheets.get(null);
const child = split.sheets.get('enc_box');
assert.ok(root && child);
assert.equal(root.schema_version, '0.3.0-sheets');
assert.equal(child.schema_version, '0.3.0-sheets');
assert.equal('enclosures' in root, false);
assert.equal('mergePoints' in root, false);
assert.ok(root.hierarchy.some((item) => item.id === 'enc_box' && item.kind === 'enclosure'));
assert.ok(child.hierarchy.some((item) => item.id === 'dev_a' && item.kind === 'device'));
assert.ok(
  [...root.ports, ...child.ports].every((port) => port.entity_kind === 'connector' || port.entity_kind === 'branch'),
);

console.log('PASS domain-model dual-read and canonical write');
