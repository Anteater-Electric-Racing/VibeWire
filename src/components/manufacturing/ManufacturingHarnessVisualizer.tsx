import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  manufacturingTaskCompleted,
  manufacturingTaskKey,
  type ManufacturingBundle,
  type ManufacturingHarness,
  type ManufacturingWire,
} from '../../lib/manufacturing';
import { getWireAppearance, getWireStrokeLayers } from '../../lib/colors';
import { getWireDiameterPx } from '../../lib/gauge';
import type { ManufacturingDocument, ManufacturingTaskUpdate } from '../../types';

export type ManufacturingVisualSelection =
  | { kind: 'branch'; bundleId: string }
  | { kind: 'wire'; bundleId: string; wireId: string }
  | {
      kind: 'segment';
      bundleId: string;
      wireId: string;
      segmentIndex: number;
    }
  | {
      kind: 'endpoint';
      bundleId: string;
      wireId: string;
      end: 'from' | 'to';
    }
  | { kind: 'splice'; spliceId: string; bundleId: string };

export interface ManufacturingVisualTask {
  bundleId: string;
  update: ManufacturingTaskUpdate;
}

interface Point {
  x: number;
  y: number;
}

interface WireRoute {
  bundle: ManufacturingBundle;
  wire: ManufacturingWire;
  points: Point[];
  nodeKeys: string[];
}

/** A splice/branch point with the vertical span of the wires meeting there. */
interface JunctionMark {
  id: string;
  x: number;
  topY: number;
  bottomY: number;
  wireCount: number;
}

interface DiagramLayout {
  width: number;
  height: number;
  routes: WireRoute[];
  junctions: JunctionMark[];
}

function formatLength(mm: number | undefined): string {
  if (mm === undefined) return 'length needed';
  if (mm >= 1000) return `${(mm / 1000).toFixed(mm % 1000 === 0 ? 0 : 2)} m`;
  return `${Math.round(mm)} mm`;
}

function wireNodeKeys(wire: ManufacturingWire): string[] {
  const first = wire.hops[0];
  if (!first) return [];
  return [first.fromKey, ...wire.hops.map((hop) => hop.toKey)];
}

function cubicPath(from: Point, to: Point): string {
  if (Math.abs(from.y - to.y) < 0.5) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  const midX = (from.x + to.x) / 2;
  return `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
}

function joinedPath(points: Point[]): string {
  return points.slice(1).reduce((path, point, index) => {
    const from = points[index];
    if (Math.abs(from.y - point.y) < 0.5) {
      return `${path} L ${point.x} ${point.y}`;
    }
    const midX = (from.x + point.x) / 2;
    return `${path} C ${midX} ${from.y}, ${midX} ${point.y}, ${point.x} ${point.y}`;
  }, points[0] ? `M ${points[0].x} ${points[0].y}` : '');
}

function endpointEmoji(gender: 'male' | 'female' | undefined): string {
  if (gender === 'male') return '🍆';
  if (gender === 'female') return '🍑';
  return '🍆🍑';
}

function taskTargetKey(task: ManufacturingVisualTask): string {
  return `${task.bundleId}::${manufacturingTaskKey(task.update)}`;
}

function withTaskCompletion(
  task: ManufacturingVisualTask,
  completed: boolean,
): ManufacturingVisualTask {
  if (task.update.kind === 'connector-guide') {
    return {
      ...task,
      update: {
        ...task.update,
        state: completed ? task.update.state ?? 'checking' : undefined,
      },
    };
  }
  return {
    ...task,
    update: { ...task.update, completed },
  };
}

const MARGIN_X = 150;
const LANE_GAP = 30;
/** Vertical step a branch peels away from the trunk for each level of nesting. */
const BAND_STEP = 26;
const BRANCH_STEP_MAX = 300;
const BRANCH_STEP_MIN = 76;
const NOMINAL_WIDTH = 1200;
const DEFAULT_EDGE_MM = 150;
const MIN_SPINE_MM = 60;
const MAX_SPINE_MM = 420;
const PAD_TOP = 82;
const PAD_BOTTOM = 52;

function edgeId(from: string, to: string): string {
  return from < to ? `${from}\u0000${to}` : `${to}\u0000${from}`;
}

function stripPinSuffix(label: string): string {
  return label.replace(/-\d+$/, '');
}

interface HarnessGraph {
  adjacency: Map<string, Set<string>>;
  lengthByEdge: Map<string, number>;
  labelByNode: Map<string, string>;
}

function buildHarnessGraph(routes: WireRoute[]): HarnessGraph {
  const adjacency = new Map<string, Set<string>>();
  const lengthByEdge = new Map<string, number>();
  const labelByNode = new Map<string, string>();
  const link = (from: string, to: string) => {
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    if (!adjacency.has(to)) adjacency.set(to, new Set());
    adjacency.get(from)!.add(to);
    adjacency.get(to)!.add(from);
  };

  for (const route of routes) {
    for (const hop of route.wire.hops) {
      link(hop.fromKey, hop.toKey);
      labelByNode.set(hop.fromKey, stripPinSuffix(hop.fromLabel));
      labelByNode.set(hop.toKey, stripPinSuffix(hop.toLabel));
      if (hop.lengthMm === undefined) continue;
      const id = edgeId(hop.fromKey, hop.toKey);
      // Runs disagree when a length was only measured on part of the bundle;
      // the longest measurement keeps the spine from collapsing.
      lengthByEdge.set(id, Math.max(lengthByEdge.get(id) ?? 0, hop.lengthMm));
    }
    const first = route.nodeKeys[0];
    const last = route.nodeKeys[route.nodeKeys.length - 1];
    if (first && route.wire.from.connectorName) {
      labelByNode.set(first, route.wire.from.connectorName);
    }
    if (last && route.wire.to.connectorName) {
      labelByNode.set(last, route.wire.to.connectorName);
    }
  }
  return { adjacency, lengthByEdge, labelByNode };
}

interface HarnessTree {
  onSpine: Set<string>;
  parentOf: Map<string, string>;
  /** 0 on the trunk, then one per branch edge walked away from it. */
  offAxisDepth: Map<string, number>;
  /** First node of the top-level branch a node belongs to, if any. */
  branchRootOf: Map<string, string>;
  /** Position of a node among its parent's ordered off-trunk children. */
  childIndexOf: Map<string, number>;
}

/** Fan every remaining node out from the trunk, breadth first, in label order. */
function buildHarnessTree(graph: HarnessGraph, spine: string[]): HarnessTree {
  const onSpine = new Set(spine);
  const parentOf = new Map<string, string>();
  const offAxisDepth = new Map<string, number>(spine.map((key) => [key, 0]));
  const branchRootOf = new Map<string, string>();
  const childIndexOf = new Map<string, number>();
  const claimed = new Set(spine);

  let frontier = [...spine];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const node of frontier) {
      const children = [...(graph.adjacency.get(node) ?? [])]
        .filter((child) => !claimed.has(child))
        .sort((left, right) =>
          (graph.labelByNode.get(left) ?? left).localeCompare(
            graph.labelByNode.get(right) ?? right, undefined, { numeric: true },
          ) || left.localeCompare(right));
      children.forEach((child, index) => {
        claimed.add(child);
        parentOf.set(child, node);
        childIndexOf.set(child, index);
        offAxisDepth.set(child, (offAxisDepth.get(node) ?? 0) + 1);
        branchRootOf.set(child, onSpine.has(node) ? child : branchRootOf.get(node)!);
        next.push(child);
      });
    }
    frontier = next;
  }

  return { onSpine, parentOf, offAxisDepth, branchRootOf, childIndexOf };
}

function buildLayout(harness: ManufacturingHarness): DiagramLayout {
  const routes: WireRoute[] = harness.bundles.flatMap((bundle) =>
    bundle.wires.map((wire) => ({
      bundle,
      wire,
      nodeKeys: wireNodeKeys(wire),
      points: [] as Point[],
    })),
  );
  if (routes.length === 0) {
    return { width: NOMINAL_WIDTH, height: 300, routes, junctions: [] };
  }

  const graph = buildHarnessGraph(routes);
  // The trunk bundle is already the harness's busiest run, so its longest wire
  // is the natural horizontal spine; everything else hangs off it as a branch.
  const trunk = harness.bundles.find((bundle) => bundle.id === harness.trunkBundleId)
    ?? harness.bundles[0];
  const reference = [...(trunk?.wires ?? [])]
    .sort((left, right) => right.hops.length - left.hops.length)[0];
  const spine = reference ? wireNodeKeys(reference) : routes[0].nodeKeys;
  const tree = buildHarnessTree(graph, spine);
  const { onSpine, parentOf, offAxisDepth, branchRootOf, childIndexOf } = tree;

  // Trunk nodes spread left to right in proportion to their measured runs.
  const width = Math.max(
    NOMINAL_WIDTH,
    2 * MARGIN_X + Math.max(1, spine.length - 1) * 210,
  );
  const spineSpan = width - 2 * MARGIN_X;
  const spineRuns = spine.slice(1).map((key, index) => Math.min(
    MAX_SPINE_MM,
    Math.max(
      MIN_SPINE_MM,
      graph.lengthByEdge.get(edgeId(spine[index], key)) ?? DEFAULT_EDGE_MM,
    ),
  ));
  const spineTotal = Math.max(1, spineRuns.reduce((sum, run) => sum + run, 0));
  const xByKey = new Map<string, number>();
  let travelled = 0;
  spine.forEach((key, index) => {
    if (index > 0) travelled += spineRuns[index - 1];
    xByKey.set(key, spine.length === 1
      ? width / 2
      : MARGIN_X + travelled / spineTotal * spineSpan);
  });

  // A branch is ordered above or below the trunk; alternating keeps the
  // diagram balanced, and every wire inside it inherits that side.
  const branchRoots = [...new Set(branchRootOf.values())].sort((left, right) => {
    const leftX = xByKey.get(parentOf.get(left) ?? '') ?? 0;
    const rightX = xByKey.get(parentOf.get(right) ?? '') ?? 0;
    return leftX - rightX
      || (graph.labelByNode.get(left) ?? left).localeCompare(
        graph.labelByNode.get(right) ?? right, undefined, { numeric: true },
      );
  });
  const sideSlotOf = new Map<string, number>();
  let aboveCount = 0;
  let belowCount = 0;
  branchRoots.forEach((branchRoot, index) => {
    sideSlotOf.set(
      branchRoot,
      index % 2 === 0 ? -(++aboveCount) : ++belowCount,
    );
  });

  const nodeDepth = (key: string): number => offAxisDepth.get(key) ?? 0;
  const sideSlotForNode = (key: string): number => {
    const branchRoot = branchRootOf.get(key);
    return branchRoot === undefined ? 0 : sideSlotOf.get(branchRoot) ?? 0;
  };
  /** How far a node's wires ride off the trunk line, signed by its side. */
  const bandOffsetOf = (key: string): number =>
    Math.sign(sideSlotForNode(key)) * BAND_STEP * nodeDepth(key);
  /** Child indexes walked from the trunk out to `key`, identifying its branch. */
  const trailOf = (key: string): number[] => {
    const trail: number[] = [];
    for (
      let node: string | undefined = key;
      node !== undefined && !onSpine.has(node);
      node = parentOf.get(node)
    ) {
      trail.unshift(childIndexOf.get(node) ?? 0);
    }
    return trail;
  };

  // Every wire gets one global rank. Because each node fans its wires in that
  // same rank order, two wires sharing a run stay parallel and never cross.
  const ordered = routes.map((route) => {
    const startKey = route.nodeKeys[0] ?? '';
    const endKey = route.nodeKeys[route.nodeKeys.length - 1] ?? '';
    const startIsBranch = nodeDepth(startKey) > nodeDepth(endKey)
      || (nodeDepth(startKey) === nodeDepth(endKey)
        && (xByKey.get(startKey) ?? 0) < (xByKey.get(endKey) ?? 0));
    const branchKey = startIsBranch ? startKey : endKey;
    const otherKey = startIsBranch ? endKey : startKey;
    const branchPin = (startIsBranch ? route.wire.from : route.wire.to).pinNumber ?? 0;
    const otherPin = (startIsBranch ? route.wire.to : route.wire.from).pinNumber ?? 0;
    return {
      route,
      groupPath: [sideSlotForNode(branchKey), ...trailOf(branchKey)],
      branchKey,
      otherKey,
      branchPin,
      otherPin,
    };
  });
  ordered.sort((left, right) => {
    const depth = Math.max(left.groupPath.length, right.groupPath.length);
    for (let index = 0; index < depth; index += 1) {
      const difference = (left.groupPath[index] ?? -1) - (right.groupPath[index] ?? -1);
      if (difference !== 0) return difference;
    }
    return left.branchPin - right.branchPin
      || left.otherPin - right.otherPin
      || left.route.wire.wireId.localeCompare(
        right.route.wire.wireId, undefined, { numeric: true },
      );
  });

  const laneOfRoute = new Map<WireRoute, number>();
  let lane = 0;
  ordered.forEach((entry, index) => {
    const previous = ordered[index - 1];
    if (previous) {
      // Air between a branch and the trunk, and enough between two connectors
      // stacked in the same column to fit each one's name. Deeper branches ride
      // further off the trunk, so reserve whatever that peel consumes as well.
      const peel = bandOffsetOf(previous.branchKey) - bandOffsetOf(entry.branchKey);
      lane += 1 + Math.max(0, peel / LANE_GAP) + (
        entry.groupPath[0] !== previous.groupPath[0]
          ? 1.35
          : entry.branchKey !== previous.branchKey
            ? 1
            : 0
      );
    }
    laneOfRoute.set(entry.route, lane);
  });

  // Branches grow away from the side their wires arrive on, so a wire never
  // has to double back on itself to reach its connector.
  const branchStepCeiling = Math.min(
    BRANCH_STEP_MAX,
    Math.max(BRANCH_STEP_MIN, spineSpan / Math.max(1, spine.length - 1)),
  );
  for (const branchRoot of branchRoots) {
    const junction = parentOf.get(branchRoot);
    const junctionX = xByKey.get(junction ?? '');
    if (junctionX === undefined) continue;
    const members = ordered.filter(
      (entry) => branchRootOf.get(entry.branchKey) === branchRoot,
    );
    if (members.length === 0) continue;
    const levels = [...offAxisDepth].reduce(
      (deepest, [key, depth]) =>
        branchRootOf.get(key) === branchRoot ? Math.max(deepest, depth) : deepest,
      1,
    );
    const arrivalX = members.reduce(
      (sum, entry) => sum + (xByKey.get(entry.otherKey) ?? junctionX),
      0,
    ) / members.length;
    const leftRoom = junctionX - MARGIN_X;
    const rightRoom = width - MARGIN_X - junctionX;
    const preferred = arrivalX > junctionX ? -1 : 1;
    const preferredRoom = preferred < 0 ? leftRoom : rightRoom;
    const otherRoom = preferred < 0 ? rightRoom : leftRoom;
    const direction = preferredRoom >= otherRoom * 0.65 ? preferred : -preferred;
    const room = direction < 0 ? leftRoom : rightRoom;
    const step = Math.min(
      branchStepCeiling,
      Math.max(BRANCH_STEP_MIN, room / levels),
    );
    for (const key of offAxisDepth.keys()) {
      if (branchRootOf.get(key) !== branchRoot) continue;
      xByKey.set(key, junctionX + direction * step * nodeDepth(key));
    }
  }

  for (const route of routes) {
    const laneY = (laneOfRoute.get(route) ?? 0) * LANE_GAP;
    route.points = route.nodeKeys.map((key, index) => ({
      x: xByKey.get(key)
        ?? MARGIN_X + index / Math.max(1, route.nodeKeys.length - 1) * (width - 2 * MARGIN_X),
      y: laneY + bandOffsetOf(key),
    }));
  }

  const allPoints = routes.flatMap((route) => route.points);
  const extent = allPoints.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    maxX: Math.max(bounds.maxX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxY: Math.max(bounds.maxY, point.y),
  }), {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  });
  const contentHeight = extent.maxY - extent.minY;
  const height = Math.max(300, Math.ceil(contentHeight + PAD_TOP + PAD_BOTTOM));
  const topOffset = Math.max(PAD_TOP, (height - contentHeight) / 2);
  const overflowsX = extent.minX < MARGIN_X - 1 || extent.maxX > width - MARGIN_X + 1;
  const scaleX = overflowsX
    ? (width - 2 * MARGIN_X) / Math.max(1, extent.maxX - extent.minX)
    : 1;
  for (const point of allPoints) {
    point.y += topOffset - extent.minY;
    if (overflowsX) point.x = MARGIN_X + (point.x - extent.minX) * scaleX;
  }

  const junctionSpans = new Map<string, { x: number; top: number; bottom: number; count: number }>();
  for (const route of routes) {
    route.nodeKeys.forEach((key, index) => {
      const point = route.points[index];
      if (!key.startsWith('merge:') || !point) return;
      const id = key.slice('merge:'.length);
      const current = junctionSpans.get(id);
      if (!current) {
        junctionSpans.set(id, { x: point.x, top: point.y, bottom: point.y, count: 1 });
        return;
      }
      current.top = Math.min(current.top, point.y);
      current.bottom = Math.max(current.bottom, point.y);
      current.count += 1;
    });
  }

  return {
    width,
    height,
    routes,
    junctions: [...junctionSpans].map(([id, span]) => ({
      id,
      x: span.x,
      topY: span.top,
      bottomY: span.bottom,
      wireCount: span.count,
    })),
  };
}

export function ManufacturingHarnessVisualizer({
  harness,
  manufacturing,
  selection,
  onSelect,
  onInspectPath,
  onTasks,
}: {
  harness: ManufacturingHarness;
  manufacturing: ManufacturingDocument;
  selection: ManufacturingVisualSelection | null;
  onSelect: (selection: ManufacturingVisualSelection) => void;
  onInspectPath: (pathId: string) => void;
  onTasks: (tasks: ManufacturingVisualTask[]) => void;
}) {
  const layout = useMemo(() => buildLayout(harness), [harness]);
  const completionTargets = useMemo(() => {
    const targets = new Map<string, ManufacturingVisualTask>();
    for (const route of layout.routes) {
      const cut: ManufacturingVisualTask = {
        bundleId: route.bundle.id,
        update: {
          kind: 'wire-cut',
          wireId: route.wire.id,
          completed: true,
          lengthMm: route.wire.lengthMm,
        },
      };
      targets.set(taskTargetKey(cut), cut);
      (['from', 'to'] as const).forEach((end) => {
        const endpoint = route.wire[end];
        if (endpoint.kind !== 'connector') return;
        const task: ManufacturingVisualTask = {
          bundleId: route.bundle.id,
          update: {
            kind: 'wire-end',
            wireId: route.wire.id,
            end,
            connectorId: endpoint.connectorId,
            completed: true,
          },
        };
        targets.set(taskTargetKey(task), task);
      });
    }
    for (const spliceId of harness.spliceIds) {
      const owner = harness.bundles.find((bundle) =>
        bundle.wires.some((wire) =>
          wire.from.mergePointId === spliceId
          || wire.to.mergePointId === spliceId
          || wire.viaSplices.some((splice) => splice.id === spliceId)
        )
      );
      if (!owner) continue;
      const task: ManufacturingVisualTask = {
        bundleId: owner.id,
        update: { kind: 'splice-measured', spliceId, completed: true },
      };
      targets.set(taskTargetKey(task), task);
    }
    return targets;
  }, [harness, layout.routes]);
  const completionStates = useMemo(() => new Map(
    [...completionTargets].map(([key, task]) => [
      key,
      manufacturingTaskCompleted(manufacturing.bundles[task.bundleId], task.update),
    ]),
  ), [completionTargets, manufacturing]);
  const targetsRef = useRef(completionTargets);
  const completionStatesRef = useRef(completionStates);
  const bulkActive = useRef(false);
  const bulkValues = useRef(new Map<string, boolean>());
  const [bulkPreview, setBulkPreview] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    targetsRef.current = completionTargets;
    completionStatesRef.current = completionStates;
  }, [completionStates, completionTargets]);

  useEffect(() => {
    const visitAt = (x: number, y: number) => {
      const element = document.elementFromPoint(x, y)?.closest<HTMLElement>(
        '[data-manufacturing-completion]',
      );
      const key = element?.dataset.manufacturingCompletion;
      if (!key || !targetsRef.current.has(key) || bulkValues.current.has(key)) return;
      bulkValues.current.set(key, !(completionStatesRef.current.get(key) ?? false));
      setBulkPreview(new Map(bulkValues.current));
    };
    const onMove = (event: PointerEvent) => {
      if (bulkActive.current) visitAt(event.clientX, event.clientY);
    };
    const onUp = () => {
      if (!bulkActive.current) return;
      bulkActive.current = false;
      const tasks = [...bulkValues.current].flatMap(([key, completed]) => {
        const task = targetsRef.current.get(key);
        return task ? [withTaskCompletion(task, completed)] : [];
      });
      bulkValues.current.clear();
      setBulkPreview(new Map());
      if (tasks.length > 0) onTasks(tasks);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [onTasks]);

  const startBulk = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.shiftKey) return;
    const element = (event.target as Element).closest<HTMLElement>(
      '[data-manufacturing-completion]',
    );
    const key = element?.dataset.manufacturingCompletion;
    if (!key || !completionTargets.has(key)) return;
    event.preventDefault();
    bulkActive.current = true;
    const completed = !(completionStates.get(key) ?? false);
    bulkValues.current = new Map([[key, completed]]);
    setBulkPreview(new Map([[key, completed]]));
  };

  const isTaskDone = (task: ManufacturingVisualTask): boolean => {
    const preview = bulkPreview.get(taskTargetKey(task));
    if (preview !== undefined) return preview;
    return manufacturingTaskCompleted(manufacturing.bundles[task.bundleId], task.update);
  };

  const toggleTask = (task: ManufacturingVisualTask) => {
    const completed = isTaskDone(task);
    onTasks([withTaskCompletion(task, !completed)]);
  };

  const drawn = layout.routes.map((route) => {
    const cutTask = completionTargets.get(
      `${route.bundle.id}::wire:${route.wire.id}:cut`,
    )!;
    return {
      route,
      cutTask,
      cutDone: isTaskDone(cutTask),
      appearance: getWireAppearance({
        properties: { wire_color: route.wire.color },
        tags: [],
        signal_id: route.wire.signalId ?? undefined,
      }),
      diameter: getWireDiameterPx(route.wire.gauge),
      selected: (
        (selection?.kind === 'wire' && selection.wireId === route.wire.id)
        || (selection?.kind === 'segment' && selection.wireId === route.wire.id)
        || (selection?.kind === 'endpoint' && selection.wireId === route.wire.id)
      ),
    };
  });

  // Connector shells give each pin column a visible housing to sit in.
  const connectorColumns = new Map<
    string,
    { x: number; top: number; bottom: number; name: string }
  >();
  for (const { route } of drawn) {
    for (const end of ['from', 'to'] as const) {
      const endpoint = route.wire[end];
      const point = end === 'from'
        ? route.points[0]
        : route.points[route.points.length - 1];
      if (endpoint.kind !== 'connector' || !endpoint.connectorId || !point) continue;
      const current = connectorColumns.get(endpoint.connectorId);
      if (!current) {
        connectorColumns.set(endpoint.connectorId, {
          x: point.x,
          top: point.y,
          bottom: point.y,
          name: endpoint.connectorName ?? endpoint.label,
        });
        continue;
      }
      current.top = Math.min(current.top, point.y);
      current.bottom = Math.max(current.bottom, point.y);
    }
  }

  const lengthLabels: Array<{
    key: string;
    x: number;
    y: number;
    angle: number;
    text: string;
    missing: boolean;
    highlighted: boolean;
  }> = [];
  for (const { route } of drawn) {
    route.wire.hops.forEach((hop, hopIndex) => {
      const from = route.points[hopIndex];
      const to = route.points[hopIndex + 1];
      if (!from || !to) return;
      // Sit the tag on the stretch itself, reading left-to-right along the wire.
      const rawAngle = Math.atan2(to.y - from.y, to.x - from.x) * (180 / Math.PI);
      const angle = rawAngle > 90 || rawAngle < -90 ? rawAngle + 180 : rawAngle;
      lengthLabels.push({
        key: `${route.bundle.id}:${route.wire.id}:${hop.segmentIndex}`,
        x: (from.x + to.x) / 2,
        y: (from.y + to.y) / 2,
        angle,
        text: formatLength(hop.lengthMm),
        missing: hop.lengthMm === undefined,
        highlighted: selection?.kind === 'segment'
          && selection.wireId === route.wire.id
          && selection.segmentIndex === hop.segmentIndex,
      });
    });
  }

  return (
    <div
      className="relative h-full min-h-0 select-none overflow-auto bg-[radial-gradient(circle_at_center,_rgba(63,63,70,0.22),_transparent_65%)]"
      onPointerDown={startBulk}
    >
      <div className="sticky left-0 top-0 z-20 flex items-center justify-between border-b border-zinc-800/80 bg-zinc-950/90 px-3 py-1.5 backdrop-blur">
        <div className="flex items-center gap-3 text-[9px] text-zinc-500">
          <span><span className="text-red-400">Red</span> = still to do</span>
          <span><span className="text-emerald-400">Green</span> = complete</span>
          <span>Double-click a pin, splice, or wire to toggle it</span>
        </div>
        <div className="rounded border-2 border-amber-900/70 bg-amber-950/30 px-2 py-1 text-[9px] text-amber-300">
          ⇧ Shift-click or Shift-drag to invert items
        </div>
      </div>
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="block h-[calc(100%_-_38px)] min-h-0 w-full min-w-[780px]"
        role="img"
        aria-label={`${harness.name} manufacturing harness diagram`}
      >
        <defs>
          <filter id="manufacturing-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {harness.bundles.map((bundle) => {
          const routes = layout.routes.filter((route) => route.bundle.id === bundle.id);
          const route = routes[0];
          if (!route || route.points.length < 2) return null;
          const selected = selection?.kind === 'branch' && selection.bundleId === bundle.id;
          return (
            <path
              key={`branch-hit:${bundle.id}`}
              d={joinedPath(route.points)}
              fill="none"
              stroke={selected ? '#f59e0b' : 'transparent'}
              strokeOpacity={selected ? 0.34 : 0}
              strokeWidth={Math.max(34, bundle.wires.length * 8)}
              strokeLinecap="round"
              onClick={() => onSelect({ kind: 'branch', bundleId: bundle.id })}
              className="cursor-pointer"
            >
              <title>
                {bundle.name} · {bundle.wires.length} wires
              </title>
            </path>
          );
        })}

        {[...connectorColumns].map(([connectorId, column]) => (
          <g key={`shell:${connectorId}`} pointerEvents="none">
            <rect
              x={column.x - 14}
              y={column.top - 13}
              width={28}
              height={column.bottom - column.top + 26}
              rx={13}
              fill="#0b0b0e"
              fillOpacity={0.85}
              stroke="#3f3f46"
              strokeWidth={2}
            />
            <text
              x={column.x}
              y={column.top - 21}
              textAnchor="middle"
              fill="#a1a1aa"
              fontSize={10}
              fontWeight={700}
            >
              {column.name}
            </text>
          </g>
        ))}

        {drawn.map(({ route, appearance, diameter, selected, cutTask, cutDone }) => (
          <g key={`wire:${route.bundle.id}:${route.wire.id}`}>
            {route.wire.hops.map((hop, hopIndex) => {
              const from = route.points[hopIndex];
              const to = route.points[hopIndex + 1];
              if (!from || !to) return null;
              const segmentSelected = selection?.kind === 'segment'
                && selection.wireId === route.wire.id
                && selection.segmentIndex === hop.segmentIndex;
              const path = cubicPath(from, to);
              return (
                <g key={`${route.wire.id}:${hop.segmentIndex}`}>
                  <path
                    d={path}
                    fill="none"
                    stroke={cutDone ? '#10b981' : '#ef4444'}
                    strokeOpacity={segmentSelected || selected ? 0.95 : 0.6}
                    strokeWidth={diameter + (segmentSelected ? 15 : 10)}
                    strokeLinecap="round"
                    filter={segmentSelected ? 'url(#manufacturing-glow)' : undefined}
                  />
                  {getWireStrokeLayers(appearance, diameter).map((layer, layerIndex) => (
                    <path
                      key={layerIndex}
                      d={path}
                      fill="none"
                      stroke={layer.color}
                      strokeWidth={layer.width}
                      strokeOpacity={layer.opacity}
                      strokeDasharray={layer.dasharray}
                      strokeDashoffset={layer.dashoffset}
                      strokeLinecap={layer.linecap ?? 'round'}
                    />
                  ))}
                  <path
                    d={path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(20, diameter + 14)}
                    data-manufacturing-completion={taskTargetKey(cutTask)}
                    className="cursor-pointer"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect({
                        kind: 'segment',
                        bundleId: route.bundle.id,
                        wireId: route.wire.id,
                        segmentIndex: hop.segmentIndex,
                      });
                      onInspectPath(route.wire.pathId);
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      toggleTask(cutTask);
                    }}
                  >
                    <title>
                      {route.wire.wireId} · {route.wire.gauge || 'gauge needed'} · double-click to toggle cut
                    </title>
                  </path>
                </g>
              );
            })}
            <path
              d={joinedPath(route.points)}
              fill="none"
              stroke="transparent"
              strokeWidth={Math.max(18, diameter + 10)}
              data-manufacturing-completion={taskTargetKey(cutTask)}
              className="cursor-pointer"
              onClick={(event) => {
                event.stopPropagation();
                onSelect({
                  kind: 'wire',
                  bundleId: route.bundle.id,
                  wireId: route.wire.id,
                });
                onInspectPath(route.wire.pathId);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                toggleTask(cutTask);
              }}
            >
              <title>
                Open {route.wire.wireId} in the inspector · double-click to toggle its cut
              </title>
            </path>
          </g>
        ))}

        {layout.junctions.map((junction) => (
          <line
            key={`junction-bar:${junction.id}`}
            x1={junction.x}
            y1={junction.topY}
            x2={junction.x}
            y2={junction.bottomY}
            stroke="#c084fc"
            strokeOpacity={0.55}
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeDasharray="1 7"
            pointerEvents="none"
          />
        ))}

        {drawn.flatMap(({ route, diameter }) =>
          (['from', 'to'] as const).flatMap((end) => {
            const endpoint = route.wire[end];
            const point = end === 'from'
              ? route.points[0]
              : route.points[route.points.length - 1];
            const inward = end === 'from'
              ? route.points[1]
              : route.points[route.points.length - 2];
            if (endpoint.kind !== 'connector' || !point) return [];
            // Labels sit on the far side of the pin from its own wire run.
            const labelSide = (inward?.x ?? layout.width / 2) >= point.x ? -1 : 1;
            const task = completionTargets.get(
              `${route.bundle.id}::wire:${route.wire.id}:end:${end}`,
            )!;
            const done = isTaskDone(task);
            const endpointSelected = selection?.kind === 'endpoint'
              && selection.wireId === route.wire.id
              && selection.end === end;
            const pinSize = Math.max(9, diameter + 4);
            return [(
              <g
                key={`pin:${route.bundle.id}:${route.wire.id}:${end}`}
                transform={`translate(${point.x} ${point.y})`}
                data-manufacturing-completion={taskTargetKey(task)}
                className="cursor-pointer"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect({
                    kind: 'endpoint',
                    bundleId: route.bundle.id,
                    wireId: route.wire.id,
                    end,
                  });
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  toggleTask(task);
                }}
              >
                <circle
                  r={pinSize}
                  fill={done ? '#064e3b' : '#7f1d1d'}
                  stroke={endpointSelected ? '#fbbf24' : done ? '#34d399' : '#f87171'}
                  strokeWidth={endpointSelected ? 6 : 5}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={endpoint.terminalGender ? pinSize : 7}
                >
                  {endpointEmoji(endpoint.terminalGender)}
                </text>
                <text
                  x={labelSide * (pinSize + 9)}
                  textAnchor={labelSide < 0 ? 'end' : 'start'}
                  dominantBaseline="central"
                  fill="#d4d4d8"
                  fontSize={8.5}
                  fontWeight={600}
                >
                  P{endpoint.pinNumber ?? '?'} · {route.wire.wireId}
                </text>
                <title>
                  {endpoint.familyCode ?? endpoint.familyName} {endpoint.terminalGender ?? 'contact not assigned'} · double-click to toggle this wire end
                </title>
              </g>
            )];
          })
        )}

        {lengthLabels.map((label) => (
          <g
            key={`length:${label.key}`}
            transform={`translate(${label.x} ${label.y}) rotate(${label.angle})`}
            pointerEvents="none"
          >
            <rect
              x={-34}
              y={-7}
              width={68}
              height={14}
              rx={5}
              fill="#09090b"
              stroke={label.highlighted ? '#f59e0b' : '#3f3f46'}
              strokeWidth={2}
            />
            <text
              textAnchor="middle"
              dominantBaseline="middle"
              fill={label.missing ? '#f59e0b' : '#d4d4d8'}
              fontSize={8.5}
            >
              {label.text}
            </text>
          </g>
        ))}

        {layout.junctions.map((junction) => {
          const target = [...completionTargets.values()].find(
            (task) => task.update.kind === 'splice-measured'
              && task.update.spliceId === junction.id,
          );
          if (!target) return null;
          const done = isTaskDone(target);
          const selected = selection?.kind === 'splice'
            && selection.spliceId === junction.id;
          const size = 13;
          return (
            <g
              key={`splice:${junction.id}`}
              transform={`translate(${junction.x} ${junction.topY - 44})`}
              data-manufacturing-completion={taskTargetKey(target)}
              className="cursor-pointer"
              onClick={(event) => {
                event.stopPropagation();
                onSelect({ kind: 'splice', spliceId: junction.id, bundleId: target.bundleId });
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                toggleTask(target);
              }}
            >
              <path
                d={`M 0 ${-size} L ${size} 0 L 0 ${size} L ${-size} 0 Z`}
                fill={done ? '#065f46' : '#7f1d1d'}
                stroke={selected ? '#fbbf24' : done ? '#34d399' : '#c084fc'}
                strokeWidth={selected ? 6 : 5}
              />
              <text y={-20} textAnchor="middle" fill="#c4b5fd" fontSize={9} fontWeight={600}>
                SPLICE · {junction.wireCount}
              </text>
              <text y={24} textAnchor="middle" fill={done ? '#6ee7b7' : '#fca5a5'} fontSize={8}>
                {done ? '✓ MEASURED' : 'MEASURE'}
              </text>
              <title>{junction.id} · double-click to toggle measured</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
