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
  - Harness JSON documents. The app currently hardcodes `fsae-car.json` on startup.
- `public/user-data/connectors/`
  - Connector type catalog plus connector guide/side-view image assets.
- `public/user-data/images/`
  - Background images, enclosure images, and other non-connector user-picked image assets.
- `public/user-data/layouts.json`
  - Persisted graph geometry and graph-only annotations.
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
2. `src/App.tsx` fetches three resources in parallel:
   - `/user-data/harnesses/fsae-car.json`
   - `/user-data/connectors/connector-library.json`
   - `/user-data/layouts.json`
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
4. `initAutoSave()` is called after data loads.
5. The app renders `AppShell`.

Implications:

- The app does not currently select a harness dynamically at startup.
- All user-editable runtime files now live under `public/user-data/`.
- Layout data is independent from harness connectivity data and is safe to evolve separately.

## Source Of Truth And Persistence

The most important architectural rule in this repo:

- Harness semantics live in the harness JSON.
- Connector type semantics live in the connector library JSON.
- Layout and graph-only interaction metadata live in `public/user-data/layouts.json`.

### Files and what they mean

- `public/user-data/harnesses/fsae-car.json`
  - Canonical harness model: enclosures, connectors, merge points, paths, and signals.
- `public/user-data/connectors/connector-library.json`
  - Canonical connector type definitions and associated media names.
- `public/user-data/layouts.json`
  - Node positions, sizes, free connector positions, background image placements, connector type sizing overrides, text boxes, bundle waypoints, junctions, and context-aware merge-point positions.

### Persistence behavior

The app auto-saves with a debounce in `src/store/index.ts`.

- Delay: 1000 ms
- Save endpoints used by the UI:
  - `POST /api/save-harness`
  - `POST /api/save-layouts`
  - `POST /api/save-library`

The store batches pending save types and silently skips persistence errors. That means:

- The UI may appear to work even if the API is unavailable.
- In static-only hosting, edits can fail to persist without obvious user feedback.

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

- `Enclosure`
  - `id`, `name`, `parent`, `container`, `tags`, `properties`
- `Connector`
  - `id`, `name`, `parent`, `connector_type`, `tags`, `properties`
- `MergePoint`
  - `id`, `name`, `parent`, `tags`, `properties`
- `Path`
  - `id`, `name`, `tags`, `properties`, `nodes`, `measurements`
- `Signal`
  - `id`, `name`, `tags`, `properties`

### Important invariants

- Paths are ordered linear node lists, not `from`/`to` pairs.
- Connector path nodes carry `connector_id` and `pin_number`; connectors do not own nested `pins[]`.
- Merge points are semantic harness entities; their positions live in layout state keyed by graph context.
- Path measurements reference semantic `from` and `to` endpoint refs that must resolve uniquely within the same path. Overlapping measurements are allowed.
- Connectors reference a connector type by `connector_type`.
- Enclosure hierarchy is expressed through `parent`.
- Tags are first-class metadata on every entity type.
- `container: false` remains the compatibility path for legacy PCB-like surfaces.

### Connector library model

`ConnectorLibrary` contains `connector_types`, each with:

- `id`
- `name`
- `pin_count`
- `crimp_spec`
- `wire_gauge`
- `notes`
- optional `image`
- optional `side_image`

These type-level images are reused in the graph and inspector and are served directly from `public/user-data/connectors/`.

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

- tag edits
- enclosure property edits
- connector property edits
- connector type image edits
- connector type side image edits

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

It does not provide full history for all harness mutations.

If a future feature changes actual harness data structurally and expects undo/redo, the current architecture will not provide that automatically.

## UI Shell Architecture

`src/components/layout/AppShell.tsx` composes the application into three panes:

- Left sidebar
  - `TreeView`
  - `TagFilterPanel`
- Center panel
  - `GraphView`
- Right sidebar
  - `InspectorPanel` when something is selected

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

Connector occupancy, bundle membership, and signal context are all derived from paths at render time rather than stored as dedicated pin or wire entities.

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
- Status uses `status:<value>` tags.
- The inspector also supports a `by:<name>` tag for status attribution.

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
- expose CRUD and search helpers for future automation
- provide lightweight validation and relationship queries

### Important architectural distinction

The API is more capable than the current UI. It already supports validation, search, connectivity tracing, harness file management, and path-oriented helper routes such as connector-to-path and signal net queries.

### Legacy save endpoints

The UI still uses:

- `POST /api/save-harness`
- `POST /api/save-layouts`
- `POST /api/save-library`

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

## Known Architectural Decisions

These are deliberate or at least currently relied upon:

- JSON files are the canonical data store.
- Layout data is separated from harness data.
- The app boot path is file-based, not backend-query-based.
- The graph is enclosure-centric, connector-centric, and merge-point-aware rather than path-node-centric.
- Multiple visible path segments between the same rendered endpoints are rendered as a single bundle edge.
- Connector occupancy is derived from paths, not stored as pin entities.
- The store is intentionally central and global.
- User-editable JSON and image assets are consolidated under `public/user-data/`, split into `harnesses/`, `connectors/`, and `images/`.
- Auto-save is debounced and silent on failure.

## Known Mismatches, Risks, And Footguns

### README drift

`README.md` is intended to describe the current path model. Keep it aligned with `src/types/index.ts`, `src/lib/harness.ts`, and `server/api.ts` whenever the schema changes.

### Hardcoded harness selection

`src/App.tsx` always loads `fsae-car.json` even though the API can manage multiple harness files.
If multi-harness support is added, startup and save flows will need architectural updates.

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

### Silent save failures

`performAutoSave()` catches and ignores errors.
That is user-friendly during disconnected development, but risky if users assume persistence succeeded.

### Graph-only features live outside harness schema

Text boxes, backgrounds, waypoints, junctions, and type size overrides live in layouts.
If a future feature should travel with harness semantics rather than view state, do not automatically put it in `public/user-data/layouts.json`.

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
- Better persistence feedback in the UI.
- Explicit tests around graph bundling, waypoint persistence, and junction semantics.
- Clearer separation between harness-semantic edits and view/layout edits.
- A smaller or modularized Zustand store.

## Fast Reorientation Checklist

If you return to this repo after time away, re-read these files first:

- `Architecture.md`
- `src/App.tsx`
- `src/store/index.ts`
- `src/types/index.ts`
- `src/components/graph/GraphView.tsx`
- `src/components/graph/BundleEdge.tsx`
- `server/api.ts`
- `vite.config.ts`

## Final Reminder To Future Models

If you touched architecture and did not update `Architecture.md`, your work is incomplete.

Keep this file honest.
Keep it current.
Make the next model faster than you were.
