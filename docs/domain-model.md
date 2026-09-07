# Domain model

This page defines product language and semantic invariants. Types are owned by
`src/types/index.ts`; topology operations by `src/lib/systemTopology.ts`; input compatibility by
`src/lib/systemNormalize.ts`; sheet persistence by `server/sheets.ts`.

## Canonical vocabulary

| Name | Definition |
| --- | --- |
| **System** | The complete loaded design: hierarchy, connectors, Branch Points, Paths, signals, and signal-property definitions. |
| **HierarchyEntity** | The union of a Device leaf and an Enclosure. |
| **Device** | A leaf HierarchyEntity that owns connectors and has no internal sheet. |
| **Enclosure** | A HierarchyEntity with an internal conceptual sheet; it may contain Devices or Enclosures. |
| **Bulkhead connector** | A connector mounted on an Enclosure wall (`mounting: 'bulkhead'`). |
| **Path** | An ordered logical connection tracker through connector cavities and Branch Points. |
| **Wire** | One physical conductor between adjacent termination points on a Path. |
| **Harness Bundle** | Wires grouped because they share a rendered or physical route. |
| **Branch Point** | A real topology node referenced by Paths. |
| **Shared Anchor** | A visual-only route join stored in layout data; it does not change Paths. |

Navigation uses **Open enclosure** and **Close enclosure**. Historical names appear only in
[`migrations.md`](./migrations.md) or an explicitly labelled compatibility note.

## `SystemData`

Canonical flat writes use `schema_version: "0.3.0"`:

- `name?` is the mutable display name. The filename/directory key is separate stable identity.
- `hierarchy[]` contains explicit `kind: 'device' | 'enclosure'` variants with `id`, `name`,
  `parent`, `tags`, and string `properties`.
- `connectors[]` reference a parent and connector-library type. Bulkhead and inline placement is
  explicit; omitted `mounting` means an endpoint.
- `branchPoints[]` are semantic topology entities and may be parented in an Enclosure sheet.
- `paths[]` contain ordered `nodes[]`, optional stable `signal_id`, tags, properties, and
  measurements.
- `signals[]` and `signalPropertyDefinitions[]` form the reusable signal catalog.

IDs are durable and display names are mutable and non-unique. Renaming must not rewrite references,
layout keys, Subsystem membership, or storage keys.

## Path and Wire invariants

- A connector node is `{ kind: 'connector', connector_id, pin_number }`; the cavity number is a
  positive integer. Occupancy is derived from these nodes, never stored as connector-owned pins.
- A Branch Point node is `{ kind: 'branch', branch_point_id }`.
- Each adjacent pair in `Path.nodes` derives one `Wire` with a stable path ID plus `wireIndex`.
- A measurement refers semantically to its `from` and `to` nodes. Persisted length measurements must
  describe an adjacent node pair; topology helpers split or fold measurements when nodes change.
- `Path.signal_id` is the stable signal reference. Signal identity does not merge disconnected
  topology.
- Actual conductor fields such as `wire_color`, `wire_gauge`, and `wire_part_number` belong to Path
  properties. A signal's preferred color is guidance and a manufacturing fallback.

## Harness Bundles and joins

`deriveWires` and `deriveHarnessBundles` group adjacent Wires by endpoint reference. A Harness Bundle
is therefore derived, not a stored electrical entity. Branch-through families keep routes with
different far-side neighbors distinct.

A Branch Point changes `SystemData` and electrical connectivity. A Shared Anchor lives in
`layouts.<system>.json` through `sharedAnchors` plus waypoint `{ sharedAnchorId }` references.
`SharedAnchorLayout.branchPointId` is present only when that visual join represents a Branch Point.
Creating a Shared Anchor is visual-only by default; choosing **Branch point** or converting in the
inspector is explicit and undoable. See [`canvas.md`](./canvas.md).

## Connector and signal libraries

Connector instances reference `connector_type`. A fixed type has one capacity; a family has
`pin_count: 0` and real `cavity_variants`. Family instances persist their selected `pin_count` and
optional valid `keying`. Pin-guide images support inspection/manufacturing; side images support
schematics.

Signals carry stable IDs, names, tags, free-form properties, and reusable select definitions.
Deleting a used signal cascades through its Paths; connector-type deletion migrates instances to the
protected Generic Multi-pin type.

## Update triggers

Update this page when entity meaning, canonical vocabulary, schema fields, identity rules, topology
derivation, or connector/signal semantics change. Format compatibility belongs in
[`migrations.md`](./migrations.md); storage mechanics belong in [`persistence.md`](./persistence.md).
