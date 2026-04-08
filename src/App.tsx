import { useEffect, useState } from 'react';
import { useHarnessStore } from './store';
import { AppShell } from './components/layout/AppShell';
import type { HarnessData, ConnectorLibrary, NodeLayout, PortLayouts, SizeLayouts, FreePortLayouts, BackgroundLayouts, ConnectorTypeSizes } from './types';

interface LayoutFile {
  nodes?: NodeLayout;
  ports?: PortLayouts;
  sizes?: SizeLayouts;
  free?: FreePortLayouts;
  backgrounds?: BackgroundLayouts;
  connectorTypeSizes?: ConnectorTypeSizes;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/harnesses/fsae-car.json').then((r) => {
        if (!r.ok) throw new Error(`Failed to load harness: ${r.status}`);
        return r.json() as Promise<HarnessData>;
      }),
      fetch('/connector-library.json').then((r) => {
        if (!r.ok) throw new Error(`Failed to load connector library: ${r.status}`);
        return r.json() as Promise<ConnectorLibrary>;
      }),
      fetch('/layouts.json')
        .then((r) => (r.ok ? (r.json() as Promise<LayoutFile>) : {}))
        .catch(() => ({}) as LayoutFile),
    ])
      .then(([harness, library, layouts]) => {
        loadHarness(harness);
        loadConnectorLibrary(library);
        const lf = layouts as LayoutFile;
        loadLayouts(lf.nodes ?? {});
        loadPortLayouts(lf.ports ?? {});
        loadSizeLayouts(lf.sizes ?? {});
        loadFreePortLayouts(lf.free ?? {});
        loadBackgroundLayouts(lf.backgrounds ?? {});
        loadConnectorTypeSizes(lf.connectorTypeSizes ?? {});
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [loadHarness, loadConnectorLibrary, loadLayouts, loadPortLayouts, loadSizeLayouts, loadFreePortLayouts, loadBackgroundLayouts, loadConnectorTypeSizes]);

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
