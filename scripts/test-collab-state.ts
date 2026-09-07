/**
 * End-to-end verification for collaboration sidecar persistence.
 *
 * The script builds a throwaway project, copies a real repository system into
 * it, and never writes beneath the repository's `public/user-data` directory.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyDiffToAttribution,
  getAttribution,
  whoTouched,
} from '../server/attribution.js';
import {
  aggregateActivity,
  appendEditLog,
} from '../server/editlog.js';
import {
  checkpointPayloadDir,
  createCheckpoint,
  ensureDailyCheckpoint,
  getCheckpoint,
  listCheckpoints,
  pruneHistory,
  restoreManagedPayload,
  snapshotToHistory,
} from '../server/history.js';
import {
  diffSystem,
  diffKeyedMap,
  type EntityDiff,
} from '../server/systemDiff.js';
import {
  bumpRev,
  checkCas,
  configureCollaborationState,
  getRev,
  getRevisionState,
  withSystemLock,
  type RevisionWriter,
} from '../server/revisions.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vibewire-collab-'));
const systemKey = 'fsae-car';
const user: RevisionWriter = { id: 'u_test', displayName: 'Test Editor' };
const secondUser: RevisionWriter = { id: 'u_second', displayName: 'Second Editor' };

type TestBody = () => void | Promise<void>;
const results: Array<{ name: string; error?: unknown }> = [];

function copyIfPresent(source: string, destination: string): void {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

interface RestoreOutcome {
  restored: { id: string; label: string };
  automaticCheckpoint: { id: string; label: string };
  rev: number;
}

/**
 * Mirrors the sequence `POST /api/checkpoints/:id/restore` performs, minus the
 * HTTP layer and systemKey validation. Keeps this suite exercising the same
 * persistence primitives the route uses instead of a parallel implementation.
 */
async function restoreCheckpoint(
  systemKey: string,
  id: string,
  writer: RevisionWriter,
): Promise<RestoreOutcome> {
  return await withSystemLock(systemKey, async () => {
    const restored = getCheckpoint(systemKey, id);
    const automaticCheckpoint = await createCheckpoint(
      systemKey,
      `Auto-saved before restoring "${restored.label}"`,
      writer,
      true,
    );
    await snapshotToHistory(systemKey, getRev(systemKey));
    const rev = await bumpRev(systemKey, writer);
    restoreManagedPayload(checkpointPayloadDir(systemKey, id), systemKey);
    return { restored, automaticCheckpoint, rev };
  });
}

function setupThrowawayProject(): void {
  const sourceUserData = path.join(repositoryRoot, 'public', 'user-data');
  const targetUserData = path.join(temporaryRoot, 'public', 'user-data');
  fs.mkdirSync(path.join(targetUserData, 'systems'), { recursive: true });

  const sourceSystem = path.join(sourceUserData, 'systems', systemKey);
  assert.ok(
    fs.existsSync(path.join(sourceSystem, 'root.json')),
    `Expected real sheeted system at ${sourceSystem}`,
  );
  copyIfPresent(sourceSystem, path.join(targetUserData, 'systems', systemKey));
  copyIfPresent(
    path.join(sourceUserData, `layouts.${systemKey}.json`),
    path.join(targetUserData, `layouts.${systemKey}.json`),
  );
  copyIfPresent(
    path.join(sourceUserData, `manufacturing.${systemKey}.json`),
    path.join(targetUserData, `manufacturing.${systemKey}.json`),
  );
  copyIfPresent(
    path.join(sourceUserData, 'subsystems', systemKey),
    path.join(targetUserData, 'subsystems', systemKey),
  );
}

function managedRelativePaths(systemKey: string): string[] {
  return [
    path.join('systems', systemKey),
    path.join('systems', `${systemKey}.json`),
    path.join('harnesses', systemKey),
    path.join('harnesses', `${systemKey}.json`),
    `layouts.${systemKey}.json`,
    `manufacturing.${systemKey}.json`,
    path.join('subsystems', systemKey),
  ];
}

function collectFiles(root: string, relativePath: string, files: Map<string, Buffer>): void {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) return;
  const stat = fs.lstatSync(absolute);
  if (stat.isFile()) {
    files.set(relativePath, fs.readFileSync(absolute));
    return;
  }
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), `Unexpected entry: ${absolute}`);
  for (const entry of fs.readdirSync(absolute).sort()) {
    collectFiles(root, path.join(relativePath, entry), files);
  }
}

function managedBytes(root: string, systemKey: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const relativePath of managedRelativePaths(systemKey)) {
    collectFiles(root, relativePath, files);
  }
  return files;
}

function assertByteMapsEqual(
  actual: ReadonlyMap<string, Buffer>,
  expected: ReadonlyMap<string, Buffer>,
  message: string,
): void {
  assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort(), `${message}: file list`);
  for (const [file, bytes] of expected) {
    assert.ok(actual.get(file)?.equals(bytes), `${message}: bytes differ for ${file}`);
  }
}

async function test(name: string, body: TestBody): Promise<void> {
  try {
    await body();
    results.push({ name });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, error });
    console.error(`FAIL  ${name}`);
    console.error(error);
  }
}

try {
  setupThrowawayProject();
  configureCollaborationState(temporaryRoot);
  const userDataRoot = path.join(temporaryRoot, 'public', 'user-data');

  await test('undefined storage keys never write revision files', () => {
    const undefinedFile = path.join(
      temporaryRoot,
      'vibewire-state',
      'revisions',
      'undefined.json',
    );
    if (fs.existsSync(undefinedFile)) fs.unlinkSync(undefinedFile);
    assert.throws(
      () => getRev(undefined as unknown as string),
      /Invalid collaboration storage key/,
    );
    assert.throws(
      () => getRevisionState(undefined as unknown as string),
      /Invalid collaboration storage key/,
    );
    assert.equal(
      fs.existsSync(undefinedFile),
      false,
      'RegExp.test(undefined) must not coerce to the storage key "undefined"',
    );
  });

  await test('revision persistence, recovery, and CAS', async () => {
    assert.equal(getRev(systemKey), 0);
    assert.equal(await bumpRev(systemKey, user), 1);

    configureCollaborationState(temporaryRoot);
    assert.equal(getRev(systemKey), 1, 'revision must survive simulated restart');
    assert.equal(await bumpRev(systemKey, secondUser), 2);
    assert.deepEqual(checkCas(systemKey, 2), { ok: true, currentRev: 2 });
    const rejected = checkCas(systemKey, 1);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.equal(rejected.currentRev, 2);
      assert.deepEqual(rejected.lastWriter, secondUser);
    }

    await snapshotToHistory(systemKey, 2);
    const revisionFile = path.join(
      temporaryRoot,
      'vibewire-state',
      'revisions',
      `${systemKey}.json`,
    );
    fs.unlinkSync(revisionFile);
    configureCollaborationState(temporaryRoot);
    assert.equal(getRev(systemKey), 3, 'missing state must recover from max history rev + 1');

    fs.writeFileSync(revisionFile, '{broken json', 'utf8');
    configureCollaborationState(temporaryRoot);
    assert.equal(getRev(systemKey), 3, 'corrupt state must recover from max history rev + 1');
    assert.equal(await bumpRev(systemKey, user), 4);
  });

  await test('mutex serialization and throw recovery', async () => {
    let active = 0;
    let maximumActive = 0;
    const completed: number[] = [];
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        withSystemLock(systemKey, async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setTimeout(resolve, (index % 3) + 1));
          completed.push(index);
          active -= 1;
        }),
      ),
    );
    assert.equal(maximumActive, 1, 'same-systemKey critical sections interleaved');
    assert.equal(completed.length, 12);

    await assert.rejects(
      withSystemLock(systemKey, () => {
        throw new Error('intentional mutex test failure');
      }),
      /intentional mutex test failure/,
    );
    assert.equal(
      await withSystemLock(systemKey, () => 'lock recovered'),
      'lock recovered',
      'a throwing callback poisoned the lock',
    );
  });

  await test('System and keyed-map diff correctness', () => {
    const previous = {
      hierarchy: [{ id: 'enc_same', properties: { b: 2, a: 1 } }],
      connectors: [
        { id: 'con_changed', name: 'Before' },
        { id: 'con_removed', name: 'Removed' },
      ],
      branchPoints: [],
      paths: [],
      signals: [],
    };
    const next = {
      hierarchy: [{ id: 'enc_same', properties: { a: 1, b: 2 } }],
      connectors: [
        { id: 'con_changed', name: 'After' },
        { id: 'con_added', name: 'Added' },
      ],
      branchPoints: [],
      paths: [],
      signals: [],
    };
    assert.deepEqual(diffSystem(previous, next), {
      added: ['con_added'],
      modified: ['con_changed'],
      removed: ['con_removed'],
    });
    assert.deepEqual(diffSystem(undefined, undefined), {
      added: [],
      modified: [],
      removed: [],
    });
    assert.deepEqual(
      diffKeyedMap(
        { same: { x: 1 }, changed: { x: 1 }, removed: true },
        { same: { x: 1 }, changed: { x: 2 }, added: true },
      ),
      {
        added: ['added'],
        modified: ['changed'],
        removed: ['removed'],
      },
    );
  });

  let originalCheckpointId = '';
  let mutatedCheckpointId = '';
  await test('byte-exact checkpoint restore and reverse restore', async () => {
    const original = managedBytes(userDataRoot, systemKey);
    const history = managedBytes(
      path.join(temporaryRoot, 'vibewire-state', 'history', systemKey, '2'),
      systemKey,
    );
    assertByteMapsEqual(history, original, 'automatic history snapshot');

    const checkpoint = await createCheckpoint(systemKey, 'Original state', user);
    originalCheckpointId = checkpoint.id;
    assert.equal(getCheckpoint(systemKey, checkpoint.id).countDiff.paths, 0);
    assert.equal(listCheckpoints(systemKey)[0]?.id, checkpoint.id);

    const rootFile = path.join(userDataRoot, 'systems', systemKey, 'root.json');
    const rootDocument = JSON.parse(fs.readFileSync(rootFile, 'utf8')) as Record<string, unknown>;
    rootDocument.name = 'Mutation used by collaboration test';
    fs.writeFileSync(rootFile, `${JSON.stringify(rootDocument, null, 4)}\n`, 'utf8');
    const staleSheet = path.join(
      userDataRoot,
      'systems',
      systemKey,
      'sheets',
      'stale_after_checkpoint.json',
    );
    fs.writeFileSync(staleSheet, '{"test":"stale sheet"}\n', 'utf8');
    const mutated = managedBytes(userDataRoot, systemKey);
    assert.notDeepEqual(
      [...mutated.entries()],
      [...original.entries()],
      'test mutation did not change bytes',
    );

    const firstRestore = await restoreCheckpoint(systemKey, checkpoint.id, secondUser);
    mutatedCheckpointId = firstRestore.automaticCheckpoint.id;
    assert.equal(
      firstRestore.automaticCheckpoint.label,
      'Auto-saved before restoring "Original state"',
    );
    assert.equal(firstRestore.rev, 5);
    assertByteMapsEqual(
      managedBytes(userDataRoot, systemKey),
      original,
      'restored original checkpoint',
    );
    assert.equal(fs.existsSync(staleSheet), false, 'restore did not remove a stale sheet');

    const reverseRestore = await restoreCheckpoint(
      systemKey,
      firstRestore.automaticCheckpoint.id,
      user,
    );
    assert.equal(reverseRestore.rev, 6);
    assertByteMapsEqual(
      managedBytes(userDataRoot, systemKey),
      mutated,
      'restored the pre-restore automatic checkpoint',
    );
  });

  await test('legacy flat harness snapshots and restore', async () => {
    const legacy = 'legacy-test';
    const legacyFile = path.join(userDataRoot, 'harnesses', `${legacy}.json`);
    fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
    const originalFlat = Buffer.from(
      `${JSON.stringify({
        schema_version: '0.1.0',
        hierarchy: [],
        connectors: [],
        branchPoints: [],
        paths: [],
        signals: [],
      }, null, 2)}\n`,
    );
    fs.writeFileSync(legacyFile, originalFlat);
    assert.equal(getRev(legacy), 0);
    await snapshotToHistory(legacy, 0);
    const historyFile = path.join(
      temporaryRoot,
      'vibewire-state',
      'history',
      legacy,
      '0',
      'harnesses',
      `${legacy}.json`,
    );
    assert.ok(fs.readFileSync(historyFile).equals(originalFlat));

    const checkpoint = await createCheckpoint(legacy, 'Flat original', user);
    fs.writeFileSync(
      legacyFile,
      originalFlat.toString('utf8').replace('"signals": []', '"signals": [{"id":"sig_x","name":"X","tags":[],"properties":{}}]'),
      'utf8',
    );
    assert.equal(await bumpRev(legacy, user), 1);
    await restoreCheckpoint(legacy, checkpoint.id, user);
    assert.ok(fs.readFileSync(legacyFile).equals(originalFlat));
  });

  await test('edit log aggregation', () => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const old = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const common = {
      kind: 'system' as const,
      rev: getRev(systemKey),
      added: 0,
      modified: 1,
      removed: 0,
      entityIds: ['con_changed'],
    };
    appendEditLog(systemKey, { ...common, user: user.id, displayName: user.displayName });
    appendEditLog(systemKey, { ...common, user: user.id, displayName: user.displayName });
    appendEditLog(systemKey, {
      ...common,
      user: secondUser.id,
      displayName: secondUser.displayName,
    });
    appendEditLog(systemKey, {
      ...common,
      ts: old,
      user: secondUser.id,
      displayName: secondUser.displayName,
    });
    assert.deepEqual(aggregateActivity(systemKey, 7), {
      [today]: {
        [secondUser.displayName]: 1,
        [user.displayName]: 2,
      },
    });
  });

  const thirdUser: RevisionWriter = { id: 'u_third', displayName: 'Third Editor' };

  await test('daily checkpoint marks contributors since last daily save', async () => {
    // The edit-log test above already logged `user` and `secondUser` writes to
    // `systemKey`, and no daily checkpoint exists yet, so the first save of the
    // (real) day should capture both as contributors.
    const first = await ensureDailyCheckpoint(systemKey, user);
    assert.ok(first, 'first write of the day must create a daily checkpoint');
    const todayKey = new Date().toISOString().slice(0, 10);
    assert.equal(first?.dailyKey, todayKey);
    assert.equal(first?.auto, true);
    assert.deepEqual(
      new Set(first?.contributors?.map((contributor) => contributor.id)),
      new Set([user.id, secondUser.id]),
      'daily checkpoint must list everyone who edited since the (nonexistent) previous one',
    );

    // A second write later the same day must not create a second daily
    // checkpoint — only the first write of a day that has one does.
    appendEditLog(systemKey, {
      user: secondUser.id,
      displayName: secondUser.displayName,
      kind: 'system',
      rev: getRev(systemKey),
      added: 0,
      modified: 1,
      removed: 0,
      entityIds: ['con_changed'],
    });
    const sameDay = await ensureDailyCheckpoint(systemKey, secondUser);
    assert.equal(sameDay, null, 'same-day write must not create a second daily checkpoint');

    // Simulate the calendar day having rolled over onto `first` without
    // rewriting its real creation time — it already happened after the
    // `user`/`secondUser` edits above, which is what makes the next window
    // correctly exclude them. Only its `dailyKey` needs to move off today.
    const metaFile = path.join(
      temporaryRoot,
      'vibewire-state',
      'checkpoints',
      systemKey,
      first!.id,
      'meta.json',
    );
    const yesterdayKey = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const backdated = { ...JSON.parse(fs.readFileSync(metaFile, 'utf8')) as Record<string, unknown> };
    backdated.dailyKey = yesterdayKey;
    fs.writeFileSync(metaFile, `${JSON.stringify(backdated, null, 2)}\n`, 'utf8');

    appendEditLog(systemKey, {
      user: thirdUser.id,
      displayName: thirdUser.displayName,
      kind: 'system',
      rev: getRev(systemKey),
      added: 0,
      modified: 1,
      removed: 0,
      entityIds: ['con_changed'],
    });
    const nextDay = await ensureDailyCheckpoint(systemKey, thirdUser);
    assert.ok(nextDay, 'a write after the backdated checkpoint must create a new daily checkpoint');
    assert.equal(nextDay?.dailyKey, todayKey);
    // Covers everyone who wrote after `first` was actually created: the
    // same-day `secondUser` write above plus `thirdUser`'s — but not `user`,
    // whose only writes predate `first` and so belong to the prior window.
    assert.deepEqual(
      nextDay?.contributors?.map((contributor) => contributor.id),
      [secondUser.id, thirdUser.id],
      'contributors must only cover writes since the previous daily checkpoint',
    );
  });

  await test('attribution update, lookup, and pruning', async () => {
    const firstDiff: EntityDiff = {
      added: ['con_added'],
      modified: ['con_changed'],
      removed: [],
    };
    await applyDiffToAttribution(systemKey, firstDiff, user, getRev(systemKey));
    await applyDiffToAttribution(
      systemKey,
      { added: [], modified: ['con_changed'], removed: ['con_added'] },
      secondUser,
      getRev(systemKey),
    );
    const attribution = getAttribution(systemKey);
    assert.equal(attribution.con_added, undefined);
    assert.deepEqual(attribution.con_changed?.by, secondUser);
    assert.deepEqual(whoTouched(systemKey, ['con_changed', 'missing', 'con_changed']), [
      secondUser,
    ]);
  });

  await test('history pruning preserves checkpoints', async () => {
    const historyRoot = path.join(temporaryRoot, 'vibewire-state', 'history', systemKey);
    const first = path.join(historyRoot, '100');
    const second = path.join(historyRoot, '101');
    fs.mkdirSync(first, { recursive: true });
    fs.mkdirSync(second, { recursive: true });
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    fs.utimesSync(first, tenDaysAgo, tenDaysAgo);
    fs.utimesSync(second, new Date(tenDaysAgo.getTime() + 1000), new Date(tenDaysAgo.getTime() + 1000));

    const beforeCheckpointIds = new Set(listCheckpoints(systemKey).map((item) => item.id));
    assert.ok(beforeCheckpointIds.has(originalCheckpointId));
    assert.ok(beforeCheckpointIds.has(mutatedCheckpointId));
    const result = await pruneHistory(systemKey);
    assert.equal(result.removed.length, 1);
    assert.equal(result.kept.filter((rev) => rev === 100 || rev === 101).length, 1);
    assert.deepEqual(
      new Set(listCheckpoints(systemKey).map((item) => item.id)),
      beforeCheckpointIds,
      'pruning changed named checkpoints',
    );
  });
} finally {
  const failed = results.filter((result) => result.error);
  console.log('');
  console.log(
    `${failed.length === 0 ? 'PASS' : 'FAIL'}: ${results.length - failed.length}/${results.length} collaboration-state checks passed.`,
  );
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  if (failed.length > 0) process.exitCode = 1;
}
