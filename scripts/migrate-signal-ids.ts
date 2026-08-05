import fs from 'node:fs';
import path from 'node:path';
import {
  isSheetedHarness,
  readSheetedHarness,
  sheetHarnessDir,
  writeSheetedHarness,
} from '../server/sheets.js';

const projectRoot = process.cwd();
const requested = process.argv.slice(2);
const harnessesRoot = path.join(projectRoot, 'public', 'user-data', 'harnesses');
const names = requested.length > 0
  ? requested
  : fs.readdirSync(harnessesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isSheetedHarness(projectRoot, entry.name))
      .map((entry) => entry.name);

for (const name of names) {
  if (!isSheetedHarness(projectRoot, name)) {
    console.warn(`[signals] Skipping '${name}': not a sheeted harness`);
    continue;
  }
  const dir = sheetHarnessDir(projectRoot, name);
  const harness = readSheetedHarness(dir);
  const signalIds = new Set(harness.signals.map((signal) => signal.id));
  let migrated = 0;
  for (const wirePath of harness.paths) {
    if (wirePath.signal_id) continue;
    const slug = wirePath.tags.find((tag) => tag.startsWith('signal:'))?.slice(7);
    if (!slug) continue;
    const signalId = `sig_${slug}`;
    if (!signalIds.has(signalId)) {
      console.warn(`[signals] ${name}/${wirePath.id}: no signal '${signalId}', kept legacy tag only`);
      continue;
    }
    wirePath.signal_id = signalId;
    migrated++;
  }
  if (migrated === 0) {
    console.log(`[signals] ${name}: no paths needed migration`);
    continue;
  }
  writeSheetedHarness(dir, harness);
  console.log(`[signals] ${name}: migrated ${migrated} paths (legacy tags retained)`);
}
