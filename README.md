# VibeWire

VibeWire is a wiring harness design tool for FSAE race car teams. It gives you an interactive
connectivity graph, a hierarchy browser, per-subsystem canvases, a component inspector, a connector
and signal catalog, and a manufacturing workspace that derives cut lists and a BOM from the harness
itself.

Everything is edited in the app. Harness data lives as JSON files under `public/user-data/`, and the
app reads and writes them through a small local HTTP API that the dev server mounts for you.

---

## Contents

- [Requirements](#requirements)
- [Getting Started](#getting-started)
- [Signing In](#signing-in)
- [What You Can Do](#what-you-can-do)
- [Sharing Changes](#sharing-changes)
- [Project Structure](#project-structure)
- [Harness Storage Formats](#harness-storage-formats)
- [Development](#development)

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer. Check with `node --version`.
- Python 3 (only if you want to run the standalone harness validator).

## Getting Started

```bash
git clone https://github.com/Anteater-Electric-Racing/VibeWire
cd VibeWire
npm install
npm run dev
```

Open **http://localhost:5173**. If that port is taken, Vite picks the next free one and prints the
real URL.

The dev server mounts the persistence API in-process, so edits save to disk automatically about a
second after you stop interacting. There is no Save button.

## Signing In

VibeWire has named accounts so that edits can be attributed and so several people can work on the
same harness at once.

- Anyone can browse without signing in, but editing requires an **editor** account.
- There's no admin gate — anyone can create their own account from the **Log in** panel in the top
  bar. Pick a private login name, a public display name, and a role (**editor** to make changes,
  **viewer** to just look around). The activity log tracks who did what, so there's no separate
  user-management step.
- Accounts, sessions, revision history, and checkpoints live in `vibewire-state/` at the repo root.
  That directory is gitignored — it is local runtime state, not source. Deleting it resets
  collaboration state, including all accounts.

`Collaboration.md` documents the multi-user model in detail: revisions, conflict handling, presence,
checkpoints, and the activity log.

## What You Can Do

The top bar switches between five surfaces:

**Hierarchy canvas** — the main graph. Enclosures render as boxes containing their connectors;
visible path segments between the same two endpoints collapse into a single bundle edge. Double-click
a container enclosure in the tree to drill into it, and use the breadcrumbs to come back out. Wires
support bend points and shared junctions. You can drop background images and text-box annotations
onto any view.

**Subsystem canvas** — a flat projection of one electrical subsystem (cooling, wheelspeed, and so
on). Add enclosures, devices, and connectors from the hierarchy tree, arrange them freely, and drag
between two unoccupied cavity handles to create a path. Crossing a sheet boundary automatically
creates a one-cavity unresolved bulkhead placeholder that you can resolve into real hardware later.
Subsystem files hold references and geometry only; topology always comes from the harness itself.

**Connector library** — the shared catalog of connector types. Connector *families* (Deutsch DT,
Deutsch DTM, dual-row Molex Mini-Fit Jr.) keep hardware selection honest: adding capacity to a
four-cavity DT selects the six-cavity housing rather than inventing a five-cavity one. Keying only
appears for sizes that actually have keyed variants, and pin-guide images follow the selected size.

**Signal library** — the signal catalog. Signals carry design guidance such as preferred wire color,
voltage expectations, shielding, and twisting. Validation warns when a path's actual wire color
disagrees with its signal's preferred color.

**Manufacturing** — derived build output. A manufacturing harness is one run between consecutive
connectors; splices inside a run stay visible as markable work points with per-hop measurements. Cut
lengths are editable and write back to the harness. The BOM groups wire, housings, and crimps, and
the whole thing exports to CSV. Per-connector-end workflow flags (ordered, cut, crimped, populated,
QC, installed) are stored per harness.

Selecting anything opens the inspector on the right, which is where you edit display names, tags, and
properties. Connector occupancy, bundle membership, and signal context are all derived from paths at
render time rather than stored separately.

IDs are permanent; names are just labels. Renaming an enclosure, connector, path, signal, or
connector type never rewrites the references that point at it, and duplicate display names are
allowed.

## Sharing Changes

Harness data is version-controlled with the rest of the repo:

```bash
git add public/user-data/
git commit -m "Update harness data"
git push
```

Layout files (`layouts.<harness-name>.json`) live alongside the harness data and are picked up by
that same command. `vibewire-state/` is intentionally excluded.

## Project Structure

```
VibeWire/
├── public/user-data/                 ← all project data, editable in the app
│   ├── harnesses/
│   │   └── fsae-car/                 ← a harness (sheeted directory or flat <name>.json)
│   ├── connectors/
│   │   └── connector-library.json    ← shared connector type catalog
│   ├── images/                       ← connector, enclosure, and background images
│   ├── subsystems/<harness>/         ← subsystem canvases (references + geometry only)
│   ├── layouts.<harness>.json        ← graph geometry and annotations, one per harness
│   └── manufacturing.<harness>.json  ← build progress and notes
├── src/                              ← React app
├── server/                           ← file-backed persistence API
├── scripts/                          ← test suites and maintenance tooling
├── Architecture.md                   ← how the codebase is put together
└── Collaboration.md                  ← the multi-user model
```

### Multiple Harnesses

Each entry under `public/user-data/harnesses/` is a separate harness — one per car, per year, or per
variant. Switch between them with the harness selector in the top bar; each keeps its own layout,
subsystems, and manufacturing progress. Create one with the **+** button next to the selector.

## Harness Storage Formats

A harness is stored one of two ways. The app treats them identically once loaded, so you rarely need
to care which one you have.

**Flat file** (`<name>.json`) — one JSON document. This is what the **+** button creates.

**Sheeted directory** (`<name>/`) — one file per enclosure "sheet": `root.json` for car-level
devices, `sheets/<enc_id>.json` per split-out enclosure, and `signals.json` shared across all of
them. A box's external bulkhead connector does not have to be hand-authored on both sides of the
boundary; it is *derived* from whichever wires the parent sheet routes into that box. All of the
assemble/split logic lives in `server/sheets.ts`, which verifies an in-memory round trip before it
replaces any file on disk.

Do not hand-edit files inside a sheeted harness directory. Some connectors exist only as a computed
consequence of another sheet's wiring, so an edit that looks local can be inconsistent. Edit in the
app and let the splitter place things.

## Development

```bash
npm run dev         # Vite dev server with the persistence API mounted
npm run build       # typecheck (app, server, scripts) and build the frontend
npm run typecheck   # typecheck only
npm run lint        # ESLint
npm test            # full test suite
npm run api         # standalone API server, for serving a production build
npm run validate    # structural harness validation (needs Python 3)
```

`npm run build` produces a static frontend. Persistence needs the API, so outside dev you must run
`npm run api` (or an equivalent backend implementing the same endpoints) alongside it.

Individual suites are available as `npm run test:renaming`, `test:routing`, `test:connectors`,
`test:manufacturing`, `test:undo`, `test:collab-api`, `test:collab-auth`, and `test:collab-state`.
The collaboration suites build throwaway project roots in the system temp directory and never write
under `public/user-data/`.

Read `Architecture.md` before making structural changes — it is the map of how the pieces fit
together and which file owns what.

## Tech Stack

- Vite + React + TypeScript
- [React Flow / xyflow](https://reactflow.dev/) — connectivity graph
- [Zustand](https://github.com/pmndrs/zustand) — state management
- [Tailwind CSS](https://tailwindcss.com/) — styling
