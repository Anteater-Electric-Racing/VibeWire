import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { NodeResizer, type NodeProps, type Node } from '@xyflow/react';
import { useSystemStore } from '../../store';
import type { TextBoxFontFamily, TextBoxTextAlign } from '../../types';
import { fitTextToBox, TEXT_BOX_FONT_FAMILY } from '../../lib/textBoxes';
import { PresenceBadge, PresenceEditingRegion } from '../collab/PresenceBadge';

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
  autoFit?: boolean;
}>;

const DRAG_THRESHOLD_PX = 4;

export const TextBoxNode = memo(function TextBoxNode({
  data,
  dragging,
}: NodeProps<TextBoxNodeType>) {
  const updateTextBox = useSystemStore((s) => s.updateTextBox);
  const removeTextBox = useSystemStore((s) => s.removeTextBox);
  const selectTextBox = useSystemStore((s) => s.selectTextBox);
  const selectedTextBoxId = useSystemStore((s) => s.selectedTextBoxId);
  const isEditor = useSystemStore((s) => s.session.isEditor);
  const pushUndoSnapshot = useSystemStore((s) => s.pushUndoSnapshot);
  const commitUndoSnapshot = useSystemStore((s) => s.commitUndoSnapshot);
  const [localText, setLocalText] = useState(data.text);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const [fontSize, setFontSize] = useState(data.fontSize);
  const [fitting, setFitting] = useState(Boolean(data.autoFit));

  const isInspecting = selectedTextBoxId === data.tbId;
  const shouldFit = fitting || Boolean(data.autoFit);
  const shownText = editing ? localText : data.text;
  const showMenu = isInspecting && menuOpen && !dragging;

  const recomputeFont = useCallback((text: string, width?: number, height?: number) => {
    const el = boxRef.current;
    const w = width ?? el?.clientWidth ?? data.w;
    const h = height ?? el?.clientHeight ?? data.h;
    return fitTextToBox({
      text,
      width: w,
      height: h,
      padding: data.padding ?? 10,
      fontFamily: TEXT_BOX_FONT_FAMILY[data.fontFamily ?? 'sans'],
      fontWeight: data.fontWeight ?? 'normal',
      lineHeight: 1.25,
      minSize: 8,
      maxSize: 160,
      whiteSpace: 'pre-wrap',
    });
  }, [data.fontFamily, data.fontWeight, data.h, data.padding, data.w]);

  /* Local editor/menu state mirrors external selection, drag, and persisted text-box updates. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isInspecting) {
      setMenuOpen(false);
      setEditing(false);
    }
  }, [isInspecting]);

  useEffect(() => {
    if (dragging) {
      setMenuOpen(false);
      setEditing(false);
    }
  }, [dragging]);

  useEffect(() => {
    if (!editing) setLocalText(data.text);
  }, [data.text, editing]);

  useEffect(() => {
    if (editing) textareaRef.current?.focus({ preventScroll: true });
  }, [editing]);

  useEffect(() => {
    setFitting(Boolean(data.autoFit));
    if (!data.autoFit) setFontSize(data.fontSize);
  }, [data.autoFit, data.fontSize]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!shouldFit) return;
    const el = boxRef.current;
    if (!el) return;
    const update = () => setFontSize(recomputeFont(shownText));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [shownText, recomputeFont, shouldFit]);

  const persistSize = (width: number, height: number) => {
    const nextFont = recomputeFont(shownText, width, height);
    setFontSize(nextFont);
    setFitting(true);
    updateTextBox(data.tbId, { w: width, h: height, fontSize: nextFont, autoFit: true });
  };

  const persistText = (text: string) => {
    const nextFont = recomputeFont(text);
    setFontSize(nextFont);
    setFitting(true);
    updateTextBox(data.tbId, { text, fontSize: nextFont, autoFit: true });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    pointerStart.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointerStart.current) return;
    if (
      Math.hypot(e.clientX - pointerStart.current.x, e.clientY - pointerStart.current.y)
      > DRAG_THRESHOLD_PX
    ) {
      moved.current = true;
      setMenuOpen(false);
      setEditing(false);
    }
  };

  const onPointerUp = () => {
    pointerStart.current = null;
  };

  const handleBoxClick = () => {
    if (moved.current) {
      moved.current = false;
      return;
    }
    if (menuOpen && isInspecting && isEditor) {
      setEditing(true);
      return;
    }
    selectTextBox(data.tbId);
    setMenuOpen(true);
  };

  const border =
    data.borderWidth > 0
      ? `${data.borderWidth}px solid ${data.borderColor}`
      : isInspecting
        ? '1px solid rgba(251, 191, 36, 0.5)'
        : '1px solid rgba(75, 85, 99, 0.3)';

  const setAlign = (textAlign: TextBoxTextAlign) => {
    updateTextBox(data.tbId, { textAlign });
  };

  const textStyle: CSSProperties = {
    color: data.textColor,
    fontSize,
    fontFamily: TEXT_BOX_FONT_FAMILY[data.fontFamily ?? 'sans'],
    fontWeight: data.fontWeight ?? 'normal',
    textAlign: data.textAlign ?? 'left',
    padding: data.padding ?? 10,
    lineHeight: 1.25,
    whiteSpace: 'pre-wrap',
  };

  return (
    <div
      ref={boxRef}
      data-textbox-id={data.tbId}
      className="relative overflow-visible w-full h-full"
      style={{
        backgroundColor: data.bgColor,
        opacity: data.opacity,
        border,
        borderRadius: data.borderRadius,
        cursor: editing ? 'text' : 'grab',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={(e) => {
        e.stopPropagation();
        handleBoxClick();
      }}
    >
      <PresenceBadge
        kind="textBox"
        id={data.tbId}
        className="pointer-events-auto absolute -right-1 -top-2 z-30"
      />
      <NodeResizer
        isVisible={isInspecting && isEditor && !editing}
        minWidth={80}
        minHeight={40}
        lineClassName="!border-amber-500/50"
        handleClassName="!w-2 !h-2 !bg-amber-400 !border-amber-600"
        onResizeStart={() => {
          moved.current = true;
          setFitting(true);
          pushUndoSnapshot(`textBox:${data.tbId}:resize`);
        }}
        onResize={(_, params) => {
          setFontSize(recomputeFont(shownText, params.width, params.height));
        }}
        onResizeEnd={(_, params) => {
          persistSize(params.width, params.height);
          commitUndoSnapshot();
        }}
      />

      {showMenu && (
        <div
          className="nodrag nopan nowheel absolute left-0 flex items-center gap-1.5 bg-zinc-900 border border-zinc-600 rounded px-2 py-1 shadow-xl"
          style={{ top: -40, zIndex: 9999, whiteSpace: 'nowrap' }}
          onClick={(e) => e.stopPropagation()}
        >
          <label className="relative flex items-center gap-1 cursor-pointer" title="Text color">
            <span className="text-[10px] text-zinc-400 select-none">Color</span>
            <span
              className="w-4 h-4 rounded border border-zinc-500"
              style={{ backgroundColor: data.textColor }}
            />
            <input
              type="color"
              disabled={!isEditor}
              value={data.textColor}
              onChange={(e) => updateTextBox(data.tbId, { textColor: e.target.value })}
              className="absolute opacity-0 w-4 h-4 cursor-pointer"
            />
          </label>

          <div className="w-px h-3.5 bg-zinc-600 shrink-0" />

          {([['left', 'Left'], ['center', 'Center']] as [TextBoxTextAlign, string][]).map(([align, label]) => (
            <button
              key={align}
              type="button"
              disabled={!isEditor}
              title={`${label} align`}
              onClick={(e) => { e.stopPropagation(); setAlign(align); }}
              className={`text-[10px] leading-none px-1.5 py-0.5 rounded border transition-colors disabled:opacity-40 ${
                (data.textAlign ?? 'left') === align
                  ? 'border-amber-500 text-amber-300 bg-amber-900/30'
                  : 'border-zinc-700 text-zinc-400 hover:text-zinc-100'
              }`}
            >
              {label}
            </button>
          ))}

          <div className="w-px h-3.5 bg-zinc-600 shrink-0" />

          <button
            className={`text-[10px] leading-none px-1 transition-colors ${isInspecting ? 'text-amber-400' : 'text-zinc-400 hover:text-zinc-100'}`}
            title="Open in inspector"
            onClick={(e) => { e.stopPropagation(); selectTextBox(data.tbId); }}
          >
            ☰
          </button>

          <div className="w-px h-3.5 bg-zinc-600 shrink-0" />

          <button
            disabled={!isEditor}
            className="flex items-center justify-center w-6 h-6 rounded border border-red-500/80 bg-red-950/50 text-red-300 hover:bg-red-900/70 hover:text-red-100 hover:border-red-400 transition-colors leading-none disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-red-950/50 disabled:hover:text-red-300"
            title={isEditor ? 'Remove text box' : 'Log in to remove the text box'}
            onClick={(e) => { e.stopPropagation(); removeTextBox(data.tbId); }}
          >
            ✕
          </button>
        </div>
      )}

      {editing ? (
        <PresenceEditingRegion target={{ kind: 'textBox', id: data.tbId }} className="h-full">
          <textarea
            ref={textareaRef}
            readOnly={!isEditor}
            value={localText}
            data-presence-field="text"
            onChange={(e) => {
              const next = e.target.value;
              setLocalText(next);
              persistText(next);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') {
                e.preventDefault();
                persistText(localText);
                setEditing(false);
                setMenuOpen(false);
                selectTextBox(null);
              }
            }}
            onBlur={() => {
              if (!isEditor) return;
              persistText(localText);
              commitUndoSnapshot();
            }}
            onFocus={() => pushUndoSnapshot(`textBox:${data.tbId}:text`)}
            placeholder="Type here…"
            className={`nodrag nopan nowheel w-full h-full bg-transparent resize-none outline-none border-none placeholder-zinc-500/40 overflow-hidden ${isEditor ? '' : 'cursor-default'}`}
            style={textStyle}
          />
        </PresenceEditingRegion>
      ) : (
        <div
          className="w-full h-full select-none pointer-events-none overflow-hidden"
          style={textStyle}
        >
          {shownText || <span className="opacity-40">Type here…</span>}
        </div>
      )}
    </div>
  );
});
