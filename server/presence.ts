import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService, RouteHandler } from './auth.js';
import { broadcast as broadcastSse } from './sse.js';

export type PresenceTargetKind =
  | 'enclosure'
  | 'connector'
  | 'branchPoint'
  | 'path'
  | 'signal'
  | 'harnessBundle'
  | 'connectorType'
  | 'subsystem'
  | 'textBox'
  | 'image';

export interface PresenceTarget {
  kind: PresenceTargetKind;
  id: string;
  field?: string;
}

export interface PeerPresence {
  sessionId: string;
  userId: string;
  displayName: string;
  color: string;
  system: string;
  appView: 'canvas' | 'connectorLibrary' | 'signalLibrary' | 'manufacturing';
  editingSurface: 'hierarchy' | 'subsystem';
  openEnclosureId: string | null;
  activeSubsystemId: string | null;
  focus: PresenceTarget | null;
  editing: PresenceTarget | null;
  lastSeen: number;
}

export type PresenceUpdate = Omit<PeerPresence, 'sessionId' | 'lastSeen'>;

export interface PresenceRegistryOptions {
  now?: () => number;
  broadcast?: (system: string, event: string, data: unknown) => unknown;
  expiryMs?: number;
  debounceMs?: number;
  sweepIntervalMs?: number;
}

export interface PresenceRegistry {
  updatePresence(sessionId: string, payload: PresenceUpdate): PeerPresence;
  listPeers(system: string): PeerPresence[];
  sweep(): void;
  dispose(): void;
}

const DEFAULT_EXPIRY_MS = 30_000;
const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_SWEEP_INTERVAL_MS = 5_000;
const MAX_BODY_BYTES = 64 * 1_024;
const TARGET_KINDS = new Set<PresenceTargetKind>([
  'enclosure',
  'connector',
  'branchPoint',
  'path',
  'signal',
  'harnessBundle',
  'connectorType',
  'subsystem',
  'textBox',
  'image',
]);

const LEGACY_TARGET_KIND = new Map<string, PresenceTargetKind>([
  ['bundle', 'harnessBundle'],
  ['harness', 'harnessBundle'],
  ['mergePoint', 'branchPoint'],
]);

function clonePeer(peer: PeerPresence): PeerPresence {
  return {
    ...peer,
    focus: peer.focus ? { ...peer.focus } : null,
    editing: peer.editing ? { ...peer.editing } : null,
  };
}

export function createPresenceRegistry(
  options: PresenceRegistryOptions = {},
): PresenceRegistry {
  const now = options.now ?? Date.now;
  const broadcast = options.broadcast ?? broadcastSse;
  const expiryMs = options.expiryMs ?? DEFAULT_EXPIRY_MS;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const peers = new Map<string, PeerPresence>();
  const pendingBroadcasts = new Map<string, NodeJS.Timeout>();
  let disposed = false;

  function peersForSystem(system: string): PeerPresence[] {
    return [...peers.values()]
      .filter((peer) => peer.system === system)
      .sort((left, right) =>
        left.displayName.localeCompare(right.displayName)
        || left.sessionId.localeCompare(right.sessionId)
      )
      .map(clonePeer);
  }

  function scheduleBroadcast(system: string): void {
    if (disposed || pendingBroadcasts.has(system)) return;
    const timer = setTimeout(() => {
      pendingBroadcasts.delete(system);
      if (disposed) return;
      try {
        broadcast(system, 'presence', { peers: peersForSystem(system) });
      } catch {
        // Presence and broken live connections must never affect request handling.
      }
    }, debounceMs);
    timer.unref();
    pendingBroadcasts.set(system, timer);
  }

  function sweep(): void {
    if (disposed) return;
    const cutoff = now() - expiryMs;
    const changedSystems = new Set<string>();
    for (const [sessionId, peer] of peers) {
      if (peer.lastSeen < cutoff) {
        peers.delete(sessionId);
        changedSystems.add(peer.system);
      }
    }
    for (const system of changedSystems) scheduleBroadcast(system);
  }

  function updatePresence(sessionId: string, payload: PresenceUpdate): PeerPresence {
    if (disposed) throw new Error('Presence registry has been disposed');
    const previous = peers.get(sessionId);
    const peer: PeerPresence = {
      ...payload,
      focus: payload.focus ? { ...payload.focus } : null,
      editing: payload.editing ? { ...payload.editing } : null,
      sessionId,
      lastSeen: now(),
    };
    peers.set(sessionId, peer);
    if (previous && previous.system !== peer.system) {
      scheduleBroadcast(previous.system);
    }
    scheduleBroadcast(peer.system);
    return clonePeer(peer);
  }

  function listPeers(system: string): PeerPresence[] {
    sweep();
    return peersForSystem(system);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    clearInterval(sweepTimer);
    for (const timer of pendingBroadcasts.values()) clearTimeout(timer);
    pendingBroadcasts.clear();
    peers.clear();
  }

  const sweepTimer = setInterval(sweep, sweepIntervalMs);
  sweepTimer.unref();

  return { updatePresence, listPeers, sweep, dispose };
}

const defaultRegistry = createPresenceRegistry();

export function updatePresence(
  sessionId: string,
  payload: PresenceUpdate,
): PeerPresence {
  return defaultRegistry.updatePresence(sessionId, payload);
}

export function listPeers(system: string): PeerPresence[] {
  return defaultRegistry.listPeers(system);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown, maxLength = 200): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function nullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

/**
 * The only presence compatibility boundary. Old clients may still send
 * bundle/harness/mergePoint target kinds; everything stored and broadcast
 * beyond this function is canonical.
 */
export function normalizePresenceTargetBoundary(
  value: unknown,
): PresenceTarget | null | undefined {
  if (value === null) return null;
  if (!isObject(value)) return undefined;
  const rawKind = value.kind;
  const kind = typeof rawKind === 'string'
    ? LEGACY_TARGET_KIND.get(rawKind) ?? rawKind
    : rawKind;
  if (
    !TARGET_KINDS.has(kind as PresenceTargetKind)
    || !isString(value.id)
    || (value.field !== undefined && !isString(value.field))
  ) {
    return undefined;
  }
  return {
    kind: kind as PresenceTargetKind,
    id: value.id,
    ...(typeof value.field === 'string' ? { field: value.field } : {}),
  };
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
    req.on('error', fail);
  });
}

function jsonError(res: ServerResponse, message: string, status: number): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: message }, null, 2));
}

export function createPresenceHandler(
  auth: Pick<AuthService, 'resolveIdentity'>,
  registry: PresenceRegistry = defaultRegistry,
): RouteHandler {
  return async function presenceHandler(req, res): Promise<void> {
    const identity = auth.resolveIdentity(req);
    if (!identity) {
      jsonError(res, 'Authentication required', 401);
      return;
    }

    let body: unknown;
    try {
      body = await parseBody(req);
    } catch {
      jsonError(res, 'Invalid request body', 400);
      return;
    }

    if (
      !isObject(body)
      || !isString(body.system ?? body.harness)
      || (
        body.appView !== 'canvas'
        && body.appView !== 'connectorLibrary'
        && body.appView !== 'signalLibrary'
        && body.appView !== 'manufacturing'
      )
      || (body.editingSurface !== 'hierarchy' && body.editingSurface !== 'subsystem')
      || !nullableString(body.openEnclosureId)
      || !nullableString(body.activeSubsystemId)
    ) {
      jsonError(res, 'Invalid presence data', 400);
      return;
    }

    const focus = normalizePresenceTargetBoundary(body.focus);
    const editing = normalizePresenceTargetBoundary(body.editing);
    if (focus === undefined || editing === undefined) {
      jsonError(res, 'Invalid presence data', 400);
      return;
    }

    registry.updatePresence(identity.sessionId, {
      userId: identity.user.id,
      displayName: identity.user.displayName,
      color: identity.user.color,
      // Top-level `harness` is accepted only here for pre-System clients.
      system: (body.system ?? body.harness) as string,
      appView: body.appView,
      editingSurface: body.editingSurface,
      openEnclosureId: body.openEnclosureId,
      activeSubsystemId: body.activeSubsystemId,
      focus,
      editing,
    });
    if (res.headersSent || res.writableEnded || res.destroyed) return;
    res.statusCode = 204;
    res.end();
  };
}
