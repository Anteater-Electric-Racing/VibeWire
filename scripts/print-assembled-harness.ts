#!/usr/bin/env -S npx tsx
/**
 * Prints the fully assembled HarnessData for a sheeted harness as JSON on
 * stdout. Used by scripts/validate_harness.py so the Python validator can
 * work against sheeted harnesses without reimplementing the assembler.
 *
 * Usage: npx tsx scripts/print-assembled-harness.ts <harness-name>
 */
import path from 'node:path';
import { assembleHarnessFromDisk, sheetHarnessDir } from '../server/sheets.js';

const [name] = process.argv.slice(2);
if (!name) {
  console.error('Usage: npx tsx scripts/print-assembled-harness.ts <harness-name>');
  process.exit(1);
}

const projectRoot = path.resolve(import.meta.dirname, '..');
const assembled = assembleHarnessFromDisk(sheetHarnessDir(projectRoot, name));
process.stdout.write(JSON.stringify(assembled));
