# Manufacturing

Manufacturing is derived from the assembled System and connector library by
`src/lib/manufacturing.ts`. Only operator progress, endpoint choices, notes, and work attribution are
stored in `manufacturing.<system-key>.json`; the electrical design is never duplicated there.

## Derivation

A manufacturing bundle is one physical run between consecutive connector stops on a Path. Branch
Points between those stops remain visible as work/measurement points. A Path with one connector and
a Branch Point stub remains a real run instead of receiving an invented mate.

Operator-facing physical harnesses group bundles only through shared real Branch Points. Sharing a
connector or display label does not by itself combine independently mateable assemblies. A
`bundle:<name>` Path tag supplies a preferred display name; stable endpoint keys provide fallback
identity.

Each derived wire includes:

- Path/Wire identity, signal, color, gauge, and both endpoints;
- ordered per-hop measurements and total cut length when all required hops are known;
- intermediate Branch Points;
- connector family, housing, contact, and gauge compatibility;
- explicit issues for missing lengths, gauge, or contact gender.

Actual Path properties win. Without a wire color, the signal's preferred color is used and marked as
inferred. Without an explicit gauge, endpoint connector gauge ranges are intersected; an
incompatible or unparsable pair remains an issue rather than an invented exact gauge.

## Length ownership

Lengths are millimetres on adjacent `Path.measurements` hops. The Build page and selected Harness
Bundle inspector both edit those same records through `updatePathSegmentLengths`. Setting a total
across several hops preserves existing proportions when possible and otherwise divides the total
evenly. Therefore length edits are System changes and use System autosave/CAS, not only the
manufacturing sidecar.

## Build and progress

The workbench has **Build**, **Progress**, and **BOM** tabs.

Build shows a crossing-free physical harness diagram, per-Wire cuts and ends, Branch Point
measurements, connector pin guides, issues, and notes. Visual tasks can be toggled individually or
in ranges.

Progress supports the ordered component stages `ordered`, `cut`, `crimped`, `populated`, `qc`, and
`installed`. Completing a later stage fills earlier stages; reopening a stage clears it and later
stages. Fine-grained wire, Branch Point, and guide status is retained alongside compatibility
whole-bundle stages.

Every fine-grained task transition records current attribution plus an append-only, day-granular
work event. Connector-guide review has `checking` and `verified` states.

## Connector gender and guides

Contact gender is assigned per `(manufacturing bundle, connector)` endpoint. At a Bulkhead connector,
bundles on the same physical Enclosure side share a gender and bundles across the wall receive the
opposite. Mixed/ambiguous sides are not assignable. Inline mating interfaces treat their other side
as the mate. VibeWire does not guess gender from names.

Pin-guide and side-view media resolve through the selected connector family/cavity variant and
gender, then fall back to shared type media.

## BOM and export

The BOM is recalculated from the current System:

- Wire groups by part number, gauge, and color; missing lengths contribute zero and are called out.
- Housing groups by resolved part number or connector family/cavity/keying identity.
- Crimps group by family, contact gender, and part number.

The BOM tab downloads the displayed rows as CSV. It does not persist a separate BOM snapshot.

## Persisted document

Canonical manufacturing schema `1.2.0` stores a `bundles` map containing component stages, endpoint
genders, fine-grained progress, Branch Point measurement status, guide states, task attribution,
work logs, and notes. Sidecar updates merge by bundle key and autosave after one second.

Navigation is bidirectional: a graph Harness Bundle can open its manufacturing run, and a
manufacturing selection can return to the best-overlapping System Harness Bundle.

Update this page when physical grouping, length ownership, issue derivation, gender propagation,
workflow stages, attribution, BOM grouping, or manufacturing schema changes. Primary owners are
`src/lib/manufacturing.ts`, `src/components/manufacturing/`, `src/store/index.ts`, and
`server/api.ts`.
