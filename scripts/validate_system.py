#!/usr/bin/env python3
"""Standalone structural validator for a System.

Mirrors the checks in server/api.ts#validateSystemInternal without spinning up
Node. Reports:
  - missing connector/branch_point references in paths
  - pin_number > connector_type.pin_count or <= 0
  - connector.connector_type not in library
  - signal: tags with no matching signal entity
  - branch points with < 2 incident segments

Accepts either a system *name* (resolved against public/user-data/systems/,
then the legacy public/user-data/harnesses/ fallback, supporting both the
flat `<name>.json` format and the per-enclosure "sheet" directory format --
see server/sheets.ts) or a direct path to a flat system JSON file.

For sheeted Systems, this shells out to `scripts/print-assembled-system.ts`
(via `npx tsx`) to reuse the real assembler in server/sheets.ts instead of
reimplementing sheet-merging logic here.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SYSTEMS_DIR = ROOT / "public" / "user-data" / "systems"
LEGACY_SYSTEMS_DIR = ROOT / "public" / "user-data" / "harnesses"


def load_system(name_or_path: str) -> tuple[dict, str]:
    """Returns (system_dict, display_label). Prefers systems/, falls back to harnesses/."""
    as_path = Path(name_or_path)
    if as_path.suffix == ".json" and as_path.exists():
        return json.loads(as_path.read_text()), as_path.name

    for directory in (SYSTEMS_DIR, LEGACY_SYSTEMS_DIR):
        flat_file = directory / f"{name_or_path}.json"
        if flat_file.exists():
            return json.loads(flat_file.read_text()), str(flat_file.relative_to(ROOT))
        sheeted_dir = directory / name_or_path
        if (sheeted_dir / "root.json").exists():
            result = subprocess.run(
                ["npx", "tsx", str(ROOT / "scripts" / "print-assembled-system.ts"), name_or_path],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                print(f"Failed to assemble sheeted system '{name_or_path}':", file=sys.stderr)
                print(result.stderr, file=sys.stderr)
                sys.exit(1)
            return json.loads(result.stdout), f"{name_or_path}/ (sheeted)"

    print(
        f"No system found for '{name_or_path}' "
        f"(looked under {SYSTEMS_DIR.name}/ and {LEGACY_SYSTEMS_DIR.name}/)",
        file=sys.stderr,
    )
    sys.exit(1)


def hierarchy_of(system: dict) -> list[dict]:
    if isinstance(system.get("hierarchy"), list):
        return system["hierarchy"]
    if isinstance(system.get("enclosures"), list):
        return system["enclosures"]
    return []


def branch_points_of(system: dict) -> list[dict]:
    if isinstance(system.get("branchPoints"), list):
        return system["branchPoints"]
    if isinstance(system.get("mergePoints"), list):
        return system["mergePoints"]
    return []


def is_enclosure(entity: dict) -> bool:
    kind = entity.get("kind")
    if kind == "enclosure":
        return True
    if kind == "device":
        return False
    return entity.get("container") is not False


def main(name_or_path: str) -> int:
    system, label = load_system(name_or_path)
    lib = json.loads((ROOT / "public" / "user-data" / "connectors" / "connector-library.json").read_text())
    types = {t["id"]: t for t in lib["connector_types"]}
    connectors = {c["id"]: c for c in system["connectors"]}
    branch_points = {point["id"]: point for point in branch_points_of(system)}
    hierarchy = hierarchy_of(system)
    enclosures = {e["id"]: e for e in hierarchy}
    signal_ids = {s["id"] for s in system["signals"]}

    errors: list[str] = []
    warnings: list[str] = []

    def family_counts(connector_type: dict | None) -> list[int]:
        if not connector_type:
            return []
        return sorted({
            variant.get("pin_count")
            for variant in connector_type.get("cavity_variants", [])
            if isinstance(variant.get("pin_count"), int) and variant["pin_count"] > 0
        })

    def connector_capacity(connector: dict, connector_type: dict | None) -> int:
        counts = family_counts(connector_type)
        if counts:
            requested = connector.get("pin_count", counts[0])
            return next((count for count in counts if count >= requested), counts[-1])
        return max(connector.get("pin_count", 0), (connector_type or {}).get("pin_count", 0))

    # Enclosure parent refs
    for e in hierarchy:
        p = e.get("parent")
        if p and p not in enclosures:
            errors.append(f"Enclosure '{e['id']}' parent '{p}' missing")

    # Connector parent + type
    for c in system["connectors"]:
        p = c.get("parent")
        if p and p not in enclosures:
            errors.append(f"Connector '{c['id']}' parent '{p}' missing")
        mounting = c.get("mounting")
        if mounting not in (None, "inline", "bulkhead"):
            errors.append(f"Connector '{c['id']}' has invalid mounting {mounting!r}")
        if mounting == "bulkhead" and (
            not p or not is_enclosure(enclosures.get(p, {}))
        ):
            errors.append(
                f"Connector '{c['id']}' is marked bulkhead without a container parent"
            )
        t = c.get("connector_type")
        if t and t not in types:
            errors.append(f"Connector '{c['id']}' type '{t}' not in library")
            continue
        connector_type = types.get(t)
        counts = family_counts(connector_type)
        if counts:
            selected = c.get("pin_count")
            if selected not in counts:
                warnings.append(
                    f"Connector '{c['id']}' family '{t}' has unsupported cavity count {selected!r}"
                )
            keying = c.get("keying")
            if keying:
                variant = next(
                    (variant for variant in connector_type["cavity_variants"]
                     if variant.get("pin_count") == connector_capacity(c, connector_type)),
                    {},
                )
                if keying not in variant.get("keyings", []):
                    warnings.append(
                        f"Connector '{c['id']}' family '{t}' does not support key '{keying}' "
                        f"at {connector_capacity(c, connector_type)} cavities"
                    )

    # Branch Point parent
    for point in branch_points_of(system):
        p = point.get("parent")
        if p and p not in enclosures:
            errors.append(f"Branch point '{point['id']}' parent '{p}' missing")

    # Paths
    occupancy: dict[str, list[str]] = {}
    branch_point_incidents: dict[str, int] = {branch_point_id: 0 for branch_point_id in branch_points}
    for p in system["paths"]:
        pid = p["id"]
        if len(p["nodes"]) < 2:
            warnings.append(f"Path '{pid}' has <2 nodes")
        for node in p["nodes"]:
            if node["kind"] == "connector":
                cid = node["connector_id"]
                if cid not in connectors:
                    errors.append(f"Path '{pid}' references missing connector '{cid}'")
                    continue
                con = connectors[cid]
                t = types.get(con["connector_type"])
                pn = node.get("pin_number")
                if isinstance(pn, bool) or not isinstance(pn, int) or pn <= 0:
                    errors.append(
                        f"Path '{pid}' connector '{cid}' missing or invalid pin_number {pn!r}"
                    )
                    continue
                capacity = connector_capacity(con, t)
                if capacity and pn > capacity:
                    warnings.append(
                        f"Path '{pid}' connector '{cid}' pin {pn} > capacity {capacity}"
                    )
                key = f"{cid}:{pn}"
                occupancy.setdefault(key, []).append(pid)
            else:
                mid = node.get("branch_point_id") or node.get("merge_point_id")
                if mid not in branch_points:
                    errors.append(f"Path '{pid}' references missing branch point '{mid}'")
                else:
                    branch_point_incidents[mid] += 1

        signal_id = p.get("signal_id")
        if signal_id and signal_id not in signal_ids:
            warnings.append(f"Path '{pid}' signal_id '{signal_id}' has no entity")

        sig_tag = next((t for t in p["tags"] if t.startswith("signal:")), None)
        if sig_tag:
            slug = sig_tag[len("signal:"):]
            if f"sig_{slug}" not in signal_ids:
                warnings.append(f"Path '{pid}' signal '{slug}' has no entity")

    for key, ps in occupancy.items():
        if len(ps) > 1:
            warnings.append(f"Pin {key} occupied by {len(ps)} paths: {ps}")

    for branch_point_id, count in branch_point_incidents.items():
        if count < 2:
            warnings.append(f"Branch point '{branch_point_id}' has only {count} incident wire(s)")

    print(f"Validated {label}: {len(hierarchy)} hierarchy, "
          f"{len(system['connectors'])} connectors, {len(system['paths'])} paths, "
          f"{len(branch_points)} branch points, {len(system['signals'])} signals")
    if errors:
        print(f"\nERRORS ({len(errors)}):")
        for e in errors:
            print("  -", e)
    if warnings:
        print(f"\nWARNINGS ({len(warnings)}):")
        for w in warnings[:40]:
            print("  -", w)
        if len(warnings) > 40:
            print(f"  ... and {len(warnings) - 40} more")
    return 1 if errors else 0


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else "fsae-2026"
    sys.exit(main(arg))
