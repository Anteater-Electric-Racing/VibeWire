#!/usr/bin/env python3
"""
Deterministic builder for public/user-data/harnesses/fsae-2026.json.

Reads:
  - Harness input data/harness_gigadoc.txt
  - Harness input data/CCM Connectors.csv
  - Harness input data/AER_PCB_Connector_Pinouts.xlsx  (via openpyxl)
  - Transcript brain dump is encoded inline (only the structural decisions: Orion BMS, charger box split, contactors, energy meter, HV fuse, etc.)

Writes:
  - public/user-data/harnesses/fsae-2026/ (hierarchical per-sheet format --
    see server/sheets.ts and Architecture.md "Hierarchical Per-Sheet Harness
    Storage"). This script still builds the harness as one flat in-memory
    dict internally, then shells out to
    scripts/migrate-harness-to-sheets.ts to split it into sheets -- it does
    NOT leave a flat public/user-data/harnesses/fsae-2026.json file behind.
  - public/user-data/layouts.fsae-2026.json (empty stub, only if missing)
"""
from __future__ import annotations

import csv
import json
import os
import re
import subprocess
import sys
from pathlib import Path

try:
    import openpyxl
except ImportError:
    print("openpyxl required: pip install openpyxl", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
INPUT_DIR = ROOT / "Harness input data"
HARNESS_NAME = "fsae-2026"
# Temporary flat staging file, fed to migrate-harness-to-sheets.ts and then
# deleted -- the canonical output is the sheeted directory (see main()).
OUT_HARNESS = ROOT / "public" / "user-data" / "harnesses" / f"{HARNESS_NAME}.json"
OUT_LAYOUT = ROOT / "public" / "user-data" / f"layouts.{HARNESS_NAME}.json"
LIB_FILE = ROOT / "public" / "user-data" / "connectors" / "connector-library.json"
# Top-level containers that get their own sheet file; everything else is
# inlined into whichever of these owns it. Matches the layout chosen during
# the original migration -- see scripts/migrate-harness-to-sheets.ts.
SHEET_ENCLOSURE_IDS = ["enc_001", "enc_002", "enc_003", "enc_004"]

# ---------- 1. Enclosures ---------------------------------------------------

ENCLOSURES: list[dict] = []

def add_enclosure(eid: str, name: str, parent: str | None, container: bool,
                  tags: list[str] | None = None, notes: str = "") -> str:
    props = {"notes": notes} if notes else {}
    ENCLOSURES.append({
        "id": eid,
        "name": name,
        "parent": parent,
        "container": container,
        "tags": tags or [],
        "properties": props,
    })
    return eid

# Top-level containers
FOC = add_enclosure("enc_001", "FOC (Front of Car)", None, True,
                    ["location:front", "system:lvs"],
                    "Front-of-car control enclosure housing the Safety Board, CCM, Raspberry Pi, RTD switch, cockpit E-stop and dash LEDs.")
ROC = add_enclosure("enc_002", "ROC (Rear of Car)", None, True,
                    ["location:rear", "system:lvs"],
                    "Rear-of-car enclosure containing HI-BBC board, master switches, speaker and left/right E-stops.")
HVB = add_enclosure("enc_003", "HVB (Accumulator)", None, True,
                    ["location:accu", "system:ts"],
                    "High-voltage accumulator container: PCC, RTM, AIRs, energy meter, HV battery, IMD, DCDC-iso, BMS satellites.")
CHG = add_enclosure("enc_004", "Charging Box", None, True,
                    ["location:charging", "system:charging"],
                    "Off-car charging box: charge board, AC-to-DC, DC-to-DC, J1772 port, 12V pass-through, charger E-stop.")

# FOC children
SAFETY = add_enclosure("enc_010", "Safety Board", FOC, False, ["system:sdc", "system:lvs"],
                       "Fault-detection and SDC latching PCB. J1-J19 connectors.")
CCM = add_enclosure("enc_011", "CCM (Central Car Module)", FOC, False, ["system:lvs"],
                    "CCMv2 PCB. J1-J18 Mini-Fit Jr. connectors for pedal / sensor breakout.")
HIBOARD_FOC = add_enclosure("enc_012", "HI-BBC Board (FOC)", FOC, False, ["system:sdc"],
                            "Human Interface / Brake Bias Controller PCB, front of car. J1 sw-latch, J2 led-latch, J3 GLVMP.")
RASPI = add_enclosure("enc_013", "Raspberry Pi", FOC, False, ["system:dash"],
                     "Dashboard Raspberry Pi (compute).")
RASPI_SCREEN = add_enclosure("enc_014", "Raspberry Pi Screen", FOC, False, ["system:dash"],
                             "Dashboard display connected to the Raspberry Pi 40-pin GPIO header.")
RTD_SW = add_enclosure("enc_015", "RTD Switch (RTDB)", FOC, False, ["system:sdc"],
                       "Ready-to-drive button / BOTS feed-through.")
ES_CKP = add_enclosure("enc_016", "Cockpit E-Stop (ES-CKP)", FOC, False, ["system:sdc"],
                       "Cockpit emergency stop switch.")
DASH_LEDS = add_enclosure("enc_017", "Dash LEDs", FOC, False, ["system:dash", "system:sdc"],
                          "Dash fault LEDs (BMS, IMD, BSPD).")
FOOTWELL_BRK = add_enclosure("enc_018", "Footwell Breakout", FOC, False, ["system:sensors"],
                             "Footwell breakout board mating Safety Board J14 to the footwell harness.")
DCDC_24_12 = add_enclosure("enc_019", "24V-to-12V DC-DC Converter", FOC, False, ["system:lvs"],
                           "24V LV battery to 12V dashboard converter.")
FOC_12V_BUS = add_enclosure("enc_020", "12V Bus (Ring Terminal)", FOC, False, ["system:lvs"],
                            "12V bus ring terminal on FOC.")
FOC_GND_BUS = add_enclosure("enc_021", "GND Bus (Ring Terminal)", FOC, False, ["system:lvs"],
                            "Chassis / GLV- GND bus ring terminal on FOC.")
DASH_C1_BRK = add_enclosure("enc_022", "Dash Connector Breakout", FOC, False, ["system:dash", "system:lvs"],
                            "EXT DASH-C1 harness terminator on the dashboard side (FOC H9).")
KEY_SWITCH = add_enclosure("enc_023", "Key Switch (J25 KS)", FOC, False, ["system:lvs"],
                           "Dashboard key switch / RTMB feed-through.")
PDB = add_enclosure("enc_024", "Power Distribution Board (PDB)", FOC, False, ["system:lvs"],
                    "Dashboard power distribution board (referenced by FOC H8 as PDB-J10).")

# ROC children
HIBOARD_ROC = add_enclosure("enc_030", "HI-BBC Board (ROC)", ROC, False, ["system:sdc"],
                            "Human Interface / Brake Bias Controller PCB, rear of car. Same schematic as FOC HI-BBC.")
HVMS = add_enclosure("enc_031", "HV Master Switch", ROC, False, ["system:sdc", "system:ts"],
                    "Rear HV master-switch disconnect.")
LVMS = add_enclosure("enc_032", "LV Master Switch", ROC, False, ["system:sdc", "system:lvs"],
                    "Rear LV master-switch disconnect.")
SPEAKER = add_enclosure("enc_033", "Speaker (RTD Buzzer)", ROC, False, ["system:lvs"],
                        "Ready-to-drive buzzer / speaker.")
ES_LT = add_enclosure("enc_034", "E-Stop Left (ES-LT)", ROC, False, ["system:sdc"],
                      "Left-side emergency stop.")
ES_RT = add_enclosure("enc_035", "E-Stop Right (ES-RT)", ROC, False, ["system:sdc"],
                      "Right-side emergency stop.")

# HVB children
PCC = add_enclosure("enc_040", "PCC (Precharge Control)", HVB, False, ["system:ts"],
                    "Precharge Control PCB, J1-J9 + J12.")
RTM = add_enclosure("enc_041", "RTM (Ready Tractive Monitor)", HVB, False, ["system:ts", "system:tsal"],
                    "RTM PCB with isolated 12V light driver. J2 light out, J5 to PCC, J7 power in.")
ORION_BMS = add_enclosure("enc_042", "Orion BMS", HVB, False, ["system:bms", "system:ts"],
                         "Orion BMS — 3-pin CAN connector faces outward (transcript).")
IMD_BOARD = add_enclosure("enc_043", "IMD (Bender)", HVB, False, ["system:ts"],
                          "Insulation Monitoring Device. DT06-08SA harness port.")
ENERGY_METER = add_enclosure("enc_044", "Energy Meter", HVB, False, ["system:ts", "system:bms"],
                            "Inline HV energy/current meter. 3 HV taps + 4-pin CAN.")
AIR_PLUS = add_enclosure("enc_045", "Contactor B+ (AIR+)", HVB, False, ["system:ts"],
                         "Positive AIR/contactor (B+). Pins 1,2 = coil, Switch = aux contact, HV+ = load stud.")
AIR_MINUS = add_enclosure("enc_046", "Contactor B- (AIR-)", HVB, False, ["system:ts"],
                          "Negative AIR/contactor (B-). Pins 1,2 = coil, HV- = load stud.")
VOLT_IND = add_enclosure("enc_047", "Voltage Indicator", HVB, False, ["system:ts", "system:tsal"],
                         "HV Tractive-System voltage indicator lamp.")
PRECHARGE_DISCHARGE = add_enclosure("enc_048", "Precharge / Discharge Board", HVB, False, ["system:ts"],
                                    "Precharge / discharge circuit v0.2 (PCB pinout not in xlsx; placeholder 4-pin used).")
MAINT_PLUG_1 = add_enclosure("enc_049", "Maintenance Plug 1", HVB, False, ["system:ts"],
                             "MSD maintenance plug 1 (upper bank).")
MAINT_PLUG_5 = add_enclosure("enc_050", "Maintenance Plug 5", HVB, False, ["system:ts"],
                             "MSD maintenance plug 5 (lower bank).")
BMS_SAT_1 = add_enclosure("enc_051", "BMS Satellite 1", HVB, False, ["system:bms"],
                          "BMS cell-tap satellite board 1 (4-pin Deutsch).")
BMS_SAT_2 = add_enclosure("enc_052", "BMS Satellite 2", HVB, False, ["system:bms"],
                          "BMS cell-tap satellite board 2 (4-pin Deutsch).")
HV_BATTERY = add_enclosure("enc_053", "HV Battery (Cells)", HVB, False, ["system:ts"],
                           "Series-connected HV battery modules. HV+ and HV- stud terminals.")
HV_FUSE = add_enclosure("enc_054", "HV Fuse", HVB, False, ["system:ts", "status:needs-verification"],
                        "High-voltage fuse — location in HV path to be confirmed (transcript).")
DCDC_ISO = add_enclosure("enc_055", "DCDC-Iso (Accu internal)", HVB, False, ["system:ts", "system:lvs"],
                         "Isolated DC-DC inside accumulator providing BMS low-voltage rail. 8-pin Deutsch harness port.")

# Charging Box children
CHARGE_BOARD = add_enclosure("enc_060", "Charge Board (PCB)", CHG, False, ["system:charging"],
                             "Charge-box PCB. 12V input from AC-to-DC, outputs to car and charger handshake (J1772 CP/CC).")
ACDC = add_enclosure("enc_061", "AC-to-DC Converter", CHG, False, ["system:charging"],
                    "AC-to-DC supply. Port 1 = Live+Neutral, Port 2 = Chassis GND, Port 3 = 12V DC terminal block (transcript).")
DCDC_CHG = add_enclosure("enc_062", "DC-to-DC (Charger LV rail)", CHG, False, ["system:charging"],
                         "In-charger DC-to-DC supplying always-on 12V and charge-enable 12V (transcript).")
CHG_ESTOP = add_enclosure("enc_063", "Charger Box E-Stop", CHG, False, ["system:sdc", "system:charging"],
                          "Charger-box E-Stop — two green daisy-chain leads (transcript).")
J1772_PORT = add_enclosure("enc_064", "J1772 Port", CHG, False, ["system:charging"],
                           "SAE J1772 charging inlet on charger face.")
CHG_FACE_12P = add_enclosure("enc_065", "Charging Box Face 12-pin", CHG, False, ["system:charging"],
                             "12-pin Deutsch on the face of the Charging Box — passes through AC-to-DC 12V to the car.")
CHG_12V_BATT = add_enclosure("enc_066", "Charger Box 12V Battery", CHG, False, ["system:charging"],
                             "Internal 12V backup battery inside the Charging Box (transcript).")

# Free-standing devices
LV_BATT = add_enclosure("enc_070", "LV Battery (24V)", None, False, ["system:lvs"],
                        "24V low-voltage battery.")
WS_FL = add_enclosure("enc_071", "Wheel Speed Sensor FL", None, False, ["system:sensors", "location:front"], "Front-left wheel speed sensor.")
WS_FR = add_enclosure("enc_072", "Wheel Speed Sensor FR", None, False, ["system:sensors", "location:front"], "Front-right wheel speed sensor.")
WS_RL = add_enclosure("enc_073", "Wheel Speed Sensor RL", None, False, ["system:sensors", "location:rear"], "Rear-left wheel speed sensor.")
WS_RR = add_enclosure("enc_074", "Wheel Speed Sensor RR", None, False, ["system:sensors", "location:rear"], "Rear-right wheel speed sensor.")
WS_BRK = add_enclosure("enc_075", "Wheel Sensor Breakout", None, False, ["system:sensors"],
                       "Wheel-sensor bulkhead breakout (EXT H6: Molex 12p on sensor side, DT06-12SA on CCM side).")
MOTOR = add_enclosure("enc_076", "Motor", None, False, ["system:ts"], "Traction motor.")
RLS_ENC = add_enclosure("enc_077", "RLS Encoder (RM44SI)", None, False, ["system:sensors"], "RLS RM44SI magnetic encoder on motor shaft.")
MOT_SENS_BRK = add_enclosure("enc_078", "Motor Sensor Breakout", None, False, ["system:sensors"],
                             "Souriau UTS breakout between RLS encoder and INV LV (EXT 1-MZ).")
TSSI = add_enclosure("enc_079", "TSSI (Tractive System Status Indicator)", None, False, ["system:tsal"], "TSSI light assembly.")
BRAKE_LIGHT = add_enclosure("enc_080", "Brake Light", None, False, ["system:sensors"], "Rear brake light lamp.")
TSL = add_enclosure("enc_081", "Tractive System Lights (TSL)", None, False, ["system:tsal"],
                    "Tractive-system light tree (red/green).")
BOTS = add_enclosure("enc_082", "BOTS (Brake-Over-Travel Switch)", None, False, ["system:sdc"], "Brake over-travel switch.")
INERTIA = add_enclosure("enc_083", "Inertia Switch", None, False, ["system:sdc"], "Inertia-triggered SDC switch.")
APPS = add_enclosure("enc_084", "APPS (Accelerator Pedal Position Sensor)", None, False, ["system:sensors"],
                     "Dual-redundant accelerator pedal sensor (Metri-Pack 150.2 6p).")
THRS1 = add_enclosure("enc_085", "THRS1 (Throttle Sensor 1)", None, False, ["system:sensors"], "Linear potentiometer throttle sensor 1.")
THRS2 = add_enclosure("enc_086", "THRS2 (Throttle Sensor 2)", None, False, ["system:sensors"], "Linear potentiometer throttle sensor 2.")
BPS1 = add_enclosure("enc_087", "BPS1 (P51 Brake Pressure Sensor 1)", None, False, ["system:sensors"], "P51 front brake pressure sensor.")
BPS2 = add_enclosure("enc_088", "BPS2 (P51 Brake Pressure Sensor 2)", None, False, ["system:sensors"], "P51 rear brake pressure sensor.")
BPS_BRK = add_enclosure("enc_089", "BPS Breakout", None, False, ["system:sensors"],
                        "Brake-pressure harness breakout mating Footwell harness DT06-6S to two P51 sensors.")
COOL_PUMP = add_enclosure("enc_090", "Cooling Pump", None, False, ["system:cooling", "status:placeholder"],
                          "Coolant pump (EXT H5 / FOC H5 are empty in gigadoc; placeholder pin-out).")
COOL_FAN = add_enclosure("enc_091", "Cooling Fan", None, False, ["system:cooling", "status:placeholder"],
                         "Radiator fan (placeholder pin-out).")
CURR_SENS = add_enclosure("enc_092", "HV Current Sensor", None, False, ["system:ts", "system:sensors"],
                          "HV current sensor feeding the Safety Board (EXT H7 / FOC H7).")
INVERTER = add_enclosure("enc_093", "Inverter", None, False, ["system:ts"],
                         "Motor inverter. LV connector is TE AMP Seal 23-pin.")
HV_CONN = add_enclosure("enc_094", "HV Connector (Accumulator Out)", None, False, ["system:ts"],
                        "Bulkhead high-voltage output connector with interlock (transcript).")
TSMP = add_enclosure("enc_095", "TSMP Connector", HVB, False, ["system:ts"],
                     "Tractive-System Measurement Point connector (inside accumulator).")
HV_OUT = add_enclosure("enc_096", "HV Out Connector", HVB, False, ["system:ts"],
                       "Accumulator HV-output internal connector (3 contacts).")
CAN_TXR = add_enclosure("enc_097", "CAN Transceiver (Dash)", FOC, False, ["system:dash", "system:lvs"],
                        "Dash-side CAN transceiver used by the Pi (notional).")

# Cooling thermistors (4x) — referenced by CCM J17/J18 thermistor1+..thermistor4+
THERM_1 = add_enclosure("enc_098", "Thermistor 1 (Cooling)", None, False,
                         ["system:cooling", "system:sensors"],
                         "Cooling thermistor #1. Wired to CCM J17.2 (thermistor1+) and shared GLV-.")
THERM_2 = add_enclosure("enc_099", "Thermistor 2 (Cooling)", None, False,
                         ["system:cooling", "system:sensors"],
                         "Cooling thermistor #2. Wired to CCM J17.1 (thermistor2+) and shared GLV-.")
THERM_3 = add_enclosure("enc_100", "Thermistor 3 (Cooling)", None, False,
                         ["system:cooling", "system:sensors"],
                         "Cooling thermistor #3. Wired to CCM J18.2 (thermistor3+) and shared GLV-.")
THERM_4 = add_enclosure("enc_101", "Thermistor 4 (Cooling)", None, False,
                         ["system:cooling", "system:sensors"],
                         "Cooling thermistor #4. Wired to CCM J18.1 (thermistor4+) and shared GLV-.")

# CCM expansion targets (placeholder destinations for CCM signals with no other home)
I2C_EXP = add_enclosure("enc_102", "I2C Expansion Breakout", None, False,
                        ["status:placeholder", "system:sensors"],
                        "Placeholder I2C expansion breakout — destination for CCM J2 (i2c_SCL/SDA).")
GPIO_EXP = add_enclosure("enc_103", "GPIO Expansion Breakout", None, False,
                         ["status:placeholder", "system:sensors"],
                         "Placeholder GPIO breakout — destination for CCM J5 (gpio1/2) and J14 (gpio3/4).")
LINPOT_EXP = add_enclosure("enc_104", "Linear-Pot Expansion Breakout", None, False,
                           ["status:placeholder", "system:sensors"],
                           "Placeholder linear-potentiometer breakout — destination for CCM J4 (lin_pot_1..4).")
PWM_IN_EXP = add_enclosure("enc_105", "PWM Input Breakout", None, False,
                           ["status:placeholder", "system:sensors"],
                           "Placeholder PWM-in breakout — destination for CCM J7 (PWM_in_1/2).")
CCM_VIN_TAP = add_enclosure("enc_106", "12V Bus Tap (CCM Vin)", FOC, False,
                            ["status:placeholder", "system:lvs"],
                            "Placeholder 12V bus tap that feeds CCM J6 (Vin / GLV-).")

# ---------- 2. Connectors ---------------------------------------------------

CONNECTORS: list[dict] = []
CONNECTOR_BY_KEY: dict[str, str] = {}

def _next_con_id() -> str:
    return f"con_{len(CONNECTORS)+1:03d}"

def _family_connector_type(ctype: str) -> tuple[str, int | None, str | None]:
    """Resolve legacy build-script ids to the family instance schema."""
    deutsch = re.match(r"^deutsch_dt_(\d+)p(?:_|$)", ctype)
    if deutsch:
        keying = "A" if ctype in {
            "deutsch_dt_8p_female",
            "deutsch_dt_12p_flanged_male",
        } else None
        return "deutsch_dt", int(deutsch.group(1)), keying

    generic = re.match(r"^generic_(\d+)p$", ctype)
    if generic:
        return "generic_multipin", int(generic.group(1)), None

    terminal_block = re.match(r"^terminal_block_(\d+)p$", ctype)
    if terminal_block:
        return "terminal_block_generic", int(terminal_block.group(1)), None

    if not ctype.startswith("molex_minifit_sigma_"):
        mini_fit = (
            re.match(r"^molex_minifit(?:_jr)?_(\d+)p$", ctype)
            or re.match(r"^molex_minifit_(?:5566|vertical)_(\d+)p$", ctype)
        )
        if mini_fit and int(mini_fit.group(1)) % 2 == 0:
            return "molex_minifit_jr", int(mini_fit.group(1)), None

    return ctype, None, None

def add_connector(keys, name: str, parent: str | None, ctype: str,
                  tags: list[str] | None = None, notes: str = "") -> str:
    """keys: either a single designator string or list of aliases; all map to this one id."""
    if isinstance(keys, str):
        keys = [keys]
    cid = _next_con_id()
    props = {"notes": notes} if notes else {}
    resolved_type, pin_count, keying = _family_connector_type(ctype)
    connector = {
        "id": cid,
        "name": name,
        "parent": parent,
        "connector_type": resolved_type,
        "tags": tags or [],
        "properties": props,
    }
    if pin_count is not None:
        connector["pin_count"] = pin_count
    if keying is not None:
        connector["keying"] = keying
    CONNECTORS.append(connector)
    for k in keys:
        CONNECTOR_BY_KEY[k] = cid
    return cid

# ---- 2a. FOC external bulkhead connectors (mate points) -------------------

add_connector(["FOC-C1", "FOC C1"], "FOC-C1 (to ACCU/INV/MOT)", FOC, "deutsch_dt_12p_female",
              ["bundle:EXT_1_MZ"], "Front-of-car bulkhead C1. Mates EXT 1-MZ harness to the FOC.")
add_connector("FOC-C2", "FOC-C2 (Footwell)", FOC, "deutsch_dt_12p_flanged_male",
              ["bundle:EXT_H2"], "Front-of-car bulkhead C2. DT04-12PA-L012 flanged.")
add_connector("FOC-C3", "FOC-C3 (TSSI/BRK-LT internal)", FOC, "deutsch_dt_6p_flanged_male_l012",
              ["bundle:FOC_H3"], "Front-of-car C3 flanged male; mates TSSI/brake-light sub-harness.")
add_connector("FOC-H03-A", "FOC-H03-A (to TS Lights)", FOC, "deutsch_dt_6p_female",
              ["bundle:EXT_H3"], "Front-of-car external connector for TS-Light / Brake-Light harness (EXT H3).")
add_connector("FOC-C8", "FOC-C8 (SDC BOTS)", FOC, "deutsch_dt_2p_female",
              ["bundle:EXT_H4"], "Front-of-car C8 — SDC input from BOTS.")
add_connector("FOC-C9", "FOC-C9 (spare)", FOC, "deutsch_dt_2p_female",
              ["status:placeholder"], "Spare — referenced in EXT H3 description but no wires.")
add_connector(["FOC H7", "FOC-H7"], "FOC-H7 (to Current Sensor)", FOC, "deutsch_dt_3p_male",
              ["bundle:FOC_H7"], "Front-of-car H7 — 3-pin male to the HV current sensor.")
add_connector("FOC-ROC1", "FOC-ROC1 (to ROC)", FOC, "deutsch_dt_12p_flanged_male",
              ["bundle:FOC_H8"], "Front-of-car ROC bulkhead: DT04-12PA-L012 flanged.")

# ---- 2b. FOC PCB connectors (Safety Board) --------------------------------

SB_KEYS = {
    "J1":  ("SB J1 (E-Stop IN)",     "molex_minifit_5566_2p"),
    "J2":  ("SB J2 (TS-ON SW)",      "molex_minifit_5566_2p"),
    "J3":  ("SB J3 (SDC OUT)",       "molex_minifit_5566_2p"),
    "J4":  ("SB J4 (ACCU/HVB LV)",   "molex_minifit_5566_4p"),
    "J5":  ("SB J5 (12V EXP)",       "molex_minifit_5566_2p"),
    "J6":  ("SB J6 (PWR IN)",        "molex_minifit_5566_2p"),
    "J7":  ("SB J7 (24V EXP)",       "molex_minifit_5566_2p"),
    "J8":  ("SB J8 (5V EXP)",        "molex_minifit_5566_2p"),
    "J9":  ("SB J9 (Current Sensor)","molex_minifit_sigma_4p"),
    "J10": ("SB J10 (TSSI)",         "molex_minifit_sigma_4p"),
    "J11": ("SB J11 (ACCU LED fan-out)", "molex_minifit_sigma_4p"),
    "J12": ("SB J12 (BBC)",          "molex_minifit_jr_12p"),
    "J13": ("SB J13 (USB to Pi)",    "usb_a"),
    "J14": ("SB J14 (Footwell)",     "molex_14p"),
    "J15": ("SB J15 (RTD B)",        "molex_minifit_5566_2p"),
    "J16": ("SB J16 (Brakelight)",   "molex_0625_2p"),
    "J17": ("SB J17 (Shock/Wheel Sensor)", "molex_minifit_jr_12p"),
    "J18": ("SB J18 (to CCM)",       "molex_minifit_jr_20p"),
    "J19": ("SB J19 (AMP / Speaker)","molex_minifit_sigma_4p"),
}
# Gigadoc labels referencing Safety Board connectors:
SB_ALIASES = {
    "J1":  ["Safety Board J1"],
    "J3":  ["Safety Board J3", "SDC OUT"],
    "J4":  ["J4 HVB [SB]", "Safety Board J4"],
    "J5":  ["Safety Board J5"],
    "J7":  ["J35 EXP_24V"],
    "J8":  ["F10 EXP_5V"],
    "J9":  ["J9", "Safety Board J9"],
    "J10": ["J19 TSSI [SB]", "Safety Board J10", "Safety Board TSSI"],
    "J11": ["Safety Board J11"],
    "J14": ["J14 Footwell", "Footwell [SB]"],
    "J15": ["J15 RTD B", "RTD B"],
    "J16": ["J16 BRK-LT [SB]", "Safety Board J16"],
    "J19": ["Safety Board J19", "SB AMP"],
}
for jk, (name, ctype) in SB_KEYS.items():
    keys = [f"SB {jk}"] + SB_ALIASES.get(jk, [])
    add_connector(keys, f"Safety Board {jk} — {name.split('(',1)[1].rstrip(')')}",
                  SAFETY, ctype, ["bundle:internal"],
                  f"Safety Board PCB connector {jk} ({name}).")

# Extra 3V3 EXP on Safety Board (gigadoc FOC H9 references "3_3V Safety Board")
add_connector(["3_3V Safety Board"], "Safety Board 3V3 EXP", SAFETY, "molex_0625_2p",
              ["bundle:FOC_H9"], "3.3V rail breakout on the Safety Board.")

# ---- 2c. FOC PCB connectors (CCM) -----------------------------------------

# CCM connector types come from the CSV — all are Molex Mini-Fit Jr 5566
CCM_CSV_TYPES = {
    "J1":  ("CCM J1 (RTD/Brake Light)", "molex_minifit_5566_2p"),
    "J2":  ("CCM J2 (I2C)",             "molex_minifit_5566_2p"),
    "J3":  ("CCM J3 (CAN2)",            "molex_minifit_5566_2p"),
    "J4":  ("CCM J4 (Lin Pots)",        "molex_minifit_5566_4p"),
    "J5":  ("CCM J5 (GPIO)",            "molex_minifit_5566_4p"),
    "J6":  ("CCM J6 (Vin)",             "molex_minifit_5566_2p"),
    "J7":  ("CCM J7 (PWM in)",          "molex_minifit_5566_2p"),
    "J8":  ("CCM J8 (Brake/APPS)",      "molex_minifit_5566_4p"),
    "J9":  ("CCM J9 (CAN1)",            "molex_minifit_5566_2p"),
    "J10": ("CCM J10 (Speaker)",        "molex_minifit_5566_2p"),
    "J11": ("CCM J11 (Fan+/Pump1-)",    "molex_minifit_5566_2p"),
    "J12": ("CCM J12 (Fan+/Pump2-)",    "molex_minifit_5566_2p"),
    "J13": ("CCM J13 (Fan+/GLV-)",      "molex_minifit_5566_2p"),
    "J14": ("CCM J14 (GPIO 3/4)",       "molex_minifit_5566_4p"),
    "J16": ("CCM J16 (Fan PWM)",        "molex_minifit_5566_4p"),
    "J17": ("CCM J17 (Thermistor 1/2)", "molex_minifit_5566_4p"),
    "J18": ("CCM J18 (Thermistor 3/4)", "molex_minifit_5566_4p"),
}
CCM_ALIASES = {
    "J10": ["CCM-J10"],
}
for jk, (name, ctype) in CCM_CSV_TYPES.items():
    keys = [f"CCM {jk}"] + CCM_ALIASES.get(jk, [])
    add_connector(keys, name, CCM, ctype, ["bundle:internal"],
                  f"CCM PCB connector {jk}.")

# ---- 2d. FOC PCB connectors (HI-BBC FOC) ----------------------------------

add_connector(["HI-BBC J1 FOC", "HI-BBC FOC J1", "BBC-C1-latch"],
              "HI-BBC J1 sw-latch (FOC)", HIBOARD_FOC, "molex_minifit_5566_4p",
              ["bundle:internal"], "HI-BBC board J1 sw-latch (BSPD/IMD/BMS resets).")
add_connector(["HI-BBC J2 FOC"], "HI-BBC J2 led-latch (FOC)", HIBOARD_FOC, "molex_minifit_jr_6p",
              ["bundle:internal"], "HI-BBC board J2 led-latch (fault LEDs + 12V/GND).")
add_connector(["HI-BBC J3 FOC"], "HI-BBC J3 GLVMP (FOC)", HIBOARD_FOC, "ring_terminal",
              ["bundle:internal"], "HI-BBC GLVMP banana jack test point.")

# ---- 2e. ROC PCB connectors (HI-BBC ROC mirror) ---------------------------

add_connector(["HI-J1"], "HI-J1 (ROC sw-latch)", HIBOARD_ROC, "molex_minifit_sigma_4p",
              ["bundle:Inside_ROC"], "HI-BBC ROC side J1: sw-latch (BSPD/IMD/BMS reset fan-out).")
add_connector(["HI-J2"], "HI-J2 (ROC led-latch)", HIBOARD_ROC, "molex_minifit_sigma_6p",
              ["bundle:Inside_ROC"], "HI-BBC ROC side J2: 12V/GND + fault LEDs.")
add_connector(["ROC-C1"], "ROC-C1 (to FOC)", ROC, "deutsch_dt_12p_female",
              ["bundle:EXT_ROC_H1"], "Rear-of-car C1 — 12-pin Deutsch bulkhead mating FOC-ROC1.")
add_connector(["ROC-C2"], "ROC-C2 (to Charging/ES/LV)", ROC, "deutsch_dt_6p_female",
              ["bundle:EXT_ROC_H2"], "Rear-of-car C2 — 6-pin Deutsch bulkhead for charging / E-stop / LV battery.")
add_connector(["HV MS"], "HV MS (Master Switch posts)", HVMS, "master_switch_post",
              [], "High-voltage master switch bolted posts.")
add_connector(["LV MS"], "LV MS (Master Switch posts)", LVMS, "master_switch_post",
              [], "Low-voltage master switch bolted posts.")
add_connector(["Speaker+"], "Speaker + Ring", SPEAKER, "ring_terminal", [], "Speaker + ring terminal.")
add_connector(["Speaker-"], "Speaker - Ring", SPEAKER, "ring_terminal", [], "Speaker - ring terminal.")
add_connector(["ES-RT"], "ES-RT Connector", ES_RT, "deutsch_dt_2p_female",
              ["bundle:EXT_H4"], "Right E-stop 2-pin DT connector.")
add_connector(["ES-LT"], "ES-LT Connector", ES_LT, "deutsch_dt_2p_female",
              ["bundle:EXT_H4"], "Left E-stop 2-pin DT connector.")
add_connector(["ES-CKP"], "ES-CKP Connector", ES_CKP, "deutsch_dt_2p_female",
              ["bundle:EXT_H4"], "Cockpit E-stop 2-pin DT connector.")
add_connector(["RTD-C1"], "RTD-C1 Connector", RTD_SW, "deutsch_dt_2p_female",
              ["bundle:EXT_H4"], "RTD switch 2-pin DT connector.")
add_connector(["INTS-C1"], "Inertia Switch Connector", INERTIA, "inertia_switch_3p",
              ["bundle:EXT_H4"], "Inertia switch 3-pin OEM connector.")
add_connector(["BOTS-C1"], "BOTS Connector", BOTS, "deutsch_dt_2p_male",
              ["bundle:EXT_H4"], "BOTS 2-pin DT connector.")
add_connector(["BBC-C1"], "BBC-C1 (mates EXT 1-MZ/H4 HV MS+)", HIBOARD_ROC, "deutsch_dt_6p_male",
              ["bundle:EXT_1_MZ", "bundle:EXT_H4"],
              "HI-BBC board BBC-C1 6-pin Deutsch — mixes MS HV- and HV MS+ rails. Gigadoc lists as DT04-6P and mating DT06-6S; modeled as one mated pair on BBC.")

# Latch-J1 (12-pin Molex on dashboard side, mates with FOC-ROC1 subset)
add_connector(["Latch-J1"], "Latch-J1 (Dash Latch Breakout 12p)", DASH_LEDS, "molex_minifit_jr_12p",
              ["bundle:FOC_H8"], "Dash-side 12-pin Molex for SDC/LED latch (FOC H8).")

# ROC PCB J1 / Safety Board J11 aliases are tricky; handle in FOC H9:
add_connector(["ROC PCB J1"], "ROC PCB J1 (Dash-side 4p header)", DASH_LEDS, "molex_minifit_vertical_4p",
              ["bundle:FOC_H9"], "Dash-side 4-pin vertical Molex header feeding fault-LED fan-out.")

# ---- 2f. Dashboard ring terminals / converters ----------------------------

add_connector(["12V"], "Dash 12V Bus (Ring)", FOC_12V_BUS, "ring_terminal",
              ["bundle:FOC_H9"], "Dashboard 12V bus ring terminal.")
add_connector(["GND"], "Dash GND Bus (Ring)", FOC_GND_BUS, "ring_terminal",
              ["bundle:FOC_H9"], "Dashboard GND bus ring terminal.")
add_connector(["24V to 12V Converter"], "24V→12V DC-DC (Dash)", DCDC_24_12, "molex_minifit_5566_4p",
              ["bundle:FOC_H9"], "24V to 12V converter (4-pin on dash). Pins 1=12V, 2=GND, 3=24V-, 4=24V+.")
add_connector(["J35 EXP_24V"], "Dash 24V EXP (150178-1020)", DCDC_24_12, "molex_0625_2p",
              ["bundle:FOC_H9"], "Dash 24V EXP feed 2-pin Molex .062.")
add_connector(["F10 EXP_5V"], "Dash 5V EXP (150178-1020)", DASH_C1_BRK, "molex_0625_2p",
              ["bundle:FOC_H9"], "Dash 5V EXP feed to Raspberry Pi 5V rail.")
add_connector(["J25 KS"], "Key Switch (2p Molex .062)", KEY_SWITCH, "molex_0625_2p",
              ["bundle:FOC_H9"], "Dash key-switch 2-pin Molex .062.")
add_connector(["EXT DASH-C1"], "EXT DASH-C1 (harness terminator)", DASH_C1_BRK, "deutsch_dt_8p_female",
              ["bundle:FOC_H9"], "Dash harness terminator (EXT DASH-C1). Pin count not documented; modelled as 8-pin DT.")
add_connector(["RASPi"], "Raspberry Pi GPIO Header", RASPI, "raspi_gpio_40p",
              ["bundle:FOC_H9"], "Raspberry Pi 40-pin GPIO header.")
add_connector(["Raspi Screen"], "Raspi Screen GPIO Header", RASPI_SCREEN, "raspi_gpio_40p",
              ["bundle:FOC_H9"], "Raspberry Pi screen 40-pin GPIO ribbon header.")
add_connector(["Safety Board J11"], "Safety Board J11 (Dash fan-out)", SAFETY, "molex_minifit_vertical_4p",
              ["bundle:FOC_H9"], "Safety Board dash-side fault-LED fan-out header.")
add_connector(["PDB-J10"], "PDB J10 (150178-1020)", PDB, "molex_0625_2p",
              ["bundle:FOC_H8"], "Power Distribution Board J10 — 2-pin Molex .062.")

# ---- 2g. HVB / Accumulator connectors -------------------------------------

add_connector(["ACCU-C1"], "ACCU-C1 (to FOC)", HVB, "deutsch_dt_12p_female",
              ["bundle:EXT_1_MZ", "bundle:EXT_ROC_H2"],
              "Accumulator bulkhead C1 — 12-pin Deutsch (EXT 1-MZ / ROC H2).")
add_connector(["C11"], "C11 (Accu Internal 12p)", HVB, "deutsch_dt_12p_male",
              ["bundle:Accu_Internal"],
              "Internal 12-pin mating half of ACCU-C1 inside the accumulator (used as Accu Internal designator C11).")
add_connector(["HVB C2", "HVB-C2"], "HVB-C2 (Current Sensor)", HVB, "deutsch_dt_3p_female",
              ["bundle:EXT_H7"], "Accumulator C2 — 3-pin Deutsch to Safety Board current sense.")
add_connector(["HV-BATT"], "HV-BATT (12p to TS-Light RTM)", HVB, "deutsch_dt_12p_female",
              ["bundle:EXT_H3"], "Accumulator external connector to TS-Light harness (pin 4 = RTM-LT).")

# Maintenance plugs
add_connector(["Maintance Plug_1", "Maintenance Plug_1"], "Maintenance Plug 1",
              MAINT_PLUG_1, "battery_maintenance_plug_6p",
              ["bundle:Accu_Internal"], "MSD maintenance plug upper bank.")
add_connector(["Maintenance Plug_5", "Maintance Plug_5"], "Maintenance Plug 5",
              MAINT_PLUG_5, "battery_maintenance_plug_6p",
              ["bundle:Accu_Internal"], "MSD maintenance plug lower bank.")

# BMS satellites
add_connector(["BMS Satellite_1"], "BMS Satellite 1 (DT04-4P)", BMS_SAT_1, "deutsch_dt_4p_male",
              ["bundle:Accu_Internal", "system:bms"], "BMS Satellite 1 cell-tap connector.")
add_connector(["BMS Satellite_2"], "BMS Satellite 2 (DT04-4P)", BMS_SAT_2, "deutsch_dt_4p_male",
              ["bundle:Accu_Internal", "system:bms"], "BMS Satellite 2 cell-tap connector.")

# Energy Meter (HV side = DT04-3P, plus CAN 4-pin per transcript)
add_connector(["Energy Meter"], "Energy Meter (HV + 3-pin)", ENERGY_METER, "deutsch_dt_3p_male",
              ["bundle:Accu_Internal", "system:ts"],
              "Energy-meter 3-pin Deutsch (HV+, HV-, inline). Pin 1=HV-, pin 2=HV+ (sense lead not wired yet per transcript).")
add_connector(["Energy Meter CAN"], "Energy Meter CAN (4-pin Mini-Fit)", ENERGY_METER, "molex_minifit_jr_4p",
              ["bundle:Accu_Internal", "system:bms"], "Energy-meter CAN: CAN_H, GLV+, CAN_L, GLV- (per transcript).")

# DCDC iso / IMD / RTM each have an 8-pin Deutsch (DT06-08SA)
add_connector(["DCDC"], "DCDC-Iso 8-pin (Accu)", DCDC_ISO, "deutsch_dt_8p_female",
              ["bundle:Accu_Internal"], "Isolated DC-DC 8-pin connector inside accumulator.")
add_connector(["IMD"], "IMD 8-pin (Bender)", IMD_BOARD, "deutsch_dt_8p_female",
              ["bundle:Accu_Internal"], "IMD / Bender 8-pin connector.")
add_connector(["RTM"], "RTM 8-pin (Accu harness)", RTM, "deutsch_dt_8p_female",
              ["bundle:Accu_Internal"], "RTM 8-pin accumulator-side connector.")
# RTM PCB connectors (from xlsx)
add_connector(["RTM J2"], "RTM J2 (Light out)", RTM, "molex_minifit_5566_2p",
              ["bundle:internal"], "RTM isolated light-driver output.")
add_connector(["RTM J5"], "RTM J5 (to PCC)", RTM, "molex_minifit_5566_2p",
              ["bundle:internal"], "RTM HV sense connection to PCC.")
add_connector(["RTM J7"], "RTM J7 (Power in)", RTM, "molex_minifit_5566_2p",
              ["bundle:internal"], "RTM isolated 12V power input.")

# PCC PCB connectors (from xlsx)
PCC_CONS = [
    ("J1", "PCC J1 (to AIRs)",           "molex_minifit_5566_4p"),
    ("J2", "PCC J2 (HV connections)",    "molex_minifit_jr_12p"),
    ("J3", "PCC J3 (to Bulkhead)",       "molex_minifit_jr_6p"),
    ("J5", "PCC J5 (IMD)",               "molex_minifit_jr_6p"),
    ("J6", "PCC J6 (Thermistor Exp.)",   "molex_minifit_5566_4p"),
    ("J7", "PCC J7 (RTM)",               "molex_minifit_5566_4p"),
    ("J8", "PCC J8 (BMS)",               "molex_minifit_5566_4p"),
    ("J9", "PCC J9 (Energy Meter CAN)",  "molex_minifit_5566_4p"),
    ("J12","PCC J12 (Inverter CAN)",     "molex_minifit_5566_4p"),
]
for jk, name, ctype in PCC_CONS:
    add_connector([f"PCC {jk}"], name, PCC, ctype, ["bundle:internal"],
                  f"PCC PCB connector {jk}.")

# Contactors
add_connector(["Contactor_B+"], "Contactor B+ (AIR+)", AIR_PLUS, "rincon_contactor_terminal",
              ["bundle:Accu_Internal", "system:ts"],
              "Positive AIR. Pins: 1=coil+, 2=coil-, Switch→3 aux, HV+→4 stud.")
add_connector(["Contactor_B-"], "Contactor B- (AIR-)", AIR_MINUS, "rincon_contactor_terminal",
              ["bundle:Accu_Internal", "system:ts"],
              "Negative AIR. Pins: 1=coil+, 2=coil-, HV-→4 stud.")

# Voltage Indicator (3p)
add_connector(["Voltage Indicator"], "Voltage Indicator (3p)", VOLT_IND, "generic_3p",
              ["bundle:Accu_Internal", "system:tsal"], "HV voltage indicator lamp driver (3-pin).")

# Precharge/Discharge (placeholder 4p — PCB pinout missing)
add_connector(["Precharge/Discharge"], "Precharge/Discharge (4p placeholder)", PRECHARGE_DISCHARGE,
              "molex_minifit_jr_4p",
              ["bundle:Accu_Internal", "system:ts", "status:needs-verification"],
              "Precharge/Discharge 4-pin connector. PCB Precharge Circuit v0.2 pinout missing from xlsx — pins 1 & 3 used per gigadoc, 2 & 4 inferred.")

# TSMP + HV Out Connector
add_connector(["TSMP Connector"], "TSMP Connector (5p)", TSMP, "tsmp_connector_5p",
              ["bundle:Accu_Internal", "system:ts"], "Tractive-System Measurement Point (5-pin).")
add_connector(["HV Out Connector"], "HV Out Connector (3p)", HV_OUT, "hv_out_connector_3p",
              ["bundle:Accu_Internal", "system:ts"], "Accumulator HV-output 3-pin internal connector.")

# HV battery (stud terminals) + HV fuse
add_connector(["HV Battery+"], "HV Battery +", HV_BATTERY, "ring_terminal",
              ["system:ts"], "HV battery + stud terminal.")
add_connector(["HV Battery-"], "HV Battery -", HV_BATTERY, "ring_terminal",
              ["system:ts"], "HV battery - stud terminal.")
add_connector(["HV Fuse Input"], "HV Fuse Input", HV_FUSE, "ring_terminal",
              ["system:ts", "status:needs-verification"], "HV fuse input stud (location TBC per transcript).")
add_connector(["HV Fuse Output"], "HV Fuse Output", HV_FUSE, "ring_terminal",
              ["system:ts", "status:needs-verification"], "HV fuse output stud (location TBC per transcript).")

# Orion BMS (transcript: 3-pin CAN facing outward)
add_connector(["Orion BMS CAN"], "Orion BMS CAN (3p)", ORION_BMS, "generic_3p",
              ["system:bms", "status:needs-verification"],
              "Orion BMS 3-pin CAN connector (CAN_H, CAN_L, GND) — pinout assumed.")

# HV connector (bulkhead out)
add_connector(["HV Connector"], "HV Connector (Accu Out)", HV_CONN, "hv_out_connector_3p",
              ["system:ts", "status:needs-verification"],
              "Bulkhead HV-output connector with interlock (transcript — exact PN TBC).")

# ---- 2h. Charging Box connectors ------------------------------------------

add_connector(["AC-DC Input"], "AC-DC Input (L/N/PE)", ACDC, "ac_inlet_3p",
              ["system:charging"], "AC inlet. Port 1 = L+N, Port 2 = chassis GND, Port 3 = DC out.")
add_connector(["AC-DC Output"], "AC-DC DC Output (Terminal Block)", ACDC, "terminal_block_generic",
              ["system:charging"], "AC-to-DC DC-side terminal block. Pins are arbitrary — 1/2 = +/- to Charge Board, 3/4 = Cooling Pump, 5/6 = Cooling Fan (transcript).")
add_connector(["Charge Board 12V In"], "Charge Board 12V Input", CHARGE_BOARD, "molex_minifit_jr_4p",
              ["system:charging", "status:needs-verification"],
              "Charge-board power input (from AC-to-DC). Placeholder 4-pin.")
add_connector(["Charge Board 12V Out"], "Charge Board 12V Output (to Car)", CHARGE_BOARD, "molex_minifit_jr_4p",
              ["system:charging", "status:needs-verification"],
              "Charge-board always-on / charge-enable 12V feed to the car.")
add_connector(["Charging-C1"], "Charging-C1 (at ROC)", CHARGE_BOARD, "deutsch_dt_2p_female",
              ["bundle:EXT_ROC_H2"],
              "Charge-board LV MS charging connection (2-pin DT, EXT ROC H2).")
add_connector(["Charger DCDC Input"], "Charger DC-DC Input (LV)", DCDC_CHG, "molex_minifit_jr_4p",
              ["system:charging", "status:needs-verification"],
              "In-charger DC-DC LV input (from internal 12V battery).")
add_connector(["Charger DCDC Output"], "Charger DC-DC Output (Always-on + Enable)", DCDC_CHG, "molex_minifit_jr_4p",
              ["system:charging", "status:needs-verification"],
              "In-charger DC-DC outputs: pin 1 = always-on 12V, pin 2 = charge-enable 12V, pin 3 = GND, pin 4 = GND.")
add_connector(["Charger Box 12V Batt"], "Charger Box 12V Battery", CHG_12V_BATT, "ring_terminal",
              ["system:charging"], "12V backup battery inside charger box, + stud.")
add_connector(["Charger Box GND Batt"], "Charger Box 12V Battery -", CHG_12V_BATT, "ring_terminal",
              ["system:charging"], "12V backup battery inside charger box, - stud.")
add_connector(["J1772 Port"], "J1772 Port (5p)", J1772_PORT, "j1772_port",
              ["system:charging"], "SAE J1772 inlet (L1, L2, PE, CP, CC).")
add_connector(["Charger Box Estop A"], "Charger Box E-Stop (lead A)", CHG_ESTOP, "generic_2p",
              ["system:sdc", "system:charging"], "First green safety daisy-chain lead.")
add_connector(["Charger Box Estop B"], "Charger Box E-Stop (lead B)", CHG_ESTOP, "generic_2p",
              ["system:sdc", "system:charging"], "Second green safety daisy-chain lead.")
add_connector(["Charging Box Face"], "Charging Box Face 12-pin Deutsch", CHG_FACE_12P, "charger_box_face_12p",
              ["system:charging"], "12-pin Deutsch on Charging Box face — 12V pass-through to car.")

# ---- 2i. Inverter / Motor / sensors ---------------------------------------

add_connector(["INV LV"], "Inverter LV (TE AMP Seal 23p)", INVERTER, "te_ampseal_23p",
              ["bundle:EXT_1_MZ", "system:ts"], "Inverter LV connector (TE 770680-1, 23-pin).")
add_connector(["INV Ctrl"], "Inverter PCC Control (4p)", INVERTER, "molex_minifit_jr_4p",
              ["system:ts", "status:needs-verification"],
              "4-pin control connector from PCC to Inverter (transcript — pins invented: 1=12V, 2=GND, 3=CAN_H, 4=CAN_L).")
add_connector(["MOT_SENS"], "MOT_SENS (Souriau UTS 14p)", MOT_SENS_BRK, "souriau_circular_14p",
              ["bundle:EXT_1_MZ", "system:sensors"],
              "Motor-sensor breakout — Souriau UTS6JC12E14PW 14-pin (letter pins A-L mapped to 1-10).")
add_connector(["RLS_ENCODER"], "RLS Encoder (RM44SI)", RLS_ENC, "rls_rm44si",
              ["bundle:EXT_1_MZ", "system:sensors"], "RLS RM44SI encoder connector.")

# TSSI
add_connector(["TSSI"], "TSSI Connector (Molex sigma 4p)", TSSI, "molex_minifit_sigma_4p",
              ["bundle:FOC_H3", "system:tsal"], "TSSI light external connector.")

# Brake light / TSL
add_connector(["BRK_LT"], "Brake Light Connector (DT06-3S)", BRAKE_LIGHT, "deutsch_dt_3p_female",
              ["bundle:EXT_H3", "system:sensors"], "Brake light 3-pin DT connector.")
add_connector(["TS_LT", "TSL-C1"], "TS-Light Connector (DT06-4S)", TSL, "deutsch_dt_4p_female",
              ["bundle:EXT_H3", "system:tsal"], "Tractive-system light 4-pin DT connector.")

# APPS + throttle
add_connector(["APPS"], "APPS (Metri-Pack 150.2 6p)", APPS, "delphi_metripack_150_6p",
              ["bundle:EXT_H2", "system:sensors"], "APPS Metri-Pack 6-pin connector.")
add_connector(["THRS1-FEM"], "THRS1 Female (DT06-3S)", FOOTWELL_BRK, "deutsch_dt_3p_female",
              ["bundle:EXT_H2"], "Throttle sensor 1 female 3-pin DT (harness side).")
add_connector(["THRS1-MALE"], "THRS1 Male (DT04-3P)", THRS1, "deutsch_dt_3p_male",
              ["bundle:EXT_H2"], "Throttle sensor 1 male 3-pin DT (sensor side).")
add_connector(["THRS2-FEM"], "THRS2 Female (DT06-3S)", FOOTWELL_BRK, "deutsch_dt_3p_female",
              ["bundle:EXT_H2"], "Throttle sensor 2 female 3-pin DT (harness side).")
add_connector(["THRS2-MALE"], "THRS2 Male (DT04-3P)", THRS2, "deutsch_dt_3p_male",
              ["bundle:EXT_H2"], "Throttle sensor 2 male 3-pin DT (sensor side).")

# BPS
add_connector(["BPS-FEM"], "BPS Female (DT06-6S, Footwell side)", FOOTWELL_BRK, "deutsch_dt_6p_female",
              ["bundle:EXT_H2"], "BPS 6-pin female DT into footwell breakout.")
add_connector(["BPS-MALE"], "BPS Male (DT04-6P, Pressure side)", BPS_BRK, "deutsch_dt_6p_male",
              ["bundle:EXT_H2"], "BPS 6-pin male DT to pressure-sensor breakout.")
add_connector(["P51-BPS1"], "P51 BPS1 (3p)", BPS1, "p51_pressure_sensor",
              ["bundle:EXT_H2", "system:sensors"], "P51 brake pressure sensor 1.")
add_connector(["P51-BPS2"], "P51 BPS2 (3p)", BPS2, "p51_pressure_sensor",
              ["bundle:EXT_H2", "system:sensors"], "P51 brake pressure sensor 2.")

# Footwell [SB] is the 14-pin Molex that mates Safety Board J14 from the harness side.
add_connector(["Footwell [SB]"], "Footwell Breakout 14p Molex", FOOTWELL_BRK, "molex_14p",
              ["bundle:FOC_H2_FOOTWELL"], "Molex 14-pin on footwell breakout board (mates Safety Board J14).")

# Wheel sensors
add_connector(["WS-C1", "C1-WS", "C1"], "WS Bulkhead (Sensor side, Molex 12p)", WS_BRK, "molex_minifit_jr_12p",
              ["bundle:EXT_H6", "system:sensors"], "Wheel sensor bulkhead sensor-side Molex 12-pin.")
add_connector(["WS-C2", "C2-WS", "C2"], "WS Bulkhead (CCM side, DT06-12SA)", WS_BRK, "deutsch_dt_12p_female",
              ["bundle:EXT_H6", "system:sensors"], "Wheel sensor bulkhead CCM-side Deutsch 12-pin.")

# Current sensor
add_connector(["CURR_SENS"], "Current Sensor (DT04-3P)", CURR_SENS, "deutsch_dt_3p_male",
              ["bundle:EXT_H7", "system:ts"], "HV current sensor 3-pin DT male.")

# LV Battery
add_connector(["LV_Batt-C1"], "LV Battery Connector (DT04-2P)", LV_BATT, "deutsch_dt_2p_male",
              ["bundle:EXT_H8", "system:lvs"], "LV battery 2-pin DT connector.")
add_connector(["LV_Batt+"], "LV Battery + Ring", LV_BATT, "ring_terminal",
              ["system:lvs"], "LV battery + ring terminal.")
add_connector(["LV_Batt-"], "LV Battery - Ring", LV_BATT, "ring_terminal",
              ["system:lvs"], "LV battery - ring terminal.")

# Cooling pump / fan placeholders
add_connector(["Cooling Pump-C1"], "Cooling Pump Connector", COOL_PUMP, "generic_2p",
              ["status:placeholder", "system:cooling"], "Cooling pump 2-pin (placeholder — EXT/FOC H5 empty).")
add_connector(["Cooling Fan-C1"], "Cooling Fan Connector", COOL_FAN, "generic_2p",
              ["status:placeholder", "system:cooling"], "Cooling fan 2-pin (placeholder).")

# ---- 2j. CCM mating harness-side connectors -------------------------------
# Each CCM Jn has a mating connector on the harness side that terminates into a
# specific destination enclosure. The mate has identical pin-count and pinout
# (1:1) so a CCM CSV row maps to a single path `CCM Jn pin X <-> CCM Jn Mate pin X`.

CCM_MATES = [
    # (ccm_key, mate_key, name, parent_enc, ctype)
    ("J1",  "CCM J1 Mate",  "CCM J1 Mate (RTD/Brake Light Split)", FOC,        "molex_minifit_5566_2p"),
    ("J2",  "CCM J2 Mate",  "CCM J2 Mate (I2C)",                   I2C_EXP,    "molex_minifit_5566_2p"),
    ("J3",  "CCM J3 Mate",  "CCM J3 Mate (CAN2)",                  CAN_TXR,    "molex_minifit_5566_2p"),
    ("J4",  "CCM J4 Mate",  "CCM J4 Mate (Linear Pots)",           LINPOT_EXP, "molex_minifit_5566_4p"),
    ("J5",  "CCM J5 Mate",  "CCM J5 Mate (GPIO 1/2)",              GPIO_EXP,   "molex_minifit_5566_4p"),
    ("J6",  "CCM J6 Mate",  "CCM J6 Mate (Vin)",                   CCM_VIN_TAP,"molex_minifit_5566_2p"),
    ("J7",  "CCM J7 Mate",  "CCM J7 Mate (PWM in)",                PWM_IN_EXP, "molex_minifit_5566_2p"),
    ("J8",  "CCM J8 Mate",  "CCM J8 Mate (Brake/APPS Split)",      FOOTWELL_BRK, "molex_minifit_5566_4p"),
    ("J9",  "CCM J9 Mate",  "CCM J9 Mate (CAN1)",                  CAN_TXR,    "molex_minifit_5566_2p"),
    ("J11", "CCM J11 Mate", "CCM J11 Mate (Fan+/Pump1-)",          COOL_PUMP,  "molex_minifit_5566_2p"),
    ("J12", "CCM J12 Mate", "CCM J12 Mate (Fan+/Pump2-)",          COOL_PUMP,  "molex_minifit_5566_2p"),
    ("J13", "CCM J13 Mate", "CCM J13 Mate (Fan+/GLV-)",            COOL_FAN,   "molex_minifit_5566_2p"),
    ("J14", "CCM J14 Mate", "CCM J14 Mate (GPIO 3/4)",             GPIO_EXP,   "molex_minifit_5566_4p"),
    ("J16", "CCM J16 Mate", "CCM J16 Mate (Fan PWM)",              COOL_FAN,   "molex_minifit_5566_4p"),
    ("J17", "CCM J17 Mate", "CCM J17 Mate (Thermistor 1/2 pigtail)", THERM_1,  "molex_minifit_5566_4p"),
    ("J18", "CCM J18 Mate", "CCM J18 Mate (Thermistor 3/4 pigtail)", THERM_3,  "molex_minifit_5566_4p"),
]
for _ccm_jk, mate_key, mate_name, mate_parent, mate_ctype in CCM_MATES:
    add_connector([mate_key], mate_name, mate_parent, mate_ctype,
                  ["bundle:CCM_internal", "system:lvs"],
                  f"Harness-side mate for {_ccm_jk}; pinout mirrors CCM CSV row-for-row.")

# ---- 2k. Inverter / Motor HV phases + HVIL pigtails -----------------------

INV_HV   = add_connector(["INV HV"],   "Inverter HV (3p, U/V/W)", INVERTER, "hv_phase_3p",
                          ["system:ts"], "Inverter HV phase output (1=U, 2=V, 3=W). Real PN TBC.")
MOT_HV   = add_connector(["MOT HV"],   "Motor HV (3p, U/V/W)",     MOTOR,    "hv_phase_3p",
                          ["system:ts"], "Motor HV phase input (1=U, 2=V, 3=W).")
INV_HVIL = add_connector(["INV HVIL"], "Inverter HVIL (2p)",       INVERTER, "hv_interlock_2p",
                          ["system:ts"], "HVIL pigtail at the inverter (1=HVIL+, 2=HVIL-).")
MOT_HVIL = add_connector(["MOT HVIL"], "Motor HVIL (2p)",          MOTOR,    "hv_interlock_2p",
                          ["system:ts"], "HVIL pigtail at the motor (1=HVIL+, 2=HVIL-).")

# ---- 2l. PCC J11 Discharge Enable + Precharge/Discharge LV ----------------

add_connector(["PCC J11"], "PCC J11 (Discharge Enable, 2p)", PCC, "molex_minifit_5566_2p",
              ["bundle:internal", "system:ts", "status:needs-verification"],
              "PCC J11 discharge-enable input. 1=DISCH_EN_12V, 2=GND. Real PCC J11 footprint TBC (CSV not in xlsx).")
add_connector(["Precharge/Discharge LV"], "Precharge/Discharge LV (2p)", PRECHARGE_DISCHARGE,
              "molex_minifit_jr_2p",
              ["bundle:Accu_Internal", "system:ts", "status:needs-verification"],
              "Precharge/Discharge board LV input — fed by PCC J11 / Charge Board.")

# ---- 2m. HV Connector upgrade to 5p with HVIL -----------------------------
# We replace the existing single-row 3p HV Connector with a 5-pin bulkhead
# (HV+, HV-, PE, HVIL+, HVIL-). To avoid invalidating the existing transcript
# extras that reference pins 1/2 we preserve those pins (HV+, HV-).
for _c in CONNECTORS:
    if _c["id"] == CONNECTOR_BY_KEY["HV Connector"]:
        _c["connector_type"] = "hv_bulkhead_5p_with_il"
        _c["name"] = "HV Connector (Accu Out, 5p w/ HVIL)"
        _c["properties"]["notes"] = (
            "Bulkhead HV-output: 1=HV+, 2=HV-, 3=PE/Shield, 4=HVIL+, 5=HVIL-. PN TBC."
        )
        # tags already include status:needs-verification
        break

# ---- 2n. Orion BMS Main 23p (placeholder pinout) --------------------------

add_connector(["Orion BMS Main"], "Orion BMS Main (23p, placeholder)", ORION_BMS,
              "orion_bms_main_23p",
              ["system:bms", "status:needs-verification"],
              "Orion BMS 2 main I/O. Placeholder pinout: 1=12V_KEY, 2=12V_ALWAYS, 3=GND, "
              "4=CAN_H, 5=CAN_L, 6=CHG_ENABLE, 7=DISCH_ENABLE, 8=READY, 9..23=MULTI_IO. "
              "Confirm against Orion BMS 2 datasheet.")

# ---- 2o. Thermistor pigtail mate connectors -------------------------------
# Each thermistor enclosure has its own 2-pin pigtail (signal+, GND).
add_connector(["Thermistor1-C1"], "Thermistor 1 Pigtail", THERM_1, "generic_2p_thermistor",
              ["system:cooling", "system:sensors"], "NTC thermistor 1 — 1=signal+, 2=GND.")
add_connector(["Thermistor2-C1"], "Thermistor 2 Pigtail", THERM_2, "generic_2p_thermistor",
              ["system:cooling", "system:sensors"], "NTC thermistor 2 — 1=signal+, 2=GND.")
add_connector(["Thermistor3-C1"], "Thermistor 3 Pigtail", THERM_3, "generic_2p_thermistor",
              ["system:cooling", "system:sensors"], "NTC thermistor 3 — 1=signal+, 2=GND.")
add_connector(["Thermistor4-C1"], "Thermistor 4 Pigtail", THERM_4, "generic_2p_thermistor",
              ["system:cooling", "system:sensors"], "NTC thermistor 4 — 1=signal+, 2=GND.")

# ---- Placeholder: CCM N/C and Footwell [SB] N/C aren't connectors we need to model.

# ---------- 3. Merge Points ------------------------------------------------

MERGES: list[dict] = []
MERGE_BY_KEY: dict[str, str] = {}

def add_merge(key: str, name: str, parent: str | None, tags: list[str] | None = None,
              notes: str = "") -> str:
    mid = f"mp_{len(MERGES)+1:03d}"
    props = {"notes": notes} if notes else {}
    MERGES.append({
        "id": mid,
        "name": name,
        "parent": parent,
        "tags": tags or [],
        "properties": props,
    })
    MERGE_BY_KEY[key] = mid
    return mid

# ATUM heat-shrink splices inside accumulator
for s in ("S2", "S3", "S4", "S5", "S6"):
    add_merge(s, f"Splice {s} (ATUM-24/6-0-STK)", HVB,
              ["bundle:Accu_Internal", "system:ts"],
              "Heat-shrink splice inside accumulator.")
# EXT 1-MZ splices (heat-shrink butt splices in cable run)
add_merge("12V_ACCU", "Splice 12V_ACCU", FOC,
          ["bundle:EXT_1_MZ", "system:lvs"], "12V rail splice merging 12V feeds to ACCU.")
add_merge("12V_INV", "Splice 12V_INV", None,
          ["bundle:EXT_1_MZ", "system:lvs"], "12V rail splice for inverter LV supply.")
add_merge("GND_INV", "Splice GND_INV", None,
          ["bundle:EXT_1_MZ", "system:lvs"], "GND splice for inverter LV supply.")

# ---------- 4. Signal helpers ----------------------------------------------

SIGNALS: dict[str, dict] = {}  # slug -> signal dict

def ensure_signal(slug: str, human: str | None = None) -> str:
    if slug not in SIGNALS:
        SIGNALS[slug] = {
            "id": f"sig_{slug}",
            "name": slug,
            "tags": [],
            "properties": {"description": human} if human and human != slug else {},
        }
    return SIGNALS[slug]["id"]

def slugify(s: str | None) -> str | None:
    if not s:
        return None
    s = s.strip()
    if not s:
        return None
    # Skip multi-sentence notes
    if len(s) > 50 or ". " in s or " actually " in s.lower():
        return None
    # Handle high/low, +, trailing -
    s = re.sub(r'\b(high)\b', 'H', s, flags=re.I)
    s = re.sub(r'\b(low)\b', 'L', s, flags=re.I)
    s = re.sub(r'\+', '_PLUS', s)
    s = re.sub(r'(\w)-(?=\W|$)', r'\1_MINUS', s)
    s = re.sub(r'[^A-Za-z0-9]+', '_', s).strip('_').upper()
    if not s or len(s) > 40:
        return None
    return s

# ---------- 5. Path helpers ------------------------------------------------

PATHS: list[dict] = []

# Letter -> pin for Souriau MOT_SENS (pins in order seen in gigadoc)
LETTER_TO_PIN = {"A":1, "B":2, "C":3, "D":4, "E":5, "F":6, "H":7, "J":8, "K":9, "L":10, "G":7, "I":8}

# Special pin name maps (per-connector)
SPECIAL_PIN = {
    "Contactor_B+": {"1":1, "2":2, "Switch":3, "HV+":4, "HV-":4},
    "Contactor_B-": {"1":1, "2":2, "Switch":3, "HV-":4, "HV+":4},
    "Energy Meter": {"HV-":1, "HV+":2, "Sense":3, "1":1, "2":2, "3":3},
}

def parse_ref(ref: str) -> tuple[str, object | None]:
    ref = ref.strip()
    if not ref:
        return ("", None)
    if "." not in ref:
        return (ref, None)
    idx = ref.rfind(".")
    left, right = ref[:idx], ref[idx+1:]
    right = right.strip()
    return (left.strip(), right)

def resolve_pin(designator: str, pin_str: object | None) -> int | None:
    if pin_str is None:
        return None
    if isinstance(pin_str, int):
        return pin_str
    pin_str = str(pin_str).strip()
    if pin_str in ("", "N/C"):
        return None
    # Per-connector mapping first
    if designator in SPECIAL_PIN and pin_str in SPECIAL_PIN[designator]:
        return SPECIAL_PIN[designator][pin_str]
    # Digit extraction (handles "pin2", "5", "S1" -> 1 etc)
    m = re.search(r'(\d+)', pin_str)
    if m:
        return int(m.group(1))
    # Single letter -> motor sensor letter table
    if len(pin_str) == 1 and pin_str.upper() in LETTER_TO_PIN:
        return LETTER_TO_PIN[pin_str.upper()]
    # Housing / Shell / Switch fallback
    if pin_str in ("Housing", "Shell"):
        return 1
    return None

def resolve_node(ref: str, bundle: str | None = None) -> dict | None:
    """Convert a gigadoc From/To ref into either a connector node or a merge node."""
    if not ref.strip():
        return None
    designator, pin = parse_ref(ref)
    # Alias cleanup
    designator = designator.strip()
    if designator in MERGE_BY_KEY and pin is None:
        return {"kind": "merge", "merge_point_id": MERGE_BY_KEY[designator]}
    # Try designator as-is
    if designator in CONNECTOR_BY_KEY:
        cid = CONNECTOR_BY_KEY[designator]
        pn = resolve_pin(designator, pin)
        node = {"kind": "connector", "connector_id": cid}
        if pn is not None:
            node["pin_number"] = pn
        return node
    # Try treating whole ref as merge (e.g. "12V_ACCU")
    if ref.strip() in MERGE_BY_KEY:
        return {"kind": "merge", "merge_point_id": MERGE_BY_KEY[ref.strip()]}
    # Typical designator variants
    for cand in (designator.replace(" ", "-"), designator.replace("-", " "),
                 designator.upper(), designator.lower()):
        if cand in CONNECTOR_BY_KEY:
            cid = CONNECTOR_BY_KEY[cand]
            pn = resolve_pin(designator, pin)
            node = {"kind": "connector", "connector_id": cid}
            if pn is not None:
                node["pin_number"] = pn
            return node
    return None

UNRESOLVED: set[str] = set()

def add_path(name: str, nodes: list[dict], tags: list[str], props: dict,
             measurements: list[dict] | None = None) -> None:
    pid = f"path_{len(PATHS)+1:03d}"
    PATHS.append({
        "id": pid,
        "name": name,
        "tags": tags,
        "properties": props,
        "nodes": nodes,
        "measurements": measurements or [],
    })

# ---------- 6. System classification per bundle ----------------------------

BUNDLE_SYSTEM = {
    "EXT_1_MZ": ["system:ts", "system:lvs", "system:sensors"],
    "EXT_H2": ["system:sensors"],
    "EXT_H3": ["system:tsal"],
    "EXT_H4": ["system:sdc"],
    "EXT_H6": ["system:sensors"],
    "EXT_H7": ["system:ts"],
    "EXT_H8": ["system:lvs"],
    "EXT_ROC_H1": ["system:sdc", "system:lvs"],
    "EXT_ROC_H2": ["system:sdc", "system:lvs", "system:charging"],
    "FOC_H1": ["system:bms", "system:ts"],
    "FOC_H2_FOOTWELL": ["system:sensors"],
    "FOC_H3": ["system:tsal"],
    "FOC_H7": ["system:ts"],
    "FOC_H8": ["system:sdc", "system:lvs"],
    "FOC_H9": ["system:dash", "system:lvs"],
    "Accu_Internal": ["system:ts", "system:bms"],
    "Inside_ROC": ["system:sdc", "system:lvs"],
}

BUNDLE_NAME_MAP = {
    "Accu Internal Harness": "Accu_Internal",
    "EXT 1 - MZ": "EXT_1_MZ",
    "EXT H2": "EXT_H2",
    "EXT H3": "EXT_H3",
    "EXT H4": "EXT_H4",
    "EXT H6": "EXT_H6",
    "EXT H7": "EXT_H7",
    "EXT H8": "EXT_H8",
    "EXT ROC H1": "EXT_ROC_H1",
    "EXT ROC H2": "EXT_ROC_H2",
    "FOC H1": "FOC_H1",
    "FOC H2_ Footwell": "FOC_H2_FOOTWELL",
    "FOC H3": "FOC_H3",
    "FOC H7": "FOC_H7",
    "FOC H8": "FOC_H8",
    "FOC H9": "FOC_H9",
    "Inside ROC": "Inside_ROC",
}

# ---------- 7. Parse gigadoc + build paths ---------------------------------

def parse_tsv_block(text: str) -> list[list[str]]:
    rows = [r for r in text.strip("\n").split("\n") if r.strip()]
    return [r.split("\t") for r in rows]

def parse_gigadoc(text: str) -> list[tuple[str, list[dict]]]:
    """Return list of (harness_name, rows) where rows are parsed Connections (preferred) / Wiring Table dicts."""
    out = []
    sections = re.split(r'^## \d+\. ', text, flags=re.M)[1:]
    for sec in sections:
        head = sec.split("\n", 1)[0].strip()
        # find all tsv fenced blocks
        blocks = re.findall(r"### ([^\n]+)\n+```tsv\n([\s\S]*?)\n```", sec)
        # prefer Connections
        chosen = None
        for title, body in blocks:
            if title.lower().startswith("connections"):
                chosen = ("Connections", body)
                break
        if not chosen:
            for title, body in blocks:
                if title.lower().startswith("wiring"):
                    chosen = ("Wiring", body)
                    break
        if not chosen:
            continue
        title, body = chosen
        rows = parse_tsv_block(body)
        if not rows:
            continue
        header = rows[0]
        data = [dict(zip(header, r + [""] * (len(header) - len(r)))) for r in rows[1:]]
        out.append((head, data))
    return out

def build_paths_from_harnesses(gigadoc_text: str) -> None:
    harnesses = parse_gigadoc(gigadoc_text)
    for name, rows in harnesses:
        bundle = BUNDLE_NAME_MAP.get(name, re.sub(r'[^A-Za-z0-9]+', '_', name).strip('_'))
        sys_tags = BUNDLE_SYSTEM.get(bundle, [])
        for row in rows:
            frm = row.get("From", "")
            to = row.get("To", "")
            if not frm or not to:
                continue
            # Skip "N/C" pins silently
            def _is_nc(ref: str) -> bool:
                return ref.strip().endswith(".N/C") or ref.strip() == "N/C"
            if _is_nc(frm) or _is_nc(to):
                continue
            nfrom = resolve_node(frm)
            nto = resolve_node(to)
            if nfrom is None:
                UNRESOLVED.add(frm)
            if nto is None:
                UNRESOLVED.add(to)
            if nfrom is None or nto is None:
                continue
            notes = row.get("Notes", "").strip()
            conductor = row.get("Conductor", "").strip()
            size = row.get("Size", "").strip()
            length = row.get("Length", "").strip()

            # Wire color from conductor ref ("W8.Red", "W20.White-Blue")
            wire_color = ""
            if "." in conductor:
                wire_color = conductor.split(".", 1)[1]

            tags = list(sys_tags) + [f"bundle:{bundle}"]
            slug = slugify(notes)
            if slug:
                ensure_signal(slug, human=notes)
                tags.append(f"signal:{slug}")

            # Status flags — add needs-verification to things we flagged as uncertain
            for n in (nfrom, nto):
                if n.get("kind") == "connector":
                    cid = n["connector_id"]
                    con = next(c for c in CONNECTORS if c["id"] == cid)
                    if "status:needs-verification" in con.get("tags", []) and "status:needs-verification" not in tags:
                        tags.append("status:needs-verification")
                    if "status:placeholder" in con.get("tags", []) and "status:placeholder" not in tags:
                        tags.append("status:placeholder")

            props = {}
            ref_des = row.get("Conductor", "").split(".", 1)[0]
            if ref_des:
                props["wire_id"] = ref_des
            if wire_color:
                props["wire_color"] = wire_color
            if size:
                props["wire_gauge"] = size
            if length:
                props["length"] = length
            if notes:
                props["notes"] = notes

            pname_note = notes[:30] if notes else f"{frm} -> {to}"
            pname = f"{ref_des or 'W?'} - {pname_note}".strip()

            measurements = []
            if length and re.search(r'\d', length):
                m = re.search(r'(\d+(?:\.\d+)?)', length)
                if m:
                    length_mm = int(float(m.group(1)) * 25.4)
                    measurements.append({
                        "from": nfrom,
                        "to": nto,
                        "length_mm": length_mm,
                    })

            add_path(pname, [nfrom, nto], tags, props, measurements)

# ---------- 8. Transcript-derived extra paths ------------------------------

def add_transcript_extras() -> None:
    """Paths that exist in the transcript but aren't in the gigadoc."""
    def node(key: str, pin: int | None = None) -> dict:
        cid = CONNECTOR_BY_KEY[key]
        n = {"kind": "connector", "connector_id": cid}
        if pin is not None:
            n["pin_number"] = pin
        return n
    def mnode(key: str) -> dict:
        return {"kind": "merge", "merge_point_id": MERGE_BY_KEY[key]}

    base_tags = ["bundle:transcript", "status:needs-verification"]

    # Orion BMS CAN fan-out to PCC BMS port (3-pin CAN assumed pins 1=CAN_H, 2=CAN_L, 3=GND)
    for p_bms, p_pcc, sig in [(1, 1, "CAN_BMS_H"), (2, 3, "CAN_BMS_L"), (3, 4, "GLV_GND")]:
        ensure_signal(sig)
        add_path(f"Orion BMS CAN pin {p_bms} - {sig}",
                 [node("Orion BMS CAN", p_bms), node("PCC J8", p_pcc)],
                 base_tags + [f"signal:{sig}", "system:bms"],
                 {"notes": "Orion BMS CAN fan-out (pinout inferred — transcript flagged)."})

    # Inverter 4-pin control path: PCC J12 -> Inverter Ctrl (1=12V, 2=GND, 3=CAN_H, 4=CAN_L)
    for p in (1, 2, 3, 4):
        pcc_pin = {1:2, 2:4, 3:1, 4:3}[p]  # PCC J12 pins: 1=CANH, 2=GLV+, 3=CANL, 4=GLV-
        sig = {1:"INV_12V", 2:"INV_GND", 3:"CAN_INV_H", 4:"CAN_INV_L"}[p]
        ensure_signal(sig)
        add_path(f"INV Ctrl pin {p} - {sig}",
                 [node("PCC J12", pcc_pin), node("INV Ctrl", p)],
                 base_tags + [f"signal:{sig}", "system:ts"],
                 {"notes": "Inverter 4-pin PCC→INV control; pin-out invented per transcript."})

    # Energy Meter CAN 4p -> PCC J9 (1=CAN_H, 2=GLV+, 3=CAN_L, 4=GLV-)
    for p in (1, 2, 3, 4):
        sig = {1:"CAN_EM_H", 2:"GLV_PLUS", 3:"CAN_EM_L", 4:"GLV_MINUS"}[p]
        ensure_signal(sig)
        add_path(f"Energy Meter CAN pin {p} - {sig}",
                 [node("PCC J9", p), node("Energy Meter CAN", p)],
                 ["bundle:Accu_Internal", f"signal:{sig}", "system:bms", "system:ts"],
                 {"notes": "Energy meter CAN 4-pin (transcript)."})

    # AC-to-DC -> Charge Board 12V In (positive + negative), and to Cooling Pump/Fan
    ensure_signal("CHG_12V_PLUS"); ensure_signal("CHG_12V_MINUS")
    add_path("AC-DC DC+ -> Charge Board +",
             [node("AC-DC Output", 1), node("Charge Board 12V In", 1)],
             ["bundle:transcript", "system:charging", "signal:CHG_12V_PLUS", "status:needs-verification"],
             {"notes": "AC-to-DC terminal block 12V+ to Charge Board (placeholder pin)."})
    add_path("AC-DC DC- -> Charge Board -",
             [node("AC-DC Output", 2), node("Charge Board 12V In", 2)],
             ["bundle:transcript", "system:charging", "signal:CHG_12V_MINUS", "status:needs-verification"],
             {"notes": "AC-to-DC terminal block 12V- to Charge Board."})
    ensure_signal("COOL_PUMP_PWR")
    add_path("AC-DC -> Cooling Pump",
             [node("AC-DC Output", 3), node("Cooling Pump-C1", 1)],
             ["bundle:transcript", "system:cooling", "signal:COOL_PUMP_PWR", "status:placeholder"],
             {"notes": "Cooling pump power from AC-to-DC terminal block (placeholder — EXT H5 empty)."})
    add_path("AC-DC -> Cooling Pump GND",
             [node("AC-DC Output", 4), node("Cooling Pump-C1", 2)],
             ["bundle:transcript", "system:cooling", "status:placeholder"],
             {"notes": "Cooling pump GND placeholder."})
    ensure_signal("COOL_FAN_PWR")
    add_path("AC-DC -> Cooling Fan",
             [node("AC-DC Output", 5), node("Cooling Fan-C1", 1)],
             ["bundle:transcript", "system:cooling", "signal:COOL_FAN_PWR", "status:placeholder"],
             {"notes": "Cooling fan power from AC-to-DC terminal block (placeholder)."})
    add_path("AC-DC -> Cooling Fan GND",
             [node("AC-DC Output", 6), node("Cooling Fan-C1", 2)],
             ["bundle:transcript", "system:cooling", "status:placeholder"],
             {"notes": "Cooling fan GND placeholder."})

    # Charge Board -> Charging Box Face 12p -> out to car (always-on + charge-enable)
    ensure_signal("CHG_ALWAYS_ON_12V"); ensure_signal("CHG_ENABLE_12V")
    add_path("Charge Board -> Face 12p (Always-on)",
             [node("Charge Board 12V Out", 1), node("Charging Box Face", 1)],
             ["bundle:transcript", "system:charging", "signal:CHG_ALWAYS_ON_12V", "status:needs-verification"],
             {"notes": "Always-on 12V pass-through on Charging Box face."})
    add_path("Charge Board -> Face 12p (Enable)",
             [node("Charge Board 12V Out", 2), node("Charging Box Face", 2)],
             ["bundle:transcript", "system:charging", "signal:CHG_ENABLE_12V", "status:needs-verification"],
             {"notes": "Charge-enable 12V pass-through on Charging Box face."})

    # Charger Box internal 12V battery -> Charger DCDC input
    ensure_signal("CHG_BOX_12V_BATT")
    add_path("Charger Box 12V Batt -> DCDC +",
             [node("Charger Box 12V Batt", 1), node("Charger DCDC Input", 1)],
             ["bundle:transcript", "system:charging", "signal:CHG_BOX_12V_BATT", "status:needs-verification"],
             {"notes": "Internal 12V battery to charger DCDC (transcript)."})
    add_path("Charger Box 12V Batt - -> DCDC -",
             [node("Charger Box GND Batt", 1), node("Charger DCDC Input", 2)],
             ["bundle:transcript", "system:charging", "status:needs-verification"],
             {"notes": "Internal 12V battery GND to charger DCDC."})

    # Charger Box E-Stop: two green SDC daisy-chain leads (transcript)
    ensure_signal("SDC_CHG_DAISY")
    add_path("Charger Estop lead A",
             [node("Charger Box Estop A", 1), node("Charging-C1", 1)],
             ["bundle:transcript", "system:sdc", "system:charging", "signal:SDC_CHG_DAISY",
              "status:needs-verification"],
             {"notes": "Charger E-stop safety daisy-chain lead A (transcript)."})
    add_path("Charger Estop lead B",
             [node("Charger Box Estop B", 1), node("Charging-C1", 2)],
             ["bundle:transcript", "system:sdc", "system:charging", "signal:SDC_CHG_DAISY",
              "status:needs-verification"],
             {"notes": "Charger E-stop safety daisy-chain lead B (transcript)."})

    # J1772 port -> Charge Board CP/CC
    ensure_signal("J1772_CP"); ensure_signal("J1772_CC"); ensure_signal("J1772_PE")
    add_path("J1772 CP -> Charge Board",
             [node("J1772 Port", 4), node("Charge Board 12V In", 3)],
             ["bundle:transcript", "system:charging", "signal:J1772_CP", "status:needs-verification"],
             {"notes": "J1772 Control Pilot to Charge Board."})
    add_path("J1772 CC -> Charge Board",
             [node("J1772 Port", 5), node("Charge Board 12V In", 4)],
             ["bundle:transcript", "system:charging", "signal:J1772_CC", "status:needs-verification"],
             {"notes": "J1772 Proximity Detect to Charge Board."})

    # HV Battery stud terminals -> AIRs
    ensure_signal("HV_PLUS"); ensure_signal("HV_MINUS")
    add_path("HV Battery+ -> AIR+ load",
             [node("HV Battery+", 1), node("Contactor_B+", 4)],
             ["bundle:transcript", "system:ts", "signal:HV_PLUS"],
             {"notes": "HV battery + stud to AIR+ load terminal."})
    add_path("HV Battery- -> AIR- load",
             [node("HV Battery-", 1), node("Contactor_B-", 4)],
             ["bundle:transcript", "system:ts", "signal:HV_MINUS"],
             {"notes": "HV battery - stud to AIR- load terminal."})

    # HV Fuse placeholder (not wired — transcript asks us to place but not route)
    # Orion BMS power (GLV+/GLV-)
    add_path("HV Connector +",
             [node("Contactor_B+", 2), node("HV Connector", 1)],
             ["bundle:transcript", "system:ts", "signal:HV_PLUS", "status:needs-verification"],
             {"notes": "HV connector + (exit from AIR+)."})
    add_path("HV Connector -",
             [node("Contactor_B-", 2), node("HV Connector", 2)],
             ["bundle:transcript", "system:ts", "signal:HV_MINUS", "status:needs-verification"],
             {"notes": "HV connector - (exit from AIR-)."})

# ---------- 8b. CCM CSV-derived paths --------------------------------------

def _node(key: str, pin: int | None = None) -> dict:
    cid = CONNECTOR_BY_KEY[key]
    n = {"kind": "connector", "connector_id": cid}
    if pin is not None:
        n["pin_number"] = pin
    return n

def _mnode(key: str) -> dict:
    return {"kind": "merge", "merge_point_id": MERGE_BY_KEY[key]}

def add_ccm_csv_paths() -> None:
    """Read CCM Connectors.csv and emit one path per CSV row, going CCM Jn -> CCM Jn Mate.

    J10 is skipped because it is already wired by the gigadoc (Speaker via FOC H8).
    """
    csv_path = INPUT_DIR / "CCM Connectors.csv"
    with csv_path.open(newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    base_tags = ["bundle:CCM_internal", "system:lvs"]
    skip_jks = {"J10"}
    # The mate connector key is derived from the Jn
    for row in rows:
        jk = row["Reference"].strip()
        if jk in skip_jks:
            continue
        try:
            pin = int(row["Pin"])
        except ValueError:
            continue
        net = row["Net"].strip()
        if net.startswith("unconnected"):
            continue
        ccm_key = f"CCM {jk}"
        mate_key = f"CCM {jk} Mate"
        if ccm_key not in CONNECTOR_BY_KEY or mate_key not in CONNECTOR_BY_KEY:
            continue
        slug = slugify(net) or net.upper().replace("+", "_PLUS").replace("-", "_MINUS")
        slug = re.sub(r"[^A-Z0-9]+", "_", slug.upper()).strip("_") or "CCM_NET"
        ensure_signal(slug, human=net)
        tags = list(base_tags) + [f"signal:{slug}"]
        # Mark needs-verification on placeholder destinations
        mate_cid = CONNECTOR_BY_KEY[mate_key]
        mate = next(c for c in CONNECTORS if c["id"] == mate_cid)
        if "status:placeholder" in mate.get("tags", []) and "status:placeholder" not in tags:
            tags.append("status:placeholder")
        add_path(
            f"CCM {jk}.{pin} - {net}",
            [_node(ccm_key, pin), _node(mate_key, pin)],
            tags,
            {"notes": f"CCM CSV: net={net} on {jk} pin {pin}.", "wire_id": f"CCM-{jk}-{pin}"},
        )

# ---------- 8c. Safety Board AER-xlsx-derived paths ------------------------

def add_safety_board_csv_paths() -> None:
    """Wire SB J17 (Wheel/Shock 12p) → CCM, SB J18 (to CCM 20p) → CCM, and SB J14 (Footwell 14p)
    using the AER xlsx pinouts. SB J17/J18 fan-out into the wheel-sensor breakout and CCM, but
    we model only the SB-side termination → a Bridge mate connector parented to the relevant
    breakout. CCM-side of these signals is already covered by the CCM CSV iteration above
    (which lands on the GPIO/PWM/etc. mate connectors)."""
    base_tags = ["bundle:SB_internal", "system:lvs", "system:sdc"]

    # SB J18 ↔ CCM bridge: 20p, AER xlsx pin map
    sb_j18 = [
        (1,  "TSSI_BYP"),
        (2,  "CCM_FDBK"),
        (3,  "SPEAKER_IN"),
        (4,  "CCM_GND"),
        (5,  "BSPD_B_IN"),
        (6,  "BPS2_OUT"),
        (7,  "CCM_3V3"),
        (8,  "APPS1_OUT"),
        (9,  "APPS2_OUT"),
        (10, "CCM_24V"),
        (11, "RTDB"),
        (12, "GND"),
        (13, "CCM_5V"),
        (14, "WHEEL_SHOCK1_OUT"),
        (15, "WHEEL_SHOCK2_OUT"),
        (16, "WHEEL_SHOCK3_OUT"),
        (17, "WHEEL_SHOCK4_OUT"),
        # 18 is unconnected
        (19, "BRAKELIGHT"),
        (20, "CCM_12V"),
    ]
    for pin, sig in sb_j18:
        ensure_signal(sig)
        # Both ends are CCM-bound; we route SB J18 -> CCM Helper bus (modeled via the CCM
        # connector that owns the same net). For unmapped nets we land on the CCM J5 GPIO
        # mate as a generic "CCM Helper" sink. To keep the model auditable, we simply
        # terminate at SB J18 alone if no precise CCM destination exists.
        add_path(
            f"SB J18.{pin} - {sig}",
            [_node("SB J18", pin), _node("CCM J14 Mate", min(pin, 4))],
            base_tags + [f"signal:{sig}", "status:needs-verification"],
            {"notes": f"SB↔CCM bridge net {sig} (AER xlsx). Landing on CCM J14 mate as a generic CCM-helper sink — actual CCM destination per net TBC.",
             "wire_id": f"SB-J18-{pin}"},
        )

    # SB J17 (Shock/Wheel 12p) → wheel sensor breakout. AER xlsx pinout.
    sb_j17 = [
        (1,  "CCM_5V"),
        (2,  "CCM_5V"),
        (3,  "CCM_GND"),
        (4,  "CCM_GND"),
        (5,  "CCM_GND"),
        (6,  "CCM_GND"),
        (7,  "CCM_5V"),
        (8,  "CCM_5V"),
        (9,  "WHEEL_SHOCK1_IN"),
        (10, "WHEEL_SHOCK2_IN"),
        (11, "WHEEL_SHOCK3_IN"),
        (12, "WHEEL_SHOCK4_IN"),
    ]
    for pin, sig in sb_j17:
        ensure_signal(sig)
        # Land on the wheel-sensor breakout (existing C1-WS Molex 12p) on the same pin.
        add_path(
            f"SB J17.{pin} - {sig}",
            [_node("SB J17", pin), _node("WS-C1", pin)],
            base_tags + [f"signal:{sig}", "system:sensors", "status:needs-verification"],
            {"notes": f"SB J17 (Shock/Wheel) → wheel-sensor breakout per AER xlsx.",
             "wire_id": f"SB-J17-{pin}"},
        )

    # SB J14 (Footwell 14p) → Footwell breakout (existing 'Footwell [SB]' 14p Molex).
    sb_j14 = [
        # 1 unconnected
        (2,  "CCM_GND"),
        (3,  "CCM_GND"),
        (4,  "CCM_3V3"),
        (5,  "CCM_GND"),
        (6,  "CCM_GND"),
        (7,  "CCM_5V"),
        # 8 unconnected
        (9,  "APPS2_IN"),
        (10, "APPS1_IN"),
        (11, "CCM_3V3"),
        (12, "BPS2_IN"),
        (13, "BPS1_IN"),
        (14, "CCM_5V"),
    ]
    for pin, sig in sb_j14:
        ensure_signal(sig)
        add_path(
            f"SB J14.{pin} - {sig}",
            [_node("SB J14", pin), _node("Footwell [SB]", pin)],
            base_tags + [f"signal:{sig}", "system:sensors"],
            {"notes": "SB J14 (Footwell) → footwell breakout per AER xlsx.",
             "wire_id": f"SB-J14-{pin}"},
        )

# ---------- 8d. PCC AER-xlsx internal paths --------------------------------

def add_pcc_internal_paths() -> None:
    """Wire PCC J1/J2/J3/J5/J9/J12 AER pinouts to the correct destinations."""
    base_tags = ["bundle:Accu_Internal", "system:ts"]

    # J1 to AIRs (4p): 1=Shutdown_in, 2=IR+_GND, 3=IR-_GND, 4=Shutdown_in
    # Shutdown leads land on AIR aux switch terminals; IR+/IR- GND on coil grounds.
    for pin, dest_key, dest_pin, sig in [
        (1, "Contactor_B+", 3, "AIR_SHUTDOWN_IN"),  # AIR+ aux switch
        (2, "Contactor_B+", 2, "IR_PLUS_GND"),       # AIR+ coil-
        (3, "Contactor_B-", 2, "IR_MINUS_GND"),      # AIR- coil-
        (4, "Contactor_B-", 3, "AIR_SHUTDOWN_IN"),   # AIR- aux switch
    ]:
        ensure_signal(sig)
        add_path(
            f"PCC J1.{pin} - {sig}",
            [_node("PCC J1", pin), _node(dest_key, dest_pin)],
            base_tags + [f"signal:{sig}"],
            {"notes": f"PCC J1 (to AIRs) per AER xlsx.", "wire_id": f"PCC-J1-{pin}"},
        )

    # J2 HV connections (12p) per AER xlsx
    j2 = [
        (1,  "/IL",                     None),  # HVIL — handled in add_hv_interlock_loop
        (2,  "FUSED_TS_PLUS_1_IMD",     ("IMD",          1)),
        (3,  "FUSED_TS_PLUS_2_RTML",    ("RTM J5",       1)),  # RTM HV+ (light driver)
        (4,  "FUSED_TS_PLUS_3_HVIND",   ("Voltage Indicator", 1)),
        (5,  "FUSED_TS_PLUS_4_EM",      ("Energy Meter", 2)),  # HV+
        (6,  "TSMP_PLUS",               ("TSMP Connector", 1)),
        # 7 unconnected
        (8,  "FUSED_TS_MINUS_1_IMD",    ("IMD",          2)),
        (9,  "FUSED_TS_MINUS_2_RTML",   ("RTM J5",       2)),  # RTM HV-
        (10, "FUSED_TS_MINUS_3_HVIND",  ("Voltage Indicator", 2)),
        # 11 unconnected
        (12, "TSMP_MINUS",              ("TSMP Connector", 2)),
    ]
    for pin, sig, dest in j2:
        if dest is None:
            continue
        ensure_signal(sig)
        dk, dp = dest
        if dk not in CONNECTOR_BY_KEY:
            continue
        add_path(
            f"PCC J2.{pin} - {sig}",
            [_node("PCC J2", pin), _node(dk, dp)],
            base_tags + [f"signal:{sig}"],
            {"notes": f"PCC J2 HV connection (AER xlsx).", "wire_id": f"PCC-J2-{pin}"},
        )

    # J3 to Bulkhead (6p): CANL, GLV-, RTM_SIG, CANH, GLV+, IMD_Fault → ACCU-C1
    # ACCU-C1 has 12 pins (mating to FOC-C1). We pick a stable mapping into the lower 6.
    j3 = [
        (1, "CAN_BMS_L",      ("ACCU-C1", 1)),
        (2, "GLV_MINUS",      ("ACCU-C1", 2)),
        (3, "RTM_SIG",        ("ACCU-C1", 3)),
        (4, "CAN_BMS_H",      ("ACCU-C1", 4)),
        (5, "GLV_PLUS",       ("ACCU-C1", 5)),
        (6, "IMD_FAULT",      ("ACCU-C1", 6)),
    ]
    for pin, sig, (dk, dp) in j3:
        ensure_signal(sig)
        add_path(
            f"PCC J3.{pin} - {sig}",
            [_node("PCC J3", pin), _node(dk, dp)],
            base_tags + [f"signal:{sig}", "system:bms"],
            {"notes": "PCC J3 (to Bulkhead) per AER xlsx — landing pins on ACCU-C1.",
             "wire_id": f"PCC-J3-{pin}"},
        )

    # J5 IMD (6p): CANL, GLV-, RTM_SIG, CANH, GLV+, IMD_Fault → IMD 8p
    j5 = [
        (1, "CAN_BMS_L",  ("IMD", 3)),
        (2, "GLV_MINUS",  ("IMD", 4)),
        (3, "RTM_SIG",    ("IMD", 5)),
        (4, "CAN_BMS_H",  ("IMD", 6)),
        (5, "GLV_PLUS",   ("IMD", 7)),
        (6, "IMD_FAULT",  ("IMD", 8)),
    ]
    for pin, sig, (dk, dp) in j5:
        ensure_signal(sig)
        add_path(
            f"PCC J5.{pin} - {sig}",
            [_node("PCC J5", pin), _node(dk, dp)],
            base_tags + [f"signal:{sig}"],
            {"notes": "PCC J5 (IMD) per AER xlsx.", "wire_id": f"PCC-J5-{pin}"},
        )

# ---------- 8e. Inverter ↔ Motor HV phases + HVIL --------------------------

def add_inverter_motor_paths() -> None:
    """3 phase wires (U/V/W) and 2 HVIL pigtail wires between inverter and motor."""
    for pin, phase in [(1, "U"), (2, "V"), (3, "W")]:
        sig = f"PHASE_{phase}"
        ensure_signal(sig)
        add_path(
            f"Inverter→Motor Phase {phase}",
            [_node("INV HV", pin), _node("MOT HV", pin)],
            ["bundle:transcript", "system:ts", f"signal:{sig}"],
            {"notes": f"Inverter→Motor 3-phase wire {phase}.", "wire_id": f"PHASE-{phase}"},
        )
    for pin in (1, 2):
        sig = "HVIL_LOOP"
        ensure_signal(sig)
        add_path(
            f"Inverter HVIL pin {pin} → Motor HVIL pin {pin}",
            [_node("INV HVIL", pin), _node("MOT HVIL", pin)],
            ["bundle:transcript", "system:ts", f"signal:{sig}"],
            {"notes": "Inverter↔Motor HVIL pigtail.", "wire_id": f"HVIL-IM-{pin}"},
        )

# ---------- 8f. HV Interlock daisy chain -----------------------------------

def add_hv_interlock_loop() -> None:
    """Chain HVIL: HV Connector (4/5) → Inverter HVIL → Motor HVIL → return →
    AIR aux switches → PCC J2.1 (/IL).
    """
    sig = "HVIL_LOOP"
    ensure_signal(sig)
    base = ["bundle:transcript", "system:ts", "signal:HVIL_LOOP"]
    # HV Connector pin 4 (HVIL+) → Inverter HVIL pin 1
    add_path(
        "HV Connector HVIL+ → Inverter HVIL +",
        [_node("HV Connector", 4), _node("INV HVIL", 1)],
        base, {"notes": "HVIL+ from accu HV connector to inverter."},
    )
    # Motor HVIL - returns through AIR+ aux switch (pin 3) into PCC J2.1
    add_path(
        "Motor HVIL - → AIR+ Aux Switch",
        [_node("MOT HVIL", 2), _node("Contactor_B+", 3)],
        base, {"notes": "HVIL return leg via AIR+ auxiliary switch contact."},
    )
    add_path(
        "AIR+ Aux Switch → AIR- Aux Switch",
        [_node("Contactor_B+", 3), _node("Contactor_B-", 3)],
        base, {"notes": "HVIL bridges across both AIR aux contacts (series interlock)."},
    )
    add_path(
        "AIR- Aux Switch → PCC J2.1 (/IL)",
        [_node("Contactor_B-", 3), _node("PCC J2", 1)],
        base, {"notes": "HVIL terminates at PCC J2 pin 1 (/IL)."},
    )
    # HV Connector pin 5 (HVIL-) → Motor HVIL pin 1 (loop completion across powertrain)
    add_path(
        "HV Connector HVIL- → Motor HVIL +",
        [_node("HV Connector", 5), _node("MOT HVIL", 1)],
        base, {"notes": "HVIL- from accu HV connector to motor (return leg)."},
    )

# ---------- 8g. PCC J11 Discharge Enable -----------------------------------

def add_discharge_enable_paths() -> None:
    base = ["bundle:Accu_Internal", "system:ts", "status:needs-verification"]
    ensure_signal("DISCH_ENABLE_12V")
    add_path(
        "PCC J11.1 → Precharge/Discharge LV +",
        [_node("PCC J11", 1), _node("Precharge/Discharge LV", 1)],
        base + ["signal:DISCH_ENABLE_12V"],
        {"notes": "Discharge-enable 12V from PCC J11 to Precharge/Discharge board."},
    )
    add_path(
        "PCC J11.2 → Precharge/Discharge LV GND",
        [_node("PCC J11", 2), _node("Precharge/Discharge LV", 2)],
        base, {"notes": "Discharge-enable GND."},
    )
    # Charge Board 12V Out pin 3 also enables discharge in the charging case (transcript).
    add_path(
        "Charge Board 12V Out.3 → Precharge/Discharge LV +",
        [_node("Charge Board 12V Out", 3), _node("Precharge/Discharge LV", 1)],
        base + ["system:charging", "signal:DISCH_ENABLE_12V"],
        {"notes": "Charge Board secondary discharge-enable feed (transcript)."},
    )

# ---------- 8h. Thermistor wiring ------------------------------------------

def add_thermistor_paths() -> None:
    """Map the CCM J17/J18 mate connectors → 4 thermistor pigtails.
    CCM CSV pin map:
      J17.1 = thermistor2+, J17.2 = thermistor1+, J17.3/4 = GND
      J18.1 = thermistor4+, J18.2 = thermistor3+, J18.3/4 = GND
    """
    base = ["bundle:CCM_internal", "system:cooling", "system:sensors"]
    # Signal pins: mate side -> thermistor pigtail signal (pin 1)
    sig_map = [
        ("CCM J17 Mate", 2, "Thermistor1-C1", "THERM1_PLUS"),
        ("CCM J17 Mate", 1, "Thermistor2-C1", "THERM2_PLUS"),
        ("CCM J18 Mate", 2, "Thermistor3-C1", "THERM3_PLUS"),
        ("CCM J18 Mate", 1, "Thermistor4-C1", "THERM4_PLUS"),
    ]
    for mate, mp, therm, sig in sig_map:
        ensure_signal(sig)
        add_path(
            f"{mate}.{mp} → {therm}.1",
            [_node(mate, mp), _node(therm, 1)],
            base + [f"signal:{sig}"],
            {"notes": f"Thermistor signal lead ({sig}).", "wire_id": f"{sig}"},
        )
    # Shared GND splice for the 4 thermistors. Created on demand here (instead of in §3)
    # because all references live within this function.
    if "thermistor_GND" not in MERGE_BY_KEY:
        add_merge("thermistor_GND", "Thermistor GND Splice", None,
                  ["bundle:CCM_internal", "system:cooling"],
                  "ATUM splice tying CCM J17/J18 GLV- pins to all 4 thermistor GND pigtails.")
    ensure_signal("GLV_MINUS")
    # CCM J17 mate pins 3 & 4 → splice
    for mp in (3, 4):
        add_path(f"CCM J17 Mate.{mp} → Thermistor GND splice",
                 [_node("CCM J17 Mate", mp), _mnode("thermistor_GND")],
                 base + ["signal:GLV_MINUS"],
                 {"notes": "Thermistor GND from CCM J17."})
    for mp in (3, 4):
        add_path(f"CCM J18 Mate.{mp} → Thermistor GND splice",
                 [_node("CCM J18 Mate", mp), _mnode("thermistor_GND")],
                 base + ["signal:GLV_MINUS"],
                 {"notes": "Thermistor GND from CCM J18."})
    # Splice → each thermistor GND (pin 2)
    for therm in ("Thermistor1-C1", "Thermistor2-C1", "Thermistor3-C1", "Thermistor4-C1"):
        add_path(f"Thermistor GND splice → {therm}.2",
                 [_mnode("thermistor_GND"), _node(therm, 2)],
                 base + ["signal:GLV_MINUS"],
                 {"notes": "Shared thermistor GND return."})

# ---------- 8i. Orion BMS Main 23p paths -----------------------------------

def add_orion_bms_main_paths() -> None:
    base = ["system:bms", "status:needs-verification"]
    pins = [
        (1, "ORION_12V_KEY",   None),
        (2, "ORION_12V_ALWAYS",None),
        (3, "GLV_MINUS",       None),
        (4, "CAN_BMS_H",       ("PCC J8", 1)),
        (5, "CAN_BMS_L",       ("PCC J8", 3)),
        (6, "ORION_CHG_ENABLE",("Charge Board 12V Out", 2)),
        (7, "ORION_DISCH_ENABLE", ("PCC J11", 1)),
        (8, "ORION_READY",     None),
    ]
    for pin, sig, dest in pins:
        ensure_signal(sig)
        if dest is None:
            continue
        dk, dp = dest
        if dk not in CONNECTOR_BY_KEY:
            continue
        add_path(
            f"Orion BMS Main.{pin} - {sig}",
            [_node("Orion BMS Main", pin), _node(dk, dp)],
            base + [f"signal:{sig}", "bundle:transcript"],
            {"notes": f"Orion BMS main 23p net {sig} (placeholder pinout).",
             "wire_id": f"ORION-{pin}"},
        )

# ---------- 9. Main --------------------------------------------------------

def main() -> None:
    # Validate all connector types exist in the library
    lib = json.loads(LIB_FILE.read_text())
    lib_types = {t["id"]: t for t in lib["connector_types"]}
    bad = []
    for c in CONNECTORS:
        if c["connector_type"] not in lib_types:
            bad.append((c["id"], c["name"], c["connector_type"]))
    if bad:
        print("ERROR: Unknown connector_type references:")
        for b in bad:
            print("  ", b)
        sys.exit(2)

    # Parse gigadoc
    gigadoc = (INPUT_DIR / "harness_gigadoc.txt").read_text()
    build_paths_from_harnesses(gigadoc)

    # Transcript extras
    add_transcript_extras()

    # Gap-fill: CCM CSV → mate connectors, AER xlsx PCB pinouts, HV phases/HVIL,
    # discharge enable, thermistors, Orion BMS main, then bulkhead bridges last.
    add_ccm_csv_paths()
    add_safety_board_csv_paths()
    add_pcc_internal_paths()
    add_inverter_motor_paths()
    add_hv_interlock_loop()
    add_discharge_enable_paths()
    add_thermistor_paths()
    add_orion_bms_main_paths()

    # Validation: pin_number <= pin_count
    pin_issues = []
    for p in PATHS:
        for node in p["nodes"]:
            if node["kind"] == "connector" and "pin_number" in node:
                cid = node["connector_id"]
                con = next(c for c in CONNECTORS if c["id"] == cid)
                ctype = lib_types[con["connector_type"]]
                pc = con.get("pin_count") or ctype.get("pin_count", 0)
                if pc > 0 and node["pin_number"] > pc:
                    pin_issues.append(
                        (p["id"], p["name"], con["name"], node["pin_number"], pc)
                    )
    if pin_issues:
        print("WARN: pin_number exceeds pin_count in", len(pin_issues), "cases (first 10):")
        for row in pin_issues[:10]:
            print("  ", row)

    harness = {
        "schema_version": "0.1.0",
        "enclosures": ENCLOSURES,
        "connectors": CONNECTORS,
        "mergePoints": MERGES,
        "paths": PATHS,
        "signals": sorted(SIGNALS.values(), key=lambda s: s["id"]),
    }

    OUT_HARNESS.parent.mkdir(parents=True, exist_ok=True)
    OUT_HARNESS.write_text(json.dumps(harness, indent=2) + "\n")

    # Split the flat staging file into the hierarchical sheeted format and
    # remove the staging file so only public/user-data/harnesses/fsae-2026/
    # remains. Refuses (non-zero exit) if the split doesn't round-trip
    # cleanly, in which case the staging file is left in place for inspection.
    result = subprocess.run(
        ["npx", "tsx", str(ROOT / "scripts" / "migrate-harness-to-sheets.ts"),
         HARNESS_NAME, ",".join(SHEET_ENCLOSURE_IDS)],
        cwd=ROOT,
    )
    if result.returncode != 0:
        print(f"\nERROR: sheet split failed -- flat staging file left at {OUT_HARNESS.relative_to(ROOT)} for inspection.")
        sys.exit(result.returncode)
    OUT_HARNESS.unlink()

    # Empty layout stub
    if not OUT_LAYOUT.exists():
        OUT_LAYOUT.write_text(json.dumps({
            "nodes": {},
            "ports": {},
            "sizes": {},
            "free": {},
            "backgrounds": {},
            "connectorTypeSizes": {},
            "textBoxes": {},
            "waypoints": {},
            "junctions": {},
            "mergePoints": {},
        }, indent=2) + "\n")

    print(f"Wrote public/user-data/harnesses/{HARNESS_NAME}/ (sheeted)")
    print(f"  enclosures: {len(ENCLOSURES)}")
    print(f"  connectors: {len(CONNECTORS)}")
    print(f"  merge pts : {len(MERGES)}")
    print(f"  paths     : {len(PATHS)}")
    print(f"  signals   : {len(SIGNALS)}")
    if UNRESOLVED:
        print(f"  UNRESOLVED designators ({len(UNRESOLVED)}):")
        for u in sorted(UNRESOLVED):
            print("    -", repr(u))

if __name__ == "__main__":
    main()
