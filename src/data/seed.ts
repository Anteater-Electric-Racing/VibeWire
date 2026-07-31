/**
 * Harness data is loaded at runtime via the API (/api/harness?harness=<name>).
 * Multiple harness files are supported — each .json file in public/user-data/harnesses/
 * becomes a selectable harness in the top-bar switcher.
 *
 * The canonical data files:
 *   - user-data/harnesses/<name>.json              — harness data (one file per harness)
 *   - user-data/connectors/connector-library.json  — connector type definitions (shared)
 *   - user-data/layouts.<name>.json                — per-harness node positions (auto-generated)
 */
export {};
