/**
 * Byte-exact automatic history, named checkpoints, and reversible restore.
 *
 * Payloads mirror paths relative to `public/user-data` and every file copy uses
 * `copyFileSync`—parsed System data is used only for entity counts, never for
 * persistence. Restore stages replacements before rename-based swaps.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  assembleSystemFromDisk,
  type SystemData,
} from './sheets.js';
import { normalizeSystemData } from '../src/lib/systemNormalize.js';
import { listContributorsSince } from './editlog.js';
import {
  getCollaborationPaths,
  getRev,
  withSystemLock,
  type RevisionWriter,
} from './revisions.js';

export interface EntityCounts {
  hierarchy: number;
  connectors: number;
  branchPoints: number;
  paths: number;
  signals: number;
}

export interface CheckpointMeta {
  id: string;
  label: string;
  createdAt: string;
  createdBy: RevisionWriter;
  rev: number;
  auto: boolean;
  counts: EntityCounts;
  /**
   * UTC date (`YYYY-MM-DD`) this checkpoint covers. Present only on the
   * automatic once-per-day save `ensureDailyCheckpoint` creates.
   */
  dailyKey?: string;
  /**
   * Everyone who wrote to this System since the previous daily checkpoint
   * (or, for the first one, since the edit log began). Present only on daily
   * checkpoints — this is the "who edited since last daily save" record.
   */
  contributors?: RevisionWriter[];
}

export interface CheckpointDetails extends CheckpointMeta {
  countDiff: EntityCounts;
}

export interface PruneResult {
  kept: number[];
  removed: number[];
}

interface PayloadArtifact {
  relativePath: string;
  kind: 'file' | 'directory';
}

function assertStorageKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label} '${String(value)}'.`);
  }
  return value;
}

function assertCheckpointId(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid checkpoint id '${id}'.`);
  }
  return id;
}

function historySystemDir(systemKey: string): string {
  return path.join(
    getCollaborationPaths().stateRoot,
    'history',
    assertStorageKey(systemKey, 'history system key'),
  );
}

function checkpointsSystemDir(systemKey: string): string {
  return path.join(
    getCollaborationPaths().stateRoot,
    'checkpoints',
    assertStorageKey(systemKey, 'checkpoint system key'),
  );
}

function checkpointDir(systemKey: string, id: string): string {
  return path.join(checkpointsSystemDir(systemKey), assertCheckpointId(id));
}

function payloadArtifacts(systemKey: string): PayloadArtifact[] {
  const key = assertStorageKey(systemKey, 'system key');
  return [
    { relativePath: path.join('systems', key), kind: 'directory' },
    { relativePath: path.join('systems', `${key}.json`), kind: 'file' },
    { relativePath: path.join('harnesses', key), kind: 'directory' },
    { relativePath: path.join('harnesses', `${key}.json`), kind: 'file' },
    { relativePath: `layouts.${key}.json`, kind: 'file' },
    { relativePath: `manufacturing.${key}.json`, kind: 'file' },
    { relativePath: path.join('subsystems', key), kind: 'directory' },
  ];
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

function removePath(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const stat = fs.lstatSync(filePath);
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    fs.rmSync(filePath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(filePath);
  }
}

function copyPathExact(source: string, destination: string): void {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to snapshot symbolic link '${source}'.`);
  }
  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    return;
  }
  if (!stat.isDirectory()) {
    throw new Error(`Refusing to snapshot unsupported filesystem entry '${source}'.`);
  }

  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    copyPathExact(path.join(source, entry.name), path.join(destination, entry.name));
  }
}

function pathsAreByteEqual(left: string, right: string): boolean {
  if (!fs.existsSync(left) || !fs.existsSync(right)) return false;
  const leftStat = fs.lstatSync(left);
  const rightStat = fs.lstatSync(right);
  if (leftStat.isSymbolicLink() || rightStat.isSymbolicLink()) return false;
  if (leftStat.isFile() || rightStat.isFile()) {
    return (
      leftStat.isFile()
      && rightStat.isFile()
      && fs.readFileSync(left).equals(fs.readFileSync(right))
    );
  }
  if (!leftStat.isDirectory() || !rightStat.isDirectory()) return false;
  const leftEntries = fs.readdirSync(left).sort();
  const rightEntries = fs.readdirSync(right).sort();
  return (
    leftEntries.length === rightEntries.length
    && leftEntries.every(
      (entry, index) =>
        entry === rightEntries[index]
        && pathsAreByteEqual(path.join(left, entry), path.join(right, entry)),
    )
  );
}

function systemDocumentExists(root: string, systemKey: string): boolean {
  return (
    fs.existsSync(path.join(root, 'systems', systemKey, 'root.json'))
    || fs.existsSync(path.join(root, 'systems', `${systemKey}.json`))
    || fs.existsSync(path.join(root, 'harnesses', systemKey, 'root.json'))
    || fs.existsSync(path.join(root, 'harnesses', `${systemKey}.json`))
  );
}

function copyCurrentPayload(systemKey: string, destinationRoot: string): void {
  const { userDataRoot } = getCollaborationPaths();
  if (!systemDocumentExists(userDataRoot, systemKey)) {
    throw new Error(
      `Cannot snapshot '${systemKey}': neither a sheeted root nor a flat system file exists.`,
    );
  }

  for (const artifact of payloadArtifacts(systemKey)) {
    const source = path.join(userDataRoot, artifact.relativePath);
    if (!fs.existsSync(source)) continue;
    if (
      (artifact.relativePath === path.join('systems', systemKey)
        || artifact.relativePath === path.join('harnesses', systemKey))
      && !fs.existsSync(path.join(source, 'root.json'))
    ) {
      continue;
    }
    copyPathExact(source, path.join(destinationRoot, artifact.relativePath));
  }
}

function readSystemFromPayload(payloadRoot: string, systemKey: string): SystemData {
  const canonicalDir = path.join(payloadRoot, 'systems', systemKey);
  const canonicalFlat = path.join(payloadRoot, 'systems', `${systemKey}.json`);
  const legacyDir = path.join(payloadRoot, 'harnesses', systemKey);
  const legacyFlat = path.join(payloadRoot, 'harnesses', `${systemKey}.json`);
  if (fs.existsSync(path.join(canonicalDir, 'root.json'))) {
    return assembleSystemFromDisk(canonicalDir);
  }
  if (fs.existsSync(path.join(legacyDir, 'root.json'))) {
    return assembleSystemFromDisk(legacyDir);
  }
  const flatFile = fs.existsSync(canonicalFlat) ? canonicalFlat : legacyFlat;
  if (!fs.existsSync(flatFile)) {
    throw new Error(`Cannot count '${systemKey}': checkpoint has no system document.`);
  }
  try {
    return normalizeSystemData(JSON.parse(fs.readFileSync(flatFile, 'utf8')));
  } catch (error) {
    throw new Error(
      `Cannot parse flat system '${flatFile}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function entityCounts(system: SystemData, context: string): EntityCounts {
  for (const collection of [
    'hierarchy',
    'connectors',
    'branchPoints',
    'paths',
    'signals',
  ] as const) {
    if (!Array.isArray(system[collection])) {
      throw new Error(`Cannot count ${context}: '${collection}' is not an array.`);
    }
  }
  return {
    hierarchy: system.hierarchy.length,
    connectors: system.connectors.length,
    branchPoints: system.branchPoints.length,
    paths: system.paths.length,
    signals: system.signals.length,
  };
}

function currentCounts(systemKey: string): EntityCounts {
  return entityCounts(
    readSystemFromPayload(getCollaborationPaths().userDataRoot, systemKey),
    `current System '${systemKey}'`,
  );
}

function parseCheckpointMeta(filePath: string): CheckpointMeta {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Cannot parse checkpoint metadata '${filePath}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid checkpoint metadata '${filePath}': expected an object.`);
  }
  const meta = value as Partial<CheckpointMeta>;
  const rawCounts = meta.counts as Record<string, unknown> | undefined;
  const hierarchyCount = Number(
    rawCounts?.hierarchy ?? rawCounts?.enclosures,
  );
  const branchPointCount = Number(
    rawCounts?.branchPoints ?? rawCounts?.mergePoints,
  );
  const counts: EntityCounts | undefined = rawCounts && Number.isSafeInteger(hierarchyCount)
    && Number.isSafeInteger(Number(rawCounts.connectors))
    && Number.isSafeInteger(branchPointCount)
    && Number.isSafeInteger(Number(rawCounts.paths))
    && Number.isSafeInteger(Number(rawCounts.signals))
    ? {
      hierarchy: hierarchyCount,
      connectors: Number(rawCounts.connectors),
      branchPoints: branchPointCount,
      paths: Number(rawCounts.paths),
      signals: Number(rawCounts.signals),
    }
    : undefined;
  if (
    typeof meta.id !== 'string'
    || !/^[a-zA-Z0-9_-]+$/.test(meta.id)
    || typeof meta.label !== 'string'
    || !meta.label
    || typeof meta.createdAt !== 'string'
    || !Number.isFinite(Date.parse(meta.createdAt))
    || !meta.createdBy
    || typeof meta.createdBy.id !== 'string'
    || !meta.createdBy.id
    || typeof meta.createdBy.displayName !== 'string'
    || !meta.createdBy.displayName
    || !Number.isSafeInteger(meta.rev)
    || (meta.rev ?? -1) < 0
    || typeof meta.auto !== 'boolean'
    || !counts
    || (meta.dailyKey !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(meta.dailyKey))
    || (meta.contributors !== undefined && !isRevisionWriterArray(meta.contributors))
  ) {
    throw new Error(`Invalid checkpoint metadata '${filePath}'.`);
  }
  return { ...meta, counts } as CheckpointMeta;
}

function isRevisionWriterArray(value: unknown): value is RevisionWriter[] {
  return (
    Array.isArray(value)
    && value.every((entry) =>
      !!entry
      && typeof entry === 'object'
      && typeof (entry as Partial<RevisionWriter>).id === 'string'
      && !!(entry as Partial<RevisionWriter>).id
      && typeof (entry as Partial<RevisionWriter>).displayName === 'string'
      && !!(entry as Partial<RevisionWriter>).displayName,
    )
  );
}

function readCheckpointMeta(systemKey: string, id: string): CheckpointMeta {
  const directory = checkpointDir(systemKey, id);
  const metaFile = path.join(directory, 'meta.json');
  if (!fs.existsSync(metaFile)) {
    throw new Error(`Checkpoint '${id}' for '${systemKey}' does not exist or has no metadata.`);
  }
  const meta = parseCheckpointMeta(metaFile);
  if (meta.id !== id) {
    throw new Error(
      `Checkpoint '${id}' for '${systemKey}' has mismatched metadata id '${meta.id}'.`,
    );
  }
  return meta;
}

function validateUser(user: RevisionWriter, context: string): RevisionWriter {
  if (!user.id || !user.displayName) {
    throw new Error(`${context}: invalid user identity.`);
  }
  return { id: user.id, displayName: user.displayName };
}

function checkpointCounts(systemKey: string, id: string): EntityCounts {
  const payloadRoot = path.join(checkpointDir(systemKey, id), 'files');
  return entityCounts(
    readSystemFromPayload(payloadRoot, systemKey),
    `checkpoint '${id}'`,
  );
}

interface DailyCheckpointContext {
  dailyKey: string;
  contributors: RevisionWriter[];
}

function createCheckpointLocked(
  systemKey: string,
  label: string,
  user: RevisionWriter,
  auto: boolean,
  daily?: DailyCheckpointContext,
): CheckpointMeta {
  const cleanLabel = label.trim();
  if (!cleanLabel) throw new Error(`Cannot checkpoint '${systemKey}': label is required.`);
  const cleanUser = validateUser(user, `Cannot checkpoint '${systemKey}'`);
  const id = randomUUID();
  const destination = checkpointDir(systemKey, id);
  const stage = `${destination}.${process.pid}.${Date.now()}.tmp`;
  if (fs.existsSync(destination)) {
    throw new Error(`Cannot checkpoint '${systemKey}': generated id '${id}' already exists.`);
  }

  const meta: CheckpointMeta = {
    id,
    label: cleanLabel,
    createdAt: new Date().toISOString(),
    createdBy: cleanUser,
    rev: getRev(systemKey),
    auto,
    counts: currentCounts(systemKey),
    ...(daily
      ? {
        dailyKey: daily.dailyKey,
        contributors: daily.contributors.map((contributor) => ({ ...contributor })),
      }
      : {}),
  };

  try {
    fs.mkdirSync(stage, { recursive: true });
    copyCurrentPayload(systemKey, path.join(stage, 'files'));
    writeJsonAtomic(path.join(stage, 'meta.json'), meta);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(stage, destination);
    return meta;
  } catch (error) {
    removePath(stage);
    throw new Error(
      `Cannot create checkpoint for '${systemKey}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function stageHistorySnapshot(systemKey: string, rev: number): string {
  if (!Number.isSafeInteger(rev) || rev < 0) {
    throw new Error(`Cannot snapshot '${systemKey}': invalid revision '${rev}'.`);
  }
  const destination = path.join(historySystemDir(systemKey), String(rev));
  const stage = `${destination}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(stage, { recursive: true });
    copyCurrentPayload(systemKey, stage);
    if (fs.existsSync(destination)) {
      if (!pathsAreByteEqual(stage, destination)) {
        throw new Error(
          `history already exists with different bytes; revision state may be inconsistent`,
        );
      }
      removePath(stage);
      return destination;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(stage, destination);
    return destination;
  } catch (error) {
    removePath(stage);
    throw new Error(
      `Cannot snapshot '${systemKey}' revision ${rev}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Replaces this System's `public/user-data` payload with the copy held in
 * `snapshotRoot`, which may be either an automatic history snapshot or a named
 * checkpoint's `files` directory.
 *
 * Every artifact is staged first, then installed with renames. A failure part
 * way through unwinds the renames already performed so the on-disk payload is
 * never left half-replaced.
 */
export function restoreManagedPayload(snapshotRoot: string, systemKey: string): void {
  const { stateRoot, userDataRoot } = getCollaborationPaths();
  const transactionRoot = path.join(
    stateRoot,
    'rollback-staging',
    `${systemKey}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  const stagedRoot = path.join(transactionRoot, 'staged');
  const backupRoot = path.join(transactionRoot, 'backup');
  const completed: Array<{
    target: string;
    backup: string;
    installed: boolean;
    backedUp: boolean;
  }> = [];

  try {
    for (const artifact of payloadArtifacts(systemKey)) {
      const source = path.join(snapshotRoot, artifact.relativePath);
      if (fs.existsSync(source)) {
        copyPathExact(source, path.join(stagedRoot, artifact.relativePath));
      }
    }

    for (const artifact of payloadArtifacts(systemKey)) {
      const target = path.join(userDataRoot, artifact.relativePath);
      const staged = path.join(stagedRoot, artifact.relativePath);
      const backup = path.join(backupRoot, artifact.relativePath);
      const operation = {
        target,
        backup,
        installed: false,
        backedUp: false,
      };
      completed.push(operation);
      if (fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.renameSync(target, backup);
        operation.backedUp = true;
      }
      if (fs.existsSync(staged)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(staged, target);
        operation.installed = true;
      }
    }
  } catch (error) {
    for (const operation of completed.reverse()) {
      try {
        if (operation.installed) removePath(operation.target);
        if (operation.backedUp && fs.existsSync(operation.backup)) {
          fs.mkdirSync(path.dirname(operation.target), { recursive: true });
          fs.renameSync(operation.backup, operation.target);
        }
      } catch {
        // Preserve the original failure. The history snapshot remains intact
        // for manual recovery if the filesystem rollback also fails.
      }
    }
    throw error;
  } finally {
    removePath(transactionRoot);
  }
}

/** Directory holding the byte-exact user-data payload for a named checkpoint. */
export function checkpointPayloadDir(systemKey: string, id: string): string {
  return path.join(checkpointDir(systemKey, id), 'files');
}

export async function snapshotToHistory(systemKey: string, rev: number): Promise<string> {
  return await withSystemLock(systemKey, () => stageHistorySnapshot(systemKey, rev));
}

export function listCheckpoints(systemKey: string): CheckpointMeta[] {
  const directory = checkpointsSystemDir(systemKey);
  if (!fs.existsSync(directory)) return [];
  const checkpoints = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.endsWith('.tmp'))
    .map((entry) => readCheckpointMeta(systemKey, entry.name));
  return checkpoints.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/**
 * `auto` marks checkpoints the system created on the user's behalf — currently
 * the pre-restore safety copy. Callers that reconstruct the restore sequence
 * themselves must pass it, otherwise clients are left inferring intent from the
 * label text.
 */
export async function createCheckpoint(
  systemKey: string,
  label: string,
  user: RevisionWriter,
  auto = false,
): Promise<CheckpointMeta> {
  return await withSystemLock(systemKey, () =>
    createCheckpointLocked(systemKey, label, user, auto),
  );
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatDailyLabel(dailyKey: string): string {
  const [year, month, day] = dailyKey.split('-').map(Number);
  return `Daily save — ${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}

function latestDailyCheckpoint(systemKey: string): CheckpointMeta | null {
  return listCheckpoints(systemKey).find((checkpoint) => checkpoint.dailyKey !== undefined) ?? null;
}

/**
 * Creates the first checkpoint of the day for `systemKey`, the moment someone
 * edits it, tagged with everyone who wrote to it since the previous daily
 * checkpoint. A no-op (returns `null`) if today's daily checkpoint already
 * exists — so calling this after every write is safe and cheap; only the
 * first write of a given UTC day actually creates one.
 *
 * "Day" is a UTC calendar date, matching `aggregateActivity`'s bucketing, so
 * the daily checkpoint and the activity panel never disagree about which day
 * an edit belongs to.
 */
export async function ensureDailyCheckpoint(
  systemKey: string,
  writer: RevisionWriter,
): Promise<CheckpointMeta | null> {
  return await withSystemLock(systemKey, () => {
    const cleanWriter = validateUser(writer, `Cannot save daily checkpoint for '${systemKey}'`);
    const todayKey = utcDateKey(new Date());
    const previousDaily = latestDailyCheckpoint(systemKey);
    if (previousDaily?.dailyKey === todayKey) return null;

    const contributors = listContributorsSince(systemKey, previousDaily?.createdAt ?? null);
    return createCheckpointLocked(
      systemKey,
      formatDailyLabel(todayKey),
      cleanWriter,
      true,
      { dailyKey: todayKey, contributors: contributors.length > 0 ? contributors : [cleanWriter] },
    );
  });
}

export function getCheckpoint(systemKey: string, id: string): CheckpointDetails {
  const meta = readCheckpointMeta(systemKey, id);
  const current = currentCounts(systemKey);
  const saved = checkpointCounts(systemKey, id);
  return {
    ...meta,
    countDiff: {
      hierarchy: saved.hierarchy - current.hierarchy,
      connectors: saved.connectors - current.connectors,
      branchPoints: saved.branchPoints - current.branchPoints,
      paths: saved.paths - current.paths,
      signals: saved.signals - current.signals,
    },
  };
}

export async function pruneHistory(systemKey: string): Promise<PruneResult> {
  return await withSystemLock(systemKey, () => {
    const directory = historySystemDir(systemKey);
    if (!fs.existsSync(directory)) return { kept: [], removed: [] };

    const snapshots = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => {
        const rev = Number(entry.name);
        const filePath = path.join(directory, entry.name);
        return { rev, filePath, time: fs.statSync(filePath).mtimeMs };
      })
      .sort((left, right) => right.time - left.time || right.rev - left.rev);

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const hourlyBuckets = new Set<string>();
    const dailyBuckets = new Set<string>();
    const kept: number[] = [];
    const removed: number[] = [];

    for (const snapshot of snapshots) {
      const age = Math.max(0, now - snapshot.time);
      let keep = age <= dayMs;
      const date = new Date(snapshot.time);
      if (!keep && age <= 7 * dayMs) {
        const hour = date.toISOString().slice(0, 13);
        keep = !hourlyBuckets.has(hour);
        hourlyBuckets.add(hour);
      } else if (!keep) {
        const day = date.toISOString().slice(0, 10);
        keep = !dailyBuckets.has(day);
        dailyBuckets.add(day);
      }

      if (keep) kept.push(snapshot.rev);
      else {
        removePath(snapshot.filePath);
        removed.push(snapshot.rev);
      }
    }

    kept.sort((left, right) => left - right);
    removed.sort((left, right) => left - right);
    return { kept, removed };
  });
}
