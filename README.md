# VibeWire

VibeWire is a wiring harness design and visualization tool built for FSAE (Formula SAE) race car teams. It renders a connectivity graph of your car's electrical harness and provides tag-based filtering, hierarchy browsing, and an inspector for every component.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+

## Setup

```bash
git clone <your-repo-url>
cd VibeWire
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Editing Harness Data

The harness definition lives in `harnesses/fsae-car.json`. Open it in Cursor and edit directly — the app loads it via `fetch()` on startup. After editing the JSON, refresh the browser.

Connector type definitions are in `connector-library.json` at the project root.

### Cursor System Prompt

Copy the block below into your Cursor system prompt so team members can ask Cursor to make schema-aware changes:

```
You are editing a wiring harness data file for an FSAE race car. The data follows this schema:

## Entities

- **Enclosure**: Physical housing (Dashboard Box, PDM Box, ECU Box). Fields: id, name, parent (null for top-level), tags[], properties{}.
- **PCB**: Circuit board inside an enclosure. Fields: id, name, parent (enclosure id), tags[], properties{}.
- **Connector**: Physical connector mounted on an enclosure or PCB. Fields: id, name, parent (enclosure or PCB id), connector_type (references connector-library.json), tags[], pins[], properties{}.
  - Connector type is DERIVED from parent: if parent is a PCB → header, if parent is an enclosure → bulkhead. Do NOT store this.
- **Pin**: A pin on a connector. Always nested inside a connector. Fields: id, pin_number, name, tags[], properties{}.
- **Wire**: A connection between two pins. Fields: id, from (pin id), to (pin id), tags[], properties{}.
- **Signal**: A named electrical signal. Fields: id, name, tags[], properties{}.

## Tag Convention

Tags use "namespace:value" format:
- signal:CAN_H, signal:CAN_L, signal:12V_MAIN, signal:GND, signal:APPS_1, signal:SDC_IN
- system:CAN, system:power, system:SDC, system:engine, system:driver
- location:front, location:center, location:rear
- status:crimped, status:verified
- bundle:main_harness, bundle:dash_internal, bundle:ecu_internal, bundle:sdc_loop
- Unnamespaced tags are freeform notes (e.g. "crimped_by_john_2024")

## ID Convention

- Enclosures: enc_001, enc_002, ...
- PCBs: pcb_001, pcb_002, ...
- Connectors: con_001, con_002, ...
- Pins: pin_001, pin_002, ...
- Wires: wire_001, wire_002, ...
- Signals: sig_<NAME>

## Rules

- Pins are nested inside their parent connector's pins[] array
- Wires reference pin IDs in from/to fields
- connector_type references an id in connector-library.json
- Parent field references the id of the containing enclosure or PCB
- Every entity has a tags[] array
```

## Saving and Sharing

1. Make changes in the app (tags, wires)
2. Click **Save** in the top bar (uses File System Access API or downloads the file)
3. Replace `harnesses/fsae-car.json` with the saved file
4. Commit and push:

```bash
git add harnesses/fsae-car.json
git commit -m "Update harness data"
git push
```

## Tech Stack

- Vite + React + TypeScript
- [React Flow](https://reactflow.dev/) (connectivity graph)
- [Zustand](https://github.com/pmndrs/zustand) (state management)
- [Tailwind CSS](https://tailwindcss.com/) (styling)
