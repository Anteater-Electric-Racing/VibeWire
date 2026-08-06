import type { Enclosure, HarnessData, SubsystemDocument, SubsystemEntityLayout } from '../types';

/** Container enclosure ids from `startId` upward (innermost first). */
export function collectAncestorContainerIds(
  harness: Pick<HarnessData, 'enclosures'>,
  startId: string | null,
): string[] {
  const enclosureById = new Map(harness.enclosures.map((enclosure) => [enclosure.id, enclosure]));
  const chain: string[] = [];
  let current = startId;
  while (current) {
    const enclosure = enclosureById.get(current);
    if (!enclosure) break;
    if (enclosure.container) chain.push(enclosure.id);
    current = enclosure.parent;
  }
  return chain;
}

function rootFrameLayout(document: SubsystemDocument): SubsystemEntityLayout {
  const index = Object.keys(document.enclosures).length;
  return {
    x: 40 + (index % 3) * 560,
    y: 40 + Math.floor(index / 3) * 400,
    w: 520,
    h: 360,
  };
}

function nestedFrameLayout(
  harness: Pick<HarnessData, 'enclosures'>,
  document: SubsystemDocument,
  parentId: string,
  parentLayout: SubsystemEntityLayout,
): SubsystemEntityLayout {
  const siblingCount = Object.keys(document.enclosures).filter((id) =>
    harness.enclosures.find((enclosure) => enclosure.id === id)?.parent === parentId
  ).length;
  const parentW = parentLayout.w ?? 520;
  const parentH = parentLayout.h ?? 360;
  return {
    x: 40 + siblingCount * 24,
    y: 40 + siblingCount * 24,
    w: Math.max(280, parentW - 80),
    h: Math.max(200, parentH - 80),
  };
}

/**
 * Ensure every container ancestor of `startId` (including `startId` when it is a
 * container) exists as a subsystem frame, creating outermost frames first so
 * nested boxes receive parent-relative layouts.
 */
export function ensureSubsystemAncestorFrames(
  harness: Pick<HarnessData, 'enclosures'>,
  document: SubsystemDocument,
  startId: string | null,
  onFrame?: (enclosure: Enclosure) => void,
): void {
  const chain = collectAncestorContainerIds(harness, startId);
  // Outermost → innermost so parents exist before nested children are laid out.
  for (const frameId of chain.slice().reverse()) {
    const enclosure = harness.enclosures.find((item) => item.id === frameId);
    if (!enclosure?.container) continue;
    if (!document.enclosures[frameId]) {
      const parentId = enclosure.parent;
      const parentLayout = parentId ? document.enclosures[parentId] : undefined;
      document.enclosures[frameId] = parentId && parentLayout
        ? nestedFrameLayout(harness, document, parentId, parentLayout)
        : rootFrameLayout(document);
    }
    onFrame?.(enclosure);
  }
}
