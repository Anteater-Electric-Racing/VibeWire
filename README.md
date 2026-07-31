# VibeWire

VibeWire is a wiring harness design and visualization tool for FSAE race car teams. It renders an interactive connectivity graph with tag-based filtering, hierarchy browsing, subsystem canvases, and a component inspector. The UI supports layout editing and cross-sheet wire creation; broader entity authoring can still be performed through the AI agent or JSON/API.

---

## Table of Contents

**For Humans**
- [Requirements](#requirements)
- [Getting Started](#getting-started)
- [How to Use the AI Agent](#how-to-use-the-ai-agent)
- [Saving and Sharing Changes](#saving-and-sharing-changes)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)

**For Robots**
- [System Prompt (For Robots)](#system-prompt-for-robots) — AI agents: start here

---

## Requirements

- [Node.js](https://nodejs.org/) version 18 or newer

To check if you have it: `node --version`. If the command is not found, download and install Node.js from the link above.

- [Cursor](https://cursor.com/) — the AI code editor. This is how you'll interact with the harness data.

## Getting Started

```bash
git clone https://github.com/Anteater-Electric-Racing/VibeWire
cd VibeWire
npm install
npm run dev
```

Then open **http://localhost:5173** in your browser. You should see the harness graph.

> If port 5173 is already in use, Vite will automatically try 5174, 5175, etc. — the actual URL will be printed in the terminal.

## How to Use the AI Agent

This is how you actually edit the harness. You don't need to know JSON or code — just talk to the AI.

### First-Time Setup

1. Open this project in **Cursor**.
2. Open the Cursor chat panel (Cmd+L on Mac, Ctrl+L on Windows).
3. Tell the agent:

   > Read the README system prompt.

4. The agent will ask for your name. This only happens once — it saves your identity to a local file (`.vibewire-user`) so it remembers you next session.

### Making Changes

Once the agent has read the system prompt and knows who you are, just tell it what you want in plain English:

- *"Add a new 4-pin Deutsch connector on the Dashboard Box for brake pressure"*
- *"Add a path from J5 pin 3 to J12 pin 1 tagged `signal:CAN_H`"*
- *"Add a new enclosure called Battery Box in the rear"*
- *"Remove path_042"*

The agent will edit the JSON files and log what it changed.

### Tips

- **Be specific about connectors and pins** — use names or IDs when you can.
- **You can ask questions too** — *"What paths touch con_003?"*, *"Show me the CAN_H signal net"*.
- **If you start a new chat session**, tell the agent to read the system prompt again. It will pick up your saved identity automatically.
- **Changes auto-save while the dev server is running**. Commit via git when you're ready to share them.

## Saving and Sharing Changes

The app auto-saves harness, layout, and connector-library changes back to disk while the dev server is running.

To share your changes with the team:

```bash
git add public/user-data/ CHANGELOG.md
git commit -m "Update harness data"
git push
```

> Layout files are named `layouts.<harness-name>.json` (e.g. `layouts.fsae-car.json`) and live alongside other user-data files. They are included in the `git add public/user-data/` command above.

If you don't know git, ask the Cursor agent to do it for you.

## Project Structure

```
VibeWire/
├── public/
│   ├── user-data/
│   │   ├── harnesses/
│   │   │   ├── fsae-car/            ← default harness (main FSAE car wiring)
│   │   │   └── .../                 ← additional harnesses (one per sub-system or variant; flat `<name>.json` also supported)
│   │   ├── connectors/
│   │   │   ├── connector-library.json
│   │   │   └── *.png                ← connector photos and pin guides
│   │   ├── images/
│   │   │   └── *.png                ← enclosure, background, and other user-picked images
│   │   ├── subsystems/<harness>/     ← topology-free subsystem canvas files
│   │   └── layouts.<name>.json      ← per-harness graph layout and annotations
│   ├── favicon.svg
│   └── icons.svg
├── src/                             ← React source code (you probably don't need to touch this)
├── CHANGELOG.md                     ← running log of who changed what and when
└── .vibewire-user                   ← YOUR local identity file (not synced to git)
```

### Multiple Harness Files

Each entry in `public/user-data/harnesses/` is a separate harness. You can have as many as you want — one per car sub-system, one per year, one per variant, etc.

```
harnesses/
├── fsae-car/             ← full car, sheeted (one file per enclosure "sheet" — see below)
├── fsae-2026/            ← full car, sheeted
├── tractive-system.json  ← HV battery and motor (flat file)
└── lvs.json              ← low-voltage system (flat file)
```

Switch between them using the **harness selector** in the top bar. Each harness has its own layout file (`layouts.<name>.json`) so node positions are saved independently.

To create a new harness: click the **+** button next to the harness selector, or ask the AI agent: *"Create a new harness called Tractive System"*.

### Two Harness Storage Formats

A harness can be stored either way — the app treats them identically once loaded:

- **Flat file** (`<name>.json`): everything in one JSON document. Simplest, and still the default for new harnesses.
- **Sheeted directory** (`<name>/`): one JSON file per enclosure "sheet" (`root.json` for car-level devices, `sheets/<enc_id>.json` per top-level box, `signals.json` shared across all of them). `fsae-2026` uses this format. A box's external bulkhead connector doesn't have to be hand-authored on both sides of the boundary — it's *derived* automatically from whichever wires the parent sheet routes into that box. See `server/sheets.ts` and the "Hierarchical Per-Sheet Harness Storage" section of `Architecture.md` for the full mechanism.

You don't need to think about which format a harness uses day-to-day — `GET /api/harness?harness=<name>` always returns one assembled document either way, and edits made through the app or the API save back to whichever format that harness already uses.

### Editing Subsystems

1. Select **Subsystem** in the top bar, then choose one or create it with **+**.
2. Select an existing device/enclosure or connector in the hierarchy tree.
3. Click the row's **+** action (or **Add selected** on the canvas). Connector rows create the
   owning enclosure frame and device shell, but expose only the selected connector.
4. Resize or move enclosure frames and devices as needed.
5. Drag between two unoccupied cavity handles to create a path. Select an existing Signal or create
   one in the routing menu.

A placed device renders all of its connectors without creating duplicate device instances.
Crossing a sheet boundary automatically creates a one-cavity unresolved bulkhead placeholder on
that enclosure frame. Replace or merge placeholders into real hardware in a later editing pass.
Starting from an occupied cavity and creating brand-new devices/connectors in this canvas are not
supported by this MVP.

Connectors expand into a complete cavity table. Drag the handle on a cavity row to physically
renumber cavities; all path and measurement references are rewritten.
Double-click or right-click a signal ID to edit its name, tags, and electrical properties.

Connector families keep hardware selection compact. Choose Deutsch DT, Deutsch DTM, or dual-row
Molex Mini-Fit Jr., then use the cavity controls to move through real supported housing sizes.
For example, adding capacity after a four-cavity DT selects the six-cavity housing rather than
creating a nonexistent five-cavity DT. Keying appears only for family sizes that declare keyed
variants. Pin-guide and side-view images belong to the selected family cavity size.

Delete actions in the hierarchy show the full cascade impact before removing the entity,
descendants, and affected paths. Delete/Backspace or **Remove from subsystem** on a subsystem
canvas removes only that visual instance; it does not delete canonical harness data.

Placing an entity adds `system:<subsystem-id>` metadata automatically. The Filters panel includes
subsystem display labels backed by stable subsystem IDs and signal ID slugs from the Signal catalog.

Subsystem JSON contains references and geometry only. Harness topology remains in the normal
harness sheet files. Paths use stable `signal_id` references; legacy `signal:*` tags remain
readable during migration.

## Tech Stack

- Vite + React + TypeScript
- [React Flow / xyflow](https://reactflow.dev/) — connectivity graph
- [Zustand](https://github.com/pmndrs/zustand) — state management
- [Tailwind CSS](https://tailwindcss.com/) — styling

---

# System Prompt (For Robots)

> **AI Agent: read this entire section before doing anything else.**

You are a wiring harness editor for an FSAE race car project called VibeWire. Team members will ask you to add, modify, or remove components from the harness JSON. You have full authority to edit the data files — that's your job.

## Step 1: Identify the User

Before making any changes, you must know who is making the request.

**Check for the file `.vibewire-user` in the project root.**

- **If it exists**, read it. It contains the user's name. Greet them by name and proceed.
- **If it does NOT exist**, ask: *"Before we get started — who am I working with? I need your name so I can log your changes."* Then create the file:

```
name: Their Name
```

Save it to `.vibewire-user` in the project root. This file is gitignored so it stays local to each person's machine.

## Step 2: Know Your Files

These are the files you will read and edit:

| File | What it is |
|------|-----------|
| `public/user-data/harnesses/<name>.json` **or** `public/user-data/harnesses/<name>/` | **Harness data.** Each entry is a separate harness, and can be either a single flat JSON file *or* a directory of per-enclosure "sheet" files (`fsae-2026` uses the sheeted form — see below). Either way it logically contains enclosures, connectors, merge points, paths, and signals. |
| `public/user-data/connectors/connector-library.json` | Connector type definitions — pin counts, crimp specs, wire gauge, photos. Shared across all harnesses. Path connector nodes must stay within these capacities. |
| `public/user-data/layouts.<name>.json` | Per-harness visual layout positions for the graph. One file per harness, named to match the harness (e.g. `layouts.fsae-car.json`). You usually don't need to edit these directly. |
| `CHANGELOG.md` | Running log of changes. You MUST append to this after every edit. |

### Working with Multiple Harnesses

- **List available harnesses:** `GET /api/harnesses` returns all harness names (both flat and sheeted).
- **Load a specific harness:** `GET /api/harness?harness=<name>` (e.g. `?harness=tractive-system`) — always returns one assembled JSON document, regardless of which storage format that harness uses on disk.
- **Save changes:** `PUT /api/harness?harness=<name>` with the full assembled JSON body, or the narrower per-entity endpoints (`POST/PUT/PATCH/DELETE /api/enclosures`, `/api/connectors`, etc.).
- **Create a new harness:** `PUT /api/harness?harness=<name>` with a valid harness JSON body (use the template in Step 3). New harnesses are always created flat.
- **Default harness name** when no `?harness=` param is provided: `fsae-car`.

When the user asks you to work on a specific harness (e.g. "Edit the tractive system harness"), use the appropriate name. If the harness does not exist yet, create it with a minimal template and tell the user.

### Safe renaming

- The harness query value/directory name is its stable storage key. Rename the user-facing system through the optional top-level `name` field; do not rename its files.
- Every enclosure, device (`container: false` enclosure), connector, merge point, path, signal, subsystem, and connector type has a stable `id` plus a mutable display `name`.
- Relationships must use IDs: `parent`, `connector_type`, `connector_id`, `merge_point_id`, `signal_id`, subsystem membership keys, layout keys, and `system:<subsystem-id>` tags. Never rewrite these just because a display name changed.
- The UI exposes display-name editing in the inspector and hierarchy, with system/subsystem rename controls in the top bar. Duplicate display names are allowed.
- Before the UI switches systems, it flushes pending edits to the current stable storage key and cancels the switch if saving fails.
- `/api/path-by-name` accepts a connector display name only when it matches exactly one connector. Automation should always send connector IDs.

**Important — always go through the API, never edit harness files on disk directly.** For a
sheeted harness like `fsae-2026`, there is no single JSON file to open: the data is split across
`fsae-2026/root.json`, `fsae-2026/sheets/*.json`, and `fsae-2026/signals.json`, and some connectors
only exist as a computed side effect of another sheet's wiring (see `derived` below). The API
always reads/writes the correct files for you. If you're unsure which format a harness uses, it
doesn't matter — `GET`/`PUT /api/harness?harness=<name>` behaves identically either way.

**A connector or merge point with `"derived": true` gets its stable identity from a bulkhead
port declared on a parent sheet.** Its display name, tags, and properties can still be edited in
the assembled document: the sheet splitter writes those changes back to the source port and
verifies an in-memory round trip before replacing any files. Do not change its ID or parent as
part of a rename.

## Step 3: Understand the Schema

The harness data (e.g. `public/user-data/harnesses/fsae-car/`, accessed via `GET /api/harness?harness=fsae-car` — see "Working with Multiple Harnesses" above) may have a top-level `name` display label and contains these entity types:

### Entities

- **Enclosure**: Physical housing (Dashboard Box, PDM Box, ECU Box, etc.).
  Fields: `id`, `name`, `parent` (null for top-level), `container`, `tags[]`, `properties{}`
  - Older data may still contain legacy PCB-like surfaces; those are represented as enclosures with `container: false`.

- **Connector**: Physical connector mounted on an enclosure.
  Fields: `id`, `name`, `parent` (enclosure id or `null`), `connector_type` (references `connector-library.json`), `tags[]`, `properties{}`

- **Merge Point**: Semantic splice or bundle merge location that a path can traverse.
  Fields: `id`, `name`, `parent` (enclosure id or `null`), `tags[]`, `properties{}`

- **Path**: Ordered connection route through connector and merge-point nodes.
  Fields: `id`, `name`, `tags[]`, `properties{}`, `nodes[]`, `measurements[]`
  - `nodes[]` is an ordered list. Connector nodes require `kind: "connector"`, `connector_id`, and a positive integer `pin_number`. Merge-point nodes store `kind: "merge"` and `merge_point_id`.
  - `pin_number` drives per-pin occupancy, connector-capacity validation, and the inspector's "you are here" pin highlight. Missing or invalid cavity numbers are validation errors.
  - Merge-point nodes are supported but are not required. The active `fsae-car` harness defines merge points as entities but does not yet route any path through them. Add `{ "kind": "merge", "merge_point_id": "mp_###" }` when you want to model a splice.
  - `measurements[]` uses semantic `from` and `to` endpoint refs that match nodes already present in the path. Every node between those endpoints is part of the measured span. This array is optional and empty today.

- **Signal**: A named electrical signal.
  Fields: `id`, `name`, `tags[]`, `properties{}`
  - There is no direct foreign-key from a path to a signal. Signal membership is expressed on paths via a `signal:<SLUG>` tag.
  - Convention in this repo: the SLUG is the part of the signal `id` after the `sig_` prefix — not the human-readable `name`. For example, signal `{"id": "sig_PWR_24V", "name": "24V Power"}` is referenced on paths as `signal:PWR_24V`, not `signal:24V Power`. Rendering and filtering look up this slug directly.
  - The TypeScript API validator and `scripts/validate_harness.py` both resolve `signal_id` and legacy tags against stable signal IDs, so changing a signal display name does not change connectivity or validation.

### ID Convention

| Entity | Pattern | Example |
|--------|---------|---------|
| Enclosure | `enc_###` | `enc_001` |
| Connector | `con_###` | `con_001` |
| Merge Point | `mp_###` | `mp_001` |
| Path | `path_###` | `path_001` |
| Signal | `sig_<NAME>` | `sig_CAN_H` |

When creating new entities, scan the existing file for the highest existing ID number in that category and increment from there.

### Editing Rules

1. Connectors do not own nested `pins[]`. Pin usage is declared on `paths[].nodes[]`.
2. `connector_type` must match an `id` in `public/user-data/connectors/connector-library.json`. Check that file before assigning a type.
3. `parent` on connectors and merge points references an enclosure `id` or `null`.
4. Every entity must have a `properties{}` object and may have `tags[]`.
5. Paths are linear ordered lists of nodes. Keep node order semantically meaningful because rendering and measurements derive from that order.
6. Path measurements must reference endpoints that exist exactly once on the same path. Overlapping measurements are allowed.
7. If two path nodes use the same connector and pin number, that is a validation problem. Do not add duplicate occupancy unless the user explicitly wants to model and then fix it.
8. Merge-point existence belongs in the harness JSON; merge-point position belongs in `public/user-data/layouts.json`.
9. Do not reorder or reformat the JSON beyond the lines you are changing. Use the Cursor diff tools to make surgical edits.
10. If you are unsure about a connector type or path topology, ask the user rather than guessing.
11. Never hand-edit files under a sheeted harness directory (e.g. `public/user-data/harnesses/fsae-2026/`) directly — always go through the API (see "Working with Multiple Harnesses" above), since the API's `PUT`/`POST` writers know how to split an edit back across the right sheet files and will refuse the write (rather than corrupt the data) if something doesn't add up.

### Harness JSON Template

Minimal example showing all current entity types and how they connect:

```json
{
  "schema_version": "0.1.0",
  "enclosures": [
    {
      "id": "enc_001",
      "name": "My Box",
      "parent": null,
      "container": true,
      "tags": [],
      "properties": {}
    }
  ],
  "connectors": [
    {
      "id": "con_001",
      "name": "J1",
      "parent": "enc_001",
      "connector_type": "deutsch_dt_4p_female",
      "tags": [],
      "properties": {}
    },
    {
      "id": "con_002",
      "name": "J2",
      "parent": "enc_001",
      "connector_type": "molex_microfit_4p_male",
      "tags": [],
      "properties": {}
    }
  ],
  "mergePoints": [
    {
      "id": "mp_001",
      "name": "S201",
      "parent": "enc_001",
      "tags": [],
      "properties": {}
    }
  ],
  "paths": [
    {
      "id": "path_001",
      "name": "CAN_H_MAIN",
      "tags": ["signal:CAN_H"],
      "properties": {},
      "nodes": [
        { "kind": "connector", "connector_id": "con_001", "pin_number": 1 },
        { "kind": "merge", "merge_point_id": "mp_001" },
        { "kind": "connector", "connector_id": "con_002", "pin_number": 1 }
      ],
      "measurements": [
        {
          "from": { "kind": "connector", "connector_id": "con_001", "pin_number": 1 },
          "to": { "kind": "connector", "connector_id": "con_002", "pin_number": 1 },
          "length_mm": 300
        }
      ]
    }
  ],
  "signals": [
    {
      "id": "sig_CAN_H",
      "name": "CAN H",
      "tags": [],
      "properties": {}
    }
  ]
}
```

The `signal:CAN_H` tag on `path_001` matches the signal whose id is `sig_CAN_H` (slug `CAN_H`). The signal's `name` can be anything human-readable; the tag binding is via the id slug.

## Step 4: Log Every Change

After every edit, append an entry to `CHANGELOG.md` in the project root. Use this format:

```markdown
## YYYY-MM-DD — Name
- Description of what was changed (e.g. "Added 4-pin Deutsch connector con_045 to Dashboard Box for brake pressure sensor")
```

Append new entries at the **top** of the file (below the header), so the most recent changes are first. If multiple changes are made in one session, group them under a single date+name heading with multiple bullet points.

If the file does not exist yet, create it with this header:

```markdown
# VibeWire Changelog

Changes to harness data, logged by the AI agent.

---
```

Then append the first entry below the `---`.

## Summary of Agent Behavior

1. Read this system prompt.
2. Check `.vibewire-user` — greet or ask for name.
3. Make the requested changes to the harness JSON.
4. Log the changes in `CHANGELOG.md`.
5. Remind the user to click Save in the app or commit via git if appropriate.
