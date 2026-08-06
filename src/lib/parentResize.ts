export type GraphPoint = {
  x: number;
  y: number;
};

export type GraphNodeSize = {
  w: number;
  h: number;
};

export type GraphRect = GraphPoint & GraphNodeSize;

export type WallSide = 'left' | 'right' | 'top' | 'bottom';

export type ParentResizeConnector = {
  id: string;
  /** Position relative to the parent before the resize. */
  position: GraphPoint;
  size: GraphNodeSize;
  wallMounted?: boolean;
};

export type ParentResizeResult = {
  parent: GraphRect;
  /** Positions relative to the resolved parent. */
  connectorPositions: Record<string, GraphPoint>;
};

const GEOMETRY_EPSILON = 0.001;

function rectRight(rect: GraphRect): number {
  return rect.x + rect.w;
}

function rectBottom(rect: GraphRect): number {
  return rect.y + rect.h;
}

function clampNodeStart(
  start: number,
  nodeLength: number,
  parentStart: number,
  parentLength: number,
): number {
  if (nodeLength >= parentLength) {
    return parentStart + (parentLength - nodeLength) / 2;
  }
  return Math.min(
    parentStart + parentLength - nodeLength,
    Math.max(parentStart, start),
  );
}

/** Nearest enclosure wall for a connector center. */
export function getNearestWallSide(
  position: GraphPoint,
  nodeSize: GraphNodeSize,
  enclosureSize: GraphNodeSize,
): WallSide {
  const centerX = position.x + nodeSize.w / 2;
  const centerY = position.y + nodeSize.h / 2;
  return [
    { side: 'left' as const, distance: Math.abs(centerX) },
    { side: 'right' as const, distance: Math.abs(enclosureSize.w - centerX) },
    { side: 'top' as const, distance: Math.abs(centerY) },
    { side: 'bottom' as const, distance: Math.abs(enclosureSize.h - centerY) },
  ].reduce((nearest, candidate) =>
    candidate.distance < nearest.distance ? candidate : nearest).side;
}

/**
 * Keep a connector centered on the nearest edge of its enclosure. Positions
 * are relative to the parent and use React Flow's top-left node origin.
 */
export function projectNodeToEnclosureWall(
  position: GraphPoint,
  nodeSize: GraphNodeSize,
  enclosureSize: GraphNodeSize,
): GraphPoint {
  const centerX = position.x + nodeSize.w / 2;
  const centerY = position.y + nodeSize.h / 2;
  const nearestWall = getNearestWallSide(position, nodeSize, enclosureSize);
  const clampCenter = (value: number, nodeLength: number, enclosureLength: number) => {
    if (nodeLength >= enclosureLength) return enclosureLength / 2;
    return Math.min(
      enclosureLength - nodeLength / 2,
      Math.max(nodeLength / 2, value),
    );
  };

  if (nearestWall === 'left' || nearestWall === 'right') {
    return {
      x: nearestWall === 'left'
        ? -nodeSize.w / 2
        : enclosureSize.w - nodeSize.w / 2,
      y: clampCenter(centerY, nodeSize.h, enclosureSize.h) - nodeSize.h / 2,
    };
  }

  return {
    x: clampCenter(centerX, nodeSize.w, enclosureSize.w) - nodeSize.w / 2,
    y: nearestWall === 'top'
      ? -nodeSize.h / 2
      : enclosureSize.h - nodeSize.h / 2,
  };
}

type ResolvedConnector = ParentResizeConnector & {
  source: GraphRect;
  wallSide?: WallSide;
};

type ParentEdge = 'left' | 'right' | 'top' | 'bottom';

type AxisTarget = {
  id: string;
  target: number;
  cause: ParentEdge | null;
  /** Added to the final top/left coordinate to recover the limiting parent edge. */
  boundaryOffset: number;
  /** Wall-normal peers move rigidly and do not block one another. */
  rigidGroup?: string;
};

type EdgeLimits = Partial<Record<ParentEdge, number>>;

function rangesTouchOrOverlap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): boolean {
  return firstStart <= secondEnd + GEOMETRY_EPSILON
    && firstEnd + GEOMETRY_EPSILON >= secondStart;
}

function rectsTouchOrOverlap(first: GraphRect, second: GraphRect): boolean {
  return rangesTouchOrOverlap(first.x, rectRight(first), second.x, rectRight(second))
    && rangesTouchOrOverlap(first.y, rectBottom(first), second.y, rectBottom(second));
}

function updateEdgeLimit(
  limits: EdgeLimits,
  edge: ParentEdge,
  boundary: number,
): void {
  if (edge === 'left' || edge === 'top') {
    limits[edge] = Math.min(limits[edge] ?? Number.POSITIVE_INFINITY, boundary);
  } else {
    limits[edge] = Math.max(limits[edge] ?? Number.NEGATIVE_INFINITY, boundary);
  }
}

function sameRigidMovement(
  target: AxisTarget,
  peerTarget: AxisTarget | undefined,
  sourceCoordinate: number,
  peerSourceCoordinate: number,
): boolean {
  if (!target.rigidGroup || target.rigidGroup !== peerTarget?.rigidGroup) return false;
  const delta = target.target - sourceCoordinate;
  const peerDelta = peerTarget.target - peerSourceCoordinate;
  return Math.abs(delta - peerDelta) <= GEOMETRY_EPSILON;
}

function moveAlongAxis(
  axis: 'x' | 'y',
  rects: Map<string, GraphRect>,
  targets: AxisTarget[],
  limits: EdgeLimits,
): void {
  const sizeKey = axis === 'x' ? 'w' : 'h';
  const perpendicularAxis = axis === 'x' ? 'y' : 'x';
  const perpendicularSize = axis === 'x' ? 'h' : 'w';
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const sourceCoordinateById = new Map(
    [...rects].map(([id, rect]) => [id, rect[axis]]),
  );

  // Outward wall movement cannot squeeze a connector, so it follows the wall
  // directly and is not part of collision resolution.
  for (const target of targets) {
    if (target.cause !== null) continue;
    const rect = rects.get(target.id);
    if (rect) rect[axis] = target.target;
  }

  const causedTargets = targets.filter((target) => target.cause !== null);
  const moveTargets = (direction: 1 | -1) => {
    const ordered = causedTargets
      .filter((target) => {
        const source = sourceCoordinateById.get(target.id);
        return source !== undefined
          && direction * (target.target - source) > GEOMETRY_EPSILON;
      })
      .sort((first, second) => {
        const firstRect = rects.get(first.id)!;
        const secondRect = rects.get(second.id)!;
        if (direction > 0) return firstRect[axis] - secondRect[axis];
        return (
          secondRect[axis] + secondRect[sizeKey]
          - firstRect[axis] - firstRect[sizeKey]
        );
      });

    for (const target of ordered) {
      const rect = rects.get(target.id);
      if (!rect || target.cause === null) continue;
      const sourceCoordinate = sourceCoordinateById.get(target.id) ?? rect[axis];
      const requestedDistance = direction * (target.target - sourceCoordinate);
      if (requestedDistance <= GEOMETRY_EPSILON) continue;

      const ignoresPeer = (peerId: string, peer: GraphRect) => {
        const peerTarget = targetById.get(peerId);
        const peerSource = sourceCoordinateById.get(peerId) ?? peer[axis];
        return sameRigidMovement(target, peerTarget, sourceCoordinate, peerSource);
      };

      const alreadyBlocked = [...rects].some(([peerId, peer]) =>
        peerId !== target.id
        && !ignoresPeer(peerId, peer)
        && rectsTouchOrOverlap(rect, peer));

      let allowedDistance = alreadyBlocked ? 0 : requestedDistance;
      if (!alreadyBlocked) {
        const perpendicularStart = rect[perpendicularAxis];
        const perpendicularEnd = perpendicularStart + rect[perpendicularSize];
        for (const [peerId, peer] of rects) {
          if (peerId === target.id || ignoresPeer(peerId, peer)) continue;
          const peerPerpendicularStart = peer[perpendicularAxis];
          const peerPerpendicularEnd = peerPerpendicularStart + peer[perpendicularSize];
          if (!rangesTouchOrOverlap(
            perpendicularStart,
            perpendicularEnd,
            peerPerpendicularStart,
            peerPerpendicularEnd,
          )) {
            continue;
          }

          const gap = direction > 0
            ? peer[axis] - (rect[axis] + rect[sizeKey])
            : rect[axis] - (peer[axis] + peer[sizeKey]);
          if (gap >= -GEOMETRY_EPSILON) {
            allowedDistance = Math.min(allowedDistance, Math.max(0, gap));
          }
        }
      }

      rect[axis] += direction * allowedDistance;
      if (allowedDistance + GEOMETRY_EPSILON < requestedDistance) {
        updateEdgeLimit(
          limits,
          target.cause,
          rect[axis] + target.boundaryOffset,
        );
      }
    }
  };

  moveTargets(1);
  moveTargets(-1);
}

function buildAxisTargets(
  previousParent: GraphRect,
  candidateParent: GraphRect,
  connectors: readonly ResolvedConnector[],
): { xTargets: AxisTarget[]; yTargets: AxisTarget[]; sizeLimits: EdgeLimits } {
  const previousRight = rectRight(previousParent);
  const previousBottom = rectBottom(previousParent);
  const candidateRight = rectRight(candidateParent);
  const candidateBottom = rectBottom(candidateParent);
  const leftMovedInward = candidateParent.x > previousParent.x + GEOMETRY_EPSILON;
  const rightMovedInward = candidateRight < previousRight - GEOMETRY_EPSILON;
  const topMovedInward = candidateParent.y > previousParent.y + GEOMETRY_EPSILON;
  const bottomMovedInward = candidateBottom < previousBottom - GEOMETRY_EPSILON;
  const xTargets: AxisTarget[] = [];
  const yTargets: AxisTarget[] = [];
  const sizeLimits: EdgeLimits = {};

  for (const connector of connectors) {
    const { source, size, wallSide } = connector;
    let targetX = source.x;
    let targetY = source.y;
    let xCause: ParentEdge | null = null;
    let yCause: ParentEdge | null = null;
    let xBoundaryOffset = 0;
    let yBoundaryOffset = 0;
    let xRigidGroup: string | undefined;
    let yRigidGroup: string | undefined;

    if (wallSide === 'left') {
      targetX = candidateParent.x - size.w / 2;
      xCause = leftMovedInward ? 'left' : null;
      xBoundaryOffset = size.w / 2;
      xRigidGroup = 'left-wall-normal';
      targetY = clampNodeStart(source.y, size.h, candidateParent.y, candidateParent.h);
      if (targetY > source.y + GEOMETRY_EPSILON && topMovedInward) yCause = 'top';
      if (targetY < source.y - GEOMETRY_EPSILON && bottomMovedInward) {
        yCause = 'bottom';
        yBoundaryOffset = size.h;
      }
    } else if (wallSide === 'right') {
      targetX = candidateRight - size.w / 2;
      xCause = rightMovedInward ? 'right' : null;
      xBoundaryOffset = size.w / 2;
      xRigidGroup = 'right-wall-normal';
      targetY = clampNodeStart(source.y, size.h, candidateParent.y, candidateParent.h);
      if (targetY > source.y + GEOMETRY_EPSILON && topMovedInward) yCause = 'top';
      if (targetY < source.y - GEOMETRY_EPSILON && bottomMovedInward) {
        yCause = 'bottom';
        yBoundaryOffset = size.h;
      }
    } else if (wallSide === 'top') {
      targetX = clampNodeStart(source.x, size.w, candidateParent.x, candidateParent.w);
      if (targetX > source.x + GEOMETRY_EPSILON && leftMovedInward) xCause = 'left';
      if (targetX < source.x - GEOMETRY_EPSILON && rightMovedInward) {
        xCause = 'right';
        xBoundaryOffset = size.w;
      }
      targetY = candidateParent.y - size.h / 2;
      yCause = topMovedInward ? 'top' : null;
      yBoundaryOffset = size.h / 2;
      yRigidGroup = 'top-wall-normal';
    } else if (wallSide === 'bottom') {
      targetX = clampNodeStart(source.x, size.w, candidateParent.x, candidateParent.w);
      if (targetX > source.x + GEOMETRY_EPSILON && leftMovedInward) xCause = 'left';
      if (targetX < source.x - GEOMETRY_EPSILON && rightMovedInward) {
        xCause = 'right';
        xBoundaryOffset = size.w;
      }
      targetY = candidateBottom - size.h / 2;
      yCause = bottomMovedInward ? 'bottom' : null;
      yBoundaryOffset = size.h / 2;
      yRigidGroup = 'bottom-wall-normal';
    } else {
      targetX = clampNodeStart(source.x, size.w, candidateParent.x, candidateParent.w);
      targetY = clampNodeStart(source.y, size.h, candidateParent.y, candidateParent.h);
      if (targetX > source.x + GEOMETRY_EPSILON && leftMovedInward) xCause = 'left';
      if (targetX < source.x - GEOMETRY_EPSILON && rightMovedInward) {
        xCause = 'right';
        xBoundaryOffset = size.w;
      }
      if (targetY > source.y + GEOMETRY_EPSILON && topMovedInward) yCause = 'top';
      if (targetY < source.y - GEOMETRY_EPSILON && bottomMovedInward) {
        yCause = 'bottom';
        yBoundaryOffset = size.h;
      }
    }

    xTargets.push({
      id: connector.id,
      target: targetX,
      cause: xCause,
      boundaryOffset: xBoundaryOffset,
      rigidGroup: xRigidGroup,
    });
    yTargets.push({
      id: connector.id,
      target: targetY,
      cause: yCause,
      boundaryOffset: yBoundaryOffset,
      rigidGroup: yRigidGroup,
    });

    const requiresHorizontalFit = !wallSide || wallSide === 'top' || wallSide === 'bottom';
    if (requiresHorizontalFit && candidateParent.w + GEOMETRY_EPSILON < size.w) {
      if (leftMovedInward) {
        updateEdgeLimit(sizeLimits, 'left', candidateRight - size.w);
      } else if (rightMovedInward) {
        updateEdgeLimit(sizeLimits, 'right', candidateParent.x + size.w);
      }
    }
    const requiresVerticalFit = !wallSide || wallSide === 'left' || wallSide === 'right';
    if (requiresVerticalFit && candidateParent.h + GEOMETRY_EPSILON < size.h) {
      if (topMovedInward) {
        updateEdgeLimit(sizeLimits, 'top', candidateBottom - size.h);
      } else if (bottomMovedInward) {
        updateEdgeLimit(sizeLimits, 'bottom', candidateParent.y + size.h);
      }
    }
  }

  return { xTargets, yTargets, sizeLimits };
}

function simulateResize(
  previousParent: GraphRect,
  candidateParent: GraphRect,
  connectors: readonly ResolvedConnector[],
): { rects: Map<string, GraphRect>; limits: EdgeLimits } {
  const rects = new Map(
    connectors.map((connector) => [connector.id, { ...connector.source }]),
  );
  const { xTargets, yTargets, sizeLimits } = buildAxisTargets(
    previousParent,
    candidateParent,
    connectors,
  );
  const limits = { ...sizeLimits };
  moveAlongAxis('x', rects, xTargets, limits);
  moveAlongAxis('y', rects, yTargets, limits);
  return { rects, limits };
}

function applyEdgeLimits(
  previousParent: GraphRect,
  candidateParent: GraphRect,
  limits: EdgeLimits,
): GraphRect {
  let left = candidateParent.x;
  let right = rectRight(candidateParent);
  let top = candidateParent.y;
  let bottom = rectBottom(candidateParent);
  const previousRight = rectRight(previousParent);
  const previousBottom = rectBottom(previousParent);

  if (
    limits.left !== undefined
    && candidateParent.x > previousParent.x + GEOMETRY_EPSILON
  ) {
    left = Math.max(previousParent.x, Math.min(left, limits.left));
  }
  if (
    limits.right !== undefined
    && right < previousRight - GEOMETRY_EPSILON
  ) {
    right = Math.min(previousRight, Math.max(right, limits.right));
  }
  if (
    limits.top !== undefined
    && candidateParent.y > previousParent.y + GEOMETRY_EPSILON
  ) {
    top = Math.max(previousParent.y, Math.min(top, limits.top));
  }
  if (
    limits.bottom !== undefined
    && bottom < previousBottom - GEOMETRY_EPSILON
  ) {
    bottom = Math.min(previousBottom, Math.max(bottom, limits.bottom));
  }

  return {
    x: left,
    y: top,
    w: Math.max(0, right - left),
    h: Math.max(0, bottom - top),
  };
}

function rectsEqual(first: GraphRect, second: GraphRect): boolean {
  return Math.abs(first.x - second.x) <= GEOMETRY_EPSILON
    && Math.abs(first.y - second.y) <= GEOMETRY_EPSILON
    && Math.abs(first.w - second.w) <= GEOMETRY_EPSILON
    && Math.abs(first.h - second.h) <= GEOMETRY_EPSILON;
}

/**
 * Resolve a parent resize without allowing its wall to push a connector
 * through a peer. A connector follows the encroaching wall until it touches
 * another connector or the opposite wall. Further shrink is applied back to
 * the parent edge instead of chain-pushing or overlapping connectors.
 */
export function resolveParentResizeWithConnectorShove(
  previousParent: GraphRect,
  requestedParent: GraphRect,
  connectorInputs: readonly ParentResizeConnector[],
): ParentResizeResult {
  const connectors: ResolvedConnector[] = connectorInputs.map((connector) => {
    const wallSide = connector.wallMounted
      ? getNearestWallSide(
          connector.position,
          connector.size,
          { w: previousParent.w, h: previousParent.h },
        )
      : undefined;
    const projectedPosition = wallSide
      ? projectNodeToEnclosureWall(
          connector.position,
          connector.size,
          { w: previousParent.w, h: previousParent.h },
        )
      : connector.position;
    return {
      ...connector,
      wallSide,
      source: {
        x: previousParent.x + projectedPosition.x,
        y: previousParent.y + projectedPosition.y,
        ...connector.size,
      },
    };
  });

  let resolvedParent = { ...requestedParent };
  const maximumPasses = Math.max(2, connectorInputs.length + 1);
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    const simulation = simulateResize(previousParent, resolvedParent, connectors);
    const constrainedParent = applyEdgeLimits(
      previousParent,
      resolvedParent,
      simulation.limits,
    );
    if (rectsEqual(resolvedParent, constrainedParent)) break;
    resolvedParent = constrainedParent;
  }

  const finalSimulation = simulateResize(previousParent, resolvedParent, connectors);
  return {
    parent: resolvedParent,
    connectorPositions: Object.fromEntries(
      [...finalSimulation.rects].map(([id, rect]) => [
        id,
        {
          x: rect.x - resolvedParent.x,
          y: rect.y - resolvedParent.y,
        },
      ]),
    ),
  };
}
