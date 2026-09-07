# Documentation index

Canonical as-built documentation for VibeWire. Start with the smallest page matching the task.
Everything under [`public/user-data/`](../public/user-data/README.md) is fixture/test data, not
product documentation.

- Human onboarding: [`README.md`](../README.md)
- Agent workflow and read order: [`AGENTS.md`](../AGENTS.md)
- Change workflow: [`CONTRIBUTING.md`](../CONTRIBUTING.md)
- Product history: [`CHANGELOG.md`](../CHANGELOG.md)

## Task map

| Task | Canonical page |
| --- | --- |
| Entity meaning, names, IDs, topology | [Domain model](./domain-model.md) |
| Modules, startup, state boundaries, ownership | [Architecture](./architecture.md) |
| Files, schemas, API, autosave, sheet limits | [Persistence](./persistence.md) |
| Graph visibility, routes, joins, images, gestures | [Canvas](./canvas.md) |
| Focused System projections and routing | [Subsystems](./subsystems.md) |
| Physical grouping, lengths, progress, BOM | [Manufacturing](./manufacturing.md) |
| Auth, sync, presence, attribution, undo, checkpoints | [Collaboration](./collaboration.md) |
| Commands, suite ownership, validation | [Testing](./testing.md) |
| Historical names, paths, fields, and readers | [Migrations](./migrations.md) |

## Vocabulary

**System** · **HierarchyEntity** (**Device** or **Enclosure**) · **Bulkhead connector** · **Path** ·
**Wire** · **Harness Bundle** · **Branch Point** · **Shared Anchor**. Navigation is **Open
enclosure** / **Close enclosure**. Definitions and invariants: [domain model](./domain-model.md).

Root `Architecture.md` and `Collaboration.md` are compatibility redirects only. Update their
canonical pages here, not the redirects.
