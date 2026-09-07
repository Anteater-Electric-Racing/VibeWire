# Contributing

## Changes

Keep the diff scoped to the requested work. Use canonical names from [`docs/domain-model.md`](docs/domain-model.md). Legacy names belong only in [`docs/migrations.md`](docs/migrations.md) and compatibility readers.

## Tests

- `npm test` runs the full suite, including documentation-index checks.
- `npm run test:docs` checks canonical pages, index links, and that every `test:*` script is named in [`docs/testing.md`](docs/testing.md).
- When you add or change behavior, update the matching `test:*` script (or add one) and name that script in `docs/testing.md`.

## Documentation

Follow [`AGENTS.md`](AGENTS.md). In-scope behavior and architecture changes update the matching page under [`docs/`](docs/README.md) in the same change. New gestures and non-obvious UI go in Tips (`SettingsModal`). New or materially changed product features also receive a dated [`CHANGELOG.md`](CHANGELOG.md) entry. Ask in chat before unrelated backdocumentation or cleanup.
