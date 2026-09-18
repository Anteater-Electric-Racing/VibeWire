# Canvas

`src/components/graph/GraphView.tsx` owns System-sheet composition and canvas gestures;
`graphModel.ts` owns Subsystem projection; `HarnessBundleEdge.tsx` owns Harness Bundle rendering and
route-point interaction. Electrical semantics come from `src/lib/systemTopology.ts`; layout
semantics remain in the layout sidecar.

User-facing gestures and shortcuts belong in `src/components/layout/SettingsModal.tsx`, whose
topbar control and modal title are **Tips**.

## What renders

Canonical node types are Enclosure/Device (`enclosure`), connector, Branch Point, `CanvasImageNode`,
and text box. Harness Bundles are the only edge type. The System sheet shows hierarchy children and
the connectors/Branch Points visible in the current context; **Open enclosure** changes that context
and **Close enclosure** returns outward.

Multiple Wires sharing rendered endpoints collapse into one Harness Bundle. Expanded connectors fan
the bundle into cavity-specific edges. Branch-through route families remain separate when Paths
continue to different far-side neighbors, even if they share one approach Wire.

Connector occupancy, signal context, wire appearance, and Harness Bundle membership are derived from
Paths. Layout records never define electrical connectivity. Solid or striped black wires draw a light
grey outline so they stay visible on the dark canvas; manufacturing uses the same stroke layers. A Harness Bundle that carries exactly one
named signal shows that signal name next to the route; mixed-signal or uninitialized bundles keep
the path-count chip. Editors can drag the signal name; the offset and a hidden flag are stored in
layout `signalLabels` by Harness Bundle id. Delete, Backspace, or the label × hides it. Selecting
the Harness Bundle offers a **Show signal name** checkbox to bring it back. Double-click the name
to return it to the default midpoint.

## Route points and styles

Waypoints are stored by stable Harness Bundle layout IDs. Double-clicking a bundle or using
**+ Route points** inserts one; dragging writes live layout updates. Selecting a route point makes
Delete/Backspace remove that point rather than the Harness Bundle.

Routing styles are:

- `straight` — direct polyline through stored route points; this is the default.
- `grid` — 20-pixel orthogonal routing with generated corners.

Generated grid corners are not persisted handles. Segment and vertex drags simplify the route and
persist only meaningful turns or Shared Anchors. `routeStyles` overrides one bundle;
`viewRouteStyles` supplies the System or `subsystem:<id>` default. Expanding a connector must not
change the layout key or lose route state.

As built, route-style setters update layout state and participate in explicit flush/layout diffs,
but `initAutoSave` does not schedule a layout save when only `routeStyleLayouts` or
`viewRouteStyleLayouts` changes. A later layout mutation or System-switch flush persists them; fix
the subscription when changing this behavior.

## Shared Anchor vs Branch Point

Dropping a route point onto another Harness Bundle opens **Join as**:

- **Shared anchor** is the default and Enter choice. It is visual only; Paths do not change.
- **Branch point** inserts a real Branch Point into matching Paths.
- Escape cancels the join. The route-point move may remain.

If the source already belongs to a Shared Anchor, linking another Harness Bundle preserves that
join's established visual/topological type without another prompt.

The inspector can **Convert to branch point** or **Convert to shared anchor**. Demotion is blocked
when the Branch Point is sheet-derived or has unpaired stubs that cannot become a valid visual join.
Conversions update Paths, route layouts, and measurements as one undoable action through
`src/lib/sharedAnchorJoin.ts`.

## Branch Point families

The inspector groups each distinct two-sided connection through a Branch Point. **Split out**, or
dragging a branch-family handle away, moves exact Path occurrences to a new Branch Point. Dragging
compatible free Branch Points together fuses them. Fuse requires the same parent and rejects a Path
that already traverses both.

Pass-through connector overlap is separate: same-role inline connectors can merge, and Bulkhead
connectors can merge on the same Enclosure wall. Authored hardware wins over generated placeholders;
ordinary endpoint connectors and mixed roles do not merge.

## Routing Wires

Dragging between unoccupied cavity handles opens **Choose signal**. It starts at an uninitialized
signal, can create a signal with preferred color or choose an existing one, and routes through
`POST /api/paths/route`. The transaction rejects occupied cavities and returns the saved System.
Cross-sheet routes create unresolved generated Bulkhead connector placeholders at each represented
boundary.

While a wire is being dragged, a greyed preview follows the cursor:

- On a Device or Enclosure wall, the preview is a visual dot.
- In blank space (the interior of a box, or empty sheet away from existing hardware) the preview is
  a new Bulkhead connector. On an open Enclosure sheet with no nearby box, that bulkhead is parented
  to the current sheet and placed at the drop.
- Existing dots and bulkheads keep a dead zone so the draft is not easy to drop onto the wrong one.
  Hitting a cavity handle still snaps to that connector.

The preview stays greyed until the wire is dropped and a signal is chosen. Hovering a wall without
dragging still offers a visual-dot draft you can pull a new route from. That draft can be dropped
onto another wall-dot or blank-space Bulkhead preview as well as an existing cavity. Choosing a signal
creates both new endpoints and the Wire together; canceling creates neither.

Hovering a connector during a route temporarily opens its cavity table. Dragging one cavity onto
another on the same connector performs a physical renumber and rewrites every Path and measurement
reference.

Inserting an inline connector into a Harness Bundle preserves Path identity and splits an existing
hop length. Overlapping a compatible pass-through connector takes merge priority.

## Creating Devices and Enclosures

While editing the canvas, **D** creates a Device and **E** creates an Enclosure using the same
actions as the buttons below. These unmodified shortcuts ignore typing, open modals, and held-key
repeats. Before editing is armed after a cookie restore, E still means **Continue as** the saved user.

The left canvas buttons **+ Device** and **+ Enclosure** create a named box on the current sheet (the
open Enclosure, or the System root) and focus the inspector name field. In a Subsystem view they are
created on the System root sheet and then added to the active Subsystem so they appear on the canvas.
**+ Inline connector**, **+ Image**, and **+ Text Box** sit in the same left stack. The inspector
**+ Bulkhead** button is available on both Devices and Enclosures; Devices also keep **+ Connector**
for interior endpoint connectors. While a Device or Enclosure inspector is open, the top-left
stack shows **+ Connector** as its first button. It creates an endpoint on the selected Device or a Bulkhead on the
selected Enclosure, then selects the new connector and focuses its name with the default text selected
so typing immediately replaces it. It works in System and Subsystem
views and is disabled without editing access.

## Images, text, and layers

Floating images are `CanvasImageLayout` records rendered by `CanvasImageNode`; many may exist in
each System root, open Enclosure, or Subsystem context. They can be background or foreground, sized,
named, locked, and selected by double-click when locked. Asset files live in
`public/user-data/images/`.

Text boxes are also layout-only, context-keyed, styleable, resizable annotations. Tree rows list
images and text for the relevant context. Neither changes System topology.

## Selection and delete

Boxed names on devices, enclosures, and connectors rename in place on a single click. When the box
sits on an enclosure that can be opened or a connector that can expand, that click waits
`DOUBLE_CLICK_GUARD_MS` so a double-click still reaches the node. The inspector also waits that
window when a canvas pointer first reveals it, so the panel does not cover the second click or put
a caret in the name field.

System hierarchy deletion is cascading: descendants, connectors, Branch Points, affected Paths,
Subsystem references, and obsolete sheet files are removed after impact confirmation. Removing an
item from a Subsystem removes only that view reference. Selecting a Harness Bundle exposes its Path
membership, routing, length editor, Shared Anchor operations, and manufacturing navigation.

Update this page when graph registrations, visibility/bundling, route layout IDs, signal-name labels, canvas gestures,
join behavior, routing transactions, or image/text contexts change. Add or update a **Tip** whenever
a person must learn a new gesture or non-obvious result.
