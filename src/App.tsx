import { useEffect, useRef, useState } from 'react';
import { useSystemStore, initAutoSave } from './store';
import { AppShell } from './components/layout/AppShell';
import { subscribeToChanges } from './lib/sync/transport';
import { normalizeCollaborationDocument } from './lib/systemNormalize';
import type {
  BackgroundLayouts,
  ConnectorLibrary,
  ConnectorTypeSizes,
  FreePortLayouts,
  SystemData,
  SharedAnchorLayouts,
  ManufacturingDocument,
  BranchPointLayouts,
  NodeLayout,
  PortLayouts,
  RotationLayouts,
  RouteStyleLayouts,
  SizeLayouts,
  SubsystemDocument,
  TextBoxLayouts,
  ViewRouteStyleLayouts,
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
  /** Compatibility read for pre-Shared-Anchor layout files. */
  junctions?: SharedAnchorLayouts;
  branchPoints?: BranchPointLayouts;
  rotations?: RotationLayouts;
  routeStyles?: RouteStyleLayouts;
  viewRouteStyles?: ViewRouteStyleLayouts;
}

export default function App() {
  const activeSystemName = useSystemStore((s) => s.activeSystemName);

  const [sessionReady, setSessionReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const autoSaveStarted = useRef(false);

  // The app remains in its safe logged-out/read-only state until this finishes.
  useEffect(() => {
    let cancelled = false;
    void useSystemStore.getState().refreshSession().finally(() => {
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
      .then((library) => useSystemStore.getState().loadConnectorLibrary(library))
      .catch(() => {
        // Non-fatal: connector types simply remain unresolved.
      });
  }, [sessionReady]);

  useEffect(() => {
    if (!sessionReady) return;
    fetch('/api/systems')
      .then((response) => response.json() as Promise<Array<{ id: string; name: string }>>)
      .then((systems) => {
        const store = useSystemStore.getState();
        store.setAvailableSystems(systems);
        // The remembered system can disappear (renamed or deleted on disk).
        // Move to a real one instead of failing to boot.
        const ids = systems.map((item) => item.id);
        if (ids.length > 0 && !ids.includes(store.activeSystemName)) {
          store.setActiveSystemName(ids.includes('fsae-car') ? 'fsae-car' : ids[0]);
        }
      })
      .catch(() => useSystemStore.getState().setAvailableSystems([{ id: 'fsae-car', name: 'fsae-car' }]));
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

    const nameParam = `?system=${encodeURIComponent(activeSystemName)}`;

    const applyLoadedState = (
      system: SystemData,
      layouts: LayoutFile,
      subsystemsInput: SubsystemDocument[] | Record<string, SubsystemDocument>,
      manufacturing: ManufacturingDocument,
    ) => {
      const store = useSystemStore.getState();
      const subsystems = Array.isArray(subsystemsInput)
        ? subsystemsInput
        : Object.values(subsystemsInput);
      store.resetForSystemSwitch();
      store.loadSystem(system);
      store.loadLayouts(layouts.nodes ?? {});
      store.loadPortLayouts(layouts.ports ?? {});
      store.loadSizeLayouts(layouts.sizes ?? {});
      store.loadFreePortLayouts(layouts.free ?? {});
      store.loadImageLayouts(layouts.images ?? {}, layouts.backgrounds ?? {});
      store.loadConnectorTypeSizes(layouts.connectorTypeSizes ?? {});
      store.loadTextBoxLayouts(layouts.textBoxes ?? {});
      store.loadWaypointLayouts(layouts.waypoints ?? {});
      store.loadSharedAnchorLayouts(layouts.sharedAnchors ?? layouts.junctions ?? {});
      store.loadBranchPointLayouts(layouts.branchPoints ?? {});
      store.loadRotationLayouts(layouts.rotations ?? {});
      store.loadRouteStyleLayouts(layouts.routeStyles ?? {});
      store.loadViewRouteStyleLayouts(layouts.viewRouteStyles ?? {});
      store.loadSubsystems(subsystems);
      store.loadManufacturing(manufacturing);
    };

    const loadLegacyState = async () => {
      const [system, layouts, subsystems, manufacturing] = await Promise.all([
        fetch(`/api/system${nameParam}`).then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to load system '${activeSystemName}': ${response.status}`);
          }
          return response.json() as Promise<SystemData>;
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
      applyLoadedState(system, layouts, subsystems, manufacturing);
      useSystemStore.getState().loadCollaborationMeta({
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

      const raw = await response.json() as CollaborationStateResponse & { harness?: SystemData };
      if (cancelled) return;
      const documents = normalizeCollaborationDocument(raw);
      const loadedSystem = documents.system ?? raw.system;
      if (!loadedSystem) {
        throw new Error('Collaboration state did not include a system document.');
      }
      applyLoadedState(
        loadedSystem,
        (documents.layouts && !('patch' in documents.layouts)
          ? documents.layouts
          : raw.layouts) as LayoutFile,
        documents.subsystems && !('patch' in documents.subsystems)
          ? documents.subsystems
          : raw.subsystems ?? {},
        documents.manufacturing && !('patch' in documents.manufacturing)
          ? documents.manufacturing
          : raw.manufacturing ?? { schema_version: '1.2.0', bundles: {} },
      );
      const store = useSystemStore.getState();
      if (documents.connectorLibrary ?? documents.library ?? raw.connectorLibrary ?? raw.library) {
        store.loadConnectorLibrary(
          (documents.connectorLibrary ?? documents.library ?? raw.connectorLibrary ?? raw.library)!,
        );
      }
      store.loadCollaborationMeta({
        serverRev: raw.rev,
        libraryRev: raw.libraryRev,
        lastWriter: raw.lastWriter,
        attribution: raw.attribution,
        collabAvailable: true,
      });
      stopTransport = subscribeToChanges({
        system: activeSystemName,
        since: raw.rev,
        libraryRev: raw.libraryRev,
        onRev: (payload) => {
          if (!cancelled) useSystemStore.getState().applyRemoteSync(payload);
        },
        onPresence: (peers) => {
          if (!cancelled) useSystemStore.getState().replacePeers(peers);
        },
        onStatus: (status) => {
          if (!cancelled) useSystemStore.getState().setSyncStatus(status);
        },
        onUnavailable: () => {
          if (!cancelled) useSystemStore.getState().setCollabAvailable(false);
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
          setError(caught instanceof Error ? caught.message : 'Failed to load system state.');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      stopTransport?.();
    };
  }, [
    activeSystemName,
    sessionReady,
  ]);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-zinc-950">
        <div className="text-zinc-400 text-sm animate-pulse">
          Loading system data…
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
