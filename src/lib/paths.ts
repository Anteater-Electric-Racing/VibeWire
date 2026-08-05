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

type CornerFillet = {
  curr: Point;
  ux1: number;
  uy1: number;
  ux2: number;
  uy2: number;
  /** +1 when the left side of travel is inside the turn (CCW on screen). */
  leftIsInside: number;
  /** Centerline fillet radius actually used. */
  radius: number;
  trim: number;
  /** SVG sweep-flag for the centerline turn. */
  sweep: 0 | 1;
};

function cornerFillet(
  prev: Point,
  curr: Point,
  next: Point,
  desiredRadius: number,
  /** Half-width that must remain on the inside of the turn. */
  clearInside = 0,
): CornerFillet | null {
  const dx1 = curr.x - prev.x;
  const dy1 = curr.y - prev.y;
  const dx2 = next.x - curr.x;
  const dy2 = next.y - curr.y;
  const len1 = Math.hypot(dx1, dy1);
  const len2 = Math.hypot(dx2, dy2);
  if (len1 < 0.001 || len2 < 0.001) return null;

  const ux1 = dx1 / len1;
  const uy1 = dy1 / len1;
  const ux2 = dx2 / len2;
  const uy2 = dy2 / len2;
  const cross = ux1 * uy2 - uy1 * ux2;
  const dot = Math.max(-1, Math.min(1, ux1 * ux2 + uy1 * uy2));
  const turn = Math.atan2(cross, dot);
  if (Math.abs(turn) < 0.02) return null;

  const half = Math.abs(turn) / 2;
  const tanHalf = Math.tan(half);
  if (tanHalf < 1e-6) return null;

  // Consecutive corners share a segment — leave a little straight run.
  const maxTrim = Math.min(len1, len2) * 0.42;
  const maxRadius = maxTrim / tanHalf;
  if (maxRadius < 0.5) return null;

  // Compact professional bend: prefer the desired radius, but keep enough
  // clearance for the innermost wire and never exceed what the segments allow.
  const minRadius = Math.min(maxRadius, clearInside + 3);
  const radius = Math.min(maxRadius, Math.max(desiredRadius, minRadius));
  const trim = radius * tanHalf;

  return {
    curr,
    ux1,
    uy1,
    ux2,
    uy2,
    // With Y-down screen coords, (-uy,ux) points inside a positive-cross turn.
    leftIsInside: cross > 0 ? 1 : -1,
    radius,
    trim,
    // Positive cross ⇒ clockwise screen turn ⇒ SVG sweep-flag 1.
    sweep: cross > 0 ? 1 : 0,
  };
}

function offsetPoint(point: Point, ux: number, uy: number, offset: number): Point {
  // Left-hand normal of travel direction (ux, uy).
  return { x: point.x + (-uy) * offset, y: point.y + ux * offset };
}

/**
 * Polyline path with circular corner fillets, optionally offset as a
 * concentric parallel (wires in a bundle stay evenly spaced through bends).
 */
export function filletedPolylinePath(
  points: Point[],
  radius: number,
  offset = 0,
  clearInside = 0,
): string {
  if (points.length < 2) return '';

  if (points.length === 2 || radius <= 0) {
    const dx = points[1].x - points[0].x;
    const dy = points[1].y - points[0].y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const a = offsetPoint(points[0], ux, uy, offset);
    const b = offsetPoint(points[points.length - 1], ux, uy, offset);
    return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  }

  const fillets: Array<CornerFillet | null> = new Array(points.length).fill(null);
  for (let i = 1; i < points.length - 1; i++) {
    fillets[i] = cornerFillet(points[i - 1], points[i], points[i + 1], radius, clearInside);
  }

  const startDirLen = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) || 1;
  const start = offsetPoint(
    points[0],
    (points[1].x - points[0].x) / startDirLen,
    (points[1].y - points[0].y) / startDirLen,
    offset,
  );
  let d = `M ${start.x} ${start.y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const f = fillets[i];
    if (!f) {
      // Collinear / degenerate: offset using the local segment direction.
      const dx = points[i + 1].x - points[i - 1].x;
      const dy = points[i + 1].y - points[i - 1].y;
      const len = Math.hypot(dx, dy) || 1;
      const p = offsetPoint(points[i], dx / len, dy / len, offset);
      d += ` L ${p.x} ${p.y}`;
      continue;
    }

    const arcStartCenter = {
      x: f.curr.x - f.ux1 * f.trim,
      y: f.curr.y - f.uy1 * f.trim,
    };
    const arcEndCenter = {
      x: f.curr.x + f.ux2 * f.trim,
      y: f.curr.y + f.uy2 * f.trim,
    };

    // Inward unit normal from the incoming tangent.
    const nix = -f.uy1 * f.leftIsInside;
    const niy = f.ux1 * f.leftIsInside;
    const center = {
      x: arcStartCenter.x + nix * f.radius,
      y: arcStartCenter.y + niy * f.radius,
    };

    // Positive offset is left of travel; convert to signed distance from center.
    // Inside the turn is toward the center, so radius shrinks there.
    const arcRadius = Math.max(0.75, f.radius - offset * f.leftIsInside);

    const fromCenterStartX = arcStartCenter.x - center.x;
    const fromCenterStartY = arcStartCenter.y - center.y;
    const fromCenterEndX = arcEndCenter.x - center.x;
    const fromCenterEndY = arcEndCenter.y - center.y;
    const startScale = arcRadius / f.radius;
    const endScale = arcRadius / f.radius;
    const a0 = {
      x: center.x + fromCenterStartX * startScale,
      y: center.y + fromCenterStartY * startScale,
    };
    const a1 = {
      x: center.x + fromCenterEndX * endScale,
      y: center.y + fromCenterEndY * endScale,
    };

    d += ` L ${a0.x} ${a0.y}`;
    d += ` A ${arcRadius} ${arcRadius} 0 0 ${f.sweep} ${a1.x} ${a1.y}`;
  }

  const end = points[points.length - 1];
  const prev = points[points.length - 2];
  const endLen = Math.hypot(end.x - prev.x, end.y - prev.y) || 1;
  const endPt = offsetPoint(end, (end.x - prev.x) / endLen, (end.y - prev.y) / endLen, offset);
  d += ` L ${endPt.x} ${endPt.y}`;
  return d;
}

/** Centerline convenience wrapper (no parallel offset). */
export function roundedPolylinePath(points: Point[], radius: number): string {
  return filletedPolylinePath(points, radius, 0);
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
