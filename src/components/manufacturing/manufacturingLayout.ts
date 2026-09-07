const DEFAULT_RUN_MM = 150;
const MIN_RUN_SPAN = 124;
const MAX_RUN_SPAN = 320;

/** Concave scaling keeps long runs longer without letting them dominate the diagram. */
export function scaleManufacturingRun(lengthMm: number | undefined): number {
  const safeLength = lengthMm !== undefined && Number.isFinite(lengthMm)
    ? Math.max(0, lengthMm)
    : DEFAULT_RUN_MM;
  const compressed = 72 + Math.sqrt(safeLength) * 9;
  return Math.min(MAX_RUN_SPAN, Math.max(MIN_RUN_SPAN, compressed));
}

/**
 * Grow away from the connector side that feeds a branch. When the branch
 * starts directly on a parent node, continue outward from the nearest canvas edge.
 */
export function manufacturingBranchDirection(
  arrivalX: number,
  parentX: number,
  canvasWidth: number,
): -1 | 1 {
  if (Math.abs(arrivalX - parentX) > 0.5) {
    return arrivalX > parentX ? -1 : 1;
  }
  return parentX < canvasWidth / 2 ? -1 : 1;
}
