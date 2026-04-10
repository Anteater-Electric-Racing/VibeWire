import { useEffect, useRef, useState, useCallback } from 'react';
import { Topbar } from './Topbar';
import { SettingsModal } from './SettingsModal';
import { GraphView } from '../graph/GraphView';
import { TreeView } from '../tree/TreeView';
import { TagFilterPanel } from '../filters/TagFilterPanel';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { useHarnessStore } from '../../store';

const LEFT_WIDTH_MIN = 160;
const LEFT_WIDTH_MAX = 520;
const LEFT_WIDTH_DEFAULT = 224;
const PANEL_HEADER_H = 28; // px — height of each panel's header strip
const INNER_SPLIT_MIN = PANEL_HEADER_H + 40; // minimum content height when expanded

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
  const showInspector = !!(selectedItem || (selectedBundle && selectedBundle.length > 0) || selectedTextBoxId);

  // Left sidebar state
  const [leftWidth, setLeftWidth] = useState(LEFT_WIDTH_DEFAULT);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  // Independent panel collapse states
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  // Inner vertical split: treeHeight in px (null = flex default)
  const [treeHeight, setTreeHeight] = useState<number | null>(null);
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

  // Vertical inner split (TreeView / TagFilterPanel) — only active when both expanded
  const startVResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const sidebar = leftSidebarRef.current;
    if (!sidebar) return;
    const sidebarH = sidebar.getBoundingClientRect().height;
    const startY = e.clientY;
    const startTree = treeHeight ?? sidebarH * 0.6;
    const onMove = (mv: MouseEvent) => {
      const newTree = Math.max(INNER_SPLIT_MIN, Math.min(sidebarH - INNER_SPLIT_MIN, startTree + mv.clientY - startY));
      setTreeHeight(newTree);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [treeHeight]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

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
  }, [showInspector, drillDownEnclosure, selectItem, selectTextBox, setDrillDown, undo, redo]);

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      <Topbar />
      <div className="flex flex-1 min-h-0">

        {/* Left sidebar: tree + filters */}
        {!leftCollapsed && (
          <aside
            ref={leftSidebarRef}
            className="shrink-0 border-r border-zinc-800 bg-zinc-900 flex flex-col overflow-hidden relative"
            style={{ width: leftWidth }}
          >
            {/* ── Tree panel ───────────────────────────────────── */}
            <div
              className="flex flex-col overflow-hidden"
              style={
                treeCollapsed
                  ? { flexShrink: 0 }
                  : filtersCollapsed
                  ? { flex: '1 1 0', minHeight: INNER_SPLIT_MIN }
                  : treeHeight !== null
                  ? { height: treeHeight, flexShrink: 0 }
                  : { flex: '1 1 0', minHeight: INNER_SPLIT_MIN }
              }
            >
              {/* Panel header — click to collapse/expand */}
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

              {/* Panel content */}
              {!treeCollapsed && (
                <div className="flex-1 overflow-y-auto">
                  <TreeView />
                </div>
              )}
            </div>

            {/* ── Vertical resize handle (only when both expanded) ── */}
            {!treeCollapsed && !filtersCollapsed && (
              <div
                onMouseDown={startVResize}
                className="h-1 shrink-0 bg-zinc-800/80 hover:bg-amber-600/60 cursor-row-resize transition-colors relative"
                title="Drag to resize panels"
              >
                <div className="absolute inset-x-0 -top-1.5 -bottom-1.5" />
              </div>
            )}

            {/* ── Filters panel ─────────────────────────────────── */}
            <div
              className="flex flex-col overflow-hidden"
              style={
                filtersCollapsed
                  ? { flexShrink: 0 }
                  : treeCollapsed
                  ? { flex: '1 1 0', minHeight: INNER_SPLIT_MIN }
                  : treeHeight !== null
                  ? { flex: '1 1 0', minHeight: INNER_SPLIT_MIN }
                  : { flex: '0 1 40%', minHeight: INNER_SPLIT_MIN }
              }
            >
              {/* Panel header — click to collapse/expand */}
              <button
                onClick={() => setFiltersCollapsed((v) => !v)}
                className="flex items-center gap-1.5 px-2 shrink-0 w-full text-left group hover:bg-zinc-800/60 transition-colors border-t border-b border-zinc-800"
                style={{ height: PANEL_HEADER_H }}
                title={filtersCollapsed ? 'Expand filters' : 'Collapse filters'}
              >
                <svg
                  width="9" height="9" viewBox="0 0 9 9" fill="none"
                  className={`text-zinc-500 group-hover:text-zinc-300 transition-transform duration-150 ${filtersCollapsed ? '-rotate-90' : ''}`}
                >
                  <path d="M1.5 3L4.5 6L7.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-[10px] font-semibold text-zinc-500 group-hover:text-zinc-300 uppercase tracking-wider transition-colors">
                  Filters
                </span>
              </button>

              {/* Panel content */}
              {!filtersCollapsed && (
                <div className="flex-1 overflow-y-auto">
                  <TagFilterPanel />
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

      <SettingsModal />
    </div>
  );
}
