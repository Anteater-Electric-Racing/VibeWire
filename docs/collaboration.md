# Collaboration

VibeWire combines authenticated editing, revisioned sync, advisory presence, persistent attribution,
activity, checkpoints, and unified local undo. Correctness comes from write transactions and
compare-and-swap, never from the live channel.

Primary owners are `src/lib/sync/`, collaboration/history components, `src/store/index.ts`, and
`server/{auth,revisions,history,editlog,attribution,presence,sse}.ts`.

## Identity and permissions

Anyone may create an account with a private case-sensitive login, public display name, and
`editor` or `viewer` role. There is no admin role or user-list endpoint. Login names are never
returned to clients; signed `httpOnly`, `SameSite=Lax` cookies identify sessions.

A restored editor identity starts read-only. The person must explicitly **Continue as** that user
(or press E) before client editing is armed. The server independently requires editor role on every
mutating route. Viewers may navigate all surfaces but document mutations are blocked, not merely
allowed to evaporate without autosave.

## Concurrency and sync

System and connector-library documents use strict compare-and-swap:

- clients retain the last server-confirmed document and revision;
- System/library saves include `X-Base-Rev`;
- a stale base returns 409 and writes nothing;
- the conflict banner keeps the local diff and offers copy or reload/discard.

Layouts, manufacturing, and Subsystems send changed and removed map keys. The server merges those
keys under a per-System async lock. Targeted signal creation and routing are complete server-side
transactions under that same lock.

SSE revision events are primary. A 20-second `/api/sync` poll remains active as a backstop; SSE
reconnects exponentially up to 20 seconds. Sync status is `live`, `polling`, or `offline`. Applying a
remote System update adopts it when local diff is empty or rebases the local diff; impossible
rebases become explicit conflicts. Remote changes to an actively manipulated target may be queued
until interaction ends.

## Presence

Signed-in browsers publish to `POST /api/presence`. Focus/editing changes are coalesced quickly, a
10-second heartbeat keeps the session current, and peers expire after 30 seconds. Presence is
in-memory, advisory, and never a lock.

Canonical target kinds are `enclosure`, `connector`, `branchPoint`, `path`, `signal`,
`harnessBundle`, `connectorType`, `subsystem`, `textBox`, and `image`. Published state also includes
the System key, app view, editing surface, open Enclosure, active Subsystem, and optional focused
field.

Presence is rendered in graph nodes and Harness Bundles, hierarchy rows, connector/signal libraries,
the inspector, manufacturing rows, and floating images/text. Stacked colored initials identify
peers; a pulse means active editing. The topbar lists every peer with a plain-language location.
Subsystem presentation IDs are never published in place of canonical entity IDs.

### Compatibility boundary

`server/presence.ts` accepts pre-migration top-level `harness` and target kinds `bundle`, `harness`,
and `mergePoint`, then normalizes them immediately. Stored and broadcast presence is canonical. See
[`migrations.md`](./migrations.md).

## Attribution and activity

Each successful save updates `vibewire-state/attribution/<system>.json` as
`entityId -> { by: { id, displayName }, at, rev }`. The inspector shows the selected record's last
writer and time. A selected Harness Bundle uses the newest attribution among its Path IDs, with
revision as the timestamp tie-breaker.

The API also appends one edit-log line per successful write. Activity aggregates these as **changes
saved**, not semantic edit counts. Attribution and edit logs are tracked managed state; do not
hand-edit them.

## Checkpoints and restore

Named checkpoints are byte-exact copies of the System and its sidecars. The first successful write
on each edited UTC day creates a daily checkpoint and records contributors since the previous daily
checkpoint. Restore always creates an automatic safety checkpoint first, installs staged paths, and
broadcasts a `restore` revision.

Automatic revision history is pruned densely for recent writes, hourly through the first week, then
daily. It is ignored by Git; named checkpoints are tracked by current repository policy.

## Unified undo

The browser-local stack captures System, connector library, manufacturing, Subsystems, every layout
map, and selection. One unified stack replaces split structural/layout histories. Entries sharing an
action key coalesce for two seconds, interactive gestures bracket one entry, and depth is capped at
60.

Undo/redo replays only the entry's changed fields onto current state, preserving unrelated remote
work. Resulting System/library saves still pass CAS and can conflict. The staleness chip turns red
when another writer saved after the top local snapshot and warns before a risky undo.

Update this page when roles, activation, revision classes, live transport, conflict handling,
presence publication/rendering, attribution, checkpoint retention, or undo scope changes.
