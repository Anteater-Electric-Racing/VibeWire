#!/usr/bin/env -S npx tsx
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyConnectorPinCount,
  getConnectorHousingPartNumber,
  getConnectorPinGuideImage,
  getConnectorSchematicImage,
  getConnectorSideImage,
  getConnectorSupportedKeyings,
  getEffectivePinCount,
  getNextConnectorPinCount,
  getPreviousConnectorPinCount,
  normalizeConnectorKeying,
} from '../src/lib/connectorFamily.js';
import type { Connector, ConnectorType } from '../src/types/index.js';
import { splitHarness, verifyRoundTrip, type HarnessData } from '../server/sheets.js';
import {
  migrateConnectorTypeToGeneric,
  validateConnectorLibraryData,
  validateHarnessData,
} from '../server/api.js';

const family: ConnectorType = {
  id: 'test_family',
  name: 'Test Family',
  pin_count: 0,
  crimp_spec: '',
  male_crimp_part_number: 'CONTACT-M',
  female_crimp_part_number: 'CONTACT-F',
  wire_gauge: '',
  notes: '',
  cavity_variants: [
    { pin_count: 2, image: '2.png', side_image: '2-side.png' },
    {
      pin_count: 4,
      image: '4.png',
      male_image: '4-male.png',
      female_image: '4-female.png',
      side_image: '4-side.png',
      housing_part_number: 'HOUSING-4',
      male_housing_part_number: 'HOUSING-4-M',
      female_housing_part_number: 'HOUSING-4-F',
    },
    { pin_count: 6, keyings: ['A', 'B'] },
  ],
};

const connector: Connector = {
  id: 'con_001',
  name: 'Family connector',
  parent: 'enc_001',
  connector_type: family.id,
  pin_count: 4,
  tags: [],
  properties: {},
};

assert.equal(getEffectivePinCount(connector, family), 4);
assert.equal(getNextConnectorPinCount(family, 4), 6);
assert.equal(getNextConnectorPinCount(family, 6), 6);
assert.equal(getPreviousConnectorPinCount(family, 6, 5), 6);
assert.equal(getPreviousConnectorPinCount(family, 6, 4), 4);
assert.equal(getConnectorPinGuideImage(connector, family), '4.png');
assert.equal(getConnectorPinGuideImage(connector, family, 'male'), '4-male.png');
assert.equal(getConnectorPinGuideImage(connector, family, 'female'), '4-female.png');
assert.equal(getConnectorSideImage(connector, family), '4-side.png');
assert.equal(getConnectorHousingPartNumber(connector, family, 'male'), 'HOUSING-4-M');
assert.equal(getConnectorHousingPartNumber(connector, family, 'female'), 'HOUSING-4-F');
assert.equal(
  getConnectorSchematicImage(connector, family, { bulkhead: true }),
  '4-side.png',
);
assert.equal(
  getConnectorSchematicImage(connector, family, { bulkhead: false }),
  undefined,
);
assert.equal(
  getConnectorSchematicImage(
    { ...connector, properties: { image: 'free-hanging.png' } },
    family,
    { bulkhead: false },
  ),
  'free-hanging.png',
);
assert.equal(
  getConnectorSchematicImage(
    { ...connector, properties: { image: 'free-hanging.png' } },
    family,
    { bulkhead: true },
  ),
  '4-side.png',
);
assert.deepEqual(getConnectorSupportedKeyings(connector, family), []);

applyConnectorPinCount(connector, family, 5);
assert.equal(connector.pin_count, 6);
assert.deepEqual(getConnectorSupportedKeyings(connector, family), ['A', 'B']);
connector.keying = 'B';
normalizeConnectorKeying(connector, family);
assert.equal(connector.keying, 'B');
applyConnectorPinCount(connector, family, 4);
normalizeConnectorKeying(connector, family);
assert.equal(connector.keying, undefined);

const harness: HarnessData = {
  signalPropertyDefinitions: [],
  schema_version: '0.2.0-sheets',
  enclosures: [{
    id: 'enc_001',
    name: 'Box',
    parent: null,
    container: true,
    tags: [],
    properties: {},
  }],
  connectors: [{ ...connector, pin_count: 6, keying: 'A' }],
  mergePoints: [],
  paths: [],
  signals: [],
};
const split = splitHarness(harness, new Set(['enc_001']));
assert.deepEqual(verifyRoundTrip(harness, split, new Set(['enc_001'])), []);

const validResult = validateHarnessData(harness, { connector_types: [family] });
assert.equal(validResult.valid, true);
assert.equal(validResult.warnings.length, 0);

const invalidSelection = structuredClone(harness);
invalidSelection.connectors[0].pin_count = 5;
invalidSelection.connectors[0].keying = 'Z';
const invalidResult = validateHarnessData(invalidSelection, { connector_types: [family] });
assert(invalidResult.warnings.some((warning) => warning.includes('unsupported 5-cavity housing')));
assert(invalidResult.warnings.some((warning) => warning.includes("unsupported key 'Z'")));

const genericType: ConnectorType = {
  id: 'generic_multipin',
  name: 'Generic Multi-pin',
  pin_count: 0,
  crimp_spec: '',
  wire_gauge: '',
  notes: '',
  default_properties: { migrated_default: 'yes' },
};
const migrated = migrateConnectorTypeToGeneric(harness, family, genericType);
assert.equal(migrated.migrated, 1);
assert.equal(migrated.harness.connectors[0].connector_type, genericType.id);
assert.equal(migrated.harness.connectors[0].pin_count, 6);
assert.equal(migrated.harness.connectors[0].keying, undefined);
assert.equal(migrated.harness.connectors[0].properties.migrated_default, 'yes');

const library = JSON.parse(
  fs.readFileSync(
    path.resolve(import.meta.dirname, '../public/user-data/connectors/connector-library.json'),
    'utf8',
  ),
) as { connector_types: ConnectorType[] };
const byId = new Map(library.connector_types.map((type) => [type.id, type]));
assert.deepEqual(byId.get('deutsch_dt')?.cavity_variants?.map((variant) => variant.pin_count), [2, 3, 4, 6, 8, 12]);
assert.deepEqual(byId.get('deutsch_dtm')?.cavity_variants?.map((variant) => variant.pin_count), [2, 3, 4, 6, 8, 12]);
assert.deepEqual(
  byId.get('molex_minifit_jr')?.cavity_variants?.map((variant) => variant.pin_count),
  [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24],
);
assert.deepEqual(
  library.connector_types.map((type) => type.id).sort(),
  ['deutsch_dt', 'deutsch_dtm', 'generic_multipin', 'molex_minifit_jr'],
);
assert.equal(new Set(library.connector_types.map((type) => type.id)).size, library.connector_types.length);
assert.equal(validateConnectorLibraryData(library).valid, true);
const duplicateLibrary = structuredClone(library);
duplicateLibrary.connector_types.push(structuredClone(duplicateLibrary.connector_types[0]));
assert.equal(validateConnectorLibraryData(duplicateLibrary).valid, false);

console.log('Connector family tests passed.');
