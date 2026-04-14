const SIGNAL_COLORS: Record<string, string> = {
  // Power rails
  GND: '#111827',       // Black — all grounds
  '12V': '#ef4444',     // Red — 12V
  '24V': '#2563eb',     // Blue — 24V
  '5V': '#facc15',      // Yellow — 5V
  HV: '#f97316',        // Orange — High Voltage / Tractive System

  // Safety
  SDC: '#22c55e',       // Green — Safety Daisy Chain

  // Control / logic (violet)
  FAULT_RESET: '#8b5cf6',
  BRAKE_LIGHT: '#8b5cf6',
  RTDB: '#8b5cf6',      // Ready-to-Drive Button
  KL15: '#8b5cf6',      // KL15 ignition signal

  // Digital / grey signals
  FAULT_LED: '#9ca3af',
  FAULT_SIGNAL: '#9ca3af',
  SPEAKER: '#9ca3af',
  RASPI: '#9ca3af',
  DRIVETRAIN: '#9ca3af',

  // Analog / white signals (primary colour; stripes set via wire_color property)
  CURRENT_SENSE: '#f8fafc',  // White + Grey stripe
  WHEEL_SPEED: '#f8fafc',    // White + Brown stripe
  APPS: '#f8fafc',           // White (shielded pair)
  BSE: '#f8fafc',            // White (shielded pair — brake sensor)
  THERMISTOR: '#f8fafc',     // White (shielded pair)

  // Special LED wires (primary colour; stripes set via wire_color property)
  RTM_LED: '#f97316',        // Black + Orange stripe
  TSSI_GREEN: '#22c55e',     // Black + Green stripe
  TSSI_RED: '#ef4444',       // Black + Red stripe

  // CAN (shielded pairs — amber)
  CAN_ACC_H: '#f59e0b',
  CAN_ACC_L: '#d97706',
  CAN1_INV_H: '#f59e0b',
  CAN1_INV_L: '#d97706',

  // Legacy / kept for backwards compat
  CAN_H: '#f59e0b',
  CAN_L: '#d97706',
  '12V_MAIN': '#ef4444',
  SDC_IN: '#3b82f6',
  SDC_OUT: '#60a5fa',
};

const FALLBACK_PALETTE = [
  '#a855f7', '#ec4899', '#14b8a6', '#f97316',
  '#8b5cf6', '#06b6d4', '#84cc16', '#e11d48',
  '#0ea5e9', '#eab308', '#6366f1', '#10b981',
];

const PHYSICAL_WIRE_COLORS: Record<string, string> = {
  red: '#ef4444',
  black: '#111827',
  blue: '#2563eb',
  'light blue': '#60a5fa',
  white: '#f8fafc',
  yellow: '#facc15',
  green: '#22c55e',
  purple: '#a855f7',
  grey: '#9ca3af',
  gray: '#9ca3af',
  brown: '#92400e',
  orange: '#f97316',
  pink: '#ec4899',
};

const PHYSICAL_WIRE_ALIASES: Record<string, string> = {
  blk: 'black',
  blu: 'blue',
  grn: 'green',
  gry: 'grey',
  ltblue: 'light blue',
  'lt blue': 'light blue',
  wht: 'white',
  yel: 'yellow',
  pur: 'purple',
  org: 'orange',
  brn: 'brown',
  grye: 'grey',
};

export interface WireAppearance {
  kind: 'solid' | 'striped';
  key: string;
  label: string;
  colors: string[];
  primaryColor: string;
}

export interface WireStrokeLayer {
  color: string;
  width: number;
  opacity?: number;
  dasharray?: string;
  dashoffset?: number;
  linecap?: 'round' | 'butt' | 'square';
}

let dynamicIndex = 0;
const dynamicAssignments = new Map<string, string>();

export function getSignalColor(signalName: string): string {
  if (SIGNAL_COLORS[signalName]) return SIGNAL_COLORS[signalName];
  if (dynamicAssignments.has(signalName)) return dynamicAssignments.get(signalName)!;
  const color = FALLBACK_PALETTE[dynamicIndex % FALLBACK_PALETTE.length];
  dynamicAssignments.set(signalName, color);
  dynamicIndex++;
  return color;
}

export function getSignalFromTags(tags: string[]): string | null {
  for (const tag of tags) {
    if (tag.startsWith('signal:')) return tag.slice(7);
  }
  return null;
}

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.trim();
  if (!/^#[0-9a-f]{6}$/i.test(normalized)) return normalized;
  const clamped = Math.max(0, Math.min(1, alpha));
  const channel = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0');
  return `${normalized}${channel}`;
}

function normalizeWireToken(token: string): string {
  return token
    .trim()
    .toLowerCase()
    .replace(/[._-]/g, ' ')
    .replace(/\s+/g, ' ');
}

function resolvePhysicalWireColor(token: string): string | null {
  const normalized = normalizeWireToken(token);
  const aliased = PHYSICAL_WIRE_ALIASES[normalized] ?? normalized;
  return PHYSICAL_WIRE_COLORS[aliased] ?? null;
}

function createAppearance(
  kind: 'solid' | 'striped',
  colors: string[],
  label: string,
  key: string,
): WireAppearance {
  return {
    kind,
    key,
    label,
    colors,
    primaryColor: colors[0] ?? '#666',
  };
}

function parsePhysicalWireAppearance(rawColor: string): WireAppearance | null {
  const tokens = rawColor
    .split('/')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;

  const resolved = tokens
    .map((token) => resolvePhysicalWireColor(token))
    .filter((color): color is string => !!color);

  if (resolved.length !== tokens.length || resolved.length === 0) return null;

  if (resolved.length === 1) {
    return createAppearance('solid', resolved, rawColor, `wire:${normalizeWireToken(rawColor)}`);
  }

  return createAppearance('striped', resolved, rawColor, `wire:${tokens.map(normalizeWireToken).join('/')}`);
}

export const WIRE_COLOR_PROPERTY_KEYS = ['wire_color', 'color'] as const;

export function getWireAppearance(input: {
  properties?: Record<string, string>;
  tags: string[];
}): WireAppearance {
  const rawWireColor = (
    input.properties?.wire_color ?? input.properties?.color
  )?.trim();
  if (rawWireColor) {
    const parsed = parsePhysicalWireAppearance(rawWireColor);
    if (parsed) return parsed;
  }

  const signalName = getSignalFromTags(input.tags);
  if (signalName) {
    return createAppearance('solid', [getSignalColor(signalName)], signalName, `signal:${signalName}`);
  }

  return createAppearance('solid', ['#666'], rawWireColor || 'Unknown', 'unknown');
}

export function getWireBackground(
  appearance: WireAppearance | null,
  alpha = 1,
): string {
  if (!appearance) return withAlpha('#666666', alpha);

  const colors = appearance.colors.map((color) => withAlpha(color, alpha));
  if (colors.length <= 1) return colors[0];

  const bandSize = 8;
  const stops = colors.flatMap((color, index) => {
    const start = index * bandSize;
    const end = start + bandSize;
    return [`${color} ${start}px`, `${color} ${end}px`];
  });
  return `repeating-linear-gradient(135deg, ${stops.join(', ')})`;
}

export function getWireBorderColor(appearance: WireAppearance | null): string {
  return appearance?.primaryColor ?? '#555';
}

export function getWireStrokeLayers(
  appearance: WireAppearance,
  width: number,
): WireStrokeLayer[] {
  if (appearance.kind === 'solid' || appearance.colors.length < 2) {
    return [{ color: appearance.primaryColor, width }];
  }

  // Each color gets an equal-length segment. Two interlocked strokes of the
  // same width and same dasharray but offset by one segment length fills the
  // entire path with perfectly alternating bands — no solid base layer.
  const n = appearance.colors.length;
  const segLen = Math.max(8, width * 4);
  const period = segLen * n;

  return appearance.colors.map((color, index) => ({
    color,
    width,
    dasharray: `${segLen} ${period - segLen}`,
    dashoffset: -(index * segLen),
    linecap: 'butt' as const,
  }));
}
