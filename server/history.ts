/**
 * Byte-exact automatic history, named checkpoints, and reversible restore.
 *
 * Payloads mirror paths relative to `public/user-data` and every file copy uses
 * `copyFileSync`—parsed harness data is used only for entity counts, never for
 * persistence. Restore stages replacements before rename-based swaps.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  assembleHarnessFromDisk,
  type HarnessData,
} from './sheets.js';
import {
  getCollaborationPaths,
  getRev,
  withHarnessLock,
  type RevisionWriter,
} from './revisions.js';

export interface EntityCounts {
  enclosures: number;
  connectors: number;
  mergePoints: number;
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

function assertStorageKey(value: string, label: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label} '${value}'.`);
  }
  return value;
}

function assertCheckpointId(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid checkpoint id '${id}'.`);
  }
  return id;
}

function historyHarnessDir(harness: string): string {
  return path.join(
    getCollaborationPaths().stateRoot,
    'history',
    assertStorageKey(harness, 'history harness key'),
  );
}

function checkpointsHarnessDir(harness: string): string {
  return path.join(
    getCollaborationPaths().stateRoot,
    'checkpoints',
    assertStorageKey(harness, 'checkpoint harness key'),
  );
}

function checkpointDir(harness: string, id: string): string {
  return path.join(checkpointsHarnessDir(harness), assertCheckpointId(id));
}

function payloadArtifacts(harness: string): PayloadArtifact[] {
  const key = assertStorageKey(harness, 'harness key');
  return [
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

function copyCurrentPayload(harness: string, destinationRoot: string): void {
  const { userDataRoot } = getCollaborationPaths();
  const sheetedRoot = path.join(userDataRoot, 'harnesses', harness, 'root.json');
  const flatFile = path.join(userDataRoot, 'harnesses', `${harness}.json`);
  if (!fs.existsSync(sheetedRoot) && !fs.existsSync(flatFile)) {
    throw new Error(
      `Cannot snapshot '${harness}': neither a sheeted root nor a flat harness file exists.`,
    );
  }

  for (const artifact of payloadArtifacts(harness)) {
    const source = path.join(userDataRoot, artifact.relativePath);
    if (!fs.existsSync(source)) continue;
    if (
      artifact.relativePath === path.join('harnesses', harness)
      && !fs.existsSync(sheetedRoot)
    ) {
      continue;
    }
    copyPathExact(source, path.join(destinationRoot, artifact.relativePath));
  }
}

function readHarnessFromPayload(payloadRoot: string, harness: string): HarnessData {
  const harnessDir = path.join(payloadRoot, 'harnesses', harness);
  const flatFile = path.join(payloadRoot, 'harnesses', `${harness}.json`);
  if (fs.existsSync(path.join(harnessDir, 'root.json'))) {
    return assembleHarnessFromDisk(harnessDir);
  }
  if (!fs.existsSync(flatFile)) {
    throw new Error(`Cannot count '${harness}': checkpoint has no harness document.`);
  }
  try {
    return JSON.parse(fs.readFileSync(flatFile, 'utf8')) as HarnessData;
  } catch (error) {
    throw new Error(
      `Cannot parse flat harness '${flatFile}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function entityCounts(harness: HarnessData, context: string): EntityCounts {
  for (const collection of [
    'enclosures',
    'connectors',
    'mergePoints',
    'paths',
    'signals',
  ] as const) {
    if (!Array.isArray(harness[collection])) {
      throw new Error(`Cannot count ${context}: '${collection}' is not an array.`);
    }
  }
  return {
    enclosures: harness.enclosures.length,
    connectors: harness.connectors.length,
    mergePoints: harness.mergePoints.length,
    paths: harness.paths.length,
    signals: harness.signals.length,
  };
}

function currentCounts(harness: string): EntityCounts {
  return entityCounts(
    readHarnessFromPayload(getCollaborationPaths().userDataRoot, harness),
    `current harness '${harness}'`,
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
  const counts = meta.counts as Partial<EntityCounts> | undefined;
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
    || !Number.isSafeInteger(counts.enclosures)
    || !Number.isSafeInteger(counts.connectors)
    || !Number.isSafeInteger(counts.mergePoints)
    || !Number.isSafeInteger(counts.paths)
    || !Number.isSafeInteger(counts.signals)
  ) {
    throw new Error(`Invalid checkpoint metadata '${filePath}'.`);
  }
  return meta as CheckpointMeta;
}

function readCheckpointMeta(harness: string, id: string): CheckpointMeta {
  const directory = checkpointDir(harness, id);
  const metaFile = path.join(directory, 'meta.json');
  if (!fs.existsSync(metaFile)) {
    throw new Error(`Checkpoint '${id}' for '${harness}' does not exist or has no metadata.`);
  }
  const meta = parseCheckpointMeta(metaFile);
  if (meta.id !== id) {
    throw new Error(
      `Checkpoint '${id}' for '${harness}' has mismatched metadata id '${meta.id}'.`,
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

function checkpointCounts(harness: string, id: string): EntityCounts {
  const payloadRoot = path.join(checkpointDir(harness, id), 'files');
  return entityCounts(
    readHarnessFromPayload(payloadRoot, harness),
    `checkpoint '${id}'`,
  );
}

function createCheckpointLocked(
  harness: string,
  label: string,
  user: RevisionWriter,
  auto: boolean,
): CheckpointMeta {
  const cleanLabel = label.trim();
  if (!cleanLabel) throw new Error(`Cannot checkpoint '${harness}': label is required.`);
  const cleanUser = validateUser(user, `Cannot checkpoint '${harness}'`);
  const id = randomUUID();
  const destination = checkpointDir(harness, id);
  const stage = `${destination}.${process.pid}.${Date.now()}.tmp`;
  if (fs.existsSync(destination)) {
    throw new Error(`Cannot checkpoint '${harness}': generated id '${id}' already exists.`);
  }

  const meta: CheckpointMeta = {
    id,
    label: cleanLabel,
    createdAt: new Date().toISOString(),
    createdBy: cleanUser,
    rev: getRev(harness),
    auto,
    counts: currentCounts(harness),
  };

  try {
    fs.mkdirSync(stage, { recursive: true });
    copyCurrentPayload(harness, path.join(stage, 'files'));
    writeJsonAtomic(path.join(stage, 'meta.json'), meta);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(stage, destination);
    return meta;
  } catch (error) {
    removePath(stage);
    throw new Error(
      `Cannot create checkpoint for '${harness}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function stageHistorySnapshot(harness: string, rev: number): string {
  if (!Number.isSafeInteger(rev) || rev < 0) {
    throw new Error(`Cannot snapshot '${harness}': invalid revision '${rev}'.`);
  }
  const destination = path.join(historyHarnessDir(harness), String(rev));
  const stage = `${destination}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(stage, { recursive: true });
    copyCurrentPayload(harness, stage);
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
      `Cannot snapshot '${harness}' revision ${rev}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Replaces this harness's `public/user-data` payload with the copy held in
 * `snapshotRoot`, which may be either an automatic history snapshot or a named
 * checkpoint's `files` directory.
 *
 * Every artifact is staged first, then installed with renames. A failure part
 * way through unwinds the renames already performed so the on-disk payload is
 * never left half-replaced.
 */
export function restoreManagedPayload(snapshotRoot: string, harness: string): void {
  const { stateRoot, userDataRoot } = getCollaborationPaths();
  const transactionRoot = path.join(
    stateRoot,
    'rollback-staging',
    `${harness}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
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
    for (const artifact of payloadArtifacts(harness)) {
      const source = path.join(snapshotRoot, artifact.relativePath);
      if (fs.existsSync(source)) {
        copyPathExact(source, path.join(stagedRoot, artifact.relativePath));
      }
    }

    for (const artifact of payloadArtifacts(harness)) {
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
export function checkpointPayloadDir(harness: string, id: string): string {
  return path.join(checkpointDir(harness, id), 'files');
}

export async function snapshotToHistory(harness: string, rev: number): Promise<string> {
  return await withHarnessLock(harness, () => stageHistorySnapshot(harness, rev));
}

export function listCheckpoints(harness: string): CheckpointMeta[] {
  const directory = checkpointsHarnessDir(harness);
  if (!fs.existsSync(directory)) return [];
  const checkpoints = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.endsWith('.tmp'))
    .map((entry) => readCheckpointMeta(harness, entry.name));
  return checkpoints.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/**
 * `auto` marks checkpoints the system created on the user's behalf — currently
 * the pre-restore safety copy. Callers that reconstruct the restore sequence
 * themselves must pass it, otherwise clients are left inferring intent from the
 * label text.
 */
export async function createCheckpoint(
  harness: string,
  label: string,
  user: RevisionWriter,
  auto = false,
): Promise<CheckpointMeta> {
  return await withHarnessLock(harness, () =>
    createCheckpointLocked(harness, label, user, auto),
  );
}

export function getCheckpoint(harness: string, id: string): CheckpointDetails {
  const meta = readCheckpointMeta(harness, id);
  const current = currentCounts(harness);
  const saved = checkpointCounts(harness, id);
  return {
    ...meta,
    countDiff: {
      enclosures: saved.enclosures - current.enclosures,
      connectors: saved.connectors - current.connectors,
      mergePoints: saved.mergePoints - current.mergePoints,
      paths: saved.paths - current.paths,
      signals: saved.signals - current.signals,
    },
  };
}

export async function pruneHistory(harness: string): Promise<PruneResult> {
  return await withHarnessLock(harness, () => {
    const directory = historyHarnessDir(harness);
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
