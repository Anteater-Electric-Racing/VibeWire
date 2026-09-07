# VibeWire

VibeWire is a local-first electrical System and wiring design tool. It combines hierarchy and
schematic editing, focused Subsystem diagrams, shared connector and signal libraries, collaboration,
and manufacturing output in one React application.

Files under `public/user-data/` are included fixtures and test data. No included System is the
product or the default documentation example.

## Run locally

Requirements: Node.js `^20.19.0` or `>=22.12.0` (required by Vite 8), npm, and optional Python 3 for
the standalone validator.

```bash
npm install
npm run dev
```

Open the Vite URL, normally <http://localhost:5173>. `npm run dev` starts two processes:

- `dev:web` runs Vite and proxies `/api` and `/user-data` to port 3001.
- `dev:api` runs the file-backed API with `tsx watch`.

Both are required for working autosave. The browser has no Save button: System and library changes
schedule after about 300 ms; ordinary layout, Subsystem, and manufacturing changes schedule after
about one second. A static frontend without `npm run api` can render, but cannot persist edits.
The current route-style-only scheduling caveat is recorded in [`docs/canvas.md`](docs/canvas.md).

Anyone may browse. Editing requires an editor account and an explicitly activated edit session.
Accounts are self-service from **Log in**; presence, attribution, conflicts, activity, and
checkpoints are built in.

## Five surfaces

1. **System** — hierarchy tree, enclosure sheets, interactive graph, inspector, Harness Bundles,
   route points, Branch Points, Shared Anchors, text, and floating images.
2. **Subsystem** — a focused projection that stores membership and geometry while deriving all
   electrical topology from the System.
3. **Manufacturing** — derived physical harnesses, cut lengths, build progress, connector guides,
   work attribution, BOM, and CSV export.
4. **Connectors** — the shared fixed-type and connector-family catalog, cavity variants, part
   numbers, gauge ranges, and media.
5. **Signals** — reusable signal definitions, preferred wire colors, tags, and structured or
   free-form properties.

Use the inspector for selected-object edits. Stable IDs and storage keys are identity; display names
may change or repeat.

## Canonical storage

The complete loaded design is a **System**. New live System data belongs under
`public/user-data/systems/`, either as a flat `<key>.json` or a sheet directory:

```text
public/user-data/
  systems/<key>.json
  systems/<key>/root.json
  systems/<key>/signals.json
  systems/<key>/sheets/<enclosure-id>.json
  layouts.<key>.json
  manufacturing.<key>.json
  subsystems/<key>/<subsystem-id>.json
  connectors/connector-library.json
  images/
```

Sheet files assemble into one in-memory `SystemData` and are split and round-trip verified before a
save is installed. Edit sheeted Systems through VibeWire unless you understand
[`server/sheets.ts`](server/sheets.ts). Compatibility readers for older paths and names are
documented in [`docs/migrations.md`](docs/migrations.md).

## Project map

- `src/` — React UI, Zustand store, graph models, domain helpers, and client sync.
- `server/` — API, authentication, revisions, sheet I/O, history, attribution, and presence.
- `scripts/` — regression suites, validation, and migration tools.
- `docs/` — canonical product and contributor documentation.
- `public/user-data/` — versioned fixture/test Systems and sidecars.
- `vibewire-state/` — collaboration records. Most are tracked; only secrets, automatic byte-history,
  and rollback staging are ignored.

## Development commands

```bash
npm run dev          # API and Vite together
npm run dev:web      # Vite only
npm run dev:api      # watched API only
npm run api          # API without watch
npm run build        # typecheck all TS projects, then build
npm run typecheck    # TypeScript project build
npm run lint         # ESLint
npm test             # complete regression suite
npm run test:docs    # documentation integrity
npm run validate     # Python structural validator
npm run preview      # preview the static frontend
```

See [`docs/README.md`](docs/README.md) for the task-oriented documentation index,
[`CONTRIBUTING.md`](CONTRIBUTING.md) for change workflow, and [`CHANGELOG.md`](CHANGELOG.md) for
product history.
