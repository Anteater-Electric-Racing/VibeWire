import fs from 'node:fs';
import path from 'node:path';
import {
  isSheetedSystem,
  readSheetedSystem,
  sheetSystemDir,
  writeSheetedSystem,
} from '../server/sheets.js';

const projectRoot = process.cwd();
const requested = process.argv.slice(2);
const harnessesRoot = path.join(projectRoot, 'public', 'user-data', 'harnesses');
const names = requested.length > 0
  ? requested
  : fs.readdirSync(harnessesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isSheetedSystem(projectRoot, entry.name))
      .map((entry) => entry.name);

for (const name of names) {
  if (!isSheetedSystem(projectRoot, name)) {
    console.warn(`[signals] Skipping '${name}': not a sheeted System`);
    continue;
  }
  const dir = sheetSystemDir(projectRoot, name);
  const system = readSheetedSystem(dir);
  const signalIds = new Set(system.signals.map((signal) => signal.id));
  let migrated = 0;
  for (const wirePath of system.paths) {
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
  writeSheetedSystem(dir, system);
  console.log(`[signals] ${name}: migrated ${migrated} paths (legacy tags retained)`);
}
