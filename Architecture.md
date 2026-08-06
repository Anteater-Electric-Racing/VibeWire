# VibeWire Architecture

This is the map of how VibeWire is built. Read it before making structural changes, and update it in
the same change whenever you alter startup, persistence, the domain schema, the store's shape, graph
rendering rules, the API surface, or the responsibilities of a major file.

## What This Project Is

VibeWire is a local-first wiring harness design tool for FSAE electrical systems.

- Harness data is stored as JSON files in the repo under `public/user-data/`.
- The React app is the editing surface: hierarchy browsing, graph layout, inspection, subsystem
  authoring, cavity-level routing, and manufacturing output.
- A small file-backed HTTP API in `server/` reads and writes those JSON files. It exists to serve the
  UI. It is not a general-purpose programmatic interface, and it should not grow endpoints the UI
  does not call.

That last point is a deliberate reversal of an earlier direction. The API used to expose full entity
CRUD, search, connectivity tracing, and validation endpoints so that scripts and LLMs could drive the
app. That was dropped. When you add an endpoint, add it because a screen needs it.

## Core Mental Model

Three layers:

1. **Domain data** — harness entities, connector library definitions, layout metadata.
2. **Persistence/API layer** — file-backed HTTP endpoints over the JSON files.
3. **UI layer** — React Flow graph, hierarchy tree, inspector, library and manufacturing pages.

Concretely:

- `public/user-data/harnesses/<name>/` holds the electrical model.
- `public/user-data/connectors/connector-library.json` holds connector type definitions.
- `public/user-data/layouts.<name>.json` holds visual geometry and graph-only metadata.
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

## Repository Map

### Runtime-critical paths

- `src/` — frontend app, store, graph, tree, inspector, helpers, types.
- `public/user-data/` — all user-editable project data.
  - `harnesses/` — harness documents. Two on-disk formats coexist (see "Hierarchical Per-Sheet
    Harness Storage"): sheeted directories (`<name>/root.json` + `<name>/sheets/<enc_id>.json` +
    `<name>/signals.json`), and legacy flat `<name>.json`. Every harness in this repo is sheeted;
    the flat format is still fully supported and is what `PUT /api/harness?harness=<new-name>`
    creates for a brand-new harness.
  - `connectors/` — connector type catalog.
  - `images/` — all image assets: connector guides and side views, enclosure images, backgrounds.
  - `subsystems/<harness>/` — subsystem canvas documents.
  - `layouts.<name>.json` — persisted graph geometry and graph-only annotations, one per harness.
  - `manufacturing.<name>.json` — per-harness manufacturing workflow progress and build notes. Cut
    lists and BOM rows are derived at runtime from canonical data rather than duplicated here.
- `server/` — file-backed API and the optional standalone API server.
- `vibewire-state/` — runtime collaboration state (accounts, revisions, history, checkpoints, edit
  log, attribution). Gitignored and regenerable; not source.

### Build and typecheck configuration

`tsconfig.json` is a solution file referencing three projects:

- `tsconfig.app.json` — `src/`
- `tsconfig.node.json` — `vite.config.ts`
- `tsconfig.server.json` — `server/` and `scripts/**/*.ts`

`npm run build` runs `tsc -b` across all three, so server and script code is typechecked too. The
server project uses `moduleResolution: bundler` to match how `tsx` actually resolves imports: server
files use `.js` specifiers for their own siblings while `src/` uses extensionless imports, and only
bundler resolution accepts both.

Keeping `scripts/` in the typechecked set matters. The test scripts previously rotted silently
against store refactors because nothing typechecked them.

## Startup Flow

1. `src/main.tsx` mounts `App`.
2. `src/App.tsx` resolves the session, then the active harness name (persisted in `localStorage`
   under `vw-active-harness`, default `fsae-car`).
3. It fetches `/api/harnesses` to populate the top-bar selector. If the remembered harness is not in
   that list — renamed or deleted on disk — it switches to `fsae-car`, or the first available
   harness, rather than failing to boot.
4. It fetches `/api/state?harness=<active>`, which returns harness, layouts, subsystems,
   manufacturing, connector library, and collaboration metadata in one response. A 404 falls back to
   loading each document separately (`/api/harness`, `/api/layouts`, `/api/subsystems`,
   `/api/manufacturing`) and marks collaboration unavailable.
5. The results are loaded into the Zustand store through the `load*` actions.
6. `initAutoSave()` starts the debounced save loop.
7. On the collaboration path, `subscribeToChanges` opens the SSE stream for live revisions.
8. The app renders `AppShell`.

Harness switching at runtime re-runs the load effect. It flushes pending saves against the current
stable storage key first and cancels the switch if that flush fails.

## Source Of Truth And Persistence

The most important rule in this repo:

- Harness semantics live in the harness JSON.
- Connector type semantics live in the connector library JSON.
- Layout and graph-only interaction metadata live in `layouts.<name>.json`.

### Persistence behavior

The app auto-saves with a 1000 ms debounce in `src/store/index.ts`, batching pending save types:

- `POST /api/save-harness`
- `POST /api/save-layouts`
- `POST /api/save-library`
- `POST /api/save-manufacturing`

Failed saves leave the state dirty and set a visible `mutationError`. Successful requests only mark
state clean when the saved object references have not changed during the request.

Consequences:

- In static-only hosting there is no persistence API, so edits stay in memory and surface an autosave
  failure.
- For a sheeted harness, `POST /api/save-harness` can also fail if the sheet-split round-trip check
  in `server/sheets.ts#writeSheetedHarness` fails. The API returns a descriptive error and leaves the
  on-disk sheet files untouched.
- Flat harness saves use atomic temporary-file replacement. Sheeted saves prepare and verify the
  complete split before replacing their files.

### Production caveat

`npm run build` produces a static frontend, but file persistence requires the API contract. In dev,
Vite mounts the API middleware directly. Outside dev you need `npm run api` (`server/index.ts`) or an
equivalent backend implementing the same endpoints.

## Dev Server And Asset Routing

`vite.config.ts` mounts `createApiMiddleware(__dirname)` for `/api/*`, and excludes
`public/user-data/**` from file watching so that auto-saves do not trigger reload loops.

## Domain Model

The canonical frontend types live in `src/types/index.ts`.

### Core entities

- `HarnessData` — optional mutable system display `name`; its storage key is managed separately.
- `Enclosure` — `id`, `name`, `parent`, `container`, `tags`, `properties`
- `Connector` — `id`, `name`, `parent`, `connector_type`, optional `pin_count`, optional `keying`,
  `tags`, `properties`
- `MergePoint` — `id`, `name`, `parent`, `tags`, `properties`
- `Path` — `id`, `name`, optional `signal_id`, `tags`, `properties`, `nodes`, `measurements`
- `Signal` — `id`, `name`, `tags`, `properties`

### Important invariants

- IDs and storage keys are immutable identity; `name` fields are mutable display labels and need not
  be unique. Renaming must not rewrite parents, path nodes, measurements, signal references,
  connector types, subsystem membership keys, layout keys, or `system:<subsystem-id>` tags.
- Paths are ordered linear node lists, not `from`/`to` pairs.
- Connector path nodes carry `connector_id` and `pin_number`. Per-pin features (occupancy map,
  pin-vs-capacity validation, inspector "you are here" highlight) depend on `pin_number` being a
  positive integer. Connectors do not own nested `pins[]` — pin usage is purely a path-node concern.
  Fixed connector types default to their type-level `pin_count`; `generic_multipin` accepts an
  arbitrary instance `pin_count`. Connector families always persist the selected physical housing
  capacity in `Connector.pin_count`, and cavity controls move through the family's declared sizes
  instead of creating impossible intermediate housings.
- Merge points are semantic harness entities; their positions live in layout state keyed by graph
  context.
- Path measurements reference semantic `from` and `to` endpoint refs that must resolve uniquely
  within the same path. Overlapping measurements are allowed.
- Connectors reference a connector type by `connector_type`; enclosure hierarchy is expressed through
  `parent`.
- Tags are first-class metadata on every entity type.
- `container: false` marks a device (a non-container enclosure), and remains the compatibility path
  for legacy PCB-like surfaces.
- `Connector` and `MergePoint` carry optional `derived`/`derived_from_port` fields. These are only
  set for sheeted harnesses and mean the entity is synthesized at load time from a `BulkheadPort`,
  not hand-authored. Their display names, tags, and properties still round-trip to the source port.
  They are always absent for flat-file harnesses.

### Signal binding convention

`Path.signal_id` is the stable signal catalog reference. Legacy `signal:<slug>` tags remain readable —
`getPathSignalId` falls back to them — and `scripts/migrate-signal-ids.ts` adds stable references
without deleting those tags. Signal identity does not imply that all paths carrying it form one
connected electrical net; topology still determines connectivity.

Signal properties may provide design guidance such as preferred wire color, voltage/current
expectations, shielding, or twisting. Actual wire color and gauge remain path properties. Validation
warns when an actual wire color differs from `Signal.properties.preferred_wire_color`.

### Connector library model

`ConnectorLibrary` is versioned independently (`schema_version: "1.1.0"`) and contains
`connector_types`, each with `id`, `name`, `pin_count`, `crimp_spec`, optional
`male_crimp_part_number`, optional `female_crimp_part_number`, `wire_gauge`, `notes`, optional
`image`, optional `side_image`, and optional `cavity_variants`.

Entries without `cavity_variants` are fixed connector types. Family entries set `pin_count` to `0`
and declare one `cavity_variants` record per physical housing, each with `pin_count`, optional
`housing_part_number`, optional `keyings`, optional `image`, and optional `side_image`.

The current family catalog includes Deutsch DT, Deutsch DTM, and dual-row Molex Mini-Fit Jr. Family
connector instances store the family id in `connector_type`, the selected housing capacity in
`pin_count`, and an optional valid `keying`. Housing part numbers vary by cavity variant; male and
female crimp part numbers live once at family/type level because contacts are shared across every
housing size. Images resolve from the selected cavity variant, then fall back to type-level media.
All connector media is served from `public/user-data/images/`.

### Manufacturing model

`src/lib/manufacturing.ts` derives manufacturing output from assembled `HarnessData` plus the shared
connector library. A manufacturing harness is one run between consecutive connectors. Crossing an
intermediate connector starts a new harness; splices inside a run remain explicit, markable work
points with per-hop measurements. Connector-to-splice stub legs stay visible rather than being
assigned an invented mate. Runs are grouped by their stable physical endpoint pair.

Each cut carries its wire ID, signal, color, explicit wire gauge, total run length, per-splice hop
measurements, and both resolved endpoints. When an explicit path gauge is absent, manufacturing
infers a crimp-compatibility window by intersecting both endpoint connector types' `wire_gauge`
ranges (`src/lib/gauge.ts`) rather than asserting an exact conductor gauge. Non-overlapping or
unparseable ranges leave gauge blank and surface as a manufacturing issue. When a path has no
explicit wire color, `Signal.properties.preferred_wire_color` supplies the manufacturing color and
the UI marks it as a signal default.

Path `properties.wire_gauge` is edited per wire in the path inspector. The connector inspector can
also bulk-set gauge on every path landing on that connector. For bulkheads (connectors whose parent
enclosure is a container), the bulk action takes a side filter — internal, external, or both —
classified from whether the adjacent path neighbor lives in the enclosure interior (device/PCB or
in-box splice) versus outside the box.

Male/female crimp selection never guesses from connector names. Gender is assigned to a
`(bundle, connector)` endpoint in `ManufacturingDocument`, which applies to every wire at that bundle
end. Other bundles sharing the same connector are treated as its mating side and automatically
receive the opposite gender. Unresolved genders remain manufacturing issues.

The BOM is also derived: wire is grouped by part number or gauge/color, housings by family, cavity
count and part number, and crimps by family/contact gender/part number. Missing cut lengths remain
visible and are not silently included in wire totals. CSV export is generated client-side from the
same rows displayed in the app.

Manufacturing cut lengths are editable numeric millimeter values backed by the same
`Path.measurements` segment records used by the path inspector, so edits auto-save with the harness
and immediately update cut-list and BOM totals.

`ManufacturingDocument` persists six ordered workflow flags (`ordered`, `cut`, `crimped`,
`populated`, `qc`, `installed`) for every connector end and splice in a run, plus bundle-end gender
assignments and notes. Legacy whole-bundle flags remain a read fallback. Checking a later component
stage completes all prior stages; clearing a stage clears it and all later stages.

Navigation is bidirectional. A manufacturing bundle can open the hierarchy canvas at a sheet that
contains one of its paths and select the best-overlapping visible graph bundle. The graph bundle
inspector compares segment spans — not only path IDs — to choose the correct connector-to-connector
run and can open the Manufacturing page with that bundle preselected.
`manufacturingTargetBundleId` is transient store state used only for this handoff.

### Layout model

Layout state is intentionally separate from harness data, so graph interaction features can often be
added without changing harness schema. It includes `nodes`, `ports`, `sizes`, `free`, `backgrounds`,
`connectorTypeSizes`, `textBoxes`, `waypoints`, `junctions`, `mergePoints`, and `rotations`.

`connectorTypeSizes` is legacy: it is still loaded and persisted so existing layout files round-trip,
but nothing renders from it. Per-instance `sizes` superseded it.

## Hierarchical Per-Sheet Harness Storage

Every harness in this repo is stored as a directory of "sheets" instead of one flat JSON file. This
is a *persistence-layer* feature only — the runtime `HarnessData` shape in `src/types/index.ts` did
not change, and neither did the store, graph, tree, or inspector (beyond a small `derived` badge).
All of the logic lives in `server/sheets.ts`, which is extensively commented; read it before touching
this area.

### Why this exists

The harness previously had to be authored as one giant flat JSON blob with no persistence-level
concept of "this connector belongs to this box." Sheets let each enclosure's wiring live in its own
file, and let a box's external bulkhead connector be *derived* from the wires that reach into it from
the parent sheet, instead of being hand-authored identically on both sides of the boundary.

### On-disk shape

```
public/user-data/harnesses/<name>/
  root.json              -- root sheet; may carry the mutable system display name
  signals.json           -- flat Signal[] array, shared across every sheet
  sheets/<enc_id>.json   -- one sheet per enclosure that has been split out
```

An enclosure "has its own sheet" purely by the presence of `sheets/<enc_id>.json` on disk. Any
enclosure without that file is simply inlined in whichever ancestor sheet owns it. This makes the
split fully recursive and depth-unlimited: today only top-level containers have their own sheet file,
but a device inside one of them could be promoted to its own sheet later just by adding a new sheet
file — no schema change required.

Each sheet file (`HarnessSheet` in `server/sheets.ts`) has its own `enclosures`, `connectors`,
`mergePoints`, and `paths`, plus a `ports: BulkheadPort[]` array. A `BulkheadPort` declares "a wire
from this sheet terminates inside a specific *direct* child sheet" — it carries the connector's (or
merge point's) real identity (`connector_id`/`merge_point_id`, `name`, `connector_type`, `tags`,
`properties`, and its true nested `entity_parent`, which may be a device enclosure *inside* the
target sheet, not the sheet's own top enclosure id). Paths on the *declaring* (parent/outer) sheet
terminate at a `{ kind: 'port', port_id, pin_number? }` node instead of an ordinary
`connector`/`merge` node.

### Assembly (read path)

`assembleHarnessFromDisk` (used by `readHarness` in `server/api.ts` whenever `isSheetedHarness()` is
true) recursively walks sheets starting from `root.json`. For every `BulkheadPort` it encounters, it
synthesizes a `Connector` or `MergePoint` marked `derived: true` (with `derived_from_port` set to the
port id) inside the target child sheet's scope, and rewrites the declaring sheet's `port` node into
an ordinary node referencing that synthesized entity. By the time this reaches the frontend, the
result is one ordinary flat `HarnessData` — identical in shape to the legacy format, and nothing
downstream of `readHarness()` needs to know sheets exist.

A single path can produce *more than one* sheet fragment sharing the same path id — this happens
whenever both sides of a boundary have local content of their own, and also for chains that pass
straight through two or more boundaries in one path. `stitchPathFragments` re-joins all fragments
sharing an id back into one logical `Path`, matching them up by their shared boundary node (present
in both fragments — once as a real node, once as a resolved port) and deduplicating that overlap. It
throws if fragments for one id don't chain into a single sequence, which would indicate a genuine
splitting bug rather than something to silently paper over.

### Splitting (write path)

`writeSheetedHarness` (used by `writeHarness` in `server/api.ts`) does the inverse: given an edited
`HarnessData`, it recomputes ownership for every entity (nearest ancestor enclosure that currently
has a sheet file, or root), and for every path that crosses a sheet boundary, cuts it into per-sheet
fragments joined by `port` nodes. A connector/merge point automatically becomes `derived` (and stops
being written as a plain entity) the moment *any* path references it across a sheet boundary —
nothing needs to be manually "promoted" to a port. This is computed fresh from path usage on every
save, so editing the name, tags, or properties of a derived connector in the inspector still
round-trips correctly (it rewrites the `BulkheadPort`, not a plain `Connector`).

Before writing anything to disk, `writeSheetedHarness` re-assembles its own split output in memory
and compares it against the original `HarnessData` (`verifyRoundTrip`). If they don't match, it throws
instead of writing — the harness files are only ever updated by the full, freshly-computed split,
never patched incrementally.

### General multi-boundary splitting

Paths with three or more scope runs are split into deterministic two-node fragments, each hosted by
the nearest common sheet of that adjacent pair. Assembly stitches those fragments through their
shared endpoint identity. This supports nested and sibling routes with materialized local runs,
provided a path contains a connector placeholder at every intervening sheet boundary. A direct jump
over an unrepresented nested boundary is rejected instead of being guessed.

Sheet files are fully prepared and round-trip verified before their temporary files replace the
current files. This prevents validation or serialization failures from partially updating a harness;
as with any sequence of filesystem renames, process or disk failure during the rename window is not a
database-grade transaction.

### Tooling

- `scripts/migrate-harness-to-sheets.ts` — converts an existing flat harness into the sheeted layout.
  Refuses to write anything if the round trip fails.
- `scripts/print-assembled-harness.ts` — prints the assembled `HarnessData` for a sheeted harness as
  JSON; used by `scripts/validate_harness.py` so the Python validator doesn't reimplement sheet
  assembly.
- `scripts/migrate-signal-ids.ts` — adds `Path.signal_id` from valid legacy signal tags and relies on
  the sheet round-trip check before writing.

## Subsystem Editing And Routing

Subsystems are flat editing projections over the canonical assembled harness. Their files live at
`public/user-data/subsystems/<harness>/<subsystem-id>.json` and contain only name/tags, membership
through positioned entity ids, frame/device/connector geometry, and optional viewport state. They
never own paths, connectors, devices, or signal records.

Subsystem IDs and `system:<id>` tags remain stable when a subsystem display name changes.

The top-bar canvas-view control switches between hierarchy and subsystem surfaces; structural editing
is always available. A subsystem renders one resizable frame per represented physical enclosure and
groups its physical child devices with that frame. Devices stay inside their enclosure frame
(`extent: 'parent'`); out-of-bounds saved layouts clamp into the frame on render and when the frame
is resized. Bulkheads remain projected onto the nearest enclosure boundary, but the projection
starts from their saved drag position so they can move between all four sides without reverting to
the left wall. Resizing a frame or device from its top or left edge updates direct child offsets
atomically so their screen positions do not jump when the persisted graph model is rebuilt.

Connector visibility is controlled per device without duplicating the device. Direct connector
references are used for bulkheads or connectors whose device is absent. Root-level devices and
connectors render directly without an artificial enclosure frame. Hierarchy rows expose direct add
controls. Adding a connector creates its owning enclosure frame and one shared device shell, but
marks that device `selected` in `device_connector_mode` so only explicitly added connectors are
exposed. Adding the device itself changes the mode to `all`.

Subsystem edges are always derived from canonical harness topology; subsystem files never persist
their own connection copies. `deriveSubsystemSegments` contracts connectors and merge points that are
not represented in the active subsystem, preserving connections between their visible neighbors.
Branches through a hidden topology component use a deterministic visible connector as the projection
hub, and projected edges retain every contributing canonical path ID.

Dragging between two unoccupied cavity handles calls `POST /api/paths/route`. `server/routing.ts`
computes endpoint sheet scopes, their LCA, and the ordered child-sheet boundaries crossed. The route
transaction creates one persisted `auto_bulkhead_1p` connector tagged `generated`, `unresolved`, and
`bulkhead` at each boundary, then creates one logical Path through those placeholders.
Request-derived ids make retries idempotent. Occupied cavities are rejected; connector capacity
overruns are warnings.

Expanded connector nodes show a complete cavity table. Dragging a cavity row performs an explicit
physical renumber: every path node and measurement reference to that connector is rewritten through
the same permutation. This is structural editing, not a visual row-order field.

Delete controls in the hierarchy show a cascade-impact confirmation. Deleting an enclosure there
removes descendants, connectors, merge points, affected paths, subsystem references, and any stale
sheet file; deleting another entity similarly removes referencing paths. Delete/Backspace and the
remove control on a subsystem canvas remove only that view instance. A connector belonging to a
represented device is added to `hidden_connectors` so it can be hidden without deleting either the
connector or device. Removing a device instance also removes every connector instance associated with
that device from the subsystem document while preserving all canonical harness entities and paths.

The route signal picker selects an existing Signal or creates one (via `POST /api/signals`) before
routing. Signal IDs in connector tables and the path inspector open the editable Signal inspector on
double-click or right-click. Adding an entity to a subsystem adds `system:<subsystem-id>` to that
entity (and to a placed device's connectors).

Subsystem documents have their own debounced autosave. Interactive routing bypasses harness autosave
and returns the freshly assembled saved harness so split or round-trip failures can be shown in the
UI.

## Backward Compatibility And Schema Drift

### Legacy PCB migration

Old harness files may contain `pcbs`. Those are migrated into `enclosures` with `container: false`
and copied `id`, `name`, `parent`, `tags`, and `properties`. This migration exists in **both**
`src/store/index.ts` and `server/api.ts`. If you evolve schema migration logic, update both or the
frontend and API will drift.

### Type duplication warning

`server/api.ts` mirrors several domain interfaces (`ConnectorType`, `ConnectorLibrary`, `LayoutData`,
`SubsystemDocument`, `ManufacturingDocument`) instead of importing from `src/types/index.ts`. Entity
types (`Connector`, `Enclosure`, `Path`, …) do come from `server/sheets.ts`. This is a convenience for
standalone server use and an architectural hazard. If you change domain types, update
`src/types/index.ts`, update `server/api.ts`, and update this document if the meaning changed.

## State Management

`src/store/index.ts` is the main runtime brain of the app.

### What the store owns

- Loaded harness data, connector library, subsystems, and manufacturing progress
- The server-side mirror of each of those, used for conflict detection and rebasing
- Session and collaboration state (identity, sync status, conflicts, peers, attribution)
- Selection and drill-down state
- Graph layout state: node/port/size/free/background/rotation layouts, text boxes, waypoints,
  junctions, merge-point positions
- Settings modal state
- Undo/redo stacks

### Important architectural fact

The store is monolithic. That makes it easy to coordinate graph behavior, but unrelated concerns live
together, changes can have wide side effects, and reasoning gets harder as features grow.

### Mutations that change harness data

- display-name edits for systems, subsystems, enclosures/devices, connectors, merge points, paths,
  signals, and connector types
- tag edits and enclosure/connector/signal/path property edits
- connector type image and side-image edits, and whole-library replacement from the library page
- cavity capacity and keying changes for connector families
- physical cavity renumbering
- cascade deletes of enclosures, devices, connectors, merge points, and path bundles
- atomic path creation through the subsystem routing endpoint, including generated one-cavity
  bulkhead placeholders at crossed sheet boundaries
- manufacturing cut lengths, which write back to `Path.measurements`

### Undo/redo

`undoStack`/`redoStack` hold `UndoEntry` records, each a before/after `UndoSnapshot` of harness,
library, manufacturing, subsystems, all layout maps, and selection. Consecutive edits sharing an
`actionKey` within 2 seconds coalesce into one entry, so a typing burst undoes as a single step.
`pushUndoSnapshot`/`commitUndoSnapshot` bracket an interactive gesture; a session that changed nothing
is discarded rather than left on the stack. Depth is bounded by `MAX_HISTORY`.

`snapshotsEqual` compares snapshot fields **by reference**, which is what makes no-op detection cheap.
Anything producing a layout map must therefore return the identical object when nothing changed —
`applyLayoutPatch` in `src/lib/sync/diff.ts` does this deliberately. Returning a fresh-but-equal
object there silently reintroduces phantom undo entries.

Undo is scoped: applying an entry replays only the entities that entry touched, so a concurrent
teammate's unrelated edit is not reverted along with your own.

## UI Shell Architecture

`src/components/layout/AppShell.tsx` composes the canvas view into panes:

- Left sidebar: `TreeView` (collapsible, resizable)
- Center: `GraphView`
- Right sidebar: `InspectorPanel`, mounted only when something is selected

The connector library, signal library, and manufacturing workspace are full-page views inside the
same shell; the canvas sidebars are not mounted there. `appView` in the store selects between them.

The top bar contains app identity, the harness selector, canvas-view and page switches, undo/redo,
collaboration controls (session, sync status, users, activity, checkpoints), and settings.

There is no manual Save button. Persistence is automatic.

## Navigation Model

Two primary navigation systems:

1. **Hierarchy navigation** — `TreeView`
2. **Spatial navigation** — `GraphView` drill-down plus breadcrumbs

`drillDownEnclosure` in the store defines the current graph "space". `null` means the root view.
Clicking breadcrumbs moves back up; double-clicking container enclosures in `TreeView` drills in.
This "space" concept is central to how the graph decides what is visible.

## Graph Architecture

`src/components/graph/GraphView.tsx` is the main visualization pipeline for the hierarchy surface;
`src/components/graph/graphModel.ts` builds the subsystem surface.

### Registered types

Node types: `enclosure`, `connector`, `mergePoint`, `backgroundImage`, `textBox`.
Edge types: `bundle`.

### How the hierarchy graph is built

For the current `spaceId`:

- Child enclosures become graph nodes.
- Direct child connectors of those enclosures become connector child nodes inside enclosure
  rectangles.
- Connectors whose `parent === spaceId` become free-floating connector nodes.
- Merge points visible in the current context become graph nodes, nested or free-floating.
- Background image and text boxes for the current context are added as nodes.
- Visible path segments are derived from `paths[].nodes[]`, then bundled into graph edges.

### What is not rendered as graph nodes

Signals, paths as one-node-per-step elements, and connector pin records. Occupancy is derived from
paths; signals are expressed through inspector context rather than as graph nodes.

### Bundling rule

Multiple visible path segments between the same rendered endpoints are combined into a single bundle
edge. The bundle key must stay stable so waypoint and junction layout state does not drift across
renders.

### Waypoints and junctions

Bundle edges support waypoint editing and shared junctions. Junction and waypoint layout lives
outside the harness schema, in layouts.

### Wire exit side

`BundleEdge` does not draw from React Flow's fixed Left/Right handle coordinates for connectors and
merge points. Connector endpoints use the geometric center of the node AABB. Merge-point endpoints
project onto the node AABB in the direction of the next polyline point (first waypoint, or the peer
node's center when there are none), using `pointOnRectBoundaryToward` in `src/lib/paths.ts`.
Handles remain for cavity drag-wiring; they are not the visual wire origin.

### Stacking order

React Flow uses `zIndexMode="manual"` with explicit layers from `src/lib/connectorSize.ts`:
background (−1000) < enclosure (0) < wire (2) < connector/merge (3) < text (10) < selected/hovered
wire (1000) < expanded connector (2000). Wires therefore cross over enclosure bodies but pass under
connector nodes (important now that wires emit from connector centers).

## Graph Node Responsibilities

- **`EnclosureNode`** — enclosure boxes, images, summary metadata, resize behavior.
- **`ConnectorNode`** — connectors in image or text mode, expandable to show derived occupancy
  inline. Schematic image: bulkheads use type `side_image`; free-hanging connectors use instance
  `properties.image`. Pin-guide `image` is inspector/manufacturing only and never appears on the canvas.
- **`MergePointNode`** — splice/merge nodes.
- **`TextBoxNode`** — graph-only annotation with editable text, styling, and resize. Persisted to
  layouts, not the harness schema.
- **`BackgroundImageNode`** — graph-only background image keyed by graph context.

## Tree And Inspector Architecture

### `TreeView`

The tree mirrors hierarchy rather than graph layout. Root enclosures render first; root connectors
and merge points are shown separately when not parented under an enclosure; enclosures recurse
through child enclosures; direct connectors and merge points render under their enclosure; connector
rows expand into derived occupancy entries instead of nested pin entities.

It is the fastest way to inspect structure, review connector occupancy, and select objects without
spatial navigation.

### `InspectorPanel`

The main edit surface for metadata and visuals. It supports enclosure, connector, merge-point, path,
bundle, signal, text box, and background inspection.

Core entity inspectors expose an editable name beside a read-only stable ID. Hierarchy rows also
offer a rename shortcut; system and subsystem names are edited from the top bar.

Connector occupancy, bundle membership, and signal context are all derived from paths at render time
rather than stored as dedicated pin or wire entities.

The inspector can add connectors under devices and bulkheads under container enclosures. New entities
are owned solely by setting `Connector.parent` to that enclosure/device id; sheet file placement and
`BulkheadPort` derivation remain save-time concerns in `writeSheetedHarness`, not client-side
inventorship.

## Tags

Tags are cross-cutting metadata on every entity, written as `namespace:value` (`zone:front`,
`system:demo`, `signal:CAN_H`). They are edited in the inspector, which offers existing tags from
`getAllExistingTags` as suggestions, and they feed:

- subsystem membership, through `system:<subsystem-id>`
- wire appearance, through `src/lib/colors.ts`
- routing bookkeeping, through `generated`/`unresolved`/`bulkhead` on placeholder connectors

There is no tag-filter UI. An earlier version dimmed non-matching nodes based on an `activeFilters`
map, but nothing ever set it, so the whole mechanism (including the per-node `matchesFilter` flag)
was removed. If you reintroduce filtering, it needs a real control surface, not just store state.

## Path Semantics And Appearance

Path visuals are derived rather than stored as first-class graph objects:

- Color and appearance are inferred from path tags and properties via `src/lib/colors.ts`.
- Signal association uses `Path.signal_id`, with legacy `signal:<slug>` tags as a fallback.
- Bundle membership can be communicated with `bundle:<name>` tags.
- Manufacturing progress is tracked in the manufacturing document, not on path tags.

## Harness Spatial Helpers

`src/lib/harness.ts` contains the rules that translate the raw harness hierarchy into graph
visibility. Key helpers: `getChildEnclosures`, `getEnclosurePorts`, `getEnclosureConnectors`,
`getSpaceFreeConnectors`, `getConnectorOccupancy`, `getBundleSegments`, `getPortWireAppearance`.

Look here when changing which connectors appear in a space, how counts are computed, or how surfaces
versus containers behave.

## API Architecture

`server/api.ts` is a file-backed HTTP API, not a database-backed service. Its scope is "what the UI
needs" — see "What This Project Is". Routes are registered through `addRoute` (open) and
`addEditorRoute` (requires the `editor` role).

### Current surface

**Auth and users** — `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`,
`GET /api/users`, `POST /api/users`, `PATCH /api/users/:id`, `DELETE /api/users/:id`

**Collaboration** — `GET /api/state` (whole-app bootstrap), `GET /api/sync` (delta since a
revision), `GET /api/events` (SSE), `POST /api/presence`

**History** — `GET /api/checkpoints`, `POST /api/checkpoints`, `GET /api/checkpoints/:id`,
`POST /api/checkpoints/:id/restore`, `GET /api/activity`

**Documents** — `GET /api/harnesses`, `GET /api/harness`, `PUT /api/harness` (create or replace),
`GET /api/layouts`, `GET /api/manufacturing`, `GET /api/subsystems`, `PUT /api/subsystems/:id`,
`DELETE /api/subsystems/:id`

**Connector library** — `GET /api/library`, `GET /api/library/usage`,
`DELETE /api/library/connector-types/:id`

**Targeted mutations** — `POST /api/signals` (the graph's route picker can mint a signal before
routing), `POST /api/paths/route`

**Saves** — `POST /api/save-harness`, `POST /api/save-layouts`, `POST /api/save-library`,
`POST /api/save-manufacturing`. These are the UI's autosave endpoints. Do not remove or rename them
without updating the store's save flow.

**Assets** — `GET /api/list-assets`, `POST /api/upload-image`

### Writes, validation, and rollback

Harness and sidecar writes go through `commitHarnessDocument`/`commitHarnessSidecar`, which take the
per-harness lock, check the client's revision (CAS), snapshot to history, apply the mutation, and
validate. If validation gets worse than it was before the write, the payload is rolled back
byte-exactly via `restoreManagedPayload` and the request fails with `validation-degradation`.

`restoreManagedPayload` and `checkpointPayloadDir` live in `server/history.ts` and are the single
implementation used for both write rollback and checkpoint restore. `payloadArtifacts` there is the
one place that enumerates a harness's on-disk files — add new per-harness files to that list.

## File Ownership Guide

| To change… | Start with |
| --- | --- |
| Harness schema or entity meaning | `src/types/index.ts`, `server/api.ts`, this file |
| Startup/loading behavior | `src/App.tsx`, `vite.config.ts`, `server/api.ts`, this file |
| Graph composition or visibility rules | `src/components/graph/GraphView.tsx`, `src/components/graph/graphModel.ts`, `src/lib/harness.ts` |
| Edge interaction behavior | `src/components/graph/BundleEdge.tsx`, `src/store/index.ts`, `src/lib/paths.ts` |
| Graph node rendering | `src/components/graph/{ConnectorNode,EnclosureNode,MergePointNode,TextBoxNode,BackgroundImageNode}.tsx` |
| Metadata editing or inspection | `src/components/inspector/InspectorPanel.tsx`, `src/store/index.ts` |
| Hierarchy browsing | `src/components/tree/TreeView.tsx`, `src/lib/harness.ts` |
| Persistence or auto-save | `src/store/index.ts`, `server/api.ts`, `vite.config.ts` |
| The sheeted harness format | `server/sheets.ts`, `server/api.ts`, `scripts/migrate-harness-to-sheets.ts`, `scripts/validate_harness.py` |
| Collaboration behavior | `Collaboration.md`, `server/{auth,revisions,history,editlog,attribution,presence,sse}.ts`, `src/lib/sync/*` |

## Known Architectural Decisions

These are deliberate, or at least currently relied upon:

- JSON files are the canonical data store.
- Layout data is separated from harness data.
- The app boot path is file-based, not backend-query-based.
- The API's job is to serve this UI. It is not a general automation surface.
- The graph is enclosure-centric, connector-centric, and merge-point-aware rather than
  path-node-centric.
- Multiple visible path segments between the same rendered endpoints render as a single bundle edge.
- Connector occupancy is derived from paths, not stored as pin entities.
- The store is intentionally central and global.
- Auto-save is debounced, and surfaces failure through the graph's `mutationError` banner.
- Harness storage format (flat file vs. sheeted directory) is chosen per-harness and is invisible
  above `readHarness`/`writeHarness`.
- Sheet boundaries are opt-in and presence-based: a `sheets/<enc_id>.json` file existing *is* the
  declaration that an enclosure has its own sheet. There is no separate manifest.

## Known Risks And Footguns

**Type duplication between frontend and API.** `server/api.ts` mirrors types instead of importing
them. Easy to forget, and a common source of silent drift.

**Monolithic store.** `src/store/index.ts` is already very broad. Further growth may justify
splitting it into domain state, layout state, UI state, and persistence side effects. Be aware that
complexity is accumulating there.

**Reference-equality snapshots.** See "Undo/redo" above. Layout helpers must preserve object
identity when nothing changed.

**Save failure presentation.** `performAutoSave()` reports failures through the shared graph
`mutationError` banner. That is visible while the graph is mounted, but it is not a durable
save-status indicator or retry log.

**Graph-only features live outside harness schema.** Text boxes, backgrounds, waypoints, junctions,
rotations, and type size overrides live in layouts. If a future feature should travel with harness
semantics rather than view state, do not automatically put it in `layouts.<name>.json`.

**Half-wired presence.** Peer presence is plumbed end to end on the server and up to the store
(`replacePeers`), and `usePeersForEntity` exists to read it, but no component renders peers and
nothing calls `setInteracting`, so the client never publishes its own presence. As a result the
`interactingEntities` / `queuedRemoteUpdates` guard that defers remote updates during an active
gesture never arms. Either finish wiring it or remove it; don't leave it ambiguous.

## Testing

`npm test` runs every suite sequentially. Individual suites live in `scripts/` and are wired as
`npm run test:*`:

| Suite | Covers |
| --- | --- |
| `test:renaming` | display-name edits never disturb identity or references; sheet round trip |
| `test:routing` | subsystem projection, bulkhead merge, cavity renumber, `POST /api/paths/route` |
| `test:connectors` | connector families, capacity/keying rules, sheet round trips |
| `test:manufacturing` | cut-list and BOM derivation |
| `test:undo` | undo/redo coalescing, scoping, and depth |
| `test:collab-api` | CAS, concurrent saves, layout merge, rollback, SSE, activity, restore |
| `test:collab-auth` | login, roles, rate limiting, cookie signing, presence, SSE cleanup |
| `test:collab-state` | revisions, history, checkpoints, edit log, attribution, pruning |

The collaboration suites build throwaway project roots under the system temp directory and never
write beneath `public/user-data/`. `npm run validate` runs the standalone Python structural validator
against a harness.

## Fast Reorientation Checklist

Returning after time away, re-read these first:

- `Architecture.md`
- `src/App.tsx`
- `src/store/index.ts`
- `src/types/index.ts`
- `src/components/graph/GraphView.tsx`
- `src/components/graph/BundleEdge.tsx`
- `server/api.ts`
- `server/sheets.ts`
- `vite.config.ts`
