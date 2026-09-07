import assert from 'node:assert/strict';
import {
  DEFAULT_WIRE_ROUTE_STYLE,
  buildGridPath,
  edgeBelongsToRouteView,
  findRoutePointInsertIndex,
  offsetGridSegment,
  offsetGridVertex,
  pruneUnusedGridWaypoints,
  orthogonalizePolyline,
  resolveEdgeRouteStyle,
  routeViewKey,
  snapToRouteGrid,
  viewRouteWiresAllMatch,
  waypointsFromGridPath,
} from '../src/lib/routeStyle.js';
import { nearestOnPolyline, type Point } from '../src/lib/paths.js';

function point(x: number, y: number): Point {
  return { x, y };
}

{
  const a = point(0, 0);
  const b = point(100, 80);
  const routed = orthogonalizePolyline([a, b]);
  assert.equal(routed.length, 4, 'diagonal hop becomes a Lucidchart Z');
  assert.deepEqual(routed[0], a);
  assert.deepEqual(routed[routed.length - 1], b);
  for (let i = 1; i < routed.length; i++) {
    const prev = routed[i - 1];
    const curr = routed[i];
    assert.ok(
      Math.abs(prev.x - curr.x) < 0.001 || Math.abs(prev.y - curr.y) < 0.001,
      'every generated hop is axis-aligned',
    );
  }
}

{
  const aligned = orthogonalizePolyline([point(10, 4), point(80, 4)]);
  assert.deepEqual(aligned, [point(10, 4), point(80, 4)]);
}

{
  const withWaypoint = orthogonalizePolyline([
    point(0, 0),
    point(40, 60),
    point(120, 80),
  ]);
  assert.ok(withWaypoint.some((p) => p.x === 40 && p.y === 60), 'user waypoint is preserved');
  for (let i = 1; i < withWaypoint.length; i++) {
    const prev = withWaypoint[i - 1];
    const curr = withWaypoint[i];
    assert.ok(
      Math.abs(prev.x - curr.x) < 0.001 || Math.abs(prev.y - curr.y) < 0.001,
      'waypoint hops stay orthogonal',
    );
  }
}

{
  assert.deepEqual(snapToRouteGrid(point(27, 13)), point(20, 20));
  assert.deepEqual(snapToRouteGrid(point(31, 9)), point(40, 0));
}

{
  assert.equal(routeViewKey('hierarchy', 'sub_1'), 'system');
  assert.equal(routeViewKey('subsystem', 'sub_1'), 'subsystem:sub_1');
  assert.equal(edgeBelongsToRouteView('bundle:a|b', 'system'), true);
  assert.equal(edgeBelongsToRouteView('subsystem:sub_1:bundle:a|b', 'system'), false);
  assert.equal(edgeBelongsToRouteView('subsystem:sub_1:bundle:a|b', 'subsystem:sub_1'), true);
}

{
  assert.equal(
    resolveEdgeRouteStyle('bundle:a', {}, undefined),
    DEFAULT_WIRE_ROUTE_STYLE,
  );
  assert.equal(
    resolveEdgeRouteStyle('bundle:a', {}, 'grid'),
    'grid',
  );
  assert.equal(
    resolveEdgeRouteStyle('bundle:a', { 'bundle:a': 'straight' }, 'grid'),
    'straight',
  );
  assert.equal(
    resolveEdgeRouteStyle('bundle:a#pin:1|', { 'bundle:a': 'grid' }, 'straight'),
    'grid',
    'pin-expanded edges inherit the collapsed bundle route style',
  );
}

{
  assert.equal(
    viewRouteWiresAllMatch('straight', {}, {}, 'system'),
    true,
  );
  assert.equal(
    viewRouteWiresAllMatch('grid', { 'bundle:a': 'grid' }, { system: 'straight' }, 'system'),
    false,
  );
  assert.equal(
    viewRouteWiresAllMatch('grid', { 'bundle:a': 'grid' }, { system: 'grid' }, 'system'),
    true,
  );
  assert.equal(
    viewRouteWiresAllMatch(
      'grid',
      { 'bundle:a': 'grid', 'bundle:b': 'straight' },
      { system: 'grid' },
      'system',
    ),
    false,
  );
}

{
  const insert = findRoutePointInsertIndex(
    point(50, 0),
    point(0, 0),
    [],
    point(100, 80),
    'grid',
    nearestOnPolyline,
  );
  assert.equal(insert, 0, 'click on the generated Z inserts the first user waypoint');
}

{
  const path = buildGridPath(
    [point(0, 0), point(100, 0), point(100, 80), point(200, 80)],
    [point(100, 0)],
    [{ sharedAnchorId: null }],
  );
  const moved = offsetGridSegment(path, 1, point(140, 40));
  assert.deepEqual(
    moved.map((node) => node.point),
    [point(0, 0), point(140, 0), point(140, 80), point(200, 80)],
    'dragging a vertical run moves it horizontally',
  );
  assert.equal(moved[1].origin.type, 'plain', 'stored waypoint identity is preserved');
}

{
  const path = buildGridPath([point(0, 0), point(200, 0)], [], []);
  const jog = offsetGridSegment(path, 0, point(100, 40));
  assert.deepEqual(
    jog.map((node) => node.point),
    [point(0, 0), point(0, 40), point(200, 40), point(200, 0)],
    'dragging a connector-to-connector hop inserts a U-jog',
  );
}

{
  const path = buildGridPath(
    [point(0, 0), point(100, 0), point(100, 80), point(200, 80)],
    [],
    [],
  );
  const stub = offsetGridSegment(path, 0, point(50, 40));
  assert.deepEqual(
    stub.map((node) => node.point),
    [point(0, 0), point(0, 40), point(100, 40), point(100, 80), point(200, 80)],
    'dragging the stub off a connector inserts a new orthogonal hop',
  );
}

{
  const path = buildGridPath(
    [point(0, 0), point(0, 50), point(80, 50), point(80, 100)],
    [point(0, 50), point(80, 50)],
    [{ sharedAnchorId: null }, { sharedAnchorId: null }],
  );
  const moved = offsetGridVertex(path, 2, point(100, 80));
  assert.deepEqual(
    moved.map((node) => node.point),
    [point(0, 0), point(0, 80), point(80, 80), point(80, 100)],
    'an end elbow stays on the connector stub instead of spawning extra corners',
  );
  assert.equal(
    waypointsFromGridPath(moved).length,
    2,
    'only the real turns are stored after a vertex drag',
  );
}

{
  const path = buildGridPath(
    [point(0, 0), point(100, 0), point(100, 80), point(200, 80)],
    [],
    [],
  );
  const once = offsetGridSegment(path, 0, point(50, 40));
  const twice = offsetGridSegment(once, 0, point(20, 80));
  assert.ok(
    twice.length <= once.length,
    'dragging a connector stub again must not stack extra floating points',
  );
  assert.ok(
    waypointsFromGridPath(once).length <= 3,
    'the first stub insert stores only the turns it needs',
  );
}

{
  const source = point(0, 0);
  const target = point(200, 0);
  const unused = pruneUnusedGridWaypoints(
    source,
    [point(80, 0)],
    target,
    [{ sharedAnchorId: null }],
  );
  assert.deepEqual(unused, [], 'a collinear pin on a straight hop is unused and dropped');

  const turned = pruneUnusedGridWaypoints(
    source,
    [point(80, 40)],
    target,
    [{ sharedAnchorId: null }],
  );
  assert.equal(turned.length > 0, true, 'a pin that actually turns the wire is kept');
}

console.log('route-style tests passed');
