export interface ParsedTag {
  raw: string;
  namespace: string | null;
  value: string;
}

export function parseTag(tag: string): ParsedTag {
  const colonIdx = tag.indexOf(':');
  if (colonIdx === -1) {
    return { raw: tag, namespace: null, value: tag };
  }
  return {
    raw: tag,
    namespace: tag.slice(0, colonIdx),
    value: tag.slice(colonIdx + 1),
  };
}

export function groupTagsByNamespace(tags: string[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const tag of tags) {
    const parsed = parseTag(tag);
    const ns = parsed.namespace ?? 'notes';
    const existing = grouped.get(ns);
    if (existing) {
      if (!existing.includes(parsed.value)) existing.push(parsed.value);
    } else {
      grouped.set(ns, [parsed.value]);
    }
  }
  return grouped;
}

export function collectAllTags(
  items: Array<{ tags: string[] }>,
): Map<string, Set<string>> {
  const namespaces = new Map<string, Set<string>>();
  for (const item of items) {
    for (const tag of item.tags) {
      const parsed = parseTag(tag);
      const ns = parsed.namespace ?? 'notes';
      const existing = namespaces.get(ns);
      if (existing) {
        existing.add(parsed.value);
      } else {
        namespaces.set(ns, new Set([parsed.value]));
      }
    }
  }
  return namespaces;
}

export function itemMatchesFilters(
  tags: string[],
  activeFilters: Map<string, Set<string>>,
): boolean {
  if (activeFilters.size === 0) return true;

  for (const [namespace, values] of activeFilters) {
    if (values.size === 0) continue;
    const itemValues = tags
      .map(parseTag)
      .filter((p) => (p.namespace ?? 'notes') === namespace)
      .map((p) => p.value);
    const hasMatch = itemValues.some((v) => values.has(v));
    if (!hasMatch) return false;
  }
  return true;
}
