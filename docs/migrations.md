# Migrations and compatibility

Use canonical names from [`domain-model.md`](./domain-model.md) everywhere else. This page is the
only documentation home for historical vocabulary and reader aliases. Compatibility code is
concentrated in `src/lib/systemNormalize.ts`, `server/sheets.ts`, HTTP aliases, and history restore.

## Canonical writes

| Document | Canonical version | Older reads |
| --- | --- | --- |
| Flat `SystemData` | `0.3.0` | Earlier flat versions, including `0.1.0` |
| `root.json` and `sheets/*.json` | `0.3.0-sheets` | `0.2.0-sheets` |
| Manufacturing | `1.2.0` | `1.1.0` |
| Subsystem | `1.0.0` | Current shape only |

`normalizeSystemData` always emits `0.3.0`; it never preserves an input version. Sheet writes stamp
`SHEET_SCHEMA_VERSION` (`0.3.0-sheets`). Manufacturing normalization always writes `1.2.0`.

## Storage and HTTP aliases

Canonical live paths are `public/user-data/systems/<key>.json` or
`public/user-data/systems/<key>/`. Readers list and load the old
`public/user-data/harnesses/` path only as a fallback for fixtures, snapshots, and existing data.
New data must use `systems/`.

The following old requests remain aliases:

- `/api/harnesses` → `/api/systems`
- `/api/harness` → `/api/system`
- `/api/save-harness` → `/api/save-system`
- `?harness=<key>` → `?system=<key>`

Internal code uses `system` or `systemKey` for the complete loaded design and its storage key.
Browser preferences write `vw-active-system` and `lastManufacturingBundleBySystem`; readers still
accept their older Harness-named keys so existing local navigation state survives.

## Domain field map

| Historical read | Canonical write |
| --- | --- |
| `HarnessData` / harness document | `SystemData` / System |
| `enclosures[]` with `container` | `hierarchy[]` with `kind: 'device' \| 'enclosure'` |
| `pcbs[]` | `hierarchy[]` Device entries |
| `mergePoints` | `branchPoints` |
| Path `kind: 'merge'`, `merge_point_id` | `kind: 'branch'`, `branch_point_id` |
| `signal:<id>` Path tag | `Path.signal_id` (tag remains a read fallback) |
| Sheet `BulkheadPort` | `SheetBoundaryPort` |
| Port `entity_kind: 'merge'`, `merge_point_id` | `entity_kind: 'branch'`, `branch_point_id` |

Connector input without `mounting` is normalized as a Bulkhead only when its parent is an Enclosure;
otherwise omission means endpoint. Canonical writes persist `bulkhead` and `inline` explicitly and
never persist `mounting: 'endpoint'`.

Existing IDs such as `mp_*` and `jct_*` remain valid stable identities. New Branch Points use
`bp_*`, and new Shared Anchors use `sa_*`; identifiers are not renamed merely to match current terminology.

## Layout map

| Historical read | Canonical write |
| --- | --- |
| `backgrounds` / `BackgroundImageNode` | `images` / `CanvasImageNode` |
| `junctions` | `sharedAnchors` |
| waypoint `{ junctionId }` | `{ sharedAnchorId }` |
| Branch-position map `mergePoints` | `branchPoints` |
| endpoint/ref prefix `merge:` | `branch:` |
| `connectorTypeSizes` | retained for round trips; per-instance `sizes` renders |

`migrateCanvasImages` converts the one-background-per-context map only when no canonical images
exist. `backgroundImage` remains a graph node-type alias for old render state.

Harness Bundle IDs must be canonicalized, not text-replaced: after `merge:` becomes `branch:`, both
endpoint keys are sorted again because prefix ordering changed. Pin suffixes and through-family
suffixes are normalized by `src/lib/systemTopology.ts`.

The serialized `bundle:` Harness Bundle ID prefix is a stable wire-format and layout-key exception;
React Flow registers those edges internally as `harnessBundle`.

## Manufacturing and collaboration map

| Historical read | Canonical write |
| --- | --- |
| `splice_measured` | `branch_measured` |
| task key `splice:<id>` | `branch:<id>` |
| work kind `splice-measured` | `branch-measured` |
| presence top-level `harness` | `system` |
| `drillDownEnclosure` | `openEnclosureId` |
| presence target `bundle` or `harness` | `harnessBundle` |
| presence target `mergePoint` | `branchPoint` |

`server/presence.ts` is the only request boundary that accepts those old presence names; broadcasts
and client state are canonical. Edit-log reads similarly accept old `harness` and write kind
`harness`, then expose `system`.

## Snapshot policy

Automatic history and named checkpoints are byte-exact archives and are never bulk-migrated. Restore
looks for `systems/` first and then `harnesses/`; when an old snapshot contains only the fallback
path, restore removes any leftover canonical live copy so the restored files are actually visible.

Maintenance utilities use canonical System ownership names: `scripts/migrate-system-to-sheets.ts`,
`scripts/print-assembled-system.ts`, and `scripts/validate_system.py`. The `migrate-signal-ids.ts`
utility also operates through current normalization and sheet verification.

When retiring a compatibility reader, first prove no tracked fixture, checkpoint, or supported
client still needs it. Add migration coverage in `test:domain-model` and document the removal in the
dated product changelog.
