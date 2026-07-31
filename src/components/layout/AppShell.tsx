import { useEffect, useRef, useState, useCallback } from 'react';
import { Topbar } from './Topbar';
import { SettingsModal } from './SettingsModal';
import { GraphView } from '../graph/GraphView';
import { TreeView } from '../tree/TreeView';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { ConnectorLibraryPage } from '../connectors/ConnectorLibraryPage';
import { ManufacturingPage } from '../manufacturing/ManufacturingPage';
import { useHarnessStore } from '../../store';

const LEFT_WIDTH_MIN = 160;
const LEFT_WIDTH_MAX = 520;
const LEFT_WIDTH_DEFAULT = 224;
const PANEL_HEADER_H = 28; // px — height of each panel's header strip

export function AppShell() {
  const selectedItem = useHarnessStore((s) => s.selectedItem);
  const selectedBundle = useHarnessStore((s) => s.selectedBundle);
  const selectedTextBoxId = useHarnessStore((s) => s.selectedTextBoxId);
  const drillDownEnclosure = useHarnessStore((s) => s.drillDownEnclosure);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const selectTextBox = useHarnessStore((s) => s.selectTextBox);
  const setDrillDown = useHarnessStore((s) => s.setDrillDown);
  const undo = useHarnessStore((s) => s.undo);
  const redo = useHarnessStore((s) => s.redo);
  const rotateConnector = useHarnessStore((s) => s.rotateConnector);
  const rotateEnclosure = useHarnessStore((s) => s.rotateEnclosure);
  const pushUndoSnapshot = useHarnessStore((s) => s.pushUndoSnapshot);
  const getDeleteImpact = useHarnessStore((s) => s.getDeleteImpact);
  const deleteEntityCascade = useHarnessStore((s) => s.deleteEntityCascade);
  const editingSurface = useHarnessStore((s) => s.editingSurface);
  const removeEntityFromActiveSubsystem = useHarnessStore((s) => s.removeEntityFromActiveSubsystem);
  const appView = useHarnessStore((s) => s.appView);
  const showInspector = !!(selectedItem || (selectedBundle && selectedBundle.length > 0) || selectedTextBoxId);

  // Left sidebar state
  const [leftWidth, setLeftWidth] = useState(LEFT_WIDTH_DEFAULT);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const leftSidebarRef = useRef<HTMLElement>(null);

  // Horizontal resize (left sidebar width)
  const startHResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = leftWidth;
    const onMove = (mv: MouseEvent) => {
      const newW = Math.max(LEFT_WIDTH_MIN, Math.min(LEFT_WIDTH_MAX, startW + mv.clientX - startX));
      setLeftWidth(newW);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [leftWidth]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;

      if (!isTyping && (e.key === 'Delete' || e.key === 'Backspace') && selectedItem) {
        if (editingSurface === 'subsystem') {
          if (selectedItem.type === 'enclosure' || selectedItem.type === 'connector') {
            e.preventDefault();
            removeEntityFromActiveSubsystem(selectedItem.type, selectedItem.id);
          }
          return;
        }
        if (selectedItem.type === 'mergePoint') {
          const impact = getDeleteImpact(selectedItem.type, selectedItem.id);
          const orphanNote = impact.pathIds.length > 0
            ? `\n\n${impact.pathIds.length} unpairable stub path(s) will be removed.`
            : '';
          if (window.confirm(
            `Delete splice ${selectedItem.id}?\n\nPaths through it will reconnect as if the splice was never there.${orphanNote}`,
          )) {
            e.preventDefault();
            deleteEntityCascade(selectedItem.type, selectedItem.id);
          }
          return;
        }
        const impact = getDeleteImpact(selectedItem.type, selectedItem.id);
        const summary = `${impact.enclosureIds.length} enclosures/devices, ${impact.connectorIds.length} connectors, ${impact.mergePointIds.length} merge points, and ${impact.pathIds.length} paths`;
        if (window.confirm(`Permanently delete ${selectedItem.id}?\n\nCascade impact: ${summary}.`)) {
          e.preventDefault();
          deleteEntityCascade(selectedItem.type, selectedItem.id);
        }
        return;
      }

      // Undo: Cmd/Ctrl+Z (without Shift)
      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Redo: Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y
      if (mod && (e.key === 'Z' || (e.shiftKey && e.key === 'z') || e.key === 'y')) {
        e.preventDefault();
        redo();
        return;
      }

      // Rotate selected connector or enclosure: R (no modifier)
      if (e.key === 'r' && !mod && selectedItem?.type === 'connector') {
        e.preventDefault();
        pushUndoSnapshot();
        rotateConnector(selectedItem.id);
        return;
      }
      if (e.key === 'r' && !mod && selectedItem?.type === 'enclosure') {
        e.preventDefault();
        pushUndoSnapshot();
        rotateEnclosure(selectedItem.id);
        return;
      }

      if (e.key !== 'Escape') return;
      if (showInspector) {
        selectItem(null);
        selectTextBox(null);
      } else if (drillDownEnclosure) {
        setDrillDown(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showInspector, drillDownEnclosure, selectItem, selectTextBox, setDrillDown, undo, redo, selectedItem, rotateConnector, rotateEnclosure, pushUndoSnapshot, editingSurface, getDeleteImpact, deleteEntityCascade, removeEntityFromActiveSubsystem]);

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      <Topbar />
      {appView === 'connectorLibrary' ? (
        <div className="flex-1 min-h-0">
          <ConnectorLibraryPage />
        </div>
      ) : appView === 'manufacturing' ? (
        <div className="flex-1 min-h-0">
          <ManufacturingPage />
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">

        {/* Left sidebar: hierarchy */}
        {!leftCollapsed && (
          <aside
            ref={leftSidebarRef}
            className="shrink-0 border-r border-zinc-800 bg-zinc-900 flex flex-col overflow-hidden relative"
            style={{ width: leftWidth }}
          >
            <div className="flex flex-col overflow-hidden flex-1 min-h-0">
              <button
                onClick={() => setTreeCollapsed((v) => !v)}
                className="flex items-center gap-1.5 px-2 shrink-0 w-full text-left group hover:bg-zinc-800/60 transition-colors border-b border-zinc-800"
                style={{ height: PANEL_HEADER_H }}
                title={treeCollapsed ? 'Expand hierarchy' : 'Collapse hierarchy'}
              >
                <svg
                  width="9" height="9" viewBox="0 0 9 9" fill="none"
                  className={`text-zinc-500 group-hover:text-zinc-300 transition-transform duration-150 ${treeCollapsed ? '-rotate-90' : ''}`}
                >
                  <path d="M1.5 3L4.5 6L7.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-[10px] font-semibold text-zinc-500 group-hover:text-zinc-300 uppercase tracking-wider transition-colors">
                  Hierarchy
                </span>
              </button>

              {!treeCollapsed && (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <TreeView />
                </div>
              )}
            </div>

            {/* Horizontal resize handle (right edge) */}
            <div
              onMouseDown={startHResize}
              className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-amber-600/60 transition-colors z-10"
              title="Drag to resize sidebar"
            />

            {/* Collapse entire sidebar button */}
            <button
              onClick={() => setLeftCollapsed(true)}
              className="absolute bottom-2 right-2 z-20 flex items-center justify-center w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-500 hover:text-zinc-200 transition-colors"
              title="Collapse sidebar"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M7 2L3 5L7 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </aside>
        )}

        {/* Collapsed sidebar strip */}
        {leftCollapsed && (
          <div className="shrink-0 w-6 border-r border-zinc-800 bg-zinc-900 flex flex-col items-center justify-center">
            <button
              onClick={() => setLeftCollapsed(false)}
              className="flex items-center justify-center w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-500 hover:text-zinc-200 transition-colors"
              title="Expand sidebar"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M3 2L7 5L3 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        )}

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
      )}

      <SettingsModal />
    </div>
  );
}
