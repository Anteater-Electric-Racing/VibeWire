#!/usr/bin/env -S npx tsx
/**
 * Consolidate legacy per-size DT and Mini-Fit Jr. type ids into family ids.
 *
 * The migration is intentionally idempotent. It updates the shared connector
 * library, every JSON connector/port under public/user-data/harnesses, and
 * legacy connector-type layout keys.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ConnectorType } from '../src/types';

const projectRoot = path.resolve(import.meta.dirname, '..');
const userDataDir = path.join(projectRoot, 'public', 'user-data');
const libraryFile = path.join(userDataDir, 'connectors', 'connector-library.json');

const FAMILY_TYPES: ConnectorType[] = [
  {
    id: 'deutsch_dt',
    name: 'Deutsch DT',
    pin_count: 0,
    crimp_spec: 'DT-0460-20141 / DT-0430-20141',
    wire_gauge: '20-16 AWG',
    notes: 'Sealed size-16 contact mating-pair family. Select the physical housing by cavity count.',
    cavity_variants: [
      { pin_count: 2 },
      { pin_count: 3 },
      { pin_count: 4 },
      { pin_count: 6 },
      { pin_count: 8, keyings: ['A', 'B', 'C', 'D'] },
      {
        pin_count: 12,
        keyings: ['A', 'B', 'C', 'D'],
        image: 'deutsch-12p-m.png',
        side_image: 'deutsch-12p-side.png',
      },
    ],
  },
  {
    id: 'deutsch_dtm',
    name: 'Deutsch DTM',
    pin_count: 0,
    crimp_spec: '1060-20-0122 / 1062-20-0122',
    wire_gauge: '22-16 AWG',
    notes: 'Sealed size-20 contact mating-pair family. Select the physical housing by cavity count.',
    cavity_variants: [
      { pin_count: 2 },
      { pin_count: 3 },
      { pin_count: 4 },
      { pin_count: 6 },
      { pin_count: 8, keyings: ['A', 'B', 'C', 'D'] },
      { pin_count: 12, keyings: ['A', 'B', 'C', 'D'] },
    ],
  },
  {
    id: 'molex_minifit_jr',
    name: 'Molex Mini-Fit Jr. (dual-row)',
    pin_count: 0,
    crimp_spec: '39-00-0039 / 39-00-0041',
    wire_gauge: '24-18 AWG',
    notes: '4.20 mm pitch dual-row mating-pair family. Select the physical housing by cavity count.',
    cavity_variants: [
      { pin_count: 2 },
      { pin_count: 4 },
      { pin_count: 6 },
      { pin_count: 8 },
      { pin_count: 10 },
      { pin_count: 12 },
      { pin_count: 14 },
      { pin_count: 16 },
      { pin_count: 18 },
      { pin_count: 20 },
      { pin_count: 22 },
      { pin_count: 24 },
    ],
  },
];

type FamilyResolution = {
  typeId: string;
  pinCount: number;
  keying?: string;
};

function legacyFamilyResolution(typeId: string): FamilyResolution | null {
  const deutsch = /^deutsch_dt(?:15)?_(\d+)p(?:_|$)/.exec(typeId);
  if (deutsch) {
    const pinCount = Number(deutsch[1]);
    const explicitlyAKeyed =
      typeId === 'deutsch_dt_8p_female'
      || typeId === 'deutsch_dt_12p_flanged_male';
    return {
      typeId: 'deutsch_dt',
      pinCount,
      ...(explicitlyAKeyed ? { keying: 'A' } : {}),
    };
  }

  if (typeId === 'deutsch_dt_4p') {
    return { typeId: 'deutsch_dt', pinCount: 4 };
  }

  const generic = /^generic_(\d+)p$/.exec(typeId);
  if (generic) {
    return { typeId: 'generic_multipin', pinCount: Number(generic[1]) };
  }

  const terminalBlock = /^terminal_block_(\d+)p$/.exec(typeId);
  if (terminalBlock) {
    return { typeId: 'generic_multipin', pinCount: Number(terminalBlock[1]) };
  }

  if (typeId.startsWith('molex_minifit_sigma_')) return null;
  const miniFit = /^molex_minifit(?:_jr)?_(\d+)p$/.exec(typeId)
    ?? /^molex_minifit_(?:5566|vertical)_(\d+)p$/.exec(typeId);
  if (miniFit) {
    const pinCount = Number(miniFit[1]);
    // The family intentionally models the common dual-row series.
    if (pinCount % 2 === 0 && pinCount >= 2 && pinCount <= 24) {
      return { typeId: 'molex_minifit_jr', pinCount };
    }
  }

  return null;
}

function migrateConnectorLike(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  let changes = 0;
  const record = value as Record<string, unknown>;
  const connectorType = record.connector_type;
  if (typeof connectorType === 'string') {
    const resolution = legacyFamilyResolution(connectorType);
    if (resolution) {
      record.connector_type = resolution.typeId;
      const currentPinCount = typeof record.pin_count === 'number' ? record.pin_count : 0;
      record.pin_count = Math.max(currentPinCount, resolution.pinCount);
      if (!record.keying && resolution.keying) record.keying = resolution.keying;
      changes += 1;
    }
  }
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const item of child) changes += migrateConnectorLike(item);
    } else if (child && typeof child === 'object') {
      changes += migrateConnectorLike(child);
    }
  }
  return changes;
}

function jsonFilesUnder(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...jsonFilesUnder(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(fullPath);
  }
  return files;
}

function writeJsonIfChanged(file: string, data: unknown, changed: boolean): boolean {
  if (!changed) return false;
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return true;
}

function migrateLibrary(): void {
  const library = JSON.parse(fs.readFileSync(libraryFile, 'utf8')) as {
    schema_version?: string;
    connector_types?: ConnectorType[];
  };
  const oldTypes = library.connector_types ?? [];
  const familyIds = new Set(FAMILY_TYPES.map((type) => type.id));
  const retained = oldTypes.filter((type) =>
    !familyIds.has(type.id) && legacyFamilyResolution(type.id) == null,
  );
  const generic2p = retained.find((type) => type.id === 'generic_2p');
  if (generic2p?.name === '24 pin') generic2p.name = 'Generic 2-pin';
  const miniFit5p = retained.find((type) => type.id === 'molex_minifit_jr_5p');
  if (miniFit5p) {
    miniFit5p.name = 'Molex Mini-Fit Jr. Single-row 5-pin';
    miniFit5p.notes = 'Single-row, 4.2mm pitch, 5-circuit special variant';
  }
  library.schema_version = '1.0.0';
  library.connector_types = [...FAMILY_TYPES, ...retained];
  fs.writeFileSync(libraryFile, `${JSON.stringify(library, null, 2)}\n`);
}

function migrateHarnesses(): { files: number; connectors: number } {
  let files = 0;
  let connectors = 0;
  for (const file of jsonFilesUnder(path.join(userDataDir, 'harnesses'))) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    const changes = migrateConnectorLike(data);
    if (writeJsonIfChanged(file, data, changes > 0)) files += 1;
    connectors += changes;
  }
  return { files, connectors };
}

function migrateLayouts(): number {
  let files = 0;
  for (const file of jsonFilesUnder(userDataDir).filter((candidate) =>
    path.basename(candidate).startsWith('layouts'),
  )) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      connectorTypeSizes?: Record<string, { w: number; h: number }>;
    };
    const sizes = data.connectorTypeSizes;
    if (!sizes) continue;
    let changed = false;
    for (const [legacyId, size] of Object.entries({ ...sizes })) {
      const resolution = legacyFamilyResolution(legacyId);
      if (!resolution) continue;
      sizes[resolution.typeId] ??= size;
      delete sizes[legacyId];
      changed = true;
    }
    if (writeJsonIfChanged(file, data, changed)) files += 1;
  }
  return files;
}

migrateLibrary();
const harnessResult = migrateHarnesses();
const layoutFiles = migrateLayouts();
console.log(
  `Connector-family migration complete: ${harnessResult.connectors} connector references `
  + `across ${harnessResult.files} harness files; ${layoutFiles} layout files updated.`,
);
