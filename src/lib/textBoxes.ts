import type { TextBoxFontFamily, TextBoxFontWeight } from '../types';

export const ADD_TEXT_BOX_EVENT = 'vibewire:add-text-box';

export type AddTextBoxDetail = { parentId?: string };

export function requestAddTextBox(parentId?: string) {
  window.dispatchEvent(new CustomEvent<AddTextBoxDetail>(ADD_TEXT_BOX_EVENT, {
    detail: { parentId },
  }));
}

export const TEXT_BOX_FONT_FAMILY: Record<TextBoxFontFamily, string> = {
  sans: 'ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, serif',
  mono: 'ui-monospace, SFMono-Regular, monospace',
};

let measureEl: HTMLDivElement | null = null;

function getMeasureEl(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  if (!measureEl) {
    measureEl = document.createElement('div');
    measureEl.setAttribute('aria-hidden', 'true');
    measureEl.style.position = 'absolute';
    measureEl.style.left = '-9999px';
    measureEl.style.top = '0';
    measureEl.style.visibility = 'hidden';
    measureEl.style.pointerEvents = 'none';
    measureEl.style.zIndex = '-1';
    document.body.appendChild(measureEl);
  }
  return measureEl;
}

export function fitTextToBox({
  text,
  width,
  height,
  padding = 0,
  fontFamily = TEXT_BOX_FONT_FAMILY.sans,
  fontWeight = 'normal',
  lineHeight = 1.25,
  minSize = 8,
  maxSize = 160,
  whiteSpace = 'pre-wrap',
}: {
  text: string;
  width: number;
  height: number;
  padding?: number;
  fontFamily?: string;
  fontWeight?: TextBoxFontWeight | string;
  lineHeight?: number;
  minSize?: number;
  maxSize?: number;
  whiteSpace?: 'pre-wrap' | 'nowrap';
}): number {
  const innerW = Math.max(1, width - padding * 2);
  const innerH = Math.max(1, height - padding * 2);
  const sample = text.length > 0 ? text : 'Ag';
  const cap = Math.max(minSize, Math.min(maxSize, Math.floor(innerH / lineHeight)));
  if (cap <= minSize) return minSize;

  const el = getMeasureEl();
  if (!el) return Math.min(14, cap);

  el.style.width = `${innerW}px`;
  el.style.height = 'auto';
  el.style.maxHeight = 'none';
  el.style.padding = '0';
  el.style.margin = '0';
  el.style.border = '0';
  el.style.fontFamily = fontFamily;
  el.style.fontWeight = String(fontWeight);
  el.style.lineHeight = String(lineHeight);
  el.style.whiteSpace = whiteSpace;
  el.style.overflowWrap = whiteSpace === 'nowrap' ? 'normal' : 'break-word';
  el.style.wordBreak = whiteSpace === 'nowrap' ? 'keep-all' : 'break-word';
  el.textContent = sample;

  const fits = (size: number) => {
    el.style.fontSize = `${size}px`;
    return el.scrollWidth <= innerW + 0.5 && el.scrollHeight <= innerH + 0.5;
  };

  if (!fits(minSize)) return minSize;
  if (fits(cap)) return cap;

  let lo = minSize;
  let hi = cap;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return Math.max(minSize, Math.floor(lo));
}
