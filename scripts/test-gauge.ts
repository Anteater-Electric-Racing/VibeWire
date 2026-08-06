#!/usr/bin/env -S npx tsx
import assert from 'node:assert/strict';
import {
  formatAwgRange,
  inferGaugeFromEnds,
  intersectAwgRanges,
  parseAwgRange,
} from '../src/lib/gauge.js';
import {
  getPathBulkheadSidesAtConnector,
  getPathsTouchingConnector,
  isBulkheadConnector,
  isInteriorToEnclosure,
} from '../src/lib/harness.js';
import type { HarnessData } from '../src/types/index.js';

assert.deepEqual(parseAwgRange('20 AWG'), { minAwg: 20, maxAwg: 20 });
assert.deepEqual(parseAwgRange('22-18 AWG'), { minAwg: 22, maxAwg: 18 });
assert.deepEqual(parseAwgRange('18-22'), { minAwg: 22, maxAwg: 18 });
assert.equal(parseAwgRange(''), null);
assert.equal(formatAwgRange({ minAwg: 20, maxAwg: 20 }), '20 AWG');
assert.equal(formatAwgRange({ minAwg: 22, maxAwg: 18 }), '22-18 AWG');

assert.deepEqual(
  intersectAwgRanges({ minAwg: 22, maxAwg: 18 }, { minAwg: 20, maxAwg: 16 }),
  { minAwg: 20, maxAwg: 18 },
);
assert.equal(
  intersectAwgRanges({ minAwg: 22, maxAwg: 20 }, { minAwg: 18, maxAwg: 16 }),
  null,
);

assert.deepEqual(
  inferGaugeFromEnds('22-18 AWG', '20-16 AWG'),
  { gauge: '20-18 AWG', inferred: true },
);
assert.deepEqual(
  inferGaugeFromEnds('22-20 AWG', '18-16 AWG'),
  { gauge: '', inferred: false },
);
assert.deepEqual(
  inferGaugeFromEnds('22-18 AWG', undefined),
  { gauge: '22-18 AWG', inferred: true },
);
assert.deepEqual(
  inferGaugeFromEnds('20 AWG', '20 AWG'),
  { gauge: '20 AWG', inferred: true },
);

const harness: HarnessData = {
  schema_version: '0.2.0-sheets',
  signalPropertyDefinitions: [],
  enclosures: [
    { id: 'enc_box', name: 'Box', parent: null, container: true, tags: [], properties: {} },
    { id: 'enc_pcb', name: 'PCB', parent: 'enc_box', container: false, tags: [], properties: {} },
  ],
  connectors: [
    {
      id: 'bh_1',
      name: 'Bulkhead',
      parent: 'enc_box',
      connector_type: 'generic',
      pin_count: 2,
      tags: [],
      properties: {},
    },
    {
      id: 'ext_1',
      name: 'External',
      parent: null,
      connector_type: 'generic',
      pin_count: 1,
      tags: [],
      properties: {},
    },
    {
      id: 'pcb_1',
      name: 'PCB Conn',
      parent: 'enc_pcb',
      connector_type: 'generic',
      pin_count: 1,
      tags: [],
      properties: {},
    },
    {
      id: 'dev_1',
      name: 'Device Conn',
      parent: 'enc_pcb',
      connector_type: 'generic',
      pin_count: 1,
      tags: [],
      properties: {},
    },
  ],
  mergePoints: [],
  paths: [
    {
      id: 'path_ext',
      name: 'External wire',
      tags: [],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'ext_1', pin_number: 1 },
        { kind: 'connector', connector_id: 'bh_1', pin_number: 1 },
      ],
      measurements: [],
    },
    {
      id: 'path_int',
      name: 'Internal wire',
      tags: [],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'bh_1', pin_number: 1 },
        { kind: 'connector', connector_id: 'pcb_1', pin_number: 1 },
      ],
      measurements: [],
    },
    {
      id: 'path_through',
      name: 'Through wire',
      tags: [],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'ext_1', pin_number: 1 },
        { kind: 'connector', connector_id: 'bh_1', pin_number: 2 },
        { kind: 'connector', connector_id: 'pcb_1', pin_number: 1 },
      ],
      measurements: [],
    },
    {
      id: 'path_device',
      name: 'Device only',
      tags: [],
      properties: { wire_gauge: '18 AWG' },
      nodes: [
        { kind: 'connector', connector_id: 'pcb_1', pin_number: 1 },
        { kind: 'connector', connector_id: 'dev_1', pin_number: 1 },
      ],
      measurements: [],
    },
  ],
  signals: [],
};

assert.equal(isBulkheadConnector(harness, 'bh_1'), true);
assert.equal(isBulkheadConnector(harness, 'pcb_1'), false);
assert.equal(
  isInteriorToEnclosure(
    harness,
    { kind: 'connector', connector_id: 'pcb_1', pin_number: 1 },
    'enc_box',
  ),
  true,
);
assert.equal(
  isInteriorToEnclosure(
    harness,
    { kind: 'connector', connector_id: 'ext_1', pin_number: 1 },
    'enc_box',
  ),
  false,
);

assert.equal(getPathBulkheadSidesAtConnector(harness, 'bh_1', harness.paths[0]), 'external');
assert.equal(getPathBulkheadSidesAtConnector(harness, 'bh_1', harness.paths[1]), 'internal');
assert.equal(getPathBulkheadSidesAtConnector(harness, 'bh_1', harness.paths[2]), 'both');

assert.deepEqual(
  getPathsTouchingConnector(harness, 'bh_1', 'external').map((path) => path.id).sort(),
  ['path_ext', 'path_through'],
);
assert.deepEqual(
  getPathsTouchingConnector(harness, 'bh_1', 'internal').map((path) => path.id).sort(),
  ['path_int', 'path_through'],
);
assert.deepEqual(
  getPathsTouchingConnector(harness, 'bh_1', 'both').map((path) => path.id).sort(),
  ['path_ext', 'path_int', 'path_through'],
);
assert.deepEqual(
  getPathsTouchingConnector(harness, 'pcb_1', 'both').map((path) => path.id).sort(),
  ['path_device', 'path_int', 'path_through'],
);

console.log('gauge + bulkhead side tests passed');
