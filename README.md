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
- *"Wire pin 3 of J5 to pin 1 of J12 with a CAN_H signal"*
- *"Add a new enclosure called Battery Box in the rear"*
- *"Remove wire_042"*

The agent will edit the JSON files and log what it changed.

### Tips

- **Be specific about connectors and pins** — use names or IDs when you can.
- **You can ask questions too** — *"What pins are on con_003?"*, *"Show me all wires on the CAN system"*.
- **If you start a new chat session**, tell the agent to read the system prompt again. It will pick up your saved identity automatically.
- **After making changes**, click **Save** in the app's top bar or commit via git (see below).

## Saving and Sharing Changes

The app has an in-browser **Save** button (top bar) that writes changes back to the JSON files on disk while the dev server is running. This also saves the layout positions and other visual state.

To share your changes with the team:

```bash
git add public/harnesses/fsae-car.json public/layouts.json connector_library/connector-library.json CHANGELOG.md
git commit -m "Update harness data"
git push
```

If you don't know git, ask the Cursor agent to do it for you.

## Project Structure

```
VibeWire/
├── public/
│   └── harnesses/
│       └── fsae-car.json            ← THE harness data file (main thing you edit)
├── connector_library/
│   ├── connector-library.json       ← connector type definitions (pin counts, specs, photos)
│   └── *.png                        ← connector photos
├── img_assets_besides_connectors/
│   └── *.png                        ← background images and other assets
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
| `public/harnesses/fsae-car.json` | **The harness data.** Enclosures, PCBs, connectors, pins, wires, signals. This is the primary file you edit. |
| `connector_library/connector-library.json` | Connector type definitions — pin counts, crimp specs, wire gauge, photos. Reference this when adding connectors. |
| `public/layouts.json` | Visual layout positions for the graph. You usually don't need to edit this directly. |
| `CHANGELOG.md` | Running log of changes. You MUST append to this after every edit. |

## Step 3: Understand the Schema

The harness JSON (`public/harnesses/fsae-car.json`) contains these entity types:

### Entities

- **Enclosure**: Physical housing (Dashboard Box, PDM Box, ECU Box, etc.).
  Fields: `id`, `name`, `parent` (null for top-level), `properties{}`

- **PCB**: Circuit board inside an enclosure.
  Fields: `id`, `name`, `parent` (enclosure id), `properties{}`

- **Connector**: Physical connector mounted on an enclosure or PCB.
  Fields: `id`, `name`, `parent` (enclosure or PCB id), `connector_type` (references connector-library.json), `pins[]`, `properties{}`
  - Connector type is DERIVED from parent: if parent is a PCB → header, if parent is an enclosure → bulkhead. Do NOT store a separate type field for this.

- **Pin**: A pin on a connector. Always nested inside a connector's `pins[]` array.
  Fields: `id`, `pin_number`, `name`, `properties{}`
  - **`pin_number: 0` is the universal placeholder pin.** Every connector has exactly one `pin_number: 0` pin named `{connector_name}-0`. Use it when you need to route a wire to a connector but the exact physical pin is not yet decided. The UI's pinout table renders `1..pinCount`, so the placeholder pin is invisible in normal views. Update the wire's `from`/`to` to the real pin once the pin assignment is confirmed.

- **Wire**: A connection between two pins.
  Fields: `id`, `from` (pin id), `to` (pin id), `properties{}`

- **Signal**: A named electrical signal.
  Fields: `id`, `name`, `properties{}`
  - **`sig_UNASSIGNED`** is the reserved placeholder signal for unassigned wires. Pins and wires with an unassigned signal are planned connections whose signal or pin assignment is still TBD.

### ID Convention

| Entity | Pattern | Example |
|--------|---------|---------|
| Enclosure | `enc_###` | `enc_001` |
| PCB | `pcb_###` | `pcb_001` |
| Connector | `con_###` | `con_001` |
| Pin | `pin_###` | `pin_001` |
| Wire | `wire_###` | `wire_001` |
| Signal | `sig_<NAME>` | `sig_CAN_H` |

When creating new entities, scan the existing file for the highest existing ID number in that category and increment from there.

### Editing Rules

1. Pins are nested inside their parent connector's `pins[]` array — never at the top level.
2. `wires[].from` and `wires[].to` reference pin `id` values.
3. `connector_type` must match an `id` in `connector_library/connector-library.json`. Check that file before assigning a type.
4. `parent` references the `id` of the containing enclosure or PCB.
5. Every entity must have a `properties{}` object (can be empty `{}`).
6. Do not reorder or reformat the JSON beyond the lines you are changing. Use the Cursor diff tools to make surgical edits.
7. If you are unsure about a connector type, ask the user rather than guessing.
8. **Placeholder routing**: When wiring a signal whose pin destination is not yet known, route the wire to the target connector's `pin_number: 0` pin (named `{connector_name}-0`). Every connector already has one. When the real pin is determined, update the wire's `from`/`to` to that pin. Do not add a second `pin_number: 0` to a connector that already has one.
9. **When adding a new connector**, immediately add a `pin_number: 0` placeholder pin as the first entry in its `pins[]` array, following the same pattern: `id` sequenced from the highest existing `pin_###`, `name` = `{connector_name}-0`, `properties: {}`.

### Harness JSON Template

Minimal example showing all entity types and how they connect:

```json
{
  "schema_version": "0.1.0",
  "enclosures": [
    {
      "id": "enc_001",
      "name": "My Box",
      "parent": null,
      "properties": {}
    }
  ],
  "pcbs": [
    {
      "id": "pcb_001",
      "name": "My PCB",
      "parent": "enc_001",
      "properties": {}
    }
  ],
  "connectors": [
    {
      "id": "con_001",
      "name": "J1",
      "parent": "enc_001",
      "connector_type": "deutsch_dt_4p_female",
      "pins": [
        {
          "id": "pin_001",
          "pin_number": 1,
          "name": "J1-1",
          "properties": {}
        },
        {
          "id": "pin_002",
          "pin_number": 2,
          "name": "J1-2",
          "properties": {}
        }
      ],
      "properties": {}
    },
    {
      "id": "con_002",
      "name": "J2",
      "parent": "pcb_001",
      "connector_type": "molex_microfit_4p_male",
      "pins": [
        {
          "id": "pin_003",
          "pin_number": 1,
          "name": "J2-1",
          "properties": {}
        },
        {
          "id": "pin_004",
          "pin_number": 2,
          "name": "J2-2",
          "properties": {}
        }
      ],
      "properties": {}
    }
  ],
  "wires": [
    {
      "id": "wire_001",
      "from": "pin_001",
      "to": "pin_003",
      "properties": { "length_mm": "300" }
    },
    {
      "id": "wire_002",
      "from": "pin_002",
      "to": "pin_004",
      "properties": {}
    }
  ],
  "signals": [
    {
      "id": "sig_12V_MAIN",
      "name": "12V_MAIN",
      "properties": { "voltage": "12V" }
    },
    {
      "id": "sig_GND",
      "name": "GND",
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
