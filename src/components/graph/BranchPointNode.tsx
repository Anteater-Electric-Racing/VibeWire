import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useSystemStore } from '../../store';
import { PresenceBadge } from '../collab/PresenceBadge';

type BranchPointNodeData = {
  branchPointId: string;
  label: string;
  mergeTarget?: boolean;
};

type BranchPointNodeType = Node<BranchPointNodeData, 'branchPoint'>;

export const BranchPointNode = memo(function BranchPointNode({
  data,
  selected,
}: NodeProps<BranchPointNodeType>) {
  const selectItem = useSystemStore((state) => state.selectItem);
  const isEditor = useSystemStore((state) => state.session.isEditor);

  return (
    <div
      className={`relative min-w-[28px] min-h-[28px] rounded-full border-2 flex items-center justify-center px-2 text-[10px] font-medium cursor-pointer ${
        selected
          ? 'border-amber-400 ring-1 ring-amber-400/40'
          : data.mergeTarget
            ? 'border-sky-400 ring-2 ring-sky-400'
            : 'border-cyan-700'
      } bg-cyan-950 text-cyan-200`}
      onClick={(event) => {
        event.stopPropagation();
        selectItem({ type: 'branchPoint', id: data.branchPointId });
      }}
      title={data.mergeTarget ? `Release to fuse into ${data.label}` : data.label}
    >
      <PresenceBadge
        kind="branchPoint"
        id={data.branchPointId}
        className="pointer-events-auto absolute -right-2 -top-2 z-30"
      />
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isEditor}
        className="!w-2 !h-2 !bg-cyan-400 !border-cyan-700"
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={isEditor}
        className="!w-2 !h-2 !bg-cyan-400 !border-cyan-700"
      />
      <span className="pointer-events-none whitespace-nowrap">{data.label}</span>
    </div>
  );
});
