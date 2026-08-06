# VibeWire Collaboration Design

Multi-user editing, authentication, live sync, presence, checkpoints, and undo.

This document is the **contract**. Every workstream implements against it. If you
believe something here is wrong, say so in your final report rather than silently
diverging — a mismatch between two workstreams is worse than a flaw in the spec.

---

## 0. Guiding principle

**Sync quality affects UX. It never affects correctness.**

The live channel may buffer, stall, drop, or never reconnect. The worst outcome
of a completely dead sync channel must be a *rejected save with a clear message*,
never silently incorrect data. Every write is guarded independently of sync
health.

Corollary: when in doubt, **fail closed**. Reject the write and tell the user to
reload. An error message costs a minute. Wrong electrical data costs a competition.

---

## 1. Concurrency model

Data is split into two classes by the blast radius of a bad merge.

### Class A — Electrical data: strict compare-and-swap

Applies to: **the harness document** (`enclosures`, `connectors`, `mergePoints`,
`paths`, `signals`) and the **connector library**.

A bad merge here produces a wire on the wrong pin: invisible, plausible, and
discovered during competition. So it never merges.

- Every harness has a monotonically increasing integer `rev`.
- Clients record the `rev` they loaded or last successfully wrote (`baseRev`).
- Writes send `X-Base-Rev`. If it does not equal the current server `rev`,
  the server rejects with **409** and writes nothing.
- The connector library has its own independent `rev`.

### Class B — Presentation and progress data: free merge

Applies to: **layouts** (all eleven maps), **subsystem documents**,
**manufacturing progress**.

These are flat maps keyed by entity id with no referential integrity to violate.
A bad merge moves a node 40 pixels or ticks a checkbox — visible and harmless.

- Clients send only the keys they changed, plus explicitly removed keys.
- The server shallow-merges those keys onto the current on-disk value.
- Conflict resolution is per-key last-write-wins, which is the correct behavior
  ("whoever dragged it last").
- No `rev` check. These writes never fail for concurrency reasons.

### Not negotiable

- All writes for a given harness are serialized through a **per-harness async
  mutex** in the server process. Two concurrent writes must never interleave a
  read-modify-write cycle.
- Every harness write runs `validateHarnessData` before and after. If the error
  count **increased**, the write is refused with 500 and the reason is logged.
- `writeSheetedHarness` already refuses to write if its round-trip check fails.
  Do not bypass, weaken, or catch-and-ignore that.

### Do not add fields to harness entities

Connectors and merge points that sit on sheet boundaries are reconstructed from
`BulkheadPort` during assembly (`server/sheets.ts`), which only knows a fixed
field list. A new field added to an entity would be **silently dropped** on load
for exactly those entities.

Therefore **all new metadata lives in side-car files** keyed by entity id. The
harness JSON schema does not change in this project.

---

## 2. State directory

All new server state lives in `<projectRoot>/vibewire-state/`.

It is **deliberately outside `public/`**, because `public/user-data/*` is served
statically off disk to anyone who can reach the server, which would bypass auth.

```
vibewire-state/
  secret.txt                        # random 32-byte hex, generated on first boot, chmod 600
  users.json                        # accounts
  revisions/<harness>.json          # { rev, lastWriter, lastWriteAt }
  revisions/_library.json           # connector library rev
  history/<harness>/<rev>/          # byte-exact auto-snapshot per write
  checkpoints/<harness>/<id>/       # byte-exact named checkpoint + meta.json
  edit-log/<harness>.jsonl          # one line per successful write
  attribution/<harness>.json        # entityId -> { by, at, rev }
```

`vibewire-state/` is gitignored: it is regenerable local runtime state, not source.

**Snapshots are byte-exact file copies**, never re-serialized documents. Restore
is a plain file copy that skips split/assemble entirely and therefore cannot
transform or corrupt anything.

---

## 3. Identity and roles

Authentication is deliberately weak — the threat model is **team members making
mistakes**, not attackers. It must be trivially upgradeable later.

### User record

```ts
interface User {
  id: string;           // stable uuid, never reused
  login: string;        // secret-ish. CASE SENSITIVE. Plaintext. Never listed to non-admins.
  displayName: string;  // shown in presence, edit log, attribution
  role: 'admin' | 'editor' | 'viewer';
  color: string;        // stable hex for presence dots, assigned at creation
  createdAt: string;
  createdBy: string;
}
```

`login` and `displayName` are **separate on purpose**. The edit log and presence
UI publish `displayName` to everyone, so if they were the same field the log would
be handing out credentials.

### Rules

- Login is a **plaintext free-text field**. No dropdown, no autocomplete, no
  endpoint that enumerates users for non-admins. You have to know the name.
- Matching is **case sensitive** and exact.
- Failed logins are rate limited per `(ip, login)` at 5/min, with a looser 30/min
  per-IP ceiling. A single per-IP limit is wrong here: behind a tunnel the whole
  team shares one source address, so one person fumbling their name would lock
  everyone out. Client IP is read from `CF-Connecting-IP`, then
  `X-Forwarded-For`, then the socket.
- **The `login` value is never returned to any client**, including in the login
  response and `/api/auth/me`. It is the only credential, and the edit log and
  presence UI publish `displayName` to everyone. Clients only ever see
  `{ id, displayName, role, color }`.
- Session is a signed cookie (HMAC with `secret.txt`), `httpOnly`, `sameSite=Lax`,
  30-day expiry.
- **Default state is read-only, even when you are recognised.** This is a
  two-part state, and conflating the parts is a mistake:
  - *Identity* comes from the session cookie and is known on boot. `/api/auth/me`
    returns `displayName`, which is all the UI needs to offer "Continue as Joe".
  - *Edit activation* is a client-side boolean (`session.editSessionActive`)
    that starts `false` on every cold boot and is only flipped by an explicit
    click (`activateEditSession()`) or a fresh login. `isEditor` requires both
    an editor/admin role **and** an armed edit session.

  No server endpoint is needed for activation — the guard exists to prevent
  accidental edits from a UI, and accidents come from the UI. The server-side
  role check is a separate concern and stays as it is.
- Roles: `viewer` reads everything. `editor` reads and writes. `admin` also
  manages users.
- Pluggable identity: if the request carries a trusted header
  (`Cf-Access-Authenticated-User-Email`) and `TRUST_IDENTITY_HEADER=1` is set,
  use it to resolve the user instead of the cookie. This is the upgrade path to
  real SSO without touching anything else.
- **Bootstrap:** if `users.json` does not exist, the first `POST /api/auth/login`
  creates that login as an `admin`, and logs a loud warning. Otherwise a fresh
  install is unusable.

### Enforcement

Server-side on **every** mutating route. The client-side guard is UX only and
must never be the sole check. Non-editors receive **403**.

---

## 4. HTTP API

### Auth

| Method | Path | Body / Params | Response |
|---|---|---|---|
| POST | `/api/auth/login` | `{ login }` | `{ user }`, sets cookie. 401 unknown, 429 rate limited |
| POST | `/api/auth/logout` | — | `204`, clears cookie |
| GET | `/api/auth/me` | — | `{ user }` or `{ user: null }` |
| GET | `/api/users` | admin only | `User[]` (without `login`) |
| POST | `/api/users` | `{ login, displayName, role }`, admin | `{ user }`, 409 if login taken |
| PATCH | `/api/users/:id` | `{ displayName?, role?, login? }`, admin | `{ user }` |
| DELETE | `/api/users/:id` | admin | `204`. Refuse deleting the last admin |

### Document state

| Method | Path | Notes |
|---|---|---|
| GET | `/api/state?harness=X` | One-shot load: `{ rev, libraryRev, harness, layouts, manufacturing, subsystems, attribution, lastWriter }` |
| POST | `/api/save-harness?harness=X` | Header `X-Base-Rev`. Full `HarnessData` body. **CAS.** |
| POST | `/api/save-library` | Header `X-Base-Rev`. **CAS.** |
| POST | `/api/save-layouts?harness=X` | Body `{ patch, removed }`. **Merge.** |
| POST | `/api/save-manufacturing?harness=X` | Body `{ patch, removed }`. **Merge.** |
| PUT | `/api/subsystems/:id?harness=X` | **Merge.** Unchanged shape otherwise |

409 response body:

```jsonc
{
  "error": "conflict",
  "currentRev": 42,
  "baseRev": 40,
  "lastWriter": { "id": "...", "displayName": "Joe" },
  "changedEntityIds": ["con_012", "path_034"]  // what moved between baseRev and currentRev
}
```

Success response: `{ ok: true, rev: 43 }`.

The narrow single-shot mutation routes (`POST /api/signals`, `POST /api/paths/route`) bump the rev and
broadcast, but are exempt from CAS: they are server-side operations that read, mutate, and write
under the harness lock in one step rather than submitting a client-side document.

The general entity-CRUD routes this section originally referred to (`POST /api/connectors` and
friends) no longer exist. The API only serves the UI now — see "What This Project Is" in
`Architecture.md`.

### Live sync

| Method | Path | Notes |
|---|---|---|
| GET | `/api/events?harness=X` | SSE stream |
| POST | `/api/presence` | Heartbeat, `204` |
| GET | `/api/sync?harness=X&since=N` | Catch-up after reconnect |

SSE events:

- `event: rev` — `{ rev, kind, by, changedEntityIds }` where `kind` is
  `harness | layouts | manufacturing | subsystem | library | restore`
- `event: presence` — `{ peers: PeerPresence[] }`
- `event: ping` — keepalive comment every 20s so proxies don't close the stream

`GET /api/events` must require a resolved user (any role, viewers included). An
unauthenticated SSE endpoint is an open invitation to hold connections open, and
it is the one route where that costs a real resource.

`GET /api/sync?since=N` returns `{ rev, full: false, changed: {...} }` when the
gap is small, or `{ rev, full: true, ...entire state }` when the client is too
far behind or `N` is unknown. Clients must handle both.

### Checkpoints and history

| Method | Path | Notes |
|---|---|---|
| GET | `/api/checkpoints?harness=X` | `CheckpointMeta[]`, newest first |
| POST | `/api/checkpoints?harness=X` | `{ label }` → creates from current state |
| GET | `/api/checkpoints/:id?harness=X` | Metadata + entity-count diff vs current |
| POST | `/api/checkpoints/:id/restore?harness=X` | See below |
| GET | `/api/activity?harness=X&days=N` | `{ [date]: { [displayName]: count } }` |

**Restore is always reversible.** Before restoring, the server automatically
creates a checkpoint of the current state labelled
`Auto-saved before restoring "<label>"`. So undoing a rollback is just restoring
that automatic checkpoint — no special mechanism.

Restore requires `editor`, bumps the rev, and broadcasts `kind: "restore"` so
every connected client hard-reloads its state.

---

## 5. Client sync

### Two references, one rule

The store holds:

- `serverHarness` — the last server-confirmed document, at `serverRev`
- `harness` — what the user sees

**Autosave fires when the diff between them is non-empty, not when a reference
changes.** This is the whole fix for the echo loop: applying a remote update sets
both, so the outstanding diff is empty and nothing is sent back. There is no
suppression flag to forget and no ping-pong race.

Replaces the current trigger in `src/store/index.ts`:

```ts
const harnessChanged = state.harness !== prev.harness;  // DELETE THIS
```

Note: mutators `structuredClone` the whole harness, so reference comparison
cannot shortcut the diff. Deep-compare entities by id. At current sizes
(~400 entities, ~272 KB) this is low single-digit milliseconds per debounce tick,
which is fine, but do not do it on every keystroke — only when the debounce fires.

### Debounce

- Layouts: **1000 ms** (drags fire continuously)
- Harness / library: **300 ms** (discrete actions; shortens the conflict window)
- Text inputs commit on **blur or Enter**, never per keystroke. This shrinks the
  conflict window *and* gives undo sane granularity — one change, two problems.

### Applying remote updates

On `rev` event or poll detecting a change:

1. Fetch the delta.
2. Class B (layouts/manufacturing/subsystems): merge incoming keys, **skipping
   any key with an unsaved local change**.
3. Class A (harness/library): if the local outstanding diff is empty, adopt
   directly. If not empty, rebase — reapply the local diff onto the new server
   state. If rebasing is impossible (an entity you edited was deleted remotely),
   surface a conflict dialog. Never guess.
4. **Never apply a remote change to an entity under active local interaction**
   (mid-drag, focused input). Queue it until the interaction ends.

### Conflict handling (409)

Show a banner: *"Joe changed the harness while you were editing. Your last change
wasn't saved."* with **Reload and discard my change** and **Copy my change to
clipboard** (JSON, so nothing is truly lost). Keep local state intact until the
user chooses.

"Non-dismissable" means there is no X that makes it go away while leaving you in
a stale state pretending nothing happened — the user must pick an option.
`dismissConflict()` is the internal action those buttons call once a choice has
been made; it is not a third "ignore" path.

### Sync health

- SSE is primary. A **backstop poll every 20 s** runs regardless, because a
  silently dead SSE connection leaves a user confidently stale forever, which is
  worse than polling.
- Reconnect with `since=<rev>`.
- `syncStatus: 'live' | 'polling' | 'offline'` shown in the Topbar.

### Read-only enforcement

A Zustand middleware inspects every state update. If the session is not an editor
and the update touches any **document slice**, drop it and raise a toast
("Log in to edit"). Document slices:

```
harness, connectorLibrary, manufacturing, subsystems,
nodeLayouts, portLayouts, sizeLayouts, freePortLayouts, backgroundLayouts,
connectorTypeSizes, textBoxLayouts, waypointLayouts, junctionLayouts,
mergePointLayouts, rotationLayouts
```

Everything else — selection, drill-down, filters, view switching, tree expansion,
search, the inspector, manufacturing browsing, the connector library browser —
passes through untouched. **Viewers get the entire app, they just cannot persist
anything.**

Do not implement read-only by disabling autosave. That lets users make edits that
silently evaporate, which is worse than blocking them.

---

## 6. Presence

### Presence is entity-keyed, not view-keyed

The same connector appears in the graph, the tree, a subsystem canvas, and a
manufacturing cut list. Rather than teaching each view about the others, presence
is published as **`{ entityKind, entityId }`** and each view independently asks
"is anyone on this entity?" by id. Any view that renders an entity gets presence
for free, including views added later.

```ts
type PresenceTargetKind =
  | 'enclosure' | 'connector' | 'mergePoint' | 'path' | 'signal'   // harness entities
  | 'bundle'                                                        // manufacturing bundle id
  | 'connectorType'                                                 // library type id
  | 'subsystem' | 'textBox';

interface PresenceTarget { kind: PresenceTargetKind; id: string; field?: string }

interface PeerPresence {
  sessionId: string;
  userId: string;
  displayName: string;
  color: string;
  harness: string;
  appView: 'canvas' | 'connectorLibrary' | 'manufacturing';
  editingSurface: 'hierarchy' | 'subsystem';
  drillDownEnclosure: string | null;
  activeSubsystemId: string | null;
  focus: PresenceTarget | null;    // selected / looking at
  editing: PresenceTarget | null;  // actively typing in a field — stronger signal
  lastSeen: number;
}
```

`focus` comes from selection. `editing` must be published explicitly from
`onFocus`/`onBlur` on text inputs — local draft state alone is not enough to know
someone is typing.

Heartbeat every 10 s. Peers older than 30 s are dropped. Presence is in-memory
only; it is never persisted.

### Rendering

One shared component, used everywhere:

```tsx
<PresenceBadge kind="connector" id={connector.id} size="sm" />
```

Renders nothing when no peer is present. Otherwise renders stacked colored dots
with initials, tooltip listing display names, and a pulsing ring when any peer
has `editing` (not just `focus`) on that entity.

Required mount points — **all of these, this is the "works in every view"
requirement**:

| View | Component | Target |
|---|---|---|
| Graph | `ConnectorNode` | `connector` |
| Graph | `EnclosureNode` | `enclosure` |
| Graph | `MergePointNode` | `mergePoint` |
| Graph | `BundleEdge` | `path` (any path in the bundle) |
| Graph | `TextBoxNode` | `textBox` |
| Tree | `ConnectorRow`, `EnclosureRow`, `MergePointRow` | matching kind |
| Subsystem canvas | reuses the graph nodes — verify badges survive the subsystem model | |
| Manufacturing | bundle list row, `BundleCutList` | `bundle` |
| Manufacturing | `WireRow`, `EndpointCell` | `path`, `connector` |
| Connector library | type list row + detail header | `connectorType` |
| Topbar | `PresenceStack` | all peers, grouped by location |

`PresenceStack` shows every peer on the current harness with their location
("Joe — Manufacturing", "Sara — Subsystem: LV"), so people are visible even when
they are somewhere you aren't looking.

Subsystem note: the subsystem canvas reuses `ConnectorNode`, `EnclosureNode`, and
`BundleEdge` via `graphModel.ts`, so badges should appear automatically — but the
subsystem model synthesizes node ids for frames and projected edges. Verify
badges resolve to the real underlying entity id there, and fix the mapping if not.

---

## 7. Undo

### Model

One unified snapshot stack replacing the current split between `undoStack`
(layout only) and the dead `structuralUndoStack`. A snapshot captures `harness`,
all layout maps, `subsystems`, and `manufacturing`.

**Undo applies as a scoped patch, not a whole-document restore.** On undo, diff
the snapshot against current state, compute the entities *you* changed, and revert
only those. Concurrent edits by others to other entities survive. This is what
makes snapshot undo tolerable in a multi-user document, and it requires no
operation log — the inverse is derived at undo time.

Undo of Class A data goes through CAS like any other write, so it can be rejected,
and that is correct.

### Taste rules

1. **Never hijack a focused text input.** `isTyping` is already computed in
   `AppShell.tsx` but is only applied to Delete/Backspace. Apply it to undo, redo,
   and the `R` rotate shortcut. Let the browser handle native text undo.
2. **Coalesce.** Text editing collapses to one entry (snapshot on focus, commit
   on blur/Enter). Drags snapshot at drag *start* — the existing pattern, keep it.
   Repeats of the same action on the same entity within 2 s merge into one entry.
3. **Restore selection, not viewport.** Undoing a delete re-selects and reveals
   the restored entity. Do not restore zoom, panel widths, or which page was open.
4. **Auto-navigate to the change.** If an undo affects something not visible in
   the current view, switch to a view where it is visible before applying. Silent
   off-screen undo is the worst outcome.
5. **Cover the gaps.** Renames, property edits, deletes, signal/path edits,
   library edits, and the server-first routing calls (`POST /api/paths/route`,
   signal creation in `GraphView.tsx`) currently push no snapshot. They all must.
6. Depth stays at 60. Redo clears on new edit.

### The staleness indicator

A chip in the Topbar, immediately left of the undo/redo buttons.

- **Green** — nobody else has written to this harness since the snapshot at the
  top of your undo stack. Undo is unambiguous.
- **Red** — someone else has written since. Undo may cross their work.
- **Grey** — nothing to undo.

Clicking opens a popover explaining, in plain language:

> **Undo is per-person and time-ordered.**
> VibeWire undoes *your* last change, not the most recent change overall. When
> someone else has edited since you did, undoing can revert work that isn't yours,
> or fail because the document moved on.
>
> Right now: **Joe edited this harness 40 seconds ago.**
>
> If you're not sure, save a checkpoint first.

When red and the user triggers undo, show a confirmation naming whose work is at
risk and which entities would revert, with **Undo anyway** and **Cancel**. This is
the "undo someone else's edit with a warning" requirement. Do not silently block
it — warn and let them decide.

---

## 8. Edit log

Derived at the API boundary, not instrumented into the client. One JSONL line per
successful write:

```jsonc
{ "ts": "2026-08-04T19:22:31Z", "user": "u_123", "displayName": "Joe",
  "harness": "fsae-car", "kind": "harness", "rev": 43,
  "added": 0, "modified": 2, "removed": 0,
  "entityIds": ["con_012", "path_034"] }
```

Counts come from diffing the previous revision snapshot against the new one, which
the history directory already has. `GET /api/activity` aggregates per user per
day.

Be honest in the UI about what this measures: it counts **saves**, which is an
activity proxy, not a count of semantic edits. Label it "changes saved".

Attribution (`attribution/<harness>.json`) is updated from the same diff:
`entityId -> { by, at, rev }`. This is what the undo staleness warning and the
per-entity "last edited by Joe" tooltip read from.

---

## 9. Out of scope

- Hosting, tunnels, and deployment. Decided later.
- Public read-only sharing.
- Merging Class A data. Explicitly rejected: CAS with a short conflict window and
  a clear error is the design, not a placeholder for merging.
- Field-level merge, reference-closure analysis, CRDTs, operation logs.
