const SIGNAL_COLORS: Record<string, string> = {
  CAN_H: '#f59e0b',
  CAN_L: '#d97706',
  '12V_MAIN': '#ef4444',
  GND: '#6b7280',
  SDC_IN: '#3b82f6',
  SDC_OUT: '#60a5fa',
  APPS_1: '#22c55e',
  APPS_2: '#16a34a',
};

const FALLBACK_PALETTE = [
  '#a855f7', '#ec4899', '#14b8a6', '#f97316',
  '#8b5cf6', '#06b6d4', '#84cc16', '#e11d48',
  '#0ea5e9', '#eab308', '#6366f1', '#10b981',
];

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
