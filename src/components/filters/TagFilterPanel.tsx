import { useMemo } from 'react';
import { useHarnessStore } from '../../store';

const NAMESPACE_ORDER = [
  'signal',
  'system',
  'location',
  'status',
  'bundle',
  'notes',
];

function namespaceSort(a: string, b: string): number {
  const ai = NAMESPACE_ORDER.indexOf(a);
  const bi = NAMESPACE_ORDER.indexOf(b);
  if (ai !== -1 && bi !== -1) return ai - bi;
  if (ai !== -1) return -1;
  if (bi !== -1) return 1;
  return a.localeCompare(b);
}

export function TagFilterPanel() {
  const getAllTagNamespaces = useHarnessStore((s) => s.getAllTagNamespaces);
  const activeFilters = useHarnessStore((s) => s.activeFilters);
  const toggleFilter = useHarnessStore((s) => s.toggleFilter);
  const clearFilters = useHarnessStore((s) => s.clearFilters);

  const namespaces = useMemo(() => {
    const map = getAllTagNamespaces();
    const sorted = Array.from(map.entries()).sort(([a], [b]) =>
      namespaceSort(a, b),
    );
    return sorted;
  }, [getAllTagNamespaces]);

  const hasActiveFilters = activeFilters.size > 0;

  return (
    <div className="py-1 select-none">
      {hasActiveFilters && (
        <div className="px-2 pt-1 flex justify-end">
          <button
            onClick={clearFilters}
            className="text-[10px] text-amber-500 hover:text-amber-400"
          >
            Clear all
          </button>
        </div>
      )}
      <div className="space-y-2 px-2 py-1">
        {namespaces.map(([namespace, values]) => (
          <div key={namespace}>
            <div className="text-[10px] text-zinc-500 font-medium mb-0.5">
              {namespace}
            </div>
            <div className="flex flex-wrap gap-1">
              {Array.from(values)
                .sort()
                .map((value) => {
                  const isActive =
                    activeFilters.get(namespace)?.has(value) ?? false;
                  return (
                    <button
                      key={value}
                      onClick={() => toggleFilter(namespace, value)}
                      className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                        isActive
                          ? 'bg-amber-600 text-white'
                          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300'
                      }`}
                    >
                      {value}
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
