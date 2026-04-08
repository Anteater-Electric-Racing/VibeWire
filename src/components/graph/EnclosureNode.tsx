import { memo, useCallback, useRef, useState, Fragment } from 'react';
import {
  Handle,
  Position,
  NodeResizer,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { useHarnessStore } from '../../store';
import type { PortEdge, PortPosition } from '../../types';

export interface PortInfo {
  id: string;
  name: string;
  signalColor: string;
}

type EnclosureNodeData = {
  enclosureId: string;
  label: string;
  tags: string[];
  bulkheadCount: number;
  headerCount: number;
  pcbCount: number;
  wireCount: number;
  ports: PortInfo[];
  matchesFilter: boolean;
};

type EnclosureNodeType = Node<EnclosureNodeData, 'enclosure'>;

const EDGE_TO_POSITION: Record<PortEdge, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

function getHandleStyle(
  edge: PortEdge,
  ratio: number,
): React.CSSProperties {
  const r = `${ratio * 100}%`;
  switch (edge) {
    case 'top':
      return { left: r, top: 0 };
    case 'right':
      return { top: r, right: 0 };
    case 'bottom':
      return { left: r, bottom: 0 };
    case 'left':
      return { top: r, left: 0 };
  }
}

function getPortTabStyle(
  edge: PortEdge,
  ratio: number,
): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    width: 44,
    height: 22,
    zIndex: 10,
  };
  switch (edge) {
    case 'right':
      return { ...base, right: -46, top: `calc(${ratio * 100}% - 11px)` };
    case 'left':
      return { ...base, left: -46, top: `calc(${ratio * 100}% - 11px)` };
    case 'top':
      return { ...base, top: -24, left: `calc(${ratio * 100}% - 22px)` };
    case 'bottom':
      return { ...base, bottom: -24, left: `calc(${ratio * 100}% - 22px)` };
  }
}

export const EnclosureNode = memo(function EnclosureNode({
  data,
  selected,
}: NodeProps<EnclosureNodeType>) {
  const portLayouts = useHarnessStore((s) => s.portLayouts);
  const updatePortLayout = useHarnessStore((s) => s.updatePortLayout);
  const updateNodeSize = useHarnessStore((s) => s.updateNodeSize);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const setDrillDown = useHarnessStore((s) => s.setDrillDown);
  const nodeRef = useRef<HTMLDivElement>(null);
  const [localPortPos, setLocalPortPos] = useState<
    Record<string, PortPosition>
  >({});
  const [hovered, setHovered] = useState(false);

  const getPortPos = useCallback(
    (portId: string): PortPosition => {
      if (localPortPos[portId]) return localPortPos[portId];
      if (portLayouts[portId]) return portLayouts[portId];
      const idx = data.ports.findIndex((p) => p.id === portId);
      const count = data.ports.length;
      return { edge: 'right' as PortEdge, ratio: (idx + 1) / (count + 1) };
    },
    [localPortPos, portLayouts, data.ports],
  );

  const handlePortDragStart = useCallback(
    (e: React.MouseEvent, portId: string) => {
      e.stopPropagation();
      e.preventDefault();

      const handleMove = (me: MouseEvent) => {
        if (!nodeRef.current) return;
        const rect = nodeRef.current.getBoundingClientRect();
        const x = me.clientX - rect.left;
        const y = me.clientY - rect.top;
        const w = rect.width;
        const h = rect.height;
        const distTop = y;
        const distBottom = h - y;
        const distLeft = x;
        const distRight = w - x;
        const minDist = Math.min(distTop, distBottom, distLeft, distRight);

        let edge: PortEdge;
        let ratio: number;
        if (minDist === distTop) {
          edge = 'top';
          ratio = Math.max(0.08, Math.min(0.92, x / w));
        } else if (minDist === distBottom) {
          edge = 'bottom';
          ratio = Math.max(0.08, Math.min(0.92, x / w));
        } else if (minDist === distLeft) {
          edge = 'left';
          ratio = Math.max(0.08, Math.min(0.92, y / h));
        } else {
          edge = 'right';
          ratio = Math.max(0.08, Math.min(0.92, y / h));
        }
        setLocalPortPos((prev) => ({ ...prev, [portId]: { edge, ratio } }));
      };

      const handleUp = () => {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        setLocalPortPos((prev) => {
          const pos = prev[portId];
          if (pos) updatePortLayout(portId, pos);
          const next = { ...prev };
          delete next[portId];
          return next;
        });
      };

      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
    },
    [updatePortLayout],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setDrillDown(data.enclosureId);
    },
    [setDrillDown, data.enclosureId],
  );

  const tagPills = data.tags
    .filter((t) => t.startsWith('system:') || t.startsWith('location:'))
    .map((t) => t.split(':')[1]);

  return (
    <div
      ref={nodeRef}
      className={`w-full h-full relative rounded-lg border-2 ${
        selected ? 'border-amber-400 ring-1 ring-amber-400/40' : 'border-zinc-600'
      } ${data.matchesFilter ? 'opacity-100' : 'opacity-25'} transition-opacity cursor-pointer group`}
      style={{ background: '#1a1a2e' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDoubleClick={handleDoubleClick}
    >
      <NodeResizer
        minWidth={180}
        minHeight={120}
        isVisible={!!selected}
        lineClassName="!border-amber-500/50"
        handleClassName="!w-2 !h-2 !bg-amber-400 !border-amber-600"
        onResizeEnd={(_, params) => {
          updateNodeSize(data.enclosureId, params.width, params.height);
        }}
      />

      <div className="p-3 select-none pointer-events-none">
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
          {data.pcbCount > 0 && (
            <div>{data.pcbCount} board{data.pcbCount !== 1 ? 's' : ''}</div>
          )}
          <div>
            {data.bulkheadCount > 0 && (
              <span>{data.bulkheadCount} bulkhead{data.bulkheadCount !== 1 ? 's' : ''}</span>
            )}
            {data.bulkheadCount > 0 && data.headerCount > 0 && (
              <span className="mx-1">·</span>
            )}
            {data.headerCount > 0 && (
              <span>{data.headerCount} header{data.headerCount !== 1 ? 's' : ''}</span>
            )}
          </div>
          <div>{data.wireCount} wire{data.wireCount !== 1 ? 's' : ''}</div>
        </div>
        {hovered && (
          <div className="text-[9px] text-zinc-600 mt-1 italic transition-opacity">
            Double-click to open
          </div>
        )}
      </div>

      {data.ports.map((port) => {
        const pos = getPortPos(port.id);
        const rfPos = EDGE_TO_POSITION[pos.edge];
        const tabStyle = getPortTabStyle(pos.edge, pos.ratio);

        return (
          <Fragment key={port.id}>
            <div
              className="nodrag nopan absolute flex items-center justify-center rounded text-[9px] font-mono text-zinc-200 cursor-grab active:cursor-grabbing select-none border-2 hover:brightness-125"
              style={{
                ...tabStyle,
                background:
                  port.signalColor !== '#666'
                    ? port.signalColor + '33'
                    : '#333',
                borderColor:
                  port.signalColor !== '#666' ? port.signalColor : '#555',
              }}
              onMouseDown={(e) => handlePortDragStart(e, port.id)}
              onClick={(e) => {
                e.stopPropagation();
                selectItem({ type: 'connector', id: port.id });
              }}
            >
              {port.name}
            </div>
            <Handle
              type="source"
              id={port.id}
              position={rfPos}
              style={getHandleStyle(pos.edge, pos.ratio)}
              className="!w-1 !h-1 !bg-transparent !border-0 !min-w-0 !min-h-0"
              isConnectable={false}
            />
            <Handle
              type="target"
              id={port.id}
              position={rfPos}
              style={getHandleStyle(pos.edge, pos.ratio)}
              className="!w-1 !h-1 !bg-transparent !border-0 !min-w-0 !min-h-0"
              isConnectable={false}
            />
          </Fragment>
        );
      })}
    </div>
  );
});
