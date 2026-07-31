export interface Point {
  x: number;
  y: number;
}

/**
 * Build a straight polyline SVG path through a sequence of points.
 * Produces sharp corners (no curves).
 */
export function linePath(points: Point[]): string {
  if (points.length < 2) return '';
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');
}

/**
 * Build a smooth SVG path through a sequence of points using Catmull-Rom
 * interpolation converted to cubic Bezier segments. The tension parameter
 * (default 6) controls curvature — lower = rounder, higher = tighter.
 */
export function smoothPath(points: Point[], tension = 6): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    const dx = Math.abs(points[1].x - points[0].x) * 0.4;
    return `M ${points[0].x} ${points[0].y} C ${points[0].x + dx} ${points[0].y}, ${points[1].x - dx} ${points[1].y}, ${points[1].x} ${points[1].y}`;
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) / tension;
    const cp1y = p1.y + (p2.y - p0.y) / tension;
    const cp2x = p2.x - (p3.x - p1.x) / tension;
    const cp2y = p2.y - (p3.y - p1.y) / tension;

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/**
 * Evaluate a cubic Bezier at parameter t ∈ [0,1].
 */
function evalCubic(p0: number, p1: number, p2: number, p3: number, t: number) {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

/**
 * Sample evenly spaced points along the smooth path for hit-testing.
 */
export function sampleSmoothPath(points: Point[], samplesPerSeg = 16, tension = 6): Point[] {
  if (points.length < 2) return [...points];
  const result: Point[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) / tension;
    const cp1y = p1.y + (p2.y - p0.y) / tension;
    const cp2x = p2.x - (p3.x - p1.x) / tension;
    const cp2y = p2.y - (p3.y - p1.y) / tension;

    for (let j = 0; j <= samplesPerSeg; j++) {
      if (i > 0 && j === 0) continue;
      const t = j / samplesPerSeg;
      result.push({
        x: evalCubic(p1.x, cp1x, cp2x, p2.x, t),
        y: evalCubic(p1.y, cp1y, cp2y, p2.y, t),
      });
    }
  }
  return result;
}

/**
 * Find the nearest point on a polyline to a given query point.
 * Returns the distance, segment index, interpolation parameter, and the nearest point.
 */
export function nearestOnPolyline(
  point: Point,
  polyline: Point[],
): { dist: number; segIndex: number; t: number; nearest: Point } {
  let bestDist = Infinity;
  let bestSeg = 0;
  let bestT = 0;
  let bestNearest: Point = polyline[0] ?? { x: 0, y: 0 };

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
    const nearest = { x: a.x + t * dx, y: a.y + t * dy };
    const dist = Math.hypot(point.x - nearest.x, point.y - nearest.y);
    if (dist < bestDist) {
      bestDist = dist;
      bestSeg = i;
      bestT = t;
      bestNearest = nearest;
    }
  }

  return { dist: bestDist, segIndex: bestSeg, t: bestT, nearest: bestNearest };
}

/**
 * Compute the midpoint of the smooth path between two consecutive points,
 * useful for showing "add waypoint" handles between existing points.
 */
export function midpointOnSegment(
  points: Point[],
  segIndex: number,
  tension = 6,
): Point {
  const p0 = points[Math.max(0, segIndex - 1)];
  const p1 = points[segIndex];
  const p2 = points[segIndex + 1];
  const p3 = points[Math.min(points.length - 1, segIndex + 2)];

  const cp1x = p1.x + (p2.x - p0.x) / tension;
  const cp1y = p1.y + (p2.y - p0.y) / tension;
  const cp2x = p2.x - (p3.x - p1.x) / tension;
  const cp2y = p2.y - (p3.y - p1.y) / tension;

  return {
    x: evalCubic(p1.x, cp1x, cp2x, p2.x, 0.5),
    y: evalCubic(p1.y, cp1y, cp2y, p2.y, 0.5),
  };
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Point on the axis-aligned rectangle boundary in the direction from an interior
 * (or on-boundary) anchor toward `toward`. Used so wires leave a connector on
 * the side facing the next bend / peer endpoint.
 */
export function pointOnRectBoundaryToward(
  rect: Rect,
  anchor: Point,
  toward: Point,
): Point {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;

  const from = {
    x: Math.min(right, Math.max(left, anchor.x)),
    y: Math.min(bottom, Math.max(top, anchor.y)),
  };

  const dx = toward.x - from.x;
  const dy = toward.y - from.y;

  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
    // Degenerate: exit the nearer horizontal side of the clamped anchor.
    const toLeft = from.x - left;
    const toRight = right - from.x;
    return { x: toLeft <= toRight ? left : right, y: from.y };
  }

  let bestT = Infinity;
  let best: Point | null = null;

  const consider = (t: number, x: number, y: number) => {
    if (t <= 1e-9 || t >= bestT) return;
    // Allow a tiny epsilon so floating-point hits at corners count.
    if (x < left - 0.01 || x > right + 0.01 || y < top - 0.01 || y > bottom + 0.01) return;
    bestT = t;
    best = {
      x: Math.min(right, Math.max(left, x)),
      y: Math.min(bottom, Math.max(top, y)),
    };
  };

  if (Math.abs(dx) > 1e-9) {
    consider((left - from.x) / dx, left, from.y + ((left - from.x) / dx) * dy);
    consider((right - from.x) / dx, right, from.y + ((right - from.x) / dx) * dy);
  }
  if (Math.abs(dy) > 1e-9) {
    consider((top - from.y) / dy, from.x + ((top - from.y) / dy) * dx, top);
    consider((bottom - from.y) / dy, from.x + ((bottom - from.y) / dy) * dx, bottom);
  }

  if (best) return best;

  // Fallback: nearest of the four side projections of `toward`.
  const clampX = Math.min(right, Math.max(left, toward.x));
  const clampY = Math.min(bottom, Math.max(top, toward.y));
  const candidates: Point[] = [
    { x: left, y: clampY },
    { x: right, y: clampY },
    { x: clampX, y: top },
    { x: clampX, y: bottom },
  ];
  let nearest = candidates[0];
  let nearestDist = dist(toward, nearest);
  for (let i = 1; i < candidates.length; i++) {
    const d = dist(toward, candidates[i]);
    if (d < nearestDist) {
      nearest = candidates[i];
      nearestDist = d;
    }
  }
  return nearest;
}
