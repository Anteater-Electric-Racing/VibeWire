#!/usr/bin/env -S npx tsx
/**
 * One-off migration: convert a flat `public/user-data/systems/<key>.json`
 * into the hierarchical per-sheet format described in `server/sheets.ts`.
 *
 * Usage:
 *   npx tsx scripts/migrate-system-to-sheets.ts fsae-2026 enc_001,enc_002,enc_003,enc_004
 *
 * The second argument lists the enclosure ids that should become their own
 * top-level sheet file (`sheets/<id>.json`); everything else stays inlined in
 * whichever sheet owns it. This never needs to change after the initial
 * migration -- deeper splits can be introduced later just by creating a new
 * `sheets/<id>.json` file and re-running `writeSheetedSystem` once.
 *
 * Refuses to touch disk if the split does not round-trip cleanly back to the
 * original flat System.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  flatSystemFile,
  sheetSystemDir,
  splitSystem,
  verifyRoundTrip,
  writeSheetsToDisk,
  type SystemData,
} from '../server/sheets.js';

const projectRoot = path.resolve(import.meta.dirname, '..');

function main() {
  const [name, sheetIdsArg] = process.argv.slice(2);
  if (!name || !sheetIdsArg) {
    console.error('Usage: npx tsx scripts/migrate-system-to-sheets.ts <system-key> <comma,separated,enclosure,ids>');
    process.exit(1);
  }
  const sheetEnclosureIds = new Set(sheetIdsArg.split(',').map((s) => s.trim()).filter(Boolean));

  const flatFile = flatSystemFile(projectRoot, name);
  const system: SystemData = JSON.parse(fs.readFileSync(flatFile, 'utf-8'));

  console.log(`Splitting '${name}' (${system.hierarchy.length} hierarchy entities, ${system.connectors.length} connectors, ${system.paths.length} paths) into sheets: ${[...sheetEnclosureIds].join(', ')}`);

  const split = splitSystem(system, sheetEnclosureIds);
  const problems = verifyRoundTrip(system, split, sheetEnclosureIds);
  if (problems.length > 0) {
    console.error(`\nRound-trip check FAILED -- refusing to write anything.\n`);
    for (const p of problems) console.error(' -', p);
    process.exit(1);
  }
  console.log('Round-trip check passed.');

  const systemDir = sheetSystemDir(projectRoot, name);
  writeSheetsToDisk(systemDir, split);

  console.log(`\nWrote sheeted System to ${path.relative(projectRoot, systemDir)}/:`);
  for (const [scope, sheet] of split.sheets) {
    const file = scope === null ? 'root.json' : `sheets/${scope}.json`;
    console.log(`  ${file.padEnd(28)} hierarchy=${sheet.hierarchy.length} connectors=${sheet.connectors.length} branchPoints=${sheet.branchPoints.length} paths=${sheet.paths.length} ports=${sheet.ports.length}`);
  }
  console.log(`  signals.json                 signals=${split.signals.length}`);
  console.log(`\nOriginal flat file left in place at ${path.relative(projectRoot, flatFile)} -- delete it once you've verified the app loads correctly.`);
}

main();
