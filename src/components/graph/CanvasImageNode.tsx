import { memo } from 'react';
import { NodeResizer, type NodeProps, type Node } from '@xyflow/react';
import { useSystemStore } from '../../store';
import type { CanvasImageLayer } from '../../types';
import { PresenceBadge } from '../collab/PresenceBadge';

export type CanvasImageNodeType = Node<{
  imageId: string;
  imageUrl: string;
  w: number;
  h: number;
  locked: boolean;
  layer: CanvasImageLayer;
}>;

export const CanvasImageNode = memo(function CanvasImageNode({
  data,
  selected,
}: NodeProps<CanvasImageNodeType>) {
  const updateImage = useSystemStore((s) => s.updateImage);
  const selectImage = useSystemStore((s) => s.selectImage);
  const isEditor = useSystemStore((s) => s.session.isEditor);
  const locked = data.locked;
  const showResize = selected && !locked && isEditor;

  return (
    <div
      className="relative"
      onDoubleClick={(event) => {
        event.stopPropagation();
        selectImage(data.imageId);
      }}
      style={{
        width: data.w,
        height: data.h,
        outline: selected ? '2px solid rgba(245, 158, 11, 0.85)' : 'none',
        outlineOffset: 2,
        cursor: locked ? 'default' : undefined,
      }}
    >
      <PresenceBadge
        kind="image"
        id={data.imageId}
        className="pointer-events-auto absolute -right-1 -top-2 z-30"
      />
      {showResize && (
        <NodeResizer
          isVisible
          minWidth={40}
          minHeight={40}
          onResizeEnd={(_, params) =>
            updateImage(data.imageId, { w: params.width, h: params.height })
          }
        />
      )}

      <img
        src={data.imageUrl}
        alt=""
        className="w-full h-full object-contain select-none"
        draggable={false}
        style={{ pointerEvents: 'none', display: 'block' }}
      />
    </div>
  );
});
