import { useEffect, useState, type MouseEvent } from 'react';
import {
  getWireAppearance,
  getWireBackground,
  getWireBorderColor,
  getWireColorPresetHex,
  getWireColorTokens,
  WIRE_COLOR_PRESETS,
  type WireAppearance,
} from '../lib/colors';

export function WireColorSwatch({
  appearance,
  className = 'w-2 h-2 rounded-full',
}: {
  appearance: WireAppearance | null;
  className?: string;
}) {
  if (appearance?.kind === 'striped' && appearance.colors.length >= 2) {
    return (
      <span className="inline-flex shrink-0 gap-px">
        {appearance.colors.slice(0, 2).map((color, i) => (
          <span
            key={i}
            className={`inline-block border ${className}`}
            style={{ background: color, borderColor: color }}
          />
        ))}
      </span>
    );
  }
  return (
    <span
      className={`inline-block shrink-0 border ${className}`}
      style={{
        background: getWireBackground(appearance),
        borderColor: getWireBorderColor(appearance),
      }}
    />
  );
}

export function WireColorEditor({
  label,
  value,
  onChange,
  hint,
  clearLabel,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  clearLabel?: string;
}) {
  const [text, setText] = useState(value);
  // First color of an in-progress Shift/Ctrl stripe pick.
  const [stripeBase, setStripeBase] = useState<string | null>(null);
  useEffect(() => {
    setText(value);
    setStripeBase(null);
  }, [value]);

  const appearance = getWireAppearance({
    properties: value ? { wire_color: value } : {},
    tags: [],
  });
  const selectedTokens = getWireColorTokens(value);
  const hasColor = Boolean(value.trim());
  const contentPad = label ? 'pl-[5.5rem]' : '';

  const commit = (next: string) => {
    const trimmed = next.trim();
    setText(trimmed);
    setStripeBase(null);
    onChange(trimmed);
  };

  const onPresetClick = (preset: string, event: MouseEvent) => {
    const stripePick = event.shiftKey || event.ctrlKey || event.metaKey;
    if (!stripePick) {
      commit(preset);
      return;
    }

    // Already mid-pick: second Shift+click completes base/stripe
    if (stripeBase) {
      if (stripeBase === preset) {
        commit(preset);
        return;
      }
      commit(`${stripeBase}/${preset}`);
      return;
    }

    // Shortcut: current solid (or stripe base) + Shift+click → stripe
    if (selectedTokens.length >= 1 && selectedTokens[0] !== preset) {
      commit(`${selectedTokens[0]}/${preset}`);
      return;
    }

    // Start a two-step pick (no usable base yet)
    setStripeBase(preset);
    setText(preset);
  };

  return (
    <div className="py-1">
      <div className="flex items-center gap-2 mb-1.5">
        {label && (
          <span className="text-[10px] text-zinc-500 w-20 shrink-0 text-right">{label}</span>
        )}
        <WireColorSwatch
          appearance={
            stripeBase
              ? getWireAppearance({ properties: { wire_color: stripeBase }, tags: [] })
              : value
                ? appearance
                : null
          }
          className={label ? 'w-3 h-3 rounded-sm' : 'h-8 w-8 rounded-md'}
        />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => commit(text)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(text);
            if (e.key === 'Escape') setStripeBase(null);
          }}
          placeholder="e.g. red or white/brown"
          className="min-w-0 flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-300 placeholder-zinc-600 focus:border-amber-600 focus:outline-none"
        />
      </div>
      <div className={`flex gap-1 flex-wrap ${contentPad}`}>
        {WIRE_COLOR_PRESETS.map((preset) => {
          const hex = getWireColorPresetHex(preset) ?? '#666';
          const selected = selectedTokens.includes(preset);
          const pendingBase = stripeBase === preset;
          return (
            <button
              key={preset}
              type="button"
              title={
                stripeBase
                  ? stripeBase === preset
                    ? `${preset} (base — Shift+click another for stripe)`
                    : `Stripe ${stripeBase}/${preset}`
                  : `${preset} — Shift+click two colors for a stripe`
              }
              onClick={(event) => onPresetClick(preset, event)}
              className="w-4 h-4 rounded border transition-all hover:scale-110"
              style={{
                backgroundColor: hex,
                borderColor: pendingBase
                  ? '#38bdf8'
                  : selected
                    ? '#f59e0b'
                    : 'rgba(255,255,255,0.12)',
                boxShadow: pendingBase ? '0 0 0 1px #38bdf8' : undefined,
              }}
            />
          );
        })}
      </div>
      <div className={`${contentPad} pt-1 text-[9px] text-zinc-600`}>
        {stripeBase
          ? `Stripe base: ${stripeBase} — Shift+click a second color`
          : 'Shift/Ctrl+click two colors for a stripe'}
      </div>
      {clearLabel && (
        <div className={`${contentPad} pt-1.5`}>
          <button
            type="button"
            disabled={!hasColor && !stripeBase}
            onClick={() => commit('')}
            className="text-[10px] text-zinc-400 hover:text-amber-400 disabled:text-zinc-700 disabled:cursor-default"
          >
            {clearLabel}
          </button>
        </div>
      )}
      {hint && (
        <div className={`${contentPad} pt-1 text-[9px] text-zinc-600`}>{hint}</div>
      )}
    </div>
  );
}
