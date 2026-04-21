# VibeWire Changelog

Changes to harness data, logged by the AI agent.

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
