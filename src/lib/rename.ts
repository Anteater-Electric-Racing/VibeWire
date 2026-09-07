import type {
  EntityType,
  SystemData,
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

export function renameSystemEntity(
  system: SystemData,
  type: EntityType,
  id: string,
  value: string,
): SystemData {
  const name = normalizeDisplayName(value);
  const next = structuredClone(system);
  const collection = type === 'branchPoint'
    ? next.branchPoints
    : type === 'path'
      ? next.paths
      : type === 'enclosure'
        ? next.hierarchy
        : next[`${type}s` as 'connectors' | 'signals'];
  const entity = collection.find((item) => item.id === id);
  if (!entity) throw new Error(`Cannot rename missing ${type} '${id}'.`);
  if (entity.name === name) return system;
  entity.name = name;
  return next;
}

export function renameSystem(system: SystemData, value: string): SystemData {
  const name = normalizeDisplayName(value);
  if (system.name === name) return system;
  return { ...system, name };
}

export function renameSubsystem(
  subsystem: SubsystemDocument,
  value: string,
): SubsystemDocument {
  const name = normalizeDisplayName(value);
  if (subsystem.name === name) return subsystem;
  return { ...subsystem, name };
}