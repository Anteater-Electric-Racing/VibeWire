/**
 * Browser-local preferences keyed by user id.
 * Keeps UI memory (last manufacturing harness, sheet cameras) out of shared documents.
 */

export type SavedViewport = {
  x: number;
  y: number;
  zoom: number;
};

type UserPrefs = {
  lastManufacturingBundleByHarness?: Record<string, string>;
  sheetViewports?: Record<string, SavedViewport>;
};

function prefsKey(userId: string | null | undefined): string {
  return `vw-user-prefs:${userId ?? 'local'}`;
}

function readUserPrefs(userId: string | null | undefined): UserPrefs {
  try {
    const raw = localStorage.getItem(prefsKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as UserPrefs;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeUserPrefs(userId: string | null | undefined, prefs: UserPrefs): void {
  try {
    localStorage.setItem(prefsKey(userId), JSON.stringify(prefs));
  } catch {
    /* ignore quota / private-mode failures */
  }
}

function isSavedViewport(value: unknown): value is SavedViewport {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as SavedViewport;
  return (
    Number.isFinite(candidate.x)
    && Number.isFinite(candidate.y)
    && Number.isFinite(candidate.zoom)
    && candidate.zoom > 0
  );
}

export function getLastManufacturingBundleId(
  userId: string | null | undefined,
  harnessName: string,
): string | null {
  const value = readUserPrefs(userId).lastManufacturingBundleByHarness?.[harnessName];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function setLastManufacturingBundleId(
  userId: string | null | undefined,
  harnessName: string,
  bundleId: string,
): void {
  if (!harnessName || !bundleId) return;
  const prefs = readUserPrefs(userId);
  writeUserPrefs(userId, {
    ...prefs,
    lastManufacturingBundleByHarness: {
      ...prefs.lastManufacturingBundleByHarness,
      [harnessName]: bundleId,
    },
  });
}

export function getSheetViewport(
  userId: string | null | undefined,
  sheetKey: string,
): SavedViewport | null {
  if (!sheetKey) return null;
  const value = readUserPrefs(userId).sheetViewports?.[sheetKey];
  return isSavedViewport(value) ? value : null;
}

export function setSheetViewport(
  userId: string | null | undefined,
  sheetKey: string,
  viewport: SavedViewport,
): void {
  if (!sheetKey || !isSavedViewport(viewport)) return;
  const prefs = readUserPrefs(userId);
  writeUserPrefs(userId, {
    ...prefs,
    sheetViewports: {
      ...prefs.sheetViewports,
      [sheetKey]: {
        x: viewport.x,
        y: viewport.y,
        zoom: viewport.zoom,
      },
    },
  });
}
