import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

export type Role = 'admin' | 'editor' | 'viewer';
export type RequiredRole = 'editor' | 'admin';

export interface User {
  id: string;
  login: string;
  displayName: string;
  role: Role;
  color: string;
  createdAt: string;
  createdBy: string;
}

export type PublicUser = Omit<User, 'login'>;

export interface ResolvedIdentity {
  user: User;
  sessionId: string;
}

export type RouteParams = Record<string, string>;
export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
  query: URLSearchParams,
) => void | Promise<void>;

export interface AuthOptions {
  stateDir?: string;
  now?: () => number;
  getClientIp?: (req: IncomingMessage) => string;
}

export interface AuthService {
  readonly handlers: {
    login: RouteHandler;
    logout: RouteHandler;
    me: RouteHandler;
    listUsers: RouteHandler;
    createUser: RouteHandler;
    updateUser: RouteHandler;
    deleteUser: RouteHandler;
  };
  resolveIdentity(req: IncomingMessage): ResolvedIdentity | null;
  resolveUser(req: IncomingMessage): User | null;
  requireRole(req: IncomingMessage, role: RequiredRole): User | null;
}

const COOKIE_NAME = 'vibewire_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const LOGIN_WINDOW_MS = 60_000;
const MAX_FAILED_LOGINS = 5;
/**
 * Everyone on a team shares one source IP behind a tunnel or NAT, so a per-IP
 * cap alone would let one person fat-fingering their name lock out the team.
 * Attempts are capped per (ip, login) first, with a looser per-ip ceiling that
 * still stops someone walking the namespace.
 */
const MAX_FAILED_LOGINS_PER_IP = 30;
const MAX_BODY_BYTES = 64 * 1_024;
const COLOR_PALETTE = [
  '#e11d48',
  '#2563eb',
  '#16a34a',
  '#9333ea',
  '#ea580c',
  '#0891b2',
  '#c026d3',
  '#4f46e5',
  '#65a30d',
  '#dc2626',
  '#0d9488',
  '#7c3aed',
] as const;

interface SessionPayload {
  userId: string;
  sessionId: string;
  expiresAt: number;
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data, null, 2));
}

function errorResponse(res: ServerResponse, message: string, status: number): void {
  json(res, { error: message }, status);
}

function noContent(res: ServerResponse): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  res.statusCode = 204;
  res.end();
}

async function parseBody(req: IncomingMessage): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_BODY_BYTES) {
        fail(new Error('Request body too large'));
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('aborted', () => fail(new Error('Request aborted')));
    req.on('error', (error) => fail(error));
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'editor' || value === 'viewer';
}

function isNonemptyString(value: unknown, maxLength = 200): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function withoutLogin(user: User): PublicUser {
  return {
    id: user.id,
    displayName: user.displayName,
    role: user.role,
    color: user.color,
    createdAt: user.createdAt,
    createdBy: user.createdBy,
  };
}

function parseCookies(header: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  if (!header) return result;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    try {
      result.set(key, decodeURIComponent(rawValue));
    } catch {
      // Ignore malformed cookie values.
    }
  }
  return result;
}

function defaultClientIp(req: IncomingMessage): string {
  // Behind cloudflared every request arrives from localhost, which would make
  // the rate limiter treat the whole team as a single client.
  const direct = req.headers['cf-connecting-ip'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const firstHop = forwardedValue?.split(',')[0]?.trim();
  if (firstHop) return firstHop;
  return req.socket.remoteAddress ?? 'unknown';
}

function isSecureRequest(req: IncomingMessage): boolean {
  const proto = req.headers['x-forwarded-proto'];
  const value = Array.isArray(proto) ? proto[0] : proto;
  return value?.split(',')[0]?.trim() === 'https';
}

export function createAuth(projectRoot: string, options: AuthOptions = {}): AuthService {
  const stateDir = options.stateDir ?? path.join(projectRoot, 'vibewire-state');
  const usersFile = path.join(stateDir, 'users.json');
  const secretFile = path.join(stateDir, 'secret.txt');
  const now = options.now ?? Date.now;
  const getClientIp = options.getClientIp ?? defaultClientIp;
  const failedLogins = new Map<string, number[]>();

  function ensureSecret(): Buffer {
    fs.mkdirSync(stateDir, { recursive: true });
    if (!fs.existsSync(secretFile)) {
      const generated = randomBytes(32).toString('hex');
      try {
        const descriptor = fs.openSync(secretFile, 'wx', 0o600);
        try {
          fs.writeFileSync(descriptor, generated + '\n', 'utf8');
        } finally {
          fs.closeSync(descriptor);
        }
      } catch (error) {
        const code = error instanceof Error && 'code' in error
          ? (error as NodeJS.ErrnoException).code
          : undefined;
        if (code !== 'EEXIST') throw error;
      }
    }
    fs.chmodSync(secretFile, 0o600);
    const encoded = fs.readFileSync(secretFile, 'utf8').trim();
    if (!/^[a-f0-9]{64}$/i.test(encoded)) {
      throw new Error('Invalid VibeWire session secret');
    }
    return Buffer.from(encoded, 'hex');
  }

  const secret = ensureSecret();

  function readUsers(): User[] {
    if (!fs.existsSync(usersFile)) return [];
    const parsed: unknown = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('Invalid users file');
    return parsed as User[];
  }

  function writeUsers(users: User[]): void {
    fs.mkdirSync(stateDir, { recursive: true });
    const temporary = `${usersFile}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(users, null, 2) + '\n', 'utf8');
      fs.renameSync(temporary, usersFile);
    } catch (error) {
      try {
        fs.unlinkSync(temporary);
      } catch {
        // The temporary file may not have been created.
      }
      throw error;
    }
  }

  function nextColor(users: User[]): string {
    const used = new Set(users.map((user) => user.color));
    return COLOR_PALETTE.find((color) => !used.has(color))
      ?? COLOR_PALETTE[users.length % COLOR_PALETTE.length];
  }

  function signSession(payload: SessionPayload): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = createHmac('sha256', secret).update(encoded).digest('base64url');
    return `${encoded}.${mac}`;
  }

  function verifySession(value: string): SessionPayload | null {
    const separator = value.indexOf('.');
    if (separator <= 0 || separator !== value.lastIndexOf('.')) return null;
    const encoded = value.slice(0, separator);
    const suppliedMac = value.slice(separator + 1);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[A-Za-z0-9_-]+$/.test(suppliedMac)) {
      return null;
    }

    const expected = createHmac('sha256', secret).update(encoded).digest();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(suppliedMac, 'base64url');
    } catch {
      return null;
    }
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return null;
    }

    try {
      const payload: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      if (
        !isObject(payload)
        || !isNonemptyString(payload.userId)
        || !isNonemptyString(payload.sessionId)
        || typeof payload.expiresAt !== 'number'
        || !Number.isFinite(payload.expiresAt)
        || payload.expiresAt <= now()
      ) {
        return null;
      }
      return {
        userId: payload.userId,
        sessionId: payload.sessionId,
        expiresAt: payload.expiresAt,
      };
    } catch {
      return null;
    }
  }

  function setSessionCookie(req: IncomingMessage, res: ServerResponse, user: User): void {
    const expiresAt = now() + SESSION_TTL_MS;
    const value = signSession({
      userId: user.id,
      sessionId: randomUUID(),
      expiresAt,
    });
    res.setHeader('Set-Cookie', [
      `${COOKIE_NAME}=${encodeURIComponent(value)}`,
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1_000)}`,
      `Expires=${new Date(expiresAt).toUTCString()}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      ...(isSecureRequest(req) ? ['Secure'] : []),
    ].join('; '));
  }

  function clearSessionCookie(res: ServerResponse): void {
    res.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; SameSite=Lax`,
    );
  }

  function trustedHeaderLogin(req: IncomingMessage): string | null | undefined {
    if (process.env.TRUST_IDENTITY_HEADER !== '1') return undefined;
    const value = req.headers['cf-access-authenticated-user-email'];
    if (value === undefined) return undefined;
    return typeof value === 'string' ? value : value[0] ?? null;
  }

  function resolveIdentity(req: IncomingMessage): ResolvedIdentity | null {
    try {
      const users = readUsers();
      const headerLogin = trustedHeaderLogin(req);
      if (headerLogin !== undefined) {
        if (headerLogin === null) return null;
        const user = users.find((candidate) => candidate.login === headerLogin);
        if (!user) return null;
        const fingerprint = createHash('sha256')
          .update(`${user.id}\0${getClientIp(req)}\0${req.headers['user-agent'] ?? ''}`)
          .digest('base64url')
          .slice(0, 24);
        return { user, sessionId: `sso_${fingerprint}` };
      }

      const cookie = parseCookies(req.headers.cookie).get(COOKIE_NAME);
      if (!cookie) return null;
      const session = verifySession(cookie);
      if (!session) return null;
      const user = users.find((candidate) => candidate.id === session.userId);
      return user ? { user, sessionId: session.sessionId } : null;
    } catch {
      return null;
    }
  }

  function resolveUser(req: IncomingMessage): User | null {
    return resolveIdentity(req)?.user ?? null;
  }

  function requireRole(req: IncomingMessage, role: RequiredRole): User | null {
    const user = resolveUser(req);
    if (!user) return null;
    if (role === 'admin') return user.role === 'admin' ? user : null;
    return user.role === 'admin' || user.role === 'editor' ? user : null;
  }

  function recentFailures(key: string): number[] {
    const cutoff = now() - LOGIN_WINDOW_MS;
    const recent = (failedLogins.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (recent.length > 0) failedLogins.set(key, recent);
    else failedLogins.delete(key);
    return recent;
  }

  function recordFailure(...keys: string[]): void {
    for (const key of keys) {
      const recent = recentFailures(key);
      recent.push(now());
      failedLogins.set(key, recent);
    }
  }

  async function loginHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: unknown;
    try {
      body = await parseBody(req);
    } catch {
      errorResponse(res, 'Invalid request body', 400);
      return;
    }
    if (!isObject(body) || !isNonemptyString(body.login)) {
      errorResponse(res, 'Invalid request body', 400);
      return;
    }

    const loginValue = body.login;
    const requestedDisplayName = isNonemptyString(body.displayName)
      ? body.displayName
      : null;
    const ip = getClientIp(req);
    const loginKey = `${ip}\u0000${loginValue}`;
    if (
      recentFailures(loginKey).length >= MAX_FAILED_LOGINS
      || recentFailures(ip).length >= MAX_FAILED_LOGINS_PER_IP
    ) {
      errorResponse(res, 'Too many login attempts', 429);
      return;
    }

    try {
      const users = readUsers();
      let user = users.find((candidate) => candidate.login === loginValue);
      let bootstrapped = false;

      // An empty roster is as unusable as a missing file, so both bootstrap.
      if (users.length === 0) {
        bootstrapped = true;
        const id = randomUUID();
        user = {
          id,
          login: loginValue,
          displayName: requestedDisplayName ?? 'Administrator',
          role: 'admin',
          color: nextColor(users),
          createdAt: new Date(now()).toISOString(),
          createdBy: id,
        };
        writeUsers([user]);
        console.warn(
          '\n'
          + '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n'
          + 'VIBEWIRE AUTH BOOTSTRAP: the first administrator was created.\n'
          + 'Create named team accounts and protect the state directory.\n'
          + '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n',
        );
      }

      if (!user) {
        recordFailure(loginKey, ip);
        errorResponse(res, 'Invalid login', 401);
        return;
      }

      failedLogins.delete(loginKey);
      failedLogins.delete(ip);
      setSessionCookie(req, res, user);
      json(res, { user: withoutLogin(user), bootstrap: bootstrapped });
    } catch {
      errorResponse(res, 'Authentication unavailable', 500);
    }
  }

  function logoutHandler(_req: IncomingMessage, res: ServerResponse): void {
    clearSessionCookie(res);
    noContent(res);
  }

  function meHandler(req: IncomingMessage, res: ServerResponse): void {
    const user = resolveUser(req);
    json(res, { user: user ? withoutLogin(user) : null });
  }

  function requireAdmin(req: IncomingMessage, res: ServerResponse): User | null {
    const user = requireRole(req, 'admin');
    if (!user) errorResponse(res, 'Forbidden', 403);
    return user;
  }

  function listUsersHandler(req: IncomingMessage, res: ServerResponse): void {
    if (!requireAdmin(req, res)) return;
    try {
      json(res, readUsers().map(withoutLogin));
    } catch {
      errorResponse(res, 'User data unavailable', 500);
    }
  }

  async function createUserHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Any signed-in teammate can invite members. Creating admins stays
    // administrator-only so a viewer cannot escalate the roster.
    const actor = resolveUser(req);
    if (!actor) {
      errorResponse(res, 'Forbidden', 403);
      return;
    }

    let body: unknown;
    try {
      body = await parseBody(req);
    } catch {
      errorResponse(res, 'Invalid request body', 400);
      return;
    }
    if (
      !isObject(body)
      || !isNonemptyString(body.login)
      || !isNonemptyString(body.displayName)
      || !isRole(body.role)
    ) {
      errorResponse(res, 'Invalid user data', 400);
      return;
    }
    if (body.role === 'admin' && actor.role !== 'admin') {
      errorResponse(res, 'Forbidden', 403);
      return;
    }

    try {
      const users = readUsers();
      if (users.some((user) => user.login === body.login)) {
        errorResponse(res, 'Login already exists', 409);
        return;
      }
      const user: User = {
        id: randomUUID(),
        login: body.login,
        displayName: body.displayName,
        role: body.role,
        color: nextColor(users),
        createdAt: new Date(now()).toISOString(),
        createdBy: actor.id,
      };
      writeUsers([...users, user]);
      json(res, { user }, 201);
    } catch {
      errorResponse(res, 'User data unavailable', 500);
    }
  }

  async function updateUserHandler(
    req: IncomingMessage,
    res: ServerResponse,
    params: RouteParams,
  ): Promise<void> {
    if (!requireAdmin(req, res)) return;

    let body: unknown;
    try {
      body = await parseBody(req);
    } catch {
      errorResponse(res, 'Invalid request body', 400);
      return;
    }
    if (!isObject(body)) {
      errorResponse(res, 'Invalid user data', 400);
      return;
    }
    if (
      (body.login !== undefined && !isNonemptyString(body.login))
      || (body.displayName !== undefined && !isNonemptyString(body.displayName))
      || (body.role !== undefined && !isRole(body.role))
      || (
        body.login === undefined
        && body.displayName === undefined
        && body.role === undefined
      )
    ) {
      errorResponse(res, 'Invalid user data', 400);
      return;
    }

    try {
      const users = readUsers();
      const index = users.findIndex((user) => user.id === params.id);
      if (index === -1) {
        errorResponse(res, 'User not found', 404);
        return;
      }
      if (
        typeof body.login === 'string'
        && users.some((user, candidateIndex) =>
          candidateIndex !== index && user.login === body.login
        )
      ) {
        errorResponse(res, 'Login already exists', 409);
        return;
      }
      if (
        users[index].role === 'admin'
        && body.role !== undefined
        && body.role !== 'admin'
        && users.filter((user) => user.role === 'admin').length === 1
      ) {
        errorResponse(res, 'Cannot demote the last administrator', 409);
        return;
      }

      const user: User = {
        ...users[index],
        ...(typeof body.login === 'string' ? { login: body.login } : {}),
        ...(typeof body.displayName === 'string' ? { displayName: body.displayName } : {}),
        ...(isRole(body.role) ? { role: body.role } : {}),
      };
      users[index] = user;
      writeUsers(users);
      json(res, { user });
    } catch {
      errorResponse(res, 'User data unavailable', 500);
    }
  }

  function deleteUserHandler(
    req: IncomingMessage,
    res: ServerResponse,
    params: RouteParams,
  ): void {
    if (!requireAdmin(req, res)) return;
    try {
      const users = readUsers();
      const index = users.findIndex((user) => user.id === params.id);
      if (index === -1) {
        errorResponse(res, 'User not found', 404);
        return;
      }
      if (
        users[index].role === 'admin'
        && users.filter((user) => user.role === 'admin').length === 1
      ) {
        errorResponse(res, 'Cannot delete the last administrator', 409);
        return;
      }
      users.splice(index, 1);
      writeUsers(users);
      noContent(res);
    } catch {
      errorResponse(res, 'User data unavailable', 500);
    }
  }

  return {
    handlers: {
      login: loginHandler,
      logout: logoutHandler,
      me: meHandler,
      listUsers: listUsersHandler,
      createUser: createUserHandler,
      updateUser: updateUserHandler,
      deleteUser: deleteUserHandler,
    },
    resolveIdentity,
    resolveUser,
    requireRole,
  };
}
