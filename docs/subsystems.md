# Subsystems

A Subsystem is a focused, editable view of one canonical System. It does not own electrical
entities or topology. Documents are defined in `src/types/index.ts`, saved by `server/api.ts`, and
rendered by `buildSubsystemGraphModel` in `src/components/graph/graphModel.ts`.

## Document shape

Each `public/user-data/subsystems/<system-key>/<id>.json` document uses schema `1.0.0` and stores:

- stable `id`, mutable `name`, and tags;
- Enclosure frames, Devices, and directly placed connectors keyed by canonical IDs with local
  position and optional size;
- `hidden_connectors` for suppressing a connector while retaining its represented Device;
- `device_connector_mode`: `all` or `selected`;
- `collapse_connectors` for equipment-card architecture summaries;
- an optional viewport.

Subsystem display-name changes never alter IDs or `system:<subsystem-id>` membership tags.

## Membership and layout

Adding a Device normally exposes all of its connectors. Adding one connector first creates the
required Enclosure/Device context in `selected` mode, so only explicitly selected connectors show.
Direct connector references cover Bulkhead connectors and connectors whose Device is not represented.
Root Devices and connectors render without an artificial Enclosure frame.

Nested Enclosure frames and Devices use parent-relative positions and remain inside represented
parent bounds. Bulkhead connectors project to the nearest Enclosure boundary from their saved
position and can move among all four walls. Subsystem geometry is independent of System-sheet
geometry.

Removing a Device, connector, or Enclosure from this surface removes only Subsystem references.
Deleting from the System hierarchy is the explicit cascading operation.

## Topology projection

`deriveSubsystemSegments` begins with canonical Wires, then contracts hidden connectors and Branch
Points. Visible neighbors remain connected, and projected edges retain every contributing Path ID.
For a hidden branching component, the lexically first visible connector becomes a deterministic
projection hub.

When `collapse_connectors` is enabled, routes connect represented owning equipment cards while the
underlying connector and Path identities remain canonical. Synthetic React Flow node/edge IDs are
presentation-only; selection, presence, and edits use real entity IDs.

## Routing

Dragging between two unoccupied cavity handles calls `POST /api/paths/route`. The server:

1. validates endpoint occupancy and signal;
2. computes the endpoint sheet scopes and crossed boundaries;
3. creates unresolved generated one-cavity Bulkhead connector placeholders where required;
4. writes one ordered Path under the System lock;
5. returns the newly saved assembled System and any updated Subsystem.

Request-derived IDs make retries idempotent. Connector capacity overruns are validation warnings;
duplicate cavity claims are rejected. The route picker may select or create a signal before routing.
Routing bypasses debounced System autosave because it is an atomic server-first transaction.

Subsystem sidecars otherwise autosave as changed-key merges. Their Paths, signals, connectors, and
hierarchy always come from the loaded System.

## Ownership and update triggers

- File/API behavior: `server/api.ts`.
- Membership mutations: `src/store/index.ts`.
- Projection, containment, and synthetic IDs: `src/components/graph/graphModel.ts`.
- Routing UI: `GraphView.tsx`; boundary planning: `src/lib/bulkheadRouting.ts`.

Update this page when the Subsystem schema, membership semantics, containment, summary mode,
projection contraction, routing flow, or deletion behavior changes.
