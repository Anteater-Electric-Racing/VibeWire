/** Name colors stay on labels only. Box fills/borders default to black & white. */
export const DEVICE_COLOR = '#47ECD5';
export const CONNECTOR_COLOR = '#F5B200';
export const ENCLOSURE_COLOR = '#FFFFFF';

export interface EntityShell {
  fill: string;
  border: string;
  borderWidth: number;
}

export const ENCLOSURE_SHELL: EntityShell = {
  fill: '#0b0b0d',
  border: '#e4e4e7',
  borderWidth: 3,
};

export const DEVICE_SHELL: EntityShell = {
  fill: '#1c1c20',
  border: '#e4e4e7',
  borderWidth: 2,
};

export const CONNECTOR_SHELL: EntityShell = {
  fill: '#18181b',
  border: '#71717a',
  borderWidth: 1,
};

const SHELL_PRESETS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#f8fafc',
  '#a1a1aa',
  '#52525b',
  '#27272a',
] as const;

export const ENTITY_SHELL_PRESETS: string[] = [...SHELL_PRESETS];

export function parseHexColor(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    const [r, g, b] = value.slice(1);
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

/** Opaque mix of `hex` toward black so custom fills stay solid on the canvas. */
export function mixTowardBlack(hex: string, keep = 0.28): string {
  const parsed = parseHexColor(hex);
  if (!parsed) return ENCLOSURE_SHELL.fill;
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(parsed.slice(start, start + 2), 16);
    return Math.round(value * keep)
      .toString(16)
      .padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

export function enclosureShell(
  container: boolean,
  customColor?: string | null,
): EntityShell {
  const base = container ? ENCLOSURE_SHELL : DEVICE_SHELL;
  const color = parseHexColor(customColor);
  if (!color) return base;
  return {
    fill: mixTowardBlack(color, container ? 0.18 : 0.28),
    border: color,
    borderWidth: base.borderWidth,
  };
}

export function connectorCustomShell(customColor: string): EntityShell {
  const color = parseHexColor(customColor) ?? CONNECTOR_SHELL.border;
  return {
    fill: mixTowardBlack(color, 0.3),
    border: color,
    borderWidth: CONNECTOR_SHELL.borderWidth,
  };
}
