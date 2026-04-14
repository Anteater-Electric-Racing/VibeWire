import { memo } from 'react';
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import { useHarnessStore } from '../../store';
import {
  getWireBackground,
  getWireBorderColor,
  type WireAppearance,
} from '../../lib/colors';

type ConnectorNodeData = {
  label: string;
  parentName: string;
  connectorId: string;
  occupiedPins: Array<{
    pinNumber: number;
    pathId: string;
    signalName: string | null;
  }>;
  pinCount: number;
  matchesFilter: boolean;
  wireAppearance: WireAppearance | null;
  connectorTypeId?: string;
  instanceImage?: string;
};

type ConnectorNodeType = Node<ConnectorNodeData, 'connector'>;

export const ConnectorNode = memo(function ConnectorNode({
  data,
  selected,
}: NodeProps<ConnectorNodeType>) {
  const expandedNodes = useHarnessStore((s) => s.expandedNodes);
  const toggleExpanded = useHarnessStore((s) => s.toggleNodeExpanded);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const connectorLibrary = useHarnessStore((s) => s.connectorLibrary);
  const updateNodeSize = useHarnessStore((s) => s.updateNodeSize);
  const updateConnectorProperty = useHarnessStore((s) => s.updateConnectorProperty);
  const pushUndoSnapshot = useHarnessStore((s) => s.pushUndoSnapshot);
  const isExpanded = expandedNodes.has(data.connectorId);

  const ct = data.connectorTypeId
    ? connectorLibrary?.connector_types.find((t) => t.id === data.connectorTypeId)
    : undefined;
  const typeImg = ct?.side_image || ct?.image;

  // Instance image takes priority over connector-type image
  const displayImg = data.instanceImage
    ? { src: `/user-data/images/${data.instanceImage}`, isInstance: true }
    : typeImg
    ? { src: `/user-data/connectors/${typeImg}`, isInstance: false }
    : null;

  const borderColor = getWireBorderColor(data.wireAppearance);

  return (
    <div
      className={`w-full h-full rounded border overflow-hidden relative ${
        selected ? 'ring-1 ring-amber-400' : ''
      } ${data.matchesFilter ? 'opacity-100' : 'opacity-25'} transition-opacity`}
      style={{
        background: data.wireAppearance
          ? getWireBackground(data.wireAppearance, 0.15)
          : '#1e1e2e',
        borderColor,
      }}
    >
      <NodeResizer
        minWidth={0}
        minHeight={0}
        isVisible={!!selected}
        lineClassName="!border-amber-500/50"
        handleClassName="!w-2 !h-2 !bg-amber-400 !border-amber-600"
        onResizeStart={() => pushUndoSnapshot()}
        onResizeEnd={(_, params) => updateNodeSize(data.connectorId, params.width, params.height)}
      />

      <Handle
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !bg-zinc-400 !border-zinc-600"
        style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2 !h-2 !bg-zinc-400 !border-zinc-600"
        style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
      />

      {displayImg ? (
        // ── Image mode ────────────────────────────────────────────────────────
        <>
          <div
            className="w-full h-full cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              selectItem({ type: 'connector', id: data.connectorId });
            }}
          >
            <img
              src={displayImg.src}
              alt={data.label}
              draggable={false}
              className="w-full h-full object-contain pointer-events-none select-none"
            />
          </div>

          {/* Remove button — only for instance images, only when selected */}
          {selected && displayImg.isInstance && (
            <button
              className="absolute top-0.5 right-0.5 z-20 w-4 h-4 flex items-center justify-center rounded-full bg-zinc-900/80 text-zinc-400 hover:text-red-400 hover:bg-zinc-900 text-[9px] leading-none"
              title="Remove image"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                pushUndoSnapshot();
                updateConnectorProperty(data.connectorId, 'image', '');
              }}
            >
              ✕
            </button>
          )}

          {/* Expand toggle — small overlay in bottom-left */}
          <button
            className="absolute bottom-0.5 left-0.5 z-20 text-zinc-500 hover:text-zinc-300 text-[9px] leading-none bg-zinc-900/60 rounded px-0.5"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleExpanded(data.connectorId);
            }}
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        </>
      ) : (
        // ── Text mode ─────────────────────────────────────────────────────────
        <div
          className="bg-zinc-800 px-2 py-1 cursor-pointer flex items-center gap-1.5"
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
            <div className="text-xs font-bold text-zinc-100 leading-tight truncate">
              {data.label}
            </div>
            {data.parentName && (
              <div className="text-[10px] text-zinc-400 leading-tight truncate">
                {data.parentName}
              </div>
            )}
          </div>
        </div>
      )}

      {isExpanded && (
        <div className="border-t border-zinc-700/50 overflow-y-auto" style={{ maxHeight: 'calc(100% - 36px)' }}>
          {data.occupiedPins.length > 0 ? (
            data.occupiedPins.map((pin, index) => (
              <div
                key={`${pin.pathId}-${pin.pinNumber}-${index}`}
                className="px-2.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700/40 cursor-pointer flex items-center gap-1.5 border-b border-zinc-800 last:border-b-0"
                onClick={(e) => {
                  e.stopPropagation();
                  selectItem({ type: 'path', id: pin.pathId });
                }}
              >
                <span className="text-zinc-500 font-mono w-5 text-right shrink-0">
                  {pin.pinNumber}
                </span>
                <span className="text-zinc-300 truncate">{pin.pathId}</span>
                {pin.signalName && (
                  <span className="ml-auto shrink-0 text-[9px] px-1 rounded bg-zinc-700 text-zinc-400">
                    {pin.signalName}
                  </span>
                )}
              </div>
            ))
          ) : (
            <div className="px-2.5 py-1 text-[10px] text-zinc-500">
              No occupied pins
            </div>
          )}
        </div>
      )}
    </div>
  );
});
