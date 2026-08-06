# VibeWire Changelog

Notable feature and harness-data changes, newest first. Maintained by hand; earlier entries were
written by the AI agent workflow that used to drive this project and are kept as-is for history.
Treat older entries as a record of what happened at the time, not as instructions — some scripts,
API endpoints, and source files they mention have since been removed.

---

## 2026-08-06 — Self-service accounts, no more admin role

- Removed the `admin` role entirely. Roles are now just `editor` and `viewer`; the activity log
  covers accountability, so there's no separate gate for managing the user roster.
- `POST /api/users` is now unauthenticated self-service signup: anyone can create their own
  account (login, display name, role) from the Log in panel, visible without signing in first, and
  it logs them straight in. Added a per-IP rate limit since the endpoint no longer requires a
  session to call.
- Removed the bootstrap-first-login-becomes-admin behavior, and the admin-only `GET /api/users`,
  `PATCH /api/users/:id`, and `DELETE /api/users/:id` endpoints along with the "Manage users" panel.

---

## 2026-08-06 — Daily checkpoints with contributor attribution

- Added an automatic "daily save" checkpoint: the first successful write to a harness on a UTC calendar day now creates a full checkpoint (`Daily save — <date>`), separate from named checkpoints and the pre-restore safety copy. Days with no edits get no checkpoint.
- The checkpoint records `contributors` — everyone who wrote to the harness since the previous daily checkpoint, sourced from the edit log — so it marks who made the edits since the last daily save, not just whoever's write happened to trigger it.
- `CheckpointPanel` shows a distinct "Daily" badge and lists the contributors instead of a single author for these checkpoints.

---

## 2026-08-05 — Crossing-free manufacturing harness diagram

- Rebuilt the manufacturing visualizer layout around the harness tree instead of per-bundle bands. Every wire gets one global lane ordered by the branch it ends in, and each node fans its wires in that same order, so wires sharing a run stay parallel and never cross.
- Branches now grow away from the side their wires arrive on, removing the hairpins where branch wires ran back along the trunk before turning off.
- Added connector shells with names, side-mounted pin labels, a dotted junction bar through each splice, and a splice marker placed above the bundle it joins. Length tags now dodge connector names, splice markers, and each other.

---

## 2026-08-04 — Subsystem devices stay in enclosure

- Constrained subsystem devices to their parent enclosure frame (`extent: 'parent'`).
- Clamp out-of-bounds device layouts into the frame on graph build and when the frame is resized.

---

## 2026-07-27 — Ring-terminal save refusal

- Fixed occupancy / type-change math so missing `pin_number` on path nodes no longer yields `NaN` `pin_count` (which made sheet round-trip checks refuse to save because `NaN !== NaN`).
- Hardened connector pin-count application and round-trip comparison against non-finite values.
- Replaced Dash 12V/GND bus and speaker ring terminals (`con_066`, `con_067`, `con_055`, `con_056`) with 1-cavity `generic_multipin` placeholders and pinned their path nodes to cavity 1.

## 2026-07-27 — Freeform subsystem layouts

- Removed subsystem parent-edge clamping for devices while keeping bulkheads projected onto their nearest enclosure boundary.
- Generated bulkheads now honor their saved drag position instead of reverting to the left wall.
- Kept child positions stable when enclosure frames or devices are resized from their top or left edges.

---

## 2026-07-27 — Connector families

- Consolidated per-size connector records into family-driven Deutsch DT, Deutsch DTM, and dual-row Molex Mini-Fit Jr. catalog entries.
- Family instances now store a real supported housing capacity and optional keying; cavity controls move directly between manufacturable sizes.
- Added per-cavity-variant pin-guide and side-view images, family-aware graph thumbnails, validation, sheet round trips, and migration tooling.
- Migrated existing DT, Mini-Fit Jr., generic fixed-count, and terminal-block references to the family/generic instance schema.

---

## 2026-07-27 — Nearest-boundary wire exits

- Bundle wires now leave connectors and merge points on the node boundary facing the next bend or peer endpoint, instead of always attaching to fixed left/right handles.
- Expanded cavity wires still use the pin-row Y while choosing the exit side from geometry.

---

## 2026-07-26 — Always-on editing

- Removed the editing-mode toggle and made structural editing controls and interactions always available.
- Preserved subsystem authoring, hierarchy rename/delete actions, canvas movement/resizing, cavity-level routing and renumbering, endpoint-aware wire bundles, and context-sensitive delete behavior.
- Kept wires visible on collapsed connectors through generic endpoints while expanded connectors use cavity-level handles.

---

## 2026-07-14 — Safe display-name editing

- Added stable-ID-preserving rename controls for systems, subsystems, enclosures/devices, connectors, merge points, paths, signals, and connector types.
- Persisted system display names separately from harness storage keys and made subsystem filters show mutable labels while retaining stable `system:<id>` references.
- Made flat harness writes atomic, surfaced autosave failures, flushed pending edits before system switches, preserved derived-entity names through sheet round trips, and rejected ambiguous connector-name routing lookups.
- Removed remaining display-name identity coupling from signal inspection, inspector React keys, and the standalone Python signal validator.
- Added rename integrity regression coverage for relationships, duplicate display names, subsystem membership, connector types, and sheeted storage.

---

## 2026-07-14 — Subsystem routing MVP

- Added topology-free, per-harness subsystem canvases with an editing-mode switch, subsystem creation/selection, reference placement, and resizable enclosure/device layouts.
- Added stable `Path.signal_id` references with legacy tag fallback, migration tooling, preferred wire-color deviation warnings, and stable signal-net API matching.
- Added cavity-level drag wiring between unoccupied pins. Cross-sheet routes now create unresolved one-cavity bulkhead placeholders at every crossed sheet boundary.
- Generalized sheet fragmentation for nested/sibling multi-boundary routes with local runs, deterministic request IDs, preflight round-trip verification, and prepared temporary-file writes.
- Connector capacity overruns are warnings; duplicate cavity claims remain validation errors.
- Added routing regression tests and the `auto_bulkhead_1p` placeholder connector type.
- Fixed root-level subsystem devices and connector-only placement from hierarchy rows.
- Editing mode now exposes complete cavity tables with drag-to-renumber behavior that rewrites path and measurement references.
- Added previewed cascade deletion for hierarchy and subsystem entities, including descendant topology and stale sheet cleanup.
- Replaced the signal-ID prompt with a select/create menu and added editable Signal inspection from signal labels.
- Filters now derive stable signal values and subsystem systems; placed entities receive automatic `system:<id>` tags.
- Corrected subsystem deletion semantics: removing a canvas instance now preserves the canonical entity and topology, while hierarchy deletion remains the explicit cascading operation.
- Connector placement now creates its owning enclosure/device context in selected-connector mode; removing a device instance removes all of its connector instances from that subsystem.

---

## 2026-07-10 — User-requested FSAE-2026 correction pass

- Reworked the footwell around one APPS and the BPS connector; removed THRS1/THRS2 and the duplicate FOC-C2 BPS self-wiring paths.
- Removed FOC-C3, the brake-light branch, wheel-speed breakout, standalone HV current sensor, CCM expansion breakouts, LV battery ring terminals, inverter PCC control, and separate inverter/motor HVIL pigtails.
- Corrected the safety chain to BOTS → inertia switch → left E-stop → right E-stop → ROC/HV master-switch path.
- Added the internal four-pin HVB current sensor, HVB inverter 8-pin placeholder, Ampseal HVIL placeholders, FOC cooling-harness placeholder, and separate ROC charging connector.
- Consolidated the cooling fan to one 3-pin connector and the pump to 24V+/PWM low-side; marked provisional pin assignments as needing correction.
- Moved the inverter and accumulator-out HV connector onto the HVB, set all motor phase wires to orange, renamed the roll-hoop lights and BPS connector, and removed accumulator splices.
- Validation: all split harness JSON parses successfully with zero missing references, unknown connector types, duplicate path IDs, or out-of-range pins.

---

## 2026-04-21 — Agent (fsae-2026 harness gap-fill)

Closed the major gaps in **`public/user-data/harnesses/fsae-2026.json`** identified during
the audit of `Harness input data/`. All edits go through
`scripts/build_fsae_2026.py`; rerun the script to regenerate the JSON.

**Totals (was → now)**
- enclosures: 76 → **85**
- connectors: 151 → **178**
- merge points: 8 → **9** (only one new splice: the shared thermistor GND ATUM)
- paths: 242 → **384**
- signals: 142 → **224**
- validator: **0 errors**, 75 warnings — all "pin occupied by N paths" on
  legitimate bulkhead mating pairs (e.g. `FOC-C1`↔`ACCU-C1`) and intentional
  PCB fan-outs. Splices are added only where source data calls for them.

**connector-library.json additions** (9 new types)
- `molex_minifit_jr_5p`, `hv_phase_3p`, `hv_interlock_2p`, `hv_bulkhead_5p_with_il`,
  `orion_bms_main_23p`, `generic_2p_thermistor`, `generic_4p_breakout`,
  `generic_6p_breakout`, `generic_8p_breakout`.

**New enclosures (enc_098 … enc_106)**
- 4× cooling thermistors (`Thermistor 1..4`).
- 5× CCM expansion-target placeholders: `I2C Expansion Breakout`,
  `GPIO Expansion Breakout`, `Linear-Pot Expansion Breakout`, `PWM Input Breakout`,
  `12V Bus Tap (CCM Vin)`.

**New connectors**
- 16× CCM mating harness-side connectors (`CCM J1..J18 Mate`) — pinout mirrors the
  CCM CSV row-for-row.
- Inverter ↔ Motor HV: `INV HV` / `MOT HV` (3p phases) + `INV HVIL` / `MOT HVIL` pigtails.
- `PCC J11` (Discharge Enable, 2p) and `Precharge/Discharge LV` (2p Mini-Fit Jr).
- `Orion BMS Main` (23p, placeholder pinout).
- 4× thermistor pigtails (`Thermistor1..4-C1`).
- Existing `HV Connector (Accu Out)` upgraded from `hv_out_connector_3p` to
  `hv_bulkhead_5p_with_il` (HV+, HV-, PE, HVIL+, HVIL-).

**New path-builder functions in `build_fsae_2026.py`**
- `add_ccm_csv_paths()` — reads `Harness input data/CCM Connectors.csv` and emits
  one path per row (CCM Jn pin → CCM Jn Mate pin), adding ~46 new signals.
- `add_safety_board_csv_paths()` — wires SB J17 (12p Shock/Wheel), SB J18 (20p
  ↔ CCM bridge) and SB J14 (14p Footwell) using the AER xlsx pinouts.
- `add_pcc_internal_paths()` — turns PCC J1 (to AIRs), J2 (HV connections 12p),
  J3 (to Bulkhead 6p) and J5 (IMD 6p) AER pinouts into real paths.
- `add_inverter_motor_paths()` — 3 phase wires (U/V/W) + 2 HVIL pigtail wires.
- `add_hv_interlock_loop()` — daisy-chains HVIL: HV Connector → Inverter HVIL →
  Motor HVIL → AIR aux contacts → PCC J2.1 (`/IL`).
- `add_discharge_enable_paths()` — PCC J11 and Charge Board 12V Out feeds into
  the Precharge/Discharge LV connector.
- `add_thermistor_paths()` — CCM J17/J18 mate signal pins → 4 thermistor
  pigtails plus a shared `mp_thermistor_GND` ATUM splice.
- `add_orion_bms_main_paths()` — Orion 23p main connector into PCC J8 (CAN),
  Charge Board (CHG_ENABLE) and PCC J11 (DISCH_ENABLE).

**Pinouts adopted from `AER_PCB_Connector_Pinouts.xlsx`**
- PCC J1 (4p, to AIRs): 1/4=Shutdown_in to AIR aux switches; 2/3=IR±_GND to AIR coils.
- PCC J2 (12p, HV connections): /IL → HVIL loop, FusedTS+/− → IMD/RTM/HV-Indicator/EM, TSMP+/−.
- PCC J3 (6p, to Bulkhead): CAN/GLV/RTM_SIG/IMD_Fault → ACCU-C1.
- PCC J5 (6p, IMD): same fan-out into IMD 8-pin.
- Safety Board J17 (12p Shock/Wheel) → wheel-sensor breakout.
- Safety Board J18 (20p, to CCM) → CCM helper bus.
- Safety Board J14 (14p, footwell) → footwell breakout.

**Open items still flagged `status:needs-verification`**
- Precharge/Discharge PCB v0.2 full pinout (still placeholder on enc_048).
- HV Fuse exact location in HV path (enc_054 — stud terminals only, not routed).
- Orion BMS Main 23p exact pinout (placeholder until OEM confirmation).
- HV bulkhead PN (`hv_bulkhead_5p_with_il` is generic).
- Charger DC-DC and Charge Board real pinouts.
- SB J18 ↔ CCM 20-pin precise per-net destination (currently routed to a CCM
  helper sink; net names are correct).

---

## 2026-04-21 — Agent (full-fidelity fsae-2026 harness)

Generated a new **`public/user-data/harnesses/fsae-2026.json`** as a brand-new, full-fidelity model of the FSAE car harness. The existing `fsae-car.json` is untouched and remains the default; the new harness is accessed via the top-bar selector.

**Summary totals**
- 76 enclosures (4 containers: FOC, ROC, HVB/Accumulator, Charging Box)
- 151 connectors (external + PCB internal)
- 8 merge points (S2–S6 ATUM splices in accumulator, plus 12V_ACCU / 12V_INV / GND_INV splice bundles)
- 242 paths
- 142 signals

**Inputs synthesized**
- `Harness input data/harness_gigadoc.txt` (19 sub-harnesses × BOM + Connection tables) — every wire becomes one path.
- `Harness input data/CCM Connectors.csv` — CCM PCB J1–J18 pinouts modeled as internal CCM connectors.
- `Harness input data/AER_PCB_Connector_Pinouts.xlsx` — Safety Board J1–J19, HI-BBC J1–J3, PCC J1–J9/J12, RTM J2/J5/J7 modeled as internal PCB connectors.
- `Harness input data/transcript.txt` — brain-dump additions: Orion BMS, charger-box AC-to-DC + DC-to-DC split, charger PCB pass-through, J1772 port, always-on vs charge-enable 12V, cooling pump/fan on AC-to-DC terminal block, Estop daisy chain, positive/negative AIR contactors, energy meter (HV + 4-pin CAN), HV battery + HV fuse + HV connector.

**connector-library.json additions** (22 new types)
- Deutsch DT: `deutsch_dt_8p_female` (DT06-08SA), `deutsch_dt_8p_male`, `deutsch_dt_12p_flanged_male` (DT04-12PA-L012), `deutsch_dt_6p_flanged_male_l012` (DT04-6P-L012).
- Molex: `molex_minifit_sigma_4p` (172708-1004), `molex_minifit_sigma_6p` (172708-1006), `molex_0625_2p` (150178-1020), `molex_minifit_vertical_4p` (39-28-1043), `molex_minifit_5566_2p`, `molex_minifit_5566_4p`.
- Other: `delphi_metripack_150_6p` (12162260), `rincon_contactor_terminal` (4-pin: 2×coil, 1×aux, 1×load stud), `battery_maintenance_plug_6p`, `tsmp_connector_5p`, `hv_out_connector_3p`, `inertia_switch_3p`, `raspi_gpio_40p`, `terminal_block_generic`, `master_switch_post`, `charger_box_face_12p`, `j1772_port`, `ac_inlet_3p`.

**Build + validation scripts**
- `scripts/build_fsae_2026.py` — deterministic generator. Defines enclosures/connectors/merges in code, parses the gigadoc TSV tables for wires, emits canonical IDs (`enc_###`, `con_###`, `mp_###`, `path_###`, `sig_<SLUG>`).
- `scripts/validate_harness.py` — standalone structural validator (mirrors `server/api.ts#validateHarnessInternal`). Current run: **0 errors**, 57 warnings (all expected multi-occupancy on bulkhead pins — a single mated-pair bulkhead pin hosts wires from both sides of the connector pair).

**Known gaps (flagged with `status:needs-verification` or `status:placeholder`)**
1. **Precharge Circuit v0.2 PCB pinout missing** from the xlsx summary tab. Modeled as a 4-pin placeholder on enc_048 (Precharge/Discharge Board); pins 1 & 3 per the gigadoc, pins 2 & 4 inferred.
2. **Inverter 4-pin control** (PCC → Inverter). Transcript said "make up your own pinout". Assigned 1=12V, 2=GND, 3=CAN_H, 4=CAN_L.
3. **HV Fuse location** (enc_054). Created with two stud terminals but not wired into the HV path pending confirmation.
4. **J1772 / Charger PCB internal wiring**. Enclosures + placeholder 4-pin connectors are in place; actual CP/CC → charge-board nets marked `status:needs-verification`.
5. **Cooling pump / fan** connections (EXT H5 and FOC H5 are empty in the gigadoc). Created as 2-pin generics on enc_090/enc_091 with `status:placeholder`.
6. **Orion BMS CAN** pin-out assumed as pins 1=CAN_H, 2=CAN_L, 3=GND on a generic 3-pin — not OEM-verified.

**Modeling decisions**
- Mated connector pairs (e.g. FOC-C1 bulkhead ↔ harness mate) are represented as a single connector entity on the bulkhead-side enclosure. The gigadoc lists both sides of the mate as wire endpoints, so a single bulkhead pin is traversed by two paths (one per side). The validator flags these as multi-occupancy warnings; this is expected given the modeling choice.
- PCB internal traces (e.g. Safety Board J18 ↔ J14 via APPS/BSPD nets) are not re-created as paths. PCB pinouts are used only to set connector types, set pin numbers on external wires, and populate `properties.notes` where relevant.
- Splices / ATUM butt-joints become `mergePoints` rather than connectors.
- Bundle membership is tagged on each path as `bundle:<HARNESS>` (e.g. `bundle:EXT_1_MZ`, `bundle:Accu_Internal`, `bundle:FOC_H9`).

**Layout**
- `public/user-data/layouts.fsae-2026.json` seeded as an empty stub so `/api/layouts?harness=fsae-2026` resolves; real canvas positions happen in the UI.

---

## 2026-04-17 — Mac (automated repair)
- Fixed path direction tech debt for junction connectors con_009 (ROC-C1) and con_092 (APPS-FEM).
- Reversed nodes arrays on 15 paths so both paths at each junction now terminate AT the junction rather than one starting from it:
  - path_013–path_021 (9 paths): now con_012 → con_009 (was con_009 → con_012)
  - path_136–path_141 (6 paths): now con_079 → con_092 (was con_092 → con_079)
- No measurements were present on any affected path; nodes-only reversal applied.

## 2026-04-14 — Gabe
- Moved enc_030 "RTD" and enc_033 "Estop Cockpit" inside FOC box (parent set to enc_001).
- Added Safety Board connector con_094 "RTD SDC" (2-pin, enc_004) for direct RTD switch connection.
- Added path_171: Safety Board E-stop header (con_015) ↔ Cockpit Estop connector (con_076) — direct internal SDC loop.
- Added path_172: Safety Board RTD SDC header (con_094) ↔ RTD-C1 connector (con_073) — direct internal SDC loop.
- Updated path_072 (external SDC chain): removed con_073 and con_076 nodes (now internal). Chain is now Safety Board SDC Out → FOC-C8 bulkhead → BOTS → Inertia Switch → Estop Left → Estop Right.

## 2026-04-13 — Gabe
- Merged THRS1-FEM (con_084, 3-pin) and THRS2-FEM (con_086, 3-pin) on FOC bulkhead (enc_001) into single 6-pin connector con_092 "APPS-FEM" (deutsch_dt_6p_female). Pins 1–3 = THRS1, pins 4–6 = THRS2.
- Merged THRS1-MALE (con_085, 3-pin) and THRS2-MALE (con_087, 3-pin) on APPS device (enc_036) into single 6-pin connector con_093 "APPS-MALE" (deutsch_dt_6p_male). Pins 1–3 = THRS1, pins 4–6 = THRS2.
- Updated all 12 affected path nodes (path_109–path_114, path_136–path_141) to reference new connector IDs and remapped pin numbers.

## 2026-04-11 — Gabe
- Added wire_103: FOC-C1 pin 1 (12V) → TSSI con_009 pin 1 (12V) — tagged "example"
- Added wire_104: FOC-C1 pin 4 (BMS LED+) → Dash LEDs con_012 pin 2 (BSPD Fault LED) — tagged "example"
- Added wire_105: FOC-C1 pin 11 (Speaker+) → CCM con_015 pin 3 (Speaker) — tagged "example"

## 2026-04-10 — Gabe
- Renamed enc_001 from "BBC (Back Black Container)" to "ROC (Rear of Car Enclosure)"
- Added FOC-C1 bulkhead connector (con_045) — 12-pin Deutsch DT female on FOC (enc_002) with pins 1–12 labeled per pinout table
- Added ROC-C1 bulkhead connector (con_046) — 12-pin Deutsch DT male on ROC (enc_001) with matching pins 1–12
- Added 12 wires (wire_091–wire_102) connecting FOC-C1 ↔ ROC-C1: 12V, GND_GLVMP, BMS Reset-, BMS LED+, BSPD Reset-, BSPD LED+, IMD Reset+, IMD Reset-, IMD LED+, LV MS-, Speaker+, Speaker- (all 18 AWG)
- Added 3 new signals: sig_GND_GLVMP, sig_LV_MS, sig_SPEAKER_NEG

## 2026-04-09 — AI Agent (Gabriel)
- Renamed con_017 (CCM) from "Axle/Brake Pedal" to "Accel/Brake Pedal" (typo fix)
- Renamed con_018 (CCM) from "Linear Pots" to "Wheel/Shock"; unified signal naming from LIN_POT_X to WHEEL_SHOCK_X across all pins (dual-purpose connector — wheel speed sensors or linear pots)
- Mapped Safety Board GPIO 1/2 connector (con_021): GPIO1 → TSSI_BYPASS, GPIO2 → TSSI_LATCH (signals arriving from Safety Board 20-pin CCM connector pins 1 & 2)
- Mapped Safety Board GPIO 3/4 connector (con_022): GPIO3 → SPEAKER (pin 3 of Safety Board 20-pin); GPIO4 marked as spare
- Added Placeholder connector (con_040) on CCM for 3V3 and 5V rails arriving via Safety Board 20-pin pins 7 & 13 — source not yet fully defined
- Added 4 Wheel Speed Sensor enclosures (enc_006–009) with placeholder connectors (con_041–044); sensor pinout TBD
- Added 19 wires completing the Safety Board 20-pin CCM connector (con_015) → CCM board mapping: TSSI_BYPASS/TSSI_LATCH/SPEAKER → GPIO1-3, BPS1/BPS2 → Accel/Brake Pedal, APPS1/APPS2 → Accel/Brake Pedal, 24V → 24V In, 12V → Power In, RTD_BTN/BRAKE_LIGHT → Brake Light/RTD, WHEEL_SHOCK_1-4 → Wheel/Shock, 3V3/5V → Placeholder, GND → Power In / 24V In (wire_060–wire_078)
- Added 12 wires connecting 4 wheel speed sensor boxes to the 12-pin Shock/Wheel Bulkhead on FOC (con_033): 5V on bulkhead pins 1,2,7,8 — GND on pins 3,4,5,6 — signals on pins 9,10,11,12 (wire_079–wire_090)

---

## [2026-04-15] - itGabe
- Split BPS1 and BPS2 connections to FOC-C2 bulkhead.
- Removed redundant BPS-FEM (con_082) and BPS-MALE (con_083).
- Removed redundant APPS-MALE (con_093).
- Connected APPS sensor (con_079) directly to footwell bulkhead (con_092).

---

## [2026-04-17] — HV System Structural Expansion

### Enclosure Corrections
- **enc_019 Inverter**: Re-parented from `enc_003` (HVB) to `null` — inverter is physically outside the accumulator
- **enc_026 TSSI**: Updated `properties.description` to "Tractive System Status Indicator — connected to Safety Board inside FOC"

### New Enclosures Added (17 total → 53 total)
| ID | Name | Parent | Type |
|----|------|--------|------|
| enc_037 | RTM | enc_003 (HVB) | device |
| enc_038 | PCC | enc_003 (HVB) | device |
| enc_039 | Charging Box | null | container |
| enc_040 | Charge Board | enc_039 | device |
| enc_041 | AC-to-DC | enc_039 | device |
| enc_042 | DC-to-DC | enc_039 | device |
| enc_043 | Orion BMS | enc_039 | device |
| enc_044 | Charger Box E-Stop | enc_039 | device |
| enc_045 | Cooling Pump | null | device |
| enc_046 | Cooling Fan | null | device |
| enc_047 | J1772 Port | null | device |
| enc_048 | HV Battery | enc_003 (HVB) | device |
| enc_049 | AIR+ | enc_003 (HVB) | device |
| enc_050 | AIR- | enc_003 (HVB) | device |
| enc_051 | HV Fuse | null | device |
| enc_052 | HV Connector | null | device |
| enc_053 | Energy Meter | enc_003 (HVB) | device |

### New Connectors Added (37 total → 124 total)
- **con_095–con_103** (9): PCC connectors — AIR ctrl, HV bus, BMS, batt bulkhead, therm exp, RTM, BMS CAN, energy meter, inverter CAN
- **con_104–con_106** (3): RTM board connectors — HV sense, J7 power, J2 power
- **con_107–con_114** (8): Charge Board connectors — face conn (DT15), E-stop, HVIL, lead acid, battery tender, J1772, car-side umbilical, 12V placeholder
- **con_115–con_117** (3): AC-to-DC connectors — AC in, chassis GND, DC out
- **con_118** (1): Orion BMS CAN connector
- **con_119–con_122** (4): Energy Meter connectors — HV inline 1/2, sense lead, CAN
- **con_123–con_126** (4): AIR+/AIR- HV terminals — B+, TS+, B-, TS-
- **con_127** (1): Safety Board AMP output (SB AMP Out)
- **con_128–con_129** (2): Cooling pump and fan 12V inputs
- **con_130–con_131** (2): HV Battery HV+/HV- terminals

### Notes
- Task spec assumed 94 base connectors; actual base was 87 (con_082–087, con_093 were absent/skipped in original data). All 37 new connectors added correctly, yielding 124 total.
- All parent references validated — no broken links.
