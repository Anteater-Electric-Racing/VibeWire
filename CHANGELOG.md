# VibeWire Changelog

Changes to harness data, logged by the AI agent.

---

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
