/**
 * Append-only JSONL collaboration edit log and activity aggregation.
 *
 * Each successful write is appended with one synchronous filesystem call and a
 * trailing newline. Aggregation treats every valid line as one saved change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getCollaborationPaths, type RevisionWriter } from './revisions.js';

export type EditKind =
  | 'harness'
  | 'layouts'
  | 'manufacturing'
  | 'subsystem'
  | 'library'
  | 'restore';

export interface EditLogEntry {
  ts: string;
  user: string;
  displayName: string;
  harness: string;
  kind: EditKind;
  rev: number;
  added: number;
  modified: number;
  removed: number;
  entityIds: string[];
}

export type NewEditLogEntry = Omit<EditLogEntry, 'ts' | 'harness'> & {
  ts?: string;
};

export type ActivitySummary = Record<string, Record<string, number>>;

function assertHarness(harness: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(harness)) {
    throw new Error(`Invalid edit-log harness key '${harness}'.`);
  }
  return harness;
}

function editLogFile(harness: string): string {
  return path.join(
    getCollaborationPaths().stateRoot,
    'edit-log',
    `${assertHarness(harness)}.jsonl`,
  );
}

function validateEntry(value: unknown, context: string): EditLogEntry {
  if (!value || typeof value !== 'object') {
    throw new Error(`${context}: expected an object.`);
  }
  const entry = value as Partial<EditLogEntry>;
  const timestamp = typeof entry.ts === 'string' ? Date.parse(entry.ts) : Number.NaN;
  const kinds = new Set<EditKind>([
    'harness',
    'layouts',
    'manufacturing',
    'subsystem',
    'library',
    'restore',
  ]);
  if (
    !Number.isFinite(timestamp)
    || typeof entry.user !== 'string'
    || !entry.user
    || typeof entry.displayName !== 'string'
    || !entry.displayName
    || typeof entry.harness !== 'string'
    || !entry.harness
    || !entry.kind
    || !kinds.has(entry.kind)
    || !Number.isSafeInteger(entry.rev)
    || (entry.rev ?? -1) < 0
    || !Number.isSafeInteger(entry.added)
    || (entry.added ?? -1) < 0
    || !Number.isSafeInteger(entry.modified)
    || (entry.modified ?? -1) < 0
    || !Number.isSafeInteger(entry.removed)
    || (entry.removed ?? -1) < 0
    || !Array.isArray(entry.entityIds)
    || entry.entityIds.some((id) => typeof id !== 'string' || !id)
  ) {
    throw new Error(`${context}: invalid edit-log entry.`);
  }
  return entry as EditLogEntry;
}

export function appendEditLog(
  harness: string,
  input: NewEditLogEntry,
): EditLogEntry {
  const entry = validateEntry(
    {
      ...input,
      ts: input.ts ?? new Date().toISOString(),
      harness: assertHarness(harness),
    },
    `Cannot append edit log for '${harness}'`,
  );
  const filePath = editLogFile(harness);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  return { ...entry, entityIds: [...entry.entityIds] };
}

export function aggregateActivity(harness: string, days: number): ActivitySummary {
  if (!Number.isSafeInteger(days) || days <= 0) {
    throw new Error(`Activity window must be a positive integer, received '${days}'.`);
  }
  const filePath = editLogFile(harness);
  if (!fs.existsSync(filePath)) return {};

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `Cannot read edit log for '${harness}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const now = new Date();
  const start = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - (days - 1),
  );
  const counts = new Map<string, Map<string, number>>();
  const lines = raw.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index]) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[index]);
    } catch (error) {
      throw new Error(
        `Cannot parse edit log '${filePath}' at line ${index + 1}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const entry = validateEntry(parsed, `Invalid edit log '${filePath}' at line ${index + 1}`);
    if (entry.harness !== harness) {
      throw new Error(
        `Invalid edit log '${filePath}' at line ${index + 1}: harness is '${entry.harness}'.`,
      );
    }
    const timestamp = new Date(entry.ts);
    if (timestamp.getTime() < start) continue;
    const date = timestamp.toISOString().slice(0, 10);
    const byUser = counts.get(date) ?? new Map<string, number>();
    byUser.set(entry.displayName, (byUser.get(entry.displayName) ?? 0) + 1);
    counts.set(date, byUser);
  }

  return Object.fromEntries(
    [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, byUser]) => [
        date,
        Object.fromEntries(
          [...byUser.entries()].sort(([left], [right]) => left.localeCompare(right)),
        ),
      ]),
  );
}

/**
 * Everyone who successfully wrote to this harness after `sinceIso` (exclusive),
 * in first-seen order. `sinceIso === null` means "since the beginning of the
 * log" — used when no prior daily checkpoint exists yet. Backs the daily
 * checkpoint's contributor list.
 */
export function listContributorsSince(
  harness: string,
  sinceIso: string | null,
): RevisionWriter[] {
  const filePath = editLogFile(harness);
  if (!fs.existsSync(filePath)) return [];

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `Cannot read edit log for '${harness}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const sinceMs = sinceIso !== null ? Date.parse(sinceIso) : Number.NEGATIVE_INFINITY;
  const contributors = new Map<string, RevisionWriter>();
  const lines = raw.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index]) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[index]);
    } catch (error) {
      throw new Error(
        `Cannot parse edit log '${filePath}' at line ${index + 1}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const entry = validateEntry(parsed, `Invalid edit log '${filePath}' at line ${index + 1}`);
    if (entry.harness !== harness) {
      throw new Error(
        `Invalid edit log '${filePath}' at line ${index + 1}: harness is '${entry.harness}'.`,
      );
    }
    if (Date.parse(entry.ts) <= sinceMs) continue;
    contributors.set(entry.user, { id: entry.user, displayName: entry.displayName });
  }

  return [...contributors.values()];
}
