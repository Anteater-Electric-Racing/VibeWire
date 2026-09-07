import type { WireRouteStyle } from '../../types';
import { useSystemStore } from '../../store';
import {
  confirmApplyViewRouteStyle,
  routeViewKey,
  viewRouteWiresAllMatch,
} from '../../lib/routeStyle';

export function RouteStyleBar({
  style,
  allMatch,
  disabled,
  onGrid,
  onStraight,
  onMatchAll,
}: {
  style: WireRouteStyle;
  allMatch: boolean;
  disabled?: boolean;
  onGrid: () => void;
  onStraight: () => void;
  onMatchAll: () => void;
}) {
  const segmentClass = (active: boolean) =>
    `px-1.5 py-1 text-[10px] font-medium leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
      active
        ? 'bg-amber-500/20 text-amber-200'
        : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
    }`;

  return (
    <div
      className="flex w-full overflow-hidden rounded-md border border-zinc-600"
      role="group"
      aria-label="Wire routing style"
    >
      <button
        type="button"
        className={`basis-[40%] border-r border-zinc-600 ${segmentClass(style === 'grid')}`}
        aria-pressed={style === 'grid'}
        disabled={disabled}
        title="Draw this Harness Bundle on a Lucidchart-style orthogonal grid"
        onClick={onGrid}
      >
        On grid
      </button>
      <button
        type="button"
        className={`basis-[40%] border-r border-zinc-600 ${segmentClass(style === 'straight')}`}
        aria-pressed={style === 'straight'}
        disabled={disabled}
        title="Draw this Harness Bundle as a straight shot through its route points"
        onClick={onStraight}
      >
        Straight shot
      </button>
      <button
        type="button"
        className={`basis-[20%] ${segmentClass(allMatch)}`}
        aria-pressed={allMatch}
        disabled={disabled}
        title={allMatch
          ? 'Every wire in this view already matches this Harness Bundle'
          : 'Make every wire in the current view match this Harness Bundle'}
        onClick={onMatchAll}
      >
        {allMatch ? 'All match' : 'Match all'}
      </button>
    </div>
  );
}

export function HarnessBundleRouteStyleControls({
  edgeId,
  extraEdgeIds,
  disabled,
}: {
  edgeId: string;
  extraEdgeIds?: string[];
  disabled?: boolean;
}) {
  const routeStyleLayouts = useSystemStore((s) => s.routeStyleLayouts) ?? {};
  const viewRouteStyleLayouts = useSystemStore((s) => s.viewRouteStyleLayouts) ?? {};
  const editingSurface = useSystemStore((s) => s.editingSurface);
  const activeSubsystemId = useSystemStore((s) => s.activeSubsystemId);
  const subsystems = useSystemStore((s) => s.subsystems);
  const isEditor = useSystemStore((s) => s.session.isEditor);
  const setEdgeRouteStyle = useSystemStore((s) => s.setEdgeRouteStyle);
  const applyViewRouteStyle = useSystemStore((s) => s.applyViewRouteStyle);

  const viewKey = routeViewKey(editingSurface, activeSubsystemId);
  const viewDefault = viewRouteStyleLayouts[viewKey];
  const style = routeStyleLayouts[edgeId] ?? viewDefault ?? 'straight';
  const allMatch = viewRouteWiresAllMatch(
    style,
    routeStyleLayouts,
    viewRouteStyleLayouts,
    viewKey,
  );

  const applyToView = (next: WireRouteStyle) => {
    const viewKind = editingSurface === 'subsystem' && activeSubsystemId
      ? 'subsystem' as const
      : 'system' as const;
    const viewName = viewKind === 'subsystem'
      ? subsystems[activeSubsystemId ?? '']?.name
      : undefined;
    if (!confirmApplyViewRouteStyle({ style: next, viewKind, viewName })) return;
    applyViewRouteStyle(next, extraEdgeIds);
  };

  return (
    <RouteStyleBar
      style={style}
      allMatch={allMatch}
      disabled={disabled || !isEditor}
      onGrid={() => setEdgeRouteStyle(edgeId, 'grid')}
      onStraight={() => setEdgeRouteStyle(edgeId, 'straight')}
      onMatchAll={() => applyToView(style)}
    />
  );
}

