#!/usr/bin/env -S npx tsx
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http, { type IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiMiddleware, type HarnessData } from '../server/api.js';

interface ApiResult<T = unknown> {
  status: number;
  headers: Headers;
  body: T;
}

interface StateResponse {
  rev: number;
  libraryRev: number;
  harness: HarnessData;
  layouts: Record<string, unknown>;
  manufacturing: Record<string, unknown>;
  subsystems: unknown[];
  attribution: Record<string, unknown>;
  lastWriter: { id: string; displayName: string } | null;
}

interface SseConnection {
  nextRev: Promise<Record<string, unknown>>;
  close: () => void;
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vibewire-collab-api-'));
const harnessName = 'fsae-car';
let failures = 0;

function copyIfPresent(source: string, destination: string): void {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

function setupTemporaryProject(): void {
  const sourceUserData = path.join(repositoryRoot, 'public', 'user-data');
  const targetUserData = path.join(temporaryRoot, 'public', 'user-data');
  const sourceSheeted = path.join(sourceUserData, 'harnesses', harnessName);
  const sourceFlat = path.join(sourceUserData, 'harnesses', `${harnessName}.json`);
  assert(
    fs.existsSync(path.join(sourceSheeted, 'root.json')) || fs.existsSync(sourceFlat),
    `Expected a real '${harnessName}' harness to copy`,
  );
  if (fs.existsSync(path.join(sourceSheeted, 'root.json'))) {
    copyIfPresent(sourceSheeted, path.join(targetUserData, 'harnesses', harnessName));
  } else {
    copyIfPresent(sourceFlat, path.join(targetUserData, 'harnesses', `${harnessName}.json`));
  }
  copyIfPresent(
    path.join(sourceUserData, 'connectors', 'connector-library.json'),
    path.join(targetUserData, 'connectors', 'connector-library.json'),
  );
  copyIfPresent(
    path.join(sourceUserData, `layouts.${harnessName}.json`),
    path.join(targetUserData, `layouts.${harnessName}.json`),
  );
  copyIfPresent(
    path.join(sourceUserData, `manufacturing.${harnessName}.json`),
    path.join(targetUserData, `manufacturing.${harnessName}.json`),
  );
  copyIfPresent(
    path.join(sourceUserData, 'subsystems', harnessName),
    path.join(targetUserData, 'subsystems', harnessName),
  );
  assert.equal(
    fs.existsSync(path.join(temporaryRoot, 'vibewire-state')),
    false,
    'test state must start outside the repository and empty',
  );
}

function collectFiles(root: string, relative: string, result: Map<string, Buffer>): void {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return;
  const stat = fs.lstatSync(absolute);
  if (stat.isFile()) {
    result.set(relative, fs.readFileSync(absolute));
    return;
  }
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `Unexpected filesystem entry: ${absolute}`);
  for (const entry of fs.readdirSync(absolute).sort()) {
    collectFiles(root, path.join(relative, entry), result);
  }
}

function harnessBytes(): Map<string, Buffer> {
  const userData = path.join(temporaryRoot, 'public', 'user-data');
  const result = new Map<string, Buffer>();
  collectFiles(userData, path.join('harnesses', harnessName), result);
  collectFiles(userData, path.join('harnesses', `${harnessName}.json`), result);
  return result;
}

function assertBytesEqual(
  actual: ReadonlyMap<string, Buffer>,
  expected: ReadonlyMap<string, Buffer>,
  message: string,
): void {
  assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort(), `${message}: files`);
  for (const [file, bytes] of expected) {
    assert(actual.get(file)?.equals(bytes), `${message}: bytes differ for ${file}`);
  }
}

async function check(name: string, body: () => void | Promise<void>): Promise<void> {
  try {
    await body();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function cookieFrom(result: ApiResult): string {
  const header = result.headers.get('set-cookie');
  assert(header, 'response did not set a session cookie');
  return header.split(';', 1)[0];
}

setupTemporaryProject();
const middleware = createApiMiddleware(temporaryRoot);
const server = http.createServer((req, res) => {
  middleware(req, res, () => {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not found' }));
  });
});

await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
assert(address && typeof address !== 'string');
const baseUrl = `http://127.0.0.1:${address.port}`;

async function api<T = unknown>(
  pathname: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.cookie) headers.Cookie = options.cookie;
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: (text ? JSON.parse(text) : null) as T,
  };
}

async function openSse(cookie: string): Promise<SseConnection> {
  return await new Promise((resolve, reject) => {
    let settled = false;
    let buffer = '';
    let resolveRev!: (payload: Record<string, unknown>) => void;
    let rejectRev!: (error: Error) => void;
    const nextRev = new Promise<Record<string, unknown>>((resolveEvent, rejectEvent) => {
      resolveRev = resolveEvent;
      rejectRev = rejectEvent;
    });
    const timeout = setTimeout(() => {
      const error = new Error('Timed out waiting for SSE connection or revision event');
      if (!settled) reject(error);
      rejectRev(error);
      request.destroy();
    }, 5_000);
    const request = http.get(
      `${baseUrl}/api/events?harness=${encodeURIComponent(harnessName)}`,
      { headers: { Cookie: cookie } },
      (response: IncomingMessage) => {
        if (response.statusCode !== 200) {
          reject(new Error(`SSE returned ${response.statusCode}`));
          request.destroy();
          return;
        }
        response.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          if (!settled && buffer.includes(': connected\n\n')) {
            settled = true;
            resolve({
              nextRev,
              close: () => {
                clearTimeout(timeout);
                response.destroy();
                request.destroy();
              },
            });
          }
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            if (!frame.includes('event: rev')) continue;
            const data = frame.split('\n').find((line) => line.startsWith('data: '));
            if (!data) continue;
            clearTimeout(timeout);
            resolveRev(JSON.parse(data.slice(6)) as Record<string, unknown>);
          }
        });
        response.once('error', (error) => {
          if (!settled) reject(error);
        });
      },
    );
    request.once('error', (error) => {
      clearTimeout(timeout);
      if (!settled) reject(error);
      else rejectRev(error);
    });
  });
}

let editorCookie = '';
let viewerCookie = '';

try {
  await check('signup, roles, and credential-safe user responses', async () => {
    const editor = await api<{ user: Record<string, unknown> }>('/api/users', {
      method: 'POST',
      body: { login: 'EditorSecret', displayName: 'Editor', role: 'editor' },
    });
    const viewer = await api<{ user: Record<string, unknown> }>('/api/users', {
      method: 'POST',
      body: { login: 'ViewerSecret', displayName: 'Viewer', role: 'viewer' },
    });
    assert.equal(editor.status, 201);
    assert.equal(viewer.status, 201);
    assert.equal(editor.body.user.login, undefined);
    assert.equal(viewer.body.user.login, undefined);

    // Signing up logs the account straight in — no separate login step needed.
    editorCookie = cookieFrom(editor);
    viewerCookie = cookieFrom(viewer);

    const openRead = await api(`/api/state?harness=${harnessName}`);
    assert.equal(openRead.status, 200);
    const forbidden = await api(`/api/save-layouts?harness=${harnessName}`, {
      method: 'POST',
      cookie: viewerCookie,
      body: { patch: { nodes: { viewer_attempt: { x: 1, y: 1 } } }, removed: {} },
    });
    assert.equal(forbidden.status, 403);
    assert.equal((await api(`/api/save-layouts?harness=${harnessName}`, {
      method: 'POST',
      body: { patch: {}, removed: {} },
    })).status, 403);
  });

  await check('credentialed CORS preflight echoes the origin', async () => {
    const response = await api(`/api/save-harness?harness=${harnessName}`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://team.example',
        'Access-Control-Request-Headers': 'Content-Type, X-Base-Rev',
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://team.example');
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    assert.match(response.headers.get('access-control-allow-headers') ?? '', /X-Base-Rev/i);
  });

  await check('CAS accepts current revision and rejects stale bytes unchanged', async () => {
    const initial = (await api<StateResponse>(`/api/state?harness=${harnessName}`)).body;
    assert(initial.harness.connectors.length > 0, 'copied harness needs a connector');
    const connectorId = initial.harness.connectors[0].id;
    const acceptedHarness = structuredClone(initial.harness);
    acceptedHarness.connectors[0].name = 'CAS accepted edit';
    const accepted = await api<{ ok: boolean; rev: number }>(
      `/api/save-harness?harness=${harnessName}`,
      {
        method: 'POST',
        cookie: editorCookie,
        headers: { 'X-Base-Rev': String(initial.rev) },
        body: acceptedHarness,
      },
    );
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.rev, initial.rev + 1);

    const beforeRejected = harnessBytes();
    const staleHarness = structuredClone(initial.harness);
    staleHarness.connectors[0].name = 'Stale edit must not land';
    const rejected = await api<{
      error: string;
      currentRev: number;
      baseRev: number;
      lastWriter: { displayName: string };
      changedEntityIds: string[];
    }>(`/api/save-harness?harness=${harnessName}`, {
      method: 'POST',
      cookie: editorCookie,
      headers: { 'X-Base-Rev': String(initial.rev) },
      body: staleHarness,
    });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.error, 'conflict');
    assert.equal(rejected.body.currentRev, accepted.body.rev);
    assert.equal(rejected.body.baseRev, initial.rev);
    assert.equal(rejected.body.lastWriter.displayName, 'Editor');
    assert(rejected.body.changedEntityIds.includes(connectorId));
    assertBytesEqual(harnessBytes(), beforeRejected, 'stale CAS rejection changed harness files');
  });

  await check('simultaneous saves serialize without corruption', async () => {
    const state = (await api<StateResponse>(`/api/state?harness=${harnessName}`)).body;
    const first = structuredClone(state.harness);
    const second = structuredClone(state.harness);
    first.connectors[0].name = 'Concurrent winner A';
    second.connectors[0].name = 'Concurrent winner B';
    const responses = await Promise.all([
      api(`/api/save-harness?harness=${harnessName}`, {
        method: 'POST',
        cookie: editorCookie,
        headers: { 'X-Base-Rev': String(state.rev) },
        body: first,
      }),
      api(`/api/save-harness?harness=${harnessName}`, {
        method: 'POST',
        cookie: editorCookie,
        headers: { 'X-Base-Rev': String(state.rev) },
        body: second,
      }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const saved = (await api<StateResponse>(`/api/state?harness=${harnessName}`)).body;
    assert(
      saved.harness.connectors[0].name === 'Concurrent winner A'
      || saved.harness.connectors[0].name === 'Concurrent winner B',
    );
    JSON.stringify(saved.harness);
  });

  await check('library CAS has an independent revision', async () => {
    const state = (await api<StateResponse>(`/api/state?harness=${harnessName}`)).body;
    const library = (await api<{ connector_types: Array<Record<string, unknown>> }>('/api/library')).body;
    assert(library.connector_types.length > 0);
    const next = structuredClone(library);
    next.connector_types[0].notes = 'Collaboration API verification';
    const accepted = await api<{ rev: number }>('/api/save-library', {
      method: 'POST',
      cookie: editorCookie,
      headers: { 'X-Base-Rev': String(state.libraryRev) },
      body: next,
    });
    assert.equal(accepted.status, 200);
    const file = path.join(
      temporaryRoot,
      'public',
      'user-data',
      'connectors',
      'connector-library.json',
    );
    const beforeRejected = fs.readFileSync(file);
    const rejected = await api<{ error: string; currentRev: number; changedEntityIds: string[] }>(
      '/api/save-library',
      {
        method: 'POST',
        cookie: editorCookie,
        headers: { 'X-Base-Rev': String(state.libraryRev) },
        body: library,
      },
    );
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.error, 'conflict');
    assert.equal(rejected.body.currentRev, accepted.body.rev);
    assert(rejected.body.changedEntityIds.includes(String(next.connector_types[0].id)));
    assert(fs.readFileSync(file).equals(beforeRejected));
  });

  await check('layout merges preserve independent clients and nested merge points', async () => {
    const first = api(`/api/save-layouts?harness=${harnessName}`, {
      method: 'POST',
      cookie: editorCookie,
      body: {
        patch: {
          nodes: { layout_client_a: { x: 10, y: 20 } },
          mergePoints: { shared_context: { mp_client_a: { x: 1, y: 2 } } },
        },
        removed: {},
      },
    });
    const second = api(`/api/save-layouts?harness=${harnessName}`, {
      method: 'POST',
      cookie: editorCookie,
      body: {
        patch: {
          nodes: { layout_client_b: { x: 30, y: 40 } },
          mergePoints: { shared_context: { mp_client_b: { x: 3, y: 4 } } },
        },
        removed: {},
      },
    });
    assert.deepEqual((await Promise.all([first, second])).map((item) => item.status), [200, 200]);
    const state = (await api<StateResponse>(`/api/state?harness=${harnessName}`)).body;
    const nodes = state.layouts.nodes as Record<string, unknown>;
    const mergePoints = state.layouts.mergePoints as Record<string, Record<string, unknown>>;
    assert(nodes.layout_client_a);
    assert(nodes.layout_client_b);
    assert(mergePoints.shared_context.mp_client_a);
    assert(mergePoints.shared_context.mp_client_b);
  });

  await check('validation degradation is refused without touching the harness', async () => {
    const state = (await api<StateResponse>(`/api/state?harness=${harnessName}`)).body;
    const before = harnessBytes();
    const invalid = structuredClone(state.harness);
    invalid.paths.push({
      id: 'path_validation_degradation_test',
      name: 'Invalid missing connector path',
      tags: [],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'con_missing_for_test', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_still_missing_for_test', pin_number: 1 },
      ],
      measurements: [],
    });
    const response = await api<{ error: string; errors: string[] }>(
      `/api/save-harness?harness=${harnessName}`,
      {
        method: 'POST',
        cookie: editorCookie,
        headers: { 'X-Base-Rev': String(state.rev) },
        body: invalid,
      },
    );
    assert.equal(response.status, 500);
    assert.equal(response.body.error, 'validation-degradation');
    assert(response.body.errors.some((error) => error.includes('missing connector')));
    assertBytesEqual(harnessBytes(), before, 'a refused save must not touch the payload');
    const after = (await api<StateResponse>(`/api/state?harness=${harnessName}`)).body;
    // The payload is rejected before anything is written, so there is nothing to
    // roll back and no reason to advance the revision. Bumping it here would
    // leave the client's base revision stale and turn every later save into a
    // conflict.
    assert.equal(after.rev, state.rev, 'a refused save must leave the revision untouched');
    assert(!after.harness.paths.some((wirePath) => wirePath.id === 'path_validation_degradation_test'));

    // A later save from the same base revision must still be accepted.
    const recovery = structuredClone(state.harness);
    recovery.connectors[0].name = `${recovery.connectors[0].name} ok`;
    const retry = await api<{ rev: number }>(`/api/save-harness?harness=${harnessName}`, {
      method: 'POST',
      cookie: editorCookie,
      headers: { 'X-Base-Rev': String(state.rev) },
      body: recovery,
    });
    assert.equal(retry.status, 200, 'a refused save must not poison the next one');
  });

  // A measurement between two non-adjacent nodes passes validation (both
  // endpoints exist on the path) but cannot be placed on any sheet, so the
  // splitter drops it and the round-trip check refuses the save. Splicing a
  // measured hop used to produce exactly this shape.
  await check('an unsaveable sheet split is refused without touching the harness', async () => {
    const state = (await api<StateResponse>(`/api/state?harness=${harnessName}`)).body;
    const parentById = new Map(state.harness.enclosures.map((enc) => [enc.id, enc.parent]));
    const topLevelOf = (start: string | null): string | null => {
      let current = start;
      while (current !== null && parentById.get(current)) current = parentById.get(current) ?? null;
      return current;
    };
    const scopeOfNode = (node: { kind: string; connector_id?: string }): string | null => {
      if (node.kind !== 'connector') return null;
      const connector = state.harness.connectors.find((item) => item.id === node.connector_id);
      return connector ? topLevelOf(connector.parent) : null;
    };
    // Needs a path whose ends sit on different sheets, so the span cannot land
    // in a single fragment.
    const spanning = state.harness.paths.find((item) => {
      if (item.nodes.length < 3) return false;
      const scopes = item.nodes.map(scopeOfNode);
      return new Set(scopes).size >= 3 && scopes.every((scope) => scope !== null);
    });
    assert(spanning, 'expected a path crossing three sheets in the fixture harness');

    const before = harnessBytes();
    const unsaveable = structuredClone(state.harness);
    const target = unsaveable.paths.find((item) => item.id === spanning.id)!;
    target.measurements = [
      ...target.measurements,
      {
        from: structuredClone(target.nodes[0]),
        to: structuredClone(target.nodes[target.nodes.length - 1]),
        length_mm: 123,
      },
    ];
    const response = await api<{ error: string }>(`/api/save-harness?harness=${harnessName}`, {
      method: 'POST',
      cookie: editorCookie,
      headers: { 'X-Base-Rev': String(state.rev) },
      body: unsaveable,
    });
    assert.equal(response.status, 500);
    assert(
      response.body.error.includes('measurement count mismatch'),
      `expected a round-trip refusal, got '${response.body.error}'`,
    );
    assertBytesEqual(harnessBytes(), before, 'a refused split must not touch the payload');
    const after = (await api<StateResponse>(`/api/state?harness=${harnessName}`)).body;
    assert.equal(after.rev, state.rev, 'a refused split must leave the revision untouched');
    assert.equal(
      after.harness.paths.find((item) => item.id === spanning.id)?.measurements.length,
      spanning.measurements.length,
      'a refused split must leave the path measurements untouched',
    );
  });

  await check('checkpoint restore is reversible by restoring the restore', async () => {
    const before = (await api<StateResponse>(`/api/state?harness=${harnessName}`)).body;
    const checkpoint = await api<{ id: string }>(`/api/checkpoints?harness=${harnessName}`, {
      method: 'POST',
      cookie: editorCookie,
      body: { label: 'Before checkpoint mutation' },
    });
    assert.equal(checkpoint.status, 201);
    const originalName = before.harness.connectors[0].name;

    const mutatedHarness = structuredClone(before.harness);
    mutatedHarness.connectors[0].name = 'Checkpoint mutation';
    const mutation = await api<{ rev: number }>(`/api/save-harness?harness=${harnessName}`, {
      method: 'POST',
      cookie: editorCookie,
      headers: { 'X-Base-Rev': String(before.rev) },
      body: mutatedHarness,
    });
    assert.equal(mutation.status, 200);

    const restore = await api<{
      rev: number;
      automaticCheckpoint: { id: string; label: string };
    }>(`/api/checkpoints/${checkpoint.body.id}/restore?harness=${harnessName}`, {
      method: 'POST',
      cookie: editorCookie,
    });
    assert.equal(restore.status, 200);
    assert.match(restore.body.automaticCheckpoint.label, /Auto-saved before restoring/);
    assert.equal(
      (await api<StateResponse>(`/api/state?harness=${harnessName}`)).body
        .harness.connectors[0].name,
      originalName,
    );

    const reverse = await api(
      `/api/checkpoints/${restore.body.automaticCheckpoint.id}/restore?harness=${harnessName}`,
      { method: 'POST', cookie: editorCookie },
    );
    assert.equal(reverse.status, 200);
    assert.equal(
      (await api<StateResponse>(`/api/state?harness=${harnessName}`)).body
        .harness.connectors[0].name,
      'Checkpoint mutation',
    );
  });

  await check('SSE receives revisions and sync returns delta and full shapes', async () => {
    const before = (await api<StateResponse>(`/api/state?harness=${harnessName}`)).body;
    assert.equal((await api(`/api/events?harness=${harnessName}`)).status, 401);
    const sse = await openSse(viewerCookie);
    try {
      const write = await api<{ rev: number }>(`/api/save-layouts?harness=${harnessName}`, {
        method: 'POST',
        cookie: editorCookie,
        body: {
          patch: { nodes: { sse_sync_test: { x: 99, y: 101 } } },
          removed: {},
        },
      });
      assert.equal(write.status, 200);
      const event = await sse.nextRev;
      assert.equal(event.rev, write.body.rev);
      assert.equal(event.kind, 'layouts');

      const delta = await api<{
        rev: number;
        full: boolean;
        changed: Record<string, unknown>;
      }>(`/api/sync?harness=${harnessName}&since=${before.rev}`);
      assert.equal(delta.status, 200);
      assert.equal(delta.body.full, false);
      assert(delta.body.changed.layouts);
      assert.equal(delta.body.rev, write.body.rev);

      const full = await api<StateResponse & { full: boolean }>(
        `/api/sync?harness=${harnessName}&since=999999999`,
      );
      assert.equal(full.status, 200);
      assert.equal(full.body.full, true);
      assert(full.body.harness);
      assert.equal(typeof full.body.libraryRev, 'number');
    } finally {
      sse.close();
    }
  });

  await check('activity endpoint reports successful saves', async () => {
    const activity = await api<Record<string, Record<string, number>>>(
      `/api/activity?harness=${harnessName}&days=7`,
    );
    assert.equal(activity.status, 200);
    assert(Object.values(activity.body).some((day) => (day.Editor ?? 0) > 0));
  });
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\nFAIL: ${failures} collaboration API check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nPASS: all collaboration API checks passed.');
}
