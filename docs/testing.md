# Testing

Use `npm test` for the complete sequential regression suite. `npm run build` typechecks app, server,
and TypeScript scripts before building; `npm run typecheck` omits the Vite build; `npm run lint`
runs ESLint.

## Script index

Every `package.json` `test:*` command must remain named here:

- `test:renaming` — stable identity, display-name changes, and sheet round trips.
- `test:routing` — Subsystem projection/routing, boundary connectors, cavity renumbering.
- `test:route-style` — straight/grid defaults, overrides, and orthogonal path editing.
- `test:bulkhead-dots` — generated boundary visual-dot repair and routing.
- `test:connectors` — connector families, capacities, keying, media, and round trips.
- `test:inline-connectors` — insertion and pass-through connector merge behavior.
- `test:gauge` — wire-gauge parsing and compatibility intersection.
- `test:hierarchy` — hierarchy moves, containment, and reference preservation.
- `test:manufacturing` — physical grouping, lengths, progress, gender, and BOM derivation.
- `test:undo` — unified snapshots, coalescing, scoping, and depth.
- `test:enclosure-kind` — Device/Enclosure variant behavior.
- `test:domain-model` — canonical System writes and compatibility reads across documents/sheets.
- `test:branch-point-families` — Branch Point through families, split, and fuse.
- `test:join-choice` — Shared Anchor default, Branch Point choice, conversion, and undo.
- `test:canvas-images` — image migration, contexts, selection, and layers.
- `test:presence` — canonical presence, compatibility boundary, UI derivation, and attribution choice.
- `test:collab-api` — CAS, map merges, rollback, SSE, activity, and restore.
- `test:collab-auth` — login, roles, rate limits, signed cookies, presence, and SSE cleanup.
- `test:collab-state` — revisions, history retention, checkpoints, edit logs, and attribution.
- `test:docs` — required pages, local links, and this script index.

Run one suite with `npm run <name>`, for example `npm run test:join-choice`.

## Standalone validation

`npm run validate -- <system-key>` invokes `scripts/validate_system.py`. The validator reads
`public/user-data/systems/` first and supports the historical storage fallback documented in
[`migrations.md`](./migrations.md). Python 3 is required.

## Test isolation

Collaboration/API scripts create disposable project roots in the operating-system temp directory;
they must not write to repository fixture data or `vibewire-state/`. Pure model suites import the
same production helpers used by the UI/server.

When behavior changes, extend the narrowest relevant script and run it plus neighboring integration
suites. Update this page whenever a `test:*` script is added, removed, renamed, or materially changes
scope. `scripts/check-docs.ts` enforces the script-name inventory.
