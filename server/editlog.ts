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
  | 'system'
  | 'layouts'
  | 'manufacturing'
  | 'subsystem'
  | 'library'
  | 'restore';

export interface EditLogEntry {
  ts: string;
  user: string;
  displayName: string;
  system: string;
  kind: EditKind;
  rev: number;
  added: number;
  modified: number;
  removed: number;
  entityIds: string[];
}

export type NewEditLogEntry = Omit<EditLogEntry, 'ts' | 'system'> & {
  ts?: string;
};

export type ActivitySummary = Record<string, Record<string, number>>;

function assertSystemKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid edit-log system key '${String(value)}'.`);
  }
  return value;
}

function editLogFile(systemKey: string): string {
  return path.join(
    getCollaborationPaths().stateRoot,
    'edit-log',
    `${assertSystemKey(systemKey)}.jsonl`,
  );
}

function validateEntry(value: unknown, context: string): EditLogEntry {
  if (!value || typeof value !== 'object') {
    throw new Error(`${context}: expected an object.`);
  }
  const raw = value as Record<string, unknown>;
  const systemName = typeof raw.system === 'string' ? raw.system
    : typeof raw.harness === 'string' ? raw.harness
    : '';
  const kind = raw.kind === 'harness' ? 'system' : raw.kind;
  const timestamp = typeof raw.ts === 'string' ? Date.parse(raw.ts) : Number.NaN;
  const kinds = new Set<EditKind>([
    'system',
    'layouts',
    'manufacturing',
    'subsystem',
    'library',
    'restore',
  ]);
  if (
    !Number.isFinite(timestamp)
    || typeof raw.user !== 'string'
    || !raw.user
    || typeof raw.displayName !== 'string'
    || !raw.displayName
    || !systemName
    || !kind
    || !kinds.has(kind as EditKind)
    || !Number.isSafeInteger(raw.rev)
    || (raw.rev as number) < 0
    || !Number.isSafeInteger(raw.added)
    || (raw.added as number) < 0
    || !Number.isSafeInteger(raw.modified)
    || (raw.modified as number) < 0
    || !Number.isSafeInteger(raw.removed)
    || (raw.removed as number) < 0
    || !Array.isArray(raw.entityIds)
    || raw.entityIds.some((id) => typeof id !== 'string' || !id)
  ) {
    throw new Error(`${context}: invalid edit-log entry.`);
  }
  return {
    ts: raw.ts as string,
    user: raw.user,
    displayName: raw.displayName,
    system: systemName,
    kind: kind as EditKind,
    rev: raw.rev as number,
    added: raw.added as number,
    modified: raw.modified as number,
    removed: raw.removed as number,
    entityIds: raw.entityIds as string[],
  };
}

export function appendEditLog(
  systemKey: string,
  input: NewEditLogEntry,
): EditLogEntry {
  const entry = validateEntry(
    {
      ...input,
      ts: input.ts ?? new Date().toISOString(),
      system: assertSystemKey(systemKey),
    },
    `Cannot append edit log for '${systemKey}'`,
  );
  const filePath = editLogFile(systemKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  return { ...entry, entityIds: [...entry.entityIds] };
}

export function aggregateActivity(systemKey: string, days: number): ActivitySummary {
  if (!Number.isSafeInteger(days) || days <= 0) {
    throw new Error(`Activity window must be a positive integer, received '${days}'.`);
  }
  const filePath = editLogFile(systemKey);
  if (!fs.existsSync(filePath)) return {};

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `Cannot read edit log for '${systemKey}': ${
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
    if (entry.system !== systemKey) {
      throw new Error(
        `Invalid edit log '${filePath}' at line ${index + 1}: system is '${entry.system}'.`,
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
 * Everyone who successfully wrote to this System after `sinceIso` (exclusive),
 * in first-seen order. `sinceIso === null` means "since the beginning of the
 * log" — used when no prior daily checkpoint exists yet. Backs the daily
 * checkpoint's contributor list.
 */
export function listContributorsSince(
  systemKey: string,
  sinceIso: string | null,
): RevisionWriter[] {
  const filePath = editLogFile(systemKey);
  if (!fs.existsSync(filePath)) return [];

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `Cannot read edit log for '${systemKey}': ${
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
    if (entry.system !== systemKey) {
      throw new Error(
        `Invalid edit log '${filePath}' at line ${index + 1}: system is '${entry.system}'.`,
      );
    }
    if (Date.parse(entry.ts) <= sinceMs) continue;
    contributors.set(entry.user, { id: entry.user, displayName: entry.displayName });
  }

  return [...contributors.values()];
}
