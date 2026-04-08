import { memo } from 'react';
import { NodeResizer, type NodeProps, type Node } from '@xyflow/react';
import { useHarnessStore } from '../../store';

export type BackgroundImageNodeType = Node<{
  imageUrl: string;
  w: number;
  h: number;
  locked: boolean;
  contextKey: string;
}>;

export const BackgroundImageNode = memo(function BackgroundImageNode({
  data,
  selected,
}: NodeProps<BackgroundImageNodeType>) {
  const updateBackground = useHarnessStore((s) => s.updateBackground);
  const removeBackground = useHarnessStore((s) => s.removeBackground);

  return (
    <div
      className="relative"
      style={{
        width: data.w,
        height: data.h,
        opacity: data.locked ? 1 : 0.85,
        // When locked, the whole node is transparent to mouse events.
        // The buttons below explicitly re-enable pointer-events.
        pointerEvents: data.locked ? 'none' : 'auto',
      }}
    >
      {!data.locked && (
        <NodeResizer
          isVisible={selected}
          minWidth={100}
          minHeight={60}
          onResizeEnd={(_, params) =>
            updateBackground(data.contextKey, { w: params.width, h: params.height })
          }
        />
      )}

      <img
        src={data.imageUrl}
        alt="background"
        className="w-full h-full object-contain select-none"
        draggable={false}
        style={{ pointerEvents: 'none', display: 'block' }}
      />

      {/* Controls — always rendered; must re-enable pointer-events when locked */}
      <div
        className="nodrag nopan absolute top-1 right-1 flex gap-1"
        style={{ pointerEvents: 'auto' }}
      >
        <button
          title={data.locked ? 'Unlock to move/resize' : 'Lock position'}
          className="text-[10px] bg-zinc-900/80 border border-zinc-600 text-zinc-300 hover:text-amber-400 rounded px-1.5 py-0.5 transition-colors opacity-70 hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            updateBackground(data.contextKey, { locked: !data.locked });
          }}
        >
          {data.locked ? '🔓' : '🔒'}
        </button>
        <button
          title="Remove background"
          className="text-[10px] bg-zinc-900/80 border border-zinc-600 text-zinc-400 hover:text-red-400 rounded px-1.5 py-0.5 transition-colors opacity-70 hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            removeBackground(data.contextKey);
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
});
