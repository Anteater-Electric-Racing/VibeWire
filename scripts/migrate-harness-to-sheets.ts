#!/usr/bin/env -S npx tsx
/**
 * One-off migration: convert a flat `public/user-data/harnesses/<name>.json`
 * into the hierarchical per-sheet format described in `server/sheets.ts`.
 *
 * Usage:
 *   npx tsx scripts/migrate-harness-to-sheets.ts fsae-2026 enc_001,enc_002,enc_003,enc_004
 *
 * The second argument lists the enclosure ids that should become their own
 * top-level sheet file (`sheets/<id>.json`); everything else stays inlined in
 * whichever sheet owns it. This never needs to change after the initial
 * migration -- deeper splits can be introduced later just by creating a new
 * `sheets/<id>.json` file and re-running `writeSheetedHarness` once.
 *
 * Refuses to touch disk if the split does not round-trip cleanly back to the
 * original flat harness.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  flatHarnessFile,
  sheetHarnessDir,
  splitHarness,
  verifyRoundTrip,
  writeSheetsToDisk,
  type HarnessData,
} from '../server/sheets.js';

const projectRoot = path.resolve(import.meta.dirname, '..');

function main() {
  const [name, sheetIdsArg] = process.argv.slice(2);
  if (!name || !sheetIdsArg) {
    console.error('Usage: npx tsx scripts/migrate-harness-to-sheets.ts <harness-name> <comma,separated,enclosure,ids>');
    process.exit(1);
  }
  const sheetEnclosureIds = new Set(sheetIdsArg.split(',').map((s) => s.trim()).filter(Boolean));

  const flatFile = flatHarnessFile(projectRoot, name);
  const harness: HarnessData = JSON.parse(fs.readFileSync(flatFile, 'utf-8'));

  console.log(`Splitting '${name}' (${harness.enclosures.length} enclosures, ${harness.connectors.length} connectors, ${harness.paths.length} paths) into sheets: ${[...sheetEnclosureIds].join(', ')}`);

  const split = splitHarness(harness, sheetEnclosureIds);
  const problems = verifyRoundTrip(harness, split, sheetEnclosureIds);
  if (problems.length > 0) {
    console.error(`\nRound-trip check FAILED -- refusing to write anything.\n`);
    for (const p of problems) console.error(' -', p);
    process.exit(1);
  }
  console.log('Round-trip check passed.');

  const harnessDir = sheetHarnessDir(projectRoot, name);
  writeSheetsToDisk(harnessDir, split);

  console.log(`\nWrote sheeted harness to ${path.relative(projectRoot, harnessDir)}/:`);
  for (const [scope, sheet] of split.sheets) {
    const file = scope === null ? 'root.json' : `sheets/${scope}.json`;
    console.log(`  ${file.padEnd(28)} enclosures=${sheet.enclosures.length} connectors=${sheet.connectors.length} mergePoints=${sheet.mergePoints.length} paths=${sheet.paths.length} ports=${sheet.ports.length}`);
  }
  console.log(`  signals.json                 signals=${split.signals.length}`);
  console.log(`\nOriginal flat file left in place at ${path.relative(projectRoot, flatFile)} -- delete it once you've verified the app loads correctly.`);
}

main();
