/**
 * Persistent per-entity last-writer attribution.
 *
 * Updates consume the same entity diff used by history/edit logging. Removed
 * ids are pruned, while added and modified ids receive the supplied writer.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { EntityDiff } from './harnessDiff.js';
import {
  getCollaborationPaths,
  withHarnessLock,
  type RevisionWriter,
} from './revisions.js';

export interface AttributionEntry {
  by: RevisionWriter;
  at: string;
  rev: number;
}

export type AttributionMap = Record<string, AttributionEntry>;

function assertHarness(harness: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(harness)) {
    throw new Error(`Invalid attribution harness key '${harness}'.`);
  }
  return harness;
}

function attributionFile(harness: string): string {
  return path.join(
    getCollaborationPaths().stateRoot,
    'attribution',
    `${assertHarness(harness)}.json`,
  );
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, filePath);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function isAttributionEntry(value: unknown): value is AttributionEntry {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const by = record.by as Record<string, unknown> | null;
  return (
    !!by
    && typeof by === 'object'
    && typeof by.id === 'string'
    && typeof by.displayName === 'string'
    && typeof record.at === 'string'
    && Number.isSafeInteger(record.rev)
    && (record.rev as number) >= 0
  );
}

function readAttribution(harness: string): AttributionMap {
  const filePath = attributionFile(harness);
  if (!fs.existsSync(filePath)) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Cannot parse attribution for '${harness}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Cannot read attribution for '${harness}': expected an object map.`);
  }
  for (const [entityId, value] of Object.entries(parsed)) {
    if (!entityId || !isAttributionEntry(value)) {
      throw new Error(
        `Cannot read attribution for '${harness}': invalid entry for '${entityId}'.`,
      );
    }
  }
  return parsed as AttributionMap;
}

function cloneAttribution(value: AttributionMap): AttributionMap {
  return Object.fromEntries(
    Object.entries(value).map(([entityId, entry]) => [
      entityId,
      { ...entry, by: { ...entry.by } },
    ]),
  );
}

export function getAttribution(harness: string): AttributionMap {
  return cloneAttribution(readAttribution(harness));
}

export async function applyDiffToAttribution(
  harness: string,
  diff: Readonly<EntityDiff>,
  user: RevisionWriter,
  rev: number,
): Promise<AttributionMap> {
  if (!user.id || !user.displayName) {
    throw new Error(`Cannot update attribution for '${harness}': invalid user identity.`);
  }
  if (!Number.isSafeInteger(rev) || rev < 0) {
    throw new Error(`Cannot update attribution for '${harness}': invalid revision '${rev}'.`);
  }

  return await withHarnessLock(harness, () => {
    const attribution = readAttribution(harness);
    for (const entityId of diff.removed) delete attribution[entityId];

    const at = new Date().toISOString();
    for (const entityId of new Set([...diff.added, ...diff.modified])) {
      if (!entityId) {
        throw new Error(`Cannot update attribution for '${harness}': diff contains an empty id.`);
      }
      attribution[entityId] = {
        by: { id: user.id, displayName: user.displayName },
        at,
        rev,
      };
    }

    writeJsonAtomic(attributionFile(harness), attribution);
    return cloneAttribution(attribution);
  });
}

export function whoTouched(harness: string, entityIds: readonly string[]): RevisionWriter[] {
  const attribution = readAttribution(harness);
  const users = new Map<string, RevisionWriter>();
  for (const entityId of entityIds) {
    const user = attribution[entityId]?.by;
    if (user && !users.has(user.id)) users.set(user.id, { ...user });
  }
  return [...users.values()];
}
