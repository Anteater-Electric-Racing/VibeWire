/**
 * Persistent collaboration revisions and the process-local per-harness mutex.
 *
 * Call `configureCollaborationState` once from server startup. All compound
 * persistence transactions must run inside `withHarnessLock`; `bumpRev` also
 * acquires that lock and is safely re-entrant from an already-locked callback.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';

export interface RevisionWriter {
  id: string;
  displayName: string;
}

export interface RevisionState {
  rev: number;
  lastWriter: RevisionWriter | null;
  lastWriteAt: string;
}

export type CasResult =
  | { ok: true; currentRev: number }
  | {
      ok: false;
      reason: 'mismatch' | 'invalid-base-rev';
      currentRev: number;
      baseRev: number;
      lastWriter: RevisionWriter | null;
    };

export interface CollaborationPaths {
  projectRoot: string;
  stateRoot: string;
  userDataRoot: string;
}

export const LIBRARY_REVISION_KEY = '_library';

let collaborationPaths: CollaborationPaths = pathsFor(process.cwd());
let outstandingLockCount = 0;

const lockTails = new Map<string, Promise<void>>();
const heldLocks = new AsyncLocalStorage<ReadonlyMap<string, symbol>>();
const activeLockTokens = new Set<symbol>();

function pathsFor(projectRoot: string, stateRoot?: string): CollaborationPaths {
  const resolvedProjectRoot = path.resolve(projectRoot);
  return {
    projectRoot: resolvedProjectRoot,
    stateRoot: path.resolve(stateRoot ?? path.join(resolvedProjectRoot, 'vibewire-state')),
    userDataRoot: path.join(resolvedProjectRoot, 'public', 'user-data'),
  };
}

function assertStorageKey(harness: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(harness)) {
    throw new Error(`Invalid collaboration storage key '${harness}'.`);
  }
  return harness;
}

function revisionFile(harness: string): string {
  return path.join(
    collaborationPaths.stateRoot,
    'revisions',
    `${assertStorageKey(harness)}.json`,
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

function isWriter(value: unknown): value is RevisionWriter {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.displayName === 'string';
}

function parseRevisionState(raw: string, filePath: string): RevisionState {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new SyntaxError(
      `Corrupt revision file '${filePath}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!value || typeof value !== 'object') {
    throw new SyntaxError(`Corrupt revision file '${filePath}': expected an object.`);
  }
  const record = value as Record<string, unknown>;
  if (
    !Number.isInteger(record.rev)
    || (record.rev as number) < 0
    || typeof record.lastWriteAt !== 'string'
    || (record.lastWriter !== null && !isWriter(record.lastWriter))
  ) {
    throw new SyntaxError(`Corrupt revision file '${filePath}': invalid revision record.`);
  }
  return {
    rev: record.rev as number,
    lastWriter: record.lastWriter as RevisionWriter | null,
    lastWriteAt: record.lastWriteAt,
  };
}

function maxHistoryRevision(harness: string): number {
  const historyDir = path.join(
    collaborationPaths.stateRoot,
    'history',
    assertStorageKey(harness),
  );
  if (!fs.existsSync(historyDir)) return -1;
  try {
    return fs.readdirSync(historyDir, { withFileTypes: true }).reduce((max, entry) => {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) return max;
      const rev = Number(entry.name);
      return Number.isSafeInteger(rev) ? Math.max(max, rev) : max;
    }, -1);
  } catch (error) {
    throw new Error(
      `Cannot inspect revision history for '${harness}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function recoveredRevisionState(harness: string): RevisionState {
  const recovered: RevisionState = {
    rev: maxHistoryRevision(harness) + 1,
    lastWriter: null,
    lastWriteAt: new Date().toISOString(),
  };
  writeJsonAtomic(revisionFile(harness), recovered);
  return recovered;
}

function readRevisionState(harness: string): RevisionState {
  const filePath = revisionFile(harness);
  if (!fs.existsSync(filePath)) return recoveredRevisionState(harness);

  let current: RevisionState;
  try {
    current = parseRevisionState(fs.readFileSync(filePath, 'utf8'), filePath);
  } catch (error) {
    if (error instanceof SyntaxError) return recoveredRevisionState(harness);
    throw new Error(
      `Cannot read revision for '${harness}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const historyMax = maxHistoryRevision(harness);
  if (current.rev < historyMax) {
    return recoveredRevisionState(harness);
  }
  return current;
}

export function configureCollaborationState(projectRoot: string, stateRoot?: string): void {
  if (outstandingLockCount > 0) {
    throw new Error('Cannot reconfigure collaboration paths while a harness lock is active.');
  }
  collaborationPaths = pathsFor(projectRoot, stateRoot);
  lockTails.clear();
  activeLockTokens.clear();
}

export function getCollaborationPaths(): Readonly<CollaborationPaths> {
  return { ...collaborationPaths };
}

export function getRevisionState(harness: string): RevisionState {
  const state = readRevisionState(harness);
  return {
    ...state,
    lastWriter: state.lastWriter ? { ...state.lastWriter } : null,
  };
}

export function getRev(harness: string): number {
  return readRevisionState(harness).rev;
}

export function checkCas(harness: string, baseRev: number): CasResult {
  const current = readRevisionState(harness);
  if (!Number.isSafeInteger(baseRev) || baseRev < 0) {
    return {
      ok: false,
      reason: 'invalid-base-rev',
      currentRev: current.rev,
      baseRev,
      lastWriter: current.lastWriter,
    };
  }
  if (baseRev !== current.rev) {
    return {
      ok: false,
      reason: 'mismatch',
      currentRev: current.rev,
      baseRev,
      lastWriter: current.lastWriter,
    };
  }
  return { ok: true, currentRev: current.rev };
}

export async function withHarnessLock<T>(
  harness: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const key = assertStorageKey(harness);
  const alreadyHeld = heldLocks.getStore();
  const inheritedToken = alreadyHeld?.get(key);
  if (inheritedToken && activeLockTokens.has(inheritedToken)) return await fn();

  const previous = lockTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  lockTails.set(key, tail);

  outstandingLockCount += 1;
  try {
    await previous;
    const token = Symbol(key);
    activeLockTokens.add(token);
    const nextHeld = new Map(alreadyHeld ?? []);
    nextHeld.set(key, token);
    try {
      return await heldLocks.run(nextHeld, async () => await fn());
    } finally {
      activeLockTokens.delete(token);
    }
  } finally {
    outstandingLockCount -= 1;
    release();
    void tail.then(() => {
      if (lockTails.get(key) === tail) lockTails.delete(key);
    });
  }
}

export async function bumpRev(harness: string, writer: RevisionWriter): Promise<number> {
  if (!isWriter(writer) || !writer.id || !writer.displayName) {
    throw new Error(`Cannot bump revision for '${harness}': invalid writer identity.`);
  }
  return await withHarnessLock(harness, () => {
    const current = readRevisionState(harness);
    if (current.rev >= Number.MAX_SAFE_INTEGER) {
      throw new Error(`Cannot bump revision for '${harness}': counter exhausted.`);
    }
    const next: RevisionState = {
      rev: current.rev + 1,
      lastWriter: { id: writer.id, displayName: writer.displayName },
      lastWriteAt: new Date().toISOString(),
    };
    writeJsonAtomic(revisionFile(harness), next);
    return next.rev;
  });
}
