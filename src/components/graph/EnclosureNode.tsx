import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Handle,
  NodeResizer,
  Position,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { useSystemStore } from '../../store';
import { DEVICE_COLOR, ENCLOSURE_COLOR, enclosureShell } from '../../lib/entityColors';
import { fitTextToBox, TEXT_BOX_FONT_FAMILY } from '../../lib/textBoxes';
import { PresenceBadge } from '../collab/PresenceBadge';

type EnclosureNodeData = {
  enclosureId: string;
  label: string;
  connectorCount: number;
  pathCount: number;
  isContainer: boolean;
  image?: string;
  fillColor?: string;
  childEnclosureCount: number;
  subsystemFrame?: boolean;
  subsystemDevice?: boolean;
  summaryConnector?: boolean;
};

type EnclosureNodeType = Node<EnclosureNodeData, 'enclosure'>;

export const EnclosureNode = memo(function EnclosureNode({
  data,
  selected,
}: NodeProps<EnclosureNodeType>) {
  const resizeHierarchyEntityLayout = useSystemStore((s) => s.resizeHierarchyEntityLayout);
  const selectItem = useSystemStore((s) => s.selectItem);
  const setOpenEnclosure = useSystemStore((s) => s.setOpenEnclosure);
  const pushUndoSnapshot = useSystemStore((s) => s.pushUndoSnapshot);
  const commitUndoSnapshot = useSystemStore((s) => s.commitUndoSnapshot);
  const isEditor = useSystemStore((s) => s.session.isEditor);
  const rotation = useSystemStore((s) => s.rotationLayouts[data.enclosureId] ?? 0);
  const subsystem = useSystemStore((s) => s.activeSubsystemId ? s.subsystems[s.activeSubsystemId] : undefined);
  const resizeSubsystemEntityLayout = useSystemStore((s) => s.resizeSubsystemEntityLayout);
  const titleRef = useRef<HTMLDivElement>(null);
  const resizeStartRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const [hovered, setHovered] = useState(false);
  const [titleSize, setTitleSize] = useState(14);
  const hasImage = Boolean(data.image);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (data.subsystemFrame || data.subsystemDevice) {
        e.stopPropagation();
        selectItem({ type: 'enclosure', id: data.enclosureId });
        return;
      }
      if (!data.isContainer) return;
      e.stopPropagation();
      setOpenEnclosure(data.enclosureId);
    },
    [selectItem, setOpenEnclosure, data.enclosureId, data.isContainer, data.subsystemFrame, data.subsystemDevice],
  );

  useEffect(() => {
    if (hasImage) return;
    const el = titleRef.current;
    if (!el) return;
    const update = () => {
      setTitleSize(fitTextToBox({
        text: data.label,
        width: el.clientWidth,
        height: Math.max(18, el.clientHeight),
        fontFamily: TEXT_BOX_FONT_FAMILY.sans,
        fontWeight: 'bold',
        lineHeight: 1.15,
        minSize: 10,
        maxSize: 36,
        whiteSpace: 'nowrap',
      }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [data.label, hasImage]);

  const nameColor = data.isContainer ? ENCLOSURE_COLOR : DEVICE_COLOR;
  const shell = enclosureShell(data.isContainer, data.fillColor);

  return (
    <div
      className={`w-full h-full relative rounded-lg ${
        selected ? 'ring-1 ring-amber-400/40' : ''
      } cursor-pointer group`}
      style={{
        background: shell.fill,
        borderStyle: 'solid',
        borderWidth: shell.borderWidth,
        borderColor: selected ? '#fbbf24' : shell.border,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => { e.stopPropagation(); selectItem({ type: 'enclosure', id: data.enclosureId }); }}
      onDoubleClick={handleDoubleClick}
    >
      <PresenceBadge
        kind="enclosure"
        id={data.enclosureId}
        className="pointer-events-auto absolute right-1 top-1 z-30"
      />
      {data.summaryConnector && (
        <>
          <Handle
            id="summary-left"
            type="target"
            position={Position.Left}
            className="!h-2 !w-2 !border-zinc-700 !bg-zinc-400"
          />
          <Handle
            id="summary-right"
            type="source"
            position={Position.Right}
            className="!h-2 !w-2 !border-zinc-700 !bg-zinc-400"
          />
          <Handle
            id="summary-top"
            type="target"
            position={Position.Top}
            className="!h-2 !w-2 !border-zinc-700 !bg-zinc-400"
          />
          <Handle
            id="summary-bottom"
            type="source"
            position={Position.Bottom}
            className="!h-2 !w-2 !border-zinc-700 !bg-zinc-400"
          />
        </>
      )}
      <NodeResizer
        minWidth={180}
        minHeight={120}
        isVisible={!!selected && isEditor}
        lineClassName="!border-amber-500/50"
        handleClassName="!w-2 !h-2 !bg-amber-400 !border-amber-600"
        onResizeStart={(_, params) => {
          resizeStartRef.current = {
            x: params.x,
            y: params.y,
            w: params.width,
            h: params.height,
          };
          pushUndoSnapshot(`enclosure:${data.enclosureId}:resize`);
        }}
        onResizeEnd={(_, params) => {
          const previousRenderedLayout = resizeStartRef.current ?? {
            x: params.x,
            y: params.y,
            w: params.width,
            h: params.height,
          };
          const nextLayout = {
            x: params.x,
            y: params.y,
            w: params.width,
            h: params.height,
          };
          if (data.subsystemFrame) {
            const previous = subsystem?.enclosures[data.enclosureId];
            resizeSubsystemEntityLayout('enclosures', data.enclosureId, {
              ...previous,
              ...nextLayout,
            }, previousRenderedLayout);
          } else if (data.subsystemDevice) {
            const previous = subsystem?.devices[data.enclosureId];
            resizeSubsystemEntityLayout('devices', data.enclosureId, {
              ...previous,
              ...nextLayout,
            }, previousRenderedLayout);
          } else {
            resizeHierarchyEntityLayout(
              data.enclosureId,
              previousRenderedLayout,
              nextLayout,
            );
          }
          resizeStartRef.current = null;
          commitUndoSnapshot();
        }}
      />

      {hasImage && (
        <div
          className="absolute inset-0 overflow-hidden rounded-lg pointer-events-none"
          style={{ containerType: 'size' }}
        >
          <img
            src={`/user-data/images/${data.image}`}
            alt=""
            draggable={false}
            className="absolute left-1/2 top-1/2 max-w-none object-contain select-none"
            style={{
              width: rotation % 180 === 0 ? '100cqw' : '100cqh',
              height: rotation % 180 === 0 ? '100cqh' : '100cqw',
              transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
              transformOrigin: 'center center',
            }}
          />
        </div>
      )}

      {!hasImage && (
        <div className="p-3 select-none pointer-events-none relative z-10 h-full flex flex-col">
          <div ref={titleRef} className="min-h-0 flex-1">
            <div
              className="font-bold leading-tight"
              style={{ fontSize: titleSize, color: nameColor }}
            >
              {data.label}
            </div>
          </div>
          <div className="text-[10px] text-zinc-500 mt-2 space-y-0.5 shrink-0">
            {data.childEnclosureCount > 0 && (
              <div>{data.childEnclosureCount} sub-enclosure{data.childEnclosureCount !== 1 ? 's' : ''}</div>
            )}
            {data.connectorCount > 0 && (
              <div>{data.connectorCount} connector{data.connectorCount !== 1 ? 's' : ''}</div>
            )}
            <div>{data.pathCount} path{data.pathCount !== 1 ? 's' : ''}</div>
          </div>
          {hovered && data.isContainer && !data.subsystemFrame && (
            <div className="text-[9px] text-zinc-600 mt-1 italic transition-opacity">
              Double-click to open
            </div>
          )}
        </div>
      )}

      {hasImage && hovered && data.isContainer && !data.subsystemFrame && (
        <div className="absolute bottom-2 left-3 text-[9px] text-zinc-300/80 italic pointer-events-none">
          Double-click to open
        </div>
      )}
    </div>
  );
});
