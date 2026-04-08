import { memo, useState, useEffect, useRef } from 'react';
import { NodeResizer, type NodeProps, type Node } from '@xyflow/react';
import { useHarnessStore } from '../../store';

export type TextBoxNodeType = Node<{
  tbId: string;
  text: string;
  bgColor: string;
  textColor: string;
  fontSize: number;
  w: number;
  h: number;
}>;

export const TextBoxNode = memo(function TextBoxNode({
  data,
  selected,
}: NodeProps<TextBoxNodeType>) {
  const updateTextBox = useHarnessStore((s) => s.updateTextBox);
  const removeTextBox = useHarnessStore((s) => s.removeTextBox);
  const [localText, setLocalText] = useState(data.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setLocalText(data.text);
  }, [data.text]);

  return (
    <div
      className="relative overflow-hidden rounded border border-zinc-600/40"
      style={{
        width: data.w,
        height: data.h,
        backgroundColor: data.bgColor,
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={80}
        minHeight={40}
        onResizeEnd={(_, params) =>
          updateTextBox(data.tbId, { w: params.width, h: params.height })
        }
      />

      {/* Floating toolbar — appears above the node when selected */}
      {selected && (
        <div
          className="nodrag nopan absolute left-0 flex items-center gap-1.5 bg-zinc-900 border border-zinc-600 rounded px-2 py-1 shadow-xl"
          style={{ top: -40, zIndex: 9999, whiteSpace: 'nowrap' }}
        >
          {/* Background color */}
          <label
            className="flex items-center gap-1 cursor-pointer"
            title="Background color"
          >
            <span className="text-[10px] text-zinc-400 select-none">BG</span>
            <span
              className="w-4 h-4 rounded border border-zinc-500"
              style={{ backgroundColor: data.bgColor }}
            />
            <input
              type="color"
              value={data.bgColor}
              onChange={(e) =>
                updateTextBox(data.tbId, { bgColor: e.target.value })
              }
              className="absolute opacity-0 w-4 h-4 cursor-pointer"
              style={{ pointerEvents: 'auto' }}
            />
          </label>

          <div className="w-px h-3.5 bg-zinc-600 shrink-0" />

          {/* Text color */}
          <label
            className="flex items-center gap-1 cursor-pointer"
            title="Text color"
          >
            <span className="text-[10px] text-zinc-400 select-none">Txt</span>
            <span
              className="w-4 h-4 rounded border border-zinc-500"
              style={{ backgroundColor: data.textColor }}
            />
            <input
              type="color"
              value={data.textColor}
              onChange={(e) =>
                updateTextBox(data.tbId, { textColor: e.target.value })
              }
              className="absolute opacity-0 w-4 h-4 cursor-pointer"
              style={{ pointerEvents: 'auto' }}
            />
          </label>

          <div className="w-px h-3.5 bg-zinc-600 shrink-0" />

          {/* Font size */}
          <div className="flex items-center gap-0.5">
            <button
              className="text-[11px] font-bold text-zinc-300 hover:text-white leading-none px-0.5 transition-colors"
              title="Decrease font size"
              onClick={() =>
                updateTextBox(data.tbId, {
                  fontSize: Math.max(8, data.fontSize - 2),
                })
              }
            >
              A−
            </button>
            <span className="text-[10px] text-zinc-500 w-5 text-center tabular-nums">
              {data.fontSize}
            </span>
            <button
              className="text-[11px] font-bold text-zinc-300 hover:text-white leading-none px-0.5 transition-colors"
              title="Increase font size"
              onClick={() =>
                updateTextBox(data.tbId, {
                  fontSize: Math.min(72, data.fontSize + 2),
                })
              }
            >
              A+
            </button>
          </div>

          <div className="w-px h-3.5 bg-zinc-600 shrink-0" />

          {/* Delete */}
          <button
            className="text-[11px] text-zinc-400 hover:text-red-400 transition-colors leading-none px-0.5"
            title="Remove text box"
            onClick={(e) => {
              e.stopPropagation();
              removeTextBox(data.tbId);
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Editable text area */}
      <textarea
        ref={textareaRef}
        value={localText}
        onChange={(e) => setLocalText(e.target.value)}
        onBlur={() => updateTextBox(data.tbId, { text: localText })}
        placeholder="Type here…"
        className="nodrag nopan w-full h-full p-2.5 bg-transparent resize-none outline-none border-none placeholder-zinc-500/50"
        style={{
          color: data.textColor,
          fontSize: data.fontSize,
          lineHeight: 1.55,
          fontFamily: 'inherit',
        }}
      />
    </div>
  );
});
