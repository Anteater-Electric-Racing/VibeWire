#!/usr/bin/env -S npx tsx
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http, {
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  createAuth,
  type RouteHandler,
} from '../server/auth.js';
import {
  createPresenceHandler,
  createPresenceRegistry,
  type PresenceUpdate,
} from '../server/presence.js';
import {
  addClient,
  broadcast,
  clientCount,
} from '../server/sse.js';

interface ApiResult {
  status: number;
  headers: Headers;
  body: unknown;
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vibewire-collab-'));
let authNow = Date.now();
const auth = createAuth(temporaryRoot, {
  now: () => authNow,
  getClientIp: (req) => {
    const value = req.headers['x-test-ip'];
    return typeof value === 'string' ? value : 'test-default';
  },
});
const httpPresence = createPresenceRegistry({
  broadcast: () => undefined,
  sweepIntervalMs: 60_000,
});
const presenceHandler = createPresenceHandler(auth, httpPresence);

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function invoke(
  handler: RouteHandler,
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  query: URLSearchParams,
): void {
  try {
    Promise.resolve(handler(req, res, params, query)).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'test route failure' });
    });
  } catch {
    if (!res.headersSent) sendJson(res, 500, { error: 'test route failure' });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';
  const route = `${method} ${url.pathname}`;
  const routes = new Map<string, RouteHandler>([
    ['POST /api/auth/login', auth.handlers.login],
    ['POST /api/auth/logout', auth.handlers.logout],
    ['GET /api/auth/me', auth.handlers.me],
    ['POST /api/users', auth.handlers.createUser],
    ['POST /api/presence', presenceHandler],
  ]);
  const handler = routes.get(route);
  if (handler) {
    invoke(handler, req, res, {}, url.searchParams);
    return;
  }

  if (url.pathname === '/api/guard/editor') {
    if (!auth.requireEditor(req)) {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }
    res.statusCode = 204;
    res.end();
    return;
  }
  if (url.pathname === '/api/events' && method === 'GET') {
    addClient(req, res, url.searchParams.get('harness') ?? 'default');
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

let failures = 0;

async function check(name: string, test: () => void | Promise<void>): Promise<void> {
  try {
    await test();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL ${name}: ${message}`);
  }
}

function cookieFrom(result: ApiResult): string {
  const setCookie = result.headers.get('set-cookie');
  assert(setCookie, 'response did not set a cookie');
  return setCookie.split(';', 1)[0];
}

function cookieValue(cookie: string): string {
  const separator = cookie.indexOf('=');
  assert(separator > 0);
  return cookie.slice(separator + 1);
}

function tamper(cookie: string): string {
  const separator = cookie.indexOf('=');
  const value = cookie.slice(separator + 1);
  const dot = value.indexOf('.');
  assert(dot > 0);
  const macStart = dot + 1;
  const replacement = value[macStart] === 'A' ? 'B' : 'A';
  return `${cookie.slice(0, separator + 1)}${value.slice(0, macStart)}${replacement}${value.slice(macStart + 1)}`;
}

const presencePayload: Omit<PresenceUpdate, 'userId' | 'displayName' | 'color'> = {
  harness: 'test-harness',
  appView: 'canvas',
  editingSurface: 'hierarchy',
  drillDownEnclosure: null,
  activeSubsystemId: null,
  focus: { kind: 'connector', id: 'con_1' },
  editing: null,
};

await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
assert(address && typeof address !== 'string');
const baseUrl = `http://127.0.0.1:${address.port}`;

async function api(
  pathname: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    ip?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.ip) headers['X-Test-IP'] = options.ip;
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) as unknown : null,
  };
}

let joeCookie = '';
let joeId = '';
let editorCookie = '';
let viewerCookie = '';

try {
  await check('signing up creates an account and logs the user in', async () => {
    const result = await api('/api/users', {
      method: 'POST',
      body: { login: 'Joe', displayName: 'Joe', role: 'editor' },
      ip: 'bootstrap',
    });
    assert.equal(result.status, 201);
    const body = result.body as { user: { id: string; role: string } };
    assert.equal(body.user.role, 'editor');
    joeId = body.user.id;
    joeCookie = cookieFrom(result);

    const users = JSON.parse(
      fs.readFileSync(path.join(temporaryRoot, 'vibewire-state', 'users.json'), 'utf8'),
    ) as Array<{ login: string; role: string }>;
    assert.deepEqual(users.map((user) => [user.login, user.role]), [['Joe', 'editor']]);
    const secretMode = fs.statSync(
      path.join(temporaryRoot, 'vibewire-state', 'secret.txt'),
    ).mode & 0o777;
    assert.equal(secretMode, 0o600);
    const setCookie = result.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Path=\//i);
    assert.match(setCookie, /Max-Age=2592000/i);
  });

  await check('login succeeds and unknown login fails', async () => {
    const success = await api('/api/auth/login', {
      method: 'POST',
      body: { login: 'Joe' },
      ip: 'normal-success',
    });
    assert.equal(success.status, 200);
    const failure = await api('/api/auth/login', {
      method: 'POST',
      body: { login: 'Nobody' },
      ip: 'normal-failure',
    });
    assert.equal(failure.status, 401);
  });

  await check('/api/auth/me never returns the login credential', async () => {
    const result = await api('/api/auth/me', { cookie: joeCookie });
    const body = result.body as { user: { id: string; login?: string } | null };
    assert.equal(body.user?.id, joeId);
    assert.equal(body.user?.login, undefined);
  });

  await check('rate limiting one login does not lock out other logins on a shared IP', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: { login: 'Fumbled' },
        ip: 'shared-office',
      });
      assert.equal(result.status, 401);
    }
    const blocked = await api('/api/auth/login', {
      method: 'POST',
      body: { login: 'Fumbled' },
      ip: 'shared-office',
    });
    assert.equal(blocked.status, 429);

    // A teammate behind the same tunnel IP must still be able to sign in.
    const teammate = await api('/api/auth/login', {
      method: 'POST',
      body: { login: 'Joe' },
      ip: 'shared-office',
    });
    assert.equal(teammate.status, 200);
  });

  await check('login matching is case sensitive', async () => {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: { login: 'joe' },
      ip: 'case-sensitive',
    });
    assert.equal(result.status, 401);
  });

  await check('signed cookie accepts valid and rejects tampered values', async () => {
    assert.match(cookieValue(joeCookie), /^[A-Za-z0-9_.%-]+$/);
    const valid = await api('/api/auth/me', { cookie: joeCookie });
    assert.equal((valid.body as { user: { id: string } | null }).user?.id, joeId);
    const invalid = await api('/api/auth/me', { cookie: tamper(joeCookie) });
    assert.equal((invalid.body as { user: unknown }).user, null);
  });

  await check('failed logins are rate limited per IP', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: { login: 'Wrong' },
        ip: 'rate-limited',
      });
      assert.equal(result.status, 401);
    }
    const limited = await api('/api/auth/login', {
      method: 'POST',
      body: { login: 'Wrong' },
      ip: 'rate-limited',
    });
    assert.equal(limited.status, 429);
    authNow += 60_001;
    const afterWindow = await api('/api/auth/login', {
      method: 'POST',
      body: { login: 'Wrong' },
      ip: 'rate-limited',
    });
    assert.equal(afterWindow.status, 401);
  });

  await check('anyone can create editor and viewer accounts without signing in first', async () => {
    const editor = await api('/api/users', {
      method: 'POST',
      body: { login: 'EditorSecret', displayName: 'Ed', role: 'editor' },
      ip: 'signup-editor',
    });
    assert.equal(editor.status, 201);
    const viewer = await api('/api/users', {
      method: 'POST',
      body: { login: 'ViewerSecret', displayName: 'Vi', role: 'viewer' },
      ip: 'signup-viewer',
    });
    assert.equal(viewer.status, 201);
    assert.notEqual(
      (editor.body as { user: { color: string } }).user.color,
      (viewer.body as { user: { color: string } }).user.color,
    );

    // Signing up logs you straight in — no separate login step needed.
    editorCookie = cookieFrom(editor);
    viewerCookie = cookieFrom(viewer);

    // The same login also works for a fresh session later.
    const editorLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { login: 'EditorSecret' },
      ip: 'editor-login',
    });
    assert.equal(editorLogin.status, 200);
  });

  await check('role gating rejects viewers and permits editors', async () => {
    assert.equal((await api('/api/guard/editor', { cookie: viewerCookie })).status, 403);
    assert.equal((await api('/api/guard/editor', { cookie: editorCookie })).status, 204);
  });

  await check('signup rejects duplicate logins and invalid roles', async () => {
    const duplicate = await api('/api/users', {
      method: 'POST',
      body: { login: 'EditorSecret', displayName: 'Copycat', role: 'editor' },
      ip: 'signup-duplicate',
    });
    assert.equal(duplicate.status, 409);
    const badRole = await api('/api/users', {
      method: 'POST',
      body: { login: 'BadRoleSecret', displayName: 'Bad', role: 'owner' },
      ip: 'signup-bad-role',
    });
    assert.equal(badRole.status, 400);
  });

  await check('account creation is rate limited per IP', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await api('/api/users', {
        method: 'POST',
        body: { login: `RateLimited${attempt}`, displayName: `Rate ${attempt}`, role: 'viewer' },
        ip: 'signup-rate-limited',
      });
      assert.equal(result.status, 201);
    }
    const blocked = await api('/api/users', {
      method: 'POST',
      body: { login: 'RateLimitedOverflow', displayName: 'Overflow', role: 'viewer' },
      ip: 'signup-rate-limited',
    });
    assert.equal(blocked.status, 429);
  });

  await check('trusted identity header bypasses cookie identity', async () => {
    const previous = process.env.TRUST_IDENTITY_HEADER;
    process.env.TRUST_IDENTITY_HEADER = '1';
    try {
      const result = await api('/api/auth/me', {
        cookie: tamper(joeCookie),
        headers: { 'Cf-Access-Authenticated-User-Email': 'EditorSecret' },
      });
      assert.equal((result.body as { user: { role: string } | null }).user?.role, 'editor');
    } finally {
      if (previous === undefined) delete process.env.TRUST_IDENTITY_HEADER;
      else process.env.TRUST_IDENTITY_HEADER = previous;
    }
  });

  await check('viewers can publish authenticated presence', async () => {
    const result = await api('/api/presence', {
      method: 'POST',
      cookie: viewerCookie,
      body: presencePayload,
    });
    assert.equal(result.status, 204);
    const peers = httpPresence.listPeers('test-harness');
    assert.equal(peers.length, 1);
    assert.equal(peers[0].displayName, 'Vi');
    assert.equal(peers[0].userId.length > 0, true);
  });

  await check('presence expires after thirty seconds', () => {
    let clock = 1_000;
    const registry = createPresenceRegistry({
      now: () => clock,
      broadcast: () => undefined,
      sweepIntervalMs: 60_000,
    });
    registry.updatePresence('expiry-session', {
      userId: 'user-expiry',
      displayName: 'Expiry',
      color: '#000000',
      ...presencePayload,
    });
    assert.equal(registry.listPeers('test-harness').length, 1);
    clock += 30_001;
    assert.equal(registry.listPeers('test-harness').length, 0);
    registry.dispose();
  });

  await check('presence broadcasts are coalesced per harness', async () => {
    const broadcasts: Array<{ harness: string; event: string; data: unknown }> = [];
    const registry = createPresenceRegistry({
      broadcast: (harness, event, data) => {
        broadcasts.push({ harness, event, data });
      },
      debounceMs: 25,
      sweepIntervalMs: 60_000,
    });
    for (let update = 0; update < 10; update += 1) {
      registry.updatePresence('coalesce-session', {
        userId: 'user-coalesce',
        displayName: 'Coalesce',
        color: '#ffffff',
        ...presencePayload,
        focus: { kind: 'connector', id: `con_${update}` },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(broadcasts.length, 1);
    assert.equal(broadcasts[0].harness, 'test-harness');
    assert.equal(broadcasts[0].event, 'presence');
    registry.dispose();
  });

  await check('SSE clients are removed after disconnect', async () => {
    const harness = `sse-${Date.now()}`;
    const connected = await new Promise<{
      request: http.ClientRequest;
      response: IncomingMessage;
    }>((resolve, reject) => {
      const request = http.get(
        `${baseUrl}/api/events?harness=${encodeURIComponent(harness)}`,
        (response) => {
          response.once('data', () => resolve({ request, response }));
          response.once('error', reject);
        },
      );
      request.once('error', reject);
    });
    assert.equal(clientCount(harness), 1);
    const firstId = broadcast(harness, 'rev', { rev: 1 });
    const secondId = broadcast(harness, 'rev', { rev: 2 });
    assert(firstId && secondId);
    assert(BigInt(secondId) > BigInt(firstId));
    connected.response.destroy();
    connected.request.destroy();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(clientCount(harness), 0);
  });
} finally {
  httpPresence.dispose();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} collaboration check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll collaboration auth, presence, and SSE checks passed.');
}
