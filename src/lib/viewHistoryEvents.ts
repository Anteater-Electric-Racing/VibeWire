import type { SavedViewport } from './userPrefs';

export const VIEWPORT_HISTORY_EVENT = 'vibewire:viewport-history';
export const RESTORE_VIEWPORT_EVENT = 'vibewire:restore-viewport';

export type ViewportHistoryEventDetail = {
  viewportKey: string;
  viewport: SavedViewport;
  record: boolean;
};

export type RestoreViewportEventDetail = {
  viewportKey: string;
  viewport: SavedViewport;
};

export function reportViewportForHistory(
  viewportKey: string,
  viewport: SavedViewport,
  record: boolean,
): void {
  window.dispatchEvent(new CustomEvent<ViewportHistoryEventDetail>(
    VIEWPORT_HISTORY_EVENT,
    { detail: { viewportKey, viewport, record } },
  ));
}

export function restoreHistoryViewport(
  viewportKey: string,
  viewport: SavedViewport,
): void {
  window.dispatchEvent(new CustomEvent<RestoreViewportEventDetail>(
    RESTORE_VIEWPORT_EVENT,
    { detail: { viewportKey, viewport } },
  ));
}
