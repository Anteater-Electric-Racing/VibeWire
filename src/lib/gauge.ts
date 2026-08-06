/** Inclusive AWG window. Numerically larger AWG is the thinner conductor. */
export interface AwgRange {
  /** Thinner end (higher AWG number), e.g. 22 in "22-18 AWG". */
  minAwg: number;
  /** Thicker end (lower AWG number), e.g. 18 in "22-18 AWG". */
  maxAwg: number;
}

const AWG_PATTERN =
  /(\d+)\s*(?:-\s*(\d+))?\s*(?:AWG|ga(?:uge)?)?/i;

/**
 * Parse a freeform gauge string into an AWG range.
 * Accepts "20 AWG", "22-18 AWG", "18-22", "22-18AWG".
 */
export function parseAwgRange(raw: string | undefined | null): AwgRange | null {
  if (!raw) return null;
  const match = AWG_PATTERN.exec(raw.trim());
  if (!match) return null;
  const a = Number(match[1]);
  const b = match[2] !== undefined ? Number(match[2]) : a;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a < 0 || b < 0) return null;
  return {
    minAwg: Math.max(a, b),
    maxAwg: Math.min(a, b),
  };
}

/** Format as "N AWG" or "Hi-Lo AWG" (larger AWG number first). */
export function formatAwgRange(range: AwgRange): string {
  if (range.minAwg === range.maxAwg) return `${range.minAwg} AWG`;
  return `${range.minAwg}-${range.maxAwg} AWG`;
}

/**
 * Inclusive intersection of two AWG ranges, or null when they do not overlap.
 * `minAwg`/`maxAwg` are AWG numbers (higher = thinner), so a range covers
 * every integer from `maxAwg` through `minAwg` inclusive.
 */
export function intersectAwgRanges(a: AwgRange, b: AwgRange): AwgRange | null {
  const thicker = Math.max(a.maxAwg, b.maxAwg);
  const thinner = Math.min(a.minAwg, b.minAwg);
  if (thicker > thinner) return null;
  return { minAwg: thinner, maxAwg: thicker };
}

/**
 * Infer a conductor-compatible gauge window from both endpoint crimp ranges.
 * Uses the intersection when both ends parse; falls back to the sole parseable
 * end; returns empty when nothing parses or the ranges do not overlap.
 */
export function inferGaugeFromEnds(
  fromCrimpGauge: string | undefined,
  toCrimpGauge: string | undefined,
): { gauge: string; inferred: boolean } {
  const from = parseAwgRange(fromCrimpGauge);
  const to = parseAwgRange(toCrimpGauge);
  if (from && to) {
    const overlap = intersectAwgRanges(from, to);
    if (!overlap) return { gauge: '', inferred: false };
    return { gauge: formatAwgRange(overlap), inferred: true };
  }
  if (from) return { gauge: formatAwgRange(from), inferred: true };
  if (to) return { gauge: formatAwgRange(to), inferred: true };
  // Unparseable text: keep a single distinct raw string when both ends agree.
  const rawFrom = fromCrimpGauge?.trim() ?? '';
  const rawTo = toCrimpGauge?.trim() ?? '';
  if (rawFrom && rawTo && rawFrom === rawTo) {
    return { gauge: rawFrom, inferred: true };
  }
  if (rawFrom && !rawTo) return { gauge: rawFrom, inferred: true };
  if (rawTo && !rawFrom) return { gauge: rawTo, inferred: true };
  return { gauge: '', inferred: false };
}

export const WIRE_GAUGE_PRESETS = [
  '24 AWG',
  '22 AWG',
  '20 AWG',
  '18 AWG',
  '16 AWG',
  '14 AWG',
  '12 AWG',
  '10 AWG',
] as const;

/**
 * Visual conductor diameter for manufacturing diagrams. The relationship is
 * deliberately compressed so 10 AWG is visibly thicker than 24 AWG without
 * letting one heavy wire dominate the workbench.
 */
export function getWireDiameterPx(
  raw: string | undefined | null,
  minimum = 4,
  maximum = 12,
): number {
  const parsed = parseAwgRange(raw);
  if (!parsed) return minimum + (maximum - minimum) * 0.25;
  const representativeAwg = (parsed.minAwg + parsed.maxAwg) / 2;
  const normalized = Math.max(0, Math.min(1, (24 - representativeAwg) / 14));
  return minimum + (maximum - minimum) * normalized;
}
