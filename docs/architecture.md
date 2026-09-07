# Architecture

VibeWire is a React 19 + TypeScript application backed by a local Node HTTP API. Zustand owns the
runtime document and UI state; `@xyflow/react` renders the System and Subsystem graphs; JSON files
are the durable source of truth.

## Runtime flow

1. `src/main.tsx` mounts `App`.
2. `src/App.tsx` resolves the remembered session, loads the connector library and available Systems,
   then requests `/api/state?system=<key>`.
3. If collaboration bootstrap is unavailable, `App` falls back to the individual System, layout,
   Subsystem, and manufacturing reads.
4. Loaded documents are normalized and installed in `src/store/index.ts`.
5. Autosave starts; collaboration opens the SSE stream and a 20-second sync backstop.
6. `AppShell` renders one of the five surfaces and mounts presence publication.

System switching flushes outstanding saves before changing the stable storage key.

## Repository map

- `src/types/` — canonical client domain and collaboration contracts.
- `src/store/index.ts` — loaded/server-confirmed documents, layout state, selection, undo/redo,
  autosave, conflict rebase, presence, and view state.
- `src/lib/systemTopology.ts` — canonical topology, Wire and Harness Bundle derivation, insertion,
  fuse/separate, connector merge, and identity helpers.
- `src/lib/systemNormalize.ts` — dual-read/canonical-write adapters.
- `src/components/graph/` — React Flow model and interaction layer.
- `src/components/tree/` and `src/components/inspector/` — hierarchy and metadata editing.
- `src/components/{connectors,signals,manufacturing,collab,history}/` — full-page and shared features.
- `server/api.ts` — file-backed routes, validation, transactions, and write orchestration.
- `server/sheets.ts` — flat runtime System to per-Enclosure sheet assembly/splitting.
- `server/systemDiff.ts` — deterministic System-entity and sidecar-map diffing.
- `server/{auth,revisions,history,editlog,attribution,presence,sse}.ts` — collaboration services.
- `public/user-data/` — versioned fixture/test documents and media.
- `vibewire-state/` — collaboration records; see [`persistence.md`](./persistence.md).
- `scripts/` — regression suites, validators, and migrations.

`tsconfig.json` builds the app, Vite config, server, and TypeScript scripts. Server sibling imports
use `.js` specifiers because `tsx` executes ESM source.

## UI composition

`AppShell` owns the topbar and page switch:

- System and Subsystem share `GraphView`, hierarchy tree, and inspector panes.
- Connectors and Signals are full-page libraries.
- Manufacturing is a full-page workbench with an optional inspector.

The current canonical graph registrations are:

- nodes: `enclosure`, `connector`, `branchPoint`, `canvasImage`, and `textBox`;
- edge: `harnessBundle`, rendered by `HarnessBundleEdge`.

`backgroundImage` remains only as a node-registration compatibility alias to `CanvasImageNode`.
Graph composition is split between `GraphView.tsx` for System sheets and `graphModel.ts` for
Subsystem projections. Signals and Paths are not one-node-per-record graph objects; occupancy,
Wires, and Harness Bundles are derived from ordered Paths.

## State boundaries

The store keeps both local documents and last server-confirmed mirrors. Autosave diffs those mirrors,
which prevents remote updates from echoing back as writes.

Semantic System and connector-library changes use strict revisions. Layout, Subsystem, and
manufacturing maps merge by changed key. The unified undo stack snapshots System, library,
manufacturing, Subsystems, all layout maps, and selection; replay is a scoped patch so unrelated
concurrent state survives. Entries coalesce by action key for two seconds and are capped at 60.

Layout-only state is deliberately separate from `SystemData`: positions, sizes, images, text boxes,
waypoints, Shared Anchors, Branch Point positions, rotations, and route styles can change without
altering electrical semantics.

## Development topology

`npm run dev` uses `concurrently`:

- Vite serves the frontend and proxies `/api` and `/user-data`;
- `server/index.ts` listens on `PORT` or 3001 and restarts independently under `tsx watch`.

`vite.config.ts` excludes `public/user-data/**` and `vibewire-state/**` from watching so autosaves do
not force full-page reloads. A production build is static and still needs `npm run api` or a backend
implementing the same contract.

## Ownership guide

- Domain fields or terminology: `src/types/index.ts`, `src/lib/systemNormalize.ts`,
  `server/sheets.ts`, [`domain-model.md`](./domain-model.md), and [`migrations.md`](./migrations.md).
- Startup or view composition: `src/App.tsx`, `AppShell.tsx`, `Topbar.tsx`, `vite.config.ts`.
- Graph visibility or interaction: `GraphView.tsx`, `graphModel.ts`, `systemTopology.ts`,
  `HarnessBundleEdge.tsx`, and [`canvas.md`](./canvas.md).
- Persistence/API: `src/store/index.ts`, `server/api.ts`, `server/sheets.ts`, `server/history.ts`,
  and [`persistence.md`](./persistence.md).
- Collaboration: `src/lib/sync/`, collaboration components, collaboration server modules, and
  [`collaboration.md`](./collaboration.md).
- Derived manufacturing: `src/lib/manufacturing.ts`, manufacturing components, and
  [`manufacturing.md`](./manufacturing.md).

## Footguns

- `server/api.ts` mirrors some sidecar/library interfaces; update both sides when their shapes change.
- Undo no-op detection depends on reference identity. Helpers must return the same object when
  nothing changed.
- Stable IDs and System storage keys are not display names.
- A sheet write must pass preflight round-trip verification before any history or revision mutation.
- Graph-only state belongs in layouts unless it changes electrical or manufacturing semantics.

Update this page when startup, module ownership, major state boundaries, graph registrations, or
process topology changes.
