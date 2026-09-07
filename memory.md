# VibeWire fast agent orientation

Read [`AGENTS.md`](AGENTS.md), then only the matching page in [`docs/README.md`](docs/README.md).
This file is a short invariant/pitfall cache, not a feature manual.

## Documentation contract

- Document in-scope behavior and architecture changes in the matching canonical `docs/` page.
- Every new or materially changed feature gets a dated [`CHANGELOG.md`](CHANGELOG.md) product entry.
- New gestures, shortcuts, or non-obvious UI behavior also get a user-facing Tip in
  `src/components/layout/SettingsModal.tsx`.
- The topbar control and modal title are **Tips**. The component/store retain `SettingsModal`,
  `settingsOpen`, and `setSettingsOpen`; there is no `TipsModal`.
- Capture durable user instructions and terminology in `AGENTS.md` plus canonical docs. Ask before
  unrelated backdocumentation.
- `public/user-data/` contains fixtures/test data, never product documentation.

## Domain invariants

- A **System** is the complete loaded design (`SystemData`, store `system`). Canonical meanings:
  [`docs/domain-model.md`](docs/domain-model.md).
- `HierarchyEntity` is exactly Device leaf or Enclosure with an internal conceptual sheet. A
  Bulkhead connector is mounted on an Enclosure.
- A Path is an ordered logical tracker; each adjacent node pair derives one Wire; Harness Bundles are
  grouped routes; Branch Points are topology; Shared Anchors are visual-only.
- Stable IDs/storage keys are identity. Names are mutable, non-unique labels and never rewrite refs.
- Measurements must stay on adjacent Path-node pairs. Use topology helpers; do not mutate node arrays
  directly.
- Canonical topology/helpers live in `src/lib/systemTopology.ts`; types in `src/types/index.ts`.

## Persistence invariants

- Canonical live location: `public/user-data/systems/`. Flat writes are `0.3.0`; sheet writes are
  `0.3.0-sheets`. Sidecars remain beside/under `public/user-data/`.
- Compatibility reads are centralized in `src/lib/systemNormalize.ts`, `server/sheets.ts`, API
  aliases, and snapshot restore. Historical names belong only in
  [`docs/migrations.md`](docs/migrations.md).
- Sheet saves must preflight, split, reassemble, and compare before revision/history/disk mutation.
  Read actual `splitSystem` branches before claiming arbitrary nested-route support.
- System diff ownership is `server/systemDiff.ts`; standalone validation and assembly inspection are
  `scripts/validate_system.py` and `scripts/print-assembled-system.ts`.
- System/library autosave uses CAS; layout/Subsystem/manufacturing maps merge changed keys.
- Vite and API are separate processes. `/api` and `/user-data` proxy to port 3001.
- `vibewire-state/` is partly tracked: users, revisions, checkpoints, edit logs, and attribution.
  Secrets, automatic byte-history, and rollback staging are ignored. Never mutate managed state
  while implementing UI/docs.

## Canvas pitfalls

- Canonical nodes: Enclosure/Device, connector, Branch Point, `CanvasImageNode`, text box; edge:
  `HarnessBundleEdge`. Details: [`docs/canvas.md`](docs/canvas.md).
- Layout keys must survive connector expansion and Branch Point through-family suffixes. Use
  `getHarnessBundleLayoutId` / `getHarnessBundleLayoutValue`.
- Dropping a route point on another Harness Bundle asks **Join as**; default Shared Anchor changes
  layouts only. Branch Point choice/conversion changes Paths. Pending popup state must not create an
  undo entry.
- Floating images use `imageLayouts`/`images` and a context from `canvasImageContextKey`; do not
  reintroduce one-background-per-sheet state.
- Pass-through connector overlap merge and Branch Point fuse/separate are different operations.
- `openEnclosureId` is navigation state. UI language is **Open enclosure** / **Close enclosure**.

## Collaboration and undo

- Presence is fully rendered. Canonical peer fields/targets, attribution, sync, and checkpoints:
  [`docs/collaboration.md`](docs/collaboration.md).
- Presence publishes canonical entity IDs, not synthetic Subsystem React Flow IDs. Client derivation:
  `src/lib/collaborationPresence.ts`; request compatibility boundary: `server/presence.ts`.
- Harness Bundle attribution is the newest entry among its canonical Path IDs.
- Unified undo snapshots System, library, manufacturing, Subsystems, layouts, and selection; replay
  is scoped. No-op detection relies on reference identity—return the same object when unchanged.
- `MAX_HISTORY` is 60; same action keys coalesce within two seconds.

## Ownership and checks

- Architecture/module map: [`docs/architecture.md`](docs/architecture.md)
- Files/API/sheet limitations: [`docs/persistence.md`](docs/persistence.md)
- Subsystem projection/routing: [`docs/subsystems.md`](docs/subsystems.md)
- Manufacturing derivation/progress: [`docs/manufacturing.md`](docs/manufacturing.md)
- Test inventory: [`docs/testing.md`](docs/testing.md)
- Run the narrow suite, then neighbors; use `npm test` for full confidence and always run
  `npm run test:docs` after documentation changes.
