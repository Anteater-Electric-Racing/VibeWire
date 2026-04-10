import { memo, useState, useEffect, useRef } from 'react';
import { NodeResizer, type NodeProps, type Node } from '@xyflow/react';
import { useHarnessStore } from '../../store';
import type { TextBoxFontFamily } from '../../types';

const FONT_FAMILY_MAP: Record<TextBoxFontFamily, string> = {
  sans: 'ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, serif',
  mono: 'ui-monospace, SFMono-Regular, monospace',
};

export type TextBoxNodeType = Node<{
  tbId: string;
  text: string;
  bgColor: string;
  textColor: string;
  fontSize: number;
  fontFamily: TextBoxFontFamily;
  fontWeight: 'normal' | 'bold';
  textAlign: 'left' | 'center' | 'right';
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  opacity: number;
  padding: number;
  w: number;
  h: number;
}>;

export const TextBoxNode = memo(function TextBoxNode({
  data,
  selected,
}: NodeProps<TextBoxNodeType>) {
  const updateTextBox = useHarnessStore((s) => s.updateTextBox);
  const removeTextBox = useHarnessStore((s) => s.removeTextBox);
  const selectTextBox = useHarnessStore((s) => s.selectTextBox);
  const selectedTextBoxId = useHarnessStore((s) => s.selectedTextBoxId);
  const [localText, setLocalText] = useState(data.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isInspecting = selectedTextBoxId === data.tbId;

  useEffect(() => {
    setLocalText(data.text);
  }, [data.text]);

  const border =
    data.borderWidth > 0
      ? `${data.borderWidth}px solid ${data.borderColor}`
      : isInspecting
        ? '1px solid rgba(251, 191, 36, 0.5)'
        : selected
          ? '1px solid rgba(255,255,255,0.15)'
          : '1px solid rgba(75, 85, 99, 0.3)';

  return (
    <div
      className="relative overflow-hidden"
      style={{
        width: data.w,
        height: data.h,
        backgroundColor: data.bgColor,
        opacity: data.opacity,
        border,
        borderRadius: data.borderRadius,
      }}
      onClick={() => selectTextBox(data.tbId)}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={80}
        minHeight={40}
        onResizeEnd={(_, params) =>
          updateTextBox(data.tbId, { w: params.width, h: params.height })
        }
      />

      {/* Quick toolbar — appears above the node when selected */}
      {selected && (
        <div
          className="nodrag nopan absolute left-0 flex items-center gap-1.5 bg-zinc-900 border border-zinc-600 rounded px-2 py-1 shadow-xl"
          style={{ top: -40, zIndex: 9999, whiteSpace: 'nowrap' }}
        >
          {/* Background color */}
          <label className="flex items-center gap-1 cursor-pointer" title="Background color">
            <span className="text-[10px] text-zinc-400 select-none">BG</span>
            <span
              className="w-4 h-4 rounded border border-zinc-500"
              style={{ backgroundColor: data.bgColor }}
            />
            <input
              type="color"
              value={data.bgColor}
              onChange={(e) => updateTextBox(data.tbId, { bgColor: e.target.value })}
              className="absolute opacity-0 w-4 h-4 cursor-pointer"
            />
          </label>

          <div className="w-px h-3.5 bg-zinc-600 shrink-0" />

          {/* Text color */}
          <label className="flex items-center gap-1 cursor-pointer" title="Text color">
            <span className="text-[10px] text-zinc-400 select-none">Txt</span>
            <span
              className="w-4 h-4 rounded border border-zinc-500"
              style={{ backgroundColor: data.textColor }}
            />
            <input
              type="color"
              value={data.textColor}
              onChange={(e) => updateTextBox(data.tbId, { textColor: e.target.value })}
              className="absolute opacity-0 w-4 h-4 cursor-pointer"
            />
          </label>

          <div className="w-px h-3.5 bg-zinc-600 shrink-0" />

          {/* Inspect */}
          <button
            className={`text-[10px] leading-none px-1 transition-colors ${isInspecting ? 'text-amber-400' : 'text-zinc-400 hover:text-zinc-100'}`}
            title="Open in inspector"
            onClick={(e) => { e.stopPropagation(); selectTextBox(data.tbId); }}
          >
            ☰
          </button>

          <div className="w-px h-3.5 bg-zinc-600 shrink-0" />

          {/* Delete */}
          <button
            className="text-[10px] text-zinc-400 hover:text-red-400 transition-colors leading-none px-0.5"
            title="Remove text box"
            onClick={(e) => { e.stopPropagation(); removeTextBox(data.tbId); }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Editable textarea */}
      <textarea
        ref={textareaRef}
        value={localText}
        onChange={(e) => setLocalText(e.target.value)}
        onBlur={() => updateTextBox(data.tbId, { text: localText })}
        placeholder="Type here…"
        className="nodrag nopan w-full h-full bg-transparent resize-none outline-none border-none placeholder-zinc-500/40"
        style={{
          color: data.textColor,
          fontSize: data.fontSize,
          fontFamily: FONT_FAMILY_MAP[data.fontFamily ?? 'sans'],
          fontWeight: data.fontWeight ?? 'normal',
          textAlign: data.textAlign ?? 'left',
          padding: data.padding ?? 10,
          lineHeight: 1.55,
        }}
      />
    </div>
  );
});
