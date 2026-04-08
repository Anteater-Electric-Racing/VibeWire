import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { Pin } from '../../types';
import { useHarnessStore } from '../../store';

type ConnectorNodeData = {
  label: string;
  parentName: string;
  connectorId: string;
  pins: Pin[];
  isHeader: boolean;
  matchesFilter: boolean;
};

type ConnectorNodeType = Node<ConnectorNodeData, 'connector'>;

export const ConnectorNode = memo(function ConnectorNode({
  data,
  selected,
}: NodeProps<ConnectorNodeType>) {
  const expandedNodes = useHarnessStore((s) => s.expandedNodes);
  const toggleExpanded = useHarnessStore((s) => s.toggleNodeExpanded);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const isExpanded = expandedNodes.has(data.connectorId);

  const borderColor = data.isHeader
    ? 'border-teal-600'
    : 'border-zinc-500';
  const headerBg = data.isHeader ? 'bg-teal-900/40' : 'bg-zinc-800';

  return (
    <div
      className={`rounded border ${borderColor} ${
        selected ? 'ring-1 ring-amber-400' : ''
      } ${data.matchesFilter ? 'opacity-100' : 'opacity-25'} transition-opacity min-w-[140px]`}
      style={{ background: '#1e1e2e' }}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-zinc-400 !border-zinc-600" />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-zinc-400 !border-zinc-600" />

      <div
        className={`${headerBg} px-2.5 py-1.5 cursor-pointer flex items-center gap-1.5 rounded-t`}
        onClick={(e) => {
          e.stopPropagation();
          selectItem({ type: 'connector', id: data.connectorId });
        }}
      >
        <button
          className="text-zinc-500 hover:text-zinc-300 text-[10px] w-3 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            toggleExpanded(data.connectorId);
          }}
        >
          {isExpanded ? '▼' : '▶'}
        </button>
        <div className="min-w-0">
          <div className="text-xs font-bold text-zinc-100 leading-tight">
            {data.label}
          </div>
          <div className="text-[10px] text-zinc-400 leading-tight truncate">
            {data.parentName}
            {data.isHeader && (
              <span className="ml-1 text-teal-400">(header)</span>
            )}
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-zinc-700/50">
          {data.pins.map((pin: Pin) => (
            <div
              key={pin.id}
              className="px-2.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700/40 cursor-pointer flex items-center gap-1.5 border-b border-zinc-800 last:border-b-0"
              onClick={(e) => {
                e.stopPropagation();
                selectItem({ type: 'pin', id: pin.id });
              }}
            >
              <span className="text-zinc-500 font-mono w-3 text-right shrink-0">
                {pin.pin_number}
              </span>
              <span className="text-zinc-300">{pin.name}</span>
              {pin.tags
                .filter((t: string) => t.startsWith('signal:'))
                .map((t: string) => (
                  <span
                    key={t}
                    className="ml-auto text-[9px] px-1 rounded bg-zinc-700 text-zinc-400"
                  >
                    {t.slice(7)}
                  </span>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
