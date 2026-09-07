#!/usr/bin/env -S npx tsx
/**
 * Prints the fully assembled SystemData for a sheeted System as JSON on
 * stdout. Used by scripts/validate_system.py so the Python validator can
 * work against sheeted Systems without reimplementing the assembler.
 *
 * Usage: npx tsx scripts/print-assembled-system.ts <system-key>
 */
import path from 'node:path';
import { assembleSystemFromDisk, sheetSystemDir } from '../server/sheets.js';

const [name] = process.argv.slice(2);
if (!name) {
  console.error('Usage: npx tsx scripts/print-assembled-system.ts <system-key>');
  process.exit(1);
}

const projectRoot = path.resolve(import.meta.dirname, '..');
const assembled = assembleSystemFromDisk(sheetSystemDir(projectRoot, name));
process.stdout.write(JSON.stringify(assembled));
