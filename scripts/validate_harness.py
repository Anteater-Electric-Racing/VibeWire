#!/usr/bin/env python3
"""Standalone structural validator for a harness.

Mirrors the checks in server/api.ts#validateHarnessInternal without spinning up
Node. Reports:
  - missing connector/merge_point references in paths
  - pin_number > connector_type.pin_count or <= 0
  - connector.connector_type not in library
  - signal: tags with no matching signal entity
  - merge points with < 2 incident segments

Accepts either a harness *name* (resolved against
public/user-data/harnesses/, supporting both the legacy flat
`<name>.json` format and the newer per-enclosure "sheet" directory format --
see server/sheets.ts) or a direct path to a flat harness JSON file.

For sheeted harnesses, this shells out to `scripts/print-assembled-harness.ts`
(via `npx tsx`) to reuse the real assembler in server/sheets.ts instead of
reimplementing sheet-merging logic here.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESSES_DIR = ROOT / "public" / "user-data" / "harnesses"


def load_harness(name_or_path: str) -> tuple[dict, str]:
    """Returns (harness_dict, display_label)."""
    as_path = Path(name_or_path)
    if as_path.suffix == ".json" and as_path.exists():
        return json.loads(as_path.read_text()), as_path.name

    flat_file = HARNESSES_DIR / f"{name_or_path}.json"
    if flat_file.exists():
        return json.loads(flat_file.read_text()), flat_file.name

    sheeted_dir = HARNESSES_DIR / name_or_path
    if (sheeted_dir / "root.json").exists():
        result = subprocess.run(
            ["npx", "tsx", str(ROOT / "scripts" / "print-assembled-harness.ts"), name_or_path],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(f"Failed to assemble sheeted harness '{name_or_path}':", file=sys.stderr)
            print(result.stderr, file=sys.stderr)
            sys.exit(1)
        return json.loads(result.stdout), f"{name_or_path}/ (sheeted)"

    print(f"No harness found for '{name_or_path}' (looked for {flat_file} and {sheeted_dir}/root.json)", file=sys.stderr)
    sys.exit(1)


def main(name_or_path: str) -> int:
    harness, label = load_harness(name_or_path)
    lib = json.loads((ROOT / "public" / "user-data" / "connectors" / "connector-library.json").read_text())
    types = {t["id"]: t for t in lib["connector_types"]}
    connectors = {c["id"]: c for c in harness["connectors"]}
    merge_points = {m["id"]: m for m in harness["mergePoints"]}
    enclosures = {e["id"]: e for e in harness["enclosures"]}
    signal_ids = {s["id"] for s in harness["signals"]}

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
    for e in harness["enclosures"]:
        p = e.get("parent")
        if p and p not in enclosures:
            errors.append(f"Enclosure '{e['id']}' parent '{p}' missing")

    # Connector parent + type
    for c in harness["connectors"]:
        p = c.get("parent")
        if p and p not in enclosures:
            errors.append(f"Connector '{c['id']}' parent '{p}' missing")
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

    # Merge-point parent
    for m in harness["mergePoints"]:
        p = m.get("parent")
        if p and p not in enclosures:
            errors.append(f"Merge point '{m['id']}' parent '{p}' missing")

    # Paths
    occupancy: dict[str, list[str]] = {}
    mp_incidents: dict[str, int] = {mp: 0 for mp in merge_points}
    for p in harness["paths"]:
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
                mid = node["merge_point_id"]
                if mid not in merge_points:
                    errors.append(f"Path '{pid}' references missing merge '{mid}'")
                else:
                    mp_incidents[mid] += 1

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

    for mp, count in mp_incidents.items():
        if count < 2:
            warnings.append(f"Merge point '{mp}' has only {count} incident segment(s)")

    print(f"Validated {label}: {len(harness['enclosures'])} enclosures, "
          f"{len(harness['connectors'])} connectors, {len(harness['paths'])} paths, "
          f"{len(harness['mergePoints'])} merge points, {len(harness['signals'])} signals")
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
