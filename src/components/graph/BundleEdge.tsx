import {
  BaseEdge,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { useHarnessStore } from '../../store';

type BundleEdgeData = {
  wireIds: string[];
  wireCount: number;
  signalColor: string;
  matchesFilter: boolean;
};

type BundleEdgeType = Edge<BundleEdgeData, 'bundle'>;

export function BundleEdge(props: EdgeProps<BundleEdgeType>) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    selected,
  } = props;

  const setSelectedBundle = useHarnessStore((s) => s.setSelectedBundle);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const wireCount = data?.wireCount ?? 1;
  const strokeWidth = wireCount <= 2 ? 2 : wireCount <= 5 ? 4 : 6;
  const color = data?.signalColor ?? '#666';
  const matchesFilter = data?.matchesFilter ?? true;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (data?.wireIds) {
      setSelectedBundle(data.wireIds);
    }
  };

  return (
    <g onClick={handleClick} className="cursor-pointer">
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: selected ? strokeWidth + 2 : strokeWidth,
          opacity: matchesFilter ? 1 : 0.15,
          transition: 'opacity 0.2s',
          filter: selected ? `drop-shadow(0 0 6px ${color})` : undefined,
        }}
      />
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        className="cursor-pointer"
        onClick={handleClick}
      />
      <foreignObject
        x={labelX - 24}
        y={labelY - 10}
        width={48}
        height={20}
        className="pointer-events-none"
      >
        <div className="flex items-center justify-center h-full">
          <span className="text-[9px] bg-zinc-900/80 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-700/50">
            {wireCount}w
          </span>
        </div>
      </foreignObject>
    </g>
  );
}
