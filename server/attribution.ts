/**
 * Persistent per-entity last-writer attribution.
 *
 * Updates consume the same entity diff used by history/edit logging. Removed
 * ids are pruned, while added and modified ids receive the supplied writer.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { EntityDiff } from './systemDiff.js';
import {
  getCollaborationPaths,
  withSystemLock,
  type RevisionWriter,
} from './revisions.js';

export interface AttributionEntry {
  by: RevisionWriter;
  at: string;
  rev: number;
}

export type AttributionMap = Record<string, AttributionEntry>;

function assertSystemKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid attribution system key '${String(value)}'.`);
  }
  return value;
}

function attributionFile(systemKey: string): string {
  return path.join(
    getCollaborationPaths().stateRoot,
    'attribution',
    `${assertSystemKey(systemKey)}.json`,
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

function readAttribution(systemKey: string): AttributionMap {
  const filePath = attributionFile(systemKey);
  if (!fs.existsSync(filePath)) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Cannot parse attribution for '${systemKey}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Cannot read attribution for '${systemKey}': expected an object map.`);
  }
  for (const [entityId, value] of Object.entries(parsed)) {
    if (!entityId || !isAttributionEntry(value)) {
      throw new Error(
        `Cannot read attribution for '${systemKey}': invalid entry for '${entityId}'.`,
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

export function getAttribution(systemKey: string): AttributionMap {
  return cloneAttribution(readAttribution(systemKey));
}

export async function applyDiffToAttribution(
  systemKey: string,
  diff: Readonly<EntityDiff>,
  user: RevisionWriter,
  rev: number,
): Promise<AttributionMap> {
  if (!user.id || !user.displayName) {
    throw new Error(`Cannot update attribution for '${systemKey}': invalid user identity.`);
  }
  if (!Number.isSafeInteger(rev) || rev < 0) {
    throw new Error(`Cannot update attribution for '${systemKey}': invalid revision '${rev}'.`);
  }

  return await withSystemLock(systemKey, () => {
    const attribution = readAttribution(systemKey);
    for (const entityId of diff.removed) delete attribution[entityId];

    const at = new Date().toISOString();
    for (const entityId of new Set([...diff.added, ...diff.modified])) {
      if (!entityId) {
        throw new Error(`Cannot update attribution for '${systemKey}': diff contains an empty id.`);
      }
      attribution[entityId] = {
        by: { id: user.id, displayName: user.displayName },
        at,
        rev,
      };
    }

    writeJsonAtomic(attributionFile(systemKey), attribution);
    return cloneAttribution(attribution);
  });
}

export function whoTouched(systemKey: string, entityIds: readonly string[]): RevisionWriter[] {
  const attribution = readAttribution(systemKey);
  const users = new Map<string, RevisionWriter>();
  for (const entityId of entityIds) {
    const user = attribution[entityId]?.by;
    if (user && !users.has(user.id)) users.set(user.id, { ...user });
  }
  return [...users.values()];
}
