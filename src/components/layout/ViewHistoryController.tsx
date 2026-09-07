import { useCallback, useEffect, useRef } from 'react';
import { useSystemStore } from '../../store';
import type {
  AppView,
  EditingSurface,
  ManufacturingTab,
  SelectedHarnessBundle,
  SelectedItem,
} from '../../types';
import {
  getSheetViewport,
  setSheetViewport,
  type SavedViewport,
} from '../../lib/userPrefs';
import {
  VIEWPORT_HISTORY_EVENT,
  restoreHistoryViewport,
  type ViewportHistoryEventDetail,
} from '../../lib/viewHistoryEvents';

const MAX_VIEW_HISTORY = 100;

type ViewSnapshot = {
  appView: AppView;
  editingSurface: EditingSurface;
  activeSubsystemId: string | null;
  manufacturingTargetBundleId: string | null;
  manufacturingTab: ManufacturingTab;
  connectorLibraryTargetId: string | null;
  signalLibraryTargetId: string | null;
  selectedItem: SelectedItem | null;
  selectedHarnessBundle: SelectedHarnessBundle | null;
  selectedTextBoxId: string | null;
  selectedImageId: string | null;
  inspectorDismissed: boolean;
  openEnclosureId: string | null;
  viewportKey: string | null;
  viewport: SavedViewport | null;
};

function viewportKeyForState(state: ReturnType<typeof useSystemStore.getState>): string | null {
  if (state.appView !== 'canvas') return null;
  if (state.editingSurface === 'subsystem') {
    return `${state.activeSystemName}:subsystem:${state.activeSubsystemId ?? 'none'}`;
  }
  return `${state.activeSystemName}:hierarchy:${state.openEnclosureId ?? 'graph'}`;
}

function cloneViewport(viewport: SavedViewport | null): SavedViewport | null {
  return viewport ? { ...viewport } : null;
}

function captureSnapshot(
  viewports: Map<string, SavedViewport>,
  viewportOverride?: { key: string; viewport: SavedViewport },
): ViewSnapshot {
  const state = useSystemStore.getState();
  const viewportKey = viewportKeyForState(state);
  const viewport = viewportKey
    ? viewportOverride?.key === viewportKey
      ? viewportOverride.viewport
      : viewports.get(viewportKey)
        ?? getSheetViewport(state.session.user?.id ?? null, viewportKey)
    : null;

  return {
    appView: state.appView,
    editingSurface: state.editingSurface,
    activeSubsystemId: state.activeSubsystemId,
    manufacturingTargetBundleId: state.manufacturingTargetBundleId,
    manufacturingTab: state.manufacturingTab,
    connectorLibraryTargetId: state.connectorLibraryTargetId,
    signalLibraryTargetId: state.signalLibraryTargetId,
    selectedItem: state.selectedItem ? { ...state.selectedItem } : null,
    selectedHarnessBundle: state.selectedHarnessBundle
      ? { ...state.selectedHarnessBundle, pathIds: [...state.selectedHarnessBundle.pathIds] }
      : null,
    selectedTextBoxId: state.selectedTextBoxId,
    selectedImageId: state.selectedImageId,
    inspectorDismissed: state.inspectorDismissed,
    openEnclosureId: state.openEnclosureId,
    viewportKey,
    viewport: cloneViewport(viewport),
  };
}

function snapshotSignature(snapshot: ViewSnapshot): string {
  return JSON.stringify(snapshot);
}

function pageSignature(snapshot: ViewSnapshot): string {
  return JSON.stringify({ ...snapshot, viewport: null });
}

export function ViewHistoryController() {
  const hasSystem = useSystemStore((state) => state.system !== null);
  const activeSystemName = useSystemStore((state) => state.activeSystemName);
  const userId = useSystemStore((state) => state.session.user?.id ?? null);
  const appView = useSystemStore((state) => state.appView);
  const editingSurface = useSystemStore((state) => state.editingSurface);
  const activeSubsystemId = useSystemStore((state) => state.activeSubsystemId);
  const manufacturingTargetBundleId = useSystemStore((state) => state.manufacturingTargetBundleId);
  const manufacturingTab = useSystemStore((state) => state.manufacturingTab);
  const connectorLibraryTargetId = useSystemStore((state) => state.connectorLibraryTargetId);
  const signalLibraryTargetId = useSystemStore((state) => state.signalLibraryTargetId);
  const selectedItem = useSystemStore((state) => state.selectedItem);
  const selectedHarnessBundle = useSystemStore((state) => state.selectedHarnessBundle);
  const selectedTextBoxId = useSystemStore((state) => state.selectedTextBoxId);
  const selectedImageId = useSystemStore((state) => state.selectedImageId);
  const inspectorDismissed = useSystemStore((state) => state.inspectorDismissed);
  const openEnclosureId = useSystemStore((state) => state.openEnclosureId);

  const historyRef = useRef<ViewSnapshot[]>([]);
  const indexRef = useRef(-1);
  const projectRef = useRef('');
  const viewportsRef = useRef(new Map<string, SavedViewport>());
  const lastCameraRecordRef = useRef<{
    at: number;
    index: number;
    page: string;
  } | null>(null);

  function pushSnapshot(snapshot: ViewSnapshot) {
    const current = historyRef.current[indexRef.current];
    if (current && snapshotSignature(current) === snapshotSignature(snapshot)) return;

    const next = historyRef.current.slice(0, indexRef.current + 1);
    next.push(snapshot);
    if (next.length > MAX_VIEW_HISTORY) next.shift();
    historyRef.current = next;
    indexRef.current = next.length - 1;
  }

  const applySnapshot = useCallback((snapshot: ViewSnapshot) => {
    if (snapshot.viewportKey && snapshot.viewport) {
      viewportsRef.current.set(snapshot.viewportKey, snapshot.viewport);
      setSheetViewport(userId, snapshot.viewportKey, snapshot.viewport);
    }

    useSystemStore.setState({
      appView: snapshot.appView,
      editingSurface: snapshot.editingSurface,
      activeSubsystemId: snapshot.activeSubsystemId,
      manufacturingTargetBundleId: snapshot.manufacturingTargetBundleId,
      manufacturingTab: snapshot.manufacturingTab,
      connectorLibraryTargetId: snapshot.connectorLibraryTargetId,
      signalLibraryTargetId: snapshot.signalLibraryTargetId,
      selectedItem: snapshot.selectedItem ? { ...snapshot.selectedItem } : null,
      selectedHarnessBundle: snapshot.selectedHarnessBundle
        ? { ...snapshot.selectedHarnessBundle, pathIds: [...snapshot.selectedHarnessBundle.pathIds] }
        : null,
      selectedTextBoxId: snapshot.selectedTextBoxId,
      selectedImageId: snapshot.selectedImageId,
      inspectorDismissed: snapshot.inspectorDismissed,
      openEnclosureId: snapshot.openEnclosureId,
      revealRequest: null,
    });

    if (snapshot.viewportKey && snapshot.viewport) {
      requestAnimationFrame(() => {
        restoreHistoryViewport(snapshot.viewportKey!, snapshot.viewport!);
      });
    }
  }, [userId]);

  useEffect(() => {
    if (!hasSystem) {
      projectRef.current = '';
      historyRef.current = [];
      indexRef.current = -1;
      lastCameraRecordRef.current = null;
      return;
    }

    const projectKey = `${activeSystemName}:${userId ?? 'local'}`;
    const snapshot = captureSnapshot(viewportsRef.current);
    if (projectRef.current !== projectKey) {
      projectRef.current = projectKey;
      historyRef.current = [snapshot];
      indexRef.current = 0;
      lastCameraRecordRef.current = null;
      return;
    }
    pushSnapshot(snapshot);
  }, [
    hasSystem,
    activeSystemName,
    userId,
    appView,
    editingSurface,
    activeSubsystemId,
    manufacturingTargetBundleId,
    manufacturingTab,
    connectorLibraryTargetId,
    signalLibraryTargetId,
    selectedItem,
    selectedHarnessBundle,
    selectedTextBoxId,
    selectedImageId,
    inspectorDismissed,
    openEnclosureId,
  ]);

  useEffect(() => {
    function onViewportHistory(event: Event) {
      const { viewportKey, viewport, record } = (
        event as CustomEvent<ViewportHistoryEventDetail>
      ).detail;
      viewportsRef.current.set(viewportKey, viewport);

      if (!hasSystem || viewportKey !== viewportKeyForState(useSystemStore.getState())) return;
      const snapshot = captureSnapshot(
        viewportsRef.current,
        { key: viewportKey, viewport },
      );
      const current = historyRef.current[indexRef.current];

      // Initial and programmatic camera placement belongs to the page entry
      // that caused it; a completed user pan/zoom creates a new entry.
      if (!record && current && pageSignature(current) === pageSignature(snapshot)) {
        historyRef.current[indexRef.current] = snapshot;
        return;
      }

      if (record && current && snapshotSignature(current) !== snapshotSignature(snapshot)) {
        const now = Date.now();
        const page = pageSignature(snapshot);
        const lastCamera = lastCameraRecordRef.current;
        if (
          lastCamera
          && lastCamera.index === indexRef.current
          && lastCamera.page === page
          && now - lastCamera.at < 400
        ) {
          historyRef.current[indexRef.current] = snapshot;
          lastCameraRecordRef.current = { at: now, index: indexRef.current, page };
          return;
        }
        pushSnapshot(snapshot);
        lastCameraRecordRef.current = { at: now, index: indexRef.current, page };
        return;
      }
      pushSnapshot(snapshot);
    }

    window.addEventListener(VIEWPORT_HISTORY_EVENT, onViewportHistory);
    return () => window.removeEventListener(VIEWPORT_HISTORY_EVENT, onViewportHistory);
  }, [hasSystem]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.isContentEditable;
      const mod = event.metaKey || event.ctrlKey;
      if (isTyping || !mod || event.altKey || event.key.toLowerCase() !== 'b') return;

      event.preventDefault();
      event.stopPropagation();
      const nextIndex = indexRef.current + (event.shiftKey ? 1 : -1);
      const snapshot = historyRef.current[nextIndex];
      if (!snapshot) return;

      indexRef.current = nextIndex;
      lastCameraRecordRef.current = null;
      applySnapshot(snapshot);
    }

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [applySnapshot]);

  return null;
}
