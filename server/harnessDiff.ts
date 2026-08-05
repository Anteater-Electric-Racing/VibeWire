/**
 * Pure, deterministic entity diffing for harness documents and keyed sidecars.
 *
 * Harness collections are compared by stable entity id; map documents are
 * compared by their top-level keys. Inputs are never mutated.
 */
export interface EntityDiff {
  added: string[];
  modified: string[];
  removed: string[];
}

export interface DiffableEntity {
  id: string;
}

export interface DiffableHarness {
  enclosures?: readonly DiffableEntity[];
  connectors?: readonly DiffableEntity[];
  mergePoints?: readonly DiffableEntity[];
  paths?: readonly DiffableEntity[];
  signals?: readonly DiffableEntity[];
  signalPropertyDefinitions?: readonly DiffableEntity[];
}

const HARNESS_COLLECTIONS = [
  'enclosures',
  'connectors',
  'mergePoints',
  'paths',
  'signals',
  'signalPropertyDefinitions',
] as const;

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (typeof left !== 'object') return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => deepEqual(value, right[index]));
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (
    leftKeys.length !== rightKeys.length
    || leftKeys.some((key, index) => key !== rightKeys[index])
  ) {
    return false;
  }
  return leftKeys.every((key) => deepEqual(leftRecord[key], rightRecord[key]));
}

function harnessEntities(
  harness: DiffableHarness | null | undefined,
  label: 'previous' | 'next',
): Map<string, DiffableEntity> {
  const entities = new Map<string, DiffableEntity>();
  for (const collectionName of HARNESS_COLLECTIONS) {
    const collection = harness?.[collectionName] ?? [];
    if (!Array.isArray(collection)) {
      throw new Error(`Cannot diff ${label} harness: '${collectionName}' must be an array.`);
    }
    for (const entity of collection) {
      if (!entity || typeof entity !== 'object' || typeof entity.id !== 'string' || !entity.id) {
        throw new Error(
          `Cannot diff ${label} harness: '${collectionName}' contains an entity without a valid id.`,
        );
      }
      if (entities.has(entity.id)) {
        throw new Error(`Cannot diff ${label} harness: duplicate entity id '${entity.id}'.`);
      }
      entities.set(entity.id, entity);
    }
  }
  return entities;
}

function diffMaps(
  previous: ReadonlyMap<string, unknown>,
  next: ReadonlyMap<string, unknown>,
): EntityDiff {
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];

  for (const [key, nextValue] of next) {
    if (!previous.has(key)) added.push(key);
    else if (!deepEqual(previous.get(key), nextValue)) modified.push(key);
  }
  for (const key of previous.keys()) {
    if (!next.has(key)) removed.push(key);
  }

  added.sort();
  modified.sort();
  removed.sort();
  return { added, modified, removed };
}

export function diffHarness(
  prev?: DiffableHarness | null,
  next?: DiffableHarness | null,
): EntityDiff {
  return diffMaps(
    harnessEntities(prev, 'previous'),
    harnessEntities(next, 'next'),
  );
}

export function diffKeyedMap<T>(
  prev?: Readonly<Record<string, T>> | null,
  next?: Readonly<Record<string, T>> | null,
): EntityDiff {
  return diffMaps(
    new Map(Object.entries(prev ?? {})),
    new Map(Object.entries(next ?? {})),
  );
}
