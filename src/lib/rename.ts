import type {
  EntityType,
  HarnessData,
  SubsystemDocument,
} from '../types';

export function normalizeDisplayName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error('Name cannot be empty.');
  if ([...name].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  })) {
    throw new Error('Name cannot contain control characters or line breaks.');
  }
  return name;
}

export function renameHarnessEntity(
  harness: HarnessData,
  type: EntityType,
  id: string,
  value: string,
): HarnessData {
  const name = normalizeDisplayName(value);
  const next = structuredClone(harness);
  const collection = type === 'mergePoint'
    ? next.mergePoints
    : type === 'path'
      ? next.paths
      : next[`${type}s` as 'enclosures' | 'connectors' | 'signals'];
  const entity = collection.find((item) => item.id === id);
  if (!entity) throw new Error(`Cannot rename missing ${type} '${id}'.`);
  if (entity.name === name) return harness;
  entity.name = name;
  return next;
}

export function renameSystem(harness: HarnessData, value: string): HarnessData {
  const name = normalizeDisplayName(value);
  if (harness.name === name) return harness;
  return { ...harness, name };
}

export function renameSubsystem(
  subsystem: SubsystemDocument,
  value: string,
): SubsystemDocument {
  const name = normalizeDisplayName(value);
  if (subsystem.name === name) return subsystem;
  return { ...subsystem, name };
}