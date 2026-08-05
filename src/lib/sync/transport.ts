import type {
  ConnectorLibrary,
} from '../../types';
import type {
  PeerPresence,
  RevisionEvent,
  SyncPayload,
  SyncStatus,
} from '../../types/collab';

const POLL_INTERVAL_MS = 20_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 20_000;

export interface ChangeSubscriptionOptions {
  harness: string;
  since?: number;
  libraryRev?: number;
  onRev: (payload: SyncPayload) => void | Promise<void>;
  onPresence: (peers: PeerPresence[]) => void;
  onStatus: (status: SyncStatus) => void;
  onUnavailable?: () => void;
}

export type UnsubscribeFromChanges = () => void;

function hasChangedState(payload: SyncPayload): boolean {
  if (payload.full) return true;
  if (!payload.changed) return false;
  return Object.keys(payload.changed).length > 0;
}

export function subscribeToChanges({
  harness,
  since = 0,
  libraryRev = 0,
  onRev,
  onPresence,
  onStatus,
  onUnavailable,
}: ChangeSubscriptionOptions): UnsubscribeFromChanges {
  let stopped = false;
  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let currentRev = since;
  let currentLibraryRev = libraryRev;
  let requestedLibraryRev = libraryRev;
  let latestLibraryEvent: RevisionEvent | null = null;
  let reconnectDelay = RECONNECT_MIN_MS;
  let sseLive = false;
  let syncRequest: Promise<void> | null = null;
  let status: SyncStatus | null = null;
  let libraryRequest: Promise<void> | null = null;

  const reportStatus = (next: SyncStatus) => {
    if (status === next || stopped) return;
    status = next;
    onStatus(next);
  };

  const requestLibrary = (
    targetRev: number,
    revision: RevisionEvent | null = null,
  ): Promise<void> => {
    requestedLibraryRev = Math.max(requestedLibraryRev, targetRev);
    if (revision) latestLibraryEvent = revision;
    if (libraryRequest) return libraryRequest;
    const request = (async () => {
      while (!stopped && currentLibraryRev < requestedLibraryRev) {
        const expectedRev = requestedLibraryRev;
        const event = latestLibraryEvent;
        const response = await fetch('/api/library', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error(`Library sync failed: ${response.status}`);
        }
        const library = await response.json() as ConnectorLibrary;
        await onRev({
          rev: currentRev,
          libraryRev: expectedRev,
          full: false,
          changed: { library },
          kind: 'library',
          by: event?.by ?? null,
          changedEntityIds: event?.changedEntityIds ?? [],
        });
        currentLibraryRev = expectedRev;
      }
    })()
      .catch(() => {
        if (!sseLive) reportStatus('offline');
      })
      .finally(() => {
        if (libraryRequest === request) libraryRequest = null;
      });
    libraryRequest = request;
    return request;
  };

  const requestSync = (): Promise<void> => {
    if (syncRequest) return syncRequest;
    const name = encodeURIComponent(harness);
    const request = fetch(`/api/sync?harness=${name}&since=${currentRev}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(async (response) => {
        if (response.status === 404) {
          reportStatus('offline');
          onUnavailable?.();
          stopped = true;
          sseLive = false;
          eventSource?.close();
          if (reconnectTimer) clearTimeout(reconnectTimer);
          if (pollTimer) clearInterval(pollTimer);
          throw new Error('Collaboration sync is unavailable.');
        }
        if (!response.ok) {
          throw new Error(`Sync request failed: ${response.status}`);
        }
        const payload = await response.json() as SyncPayload;
        if (!Number.isFinite(payload.rev)) {
          throw new Error('Sync response did not include a revision.');
        }
        if (
          typeof payload.libraryRev === 'number'
          && payload.libraryRev > currentLibraryRev
        ) {
          await requestLibrary(payload.libraryRev);
        }
        if (payload.rev > currentRev || hasChangedState(payload)) {
          await onRev(payload);
          currentRev = Math.max(currentRev, payload.rev);
        }
        if (!sseLive) reportStatus('polling');
      })
      .catch(() => {
        if (!sseLive) reportStatus('offline');
      })
      .finally(() => {
        if (syncRequest === request) syncRequest = null;
      });
    syncRequest = request;
    return request;
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer || typeof EventSource === 'undefined') return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      openEventSource();
    }, reconnectDelay);
    reconnectDelay = Math.min(RECONNECT_MAX_MS, reconnectDelay * 2);
  };

  const openEventSource = () => {
    if (stopped || typeof EventSource === 'undefined') {
      reportStatus('polling');
      return;
    }
    eventSource?.close();
    const name = encodeURIComponent(harness);
    eventSource = new EventSource(`/api/events?harness=${name}&since=${currentRev}`, {
      withCredentials: true,
    });
    eventSource.onopen = () => {
      sseLive = true;
      reconnectDelay = RECONNECT_MIN_MS;
      reportStatus('live');
    };
    eventSource.onerror = () => {
      sseLive = false;
      eventSource?.close();
      eventSource = null;
      reportStatus('polling');
      scheduleReconnect();
    };
    eventSource.addEventListener('rev', (rawEvent) => {
      const event = rawEvent as MessageEvent<string>;
      try {
        const revision = JSON.parse(event.data) as RevisionEvent;
        if (revision.kind === 'library') {
          void requestLibrary(revision.rev, revision);
        } else if (revision.rev > currentRev) {
          void requestSync();
        }
      } catch {
        void requestSync();
      }
    });
    eventSource.addEventListener('presence', (rawEvent) => {
      const event = rawEvent as MessageEvent<string>;
      try {
        const body = JSON.parse(event.data) as { peers?: PeerPresence[] };
        onPresence(Array.isArray(body.peers) ? body.peers : []);
      } catch {
        // A malformed presence packet must not interrupt document sync.
      }
    });
  };

  reportStatus('polling');
  openEventSource();
  pollTimer = setInterval(() => {
    void requestSync();
  }, POLL_INTERVAL_MS);

  return () => {
    stopped = true;
    sseLive = false;
    eventSource?.close();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pollTimer) clearInterval(pollTimer);
    eventSource = null;
    reconnectTimer = null;
    pollTimer = null;
  };
}
