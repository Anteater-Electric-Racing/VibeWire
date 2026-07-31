import { memo, useRef, useState, useEffect } from 'react';
import {
  Handle,
  NodeResizer,
  Position,
  useUpdateNodeInternals,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { useHarnessStore } from '../../store';
import {
  getSignalColor,
  getWireAppearance,
  getWireBackground,
  getWireBorderColor,
  type WireAppearance,
} from '../../lib/colors';
import { getEffectivePinCount, getPathSignalId } from '../../lib/harness';

type ConnectorNodeData = {
  label: string;
  parentName: string;
  connectorId: string;
  occupiedPins: Array<{
    pinNumber: number;
    pathId: string;
    pathName?: string;
    signalName: string | null;
  }>;
  pinCount: number;
  matchesFilter: boolean;
  wireAppearance: WireAppearance | null;
  connectorTypeId?: string;
  instanceImage?: string;
};

function contrastingText(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return '#f4f4f5';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#18181b' : '#f4f4f5';
}

type ConnectorNodeType = Node<ConnectorNodeData, 'connector'>;

export const ConnectorNode = memo(function ConnectorNode({
  id,
  data,
  selected,
}: NodeProps<ConnectorNodeType>) {
  const expandedNodes = useHarnessStore((s) => s.expandedNodes);
  const toggleExpanded = useHarnessStore((s) => s.toggleNodeExpanded);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const connectorLibrary = useHarnessStore((s) => s.connectorLibrary);
  const updateNodeSize = useHarnessStore((s) => s.updateNodeSize);
  const updateExpandedNodeSize = useHarnessStore((s) => s.updateExpandedNodeSize);
  const editingSurface = useHarnessStore((s) => s.editingSurface);
  const activeSubsystemId = useHarnessStore((s) => s.activeSubsystemId);
  const subsystems = useHarnessStore((s) => s.subsystems);
  const updateSubsystemEntityLayout = useHarnessStore((s) => s.updateSubsystemEntityLayout);
  const pushUndoSnapshot = useHarnessStore((s) => s.pushUndoSnapshot);
  const pushStructuralSnapshot = useHarnessStore((s) => s.pushStructuralSnapshot);
  const renumberConnectorCavities = useHarnessStore((s) => s.renumberConnectorCavities);
  const harness = useHarnessStore((s) => s.harness);
  const rotation = useHarnessStore((s) => s.rotationLayouts[data.connectorId] ?? 0);
  const isExpanded = expandedNodes.has(data.connectorId);
  const showCavityHandles = isExpanded;
  const [draggedPin, setDraggedPin] = useState<number | null>(null);
  const updateNodeInternals = useUpdateNodeInternals();

  const ct = data.connectorTypeId
    ? connectorLibrary?.connector_types.find((t) => t.id === data.connectorTypeId)
    : undefined;
  const connector = harness?.connectors.find((item) => item.id === data.connectorId);
  const handlePinCount = Math.max(
    connector ? getEffectivePinCount(connector, ct) : (ct?.pin_count ?? 0),
    ...data.occupiedPins.map((pin) => pin.pinNumber),
    1,
  );
  const cavityRows = Array.from({ length: handlePinCount }, (_, index) => {
    const pinNumber = index + 1;
    return { pinNumber, occupancy: data.occupiedPins.find((pin) => pin.pinNumber === pinNumber) };
  });

  const borderColor = getWireBorderColor(data.wireAppearance);

  // Track live node width via ResizeObserver so text scales in real-time during drag
  const nodeRef = useRef<HTMLDivElement>(null);
  const [nodeWidth, setNodeWidth] = useState(140);
  useEffect(() => {
    const el = nodeRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setNodeWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fontScale = Math.min(1, Math.max(0.5, nodeWidth / 140));
  const labelSize = Math.max(8, Math.round(12 * fontScale));
  const subSize = Math.max(7, Math.round(10 * fontScale));

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, showCavityHandles, handlePinCount, nodeWidth, updateNodeInternals]);

  return (
    <div
      ref={nodeRef}
      className={`w-full h-full rounded border overflow-visible relative ${
        selected ? 'ring-1 ring-amber-400' : ''
      } ${data.matchesFilter ? 'opacity-100' : 'opacity-25'} transition-opacity`}
      style={{
        background: data.wireAppearance
          ? getWireBackground(data.wireAppearance, 0.15)
          : '#1e1e2e',
        borderColor,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: 'center center',
      }}
    >
      <NodeResizer
        minWidth={0}
        minHeight={0}
        isVisible={!!selected}
        lineClassName="!border-amber-500/50"
        handleClassName="!w-2 !h-2 !bg-amber-400 !border-amber-600"
        onResizeStart={() => pushUndoSnapshot()}
        onResizeEnd={(_, params) => {
          // Manual resize while expanded is session-only; collapse restores the
          // persisted collapsed size.
          if (isExpanded) {
            updateExpandedNodeSize(data.connectorId, params.width, params.height);
            if (editingSurface === 'subsystem' && activeSubsystemId) {
              const previous = subsystems[activeSubsystemId]?.connectors[data.connectorId];
              updateSubsystemEntityLayout('connectors', data.connectorId, {
                ...previous,
                x: params.x,
                y: params.y,
                w: previous?.w,
                h: previous?.h,
              });
            }
            return;
          }
          if (editingSurface === 'subsystem' && activeSubsystemId) {
            const previous = subsystems[activeSubsystemId]?.connectors[data.connectorId];
            updateSubsystemEntityLayout('connectors', data.connectorId, {
              ...previous,
              x: params.x,
              y: params.y,
              w: params.width,
              h: params.height,
            });
            return;
          }
          updateNodeSize(data.connectorId, params.width, params.height);
        }}
      />

      {!isExpanded && (
        <>
          <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-zinc-400 !border-zinc-600" />
          <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-zinc-400 !border-zinc-600" />
        </>
      )}

      <div
        className="bg-zinc-800 px-2 py-1 cursor-pointer flex items-center gap-1.5"
        onClick={(e) => {
          e.stopPropagation();
          selectItem({ type: 'connector', id: data.connectorId });
        }}
      >
        <button
          className="text-zinc-500 hover:text-zinc-300 w-3 shrink-0"
          style={{ fontSize: subSize }}
          onClick={(e) => {
            e.stopPropagation();
            toggleExpanded(data.connectorId);
          }}
        >
          {isExpanded ? '▼' : '▶'}
        </button>
        <div className="min-w-0">
          <div className="font-bold text-zinc-100 leading-tight truncate" style={{ fontSize: labelSize }}>
            {data.label}
          </div>
          {data.parentName && (
            <div className="text-zinc-400 leading-tight truncate" style={{ fontSize: subSize }}>
              {data.parentName}
            </div>
          )}
        </div>
        {!isExpanded && data.instanceImage && (
          <img
            src={`/user-data/images/${data.instanceImage}`}
            alt=""
            className="ml-auto h-6 w-8 shrink-0 rounded object-contain bg-zinc-900/60"
          />
        )}
      </div>

      {isExpanded && (
        <div className="border-t border-zinc-700/50 overflow-y-auto" style={{ maxHeight: 'calc(100% - 36px)' }}>
          {cavityRows.map((row, index) => {
            const pin = row.occupancy;
            const signalPath = pin
              ? harness?.paths.find((candidate) => candidate.id === pin.pathId)
              : undefined;
            const signalId = signalPath ? getPathSignalId(signalPath) : undefined;
            const wireAppearance = signalPath ? getWireAppearance(signalPath) : null;
            const wireHandleBackground = wireAppearance
              ? getWireBackground(wireAppearance)
              : undefined;
            const signalColor = pin?.signalName ? getSignalColor(pin.signalName) : null;
            const wireName = pin
              ? (pin.pathName ?? signalPath?.name ?? pin.pathId)
              : 'Empty';
            return (
              <div
                key={`${row.pinNumber}-${pin?.pathId ?? 'empty'}-${index}`}
                draggable
                className="nodrag nopan relative px-3 py-1 text-zinc-400 hover:bg-zinc-700/40 cursor-pointer flex items-center gap-1.5 border-b border-zinc-800 last:border-b-0"
                style={{ fontSize: subSize }}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', String(row.pinNumber));
                  setDraggedPin(row.pinNumber);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (draggedPin === null || draggedPin === row.pinNumber) return;
                  const order = cavityRows.map((candidate) => candidate.pinNumber);
                  const fromIndex = order.indexOf(draggedPin);
                  const toIndex = order.indexOf(row.pinNumber);
                  order.splice(toIndex, 0, order.splice(fromIndex, 1)[0]);
                  pushStructuralSnapshot();
                  renumberConnectorCavities(data.connectorId, order);
                  setDraggedPin(null);
                }}
                onDragEnd={() => setDraggedPin(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (pin) selectItem({ type: 'path', id: pin.pathId });
                }}
              >
                {showCavityHandles && (
                  <>
                    <Handle
                      id={`pin:${row.pinNumber}`}
                      type="target"
                      position={Position.Left}
                      className={`!w-2.5 !h-2.5 ${pin ? '' : '!bg-amber-400'} !border-zinc-900`}
                      style={{
                        top: '50%',
                        ...(wireHandleBackground
                          ? { background: wireHandleBackground, borderColor: '#18181b' }
                          : {}),
                      }}
                      title={`Cavity ${row.pinNumber}${pin ? ' (occupied)' : ''}`}
                    />
                    <Handle
                      id={`pin:${row.pinNumber}`}
                      type="source"
                      position={Position.Right}
                      className={`!w-2.5 !h-2.5 ${pin ? '' : '!bg-amber-400'} !border-zinc-900`}
                      style={{
                        top: '50%',
                        ...(wireHandleBackground
                          ? { background: wireHandleBackground, borderColor: '#18181b' }
                          : {}),
                      }}
                      title={`Cavity ${row.pinNumber}${pin ? ' (occupied)' : ''}`}
                    />
                  </>
                )}
                <span className="text-zinc-600 cursor-grab" title="Drag to physically renumber cavities">⠿</span>
                <span className="text-zinc-500 font-mono w-5 text-right shrink-0">
                  {row.pinNumber}
                </span>
                <span className="text-zinc-300 truncate">{wireName}</span>
                {pin?.signalName && signalColor && (
                  <button
                    className="ml-auto shrink-0 px-1 rounded"
                    style={{
                      fontSize: Math.max(7, subSize - 1),
                      background: signalColor,
                      color: contrastingText(signalColor),
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      if (signalId) selectItem({ type: 'signal', id: signalId });
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (signalId) selectItem({ type: 'signal', id: signalId });
                    }}
                    title="Double-click or right-click to edit signal"
                  >
                    {pin.signalName}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
