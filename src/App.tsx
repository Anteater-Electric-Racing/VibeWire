import { useEffect, useRef, useState } from 'react';
import { useHarnessStore, initAutoSave } from './store';
import { AppShell } from './components/layout/AppShell';
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

const USER_DATA_BASE = '/user-data';

interface LayoutFile {
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
  const loadHarness = useHarnessStore((s) => s.loadHarness);
  const loadConnectorLibrary = useHarnessStore((s) => s.loadConnectorLibrary);
  const loadLayouts = useHarnessStore((s) => s.loadLayouts);
  const loadPortLayouts = useHarnessStore((s) => s.loadPortLayouts);
  const loadSizeLayouts = useHarnessStore((s) => s.loadSizeLayouts);
  const loadFreePortLayouts = useHarnessStore((s) => s.loadFreePortLayouts);
  const loadBackgroundLayouts = useHarnessStore((s) => s.loadBackgroundLayouts);
  const loadConnectorTypeSizes = useHarnessStore((s) => s.loadConnectorTypeSizes);
  const loadTextBoxLayouts = useHarnessStore((s) => s.loadTextBoxLayouts);
  const loadWaypointLayouts = useHarnessStore((s) => s.loadWaypointLayouts);
  const loadJunctionLayouts = useHarnessStore((s) => s.loadJunctionLayouts);
  const loadMergePointLayouts = useHarnessStore((s) => s.loadMergePointLayouts);
  const loadRotationLayouts = useHarnessStore((s) => s.loadRotationLayouts);
  const loadSubsystems = useHarnessStore((s) => s.loadSubsystems);
  const loadManufacturing = useHarnessStore((s) => s.loadManufacturing);
  const resetForHarnessSwitch = useHarnessStore((s) => s.resetForHarnessSwitch);
  const setAvailableHarnesses = useHarnessStore((s) => s.setAvailableHarnesses);
  const activeHarnessName = useHarnessStore((s) => s.activeHarnessName);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const autoSaveStarted = useRef(false);

  // Load connector library once — it is shared across all harnesses
  useEffect(() => {
    fetch(`${USER_DATA_BASE}/connectors/connector-library.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load connector library: ${r.status}`);
        return r.json() as Promise<ConnectorLibrary>;
      })
      .then(loadConnectorLibrary)
      .catch(() => {
        // Non-fatal: app still works without the library (connector types just won't resolve)
      });
  }, [loadConnectorLibrary]);

  // Fetch harness list once on mount
  useEffect(() => {
    fetch('/api/harnesses')
      .then((r) => r.json() as Promise<string[]>)
      .then(setAvailableHarnesses)
      .catch(() => setAvailableHarnesses(['fsae-car']));
  }, [setAvailableHarnesses]);

  // Load harness + its layouts whenever the active harness changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const nameParam = `?harness=${encodeURIComponent(activeHarnessName)}`;

    Promise.all([
      fetch(`/api/harness${nameParam}`).then((r) => {
        if (!r.ok) throw new Error(`Failed to load harness '${activeHarnessName}': ${r.status}`);
        return r.json() as Promise<HarnessData>;
      }),
      fetch(`/api/layouts${nameParam}&v=${Date.now()}`)
        .then((r) => (r.ok ? (r.json() as Promise<LayoutFile>) : {}))
        .catch(() => ({}) as LayoutFile),
      fetch(`/api/subsystems${nameParam}&v=${Date.now()}`)
        .then((r) => (r.ok ? (r.json() as Promise<SubsystemDocument[]>) : []))
        .catch(() => [] as SubsystemDocument[]),
      fetch(`/api/manufacturing${nameParam}&v=${Date.now()}`)
        .then((r) => (r.ok
          ? (r.json() as Promise<ManufacturingDocument>)
          : { schema_version: '1.1.0' as const, bundles: {} }))
        .catch(() => ({ schema_version: '1.1.0' as const, bundles: {} })),
    ])
      .then(([harness, layouts, subsystems, manufacturing]) => {
        if (cancelled) return;
        resetForHarnessSwitch();
        loadHarness(harness);
        const lf = layouts as LayoutFile;
        loadLayouts(lf.nodes ?? {});
        loadPortLayouts(lf.ports ?? {});
        loadSizeLayouts(lf.sizes ?? {});
        loadFreePortLayouts(lf.free ?? {});
        loadBackgroundLayouts(lf.backgrounds ?? {});
        loadConnectorTypeSizes(lf.connectorTypeSizes ?? {});
        loadTextBoxLayouts(lf.textBoxes ?? {});
        loadWaypointLayouts(lf.waypoints ?? {});
        loadJunctionLayouts(lf.junctions ?? {});
        loadMergePointLayouts(lf.mergePoints ?? {});
        loadRotationLayouts(lf.rotations ?? {});
        loadSubsystems(subsystems);
        loadManufacturing(manufacturing);
        if (!autoSaveStarted.current) {
          autoSaveStarted.current = true;
          initAutoSave();
        }
        setLoading(false);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeHarnessName,
    resetForHarnessSwitch,
    loadHarness,
    loadLayouts,
    loadPortLayouts,
    loadSizeLayouts,
    loadFreePortLayouts,
    loadBackgroundLayouts,
    loadConnectorTypeSizes,
    loadTextBoxLayouts,
    loadWaypointLayouts,
    loadJunctionLayouts,
    loadMergePointLayouts,
    loadRotationLayouts,
    loadSubsystems,
    loadManufacturing,
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
