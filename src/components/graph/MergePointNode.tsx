import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useHarnessStore } from '../../store';

type MergePointNodeData = {
  mergePointId: string;
  label: string;
  matchesFilter: boolean;
};

type MergePointNodeType = Node<MergePointNodeData, 'mergePoint'>;

export const MergePointNode = memo(function MergePointNode({
  data,
  selected,
}: NodeProps<MergePointNodeType>) {
  const selectItem = useHarnessStore((state) => state.selectItem);

  return (
    <div
      className={`min-w-[28px] min-h-[28px] rounded-full border-2 flex items-center justify-center px-2 text-[10px] font-medium cursor-pointer ${
        selected ? 'border-amber-400 ring-1 ring-amber-400/40' : 'border-cyan-700'
      } ${data.matchesFilter ? 'opacity-100' : 'opacity-25'} transition-opacity bg-cyan-950 text-cyan-200`}
      onClick={(event) => {
        event.stopPropagation();
        selectItem({ type: 'mergePoint', id: data.mergePointId });
      }}
      title={data.label}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !bg-cyan-400 !border-cyan-700"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2 !h-2 !bg-cyan-400 !border-cyan-700"
      />
      <span className="pointer-events-none whitespace-nowrap">{data.label}</span>
    </div>
  );
});
