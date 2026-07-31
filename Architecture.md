# VibeWire Architecture Almanac

This file is the long-lived architectural memory for VibeWire.

If you are a future LLM working in this repository, read this file before re-exploring the codebase.
If you change architecture, data flow, persistence, domain schema, or file ownership, update this file in the same change.
Do not treat this as optional polish. Treat it as required maintenance.

## Maintenance Contract For Future Models

You must update `Architecture.md` whenever a change affects any of the following:

- App startup, data loading, or persistence behavior.
- The source-of-truth files on disk.
- The shape of `src/types/index.ts` or the mirrored API types in `server/api.ts`.
- The Zustand store shape, responsibilities, or undo/redo behavior.
- Graph rendering rules, node/edge types, bundling, waypoint, or junction behavior.
- The responsibilities of major folders or files.
- Any non-obvious convention that a future model would otherwise need to rediscover.

Before ending work, ask yourself:

1. Did I change how the app is loaded, rendered, saved, or mutated?
2. Did I change any schema, invariant, or architectural boundary?
3. Did I create or remove a major file, route, subsystem, or convention?

If the answer to any of those is "yes", update this document.

Recommended prompt for future models:

```text
Read Architecture.md first. Use it as the primary map of the codebase.
Then inspect only the files relevant to my task.
If your changes affect architecture, update Architecture.md before finishing.
```

Recommended close-out prompt for future models:

```text
Before you finish, check whether this task changed any architectural fact, invariant, file ownership boundary, persistence behavior, or developer workflow. If so, update Architecture.md now.
```

## What This Project Is

VibeWire is a local-first wiring harness visualization tool for FSAE electrical systems.

The central product idea is unusual and important:

- The harness data is stored as JSON files in the repo.
- The React app is primarily a visualization, layout, inspection, and light-metadata editing surface.
- The intended authoring workflow is AI-assisted editing of data files, not a full traditional CRUD UI for every harness entity.

That distinction matters. Many features that look like they should be "UI edits" are still expected to happen by editing JSON or by using the local API.

## Core Mental Model

There are three layers that matter:

1. Domain data
   - Harness entities, connector library definitions, and layout metadata.
2. Local persistence/API layer
   - File-backed HTTP endpoints that read and write the JSON files.
3. Visualization/UI layer
   - React Flow graph, hierarchy tree, filters, inspector, and layout tools.

The app is best understood as:

- `public/user-data/harnesses/*.json` holds the electrical model.
- `public/user-data/connectors/connector-library.json` holds connector type definitions and connector-reference images.
- `public/user-data/layouts.json` holds visual geometry and graph-only metadata.
- `src/store/index.ts` is the central in-memory runtime model.
- `src/components/graph/*` turns the model into an interactive graph.

## Tech Stack

- Vite
- React 19
- TypeScript
- Zustand
- `@xyflow/react` for the graph canvas
- Tailwind CSS v4
- A lightweight local Node HTTP API in `server/`

## Top-Level Repository Map

### Runtime-critical paths

- `src/`
  - Frontend app, store, graph, tree, inspector, helpers, and types.
- `public/user-data/`
  - All user-editable project data in one place.
- `public/user-data/harnesses/`
  - Harness documents. Two on-disk formats coexist (see "Hierarchical Per-Sheet Harness Storage" below):
    - Sheeted: `<name>/root.json` + `<name>/sheets/<enc_id>.json` + `<name>/signals.json`. Every harness currently in this repo (`fsae-car/`, `1fsae-car/`, `fsae-2026/`) uses this format.
    - Legacy flat: `<name>.json`. Still fully supported (nothing currently uses it, but `PUT /api/harness?harness=<new-name>` still creates new harnesses this way).
  - The app itself only ever sees the assembled flat `HarnessData` shape regardless of which storage format is used — sheet assembly/splitting happens entirely in `server/sheets.ts` and `server/api.ts`.
- `public/user-data/connectors/`
  - Connector type catalog plus connector guide/side-view image assets.
- `public/user-data/images/`
  - Background images, enclosure images, and other non-connector user-picked image assets.
- `public/user-data/layouts.<name>.json`
  - Persisted graph geometry and graph-only annotations. One file per harness (e.g. `layouts.fsae-car.json`). A legacy `layouts.json` is still read as a fallback for `fsae-car` only.
- `public/user-data/manufacturing.<name>.json`
  - Per-harness manufacturing workflow progress and build notes. Cut lists and BOM rows are derived at runtime from canonical harness and connector-library data rather than duplicated here.
- `server/`
  - File-backed API and optional standalone API server.

### Documentation and workflow paths

- `README.md`
  - User-facing and robot-facing workflow guidance. Some sections are stale relative to the current app behavior.
- `CHANGELOG.md`
  - Intended running log for agent-driven data edits.

## Actual Startup Flow

App boot is simple but important:

1. `src/main.tsx` mounts `App`.
2. `src/App.tsx` resolves the active harness name (persisted in `localStorage` under `vw-active-harness`, default `fsae-car`) and fetches, in parallel:
   - `/user-data/connectors/connector-library.json` (shared across all harnesses, loaded once)
   - `/api/harnesses` → the list of available harness files, used to populate the top-bar selector
   - `/api/harness?harness=<active>` → the harness document
   - `/api/layouts?harness=<active>` → the matching per-harness layout file (`layouts.<name>.json`, with a legacy fall-through to `layouts.json` for `fsae-car` only)
   - `/api/manufacturing?harness=<active>` → the matching manufacturing progress document, or an empty document when none has been saved yet
3. The results are loaded into the global Zustand store through:
   - `loadHarness`
   - `loadConnectorLibrary`
   - `loadLayouts`
   - `loadPortLayouts`
   - `loadSizeLayouts`
   - `loadFreePortLayouts`
   - `loadBackgroundLayouts`
   - `loadConnectorTypeSizes`
   - `loadTextBoxLayouts`
   - `loadWaypointLayouts`
   - `loadJunctionLayouts`
   - `loadManufacturing`
4. `initAutoSave()` is called after data loads.
5. The app renders `AppShell`.

Implications:

- The app supports dynamic harness switching at runtime via `Topbar`'s harness selector (`setActiveHarnessName`) and re-runs the harness-load effect when `activeHarnessName` changes. The default/starting harness is the one in `localStorage`, falling back to `fsae-car`.
- All user-editable runtime files now live under `public/user-data/`.
- Layout data is independent from harness connectivity data and is safe to evolve separately.

## Source Of Truth And Persistence

The most important architectural rule in this repo:

- Harness semantics live in the harness JSON.
- Connector type semantics live in the connector library JSON.
- Layout and graph-only interaction metadata live in `public/user-data/layouts.json`.

### Files and what they mean

- `public/user-data/harnesses/fsae-car/`, `public/user-data/harnesses/1fsae-car/`, `public/user-data/harnesses/fsae-2026/`
  - Canonical harness model: enclosures, connectors, merge points, paths, and signals. All current
    harnesses use the sheeted format (see "Hierarchical Per-Sheet Harness Storage" below).
    `HarnessData.name` is an optional mutable system display name; the directory/file name remains
    the stable storage key used by API queries, layouts, subsystem directories, and local storage.
    `server/api.ts#readHarness` transparently assembles a sheeted harness into the same flat shape
    the app has always used, so nothing above that line needs to know sheets exist. The legacy flat
    `<name>.json` format still works (see below) and is what `PUT /api/harness?harness=<new-name>`
    creates for a brand-new harness -- it just isn't used by any harness in this repo today.
- `public/user-data/connectors/connector-library.json`
  - Canonical connector type definitions and associated media names.
- `public/user-data/layouts.<name>.json`
  - Node positions, sizes, free connector positions, background image placements, connector type sizing overrides, text boxes, bundle waypoints, junctions, context-aware merge-point positions, and rotation overrides. One file per harness.
- `public/user-data/manufacturing.<name>.json`
  - Manufacturing stage completion and notes keyed by stable bundle identity. This is operational state, not electrical topology or graph layout.

### Persistence behavior

The app auto-saves with a debounce in `src/store/index.ts`.

- Delay: 1000 ms
- Save endpoints used by the UI:
  - `POST /api/save-harness`
  - `POST /api/save-layouts`
  - `POST /api/save-library`
  - `POST /api/save-manufacturing`

The store batches pending save types. Failed saves leave the state dirty and set a visible
`mutationError`; successful requests only mark state clean when the saved object references have
not changed during the request. Harness switching flushes pending saves against the current stable
storage key first and is cancelled if that flush fails. That means:

- In static-only hosting, edits remain in memory but show an autosave failure because there is no
  persistence API.
- For a sheeted harness, `POST /api/save-harness` can also fail if the sheet-split round-trip
  check in `server/sheets.ts#writeSheetedHarness` fails (see "Hierarchical Per-Sheet Harness
  Storage"). The API returns a descriptive error and leaves the on-disk sheet files untouched.
- Flat harness saves use an atomic temporary-file replacement. Sheeted saves prepare and verify
  the complete split before replacing their files.

### Production caveat

`npm run build` produces a static frontend, but file persistence requires the API contract.
In dev, Vite mounts the API middleware directly.
Outside dev, you need the standalone API server or an equivalent backend that implements the same endpoints.

## Dev Server And Asset Routing

`vite.config.ts` does more than normal Vite config.

It mounts:

- `createApiMiddleware(__dirname)` for `/api/*`

It also ignores file watching for:

- `public/user-data/**`

That ignore list exists to avoid reload loops while the app is auto-saving those files.

## Domain Model

The canonical frontend types live in `src/types/index.ts`.

### Core entities

- `HarnessData`
  - optional mutable system display `name`; its storage key is managed separately
- `Enclosure`
  - `id`, `name`, `parent`, `container`, `tags`, `properties`
- `Connector`
  - `id`, `name`, `parent`, `connector_type`, optional `pin_count`, optional `keying`, `tags`, `properties`
- `MergePoint`
  - `id`, `name`, `parent`, `tags`, `properties`
- `Path`
  - `id`, `name`, `tags`, `properties`, `nodes`, `measurements`
- `Signal`
  - `id`, `name`, `tags`, `properties`

### Important invariants

- IDs and storage keys are immutable identity; `name` fields are mutable display labels and need
  not be unique. Renaming must not rewrite parents, path nodes, measurements, signal references,
  connector types, subsystem membership keys, layout keys, or `system:<subsystem-id>` tags.
- Paths are ordered linear node lists, not `from`/`to` pairs.
- Connector path nodes carry `connector_id`. The TypeScript type and API validator also declare `pin_number: number`, but the active `fsae-car` harness omits `pin_number` on virtually all connector nodes today. Per-pin features (occupancy map, pin-vs-capacity validation, inspector "you are here" highlight) only activate for nodes that include it. Connectors do not own nested `pins[]` — pin usage is purely a path-node concern. Fixed connector types default to their type-level `pin_count`; `generic_multipin` accepts an arbitrary instance `pin_count`. Connector families always persist the selected physical housing capacity in `Connector.pin_count`, and cavity controls move through the family's declared sizes instead of creating impossible intermediate housings.
- Merge points are semantic harness entities; their positions live in layout state keyed by graph context. In the `fsae-car` harness they are defined but not yet referenced by any path.
- Path measurements reference semantic `from` and `to` endpoint refs that must resolve uniquely within the same path. Overlapping measurements are allowed. No measurements are populated in the `fsae-car` harness yet.
- Connectors reference a connector type by `connector_type`.
- Enclosure hierarchy is expressed through `parent`.
- Tags are first-class metadata on every entity type.
- `container: false` remains the compatibility path for legacy PCB-like surfaces.
- `Connector` and `MergePoint` carry optional `derived`/`derived_from_port` fields. These are only
  ever set for harnesses stored in the sheeted format (see "Hierarchical Per-Sheet Harness
  Storage" below) and mean the entity is synthesized at load time from a `BulkheadPort`, not
  hand-authored. Their display names, tags, and properties still round-trip to the source port.
  They are always absent for flat-file harnesses.

### Signal binding convention

`Path.signal_id` is the stable signal catalog reference. Legacy `signal:<slug>` tags remain readable and `scripts/migrate-signal-ids.ts` adds stable references without deleting those tags. Signal identity does not imply that all paths carrying it form one connected electrical net; topology still determines connectivity.

Signal properties may provide design guidance such as preferred wire color, voltage/current expectations, shielding, or twisting. Actual wire color and gauge remain path properties. Validation warns when an actual wire color differs from `Signal.properties.preferred_wire_color`.

### Connector library model

`ConnectorLibrary` is versioned independently (`schema_version: "1.1.0"`) and contains
`connector_types`, each with:

- `id`
- `name`
- `pin_count`
- `crimp_spec`
- optional `male_crimp_part_number`
- optional `female_crimp_part_number`
- `wire_gauge`
- `notes`
- optional `image`
- optional `side_image`
- optional `cavity_variants`

Entries without `cavity_variants` are fixed connector types. Family entries set `pin_count` to `0`
and declare one `cavity_variants` record per physical housing. A variant contains:

- `pin_count`
- optional `housing_part_number`
- optional `keyings`
- optional `image`
- optional `side_image`

The current family catalog includes Deutsch DT, Deutsch DTM, and dual-row Molex Mini-Fit Jr.
Family connector instances store the family id in `connector_type`, the selected housing capacity
in `pin_count`, and an optional valid `keying`. Housing part numbers vary by cavity variant;
male and female crimp part numbers live once at family/type level because contacts are shared
across every housing size. Images resolve from the selected cavity variant,
then fall back to type-level media. Connector media is served from `public/user-data/images/`.

### Manufacturing model

`src/lib/manufacturing.ts` derives manufacturing output from assembled `HarnessData` plus the
shared connector library. A cut is one adjacent path segment, so a path crossing a splice or
intermediate connector produces multiple physical cuts. `bundle:<name>` tags are the preferred
grouping key; untagged cuts fall back to the graph's stable endpoint-pair bundle key.

Each cut carries its wire ID, signal, color, explicit wire gauge, segment measurement, and both
resolved endpoints. When an explicit path gauge is absent, the connector family's wire range is
shown as an inferred crimp-compatibility range rather than asserted as an exact conductor gauge.
When a path has no explicit wire color, `Signal.properties.preferred_wire_color` supplies the
manufacturing color and the UI marks it as a signal default.

Male/female crimp selection never guesses from connector names. Gender is assigned to a
`(bundle, connector)` endpoint in `ManufacturingDocument`, which applies to every wire at that
bundle end. Other bundles sharing the same connector are treated as its mating side and
automatically receive the opposite gender. Unresolved genders remain manufacturing issues.

The BOM is also derived: wire is grouped by part number or gauge/color, housings by family,
cavity count and part number, and crimps by family/contact gender/part number. Missing cut lengths
remain visible and are not silently included in wire totals. CSV export is generated client-side
from the same rows displayed in the app.

Manufacturing cut lengths are editable numeric millimeter values backed by the same
`Path.measurements` segment records used by the path inspector, so edits auto-save with the
harness and immediately update cut-list and BOM totals.

`ManufacturingDocument` persists six ordered bundle workflow flags (`ordered`, `cut`, `crimped`,
`populated`, `qc`, `installed`), bundle-end gender assignments, and notes. Checking a later stage
completes all prior stages; clearing a stage clears it and all later stages.

Navigation is bidirectional. A manufacturing bundle can open the hierarchy canvas at a sheet that
contains one of its paths and select the best-overlapping visible graph bundle. The graph bundle
inspector derives its best matching logical manufacturing bundle and can open the Manufacturing
page with that bundle preselected. `manufacturingTargetBundleId` is transient store state used only
for this handoff.

### Layout model

Layout state is intentionally separate from harness data. Today it includes:

- `nodes`
- `ports`
- `sizes`
- `free`
- `backgrounds`
- `connectorTypeSizes`
- `textBoxes`
- `waypoints`
- `junctions`
- `mergePoints`

This means graph interaction features can often be added without changing harness schema.

## Hierarchical Per-Sheet Harness Storage

`fsae-2026` is stored as a directory of "sheets" instead of one flat JSON file. This is a
*persistence-layer* feature only — the runtime `HarnessData` shape in `src/types/index.ts` did
not change, and neither did the store, graph, tree, or inspector (beyond a small `derived` badge).
All of the logic lives in `server/sheets.ts`, which is extensively commented; read it before
touching this area.

### Why this exists

The harness previously had to be authored as one giant flat JSON blob with no persistence-level
concept of "this connector belongs to this box." Sheets let each enclosure's wiring live in its
own file, and let a box's external bulkhead connector be *derived* from the wires that reach into
it from the parent sheet, instead of being hand-authored identically on both sides of the
boundary.

### On-disk shape

```
public/user-data/harnesses/<name>/
  root.json              -- root sheet; may carry the mutable system display name
  signals.json           -- flat Signal[] array, shared across every sheet
  sheets/<enc_id>.json   -- one sheet per enclosure that has been split out
```

An enclosure "has its own sheet" purely by the presence of `sheets/<enc_id>.json` on disk. Any
enclosure without that file is simply inlined in whichever ancestor sheet owns it. This makes the
split fully recursive and depth-unlimited: today only the four top-level containers (`enc_001`
FOC, `enc_002` ROC, `enc_003` HVB, `enc_004` Charging Box) have their own sheet file, but a device
inside one of them (e.g. Safety Board) could be promoted to its own sheet later just by adding a
new `sheets/enc_010.json` file — no schema change required.

Each sheet file (`HarnessSheet` in `server/sheets.ts`) has its own `enclosures`, `connectors`,
`mergePoints`, and `paths`, plus a `ports: BulkheadPort[]` array. A `BulkheadPort` declares "a
wire from this sheet terminates inside a specific *direct* child sheet" — it carries the
connector's (or merge point's) real identity (`connector_id`/`merge_point_id`, `name`,
`connector_type`, `tags`, `properties`, and its true nested `entity_parent`, which may be a device
enclosure *inside* the target sheet, not the sheet's own top enclosure id). Paths on the
*declaring* (parent/outer) sheet terminate at a `{ kind: 'port', port_id, pin_number? }` node
instead of an ordinary `connector`/`merge` node.

### Assembly (read path)

`assembleHarnessFromDisk` (used by `readHarness` in `server/api.ts` whenever
`isSheetedHarness()` is true) recursively walks sheets starting from `root.json`. For every
`BulkheadPort` it encounters, it synthesizes a `Connector` or `MergePoint` marked `derived: true`
(with `derived_from_port` set to the port id) inside the target child sheet's scope, and rewrites
the declaring sheet's `port` node into an ordinary node referencing that synthesized entity. By
the time this reaches the frontend, the result is one ordinary flat `HarnessData` — identical in
shape to the legacy format, and nothing downstream of `readHarness()` needs to know sheets exist.

A single path can produce *more than one* sheet fragment sharing the same path id -- this happens
whenever both sides of a boundary have local content of their own (e.g. a path with a materialized
2-node run on one side and a continuation into another sheet on the other), and also for chains
that pass straight through 2+ boundaries in one path (e.g. `fsae-car`'s `FOC-C1 -> ROC-C1 ->
HVB-C1` paths, three sheet-owned nodes in a single path entity). `stitchPathFragments` re-joins all
fragments sharing an id back into one logical `Path`, matching them up by their shared boundary
node (present in both fragments -- once as a real node, once as a resolved port) and deduplicating
that overlap. It throws if fragments for one id don't chain into a single sequence, which would
indicate a genuine splitting bug rather than something to silently paper over.

### Splitting (write path)

`writeSheetedHarness` (used by `writeHarness` in `server/api.ts`) does the inverse: given an
edited `HarnessData`, it recomputes ownership for every entity (nearest ancestor enclosure that
currently has a sheet file, or root), and for every path that crosses a sheet boundary, cuts it
into per-sheet fragments joined by `port` nodes. A connector/merge point automatically becomes
`derived` (and stops being written as a plain entity) the moment *any* path references it across a
sheet boundary — nothing needs to be manually "promoted" to a port. This is computed fresh from
path usage on every save, so editing the name, tags, or properties of a derived connector in the
inspector still round-trips correctly (it rewrites the `BulkheadPort`, not a plain `Connector`).

Before writing anything to disk, `writeSheetedHarness` re-assembles its own split output in memory
and compares it against the original `HarnessData` (`verifyRoundTrip`). If they don't match, it
throws instead of writing — the harness files are only ever updated by the full, freshly-computed
split, never patched incrementally.

### General multi-boundary splitting

Paths with three or more scope runs are split into deterministic two-node fragments, each hosted
by the nearest common sheet of that adjacent pair. Assembly stitches those fragments through their
shared endpoint identity. This supports nested and sibling routes with materialized local runs,
provided a path contains a connector placeholder at every intervening sheet boundary. A direct
jump over an unrepresented nested boundary is rejected instead of being guessed.

Sheet files are fully prepared and round-trip verified before their temporary files replace the
current files. This prevents validation or serialization failures from partially updating a
harness; as with any sequence of filesystem renames, process or disk failure during the rename
window is not a database-grade transaction.

### Migration tooling

- `scripts/migrate-harness-to-sheets.ts` — one-off conversion of an existing flat harness into the
  sheeted layout. Refuses to write anything if the round trip fails.
- `scripts/print-assembled-harness.ts` — prints the assembled `HarnessData` for a sheeted harness
  as JSON; used by `scripts/validate_harness.py` so the Python validator doesn't need to
  reimplement sheet assembly.
- `scripts/migrate-signal-ids.ts` — adds `Path.signal_id` from valid legacy signal tags and relies
  on the sheet round-trip check before writing.

## Subsystem Editing And Routing

Subsystems are flat editing projections over the canonical assembled harness. Their files live at
`public/user-data/subsystems/<harness>/<subsystem-id>.json` and contain only name/tags, membership
through positioned entity ids, frame/device/connector geometry, and optional viewport state.
They never own paths, connectors, devices, or signal records.

Subsystem IDs and `system:<id>` tags remain stable when a subsystem display name changes.

The top-bar canvas-view control switches between hierarchy and subsystem surfaces; structural
editing is always available. A subsystem renders one resizable frame per represented physical
enclosure and groups its physical child devices with that frame. Subsystem layouts are intentionally
freeform for devices, which may be placed beyond the visual frame. Bulkheads remain projected onto
the nearest enclosure boundary, but the projection starts from their saved drag position so they can
move between all four sides without reverting to the left wall. Resizing a frame or device from its
top or left edge updates direct child offsets atomically so their screen positions do not jump when
the persisted graph model is rebuilt.
Connector visibility is controlled per device without duplicating the device. Direct connector
references are used for bulkheads or connectors whose device is absent. Root-level devices and
connectors render directly without an artificial enclosure frame. Hierarchy rows expose direct
add controls. Adding a connector creates its owning enclosure frame and one shared device shell,
but marks that device `selected` in `device_connector_mode` so only explicitly added connectors
are exposed. Adding the device itself changes the mode to `all`.

Subsystem edges are always derived from canonical harness topology; subsystem files never persist
their own connection copies. `deriveSubsystemSegments` contracts connectors and merge points that
are not represented in the active subsystem, preserving connections between their visible
neighbors. Branches through a hidden topology component use a deterministic visible connector as
the projection hub, and projected edges retain every contributing canonical path ID.

Dragging between two unoccupied cavity handles calls `POST /api/paths/route`. `server/routing.ts`
computes endpoint sheet scopes, their LCA, and the ordered child-sheet boundaries crossed. The
route transaction creates one persisted `auto_bulkhead_1p` connector tagged `generated`,
`unresolved`, and `bulkhead` at each boundary, then creates one logical Path through those
placeholders. Request-derived ids make retries idempotent. Occupied cavities are rejected;
connector capacity overruns are warnings.

Expanded connector nodes show a complete cavity table. Dragging a cavity row performs an explicit
physical renumber: every path node and measurement reference to that connector is rewritten through
the same permutation. This is structural editing, not a visual row-order field.

Delete controls in the hierarchy show a cascade-impact confirmation. Deleting an enclosure there
removes descendants, connectors, merge points, affected paths, subsystem references, and any stale
sheet file; deleting another entity similarly removes referencing paths. Delete/Backspace and the
remove control on a subsystem canvas remove only that view instance. A connector belonging to a
represented device is added to `hidden_connectors` so it can be hidden without deleting either the
connector or device.
Removing a device instance also removes every connector instance associated with that device from
the subsystem document while preserving all canonical harness entities and paths.

The route signal picker selects an existing Signal or creates one before routing. Signal IDs in
connector tables and the path inspector open the editable Signal inspector on double-click or
right-click. Adding an entity to a subsystem adds `system:<subsystem-id>` to that entity (and to a
placed device's connectors). Filters derive Signal values from the Signal catalog and System
values from subsystem documents in addition to ordinary tags.

Subsystem documents have their own debounced autosave. Interactive routing bypasses harness
autosave and returns the freshly assembled saved harness so split or round-trip failures can be
shown in the UI.

## Backward Compatibility And Schema Drift

Both the frontend store and the API still normalize legacy data.

### Legacy PCB migration

Old harness files may contain `pcbs`.
Those are migrated into `enclosures` with:

- `container: false`
- copied `id`, `name`, `parent`, `tags`, and `properties`

This migration exists in both:

- `src/store/index.ts`
- `server/api.ts`

Important consequence:

- If you evolve schema migration logic, update both locations or the frontend and API will drift.

### Type duplication warning

`server/api.ts` mirrors many of the domain interfaces instead of importing from `src/types/index.ts`.
This is a convenience for standalone server use, but it is an architectural hazard.

If you change domain types:

- Update `src/types/index.ts`
- Update `server/api.ts`
- Update this document if the meaning of the model changed

## State Management

`src/store/index.ts` is the main runtime brain of the app.

### What the store owns

- Loaded harness data
- Loaded connector library
- Loaded per-harness manufacturing progress
- Selection state
- Drill-down state
- Graph layout state
- Background placement state
- Text box state
- Waypoint and junction state
- Tag filters
- Settings modal state
- Layout undo/redo stacks

### Important architectural fact

The store is monolithic.

This makes it easy to coordinate graph behavior, but it also means:

- Many unrelated concerns live together.
- Changes can have wide side effects.
- Testing and reasoning get harder as features grow.

### Mutations that change harness data

The current UI mainly mutates harness data through:

- display-name edits for systems, subsystems, enclosures/devices, connectors, merge points, paths,
  signals, and connector types
- tag edits
- enclosure property edits
- connector property edits
- connector type image edits
- connector type side image edits
- atomic path creation through the subsystem routing endpoint
- generated one-cavity bulkhead placeholders at crossed sheet boundaries

There is not yet a full in-app entity editor for creating or deleting core harness objects like enclosures, connectors, merge points, or paths.

### Undo/redo boundary

Undo/redo only snapshots layout-oriented state:

- node layouts
- port layouts
- size layouts
- free connector layouts
- background layouts
- connector type sizes
- text boxes
- waypoints
- junctions

It does not provide general history for harness mutations. The store also has a bounded
`StructuralSnapshot` stack containing harness plus subsystem documents, reserved for future
connector merge/split operations; it is intentionally not wired into the ordinary layout
Undo/Redo buttons. Route creation is protected by server-side preflight and all-or-nothing
application rather than by user-facing undo.

## UI Shell Architecture

`src/components/layout/AppShell.tsx` composes the application into three panes:

- Left sidebar
  - `TreeView`
  - `TagFilterPanel`
- Center panel
  - `GraphView`
- Right sidebar
  - `InspectorPanel` when something is selected

The connector library and manufacturing workspace are full-page views inside the same shell.
Manufacturing provides bundle cut-list and BOM subviews; the canvas sidebars are not mounted there.

The top bar contains:

- app identity
- undo
- redo
- settings

Important note:

- The current UI does not expose a manual Save button.
- Persistence is automatic.
- Some docs still describe a manual save workflow.

## Navigation Model

There are two primary navigation systems:

1. Hierarchy navigation
   - `TreeView`
2. Spatial navigation
   - `GraphView` drill-down plus breadcrumbs

### Drill-down behavior

- `drillDownEnclosure` in the store defines the current graph "space".
- `null` means the root view.
- Clicking breadcrumbs in `GraphView` moves back up.
- Double-clicking container enclosures in `TreeView` drills into them.

This "space" concept is central to how the graph decides what is visible.

## Graph Architecture

`src/components/graph/GraphView.tsx` is the main visualization pipeline.

### Node types

Registered React Flow node types:

- `enclosure`
- `connector`
- `backgroundImage`
- `textBox`

### Edge types

Registered edge types:

- `bundle`

### How the graph is built

For the current `spaceId`:

- Child enclosures become graph nodes.
- Direct child connectors of those enclosures become connector child nodes inside enclosure rectangles.
- Connectors whose `parent === spaceId` become free-floating connector nodes.
- Merge points visible in the current context become graph nodes, either nested under an enclosure or free-floating.
- Background image and text boxes for the current context are also added as nodes.
- Visible path segments are derived from `paths[].nodes[]`, then bundled into graph edges.

### What is not rendered as graph nodes

- Signals
- Paths as one-node-per-step graph elements
- Connector pin records, because occupancy is derived from paths

Signals are expressed through tags and inspector context, not as graph nodes.

### Bundling rule

Multiple visible path segments between the same rendered endpoints are combined into a single bundle edge. The bundle key must stay stable so waypoint and junction layout state does not drift across renders.

### Waypoints and junctions

Bundle edges support waypoint editing and shared junctions exactly as before, but those controls now operate on derived path bundles rather than first-class wire entities. Junction and waypoint layout still live outside the harness schema.

### Wire exit side

`BundleEdge` does not draw from React Flow's fixed Left/Right handle coordinates for connectors and merge points. It projects each endpoint onto the node AABB in the direction of the next polyline point (first waypoint, or the peer node's center when there are none), using `pointOnRectBoundaryToward` in `src/lib/paths.ts`. The vertical anchor keeps the cavity-row Y from the React Flow handle so expanded pin wires still leave at the correct row while choosing left/right/top/bottom by geometry. Handles remain for cavity drag-wiring; they are not the visual wire origin.

## Graph Node Responsibilities

### `EnclosureNode`

Responsible for rendering enclosure boxes, images, summary metadata, and resize behavior.

### `ConnectorNode`

Responsible for rendering connectors in either:

- image mode, or
- text mode

Connector image precedence is:

1. instance image from connector `properties.image`
2. connector type `side_image`
3. connector type `image`

The connector node can expand to show derived occupancy inline.

### `TextBoxNode`

A graph-only annotation node with editable text, styling, and resize behavior.
It is persisted to layouts, not the harness schema.

### `BackgroundImageNode`

A graph-only background image node keyed by graph context.

## Tree And Inspector Architecture

### `TreeView`

The tree mirrors hierarchy rather than graph layout.

- Root enclosures render first.
- Root connectors and merge points are shown separately when they are not parented under an enclosure.
- Enclosures recurse through child enclosures.
- Direct connectors and merge points render under their enclosure.
- Connector rows expand into derived occupancy entries instead of nested pin entities.

The tree is therefore the best quick path to inspect structure, review connector occupancy, and select objects without spatial navigation.

### `InspectorPanel`

The inspector is the main edit surface for metadata and visuals.

It supports:

- enclosure inspection
- connector inspection
- merge-point inspection
- path inspection
- bundle inspection
- text box inspection
- background inspection

Core entity inspectors expose an editable name beside a read-only stable ID. Editing-mode hierarchy
rows also offer a rename shortcut; system and subsystem names are edited from the top bar.

Connector occupancy, bundle membership, and signal context are all derived from paths at render time rather than stored as dedicated pin or wire entities.

The inspector can add connectors under devices and bulkheads under container enclosures. New entities are owned solely by setting `Connector.parent` to that enclosure/device id; sheet file placement and `BulkheadPort` derivation remain save-time concerns in `writeSheetedHarness`, not client-side inventorship.

## Tags And Filtering

Tags are a core cross-cutting metadata system.

The helpers live in `src/lib/tags.ts`.

### Tag parsing convention

- `namespace:value` is parsed into namespace plus value
- tags without `:` are assigned to the `notes` namespace for grouping/filtering

### Current filter behavior

- filters are grouped by namespace
- within a namespace, selected values act like OR
- across namespaces, matching behaves like AND

Example:

- `signal:CAN_H` and `location:front`
- item must match one selected `signal` value and one selected `location` value

### Namespace display priority

The filter panel currently prioritizes these namespaces:

- `signal`
- `system`
- `location`
- `status`
- `bundle`
- `notes`

Everything else is sorted alphabetically after those.

## Path Semantics And Appearance

Path visuals are derived rather than stored as first-class graph objects.

Important conventions:

- Color and appearance are inferred from path tags and properties via `src/lib/colors.ts`.
- Signal association is usually represented through tags like `signal:<name>`.
- Bundle membership can be communicated with `bundle:<name>` tags.
- Manufacturing progress is tracked in the manufacturing document, not on path tags.

This means a lot of graph behavior depends on tag conventions plus path topology rather than a richer formal schema.

## Harness Spatial Helpers

`src/lib/harness.ts` contains the rules that translate the raw harness hierarchy into graph visibility.

Key helpers:

- `getChildEnclosures`
- `getEnclosurePorts`
- `getEnclosureConnectors`
- `getSpaceFreeConnectors`
- `getPortWireAppearance`

These functions are a good place to look when changing:

- which connectors appear in a space
- how counts are computed
- how surfaces versus containers should behave

## API Architecture

The local API is defined in `server/api.ts`. It is a file-backed HTTP API, not a database-backed service.

### Primary roles

- read and write harness files
- read and write layouts
- read and write connector library data
- read and write per-harness manufacturing progress
- expose CRUD and search helpers for future automation
- provide lightweight validation and relationship queries

### Important architectural distinction

The API is more capable than the current UI. It already supports validation, search, connectivity tracing, harness file management, and path-oriented helper routes such as connector-to-path and signal net queries.

Entity routes resolve and preserve identity by ID. The legacy `/api/path-by-name` helper prefers an
exact connector ID and accepts a display name only when it matches exactly one connector, preventing
duplicate mutable names from silently selecting the wrong endpoint.

### Legacy save endpoints

The UI still uses:

- `POST /api/save-harness`
- `POST /api/save-layouts`
- `POST /api/save-library`
- `POST /api/save-manufacturing`

Do not remove or rename them unless the frontend save flow is updated too.

## File Ownership Guide

When you need to make changes, start here:

### Change harness schema or entity meaning

- `src/types/index.ts`
- `server/api.ts`
- possibly `README.md`
- this file

### Change startup/loading behavior

- `src/App.tsx`
- `vite.config.ts`
- `server/api.ts`
- this file

### Change graph composition or visibility rules

- `src/components/graph/GraphView.tsx`
- `src/lib/harness.ts`
- this file

### Change edge interaction behavior

- `src/components/graph/BundleEdge.tsx`
- `src/store/index.ts`
- `src/lib/paths.ts`
- this file

### Change graph node rendering

- `src/components/graph/ConnectorNode.tsx`
- `src/components/graph/EnclosureNode.tsx`
- `src/components/graph/TextBoxNode.tsx`
- `src/components/graph/BackgroundImageNode.tsx`

### Change metadata editing or inspection

- `src/components/inspector/InspectorPanel.tsx`
- `src/store/index.ts`
- maybe `src/lib/tags.ts`

### Change hierarchy browsing

- `src/components/tree/TreeView.tsx`
- `src/lib/harness.ts`

### Change persistence or auto-save

- `src/store/index.ts`
- `server/api.ts`
- `vite.config.ts`
- this file

### Change the sheeted harness format or its assemble/split logic

- `server/sheets.ts` (the entire mechanism lives here)
- `server/api.ts` (`readHarness`/`writeHarness`/`GET /api/harnesses`)
- `scripts/migrate-harness-to-sheets.ts`, `scripts/print-assembled-harness.ts`
- `scripts/validate_harness.py`
- this file

## Known Architectural Decisions

These are deliberate or at least currently relied upon:

- JSON files are the canonical data store.
- Layout data is separated from harness data.
- The app boot path is file-based, not backend-query-based.
- The graph is enclosure-centric, connector-centric, and merge-point-aware rather than path-node-centric.
- Multiple visible path segments between the same rendered endpoints are rendered as a single bundle edge.
- Connector occupancy is derived from paths, not stored as pin entities. `Connector.pin_count` is a fixed-type override, an arbitrary generic capacity, or the selected physical housing size for a family.
- The store is intentionally central and global.
- User-editable JSON and image assets are consolidated under `public/user-data/`, split into `harnesses/`, `connectors/`, and `images/`.
- Auto-save is debounced and silent on failure.
- Harness storage format (flat file vs. sheeted directory) is chosen per-harness and is invisible above `server/api.ts#readHarness`/`writeHarness` — the rest of the app only ever deals with the assembled `HarnessData` shape.
- Sheet boundaries are opt-in and presence-based (a `sheets/<enc_id>.json` file existing *is* the declaration that an enclosure has its own sheet), not tracked in a separate manifest.

## Known Mismatches, Risks, And Footguns

### README drift

`README.md` is intended to describe the current path model. Keep it aligned with `src/types/index.ts`, `src/lib/harness.ts`, and `server/api.ts` whenever the schema changes.

### Type duplication between frontend and API

`server/api.ts` mirrors types instead of importing them.
This is easy to forget and a common source of silent drift.

### Monolithic store

`src/store/index.ts` is already broad in scope.
Further feature growth may justify splitting it into:

- domain state
- layout state
- UI state
- persistence side effects

Do not do that casually, but be aware that complexity is accumulating there.

### Save failure presentation

`performAutoSave()` reports failures through the shared graph `mutationError` banner. This is
visible while the graph is mounted, but it is not yet a durable save-status indicator or retry log.

### Graph-only features live outside harness schema

Text boxes, backgrounds, waypoints, junctions, rotations, and type size overrides live in layouts.
If a future feature should travel with harness semantics rather than view state, do not automatically put it in `public/user-data/layouts.<name>.json`.

### Legacy or unused code may exist

There are signs of evolving architecture, for example:

- placeholder seed module
- API comments calling current save endpoints "legacy"
- docs reflecting older concepts

Before deleting something that looks old, verify whether it still participates in the active workflow.

## How To Work Efficiently In This Repo

For future models, the fastest path is usually:

1. Read this file.
2. Identify which layer your task touches:
   - schema
   - store
   - graph
   - inspector/tree
   - API/persistence
3. Inspect only the files listed in the relevant ownership section.
4. After the change, update this file if any architectural fact changed.

## Suggested Future Improvements

These are natural next architectural evolutions, not current guarantees:

- Dynamic harness selection at startup.
- Shared types between frontend and API to avoid duplication.
- A dedicated persistent save-status indicator and retry history.
- Explicit tests around graph bundling, waypoint persistence, and junction semantics.
- Clearer separation between harness-semantic edits and view/layout edits.
- A smaller or modularized Zustand store.
- Splitting a device (e.g. Safety Board) out of `fsae-2026/sheets/enc_001.json` into its own sheet file, to exercise a real 3-level-deep sheet hierarchy.
- Add connector merge/extract tooling backed by the reserved structural snapshot stack.

## Fast Reorientation Checklist

If you return to this repo after time away, re-read these files first:

- `Architecture.md`
- `src/App.tsx`
- `src/store/index.ts`
- `src/types/index.ts`
- `src/components/graph/GraphView.tsx`
- `src/components/graph/BundleEdge.tsx`
- `server/api.ts`
- `server/sheets.ts`
- `vite.config.ts`

## Final Reminder To Future Models

If you touched architecture and did not update `Architecture.md`, your work is incomplete.

Keep this file honest.
Keep it current.
Make the next model faster than you were.
