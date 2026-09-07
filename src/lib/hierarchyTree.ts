import type { Connector, HierarchyEntity, BranchPoint, Path, Signal } from '../types';
import { getPathSignalId, type ConnectorSignalGroup } from './systemTopology';

export function matchesQuery(text: string, query: string): boolean {
  return text.toLowerCase().includes(query);
}

export function signalGroupMatchesQuery(group: ConnectorSignalGroup, query: string): boolean {
  if (!query) return false;
  if (matchesQuery(group.signalName, query)) return true;
  if (group.signalId && matchesQuery(group.signalId, query)) return true;
  return group.paths.some(
    (path) => matchesQuery(path.pathName, query) || matchesQuery(path.pathId, query),
  );
}

/** Collect IDs that match the query, plus ancestors (and enclosure descendants). */
export function buildHierarchySearch(
  query: string,
  enclosures: HierarchyEntity[],
  connectors: Connector[],
  branchPoints: BranchPoint[],
  paths: Path[],
  signals: Signal[],
): { visibleIds: Set<string>; expandedIds: Set<string> } {
  const visible = new Set<string>();
  const expanded = new Set<string>();
  if (!query) return { visibleIds: visible, expandedIds: expanded };

  const parentById = new Map<string, string | null>();
  const childrenByParent = new Map<string, string[]>();
  const register = (id: string, parent: string | null) => {
    parentById.set(id, parent);
    if (!parent) return;
    const siblings = childrenByParent.get(parent);
    if (siblings) siblings.push(id);
    else childrenByParent.set(parent, [id]);
  };
  for (const e of enclosures) register(e.id, e.parent);
  for (const c of connectors) register(c.id, c.parent);
  for (const m of branchPoints) register(m.id, m.parent);

  const markWithAncestors = (id: string) => {
    let current: string | null | undefined = id;
    while (current) {
      if (visible.has(current)) break;
      visible.add(current);
      current = parentById.get(current) ?? null;
    }
  };
  const markAncestorsExpanded = (id: string) => {
    let current = parentById.get(id) ?? null;
    while (current) {
      expanded.add(current);
      current = parentById.get(current) ?? null;
    }
  };
  const markDescendantsVisible = (id: string) => {
    const children = childrenByParent.get(id);
    if (!children) return;
    for (const childId of children) {
      visible.add(childId);
      markDescendantsVisible(childId);
    }
  };

  for (const e of enclosures) {
    if (matchesQuery(e.name, query) || matchesQuery(e.id, query)) {
      markWithAncestors(e.id);
      markAncestorsExpanded(e.id);
      expanded.add(e.id);
      markDescendantsVisible(e.id);
    }
  }
  for (const c of connectors) {
    if (matchesQuery(c.name, query) || matchesQuery(c.id, query)) {
      markWithAncestors(c.id);
      markAncestorsExpanded(c.id);
    }
  }
  for (const m of branchPoints) {
    if (matchesQuery(m.name, query) || matchesQuery(m.id, query)) {
      markWithAncestors(m.id);
      markAncestorsExpanded(m.id);
    }
  }

  const signalById = new Map(signals.map((signal) => [signal.id, signal]));
  for (const path of paths) {
    const signalId = getPathSignalId(path);
    const signal = signalId ? signalById.get(signalId) : undefined;
    const hits =
      matchesQuery(path.id, query)
      || (signalId ? matchesQuery(signalId, query) : false)
      || (signal ? matchesQuery(signal.name, query) : false);
    if (!hits) continue;
    for (const node of path.nodes) {
      const nodeId = node.kind === 'connector' ? node.connector_id : node.branch_point_id;
      markWithAncestors(nodeId);
      markAncestorsExpanded(nodeId);
    }
  }

  return { visibleIds: visible, expandedIds: expanded };
}
