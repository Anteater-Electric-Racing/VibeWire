# VibeWire product history

User-facing and architectural product changes, newest first. Fixture-specific System edits, pinouts,
IDs, and data corrections belong in Git history, not this changelog.

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
