import type { BackgroundLayouts, CanvasImageLayouts, EditingSurface } from '../types';

export const ADD_IMAGE_EVENT = 'vibewire:add-image';
export const GRAPH_IMAGE_CONTEXT = 'graph';
export const SUBSYSTEM_IMAGE_PREFIX = 'subsystem:';

export function requestAddImage() {
  window.dispatchEvent(new Event(ADD_IMAGE_EVENT));
}

export function imageDisplayName(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return base || 'Image';
}

export function nextImageName(existing: Iterable<string>): string {
  let max = 0;
  for (const name of existing) {
    const match = /^Image (\d+)$/i.exec(name.trim());
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `Image ${max + 1}`;
}

export function canvasImageContextKey(
  editingSurface: EditingSurface,
  openEnclosureId: string | null,
  activeSubsystemId: string | null,
): string {
  if (editingSurface === 'subsystem' && activeSubsystemId) {
    return `${SUBSYSTEM_IMAGE_PREFIX}${activeSubsystemId}`;
  }
  return openEnclosureId ?? GRAPH_IMAGE_CONTEXT;
}

export type ImageContextView = {
  editingSurface: EditingSurface;
  openEnclosureId: string | null;
  activeSubsystemId: string | null;
};

export function viewFromImageContextKey(contextKey: string | undefined): ImageContextView {
  const key = contextKey || GRAPH_IMAGE_CONTEXT;
  if (key.startsWith(SUBSYSTEM_IMAGE_PREFIX)) {
    const id = key.slice(SUBSYSTEM_IMAGE_PREFIX.length);
    return {
      editingSurface: 'subsystem',
      openEnclosureId: null,
      activeSubsystemId: id || null,
    };
  }
  return {
    editingSurface: 'hierarchy',
    openEnclosureId: key === GRAPH_IMAGE_CONTEXT ? null : key,
    activeSubsystemId: null,
  };
}

export function imageMatchesContext(
  contextKey: string | undefined,
  viewKey: string,
): boolean {
  return (contextKey ?? GRAPH_IMAGE_CONTEXT) === viewKey;
}

export function migrateCanvasImages(
  images: CanvasImageLayouts | undefined,
  backgrounds: BackgroundLayouts | undefined,
): CanvasImageLayouts {
  const fromImages: CanvasImageLayouts = {};
  for (const [id, img] of Object.entries(images ?? {})) {
    if (!img?.image) continue;
    fromImages[id] = {
      id: img.id || id,
      contextKey: img.contextKey ?? 'graph',
      image: img.image,
      name: img.name || imageDisplayName(img.image),
      x: img.x,
      y: img.y,
      w: img.w,
      h: img.h,
      locked: Boolean(img.locked),
      layer: img.layer === 'foreground' ? 'foreground' : 'background',
    };
  }
  if (Object.keys(fromImages).length > 0) return fromImages;

  const hasLegacy = Object.values(backgrounds ?? {}).some((bg) => Boolean(bg?.image));
  if (!hasLegacy) return images ?? fromImages;

  const migrated: CanvasImageLayouts = {};
  for (const [contextKey, bg] of Object.entries(backgrounds ?? {})) {
    if (!bg?.image) continue;
    const id = `img_${contextKey}`;
    migrated[id] = {
      id,
      contextKey,
      image: bg.image,
      name: imageDisplayName(bg.image),
      x: bg.x,
      y: bg.y,
      w: bg.w,
      h: bg.h,
      locked: Boolean(bg.locked),
      layer: 'background',
    };
  }
  return migrated;
}
