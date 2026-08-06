import { memo, useCallback, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
  getWireBackground,
  getWireBorderColor,
  type WireAppearance,
} from '../../lib/colors';
import { getEffectivePinCount, getPathSignalId, getPathWireAppearance } from '../../lib/harness';

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
  wireAppearance: WireAppearance | null;
  connectorTypeId?: string;
  instanceImage?: string;
  wallMounted?: boolean;
};

const DARK_TAG_TEXT = '#09090b';
const LIGHT_TAG_TEXT = '#fafafa';

function relativeLuminance(hex: string): number | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first: number, second: number): number {
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function contrastingWireText(colors: string[]): { color: string; textShadow?: string } {
  const luminances = colors
    .map(relativeLuminance)
    .filter((value): value is number => value !== null);
  if (luminances.length === 0) return { color: LIGHT_TAG_TEXT };

  const darkLuminance = relativeLuminance(DARK_TAG_TEXT)!;
  const lightLuminance = relativeLuminance(LIGHT_TAG_TEXT)!;
  const darkContrast = Math.min(
    ...luminances.map((luminance) => contrastRatio(luminance, darkLuminance)),
  );
  const lightContrast = Math.min(
    ...luminances.map((luminance) => contrastRatio(luminance, lightLuminance)),
  );
  const useDarkText = darkContrast >= lightContrast;
  const minimumContrast = useDarkText ? darkContrast : lightContrast;
  const color = useDarkText ? DARK_TAG_TEXT : LIGHT_TAG_TEXT;

  if (minimumContrast >= 4.5) return { color };

  // Mixed light/dark stripes cannot share one high-contrast text color. Add an
  // opposite-color outline so the label remains legible across every stripe.
  const outline = useDarkText ? LIGHT_TAG_TEXT : DARK_TAG_TEXT;
  return {
    color,
    textShadow: [
      `-1px -1px 0 ${outline}`,
      `0 -1px 0 ${outline}`,
      `1px -1px 0 ${outline}`,
      `-1px 0 0 ${outline}`,
      `1px 0 0 ${outline}`,
      `-1px 1px 0 ${outline}`,
      `0 1px 0 ${outline}`,
      `1px 1px 0 ${outline}`,
    ].join(', '),
  };
}

type ConnectorNodeType = Node<ConnectorNodeData, 'connector'>;

type CavityDragPreview = {
  fromPin: number;
  targetPin: number | null;
  clientX: number;
  clientY: number;
  label: string;
};

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
  const commitUndoSnapshot = useHarnessStore((s) => s.commitUndoSnapshot);
  const renumberConnectorCavities = useHarnessStore((s) => s.renumberConnectorCavities);
  const harness = useHarnessStore((s) => s.harness);
  const isEditor = useHarnessStore((s) => s.session.isEditor);
  const rotation = useHarnessStore((s) => s.rotationLayouts[data.connectorId] ?? 0);
  const isExpanded = expandedNodes.has(data.connectorId);
  const showCavityHandles = isExpanded;
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
  const reorderCleanupRef = useRef<(() => void) | null>(null);
  const [nodeWidth, setNodeWidth] = useState(140);
  const [cavityDrag, setCavityDrag] = useState<CavityDragPreview | null>(null);
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

  useEffect(() => () => reorderCleanupRef.current?.(), []);

  const beginCavityDrag = useCallback((
    event: React.PointerEvent,
    fromPin: number,
    label: string,
  ) => {
    if (!isEditor || event.button !== 0) return;
    const pointerId = event.pointerId;
    reorderCleanupRef.current?.();
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = 'grabbing';
    setCavityDrag({
      fromPin,
      targetPin: null,
      clientX: event.clientX,
      clientY: event.clientY,
      label,
    });

    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
      document.body.style.cursor = previousCursor;
      reorderCleanupRef.current = null;
    };
    const targetAtPointer = (pointerEvent: PointerEvent) => {
      const targetRow = document
        .elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)
        ?.closest<HTMLElement>('[data-cavity-pin]');
      const targetPin = Number(targetRow?.dataset.cavityPin);
      return targetRow?.dataset.connectorId === data.connectorId
        && Number.isInteger(targetPin)
        && targetPin >= 1
        && targetPin <= handlePinCount
        && targetPin !== fromPin
        ? targetPin
        : null;
    };
    const handlePointerMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      setCavityDrag({
        fromPin,
        targetPin: targetAtPointer(pointerEvent),
        clientX: pointerEvent.clientX,
        clientY: pointerEvent.clientY,
        label,
      });
    };
    const handlePointerUp = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      const targetPin = targetAtPointer(pointerEvent);
      cleanup();
      setCavityDrag(null);
      if (targetPin === null) return;

      const cavityOrder = Array.from({ length: handlePinCount }, (_, index) => index + 1);
      const fromIndex = cavityOrder.indexOf(fromPin);
      const toIndex = cavityOrder.indexOf(targetPin);
      cavityOrder.splice(toIndex, 0, cavityOrder.splice(fromIndex, 1)[0]);
      renumberConnectorCavities(data.connectorId, cavityOrder);
    };
    const handlePointerCancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      cleanup();
      setCavityDrag(null);
    };

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerCancel, true);
    reorderCleanupRef.current = () => {
      cleanup();
      setCavityDrag(null);
    };
  }, [data.connectorId, handlePinCount, isEditor, renumberConnectorCavities]);

  return (
    <>
      <div
      ref={nodeRef}
      className={`w-full h-full rounded border overflow-visible relative ${
        selected ? 'ring-1 ring-amber-400' : ''
      }`}
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
        isVisible={!!selected && isEditor}
        lineClassName="!border-amber-500/50"
        handleClassName="!w-2 !h-2 !bg-amber-400 !border-amber-600"
        onResizeStart={() => pushUndoSnapshot(`connector:${data.connectorId}:resize`)}
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
            commitUndoSnapshot();
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
            commitUndoSnapshot();
            return;
          }
          updateNodeSize(data.connectorId, params.width, params.height);
          commitUndoSnapshot();
        }}
      />

      {!isExpanded && (
        <>
          <Handle type="target" position={Position.Left} isConnectable={isEditor} className="!w-2 !h-2 !bg-zinc-400 !border-zinc-600" />
          <Handle type="source" position={Position.Right} isConnectable={isEditor} className="!w-2 !h-2 !bg-zinc-400 !border-zinc-600" />
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
          {cavityRows.map((row) => {
            const pin = row.occupancy;
            const signalPath = pin
              ? harness?.paths.find((candidate) => candidate.id === pin.pathId)
              : undefined;
            const signalId = signalPath ? getPathSignalId(signalPath) : undefined;
            const wireAppearance = signalPath && harness
              ? getPathWireAppearance(signalPath, harness)
              : null;
            const wireHandleBackground = wireAppearance
              ? getWireBackground(wireAppearance)
              : undefined;
            const signalTagText = wireAppearance
              ? contrastingWireText(wireAppearance.colors)
              : undefined;
            const wireName = pin
              ? (pin.pathName ?? signalPath?.name ?? pin.pathId)
              : 'Empty';
            const connectorNodeIndex = signalPath?.nodes.findIndex((node) =>
              node.kind === 'connector'
              && node.connector_id === data.connectorId
              && node.pin_number === row.pinNumber
            ) ?? -1;
            const isThroughBulkhead = data.wallMounted
              && connectorNodeIndex > 0
              && connectorNodeIndex < (signalPath?.nodes.length ?? 0) - 1;
            const cavityStatus = !pin
              ? ''
              : data.wallMounted && !isThroughBulkhead
                ? ' (one side connected; opposite side available)'
                : ' (occupied)';
            const isDragSource = cavityDrag?.fromPin === row.pinNumber;
            const isDropTarget = cavityDrag?.targetPin === row.pinNumber;
            const insertionShadow = !isDropTarget
              ? undefined
              : cavityDrag.fromPin < row.pinNumber
                ? 'inset 0 -2px 0 #f59e0b'
                : 'inset 0 2px 0 #f59e0b';
            return (
              <div
                key={`${row.pinNumber}-${pin?.pathId ?? 'empty'}`}
                data-connector-id={data.connectorId}
                data-cavity-pin={row.pinNumber}
                className={`nodrag nopan relative px-3 py-1 text-zinc-400 hover:bg-zinc-700/40 cursor-pointer flex items-center gap-1.5 border-b border-zinc-800 last:border-b-0 transition-[opacity,background-color,box-shadow] ${
                  isEditor ? '' : 'select-none'
                } ${isDragSource ? 'opacity-35' : ''} ${isDropTarget ? 'bg-amber-500/15' : ''}`}
                style={{ fontSize: subSize, boxShadow: insertionShadow }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (pin) selectItem({ type: 'path', id: pin.pathId });
                }}
              >
                {showCavityHandles && (
                  <span
                    className="contents"
                    onPointerDownCapture={(event) =>
                      beginCavityDrag(event, row.pinNumber, wireName)}
                  >
                    <Handle
                      id={`pin:${row.pinNumber}`}
                      type="source"
                      position={Position.Left}
                      isConnectable={isEditor}
                      className={`!relative !left-auto !top-auto !flex !h-4 !min-h-4 !w-4 !min-w-4 !transform-none !items-center !justify-center !rounded-sm !border-zinc-900 ${
                        pin ? '' : '!bg-amber-400'
                      } ${isEditor ? '!cursor-crosshair' : '!cursor-not-allowed'}`}
                      style={wireHandleBackground
                        ? { background: wireHandleBackground, borderColor: '#18181b' }
                        : undefined}
                      title={isEditor
                        ? `Cavity ${row.pinNumber}${cavityStatus}. Drag to connect; drop on another cavity here to reorder.`
                        : `Cavity ${row.pinNumber}${cavityStatus}`}
                    >
                      <span className="pointer-events-none text-[10px] leading-none text-zinc-950">⠿</span>
                    </Handle>
                  </span>
                )}
                <span className="text-zinc-500 font-mono w-5 text-right shrink-0">
                  {row.pinNumber}
                </span>
                <span className="text-zinc-300 truncate">{wireName}</span>
                {pin?.signalName && wireAppearance && wireHandleBackground && signalTagText && (
                  <button
                    className="ml-auto shrink-0 px-1 rounded"
                    style={{
                      fontSize: Math.max(7, subSize - 1),
                      background: wireHandleBackground,
                      ...signalTagText,
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
      {cavityDrag && createPortal(
        <div
          className="pointer-events-none fixed z-[10000] w-52 rounded border border-amber-400 bg-zinc-900/95 px-2.5 py-2 text-xs text-zinc-100 shadow-2xl shadow-black/60"
          style={{
            left: cavityDrag.clientX + 14,
            top: cavityDrag.clientY + 14,
          }}
        >
          <div className="flex items-center gap-2">
            <span className="flex h-5 min-w-5 items-center justify-center rounded bg-amber-400 px-1 font-mono font-bold text-zinc-950">
              {cavityDrag.fromPin}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{cavityDrag.label}</span>
            {cavityDrag.targetPin !== null && (
              <span className="shrink-0 font-mono text-amber-300">
                → {cavityDrag.targetPin}
              </span>
            )}
          </div>
          <div className="mt-1 text-[9px] text-zinc-400">
            {cavityDrag.targetPin !== null
              ? `Move to cavity ${cavityDrag.targetPin}`
              : 'Drop here to reorder, or on another connector to connect'}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
});
