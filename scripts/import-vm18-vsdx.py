#!/usr/bin/env python3
"""Import the VM18-X V3 Visio architecture as a VibeWire System.

The source drawing describes cable/bundle links between named interfaces, not
individual conductors. Each Visio connector line therefore becomes one
architecture-level VibeWire path. When more than one line lands on the same
interface shape, stable synthetic cavity numbers keep the topology structurally
valid without claiming that the source supplied a pinout.

The importer intentionally uses only Python's standard library so the checked-in
artifact can be regenerated without adding a project dependency.
"""

from __future__ import annotations

import json
import math
import posixpath
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
SOURCE_NAME = "VM18-X-JSR-V3-2026-MM-DD-Master-Arch.vsdx"
SOURCE_PATH = ROOT / SOURCE_NAME
HARNESS_KEY = "vm18-x-jsr-v3-2026"
HARNESS_NAME = "VM18-X JSR V3 — 2026 Master Architecture"
HARNESS_PATH = ROOT / "public" / "user-data" / "harnesses" / f"{HARNESS_KEY}.json"
LAYOUT_PATH = ROOT / "public" / "user-data" / f"layouts.{HARNESS_KEY}.json"
SUBSYSTEM_DIR = ROOT / "public" / "user-data" / "subsystems" / HARNESS_KEY

VISIO_NS = "http://schemas.microsoft.com/office/visio/2012/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"v": VISIO_NS, "r": REL_NS}

# VibeWire coordinates are pixels while Visio stores this drawing in inches.
# The complete source-map view retains the Visio geometry at a compact scale;
# the primary hierarchy and functional views use deterministic card layouts.
SOURCE_MAP_SCALE = 30.0
CARD_GAP_X = 180.0
CARD_GAP_Y = 90.0
FRAME_SIDE_GUTTER = 150.0
FRAME_TOP_GUTTER = 82.0

REGION_SHAPE_IDS = {
    "309",  # Port Fuel Tank Shelf
    "310",  # Starboard Fuel Tank Shelf
    "311",  # Main Stack Tank Shelf, primary architecture region
    "476",  # Main Stack Tank Shelf, switch/camera region
    "660",  # Payload Bay
}

# Visio region rectangles used only as physical-layout zones. They are not
# enclosures: equipment inside them lives at System root.
SHELF_REGION_IDS = {
    "309",
    "310",
    "311",
    "476",
}

REGION_DISPLAY_NAMES = {
    "309": "Port Fuel Tank Shelf",
    "310": "Starboard Fuel Tank Shelf",
    "311": "Main Stack — Core Systems",
    "476": "Main Stack — Network & Sensor Shelf",
    "660": "Payload Bay",
}

REGION_LOCATION_TAGS = {
    "309": "port-fuel-tank-shelf",
    "310": "starboard-fuel-tank-shelf",
    "311": "main-stack-core",
    "476": "main-stack-network-shelf",
    "660": "payload-bay",
}

# Source labels are intentionally retained in properties. These display names
# disambiguate duplicated labels when the architecture is viewed as a tree.
DISPLAY_NAME_OVERRIDES = {
    **REGION_DISPLAY_NAMES,
    "1": "Jetson Thor — Compute",
    "147": "12 V Battery A",
    "148": "12 V Battery B",
    "149": "24 V Battery A",
    "255": "24 V Battery B",
    "543": "24 V Clean Distribution — Core",
    "568": "24 V Clean Distribution — Network Shelf",
    "709": "GPS Antenna A — Port Side",
    "711": "GPS Antenna A — Main Stack",
    "718": "12 V Distribution — Core",
    "745": "12 V Distribution — Network Shelf",
    "793": "Jetson Thor — DTC",
}

# Notes that are present as standalone Visio annotations rather than shape data.
ENCLOSURE_SOURCE_NOTES = {
    "133": "Wire-level diagram or linked detail is still required.",
    "385": "Fuse-block ground connections also run through this fuse block.",
    "543": "Fuse-block ground connections also run through this fuse block.",
    "568": "Fuse-block ground connections also run through this fuse block.",
    "718": "Fuse-block ground connections also run through this fuse block.",
    "745": "Fuse-block ground connections also run through this fuse block.",
}

ENCLOSURE_DETAIL_PROPERTIES = {
    "44": {
        "source_function_labels": (
            "Steering [s61]; Bucket [s62]; Throttle [s63]; Engine Start [s64]; "
            "Ignition [s65]; Hatch [s66]"
        ),
    },
    "116": {
        "source_cable_labels": "Bucket Cable [s470]; Steering Cable [s471]",
    },
    "632": {
        "reserved_internal_port": (
            "LAN8 RJ45 [s641]; field-side LAN8 M12 8P X-Code is s650."
        ),
    },
    "663": {
        "source_can_topology_labels": (
            "CAN T-Bus [s671]; CAN T-Bus [s674]; Term [s677]. "
            "Labels are adjacent to the hatch-controller area in the source."
        ),
    },
}

ENCLOSURE_CONTEXT_NOTES = {
    "44": (
        "FC FUNCTION LABELS  ·  Steering  ·  Bucket  ·  Throttle  ·  "
        "Engine Start  ·  Ignition  ·  Hatch"
    ),
    "116": "SOURCE CABLE LABELS  ·  Bucket Cable  ·  Steering Cable",
    "632": (
        "RESERVED INTERNAL PORT  ·  LAN8 RJ45  ·  Field side: "
        "LAN8 M12 8P X-Code"
    ),
    "663": "CAN TOPOLOGY LABELS  ·  CAN T-Bus ×2  ·  Term",
}

# Domain names come from the "Power System Scratch" page in the source VSDX.
ENCLOSURE_POWER_DOMAINS = {
    "142": "24 V dirty — source, protection, and conversion",
    "385": "24 V dirty — main distribution",
    "543": "24 V clean — core systems",
    "568": "24 V clean — network shelf",
    "718": "12 V clean — core systems",
    "745": "12 V clean — network shelf",
    "146": "12 V engine power",
}

# Important equipment whose ports sit just beyond its rectangle, or which is
# intentionally present even though the final drawing does not connect it.
MANUAL_EQUIPMENT_SHAPE_IDS = {
    "83",   # Engine ignition relay
    "84",   # Engine start relay
    "113",  # CAN isolation DC-DC
    "114",  # CAN isolation module
    "146",  # Engine Power Box
    "261",  # 24 V to 24 V DC-DC
    "262",  # 24 V to 12 V DC-DC
    "386",  # Engine Power Switch
    "394",  # grouped Ethernet switch in Network Box
    "464",  # Bucket Actuator
    "465",  # Steering Actuator
    "466",  # Throttle Actuator
    "467",  # ARK CANNode in Control Box
    "632",  # grouped Ethernet switch in Switch Box
    "670",  # ARK CANNode / Teensy in Hatch Controller
    "709",  # GPS antenna assembly, port side
    "711",  # GPS antenna assembly, main-stack side
}

# These connected rectangles are pieces of equipment, not connector labels.
# They receive a virtual architecture interface so their Visio lines still have
# a concrete VibeWire endpoint.
CONNECTED_EQUIPMENT_SHAPE_IDS = {
    "146",  # Engine Power Box
    "147",  # 12 V Battery
    "148",  # 12 V Battery
    "149",  # 24 V Battery
    "255",  # 24 V Battery
    "263",  # Smart Shunt
    "305",  # Stack Power Switch
    "387",  # Stack Power Switch on Main Access Board
    "485",  # Master Fuse
    "661",  # Port Hatch Actuator
    "662",  # Starboard Hatch Actuator
    "685",  # Starlink
    "686",  # LTE Antenna A
    "687",  # LTE Antenna B
}

# Deliberately disconnected/reserved interfaces are still useful in the System.
UNCONNECTED_INTERFACE_SHAPE_IDS = {
    "14",   # USB-C hub port 4
    "46", "47", "48", "51", "52", "53", "54",  # unused Cube servo ports
    "59",   # Cube USB
    "67",   # Cube I2C
    "134",  # INS main Binder
    "197", "198", "199",  # converter RCA inputs
    "650",  # Switch Box LAN8
    "703", "706",  # RFD panel external halves
    "805", "808",  # DTC panel external halves
}

# The first child in each Visio group is the equipment body; the remaining
# children are its connector shapes.
GROUP_BODY_IDS = {"395", "633"}
GROUP_LABELS = {
    "394": "Ethernet Switch TSW202",
    "632": "Ethernet Switch TSW202",
}

# Explicit ownership for small ports which are drawn against (rather than
# strictly inside) their equipment rectangle.
INTERFACE_OWNER_OVERRIDES = {
    "85": "83",
    "87": "83",
    "86": "84",
    "88": "84",
    "197": "15",
    "198": "21",
    "199": "25",
    "268": "261",
    "269": "261",
    "270": "261",
    "271": "261",
    "272": "262",
    "273": "262",
    "274": "262",
    "275": "262",
    "134": "133",
    "468": "467",
    "469": "467",
    "472": "467",
    "664": "663",
    "665": "663",
    "668": "663",
    "669": "663",
    "672": "663",
    "673": "663",
    "675": "663",
    "702": "699",
    "703": "699",
    "705": "704",
    "706": "704",
    "710": "709",
    "712": "711",
    "804": "803",
    "805": "803",
    "807": "806",
    "808": "806",
}

ANNOTATION_PREFIXES = (
    "Color Code:",
    "Needs wire diagram",
    "Fuse Block GND connections",
)

COLOR_CLASS = {
    "#ff0000": ("power", "Power"),
    "#000000": ("power", "Power return"),
    "#00b0f0": ("ethernet", "Ethernet"),
    "#7e649e": ("can-control", "CAN / powered telemetry"),
    "#31859b": ("usb", "USB"),
    "#789440": ("control", "Power / analog control"),
    "#54426a": ("serial", "Power / serial"),
    "#7f6000": ("video", "Analog camera video"),
    "#bf9000": ("rf", "GNSS antenna"),
    "#ffc000": ("rf", "Radio antenna"),
    "#0070c0": ("sim", "SIM"),
    "INHERITED": ("control", "Control / telemetry"),
}

DIAGRAM_WIRE_COLORS = {
    "#ff0000": "red",
    "#000000": "black",
    "#00b0f0": "light blue",
    "#7e649e": "purple",
    "#31859b": "blue",
    "#789440": "green",
    "#54426a": "purple",
    "#7f6000": "brown",
    "#bf9000": "yellow",
    "#ffc000": "orange",
    "#0070c0": "blue",
    "#ffd965": "yellow",
    "INHERITED": "grey",
}

CATEGORY_PREFERRED_COLORS = {
    "power": "red",
    "power-return": "black",
    "ethernet": "light blue",
    "can-control": "purple",
    "control": "green",
    "serial": "purple",
    "usb": "blue",
    "video": "brown",
    "rf": "yellow",
    "sim": "blue",
}

CATEGORY_DETAILS = {
    "power": (
        "Power",
        "Architecture-level power cable or distribution segment.",
    ),
    "power-return": (
        "Power return",
        "Architecture-level ground or power-return segment.",
    ),
    "ethernet": (
        "Ethernet",
        "Ethernet network link; connector text retains RJ45/M12 details.",
    ),
    "can-control": (
        "CAN / powered telemetry",
        "CAN or powered telemetry link from the Visio color convention.",
    ),
    "control": (
        "Analog / mixed control",
        "Mixed power, analog, actuator, or control harness.",
    ),
    "serial": (
        "Serial telemetry",
        "Powered serial/telemetry connection.",
    ),
    "usb": (
        "USB",
        "USB connection, including sealed panel conversion.",
    ),
    "video": (
        "Analog video",
        "Analog camera/video connection.",
    ),
    "rf": (
        "RF / antenna",
        "GNSS, radio, Wi-Fi, LTE, or other coaxial antenna connection.",
    ),
    "sim": (
        "SIM",
        "SIM-card extension connection.",
    ),
}


@dataclass(frozen=True)
class Shape:
    id: str
    text: str
    name_u: str
    source_parent_id: str | None
    is_group: bool
    is_line: bool
    x: float
    y: float
    w: float
    h: float
    cells: dict[str, str]

    @property
    def area(self) -> float:
        return self.w * self.h

    @property
    def left(self) -> float:
        return self.x - self.w / 2

    @property
    def right(self) -> float:
        return self.x + self.w / 2

    @property
    def bottom(self) -> float:
        return self.y - self.h / 2

    @property
    def top(self) -> float:
        return self.y + self.h / 2


@dataclass(frozen=True)
class Cable:
    shape_id: str
    begin_target_id: str
    end_target_id: str
    color: str
    category: str
    cable_class: str


def numeric_id(value: str) -> tuple[int, str]:
    return (int(value), value) if value.isdigit() else (sys.maxsize, value)


def shape_text(element: ET.Element) -> str:
    text_element = element.find("v:Text", NS)
    if text_element is None:
        return ""
    return re.sub(r"\s+", " ", "".join(text_element.itertext())).strip()


def shape_cells(element: ET.Element) -> dict[str, str]:
    return {
        cell.attrib["N"]: cell.attrib.get("V", "")
        for cell in element.findall("v:Cell", NS)
        if "N" in cell.attrib
    }


def as_float(cells: dict[str, str], name: str, fallback: float = 0.0) -> float:
    try:
        return float(cells.get(name, fallback))
    except (TypeError, ValueError):
        return fallback


def transform_child_geometry(
    child_cells: dict[str, str],
    parent: Shape,
) -> tuple[float, float, float, float]:
    """Transform a Visio group child's local rectangle into page coordinates."""
    child_x = as_float(child_cells, "PinX")
    child_y = as_float(child_cells, "PinY")
    dx = child_x - as_float(parent.cells, "LocPinX", parent.w / 2)
    dy = child_y - as_float(parent.cells, "LocPinY", parent.h / 2)
    if parent.cells.get("FlipX") == "1":
        dx = -dx
    if parent.cells.get("FlipY") == "1":
        dy = -dy
    angle = as_float(parent.cells, "Angle")
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)
    x = parent.x + dx * cos_a - dy * sin_a
    y = parent.y + dx * sin_a + dy * cos_a
    return (
        x,
        y,
        abs(as_float(child_cells, "Width")),
        abs(as_float(child_cells, "Height")),
    )


def parse_shape(
    element: ET.Element,
    source_parent: Shape | None = None,
) -> Shape:
    cells = shape_cells(element)
    is_line = "BeginX" in cells and "EndX" in cells
    if source_parent is None:
        x = as_float(cells, "PinX")
        y = as_float(cells, "PinY")
        w = abs(as_float(cells, "Width"))
        h = abs(as_float(cells, "Height"))
    else:
        x, y, w, h = transform_child_geometry(cells, source_parent)
    return Shape(
        id=element.attrib["ID"],
        text=shape_text(element),
        name_u=element.attrib.get("NameU", ""),
        source_parent_id=source_parent.id if source_parent else None,
        is_group=element.attrib.get("Type") == "Group",
        is_line=is_line,
        x=x,
        y=y,
        w=w,
        h=h,
        cells=cells,
    )


def v3_page_path(archive: zipfile.ZipFile) -> str:
    pages = ET.fromstring(archive.read("visio/pages/pages.xml"))
    relationships = ET.fromstring(
        archive.read("visio/pages/_rels/pages.xml.rels")
    )
    relationship_targets = {
        relationship.attrib["Id"]: posixpath.normpath(
            posixpath.join("visio/pages", relationship.attrib["Target"])
        )
        for relationship in relationships
    }
    for page in pages.findall("v:Page", NS):
        if page.attrib.get("NameU") != "V3" and page.attrib.get("Name") != "V3":
            continue
        relationship = page.find("v:Rel", NS)
        if relationship is None:
            break
        relationship_id = relationship.attrib[f"{{{REL_NS}}}id"]
        return relationship_targets[relationship_id]
    raise ValueError("The Visio document does not contain a V3 page")


def parse_visio() -> tuple[dict[str, Shape], list[Cable]]:
    if not SOURCE_PATH.exists():
        raise FileNotFoundError(f"Missing source Visio file: {SOURCE_PATH}")

    with zipfile.ZipFile(SOURCE_PATH) as archive:
        page_path = v3_page_path(archive)
        page = ET.fromstring(archive.read(page_path))

    shapes: dict[str, Shape] = {}
    top_level_elements = page.findall("./v:Shapes/v:Shape", NS)
    for element in top_level_elements:
        shape = parse_shape(element)
        if shape.id in GROUP_LABELS:
            shape = replace(shape, text=GROUP_LABELS[shape.id])
        shapes[shape.id] = shape
        for child_element in element.findall("./v:Shapes/v:Shape", NS):
            child = parse_shape(child_element, shape)
            shapes[child.id] = child

    connects_by_line: dict[str, list[dict[str, str]]] = defaultdict(list)
    for connection in page.findall("./v:Connects/v:Connect", NS):
        connects_by_line[connection.attrib["FromSheet"]].append(connection.attrib)

    cables: list[Cable] = []
    for line_id, connections in sorted(
        connects_by_line.items(), key=lambda item: numeric_id(item[0])
    ):
        if len(connections) != 2:
            continue
        by_cell = {connection.get("FromCell", ""): connection for connection in connections}
        begin = by_cell.get("BeginX")
        end = by_cell.get("EndX")
        if not begin or not end:
            ordered = sorted(connections, key=lambda item: item.get("FromCell", ""))
            begin, end = ordered
        line = shapes[line_id]
        color = line.cells.get("LineColor", "INHERITED").lower()
        if color in {"", "inherited"}:
            color = "INHERITED"
        begin_shape = shapes[begin["ToSheet"]]
        end_shape = shapes[end["ToSheet"]]
        category, cable_class = classify_cable(color, begin_shape.text, end_shape.text)
        cables.append(
            Cable(
                shape_id=line_id,
                begin_target_id=begin["ToSheet"],
                end_target_id=end["ToSheet"],
                color=color,
                category=category,
                cable_class=cable_class,
            )
        )
    return shapes, cables


def classify_cable(color: str, begin_text: str, end_text: str) -> tuple[str, str]:
    labels = f"{begin_text} {end_text}".lower()
    if color in {"#789440", "#ffd965", "INHERITED"} and any(
        token in labels for token in ("can", "telem", "sbus", "com4")
    ):
        return "can-control", "CAN / serial telemetry (label-derived)"
    if color == "#ffd965":
        if any(token in labels for token in ("sma", "tnc", "antenna", "wifi", "lte")):
            return "rf", "RF / antenna adapter"
        if any(token in labels for token in ("bnc", "rca", "video", "camera")):
            return "video", "Analog video adapter"
        return "control", "Mixed control harness"
    return COLOR_CLASS.get(color, ("control", "Architecture connection"))


def overlap_area(left: Shape, right: Shape) -> float:
    width = max(0.0, min(left.right, right.right) - max(left.left, right.left))
    height = max(0.0, min(left.top, right.top) - max(left.bottom, right.bottom))
    return width * height


def meaningfully_contains(owner: Shape, child: Shape) -> bool:
    if owner.area <= child.area * 1.05:
        return False
    center_inside = (
        owner.left - 0.05 <= child.x <= owner.right + 0.05
        and owner.bottom - 0.05 <= child.y <= owner.top + 0.05
    )
    overlap_fraction = overlap_area(owner, child) / child.area if child.area else 0.0
    return center_inside or overlap_fraction >= 0.10


def is_annotation(shape: Shape) -> bool:
    return not shape.text or shape.text.startswith(ANNOTATION_PREFIXES)


def infer_equipment_shape_ids(
    shapes: dict[str, Shape],
    cables: list[Cable],
) -> set[str]:
    endpoint_ids = {
        endpoint_id
        for cable in cables
        for endpoint_id in (cable.begin_target_id, cable.end_target_id)
    }
    equipment_ids = (
        set(REGION_SHAPE_IDS)
        | set(MANUAL_EQUIPMENT_SHAPE_IDS)
        | set(CONNECTED_EQUIPMENT_SHAPE_IDS)
    )

    for shape in shapes.values():
        if (
            shape.is_line
            or shape.source_parent_id is not None
            or shape.id in GROUP_BODY_IDS
            or is_annotation(shape)
            or shape.area <= 0
        ):
            continue
        for endpoint_id in endpoint_ids:
            endpoint = shapes[endpoint_id]
            if endpoint.id == shape.id or endpoint.area >= shape.area * 0.8:
                continue
            if meaningfully_contains(shape, endpoint):
                equipment_ids.add(shape.id)
                break

    missing = sorted(shape_id for shape_id in equipment_ids if shape_id not in shapes)
    if missing:
        raise ValueError(f"Configured equipment shapes are missing: {missing}")
    return equipment_ids


def infer_equipment_parents(
    shapes: dict[str, Shape],
    equipment_ids: set[str],
) -> dict[str, str | None]:
    parents: dict[str, str | None] = {}
    for equipment_id in equipment_ids:
        child = shapes[equipment_id]
        candidates = [
            shapes[candidate_id]
            for candidate_id in equipment_ids
            if candidate_id != equipment_id
            and shapes[candidate_id].area > child.area * 1.10
            and (
                shapes[candidate_id].left - 0.05
                <= child.x
                <= shapes[candidate_id].right + 0.05
            )
            and (
                shapes[candidate_id].bottom - 0.05
                <= child.y
                <= shapes[candidate_id].top + 0.05
            )
        ]
        parents[equipment_id] = (
            min(candidates, key=lambda candidate: candidate.area).id
            if candidates
            else None
        )
    return parents


def infer_interface_owner(
    interface: Shape,
    shapes: dict[str, Shape],
    equipment_ids: set[str],
) -> str | None:
    override = INTERFACE_OWNER_OVERRIDES.get(interface.id)
    if override:
        return override
    if interface.source_parent_id in equipment_ids:
        return interface.source_parent_id
    candidates = [
        shapes[equipment_id]
        for equipment_id in equipment_ids
        if equipment_id != interface.id
        and meaningfully_contains(shapes[equipment_id], interface)
    ]
    return min(candidates, key=lambda candidate: candidate.area).id if candidates else None


def is_container_equipment(
    shape: Shape,
    equipment_parents: dict[str, str | None],
) -> bool:
    if shape.id in REGION_SHAPE_IDS:
        return True
    if any(parent_id == shape.id for parent_id in equipment_parents.values()):
        return True
    return bool(
        re.search(r"\b(Box|Panel|Bay|Shelf|Board)\b", shape.text, re.IGNORECASE)
        or shape.text == "CAN Isolation"
    )


def is_fuse_block_terminal(label: str) -> bool:
    normalized = label.lower()
    return "ring terminal" in normalized and (
        normalized.startswith("fuse ")
        or normalized.startswith("power in ring terminal")
    )


def fuse_block_id(parent_source_id: str) -> str:
    return f"enc_v3_fuse_s{parent_source_id}"


def fuse_block_shape(parent: Shape, terminal_shapes: list[Shape]) -> Shape:
    pad = 0.18
    left = min(shape.left for shape in terminal_shapes) - pad
    right = max(shape.right for shape in terminal_shapes) + pad
    bottom = min(shape.bottom for shape in terminal_shapes) - pad
    top = max(shape.top for shape in terminal_shapes) + pad
    inner_left = parent.left + 0.12
    inner_right = parent.right - 0.12
    inner_bottom = parent.bottom + 0.12
    inner_top = parent.top - 0.12
    left = max(inner_left, min(left, inner_right - 0.4))
    right = min(inner_right, max(right, left + 0.4))
    bottom = max(inner_bottom, min(bottom, inner_top - 0.4))
    top = min(inner_top, max(top, bottom + 0.4))
    return Shape(
        id=f"fuse-{parent.id}",
        text="Fuse Block",
        name_u="",
        source_parent_id=parent.id,
        is_group=False,
        is_line=False,
        x=(left + right) / 2,
        y=(bottom + top) / 2,
        w=max(0.4, right - left),
        h=max(0.4, top - bottom),
        cells={},
    )


def attach_synthesized_fuse_blocks(
    enclosures: list[dict],
    connectors: list[dict],
    enclosure_shape_by_id: dict[str, Shape],
    connector_shape_by_id: dict[str, Shape],
) -> None:
    """Move fuse studs onto a device inside the distribution box.

    Visio draws Fuse A–F and Power In ring terminals inside the distribution
    rectangle. Those studs land on the fuse block, not on the box wall; the
    Deutsch interfaces remain the bulkheads.
    """
    enclosure_by_id = {enclosure["id"]: enclosure for enclosure in enclosures}
    terminals_by_parent: dict[str, list[dict]] = defaultdict(list)
    for connector in connectors:
        parent_id = connector["parent"]
        if not parent_id or not is_fuse_block_terminal(connector["name"]):
            continue
        parent = enclosure_by_id.get(parent_id)
        if not parent or not parent["container"]:
            continue
        terminals_by_parent[parent_id].append(connector)

    for parent_id, terminals in sorted(terminals_by_parent.items()):
        parent = enclosure_by_id[parent_id]
        parent_source_id = parent["properties"]["source_shape_id"]
        entity_id = fuse_block_id(parent_source_id)
        dummy = fuse_block_shape(
            enclosure_shape_by_id[parent_id],
            [connector_shape_by_id[connector["id"]] for connector in terminals],
        )
        enclosure_shape_by_id[entity_id] = dummy
        location_tag = next(
            (tag for tag in parent["tags"] if tag.startswith("location:")),
            "location:external",
        )
        properties = {
            "source_file": SOURCE_NAME,
            "source_page": "V3",
            "source_shape_id": dummy.id,
            "source_label": "Fuse Block",
            "source_position_inches": f"{dummy.x:.4f},{dummy.y:.4f}",
            "location": parent["properties"]["location"],
            "functional_role": "power",
            "notes": (
                "Synthesized fuse block for ring terminals drawn inside the "
                "distribution box; those studs are device terminals, not box bulkheads."
            ),
        }
        if "power_domain" in parent["properties"]:
            properties["power_domain"] = parent["properties"]["power_domain"]
            if "power_domain_source" in parent["properties"]:
                properties["power_domain_source"] = parent["properties"][
                    "power_domain_source"
                ]
        enclosures.append(
            {
                "id": entity_id,
                "name": "Fuse Block",
                "parent": parent_id,
                "container": False,
                "tags": [
                    "source:visio-v3",
                    location_tag,
                    "role:power",
                ],
                "properties": properties,
            }
        )
        for connector in terminals:
            connector["parent"] = entity_id


def source_physical_pin_count(label: str) -> int | None:
    header_match = re.search(r"\b(\d+)\s*x\s*(\d+)\s*p\b", label, re.IGNORECASE)
    if header_match:
        return int(header_match.group(1)) * int(header_match.group(2))
    pin_match = re.search(r"(?<![\d.])(\d+)\s*[pP]\b", label)
    if pin_match:
        return int(pin_match.group(1))
    normalized = label.lower()
    if "binder series 723" in normalized and normalized.endswith("-24"):
        return 24
    if "rj45" in normalized or "ethernet" in normalized:
        return 8
    if "usb-c" in normalized:
        return 24
    if "usb-a" in normalized or normalized.startswith("usb "):
        return 4
    if "sim" in normalized:
        return 8
    if "ring terminal x2" in normalized:
        return 2
    if any(
        token in normalized
        for token in ("bnc", "rca", "sma", "tnc", "n-type", "ring terminal", "barrel jack")
    ):
        return 1
    if any(token in normalized for token in ("battery", "power box")):
        return 2
    return None


def parse_physical_pin_count(label: str, fallback: int) -> int:
    return max(fallback, source_physical_pin_count(label) or 1)


def connector_standard(label: str) -> str:
    normalized = label.lower()
    rules = (
        ("Deutsch DTP (provisional high-current series)", r"deu(?:tsch|tch).*\bthick\b"),
        ("Deutsch DT (provisional series)", r"deu(?:tsch|tch)"),
        ("M12 X-coded", r"\bm12\b.*\bx[- ]?code\b"),
        ("M12 A-coded", r"\bm12\b.*\ba[- ]?code\b"),
        ("RJ45 / 8P8C", r"\brj45\b"),
        ("USB-C", r"\busb-c\b"),
        ("USB-A", r"\busb-a\b"),
        ("JST-GH", r"\bjst-gh\b"),
        ("Molex CLIK-Mate", r"\bclik-mate\b"),
        ("Molex Micro-Fit 3.0", r"\bmicro-fit 3\.0\b"),
        ("Binder Series 723", r"\bbinder series 723\b"),
        ("RP-SMA", r"\brp-sma\b"),
        ("SMA", r"\bsma\b"),
        ("TNC", r"\btnc\b"),
        ("BNC", r"\bbnc\b"),
        ("RCA", r"\brca\b"),
        ("N-Type", r"\bn-type\b"),
        ("Ferrule terminal", r"\bferrul"),
        ("Ring terminal", r"\bring terminal\b"),
        ("2.54 mm header", r"2\.54\s*mm|\bpin header\b"),
        ("DC barrel jack", r"\bbarrel jack\b"),
        ("SIM", r"\bsim\d?\b"),
    )
    for name, pattern in rules:
        if re.search(pattern, normalized):
            return name
    return "Not identified in source"


def connector_type(label: str) -> tuple[str, str]:
    standard = connector_standard(label)
    if standard.startswith("Deutsch DTP"):
        return "deutsch_dtp", (
            "Source explicitly says Deutsch and “Thick”; DTP is a provisional "
            "high-current family selection pending part-number confirmation."
        )
    if standard.startswith("Deutsch DT"):
        return "deutsch_dt", (
            "Source explicitly says Deutsch; DT is the project default pending "
            "exact series and part-number confirmation."
        )
    return "generic_multipin", "Connector standard retained from source label."


def resolve_family_capacity(type_id: str, requested_count: int) -> int:
    supported = {
        "deutsch_dt": (2, 3, 4, 6, 8, 12),
        "deutsch_dtp": (2, 4),
    }.get(type_id)
    if not supported:
        return requested_count
    return next(
        (capacity for capacity in supported if capacity >= requested_count),
        requested_count,
    )


def connector_gender(label: str) -> str | None:
    normalized = label.lower()
    if re.search(r"\bf\s*[-<>/]\s*f\b", normalized):
        return "female-to-female adapter"
    if re.search(r"\bm\s*[-<>/]\s*f\b|\bf\s*[-<>/]\s*m\b", normalized):
        return "male-to-female adapter"
    if "female" in normalized or re.search(r"(?:^|[\s-])f\b", normalized):
        return "female"
    if "male" in normalized or re.search(r"(?:^|[\s-])m\b", normalized):
        return "male"
    return None


def normalize_display_label(label: str) -> str:
    """Correct known source typos while retaining the raw label in properties."""
    return re.sub(r"\bDeutch\b", "Deutsch", label, flags=re.IGNORECASE)


def interface_categories(label: str) -> set[str]:
    normalized = label.lower()
    categories: set[str] = set()
    if any(
        token in normalized
        for token in ("power", "pwr", "battery", "fuse", "dist ", "dc-dc", "24v", "12v")
    ):
        categories.add("power")
    if any(token in normalized for token in ("lan", "wan", "ethernet", "rj45", "poe")):
        categories.add("ethernet")
    if "sim" in normalized:
        categories.add("sim")
    if "usb" in normalized:
        categories.add("usb")
    if any(token in normalized for token in ("bnc", "rca", "video", "camera")):
        categories.add("video")
    if any(
        token in normalized
        for token in ("sma", "tnc", "antenna", "wifi", "lte", "gnss", "gps")
    ):
        categories.add("rf")
    if any(
        token in normalized
        for token in (
            "can",
            "telem",
            "servo",
            "sbus",
            "control",
            "ignition",
            "throttle",
            "i2c",
            "com4",
            "pin header",
        )
    ):
        categories.add("can-control")
    return categories


def functional_role(label: str) -> str:
    normalized = label.lower()
    if any(token in normalized for token in ("battery", "power", "fuse", "dc-dc", "shunt")):
        return "power"
    if any(token in normalized for token in ("network", "switch", "router", "starlink")):
        return "network / communications"
    if any(token in normalized for token in ("compute", "jetson", "usb-c hub")):
        return "compute"
    if any(token in normalized for token in ("cube", "control", "cannode", "relay")):
        return "control"
    if any(token in normalized for token in ("actuator", "rotax")):
        return "actuation / engine"
    if any(token in normalized for token in ("camera", "gnss", "gps", "ins", "airmar", "ptz")):
        return "sensor"
    if any(token in normalized for token in ("antenna", "rfd", "dtc")):
        return "radio / telemetry"
    if any(token in normalized for token in ("payload", "hatch")):
        return "payload"
    return "equipment / enclosure"


def infer_power_domain(begin_label: str, end_label: str) -> str | None:
    labels = f"{begin_label} {end_label}".lower()
    if "5v" in labels or "5 v" in labels:
        return "5 V local"
    if "12v" in labels or "12 v" in labels:
        return "12 V clean"
    if "24v clean" in labels or "24 v clean" in labels or "24v dist" in labels:
        return "24 V clean"
    if any(
        token in labels
        for token in (
            "24v battery",
            "24 v battery",
            "main power",
            "mp dist",
            "master fuse",
            "smart shunt",
            "stack power",
        )
    ):
        return "24 V dirty"
    return None


def enclosure_id(source_shape_id: str) -> str:
    return f"enc_v3_s{source_shape_id}"


def connector_id(source_shape_id: str, virtual: bool = False) -> str:
    suffix = "_interface" if virtual else ""
    return f"con_v3_s{source_shape_id}{suffix}"


def path_id(source_shape_id: str) -> str:
    return f"path_v3_s{source_shape_id}"


AUTO_BULKHEAD_REASON = "missing_enclosure_bulkhead"


def flatten_shelf_region_enclosures(system: dict) -> None:
    """Promote shelf-zone contents to harness root and drop the zone boxes.

    Port/starboard/network/core tank shelves are Visio layout regions, not
    physical boxes, so they must not parent equipment or grow bulkheads.
    """
    shelf_ids = {enclosure_id(source_id) for source_id in SHELF_REGION_IDS}
    for collection in ("enclosures", "connectors", "branchPoints"):
        for item in system[collection]:
            if item.get("parent") in shelf_ids:
                item["parent"] = None
    system["enclosures"] = [
        enclosure
        for enclosure in system["enclosures"]
        if enclosure["id"] not in shelf_ids
    ]


def stable_bulkhead_token(value: str) -> str:
    """Match the browser/server FNV-1a token used by bulkheadRouting.ts."""
    result = 0xCBF29CE484222325
    for character in value:
        result ^= ord(character)
        result = (result * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return f"{result:016x}"


def add_missing_bulkhead_placeholders(system: dict) -> list[str]:
    """Repair direct cross-enclosure paths, sharing one bulkhead per inner connector."""
    enclosure_by_id = {
        enclosure["id"]: enclosure for enclosure in system["enclosures"]
    }
    connector_by_id = {
        connector["id"]: connector for connector in system["connectors"]
    }
    all_ids = {
        entity["id"]
        for key in ("enclosures", "connectors", "branchPoints", "paths", "signals")
        for entity in system[key]
    }
    used_pins: dict[str, set[int]] = defaultdict(set)
    for path in system["paths"]:
        for node in path["nodes"]:
            if node["kind"] == "connector":
                used_pins[node["connector_id"]].add(node["pin_number"])

    grouped: dict[tuple[str, str], dict] = {}
    created: list[str] = []

    def container_chain(parent_id: str | None) -> list[str]:
        result: list[str] = []
        visited: set[str] = set()
        current_id = parent_id
        while current_id and current_id not in visited:
            visited.add(current_id)
            enclosure = enclosure_by_id[current_id]
            if enclosure["container"]:
                result.append(current_id)
            current_id = enclosure["parent"]
        return result

    def crossed_boundaries(
        from_connector: dict,
        to_connector: dict,
    ) -> tuple[list[str], list[str]]:
        from_chain = container_chain(from_connector["parent"])
        to_chain = container_chain(to_connector["parent"])
        common = next(
            (enclosure_id_value for enclosure_id_value in from_chain
             if enclosure_id_value in set(to_chain)),
            None,
        )
        from_crossed = (
            from_chain[:from_chain.index(common)]
            if common is not None
            else from_chain
        )
        to_crossed = (
            to_chain[:to_chain.index(common)]
            if common is not None
            else to_chain
        )
        return from_crossed, to_crossed

    def is_boundary_bulkhead(connector: dict, boundary_id: str) -> bool:
        return (
            connector["parent"] == boundary_id
            and connector.get("mounting") != "inline"
            and enclosure_by_id[boundary_id]["container"]
        )

    def ensure_group(
        boundary_id: str,
        anchor_connector_id: str,
        path: dict,
    ) -> dict:
        group_key = (boundary_id, f"connector:{anchor_connector_id}")
        if group_key in grouped:
            connector = grouped[group_key]
            connector["tags"] = sorted(set(
                connector["tags"]
                + [tag for tag in path["tags"] if tag.startswith("system:")]
            ))
            return connector

        base_id = (
            "con_auto_bulkhead_"
            + stable_bulkhead_token(f"{boundary_id}|connector:{anchor_connector_id}")
        )
        entity_id = base_id
        suffix = 2
        while entity_id in all_ids:
            entity_id = f"{base_id}_{suffix}"
            suffix += 1
        all_ids.add(entity_id)
        anchor = connector_by_id[anchor_connector_id]
        connector = {
            "id": entity_id,
            "name": f"Unresolved bulkhead — {anchor['name']}",
            "parent": boundary_id,
            "connector_type": "generic_multipin",
            "mounting": "bulkhead",
            "pin_count": 1,
            "tags": sorted(set([
                "generated",
                "unresolved",
                "bulkhead",
                *[tag for tag in path["tags"] if tag.startswith("system:")],
            ])),
            "properties": {
                "placeholder_reason": AUTO_BULKHEAD_REASON,
                "bulkhead_group_anchor": f"connector:{anchor_connector_id}",
                "generated_for_connector": anchor_connector_id,
                "generated_by_route": path["id"],
                "generated_by_routes": path["id"],
                "boundary_enclosure": boundary_id,
                "boundary_sheet": boundary_id,
                "boundary_name": enclosure_by_id[boundary_id]["name"],
            },
        }
        system["connectors"].append(connector)
        connector_by_id[entity_id] = connector
        grouped[group_key] = connector
        created.append(entity_id)
        return connector

    def allocate_node(connector: dict, path_id_value: str) -> dict:
        pin_number = 1
        while pin_number in used_pins[connector["id"]]:
            pin_number += 1
        used_pins[connector["id"]].add(pin_number)
        connector["pin_count"] = max(connector["pin_count"], pin_number)
        route_ids = set(
            connector["properties"].get("generated_by_routes", "").split(",")
        )
        route_ids.discard("")
        route_ids.add(path_id_value)
        connector["properties"]["generated_by_routes"] = ",".join(sorted(route_ids))
        return {
            "kind": "connector",
            "connector_id": connector["id"],
            "pin_number": pin_number,
        }

    for path in system["paths"]:
        original_nodes = list(path["nodes"])
        repaired_nodes = [original_nodes[0]]
        for index, from_node in enumerate(original_nodes[:-1]):
            to_node = original_nodes[index + 1]
            if from_node["kind"] != "connector" or to_node["kind"] != "connector":
                repaired_nodes.append(to_node)
                continue
            from_connector = connector_by_id[from_node["connector_id"]]
            to_connector = connector_by_id[to_node["connector_id"]]
            from_boundaries, to_boundaries = crossed_boundaries(
                from_connector,
                to_connector,
            )
            from_boundaries = [
                boundary_id for boundary_id in from_boundaries
                if not is_boundary_bulkhead(from_connector, boundary_id)
            ]
            to_boundaries = [
                boundary_id for boundary_id in to_boundaries
                if not is_boundary_bulkhead(to_connector, boundary_id)
            ]

            from_anchor_id = from_connector["id"]
            for boundary_id in from_boundaries:
                connector = ensure_group(boundary_id, from_anchor_id, path)
                repaired_nodes.append(allocate_node(connector, path["id"]))
                from_anchor_id = connector["id"]

            to_anchor_id = to_connector["id"]
            to_nodes_inside_out: list[dict] = []
            for boundary_id in to_boundaries:
                connector = ensure_group(boundary_id, to_anchor_id, path)
                to_nodes_inside_out.append(allocate_node(connector, path["id"]))
                to_anchor_id = connector["id"]
            repaired_nodes.extend(reversed(to_nodes_inside_out))
            repaired_nodes.append(to_node)
        path["nodes"] = repaired_nodes

    return created


def build_harness(
    shapes: dict[str, Shape],
    cables: list[Cable],
) -> tuple[
    dict,
    dict,
    dict[str, dict],
    dict[str, str],
    dict[str, str],
    dict[str, Shape],
]:
    endpoint_ids = {
        endpoint_id
        for cable in cables
        for endpoint_id in (cable.begin_target_id, cable.end_target_id)
    }
    incidents: dict[str, list[str]] = defaultdict(list)
    for cable in cables:
        incidents[cable.begin_target_id].append(cable.shape_id)
        incidents[cable.end_target_id].append(cable.shape_id)
    for line_ids in incidents.values():
        line_ids.sort(key=numeric_id)

    equipment_ids = infer_equipment_shape_ids(shapes, cables)
    equipment_parents = infer_equipment_parents(shapes, equipment_ids)
    container_by_source = {
        equipment_id: is_container_equipment(
            shapes[equipment_id], equipment_parents
        )
        for equipment_id in equipment_ids
    }

    interface_shape_ids = (
        endpoint_ids | set(UNCONNECTED_INTERFACE_SHAPE_IDS)
    ) - equipment_ids - GROUP_BODY_IDS
    interface_owner_source: dict[str, str | None] = {
        interface_id: infer_interface_owner(
            shapes[interface_id], shapes, equipment_ids
        )
        for interface_id in interface_shape_ids
    }

    enclosures: list[dict] = []
    enclosure_shape_by_id: dict[str, Shape] = {}
    for source_id in sorted(equipment_ids, key=numeric_id):
        shape = shapes[source_id]
        parent_source_id = equipment_parents[source_id]
        display_name = DISPLAY_NAME_OVERRIDES.get(source_id, shape.text)
        region_source_id: str | None = source_id if source_id in REGION_SHAPE_IDS else None
        ancestor_source_id = parent_source_id
        while region_source_id is None and ancestor_source_id is not None:
            if ancestor_source_id in REGION_SHAPE_IDS:
                region_source_id = ancestor_source_id
                break
            ancestor_source_id = equipment_parents[ancestor_source_id]
        location_tag = (
            REGION_LOCATION_TAGS[region_source_id]
            if region_source_id
            else "external"
        )
        role = functional_role(display_name)
        tags = [
            "source:visio-v3",
            f"location:{location_tag}",
            f"role:{slug(role)}",
        ]
        properties = {
            "source_file": SOURCE_NAME,
            "source_page": "V3",
            "source_shape_id": source_id,
            "source_label": shape.text,
            "source_position_inches": f"{shape.x:.4f},{shape.y:.4f}",
            "location": REGION_DISPLAY_NAMES.get(region_source_id, "External / distributed"),
            "functional_role": role,
            "notes": (
                "Imported from the V3 architecture page; the complete source-map "
                "view retains the Visio-relative geometry."
            ),
        }
        if source_id in ENCLOSURE_SOURCE_NOTES:
            properties["source_annotation"] = ENCLOSURE_SOURCE_NOTES[source_id]
        properties.update(ENCLOSURE_DETAIL_PROPERTIES.get(source_id, {}))
        if source_id in ENCLOSURE_POWER_DOMAINS:
            properties["power_domain"] = ENCLOSURE_POWER_DOMAINS[source_id]
            properties["power_domain_source"] = "Power System Scratch page"
        entity_id = enclosure_id(source_id)
        enclosure_shape_by_id[entity_id] = shape
        enclosures.append(
            {
                "id": entity_id,
                "name": display_name,
                "parent": enclosure_id(parent_source_id)
                if parent_source_id
                else None,
                "container": container_by_source[source_id],
                "tags": tags,
                "properties": properties,
            }
        )

    source_to_connector_id: dict[str, str] = {}
    connector_source_by_id: dict[str, str] = {}
    connector_shape_by_id: dict[str, Shape] = {}
    connectors: list[dict] = []

    def add_connector(
        source_id: str,
        label: str,
        parent_source_id: str | None,
        *,
        virtual: bool,
    ) -> None:
        display_label = normalize_display_label(label)
        degree = len(incidents.get(source_id, []))
        physical_pin_count = source_physical_pin_count(display_label)
        requested_capacity = parse_physical_pin_count(display_label, degree)
        type_id, type_basis = connector_type(display_label)
        pin_count = resolve_family_capacity(type_id, requested_capacity)
        standard = connector_standard(display_label)
        gender = connector_gender(display_label)
        entity_id = connector_id(source_id, virtual)
        parent_id = enclosure_id(parent_source_id) if parent_source_id else None
        tags = [
            "source:visio-v3",
            "status:architecture-only",
            "model:cable-level",
            f"standard:{slug(standard)}",
        ]
        if type_id.startswith("deutsch_"):
            tags.extend(["standard:deutsch", "status:verify-part-number"])
        if not degree:
            tags.append("status:reserved-or-unconnected")
        properties = {
            "source_file": SOURCE_NAME,
            "source_page": "V3",
            "source_shape_id": source_id,
            "source_interface_label": shapes[source_id].text,
            "source_position_inches": (
                f"{shapes[source_id].x:.4f},{shapes[source_id].y:.4f}"
            ),
            "connector_standard": standard,
            "connector_type_basis": type_basis,
            "architecture_slot_count": str(max(degree, 1)),
            "modeling_granularity": "cable-level architecture link",
            "pin_assignment_basis": (
                "Synthetic stable slot per Visio line; source drawing has no conductor pinout."
            ),
        }
        if physical_pin_count is not None:
            properties["source_physical_pin_count"] = str(physical_pin_count)
        if gender:
            properties["source_gender_or_adapter"] = gender
        if standard == "Binder Series 723":
            part_hint = re.search(r"#([0-9-]+)", display_label)
            if part_hint:
                properties["source_part_number_hint"] = part_hint.group(1)
        if source_id == "72":
            properties["source_representation_note"] = (
                "Connected Cube Box abstraction; a separate unconnected DC-DC "
                "equipment shape with the same label exists at source shape s113 "
                "under CAN Isolation. Confirm whether these represent one device."
            )
        if physical_pin_count is not None and degree > physical_pin_count:
            properties["modeled_capacity_note"] = (
                f"Source label specifies {physical_pin_count} physical positions, "
                f"but {degree} architecture lines land here. The model uses "
                f"{pin_count} synthetic slots; confirm the actual branching and pinout."
            )
            tags.append("status:multi-homed")
        elif pin_count != requested_capacity:
            properties["modeled_capacity_note"] = (
                f"Rounded from {requested_capacity} architecture slots to the "
                f"next supported {standard} housing size ({pin_count})."
            )
        connector: dict = {
            "id": entity_id,
            "name": display_label,
            "parent": parent_id,
            "connector_type": type_id,
            "pin_count": pin_count,
            "tags": tags,
            "properties": properties,
        }
        if parent_source_id in REGION_SHAPE_IDS:
            connector["mounting"] = "inline"
        source_to_connector_id[source_id] = entity_id
        connector_source_by_id[entity_id] = source_id
        connector_shape_by_id[entity_id] = shapes[source_id]
        connectors.append(connector)

    for source_id in sorted(interface_shape_ids, key=numeric_id):
        add_connector(
            source_id,
            shapes[source_id].text or f"Visio interface {source_id}",
            interface_owner_source[source_id],
            virtual=False,
        )

    for source_id in sorted(equipment_ids & endpoint_ids, key=numeric_id):
        shape = shapes[source_id]
        add_connector(
            source_id,
            f"{DISPLAY_NAME_OVERRIDES.get(source_id, shape.text)} — architecture interface",
            source_id,
            virtual=True,
        )

    attach_synthesized_fuse_blocks(
        enclosures,
        connectors,
        enclosure_shape_by_id,
        connector_shape_by_id,
    )

    wired_parent_ids = {
        connector["parent"]
        for connector in connectors
        if "status:reserved-or-unconnected" not in connector["tags"]
    }
    for enclosure in enclosures:
        source_id = enclosure["properties"]["source_shape_id"]
        if (
            source_id in MANUAL_EQUIPMENT_SHAPE_IDS
            and enclosure["id"] not in wired_parent_ids
        ):
            enclosure["tags"].append("status:drawn-not-wired")
            enclosure["properties"]["source_wiring_status"] = (
                "Equipment is drawn on V3 but has no connected interface in the source."
            )

    paths: list[dict] = []
    category_by_path_id: dict[str, str] = {}
    connector_by_id = {connector["id"]: connector for connector in connectors}
    enclosure_by_id = {enclosure["id"]: enclosure for enclosure in enclosures}

    def endpoint_pin(source_id: str, line_id: str) -> int:
        return incidents[source_id].index(line_id) + 1

    def qualified_endpoint(source_id: str) -> str:
        connector = connector_by_id[source_to_connector_id[source_id]]
        if connector["parent"]:
            parent = enclosure_by_id[connector["parent"]]
            if connector["name"].startswith(f"{parent['name']} —"):
                return parent["name"]
            return f"{parent['name']} / {connector['name']}"
        return connector["name"]

    for cable in cables:
        begin_connector_id = source_to_connector_id[cable.begin_target_id]
        end_connector_id = source_to_connector_id[cable.end_target_id]
        entity_id = path_id(cable.shape_id)
        signal_category = (
            "power-return" if cable.color == "#000000" else cable.category
        )
        signal_id = f"sig_arch_{signal_category.replace('-', '_')}"
        category_by_path_id[entity_id] = cable.category
        path_properties = {
            "source_file": SOURCE_NAME,
            "source_page": "V3",
            "source_shape_id": cable.shape_id,
            "architecture_connection_id": f"V3-L{cable.shape_id}",
            "cable_class": cable.cable_class,
            "source_legend_class": cable.cable_class,
            "diagram_color": cable.color,
            "wire_color": DIAGRAM_WIRE_COLORS.get(cable.color, "grey"),
            "modeling_granularity": "one path per Visio cable/bundle line",
            "pinout_status": "not specified in source",
            "notes": (
                "Architecture-level connection imported from Visio; "
                "verify conductors, cavities, gauge, and length before manufacture."
            ),
        }
        if cable.category == "power":
            power_domain = infer_power_domain(
                shapes[cable.begin_target_id].text,
                shapes[cable.end_target_id].text,
            )
            if power_domain:
                path_properties["power_domain"] = power_domain
                path_properties["power_domain_source"] = (
                    "V3 endpoint labels interpreted with the Power System Scratch page"
                )
        paths.append(
            {
                "id": entity_id,
                "name": (
                    f"{qualified_endpoint(cable.begin_target_id)} ↔ "
                    f"{qualified_endpoint(cable.end_target_id)}"
                ),
                "signal_id": signal_id,
                "tags": [
                    f"system:{cable.category}",
                    f"signal:arch_{signal_category.replace('-', '_')}",
                    "source:visio-v3",
                    "status:architecture-only",
                    "model:cable-level",
                ],
                "properties": path_properties,
                "nodes": [
                    {
                        "kind": "connector",
                        "connector_id": begin_connector_id,
                        "pin_number": endpoint_pin(
                            cable.begin_target_id, cable.shape_id
                        ),
                    },
                    {
                        "kind": "connector",
                        "connector_id": end_connector_id,
                        "pin_number": endpoint_pin(
                            cable.end_target_id, cable.shape_id
                        ),
                    },
                ],
                "measurements": [],
            }
        )

    categories_by_connector: dict[str, set[str]] = defaultdict(set)
    for path in paths:
        category = category_by_path_id[path["id"]]
        for node in path["nodes"]:
            categories_by_connector[node["connector_id"]].add(category)
    for connector in connectors:
        categories = categories_by_connector[connector["id"]]
        if not categories:
            categories = interface_categories(connector["name"])
        connector["tags"].extend(
            f"system:{category}" for category in sorted(categories)
        )

    categories_by_enclosure: dict[str, set[str]] = defaultdict(set)
    for connector in connectors:
        if not connector["parent"]:
            continue
        categories = {
            tag.removeprefix("system:")
            for tag in connector["tags"]
            if tag.startswith("system:")
        }
        current_id: str | None = connector["parent"]
        while current_id:
            categories_by_enclosure[current_id].update(categories)
            current_id = enclosure_by_id[current_id]["parent"]
    for enclosure in enclosures:
        enclosure["tags"].extend(
            f"system:{category}"
            for category in sorted(categories_by_enclosure[enclosure["id"]])
        )

    used_signal_categories = {cable.category for cable in cables}
    if any(cable.color == "#000000" for cable in cables):
        used_signal_categories.add("power-return")
    signals = [
        {
            "id": f"sig_arch_{category.replace('-', '_')}",
            "name": name,
            "tags": [
                f"system:{'power' if category == 'power-return' else category}",
                "source:visio-v3",
                "model:cable-level",
            ],
            "properties": {
                "description": description,
                "modeling_granularity": "cable/bundle class, not conductor signal",
                "preferred_wire_color": CATEGORY_PREFERRED_COLORS[category],
            },
        }
        for category, (name, description) in CATEGORY_DETAILS.items()
        if category in used_signal_categories
    ]

    system = {
        "schema_version": "0.1.0",
        "name": HARNESS_NAME,
        "enclosures": enclosures,
        "connectors": connectors,
        "branchPoints": [],
        "paths": paths,
        "signals": signals,
        "signalPropertyDefinitions": [],
    }
    flatten_shelf_region_enclosures(system)
    add_missing_bulkhead_placeholders(system)

    layout = build_system_layout(
        system,
        enclosure_shape_by_id,
        connector_shape_by_id,
    )
    subsystems = build_subsystems(
        system,
        layout,
        category_by_path_id,
        enclosure_shape_by_id,
    )
    return (
        system,
        layout,
        subsystems,
        category_by_path_id,
        connector_source_by_id,
        enclosure_shape_by_id,
    )


def rendered_connector_size(connector: dict) -> tuple[float, float]:
    label_length = len(connector["name"])
    width = max(118.0, min(230.0, 86.0 + label_length * 3.7))
    return width, 42.0


def compact_enclosure_size(
    enclosure: dict,
    direct_connector_count: int,
) -> tuple[float, float]:
    if enclosure["container"]:
        slots_per_side = math.ceil(direct_connector_count / 2)
        return (
            400.0 if direct_connector_count <= 10 else 520.0,
            max(240.0, 108.0 + slots_per_side * 54.0),
        )
    columns = 2 if direct_connector_count > 4 else 1
    rows = math.ceil(direct_connector_count / columns) if direct_connector_count else 0
    return (
        430.0 if columns == 2 else 260.0,
        max(130.0, 78.0 + rows * 52.0),
    )


def pack_centered_grid(
    entity_ids: list[str],
    sizes: dict[str, dict[str, float]],
    *,
    columns: int,
    gap_x: float = CARD_GAP_X,
    gap_y: float = CARD_GAP_Y,
) -> dict[str, dict[str, float]]:
    if not entity_ids:
        return {}
    row_ids = [
        entity_ids[index : index + max(1, columns)]
        for index in range(0, len(entity_ids), max(1, columns))
    ]
    row_heights = [max(sizes[entity_id]["h"] for entity_id in row) for row in row_ids]
    total_height = sum(row_heights) + gap_y * max(0, len(row_ids) - 1)
    y = -total_height / 2
    positions: dict[str, dict[str, float]] = {}
    for row, row_height in zip(row_ids, row_heights):
        row_width = (
            sum(sizes[entity_id]["w"] for entity_id in row)
            + gap_x * max(0, len(row) - 1)
        )
        x = -row_width / 2
        for entity_id in row:
            positions[entity_id] = {"x": round(x, 3), "y": round(y, 3)}
            x += sizes[entity_id]["w"] + gap_x
        y += row_height + gap_y
    return positions


def text_box(
    box_id: str,
    context_key: str,
    x: float,
    y: float,
    w: float,
    h: float,
    text: str,
    *,
    bg_color: str,
    text_color: str,
    border_color: str,
    font_size: int,
    font_weight: str = "normal",
    text_align: str = "left",
) -> dict:
    return {
        "id": box_id,
        "contextKey": context_key,
        "x": x,
        "y": y,
        "w": w,
        "h": h,
        "text": text,
        "bgColor": bg_color,
        "textColor": text_color,
        "fontSize": font_size,
        "fontFamily": "sans",
        "fontWeight": font_weight,
        "textAlign": text_align,
        "borderColor": border_color,
        "borderWidth": 1,
        "borderRadius": 10,
        "opacity": 0.96,
        "padding": 14,
    }


def build_system_layout(
    system: dict,
    enclosure_shapes: dict[str, Shape],
    connector_shapes: dict[str, Shape],
) -> dict:
    enclosures = system["enclosures"]
    connectors = system["connectors"]
    enclosure_by_id = {enclosure["id"]: enclosure for enclosure in enclosures}
    children_by_parent: dict[str | None, list[dict]] = defaultdict(list)
    for enclosure in enclosures:
        children_by_parent[enclosure["parent"]].append(enclosure)

    nodes: dict[str, dict[str, float]] = {}
    sizes: dict[str, dict[str, float]] = {}
    ports: dict[str, dict[str, float]] = {}
    free: dict[str, dict[str, float]] = {}

    connectors_by_parent: dict[str | None, list[dict]] = defaultdict(list)
    for connector in connectors:
        connectors_by_parent[connector["parent"]].append(connector)

    for enclosure in enclosures:
        width, height = compact_enclosure_size(
            enclosure,
            len(connectors_by_parent[enclosure["id"]]),
        )
        sizes[enclosure["id"]] = {"w": round(width, 3), "h": round(height, 3)}

    for parent_id, siblings in children_by_parent.items():
        sibling_ids = [
            enclosure["id"]
            for enclosure in sorted(
                siblings,
                key=lambda item: (
                    -enclosure_shapes[item["id"]].y,
                    enclosure_shapes[item["id"]].x,
                    item["name"],
                ),
            )
        ]
        if not sibling_ids:
            continue
        if parent_id is None:
            root_rows = [
                ["enc_v3_s699", "enc_v3_s704", "enc_v3_s709", "enc_v3_s150", "enc_v3_s803", "enc_v3_s806"],
                ["enc_v3_s309", "enc_v3_s311", "enc_v3_s476", "enc_v3_s310", "enc_v3_s660"],
                ["enc_v3_s144", "enc_v3_s685", "enc_v3_s145", "enc_v3_s715", "enc_v3_s775"],
            ]
            y = -510.0
            for row in root_rows:
                present = [entity_id for entity_id in row if entity_id in sibling_ids]
                if not present:
                    continue
                row_positions = pack_centered_grid(
                    present,
                    sizes,
                    columns=len(present),
                    gap_x=110.0,
                    gap_y=0.0,
                )
                row_height = max(sizes[entity_id]["h"] for entity_id in present)
                for entity_id, position in row_positions.items():
                    nodes[entity_id] = {
                        "x": position["x"],
                        "y": round(y, 3),
                    }
                y += row_height + 125.0
            unplaced = [entity_id for entity_id in sibling_ids if entity_id not in nodes]
            nodes.update(pack_centered_grid(unplaced, sizes, columns=4))
            continue
        columns = min(3, max(1, math.ceil(math.sqrt(len(sibling_ids)))))
        nodes.update(pack_centered_grid(sibling_ids, sizes, columns=columns))

    def connector_shape(connector: dict) -> Shape:
        source_shape = connector_shapes.get(connector["id"])
        if source_shape is not None:
            return source_shape
        parent_id = connector["parent"]
        if parent_id and parent_id in enclosure_shapes:
            return enclosure_shapes[parent_id]
        raise ValueError(f"Missing source geometry for connector {connector['id']}")

    for connector in connectors:
        width, height = rendered_connector_size(connector)
        sizes[connector["id"]] = {"w": round(width, 3), "h": round(height, 3)}
        parent_id = connector["parent"]
        if parent_id:
            owner = enclosure_by_id[parent_id]
            owner_size = sizes[parent_id]
            siblings = sorted(
                connectors_by_parent[parent_id],
                key=lambda item: (
                    -connector_shape(item).y,
                    connector_shape(item).x,
                    item["name"],
                ),
            )
            connector_index = siblings.index(connector)
            if owner["container"]:
                left_count = math.ceil(len(siblings) / 2)
                on_left = connector_index < left_count
                side_index = connector_index if on_left else connector_index - left_count
                side_count = left_count if on_left else len(siblings) - left_count
                usable_height = max(42.0, owner_size["h"] - 82.0)
                step = usable_height / max(1, side_count)
                x = -width / 2 if on_left else owner_size["w"] - width / 2
                y = 58.0 + side_index * step
            else:
                columns = 2 if len(siblings) > 4 else 1
                column = connector_index % columns
                row = connector_index // columns
                column_width = (owner_size["w"] - 36.0) / columns
                x = 18.0 + column * column_width
                y = 70.0 + row * 52.0
            ports[connector["id"]] = {"x": round(x, 3), "y": round(y, 3)}
        else:
            free_index = connectors_by_parent[None].index(connector)
            free[connector["id"]] = {
                "x": round(-300.0 + (free_index % 4) * 250.0, 3),
                "y": round(720.0 + (free_index // 4) * 90.0, 3),
            }

    text_boxes = {
        "vm18-title": text_box(
            "vm18-title",
            "graph",
            -560.0,
            -770.0,
            1120.0,
            86.0,
            "VM18-X JSR V3 · 2026 MASTER ARCHITECTURE",
            bg_color="#111827",
            text_color="#f8fafc",
            border_color="#475569",
            font_size=24,
            font_weight="bold",
            text_align="center",
        ),
        "vm18-color-legend": text_box(
            "vm18-color-legend",
            "graph",
            -1500.0,
            -760.0,
            760.0,
            110.0,
            (
                "CABLE CLASSES  ·  Power—red/black  ·  Ethernet—light blue  ·  "
                "CAN/telemetry—purple  ·  USB—blue  ·  Control—green  ·  "
                "Video—brown  ·  RF—yellow/orange"
            ),
            bg_color="#151b2b",
            text_color="#cbd5e1",
            border_color="#334155",
            font_size=12,
        ),
        "vm18-model-note": text_box(
            "vm18-model-note",
            "graph",
            740.0,
            -760.0,
            760.0,
            110.0,
            (
                "ARCHITECTURE MODEL  ·  Each line is a cable/bundle relationship. "
                "Cavity slots are synthetic until conductor pinouts, gauges, and "
                "lengths are verified."
            ),
            bg_color="#2b2112",
            text_color="#fde68a",
            border_color="#92400e",
            font_size=12,
        ),
    }
    for source_id, note in ENCLOSURE_SOURCE_NOTES.items():
        context_key = enclosure_id(source_id)
        text_boxes[f"vm18-note-{source_id}"] = text_box(
            f"vm18-note-{source_id}",
            context_key,
            -300.0,
            -330.0,
            600.0,
            82.0,
            f"SOURCE NOTE  ·  {note}",
            bg_color="#2b2112",
            text_color="#fde68a",
            border_color="#92400e",
            font_size=12,
        )
    for source_id, note in ENCLOSURE_CONTEXT_NOTES.items():
        context_key = enclosure_id(source_id)
        text_boxes[f"vm18-detail-{source_id}"] = text_box(
            f"vm18-detail-{source_id}",
            context_key,
            -320.0,
            -330.0,
            640.0,
            82.0,
            note,
            bg_color="#10243a",
            text_color="#bae6fd",
            border_color="#0369a1",
            font_size=12,
        )

    return {
        "nodes": nodes,
        "ports": ports,
        "sizes": sizes,
        "free": free,
        "backgrounds": {},
        "connectorTypeSizes": {},
        "textBoxes": text_boxes,
        "waypoints": {},
        "sharedAnchors": {},
        "branchPoints": {},
        "rotations": {},
    }


def descendants(
    enclosure_ids: Iterable[str],
    enclosure_by_id: dict[str, dict],
) -> set[str]:
    selected = set(enclosure_ids)
    changed = True
    while changed:
        changed = False
        for enclosure in enclosure_by_id.values():
            if enclosure["parent"] in selected and enclosure["id"] not in selected:
                selected.add(enclosure["id"])
                changed = True
    return selected


def connector_ids_for_categories(
    system: dict,
    category_by_path_id: dict[str, str],
    categories: set[str],
) -> set[str]:
    connector_ids: set[str] = set()
    for path in system["paths"]:
        if category_by_path_id[path["id"]] not in categories:
            continue
        connector_ids.update(node["connector_id"] for node in path["nodes"])
    for connector in system["connectors"]:
        connector_categories = {
            tag.removeprefix("system:")
            for tag in connector["tags"]
            if tag.startswith("system:")
        }
        if connector_categories & categories:
            connector_ids.add(connector["id"])
    return connector_ids


def connector_ids_for_focus(
    system: dict,
    source_enclosure_ids: set[str],
) -> tuple[set[str], set[str]]:
    enclosure_by_id = {
        enclosure["id"]: enclosure for enclosure in system["enclosures"]
    }
    seed_enclosure_ids = descendants(
        {enclosure_id(source_id) for source_id in source_enclosure_ids},
        enclosure_by_id,
    )
    seed_connector_ids = {
        connector["id"]
        for connector in system["connectors"]
        if connector["parent"] in seed_enclosure_ids
    }
    selected_connector_ids = set(seed_connector_ids)
    for path in system["paths"]:
        path_connector_ids = {
            node["connector_id"]
            for node in path["nodes"]
            if node["kind"] == "connector"
        }
        if path_connector_ids & seed_connector_ids:
            selected_connector_ids.update(path_connector_ids)
    return selected_connector_ids, seed_enclosure_ids


def connector_module_id(
    connector_id_value: str,
    connector_by_id: dict[str, dict],
    enclosure_by_id: dict[str, dict],
) -> str:
    parent_id = connector_by_id[connector_id_value]["parent"]
    if parent_id is None:
        return connector_id_value
    region_ids = {enclosure_id(source_id) for source_id in REGION_SHAPE_IDS}
    current_id = parent_id
    while True:
        parent = enclosure_by_id[current_id]["parent"]
        if parent is None or parent in region_ids:
            return current_id
        current_id = parent


def connector_ids_for_architecture_overview(system: dict) -> set[str]:
    connector_by_id = {
        connector["id"]: connector for connector in system["connectors"]
    }
    enclosure_by_id = {
        enclosure["id"]: enclosure for enclosure in system["enclosures"]
    }
    selected: set[str] = set()
    for path in system["paths"]:
        path_connector_ids = [
            node["connector_id"]
            for node in path["nodes"]
            if node["kind"] == "connector"
        ]
        authored_connector_ids = [
            connector_id_value
            for connector_id_value in path_connector_ids
            if (
                connector_by_id[connector_id_value]["properties"].get(
                    "placeholder_reason"
                )
                != AUTO_BULKHEAD_REASON
            )
        ]
        if len(authored_connector_ids) < 2:
            continue
        first_module = connector_module_id(
            authored_connector_ids[0], connector_by_id, enclosure_by_id
        )
        second_module = connector_module_id(
            authored_connector_ids[-1], connector_by_id, enclosure_by_id
        )
        if first_module != second_module:
            selected.update(path_connector_ids)
    return selected


def build_subsystems(
    system: dict,
    layout: dict,
    category_by_path_id: dict[str, str],
    enclosure_shapes: dict[str, Shape],
) -> dict[str, dict]:
    connector_by_id = {
        connector["id"]: connector for connector in system["connectors"]
    }
    enclosure_by_id = {
        enclosure["id"]: enclosure for enclosure in system["enclosures"]
    }

    overview_connectors = connector_ids_for_architecture_overview(system)
    all_enclosures = set(enclosure_by_id)
    region_enclosures = {
        enclosure_id(source_id)
        for source_id in REGION_SHAPE_IDS
        if enclosure_id(source_id) in enclosure_by_id
    }
    power_connectors = connector_ids_for_categories(
        system, category_by_path_id, {"power"}
    )
    ethernet_connectors = connector_ids_for_categories(
        system, category_by_path_id, {"ethernet", "sim"}
    )
    control_connectors = connector_ids_for_categories(
        system,
        category_by_path_id,
        {"can-control", "control", "serial"},
    )
    usb_video_connectors = connector_ids_for_categories(
        system, category_by_path_id, {"usb", "video"}
    )
    rf_connectors = connector_ids_for_categories(
        system, category_by_path_id, {"rf", "sim"}
    )
    compute_connectors, compute_enclosures = connector_ids_for_focus(
        system, {"6", "393", "631", "788"}
    )
    control_focus_connectors, control_focus_enclosures = connector_ids_for_focus(
        system, {"43", "99", "109", "116", "133", "610", "663"}
    )
    cube_connectors, cube_enclosures = connector_ids_for_focus(system, {"43"})
    payload_connectors, payload_enclosures = connector_ids_for_focus(
        system, {"660", "663"}
    )
    engine_connectors, engine_enclosures = connector_ids_for_focus(
        system, {"83", "84", "144", "146", "386", "466", "467"}
    )

    specifications = [
        (
            "architecture-overview",
            "Architecture Overview",
            ["system:overview", "source:visio-v3"],
            overview_connectors,
            region_enclosures,
            "overview",
        ),
        (
            "complete-visio-connection-map",
            "Complete Visio Connection Map",
            ["system:overview", "source:visio-v3", "view:complete"],
            set(connector_by_id),
            all_enclosures,
            "source",
        ),
        (
            "power-distribution",
            "Power Distribution",
            ["system:power", "source:visio-v3"],
            power_connectors,
            set(),
            "functional",
        ),
        (
            "ethernet-network",
            "Ethernet Network",
            ["system:ethernet", "system:sim", "source:visio-v3"],
            ethernet_connectors,
            set(),
            "functional",
        ),
        (
            "can-control-telemetry",
            "CAN, Control & Telemetry",
            [
                "system:can-control",
                "system:control",
                "system:serial",
                "source:visio-v3",
            ],
            control_connectors,
            set(),
            "functional",
        ),
        (
            "usb-video",
            "USB & Video",
            ["system:usb", "system:video", "source:visio-v3"],
            usb_video_connectors,
            set(),
            "functional",
        ),
        (
            "rf-antennas",
            "RF, GNSS & Antennas",
            ["system:rf", "system:sim", "source:visio-v3"],
            rf_connectors,
            set(),
            "functional",
        ),
        (
            "compute-network-focus",
            "Compute & Network Focus",
            ["system:ethernet", "system:usb", "source:visio-v3"],
            compute_connectors,
            compute_enclosures,
            "functional",
        ),
        (
            "control-actuation-focus",
            "Control & Actuation Focus",
            ["system:can-control", "system:control", "source:visio-v3"],
            control_focus_connectors,
            control_focus_enclosures,
            "functional",
        ),
        (
            "cube-box-detail",
            "Cube Box Detail",
            ["system:can-control", "system:usb", "source:visio-v3"],
            cube_connectors,
            cube_enclosures,
            "functional",
        ),
        (
            "payload-hatches",
            "Payload & Hatches",
            ["system:control", "system:payload", "source:visio-v3"],
            payload_connectors,
            payload_enclosures,
            "functional",
        ),
        (
            "engine-system",
            "Engine System",
            ["system:control", "system:engine", "system:power", "source:visio-v3"],
            engine_connectors,
            engine_enclosures,
            "functional",
        ),
    ]

    documents: dict[str, dict] = {}
    for (
        view_id,
        name,
        tags,
        connector_ids,
        extra_enclosure_ids,
        layout_mode,
    ) in specifications:
        if layout_mode == "source":
            document = build_source_map_document(
                view_id,
                name,
                tags,
                connector_ids,
                extra_enclosure_ids,
                connector_by_id,
                enclosure_by_id,
                enclosure_shapes,
                layout,
            )
        else:
            document = build_organized_subsystem_document(
                view_id,
                name,
                tags,
                connector_ids,
                extra_enclosure_ids,
                connector_by_id,
                enclosure_by_id,
                layout,
                include_physical_regions=layout_mode == "overview",
                collapse_connectors=layout_mode == "overview",
            )
        documents[view_id] = document
    layout["waypoints"].update(build_subsystem_waypoints(system, documents))
    return documents


def included_enclosures_for_view(
    connector_ids: set[str],
    extra_enclosure_ids: set[str],
    connector_by_id: dict[str, dict],
    enclosure_by_id: dict[str, dict],
    *,
    include_physical_regions: bool,
) -> set[str]:
    region_ids = {enclosure_id(source_id) for source_id in REGION_SHAPE_IDS}
    included: set[str] = set()

    def include_chain(seed_id: str) -> None:
        current_id: str | None = seed_id
        while current_id:
            included.add(current_id)
            parent_id = enclosure_by_id[current_id]["parent"]
            if not include_physical_regions and parent_id in region_ids:
                break
            current_id = parent_id

    for connector_id_value in connector_ids:
        parent_id = connector_by_id[connector_id_value]["parent"]
        if parent_id:
            include_chain(parent_id)
    for enclosure_id_value in extra_enclosure_ids:
        include_chain(enclosure_id_value)
    return included


def source_map_enclosure_size(
    enclosure: dict,
    shape: Shape,
    system_layout: dict,
) -> tuple[float, float]:
    minimum = system_layout["sizes"][enclosure["id"]]
    if enclosure["container"]:
        return (
            max(minimum["w"], shape.w * SOURCE_MAP_SCALE),
            max(minimum["h"], shape.h * SOURCE_MAP_SCALE),
        )
    return (
        max(minimum["w"], shape.w * SOURCE_MAP_SCALE),
        max(minimum["h"], shape.h * SOURCE_MAP_SCALE),
    )


def build_source_map_document(
    view_id: str,
    name: str,
    tags: list[str],
    connector_ids: set[str],
    extra_enclosure_ids: set[str],
    connector_by_id: dict[str, dict],
    enclosure_by_id: dict[str, dict],
    enclosure_shapes: dict[str, Shape],
    layout: dict,
) -> dict:
    included_enclosure_ids = included_enclosures_for_view(
        connector_ids,
        extra_enclosure_ids,
        connector_by_id,
        enclosure_by_id,
        include_physical_regions=True,
    )

    frame_ids = {
        enclosure_id_value
        for enclosure_id_value in included_enclosure_ids
        if enclosure_by_id[enclosure_id_value]["container"]
    }
    device_ids = included_enclosure_ids - frame_ids
    root_entity_ids = [
        entity_id
        for entity_id in included_enclosure_ids
        if enclosure_by_id[entity_id]["parent"] is None
    ]
    entity_sizes = {
        entity_id: source_map_enclosure_size(
            enclosure_by_id[entity_id],
            enclosure_shapes[entity_id],
            layout,
        )
        for entity_id in included_enclosure_ids
    }
    raw_root_positions = {
        entity_id: {
            "x": enclosure_shapes[entity_id].left * SOURCE_MAP_SCALE,
            "y": -enclosure_shapes[entity_id].top * SOURCE_MAP_SCALE,
        }
        for entity_id in root_entity_ids
    }
    if raw_root_positions:
        min_x = min(position["x"] for position in raw_root_positions.values())
        min_y = min(position["y"] for position in raw_root_positions.values())
        max_x = max(
            raw_root_positions[entity_id]["x"] + entity_sizes[entity_id][0]
            for entity_id in root_entity_ids
        )
        max_y = max(
            raw_root_positions[entity_id]["y"] + entity_sizes[entity_id][1]
            for entity_id in root_entity_ids
        )
        root_center = {"x": (min_x + max_x) / 2, "y": (min_y + max_y) / 2}
    else:
        root_center = {"x": 0.0, "y": 0.0}

    def entity_layout(entity_id: str) -> dict[str, float]:
        entity = enclosure_by_id[entity_id]
        shape = enclosure_shapes[entity_id]
        width, height = entity_sizes[entity_id]
        if entity["parent"]:
            parent_shape = enclosure_shapes[entity["parent"]]
            x = (shape.left - parent_shape.left) * SOURCE_MAP_SCALE
            y = (parent_shape.top - shape.top) * SOURCE_MAP_SCALE
        else:
            x = raw_root_positions[entity_id]["x"] - root_center["x"]
            y = raw_root_positions[entity_id]["y"] - root_center["y"]
        return {
            "x": round(x, 3),
            "y": round(y, 3),
            "w": round(width, 3),
            "h": round(height, 3),
        }

    frames = {
        entity_id: entity_layout(entity_id)
        for entity_id in sorted(frame_ids)
    }
    devices = {
        entity_id: entity_layout(entity_id)
        for entity_id in sorted(device_ids)
    }
    connectors: dict[str, dict[str, float]] = {}
    for connector_id_value in sorted(connector_ids):
        connector = connector_by_id[connector_id_value]
        size = layout["sizes"][connector_id_value]
        if connector["parent"]:
            owner_id = connector["parent"]
            owner_shape = enclosure_shapes[owner_id]
            if (
                connector["properties"].get("placeholder_reason")
                == AUTO_BULKHEAD_REASON
            ):
                position = layout["ports"][connector_id_value]
            elif connector["properties"]["source_shape_id"] == owner_shape.id:
                position = {"x": 18.0, "y": 72.0}
            else:
                source_x, source_y = (
                    float(value)
                    for value in connector["properties"]
                    ["source_position_inches"]
                    .split(",")
                )
                position = {
                    "x": (source_x - owner_shape.left) * SOURCE_MAP_SCALE,
                    "y": (owner_shape.top - source_y) * SOURCE_MAP_SCALE,
                }
        else:
            position = layout["free"][connector_id_value]
        connectors[connector_id_value] = {
            "x": position["x"],
            "y": position["y"],
            "w": size["w"],
            "h": size["h"],
        }

    # Selected mode makes category views genuinely useful: a represented device
    # only exposes interfaces included by this view.
    device_connector_mode = {
        device_id: "selected" for device_id in sorted(device_ids)
    }
    return {
        "schema_version": "1.0.0",
        "id": view_id,
        "name": name,
        "tags": tags,
        "enclosures": frames,
        "devices": devices,
        "connectors": connectors,
        "device_connector_mode": device_connector_mode,
        "viewport": {"x": 0, "y": 0, "zoom": 0.08},
    }


def view_column_rank(view_id: str, enclosure: dict) -> int:
    source_id = enclosure["properties"]["source_shape_id"]
    name = enclosure["name"].lower()
    if view_id == "architecture-overview":
        overview_ranks = {
            "144": 0,
            "309": 0,
            "699": 1,
            "704": 1,
            "709": 1,
            "150": 1,
            "311": 1,
            "476": 2,
            "685": 2,
            "803": 2,
            "806": 2,
            "310": 3,
            "145": 3,
            "715": 4,
            "775": 4,
            "660": 4,
        }
        return overview_ranks.get(source_id, 2)
    if view_id == "power-distribution":
        if any(token in name for token in ("battery", "rotax", "alternator")):
            return 0
        if any(token in name for token in ("power box", "shunt", "master fuse", "dc-dc")):
            return 1
        if "distribution" in name or "main access" in name or "fuse block" in name:
            return 2
        return 3
    if view_id in {"ethernet-network", "compute-network-focus"}:
        if any(token in name for token in ("antenna", "starlink", "lte")):
            return 0
        if any(token in name for token in ("network", "router", "rfd box")):
            return 1
        if "switch box" in name:
            return 2
        if any(token in name for token in ("compute", "dtc", "jetson")):
            return 3
        return 4
    if view_id in {"can-control-telemetry", "control-actuation-focus"}:
        if any(token in name for token in ("ins", "gnss", "rfd", "gps")):
            return 0
        if any(token in name for token in ("cube", "can isolation", "control", "hatch controller")):
            return 1
        return 2
    if view_id == "usb-video":
        if any(token in name for token in ("camera", "ptz")):
            return 0
        if "video" in name:
            return 1
        return 2
    if view_id == "rf-antennas":
        if "antenna" in name:
            return 0
        if any(token in name for token in ("rfd", "router", "dtc", "gnss")):
            return 1
        return 2
    if view_id == "engine-system":
        if any(token in name for token in ("battery", "power")):
            return 0
        if any(token in name for token in ("cube", "relay", "control")):
            return 1
        return 2
    if view_id == "payload-hatches":
        if "controller" in name:
            return 0
        if "actuator" in name:
            return 1
        return 2
    return 1


def build_organized_subsystem_document(
    view_id: str,
    name: str,
    tags: list[str],
    connector_ids: set[str],
    extra_enclosure_ids: set[str],
    connector_by_id: dict[str, dict],
    enclosure_by_id: dict[str, dict],
    layout: dict,
    *,
    include_physical_regions: bool,
    collapse_connectors: bool,
) -> dict:
    included_enclosure_ids = included_enclosures_for_view(
        connector_ids,
        extra_enclosure_ids,
        connector_by_id,
        enclosure_by_id,
        include_physical_regions=include_physical_regions,
    )
    frame_ids = {
        entity_id
        for entity_id in included_enclosure_ids
        if enclosure_by_id[entity_id]["container"]
    }
    device_ids = included_enclosure_ids - frame_ids
    selected_connectors_by_parent: dict[str | None, list[str]] = defaultdict(list)
    for connector_id_value in connector_ids:
        selected_connectors_by_parent[connector_by_id[connector_id_value]["parent"]].append(
            connector_id_value
        )
    for connector_ids_for_parent in selected_connectors_by_parent.values():
        connector_ids_for_parent.sort(
            key=lambda connector_id_value: (
                connector_by_id[connector_id_value]["name"],
                connector_id_value,
            )
        )

    child_ids_by_parent: dict[str, list[str]] = defaultdict(list)
    for entity_id in included_enclosure_ids:
        parent_id = enclosure_by_id[entity_id]["parent"]
        if parent_id in frame_ids:
            child_ids_by_parent[parent_id].append(entity_id)

    entity_sizes: dict[str, dict[str, float]] = {}
    relative_positions: dict[str, dict[str, float]] = {}
    computing: set[str] = set()

    def compute_entity_size(entity_id: str) -> dict[str, float]:
        if entity_id in entity_sizes:
            return entity_sizes[entity_id]
        if entity_id in computing:
            raise ValueError(f"Cycle in enclosure hierarchy at {entity_id}")
        computing.add(entity_id)
        entity = enclosure_by_id[entity_id]
        direct_connector_ids = (
            []
            if collapse_connectors
            else selected_connectors_by_parent[entity_id]
        )
        if not entity["container"]:
            columns = 2 if len(direct_connector_ids) > 4 else 1
            rows = (
                math.ceil(len(direct_connector_ids) / columns)
                if direct_connector_ids
                else 0
            )
            max_connector_width = max(
                (
                    layout["sizes"][connector_id_value]["w"]
                    for connector_id_value in direct_connector_ids
                ),
                default=190.0,
            )
            size = {
                "w": max(260.0, columns * max_connector_width + (columns + 1) * 24.0),
                "h": max(132.0, 78.0 + rows * 54.0),
            }
            entity_sizes[entity_id] = size
            computing.remove(entity_id)
            return size

        children = sorted(
            child_ids_by_parent[entity_id],
            key=lambda child_id: (enclosure_by_id[child_id]["name"], child_id),
        )
        for child_id in children:
            compute_entity_size(child_id)
        child_columns = 3 if len(children) > 6 else 2 if len(children) > 1 else 1
        packed_children = pack_centered_grid(
            children,
            entity_sizes,
            columns=child_columns,
            gap_x=90.0,
            gap_y=72.0,
        )
        if packed_children:
            min_x = min(position["x"] for position in packed_children.values())
            min_y = min(position["y"] for position in packed_children.values())
            max_x = max(
                packed_children[child_id]["x"] + entity_sizes[child_id]["w"]
                for child_id in children
            )
            max_y = max(
                packed_children[child_id]["y"] + entity_sizes[child_id]["h"]
                for child_id in children
            )
            inner_width = max_x - min_x
            inner_height = max_y - min_y
        else:
            min_x = min_y = 0.0
            inner_width = 0.0
            inner_height = 0.0
        slots_per_side = math.ceil(len(direct_connector_ids) / 2)
        side_gutter = 88.0 if collapse_connectors else FRAME_SIDE_GUTTER
        top_gutter = 68.0 if collapse_connectors else FRAME_TOP_GUTTER
        frame_width = max(
            360.0 if collapse_connectors else 500.0,
            inner_width + side_gutter * 2,
        )
        frame_height = max(
            210.0 if collapse_connectors else 280.0,
            inner_height + top_gutter + 62.0,
            118.0 + slots_per_side * 58.0,
        )
        size = {"w": frame_width, "h": frame_height}
        entity_sizes[entity_id] = size
        for child_id, position in packed_children.items():
            relative_positions[child_id] = {
                "x": position["x"] - min_x + side_gutter,
                "y": position["y"] - min_y + top_gutter,
            }
        computing.remove(entity_id)
        return size

    for entity_id in sorted(included_enclosure_ids):
        compute_entity_size(entity_id)

    root_entity_ids = [
        entity_id
        for entity_id in included_enclosure_ids
        if enclosure_by_id[entity_id]["parent"] not in frame_ids
    ]
    roots_by_rank: dict[int, list[str]] = defaultdict(list)
    for entity_id in root_entity_ids:
        roots_by_rank[view_column_rank(view_id, enclosure_by_id[entity_id])].append(entity_id)
    for root_ids in roots_by_rank.values():
        root_ids.sort(key=lambda entity_id: (enclosure_by_id[entity_id]["name"], entity_id))

    rank_order = sorted(roots_by_rank)
    column_widths = {
        rank: max(entity_sizes[entity_id]["w"] for entity_id in roots_by_rank[rank])
        for rank in rank_order
    }
    column_heights = {
        rank: (
            sum(entity_sizes[entity_id]["h"] for entity_id in roots_by_rank[rank])
            + CARD_GAP_Y * max(0, len(roots_by_rank[rank]) - 1)
        )
        for rank in rank_order
    }
    total_width = sum(column_widths.values()) + 260.0 * max(0, len(rank_order) - 1)
    x = -total_width / 2
    root_positions: dict[str, dict[str, float]] = {}
    for rank in rank_order:
        root_ids = roots_by_rank[rank]
        column_height = column_heights[rank]
        y = -column_height / 2
        for entity_id in root_ids:
            root_positions[entity_id] = {
                "x": round(x + (column_widths[rank] - entity_sizes[entity_id]["w"]) / 2, 3),
                "y": round(y, 3),
            }
            y += entity_sizes[entity_id]["h"] + CARD_GAP_Y
        x += column_widths[rank] + 260.0
    maximum_height = max(column_heights.values(), default=600.0)
    default_zoom = round(
        max(
            0.08,
            min(
                0.7,
                760.0 / max(1.0, total_width + 420.0),
                560.0 / max(1.0, maximum_height + 360.0),
            ),
        ),
        3,
    )

    def entity_layout(entity_id: str) -> dict[str, float]:
        position = relative_positions.get(entity_id, root_positions.get(entity_id))
        if position is None:
            raise ValueError(f"Missing organized position for {entity_id} in {view_id}")
        size = entity_sizes[entity_id]
        return {
            "x": round(position["x"], 3),
            "y": round(position["y"], 3),
            "w": round(size["w"], 3),
            "h": round(size["h"], 3),
        }

    frames = {
        entity_id: entity_layout(entity_id)
        for entity_id in sorted(frame_ids)
    }
    devices = {
        entity_id: entity_layout(entity_id)
        for entity_id in sorted(device_ids)
    }
    connectors: dict[str, dict[str, float]] = {}
    for parent_id in sorted(
        selected_connectors_by_parent,
        key=lambda value: value or "",
    ):
        connector_ids_for_parent = selected_connectors_by_parent[parent_id]
        if parent_id is None:
            for index, connector_id_value in enumerate(connector_ids_for_parent):
                size = layout["sizes"][connector_id_value]
                connectors[connector_id_value] = {
                    "x": -360.0 + (index % 4) * 250.0,
                    "y": 680.0 + (index // 4) * 82.0,
                    "w": size["w"],
                    "h": size["h"],
                }
            continue
        owner = enclosure_by_id[parent_id]
        owner_size = entity_sizes[parent_id]
        if owner["container"]:
            left_count = math.ceil(len(connector_ids_for_parent) / 2)
            for index, connector_id_value in enumerate(connector_ids_for_parent):
                size = layout["sizes"][connector_id_value]
                on_left = index < left_count
                side_index = index if on_left else index - left_count
                side_count = (
                    left_count if on_left else len(connector_ids_for_parent) - left_count
                )
                usable_height = max(48.0, owner_size["h"] - 102.0)
                step = usable_height / max(1, side_count)
                connectors[connector_id_value] = {
                    "x": round(
                        -size["w"] / 2
                        if on_left
                        else owner_size["w"] - size["w"] / 2,
                        3,
                    ),
                    "y": round(66.0 + side_index * step, 3),
                    "w": size["w"],
                    "h": size["h"],
                }
        else:
            columns = 2 if len(connector_ids_for_parent) > 4 else 1
            column_width = (owner_size["w"] - 36.0) / columns
            for index, connector_id_value in enumerate(connector_ids_for_parent):
                size = layout["sizes"][connector_id_value]
                connectors[connector_id_value] = {
                    "x": round(18.0 + (index % columns) * column_width, 3),
                    "y": round(72.0 + (index // columns) * 54.0, 3),
                    "w": size["w"],
                    "h": size["h"],
                }

    return {
        "schema_version": "1.0.0",
        "id": view_id,
        "name": name,
        "tags": tags + ["layout:organized"],
        "enclosures": frames,
        "devices": devices,
        "connectors": connectors,
        "device_connector_mode": {
            device_id: "selected" for device_id in sorted(device_ids)
        },
        "collapse_connectors": collapse_connectors,
        "viewport": {
            "x": 0,
            "y": 0,
            "zoom": default_zoom,
        },
    }


ROUTE_LANE_GAP = 22.0
ROUTE_FAN_GAP = 9.0
ROUTE_STUB = 38.0
ROUTE_INTERVAL_PADDING = 48.0


def wire_appearance_key(path: dict) -> str:
    raw_color = path["properties"].get("wire_color", "grey")
    normalized = re.sub(
        r"\s+",
        " ",
        re.sub(r"[._-]", " ", raw_color.strip().lower()),
    ).strip()
    return f"wire:{normalized or 'grey'}"


def assign_parallel_routes(
    records: list[dict],
) -> dict[str, list[dict[str, float]]]:
    """Route edges in nearby, non-overlapping orthogonal lanes."""
    for horizontal in (True, False):
        oriented = [
            record for record in records if record["horizontal"] is horizontal
        ]
        lane_usage: dict[int, list[tuple[float, float]]] = defaultdict(list)
        for record in sorted(
            oriented,
            key=lambda item: (
                item["desired_lane"],
                min(item["source_main"], item["target_main"]),
                item["edge_id"],
            ),
        ):
            interval = tuple(
                sorted((record["source_main"], record["target_main"]))
            )
            base_slot = round(record["desired_lane"] / ROUTE_LANE_GAP)
            selected_slot: int | None = None
            for radius in range(len(oriented) + 1):
                candidates = (
                    [base_slot]
                    if radius == 0
                    else [base_slot + radius, base_slot - radius]
                )
                for candidate in candidates:
                    if all(
                        interval[1] + ROUTE_INTERVAL_PADDING < used[0]
                        or interval[0] > used[1] + ROUTE_INTERVAL_PADDING
                        for used in lane_usage[candidate]
                    ):
                        selected_slot = candidate
                        break
                if selected_slot is not None:
                    break
            if selected_slot is None:
                raise ValueError(f"Could not allocate a route lane for {record['edge_id']}")
            record["lane"] = selected_slot * ROUTE_LANE_GAP
            lane_usage[selected_slot].append(interval)

    incidences: dict[tuple[bool, str], list[tuple[float, str, str, dict]]] = (
        defaultdict(list)
    )
    for record in records:
        incidences[(record["horizontal"], record["source_key"])].append(
            (record["lane"], record["edge_id"], "source", record)
        )
        incidences[(record["horizontal"], record["target_key"])].append(
            (record["lane"], record["edge_id"], "target", record)
        )
    for entries in incidences.values():
        entries.sort(key=lambda item: (item[0], item[1], item[2]))
        midpoint = (len(entries) - 1) / 2
        for index, (_, _, endpoint, record) in enumerate(entries):
            offset_index = index - midpoint
            record[f"{endpoint}_fan"] = offset_index * ROUTE_FAN_GAP
            record[f"{endpoint}_stub"] = (
                ROUTE_STUB + abs(offset_index) * 5.0
            )

    routed: dict[str, list[dict[str, float]]] = {}
    for record in records:
        source_x, source_y = record["source"]
        target_x, target_y = record["target"]
        source_fan = record["source_fan"]
        target_fan = record["target_fan"]
        source_stub = record["source_stub"]
        target_stub = record["target_stub"]
        lane = record["lane"]
        if record["horizontal"]:
            direction = 1.0 if target_x >= source_x else -1.0
            points = [
                (source_x + direction * source_stub, source_y + source_fan),
                (source_x + direction * source_stub, lane),
                (target_x - direction * target_stub, lane),
                (target_x - direction * target_stub, target_y + target_fan),
            ]
        else:
            direction = 1.0 if target_y >= source_y else -1.0
            points = [
                (source_x + source_fan, source_y + direction * source_stub),
                (lane, source_y + direction * source_stub),
                (lane, target_y - direction * target_stub),
                (target_x + target_fan, target_y - direction * target_stub),
            ]
        routed[record["edge_id"]] = [
            {"x": round(x, 3), "y": round(y, 3)}
            for x, y in points
        ]
    return routed


def build_subsystem_waypoints(
    system: dict,
    documents: dict[str, dict],
) -> dict[str, list[dict[str, float]]]:
    enclosure_by_id = {
        enclosure["id"]: enclosure for enclosure in system["enclosures"]
    }
    connector_by_id = {
        connector["id"]: connector for connector in system["connectors"]
    }
    waypoints: dict[str, list[dict[str, float]]] = {}

    for view_id, document in documents.items():
        enclosure_layouts = {
            **document["enclosures"],
            **document["devices"],
        }
        absolute_cache: dict[str, tuple[float, float]] = {}

        def absolute_enclosure_position(entity_id: str) -> tuple[float, float]:
            if entity_id in absolute_cache:
                return absolute_cache[entity_id]
            item = enclosure_layouts[entity_id]
            x, y = item["x"], item["y"]
            parent_id = enclosure_by_id[entity_id]["parent"]
            if parent_id in document["enclosures"]:
                parent_x, parent_y = absolute_enclosure_position(parent_id)
                x += parent_x
                y += parent_y
            absolute_cache[entity_id] = (x, y)
            return x, y

        def enclosure_rect(entity_id: str) -> dict[str, float]:
            x, y = absolute_enclosure_position(entity_id)
            item = enclosure_layouts[entity_id]
            return {"x": x, "y": y, "w": item["w"], "h": item["h"]}

        def connector_center(connector_id_value: str) -> tuple[float, float]:
            connector_layout = document["connectors"][connector_id_value]
            parent_id = connector_by_id[connector_id_value]["parent"]
            if parent_id in enclosure_layouts:
                parent_x, parent_y = absolute_enclosure_position(parent_id)
            else:
                parent_x = parent_y = 0.0
            return (
                parent_x + connector_layout["x"] + connector_layout["w"] / 2,
                parent_y + connector_layout["y"] + connector_layout["h"] / 2,
            )

        records_by_id: dict[str, dict] = {}

        def graph_node_id(owner_id: str) -> str:
            prefix = (
                "__subframe_"
                if enclosure_by_id[owner_id]["container"]
                else "__subdevice_"
            )
            return f"{prefix}{owner_id}"

        def graph_parent_node_id(owner_id: str) -> str | None:
            parent_id = enclosure_by_id[owner_id]["parent"]
            return (
                f"__subframe_{parent_id}"
                if parent_id in document["enclosures"]
                else None
            )

        for path in system["paths"]:
            connector_segments = [
                (from_node["connector_id"], to_node["connector_id"])
                for from_node, to_node in zip(
                    path["nodes"],
                    path["nodes"][1:],
                )
                if (
                    from_node["kind"] == "connector"
                    and to_node["kind"] == "connector"
                )
            ]
            for first_connector_id, second_connector_id in connector_segments:
                if (
                    first_connector_id not in document["connectors"]
                    or second_connector_id not in document["connectors"]
                ):
                    continue

                if document.get("collapse_connectors"):
                    first_owner_id = connector_by_id[first_connector_id]["parent"]
                    second_owner_id = connector_by_id[second_connector_id]["parent"]
                    if (
                        first_owner_id not in enclosure_layouts
                        or second_owner_id not in enclosure_layouts
                    ):
                        continue
                    first_node_id = graph_node_id(first_owner_id)
                    second_node_id = graph_node_id(second_owner_id)
                    if (
                        first_node_id == second_node_id
                        or graph_parent_node_id(first_owner_id) == second_node_id
                        or graph_parent_node_id(second_owner_id) == first_node_id
                    ):
                        continue
                    sorted_node_ids = sorted((first_node_id, second_node_id))
                    edge_id = (
                        f"subsystem:{view_id}:equipment:"
                        f"{sorted_node_ids[0]}|{sorted_node_ids[1]}|"
                        f"{wire_appearance_key(path)}"
                    )
                    if edge_id in records_by_id:
                        continue
                    first_rect = enclosure_rect(first_owner_id)
                    second_rect = enclosure_rect(second_owner_id)
                    first_center = (
                        first_rect["x"] + first_rect["w"] / 2,
                        first_rect["y"] + first_rect["h"] / 2,
                    )
                    second_center = (
                        second_rect["x"] + second_rect["w"] / 2,
                        second_rect["y"] + second_rect["h"] / 2,
                    )
                    horizontal = (
                        abs(second_center[0] - first_center[0])
                        >= abs(second_center[1] - first_center[1])
                    )
                    first_precedes_second = (
                        first_center[0] <= second_center[0]
                        if horizontal
                        else first_center[1] <= second_center[1]
                    )
                    if first_precedes_second:
                        source_id, source_rect = first_node_id, first_rect
                        target_id, target_rect = second_node_id, second_rect
                    else:
                        source_id, source_rect = second_node_id, second_rect
                        target_id, target_rect = first_node_id, first_rect
                    if horizontal:
                        source = (
                            source_rect["x"] + source_rect["w"],
                            source_rect["y"] + source_rect["h"] / 2,
                        )
                        target = (
                            target_rect["x"],
                            target_rect["y"] + target_rect["h"] / 2,
                        )
                    else:
                        source = (
                            source_rect["x"] + source_rect["w"] / 2,
                            source_rect["y"] + source_rect["h"],
                        )
                        target = (
                            target_rect["x"] + target_rect["w"] / 2,
                            target_rect["y"],
                        )
                    source_key, target_key = source_id, target_id
                else:
                    first_id, second_id = sorted(
                        (first_connector_id, second_connector_id),
                        key=lambda connector_id_value: (
                            f"connector:{connector_id_value}@"
                        ),
                    )
                    edge_id = (
                        f"subsystem:{view_id}:bundle:"
                        f"connector:{first_id}|connector:{second_id}"
                    )
                    if edge_id in records_by_id:
                        continue
                    source = connector_center(first_id)
                    target = connector_center(second_id)
                    horizontal = (
                        abs(target[0] - source[0])
                        >= abs(target[1] - source[1])
                    )
                    source_key, target_key = first_id, second_id

                source_main = source[0] if horizontal else source[1]
                target_main = target[0] if horizontal else target[1]
                desired_lane = (
                    (source[1] + target[1]) / 2
                    if horizontal
                    else (source[0] + target[0]) / 2
                )
                records_by_id[edge_id] = {
                    "edge_id": edge_id,
                    "source": source,
                    "target": target,
                    "source_key": source_key,
                    "target_key": target_key,
                    "horizontal": horizontal,
                    "source_main": source_main,
                    "target_main": target_main,
                    "desired_lane": desired_lane,
                }

        waypoints.update(assign_parallel_routes(list(records_by_id.values())))
    return waypoints


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def enclosure_contains_id(
    enclosure_by_id: dict[str, dict],
    ancestor_id: str,
    node_id: str | None,
) -> bool:
    current = node_id
    while current:
        if current == ancestor_id:
            return True
        current = enclosure_by_id[current]["parent"]
    return False


def validate_generated(system: dict, cables: list[Cable]) -> None:
    if len(cables) != 172:
        raise ValueError(f"Expected 172 connected V3 lines, found {len(cables)}")
    if len(system["paths"]) != len(cables):
        raise ValueError("Not every connected V3 line produced a path")

    enclosure_ids = [entity["id"] for entity in system["enclosures"]]
    connector_ids = [entity["id"] for entity in system["connectors"]]
    path_ids = [entity["id"] for entity in system["paths"]]
    for label, ids in (
        ("enclosure", enclosure_ids),
        ("connector", connector_ids),
        ("path", path_ids),
    ):
        if len(ids) != len(set(ids)):
            raise ValueError(f"Duplicate {label} IDs in generated harness")

    enclosure_id_set = set(enclosure_ids)
    enclosure_by_id = {
        enclosure["id"]: enclosure for enclosure in system["enclosures"]
    }
    connector_by_id = {
        connector["id"]: connector for connector in system["connectors"]
    }
    signal_ids = {signal["id"] for signal in system["signals"]}
    path_by_source_id = {
        path["properties"]["source_shape_id"]: path for path in system["paths"]
    }
    for source_id in {"78", "495", "617", "618"}:
        if path_by_source_id[source_id]["signal_id"] != "sig_arch_can_control":
            raise ValueError(f"Label-derived CAN/telemetry line s{source_id} was misclassified")
    power_return_paths = [
        path
        for path in system["paths"]
        if path["properties"]["diagram_color"] == "#000000"
    ]
    if not power_return_paths or any(
        path["signal_id"] != "sig_arch_power_return"
        for path in power_return_paths
    ):
        raise ValueError("Black power-return lines must use sig_arch_power_return")
    if connector_by_id["con_v3_s509"]["properties"].get(
        "source_physical_pin_count"
    ) != "2":
        raise ValueError("Ring-terminal x2 source count was not retained")
    if connector_by_id["con_v3_s134"]["properties"].get(
        "source_part_number_hint"
    ) != "09-0497-90-24":
        raise ValueError("Binder Series 723 source part-number hint was not retained")
    fuse_blocks = [
        enclosure
        for enclosure in system["enclosures"]
        if enclosure["id"].startswith("enc_v3_fuse_s")
    ]
    if len(fuse_blocks) != 5:
        raise ValueError(f"Expected 5 synthesized fuse blocks, found {len(fuse_blocks)}")
    fuse_terminals = [
        connector
        for connector in system["connectors"]
        if is_fuse_block_terminal(connector["name"])
    ]
    if len(fuse_terminals) != 35:
        raise ValueError(
            f"Expected 35 fuse-block ring terminals, found {len(fuse_terminals)}"
        )
    for connector in fuse_terminals:
        parent = enclosure_by_id[connector["parent"]]
        if parent["container"] or not parent["id"].startswith("enc_v3_fuse_s"):
            raise ValueError(
                f"Fuse ring terminal {connector['id']} must mount on a fuse block, "
                f"not {parent['id']}"
            )
    for enclosure in system["enclosures"]:
        if enclosure["parent"] and enclosure["parent"] not in enclosure_id_set:
            raise ValueError(f"Missing parent for {enclosure['id']}")
    for connector in system["connectors"]:
        if connector["parent"] and connector["parent"] not in enclosure_id_set:
            raise ValueError(f"Missing parent for {connector['id']}")

    occupied: set[tuple[str, int]] = set()
    for path in system["paths"]:
        if path["signal_id"] not in signal_ids:
            raise ValueError(f"Missing signal for {path['id']}")
        if len(path["nodes"]) < 2:
            raise ValueError(f"Architecture path {path['id']} has fewer than two nodes")
        for node in path["nodes"]:
            connector = connector_by_id[node["connector_id"]]
            pin_number = node["pin_number"]
            if pin_number <= 0 or pin_number > connector["pin_count"]:
                raise ValueError(
                    f"{path['id']} uses invalid cavity {pin_number} on {connector['id']}"
                )
            occupancy_key = (connector["id"], pin_number)
            if occupancy_key in occupied:
                raise ValueError(f"Duplicate synthetic cavity use: {occupancy_key}")
            occupied.add(occupancy_key)


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    shapes, cables = parse_visio()
    system, layout, subsystems, *_ = build_harness(shapes, cables)
    validate_generated(system, cables)

    write_json(HARNESS_PATH, system)
    write_json(LAYOUT_PATH, layout)
    for subsystem_id, document in sorted(subsystems.items()):
        write_json(SUBSYSTEM_DIR / f"{subsystem_id}.json", document)

    connected_endpoint_ids = {
        endpoint_id
        for cable in cables
        for endpoint_id in (cable.begin_target_id, cable.end_target_id)
    }
    print(
        f"Imported V3: {len(system['enclosures'])} enclosures/devices, "
        f"{len(system['connectors'])} interfaces, {len(system['paths'])} paths, "
        f"{len(connected_endpoint_ids)} source endpoints, "
        f"{len(subsystems)} subsystem views."
    )
    print(HARNESS_PATH.relative_to(ROOT))
    print(LAYOUT_PATH.relative_to(ROOT))
    print(SUBSYSTEM_DIR.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
