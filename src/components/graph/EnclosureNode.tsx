import { memo, useCallback, useRef, useState } from 'react';
import {
  NodeResizer,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { useHarnessStore } from '../../store';

type EnclosureNodeData = {
  enclosureId: string;
  label: string;
  tags: string[];
  connectorCount: number;
  pathCount: number;
  matchesFilter: boolean;
  isContainer: boolean;
  image?: string;
  childEnclosureCount: number;
};

type EnclosureNodeType = Node<EnclosureNodeData, 'enclosure'>;

export const EnclosureNode = memo(function EnclosureNode({
  data,
  selected,
}: NodeProps<EnclosureNodeType>) {
  const updateNodeSize = useHarnessStore((s) => s.updateNodeSize);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const setDrillDown = useHarnessStore((s) => s.setDrillDown);
  const pushUndoSnapshot = useHarnessStore((s) => s.pushUndoSnapshot);
  const nodeRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!data.isContainer) return;
      e.stopPropagation();
      setDrillDown(data.enclosureId);
    },
    [setDrillDown, data.enclosureId, data.isContainer],
  );

  const tagPills = data.tags
    .filter((t) => t.startsWith('system:') || t.startsWith('location:'))
    .map((t) => t.split(':')[1]);

  const borderColor = data.isContainer ? 'border-zinc-600' : 'border-teal-700';
  const bgColor = data.isContainer ? '#1a1a2e' : '#0d2b2b';

  return (
    <div
      ref={nodeRef}
      className={`w-full h-full relative rounded-lg border-2 ${
        selected ? 'border-amber-400 ring-1 ring-amber-400/40' : borderColor
      } ${data.matchesFilter ? 'opacity-100' : 'opacity-25'} transition-opacity cursor-pointer group`}
      style={{ background: bgColor }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => { e.stopPropagation(); selectItem({ type: 'enclosure', id: data.enclosureId }); }}
      onDoubleClick={handleDoubleClick}
    >
      <NodeResizer
        minWidth={180}
        minHeight={120}
        isVisible={!!selected}
        lineClassName="!border-amber-500/50"
        handleClassName="!w-2 !h-2 !bg-amber-400 !border-amber-600"
        onResizeStart={() => pushUndoSnapshot()}
        onResizeEnd={(_, params) => {
          updateNodeSize(data.enclosureId, params.width, params.height);
        }}
      />

      {data.image && (
        <div className="absolute inset-0 overflow-hidden rounded-lg pointer-events-none">
          <img
            src={`/user-data/images/${data.image}`}
            alt=""
            draggable={false}
            className="w-full h-full object-contain select-none"
          />
        </div>
      )}

      <div className={`p-3 select-none pointer-events-none relative z-10 ${data.image ? 'bg-zinc-900/60' : ''}`}>
        <div className="text-sm font-bold text-zinc-100 leading-tight">
          {data.label}
        </div>
        {tagPills.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {tagPills.map((tag) => (
              <span
                key={tag}
                className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-400"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        <div className="text-[10px] text-zinc-500 mt-2 space-y-0.5">
          {data.childEnclosureCount > 0 && (
            <div>{data.childEnclosureCount} sub-enclosure{data.childEnclosureCount !== 1 ? 's' : ''}</div>
          )}
          {data.connectorCount > 0 && (
            <div>{data.connectorCount} connector{data.connectorCount !== 1 ? 's' : ''}</div>
          )}
          <div>{data.pathCount} path{data.pathCount !== 1 ? 's' : ''}</div>
        </div>
        {hovered && data.isContainer && (
          <div className="text-[9px] text-zinc-600 mt-1 italic transition-opacity">
            Double-click to open
          </div>
        )}
      </div>
    </div>
  );
});
