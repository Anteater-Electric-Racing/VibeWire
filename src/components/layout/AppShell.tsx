import { useEffect, useRef, useState, useCallback } from 'react';
import { Topbar } from './Topbar';
import { enterSubsystem, openManufacturingPicker, openSubsystemPicker } from '../../lib/topbarEvents';
import { SettingsModal } from './SettingsModal';
import { GraphView } from '../graph/GraphView';
import { TreeView } from '../tree/TreeView';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { ConnectorLibraryPage } from '../connectors/ConnectorLibraryPage';
import { SignalLibraryPage } from '../signals/SignalLibraryPage';
import { ManufacturingPage } from '../manufacturing/ManufacturingPage';
import { useHarnessStore } from '../../store';

const LEFT_WIDTH_MIN = 160;
const LEFT_WIDTH_MAX = 520;
const LEFT_WIDTH_DEFAULT = 224;
const PANEL_HEADER_H = 28; // px — height of each panel's header strip

function requestUndoWithWarning() {
  window.dispatchEvent(new CustomEvent('vibewire:request-undo'));
}

export function AppShell() {
  const harness = useHarnessStore((s) => s.harness);
  const selectedItem = useHarnessStore((s) => s.selectedItem);
  const selectedBundle = useHarnessStore((s) => s.selectedBundle);
  const selectedTextBoxId = useHarnessStore((s) => s.selectedTextBoxId);
  const drillDownEnclosure = useHarnessStore((s) => s.drillDownEnclosure);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const selectTextBox = useHarnessStore((s) => s.selectTextBox);
  const setSelectedBundle = useHarnessStore((s) => s.setSelectedBundle);
  const setDrillDown = useHarnessStore((s) => s.setDrillDown);
  const redo = useHarnessStore((s) => s.redo);
  const rotateConnector = useHarnessStore((s) => s.rotateConnector);
  const rotateEnclosure = useHarnessStore((s) => s.rotateEnclosure);
  const getDeleteImpact = useHarnessStore((s) => s.getDeleteImpact);
  const deleteEntityCascade = useHarnessStore((s) => s.deleteEntityCascade);
  const deletePathBundle = useHarnessStore((s) => s.deletePathBundle);
  const editingSurface = useHarnessStore((s) => s.editingSurface);
  const removeEntityFromActiveSubsystem = useHarnessStore((s) => s.removeEntityFromActiveSubsystem);
  const appView = useHarnessStore((s) => s.appView);
  const closeConnectorLibrary = useHarnessStore((s) => s.closeConnectorLibrary);
  const setEditingSurface = useHarnessStore((s) => s.setEditingSurface);
  const openManufacturing = useHarnessStore((s) => s.openManufacturing);
  const openConnectorLibrary = useHarnessStore((s) => s.openConnectorLibrary);
  const openSignalLibrary = useHarnessStore((s) => s.openSignalLibrary);
  const isEditor = useHarnessStore((s) => s.session.isEditor);
  const sessionUser = useHarnessStore((s) => s.session.user);
  const editSessionActive = useHarnessStore((s) => s.session.editSessionActive);
  const activateEditSession = useHarnessStore((s) => s.activateEditSession);
  const inspectorDismissed = useHarnessStore((s) => s.inspectorDismissed);
  const showInspector = !inspectorDismissed && !!(
    selectedItem || (selectedBundle && selectedBundle.pathIds.length > 0) || selectedTextBoxId
  );

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

      if (isEditor && !isTyping && (e.key === 'Delete' || e.key === 'Backspace') && selectedBundle) {
        e.preventDefault();
        const count = selectedBundle.pathIds.length;
        const label = count === 1
          ? 'Delete this path bundle?'
          : `Delete all ${count} paths in this bundle?`;
        if (window.confirm(`${label}\n\nThis removes the complete underlying path${count === 1 ? '' : 's'}, including any other visible hops.`)) {
          deletePathBundle(selectedBundle.id, selectedBundle.pathIds);
        }
        return;
      }

      if (isEditor && !isTyping && (e.key === 'Delete' || e.key === 'Backspace') && selectedItem) {
        if (editingSurface === 'subsystem') {
          if (selectedItem.type === 'enclosure' || selectedItem.type === 'connector') {
            e.preventDefault();
            removeEntityFromActiveSubsystem(selectedItem.type, selectedItem.id);
            return;
          }
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
      if (isEditor && !isTyping && mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        requestUndoWithWarning();
        return;
      }

      // Redo: Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y
      if (isEditor && !isTyping && mod && (e.key === 'Z' || (e.shiftKey && e.key === 'z') || e.key === 'y')) {
        e.preventDefault();
        redo();
        return;
      }

      // Rotate selected connector or enclosure: R (no modifier)
      if (isEditor && !isTyping && e.key === 'r' && !mod && selectedItem?.type === 'connector') {
        e.preventDefault();
        rotateConnector(selectedItem.id);
        return;
      }
      if (isEditor && !isTyping && e.key === 'r' && !mod && selectedItem?.type === 'enclosure') {
        e.preventDefault();
        rotateEnclosure(selectedItem.id);
        return;
      }

      // E: continue as the remembered user (arm editing after cookie restore).
      if (
        !isTyping
        && !mod
        && !e.altKey
        && !e.shiftKey
        && e.key === 'e'
        && sessionUser
        && !editSessionActive
      ) {
        e.preventDefault();
        activateEditSession();
        return;
      }

      // View shortcuts: 1 System, 2 Subsystem (again → picker),
      // 3 Manufacturing (again → harness / Build-Progress-BOM menu),
      // 4 Connectors, 5 Signals
      if (!isTyping && !mod && !e.altKey && !e.shiftKey) {
        if (e.key === '1') {
          e.preventDefault();
          closeConnectorLibrary();
          setEditingSurface('hierarchy');
          return;
        }
        if (e.key === '2') {
          e.preventDefault();
          if (appView === 'canvas' && editingSurface === 'subsystem') {
            openSubsystemPicker();
          } else {
            enterSubsystem();
          }
          return;
        }
        if (e.key === '3') {
          e.preventDefault();
          if (appView === 'manufacturing') {
            openManufacturingPicker();
          } else {
            openManufacturing();
          }
          return;
        }
        if (e.key === '4') {
          e.preventDefault();
          openConnectorLibrary();
          return;
        }
        if (e.key === '5') {
          e.preventDefault();
          openSignalLibrary();
          return;
        }
      }

      // Tilde / backtick: step inspector selection up one hierarchy level.
      // Closes at the current sheet boundary (drilled-in enclosure, or parent === null
      // on the root sheet) instead of climbing into a parent sheet.
      // Also deselects an active wire bundle (inspector open or dismissed).
      if (!isTyping && !mod && !e.altKey && (e.code === 'Backquote' || e.key === '`' || e.key === '~')) {
        if (!showInspector && !selectedBundle) return;
        e.preventDefault();

        // Wire bundles have no parent chain — tilde just exits them.
        if (selectedBundle) {
          setSelectedBundle(null);
          selectTextBox(null);
          return;
        }

        if (
          harness
          && selectedItem
          && (selectedItem.type === 'enclosure'
            || selectedItem.type === 'connector'
            || selectedItem.type === 'mergePoint')
        ) {
          // Already on the sheet entity for this view — close.
          if (
            selectedItem.type === 'enclosure'
            && drillDownEnclosure !== null
            && selectedItem.id === drillDownEnclosure
          ) {
            selectItem(null);
            selectTextBox(null);
            return;
          }

          const parentId =
            selectedItem.type === 'enclosure'
              ? harness.enclosures.find((item) => item.id === selectedItem.id)?.parent ?? null
              : selectedItem.type === 'connector'
                ? harness.connectors.find((item) => item.id === selectedItem.id)?.parent ?? null
                : harness.mergePoints.find((item) => item.id === selectedItem.id)?.parent ?? null;

          // Next step would be the current sheet or leave the root sheet — close.
          if (parentId === null || parentId === drillDownEnclosure) {
            selectItem(null);
            selectTextBox(null);
            return;
          }

          selectItem({ type: 'enclosure', id: parentId });
          return;
        }

        selectItem(null);
        selectTextBox(null);
        return;
      }

      if (e.key !== 'Escape') return;
      if (showInspector || inspectorDismissed) {
        selectItem(null);
        selectTextBox(null);
      } else if (drillDownEnclosure) {
        setDrillDown(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showInspector, inspectorDismissed, drillDownEnclosure, harness, selectItem, selectTextBox, setSelectedBundle, setDrillDown, redo, selectedItem, selectedBundle, rotateConnector, rotateEnclosure, editingSurface, appView, getDeleteImpact, deleteEntityCascade, deletePathBundle, removeEntityFromActiveSubsystem, isEditor, sessionUser, editSessionActive, activateEditSession, closeConnectorLibrary, setEditingSurface, openManufacturing, openConnectorLibrary, openSignalLibrary]);

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      <Topbar />
      {appView === 'connectorLibrary' ? (
        <div className="flex-1 min-h-0">
          <ConnectorLibraryPage />
        </div>
      ) : appView === 'signalLibrary' ? (
        <div className="flex-1 min-h-0">
          <SignalLibraryPage />
        </div>
      ) : appView === 'manufacturing' ? (
        <div className="flex flex-1 min-h-0">
          <main className="min-w-0 flex-1">
            <ManufacturingPage />
          </main>
          {selectedItem && (
            <aside className="w-64 shrink-0 border-l border-zinc-800 bg-zinc-900 overflow-hidden">
              <InspectorPanel />
            </aside>
          )}
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
