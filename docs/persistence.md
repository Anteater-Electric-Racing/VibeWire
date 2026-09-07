# Persistence

JSON under `public/user-data/` is the product-data source of truth. `server/api.ts` owns the HTTP
contract and transactions; `server/sheets.ts` owns System file assembly/splitting;
`server/history.ts` owns byte-exact snapshots and restore.

## File map

```text
public/user-data/
  systems/<key>.json                         flat System
  systems/<key>/root.json                    root sheet
  systems/<key>/signals.json                 shared signals
  systems/<key>/sheets/<enclosure-id>.json   opt-in Enclosure sheets
  layouts.<key>.json                         graph/view sidecar
  manufacturing.<key>.json                   manufacturing progress sidecar
  subsystems/<key>/<subsystem-id>.json       Subsystem sidecars
  connectors/connector-library.json          shared connector catalog
  images/                                    uploaded and referenced media
```

The System storage key is validated, stable, and separate from `SystemData.name`. All included
documents are fixtures/test data; new live-format examples belong under `systems/`.

## System formats

Flat Systems write canonical `0.3.0`. A sheeted System writes `0.3.0-sheets` files and presents one
ordinary assembled `SystemData` to the client.

An Enclosure owns a physical sheet file only when `sheets/<id>.json` exists. Other hierarchy content
stays in its nearest sheet-owning ancestor. A parent sheet's `SheetBoundaryPort` represents a
connector or Branch Point materialized in a direct child sheet; assembly creates a `derived` runtime
entity, and splitting reconstructs the port.

Sheet saves:

1. normalize the incoming System;
2. discover the existing sheet-owning Enclosures;
3. split Paths and entities into a complete in-memory write plan;
4. reassemble the plan and compare it with the input;
5. only then replace files.

Current implementation supports recursive, opt-in sheet ownership and many multi-boundary routes
when each crossed boundary has a connector placeholder. It deliberately rejects ambiguous cases:

- an adjacent Path hop that skips an intervening sheet boundary;
- crossing a boundary directly at a Branch Point;
- a non-direct child derivation without boundary placeholders;
- mixed multi-hop forms that cannot be represented by the splitter;
- measurements that cannot round-trip on adjacent node pairs.

Do not infer unlimited route depth from the directory format. Read the current branches in
`splitSystem` before extending sheet behavior.

## Sidecars

`layouts.<key>.json` stores maps for nodes, ports, sizes, free connectors, images, text boxes,
waypoints, Shared Anchors, Branch Point positions by context, rotations, per-Harness-Bundle route
styles, and per-view route defaults. Old background and connector-type-size maps still round-trip
for compatibility.

Subsystem documents use schema `1.0.0` and store only membership, local geometry, connector
visibility mode, summary mode, and viewport. Manufacturing documents write schema `1.2.0` and store
progress, endpoint genders, notes, task attribution, and work logs; cuts and BOM rows are derived.

## Load and autosave

`App.tsx` prefers `GET /api/state?system=<key>`, then installs the System, layouts, Subsystems,
manufacturing document, connector library, revision metadata, and attribution. The fallback load uses
the individual read routes.

`src/store/index.ts` autosaves diffs:

- 300 ms: System and connector library;
- 1000 ms: layouts, manufacturing, and Subsystems.

System and library writes carry `X-Base-Rev` and fail with 409 on a stale revision. Sidecars submit
changed/removed keys and merge under the per-System server lock. Failed writes remain dirty and show
an autosave error. Switching Systems flushes pending work first.

Current exception: changing only `routeStyleLayouts` or `viewRouteStyleLayouts` does not itself
schedule the 1000 ms timer, although those maps are included in layout diffs, explicit flushes, and
System-switch flushes. See [`canvas.md`](./canvas.md).

Vite and the API are separate processes. `npm run dev:web` alone can show the frontend but cannot
provide working API persistence; use `npm run dev` or run `dev:web` and `dev:api` separately.

## HTTP surface

- Bootstrap/sync: `GET /api/state`, `/api/sync`, `/api/events`; `POST /api/presence`.
- System: `GET /api/systems`, `GET|PUT /api/system`, `POST /api/save-system`.
- Sidecars: `GET /api/layouts`, `/api/subsystems`, `/api/manufacturing`;
  `PUT|DELETE /api/subsystems/:id`; `POST /api/save-layouts`, `/api/save-manufacturing`.
- Library/assets: `GET /api/library`, `/api/library/usage`, `/api/list-assets`;
  `POST /api/save-library`, `/api/upload-image`; connector-type deletion is targeted.
- Targeted topology: `POST /api/signals`, `POST /api/paths/route`.
- History: checkpoint list/create/detail/restore and `GET /api/activity`.
- Identity: login, logout, current session, and self-service user creation.

Mutating routes require an editor role. The API is an application backend, not a general automation
interface; add endpoints only for a product flow.

### Compatibility aliases

Older clients may still use the `harnesses` directory fallback, `/api/harnesses`, `/api/harness`,
`/api/save-harness`, and the `?harness=` query. They resolve to the same canonical System operations.
New code writes `public/user-data/systems` and uses `system` routes/queries. Full field mappings are in
[`migrations.md`](./migrations.md).

## Collaboration state and Git

`vibewire-state/` is not wholly disposable or ignored:

- tracked by policy: `users.json`, revisions, checkpoints, edit logs, and attribution;
- ignored: `secret.txt`, automatic byte-history snapshots, and rollback staging.

Checkpoints contain byte-exact copies of the relevant System and sidecars. Restore first creates a
safety checkpoint, stages all replacements, and rolls back installed paths on failure. The first
successful write on a UTC day also creates a daily checkpoint with contributors since the previous
daily checkpoint.

Do not hand-edit generated attribution, revision, edit-log, checkpoint, or history content during
application work. Update this page when paths, schemas, endpoints, save timing, transaction order, or
Git policy changes.
