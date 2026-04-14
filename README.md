# VibeWire

VibeWire is a wiring harness design and visualization tool for FSAE race car teams. It renders an interactive connectivity graph of your car's electrical harness with tag-based filtering, hierarchy browsing, and a component inspector.

There's no traditional UI for editing the harness — you tell an AI agent what to change and it edits the JSON for you. That's the whole workflow.

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

If you don't know git, ask the Cursor agent to do it for you.

## Project Structure

```
VibeWire/
├── public/
│   ├── user-data/
│   │   ├── harnesses/
│   │   │   └── fsae-car.json        ← THE harness data file (main thing you edit)
│   │   ├── connectors/
│   │   │   ├── connector-library.json
│   │   │   └── *.png                ← connector photos and pin guides
│   │   ├── images/
│   │   │   └── *.png                ← enclosure, background, and other user-picked images
│   │   └── layouts.json             ← graph layout and annotations
│   ├── favicon.svg
│   └── icons.svg
├── src/                             ← React source code (you probably don't need to touch this)
├── CHANGELOG.md                     ← running log of who changed what and when
└── .vibewire-user                   ← YOUR local identity file (not synced to git)
```

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
| `public/user-data/harnesses/fsae-car.json` | **The harness data.** Enclosures, connectors, merge points, paths, and signals. This is the primary file you edit. |
| `public/user-data/connectors/connector-library.json` | Connector type definitions — pin counts, crimp specs, wire gauge, photos. Path connector nodes must stay within these capacities. |
| `public/user-data/layouts.json` | Visual layout positions for the graph, including context-aware merge-point placement. You usually don't need to edit this directly. |
| `CHANGELOG.md` | Running log of changes. You MUST append to this after every edit. |

## Step 3: Understand the Schema

The harness JSON (`public/user-data/harnesses/fsae-car.json`) contains these entity types:

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
  - `nodes[]` is an ordered list. Connector nodes store `kind: "connector"`, `connector_id`, and `pin_number`. Merge-point nodes store `kind: "merge"` and `merge_point_id`.
  - `measurements[]` uses semantic `from` and `to` endpoint refs that match nodes already present in the path. Every node between those endpoints is part of the measured span.

- **Signal**: A named electrical signal.
  Fields: `id`, `name`, `tags[]`, `properties{}`
  - Signal membership is usually expressed on paths via tags like `signal:CAN_H`.

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
      "name": "CAN_H",
      "tags": [],
      "properties": {}
    }
  ]
}
```

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
