import { Topbar } from './Topbar';
import { SettingsModal } from './SettingsModal';
import { GraphView } from '../graph/GraphView';
import { TreeView } from '../tree/TreeView';
import { TagFilterPanel } from '../filters/TagFilterPanel';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { useHarnessStore } from '../../store';

export function AppShell() {
  const selectedItem = useHarnessStore((s) => s.selectedItem);
  const selectedBundle = useHarnessStore((s) => s.selectedBundle);
  const showInspector = !!(selectedItem || (selectedBundle && selectedBundle.length > 0));

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      <Topbar />
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar: tree + filters */}
        <aside className="w-56 shrink-0 border-r border-zinc-800 bg-zinc-900 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <TreeView />
          </div>
          <div className="border-t border-zinc-800 overflow-y-auto max-h-[40%]">
            <TagFilterPanel />
          </div>
        </aside>

        {/* Center: graph canvas */}
        <main className="flex-1 min-w-0">
          <GraphView />
        </main>

        {/* Right sidebar: inspector */}
        {showInspector && (
          <aside className="w-64 shrink-0 border-l border-zinc-800 bg-zinc-900 overflow-hidden">
            <InspectorPanel />
          </aside>
        )}
      </div>

      <SettingsModal />
    </div>
  );
}
