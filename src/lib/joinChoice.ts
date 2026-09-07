/**
 * Decision helper for the Shared Anchor vs Branch Point join popup.
 * GraphView owns the DOM; tests cover default, Enter, Escape, and arrows here.
 */

export type JoinKind = 'shared-anchor' | 'branch-point';

export const DEFAULT_JOIN_KIND: JoinKind = 'shared-anchor';

export const JOIN_KIND_ORDER: readonly JoinKind[] = ['shared-anchor', 'branch-point'];

export const JOIN_KIND_LABELS: Record<JoinKind, string> = {
  'shared-anchor': 'Shared anchor',
  'branch-point': 'Branch point',
};

export interface PendingBundleJoin {
  sourceEdgeId: string;
  sourceWaypointIndex: number;
  targetEdgeId: string;
  insertAfterIndex: number;
  position: { x: number; y: number };
  screen: { x: number; y: number };
}

export type JoinPromptDecision = JoinKind | 'cancel';

export function joinKindLabel(kind: JoinKind): string {
  return JOIN_KIND_LABELS[kind];
}

export function nextJoinKind(current: JoinKind, direction: 1 | -1): JoinKind {
  const index = JOIN_KIND_ORDER.indexOf(current);
  const next = (index + direction + JOIN_KIND_ORDER.length) % JOIN_KIND_ORDER.length;
  return JOIN_KIND_ORDER[next] ?? DEFAULT_JOIN_KIND;
}

/** Enter confirms the focused option (default Shared Anchor). Escape cancels. */
export function resolveJoinPromptKey(
  key: string,
  focused: JoinKind = DEFAULT_JOIN_KIND,
): JoinPromptDecision | 'focus-next' | 'focus-prev' | null {
  if (key === 'Escape') return 'cancel';
  if (key === 'Enter') return focused;
  if (key === 'ArrowDown' || key === 'ArrowRight') return 'focus-next';
  if (key === 'ArrowUp' || key === 'ArrowLeft') return 'focus-prev';
  return null;
}
