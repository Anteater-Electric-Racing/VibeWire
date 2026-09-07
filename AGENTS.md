# VibeWire agent guide

Project-wide documentation workflow and a short read order. Canonical detail lives under `docs/`; do not copy it here.

## Documentation workflow

After in-scope behavior or architecture changes, update docs in the same change. Do not wait to be asked.

1. Write the fact on the matching page linked from [`docs/README.md`](docs/README.md).
2. New gesture, shortcut, or non-obvious UI: add a user-facing Tip in `src/components/layout/SettingsModal.tsx` (topbar and modal title **Tips**; store `settingsOpen`).
3. New or materially changed product feature: add a dated entry to [`CHANGELOG.md`](CHANGELOG.md) in the same change. Record VibeWire behavior, not fixture-specific edits.
4. Capture durable user instructions and canonical names in this file and `docs/`. Names: [`docs/domain-model.md`](docs/domain-model.md).
5. Fix stale references you touch. Ask in chat before unrelated backdocumentation or cleanup.

`public/user-data/` is fixture and test data, not product documentation. Legacy names belong only in [`docs/migrations.md`](docs/migrations.md) and compatibility readers.

## Product-language decisions

Do not silently accept terminology that conflicts with the app or established harness concepts. Explain the mismatch and propose the clearer model before implementing it.

## Read order

Start here, then open only what the task needs:

1. [`docs/README.md`](docs/README.md) — index
2. Task match:
   - names, entities, topology → [`docs/domain-model.md`](docs/domain-model.md)
   - code layout and ownership → [`docs/architecture.md`](docs/architecture.md)
   - files and API → [`docs/persistence.md`](docs/persistence.md)
   - graph, routes, canvas gestures → [`docs/canvas.md`](docs/canvas.md)
   - subsystem views → [`docs/subsystems.md`](docs/subsystems.md)
   - manufacturing output → [`docs/manufacturing.md`](docs/manufacturing.md)
   - multi-user editing → [`docs/collaboration.md`](docs/collaboration.md)
   - tests and `test:*` scripts → [`docs/testing.md`](docs/testing.md)
   - legacy names and format readers → [`docs/migrations.md`](docs/migrations.md)
3. How to change, test, and document: [`CONTRIBUTING.md`](CONTRIBUTING.md)
