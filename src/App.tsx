import { useEffect, useRef, useState } from 'react';
import { useHarnessStore, initAutoSave } from './store';
import { AppShell } from './components/layout/AppShell';
import { subscribeToChanges } from './lib/sync/transport';
import type {
  BackgroundLayouts,
  ConnectorLibrary,
  ConnectorTypeSizes,
  FreePortLayouts,
  HarnessData,
  JunctionLayouts,
  ManufacturingDocument,
  MergePointLayouts,
  NodeLayout,
  PortLayouts,
  RotationLayouts,
  SizeLayouts,
  SubsystemDocument,
  TextBoxLayouts,
  WaypointLayouts,
} from './types';
import type {
  CollaborationLayouts,
  CollaborationStateResponse,
} from './types/collab';

const USER_DATA_BASE = '/user-data';

interface LayoutFile extends Partial<CollaborationLayouts> {
  nodes?: NodeLayout;
  ports?: PortLayouts;
  sizes?: SizeLayouts;
  free?: FreePortLayouts;
  backgrounds?: BackgroundLayouts;
  connectorTypeSizes?: ConnectorTypeSizes;
  textBoxes?: TextBoxLayouts;
  waypoints?: WaypointLayouts;
  junctions?: JunctionLayouts;
  mergePoints?: MergePointLayouts;
  rotations?: RotationLayouts;
}

export default function App() {
  const activeHarnessName = useHarnessStore((s) => s.activeHarnessName);

  const [sessionReady, setSessionReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const autoSaveStarted = useRef(false);

  // The app remains in its safe logged-out/read-only state until this finishes.
  useEffect(() => {
    let cancelled = false;
    void useHarnessStore.getState().refreshSession().finally(() => {
      if (!cancelled) setSessionReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the shared connector library after session discovery. /api/library is
  // available in both the legacy and collaboration servers.
  useEffect(() => {
    if (!sessionReady) return;
    fetch('/api/library', { credentials: 'same-origin', cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load connector library: ${response.status}`);
        return response.json() as Promise<ConnectorLibrary>;
      })
      .catch(() => fetch(`${USER_DATA_BASE}/connectors/connector-library.json`)
        .then((response) => {
          if (!response.ok) throw new Error(`Failed to load connector library: ${response.status}`);
          return response.json() as Promise<ConnectorLibrary>;
        }))
      .then((library) => useHarnessStore.getState().loadConnectorLibrary(library))
      .catch(() => {
        // Non-fatal: connector types simply remain unresolved.
      });
  }, [sessionReady]);

  useEffect(() => {
    if (!sessionReady) return;
    fetch('/api/harnesses')
      .then((response) => response.json() as Promise<Array<{ id: string; name: string }>>)
      .then((harnesses) => {
        const store = useHarnessStore.getState();
        store.setAvailableHarnesses(harnesses);
        // The remembered harness can disappear (renamed or deleted on disk).
        // Move to a real one instead of failing to boot.
        const ids = harnesses.map((item) => item.id);
        if (ids.length > 0 && !ids.includes(store.activeHarnessName)) {
          store.setActiveHarnessName(ids.includes('fsae-car') ? 'fsae-car' : ids[0]);
        }
      })
      .catch(() => useHarnessStore.getState().setAvailableHarnesses([{ id: 'fsae-car', name: 'fsae-car' }]));
  }, [sessionReady]);

  useEffect(() => {
    if (!sessionReady) return;
    let cancelled = false;
    let stopTransport: (() => void) | null = null;
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
    });

    const nameParam = `?harness=${encodeURIComponent(activeHarnessName)}`;

    const applyLoadedState = (
      harness: HarnessData,
      layouts: LayoutFile,
      subsystemsInput: SubsystemDocument[] | Record<string, SubsystemDocument>,
      manufacturing: ManufacturingDocument,
    ) => {
      const store = useHarnessStore.getState();
      const subsystems = Array.isArray(subsystemsInput)
        ? subsystemsInput
        : Object.values(subsystemsInput);
      store.resetForHarnessSwitch();
      store.loadHarness(harness);
      store.loadLayouts(layouts.nodes ?? {});
      store.loadPortLayouts(layouts.ports ?? {});
      store.loadSizeLayouts(layouts.sizes ?? {});
      store.loadFreePortLayouts(layouts.free ?? {});
      store.loadBackgroundLayouts(layouts.backgrounds ?? {});
      store.loadConnectorTypeSizes(layouts.connectorTypeSizes ?? {});
      store.loadTextBoxLayouts(layouts.textBoxes ?? {});
      store.loadWaypointLayouts(layouts.waypoints ?? {});
      store.loadJunctionLayouts(layouts.junctions ?? {});
      store.loadMergePointLayouts(layouts.mergePoints ?? {});
      store.loadRotationLayouts(layouts.rotations ?? {});
      store.loadSubsystems(subsystems);
      store.loadManufacturing(manufacturing);
    };

    const loadLegacyState = async () => {
      const [harness, layouts, subsystems, manufacturing] = await Promise.all([
        fetch(`/api/harness${nameParam}`).then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to load harness '${activeHarnessName}': ${response.status}`);
          }
          return response.json() as Promise<HarnessData>;
        }),
        fetch(`/api/layouts${nameParam}&v=${Date.now()}`)
          .then((response) => (response.ok ? response.json() as Promise<LayoutFile> : {}))
          .catch(() => ({} as LayoutFile)),
        fetch(`/api/subsystems${nameParam}&v=${Date.now()}`)
          .then((response) => (
            response.ok ? response.json() as Promise<SubsystemDocument[]> : []
          ))
          .catch(() => [] as SubsystemDocument[]),
        fetch(`/api/manufacturing${nameParam}&v=${Date.now()}`)
          .then((response) => (response.ok
            ? response.json() as Promise<ManufacturingDocument>
            : { schema_version: '1.2.0' as const, bundles: {} }))
          .catch(() => ({ schema_version: '1.2.0' as const, bundles: {} })),
      ]);
      if (cancelled) return;
      applyLoadedState(harness, layouts, subsystems, manufacturing);
      useHarnessStore.getState().loadCollaborationMeta({
        serverRev: 0,
        libraryRev: 0,
        lastWriter: null,
        attribution: {},
        collabAvailable: false,
      });
    };

    const boot = async () => {
      const response = await fetch(`/api/state${nameParam}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (response.status === 404) {
        await loadLegacyState();
        return;
      }
      if (!response.ok) {
        throw new Error(`Failed to load collaboration state: ${response.status}`);
      }

      const state = await response.json() as CollaborationStateResponse;
      if (cancelled) return;
      applyLoadedState(
        state.harness,
        state.layouts as LayoutFile,
        state.subsystems,
        state.manufacturing,
      );
      const store = useHarnessStore.getState();
      if (state.connectorLibrary ?? state.library) {
        store.loadConnectorLibrary((state.connectorLibrary ?? state.library)!);
      }
      store.loadCollaborationMeta({
        serverRev: state.rev,
        libraryRev: state.libraryRev,
        lastWriter: state.lastWriter,
        attribution: state.attribution,
        collabAvailable: true,
      });
      stopTransport = subscribeToChanges({
        harness: activeHarnessName,
        since: state.rev,
        libraryRev: state.libraryRev,
        onRev: (payload) => {
          if (!cancelled) useHarnessStore.getState().applyRemoteSync(payload);
        },
        onPresence: (peers) => {
          if (!cancelled) useHarnessStore.getState().replacePeers(peers);
        },
        onStatus: (status) => {
          if (!cancelled) useHarnessStore.getState().setSyncStatus(status);
        },
        onUnavailable: () => {
          if (!cancelled) useHarnessStore.getState().setCollabAvailable(false);
        },
      });
    };

    void boot()
      .then(() => {
        if (cancelled) return;
        if (!autoSaveStarted.current) {
          autoSaveStarted.current = true;
          initAutoSave();
        }
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Failed to load harness state.');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      stopTransport?.();
    };
  }, [
    activeHarnessName,
    sessionReady,
  ]);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-zinc-950">
        <div className="text-zinc-400 text-sm animate-pulse">
          Loading harness data…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-zinc-950">
        <div className="text-red-400 text-sm max-w-md text-center">
          <p className="font-semibold mb-1">Failed to load</p>
          <p className="text-zinc-500">{error}</p>
        </div>
      </div>
    );
  }

  return <AppShell />;
}
