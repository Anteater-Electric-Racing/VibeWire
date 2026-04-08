import {
  BaseEdge,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { getSignalColor, getSignalFromTags } from '../../lib/colors';
import { useHarnessStore } from '../../store';

type SignalEdgeData = {
  wireId: string;
  tags: string[];
  matchesFilter: boolean;
};

type SignalEdgeType = Edge<SignalEdgeData, 'signal'>;

export function SignalEdge(props: EdgeProps<SignalEdgeType>) {
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

  const selectItem = useHarnessStore((s) => s.selectItem);

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const signal = data ? getSignalFromTags(data.tags) : null;
  const color = signal ? getSignalColor(signal) : '#7c3aed';
  const matchesFilter = data?.matchesFilter ?? true;

  return (
    <g
      onClick={(e) => {
        e.stopPropagation();
        if (data?.wireId) {
          selectItem({ type: 'wire', id: data.wireId });
        }
      }}
      className="cursor-pointer"
    >
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: selected ? 3 : 2,
          opacity: matchesFilter ? 1 : 0.15,
          transition: 'opacity 0.2s',
          filter: selected ? `drop-shadow(0 0 4px ${color})` : undefined,
        }}
      />
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        className="cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          if (data?.wireId) {
            selectItem({ type: 'wire', id: data.wireId });
          }
        }}
      />
    </g>
  );
}
