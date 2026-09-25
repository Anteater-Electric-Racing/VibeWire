# VibeWire product history

User-facing and architectural product changes, newest first. Fixture-specific System edits, pinouts,
IDs, and data corrections belong in Git history, not this changelog.

## 2026-09-17 — Fix corner resize being hijacked by visual-dot placement

- Dragging a Device or Enclosure box's corner resize handle could instead start placing a wall
  visual dot, because the wall-hover draft's hit-tested rect could overlap the resize handle.
  Hovering or pressing down on a `react-flow__resize-control` handle now always suppresses the
  visual-dot draft, so corner (and edge) resizing works reliably again.

## 2026-09-17 — Visual dots accept unlimited wires and match splice color

- A Bulkhead visual dot is now an unlimited splice point instead of a two-sided cavity: any number
  of wires may route onto the same dot, on the same side, even while the dot already carries other
  wires. Previously a second wire on the same side (or a third wire at all) was rejected with
  "already has an external/internal connection" or "occupied cavity". Two single-wire dots joined
  directly still stitch into one continuous pass-through path as before; ordinary Bulkhead and
  Inline connectors keep the strict one-wire-per-side rule since they represent one physical cavity.
- When every signal already routed to a visual dot shares one wire color, the **Choose signal**
  popup now pre-fills that color for a new wire routed to the same dot, even if the new wire ends up
  on a different signal or pin.

## 2026-09-17 — Click a pass-through wire to rename its signal

- Clicking a Harness Bundle that runs dot-to-dot (a Bulkhead visual dot on each end) and carries
  exactly one named signal now jumps straight into renaming that signal, instead of only selecting
  the bundle. Type the new name; Enter or clicking away commits it, Escape cancels. Bundles that
  touch a device/enclosure box on either end, or that mix or lack a named signal, still just select
  on click and rename via double-click on the name as before.

## 2026-09-17 — Black wires keep a light grey outline

- Solid and striped black wires draw a light grey outline on the canvas and in manufacturing so they
  stay visible on the dark background.

## 2026-09-17 — Rename a signal from its bundle label, hide default names

- A Harness Bundle's single-signal name label is now editable in place: double-click it to rename
  the underlying signal. Enter or blur commits, Escape cancels.
- The label no longer shows for signals that still have their default `new signal` name; it starts
  showing once the signal is renamed to something else. The path-count chip stays visible instead.
- When the name has been dragged off its default midpoint, a ⤾ button next to it resets the
  position (previously double-click did this, which now renames instead).

## 2026-09-17 — Hide and restore signal names

- Delete, Backspace, or the × on a single-signal name hides that label. Selecting the Harness
  Bundle shows a **Show signal name** checkbox to display it again.

## 2026-09-17 — Double-click is not stolen by rename or the inspector

- Double-clicking a boxed name still opens an enclosure or expands a connector. The name waits a
  beat before turning into a text caret.
- When a canvas click first opens the inspector, the panel waits that same beat so it does not
  cover the second click or focus the name field.

## 2026-09-17 — Draggable signal names

- Drag a single-signal name beside its Harness Bundle to place it. The offset is saved with the
  layout. Double-click the name to snap it back to the default midpoint.

## 2026-09-17 — Signal names on single-signal wires

- A Harness Bundle that carries exactly one named signal shows that name next to the route. Bundles
  with mixed or uninitialized signals still show the path-count chip.

## 2026-09-17 — Device and Enclosure hotkeys

- While editing the canvas, press **D** to create a Device or **E** to create an Enclosure and name
  it immediately. E still resumes the saved editing session when editing is inactive.

## 2026-09-17 — Complete routes between new wall dots

- Dragging from a new wall dot to another greyed dot or Bulkhead now opens **Choose signal** and
  creates both endpoints with the Wire. Canceling leaves no new connectors.

## 2026-09-17 — Create connectors from the canvas controls

- The top-left **+ Connector** button appears while inspecting a Device or Enclosure. It adds an
  endpoint to the Device or a Bulkhead to the Enclosure and opens the new connector in the inspector.
  The button is first in the stack, and the name field is focused with its default text selected for
  immediate typing.

## 2026-09-07 — Canvas create, routing drafts, and editable names

- Added left-canvas **+ Device** and **+ Enclosure** buttons that create a box on the current sheet. In a
  Subsystem view they land on the System root sheet and are added to that Subsystem. The inspector
  name field is focused so the new box can be renamed immediately. **+ Inline connector**, **+ Image**,
  and **+ Text Box** sit in the same left stack.
- Inspector **+ Bulkhead** is available on both Devices and Enclosures; Devices still have
  **+ Connector** for interior endpoints. Bulkheads can mount on Device walls as well as Enclosure
  walls.
- Routing a wire onto a Device or Enclosure wall previews a greyed visual dot. Routing into blank
  space previews a greyed Bulkhead. Existing dots and bulkheads keep a drop dead zone.
- Visual-dot inspectors hide connector-library controls (type, images, cavities, gender, gauge)
  until the dot is converted back to a bulkhead. Connectors, bulkheads, and dots have a Subsystems
  checkbox dropdown.
- Names and other editable text use a visible box, including canvas titles.

## 2026-09-07 — Inspector layout

- Removed the inspector title row and **Last saved by** footer.
- Color is a chevron dropdown of named swatches; device and enclosure **description** is an editable
  text box; **Stable ID** sits at the bottom of the selected record.
- Connector **Type** no longer repeats family housing, cavity lists, crimp spec, or wire gauge under
  the control.
- Removed the inspector **Derived** badge and bulkhead-port explanation.

## 2026-09-04 — Versioned documentation standards

- Added canonical task-oriented documentation under `docs/`, concise human onboarding, and
  compatibility redirects for old root links.
- Added enforced documentation workflow: in-scope changes update canonical docs automatically; new
  gestures update **Tips**; new or materially changed features receive a dated entry here.
- Added `test:docs` coverage for required pages, links, and the complete `test:*` script index.

## 2026-09-04 — Canonical System domain migration

- Added canonical System, HierarchyEntity, Device, Enclosure, Branch Point, Shared Anchor, Wire, and
  Harness Bundle names across runtime types, persistence, collaboration, and UI.
- Added canonical flat `0.3.0` and sheet `0.3.0-sheets` writes under
  `public/user-data/systems/`, while retaining explicit compatibility readers for historical fields,
  paths, HTTP aliases, layouts, presence packets, manufacturing progress, and snapshots.
- Added canonical topology normalization and regression coverage without rewriting archived
  checkpoints or stable historical IDs.

## 2026-09-04 — Explicit Harness Bundle join choice

- Added the **Join as** popup when a route point is dropped onto another Harness Bundle.
- Added **Shared anchor** as the default visual-only choice and **Branch point** as the explicit
  topology-changing choice.
- Added inspector conversion in both directions with safety blocking for sheet-derived or
  path-ambiguous Branch Points, plus unified undo and measurement-preserving topology updates.

## 2026-09-04 — Finished presence and attribution UI

- Added live peer locations in the topbar and rendered stacked presence badges across graph nodes,
  Harness Bundles, hierarchy rows, libraries, annotations, inspector content, and manufacturing.
- Added pulsing field-editing presence, canonical entity-keyed publication, and plain-language
  System/Enclosure/Subsystem locations.
- Added inspector **Last saved by** attribution, including newest-Path aggregation for selected
  Harness Bundles and exact timestamp/revision tooltips.

## 2026-08-06 — Self-service accounts

- Added self-service account creation with editor/viewer roles and immediate login.
- Removed the admin role and roster-management endpoints; accountability now uses activity and
  attribution.
- Added separate signup and login rate limits while keeping private login names out of client
  responses.

## 2026-08-06 — Daily checkpoints

- Added one automatic checkpoint on the first successful write of each edited UTC day.
- Added contributor attribution covering everyone who saved since the previous daily checkpoint.
- Added a distinct daily-checkpoint presentation in the checkpoint panel.

## 2026-08-05 — Crossing-free manufacturing diagram

- Added a tree-based physical harness layout with stable global Wire lanes so shared runs remain
  parallel and do not cross.
- Added outward-growing branches, connector shells, cavity labels, Branch Point markers, and
  collision-aware length labels.

## 2026-08-04 — Subsystem containment

- Added parent-bound containment for nested Subsystem Enclosure frames and Devices.
- Added clamping for out-of-bounds saved layouts during graph build and resize.

## 2026-07-27 — Save and pin-count hardening

- Added finite pin-count normalization so incomplete cavity references cannot produce invalid numeric
  values or fail sheet round-trip comparison.
- Added defensive capacity and round-trip checks for malformed connector instances.

## 2026-07-27 — Freeform Subsystem placement

- Added freely arranged root Devices while retaining boundary projection for Bulkhead connectors.
- Added wall-to-wall Bulkhead dragging from persisted positions and stable child positions when
  resizing from top or left edges.

## 2026-07-27 — Connector families

- Added family-based connector types with manufacturable cavity variants, keying, housing part
  numbers, shared contacts, and per-variant media.
- Added family-aware capacity controls, validation, graph rendering, manufacturing resolution,
  sheet round trips, and migration tooling.

## 2026-07-27 — Geometry-aware Wire exits

- Added boundary-facing Wire exits based on the next route point or peer endpoint.
- Added cavity-row exits for expanded connectors while preserving geometric exits when collapsed.

## 2026-07-26 — Direct structural editing

- Added structural editing controls directly to the normal System and Subsystem surfaces.
- Added cavity-level routing/renumbering, context-sensitive deletion, and collapsed/expanded
  connector Wire handling without a separate mode toggle.

## 2026-07-14 — Stable display-name editing

- Added stable-ID-preserving rename controls for Systems, Subsystems, HierarchyEntities, connectors,
  Branch Points, Paths, signals, and connector types.
- Added separate mutable System display names and storage keys, atomic flat writes, visible autosave
  failures, save flushing before System switches, and rename integrity tests.

## 2026-07-14 — Subsystem routing

- Added per-System Subsystem canvases with independent membership, geometry, viewport, and connector
  visibility.
- Added stable signal references, preferred-color validation, signal select/create routing, and
  cavity-level drag wiring.
- Added atomic cross-sheet route creation with unresolved generated Bulkhead connector placeholders,
  idempotent requests, round-trip preflight, and capacity/occupancy validation.
- Added explicit distinction between removing a Subsystem view instance and cascading deletion from
  the System hierarchy.
