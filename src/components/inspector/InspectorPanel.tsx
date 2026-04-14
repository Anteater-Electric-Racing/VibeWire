import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { ImagePickerPanel } from '../graph/ImagePickerPanel';
import { useHarnessStore } from '../../store';
import type {
  Connector,
  ConnectorType,
  Enclosure,
  MergePoint,
  Path,
  Signal,
  TextBoxFontFamily,
  TextBoxFontWeight,
  TextBoxLayout,
  TextBoxTextAlign,
} from '../../types';
import {
  getWireAppearance,
  getWireBackground,
  getWireBorderColor,
  type WireAppearance,
} from '../../lib/colors';
import {
  countPathsTouchingConnectors,
  getConnectorOccupancy,
  getEnclosureConnectors,
  getPathNodeLabel,
  getPathSignalName,
} from '../../lib/harness';

function TagPill({
  tag,
  onRemove,
}: {
  tag: string;
  onRemove?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">
      {tag}
      {onRemove && (
        <button
          onClick={onRemove}
          className="text-zinc-500 hover:text-red-400 ml-0.5"
        >
          ×
        </button>
      )}
    </span>
  );
}

function TagEditor({
  entityType,
  entityId,
  tags,
}: {
  entityType: string;
  entityId: string;
  tags: string[];
}) {
  const addTag = useHarnessStore((s) => s.addTag);
  const removeTag = useHarnessStore((s) => s.removeTag);
  const getAllExistingTags = useHarnessStore((s) => s.getAllExistingTags);
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const allTags = useMemo(() => getAllExistingTags(), [getAllExistingTags]);

  const suggestions = useMemo(() => {
    if (!input) return [];
    return allTags
      .filter((t) => t.toLowerCase().includes(input.toLowerCase()))
      .filter((t) => !tags.includes(t))
      .slice(0, 8);
  }, [input, allTags, tags]);

  const handleAdd = (tag: string) => {
    if (tag && !tags.includes(tag)) {
      addTag(entityType, entityId, tag);
    }
    setInput('');
    setShowSuggestions(false);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-1.5">
        {tags.map((tag) => (
          <TagPill
            key={tag}
            tag={tag}
            onRemove={() => removeTag(entityType, entityId, tag)}
          />
        ))}
      </div>
      <div className="relative">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && input) {
              handleAdd(input);
            }
          }}
          placeholder="Add tag…"
          className="w-full text-[11px] px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-zinc-300 placeholder-zinc-600 focus:border-amber-600 focus:outline-none"
        />
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-10 top-full left-0 right-0 mt-0.5 bg-zinc-800 border border-zinc-700 rounded shadow-lg max-h-32 overflow-y-auto">
            {suggestions.map((s) => (
              <button
                key={s}
                onMouseDown={() => handleAdd(s)}
                className="w-full text-left text-[11px] px-2 py-1 text-zinc-300 hover:bg-zinc-700"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PropertyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="text-[10px] text-zinc-500 w-20 shrink-0 text-right">
        {label}
      </span>
      <span className="text-[11px] text-zinc-300 break-all">{value}</span>
    </div>
  );
}

function WireColorSwatch({
  appearance,
  className = 'w-2 h-2 rounded-full',
}: {
  appearance: WireAppearance | null;
  className?: string;
}) {
  if (appearance?.kind === 'striped' && appearance.colors.length >= 2) {
    return (
      <span className="inline-flex shrink-0 gap-px">
        {appearance.colors.slice(0, 2).map((color, i) => (
          <span
            key={i}
            className={`inline-block border ${className}`}
            style={{ background: color, borderColor: color }}
          />
        ))}
      </span>
    );
  }
  return (
    <span
      className={`inline-block shrink-0 border ${className}`}
      style={{
        background: getWireBackground(appearance),
        borderColor: getWireBorderColor(appearance),
      }}
    />
  );
}

function ParentLink({ parentId }: { parentId: string }) {
  const selectItem = useHarnessStore((s) => s.selectItem);
  const harness = useHarnessStore((s) => s.harness);

  if (!harness) return null;

  const enc = harness.enclosures.find((e) => e.id === parentId);
  const name = enc?.name ?? parentId;

  return (
    <button
      onClick={() => selectItem({ type: 'enclosure', id: parentId })}
      className="text-[11px] text-amber-400 hover:text-amber-300 underline underline-offset-2"
    >
      {name}
    </button>
  );
}

const STATUS_OPTIONS = [
  { value: '', label: '— none' },
  { value: 'cut', label: 'Cut' },
  { value: 'crimped', label: 'Crimped' },
  { value: 'qcd', label: "QC'd" },
] as const;

const STATUS_COLORS: Record<string, string> = {
  cut: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  crimped: 'bg-teal-900/50 text-teal-300 border-teal-700',
  qcd: 'bg-green-900/50 text-green-300 border-green-700',
};

function PathStatusEditor({ pathId, tags }: { pathId: string; tags: string[] }) {
  const addTag = useHarnessStore((s) => s.addTag);
  const removeTag = useHarnessStore((s) => s.removeTag);
  const [nameInput, setNameInput] = useState('');

  const currentStatusTag = tags.find((t) => t.startsWith('status:'));
  const currentStatus = currentStatusTag?.slice(7) ?? '';
  const currentByTag = tags.find((t) => t.startsWith('by:'));
  const currentBy = currentByTag?.slice(3) ?? '';

  const handleStatusChange = (newVal: string) => {
    if (currentStatusTag) removeTag('path', pathId, currentStatusTag);
    if (newVal) addTag('path', pathId, `status:${newVal}`);
  };

  const handleNameCommit = () => {
    const name = nameInput.trim();
    if (!name) return;
    if (currentByTag) removeTag('path', pathId, currentByTag);
    addTag('path', pathId, `by:${name}`);
    setNameInput('');
  };

  const handleRemoveName = () => {
    if (currentByTag) removeTag('path', pathId, currentByTag);
  };

  const colorClass = currentStatus ? (STATUS_COLORS[currentStatus] ?? 'bg-zinc-700/50 text-zinc-300 border-zinc-600') : '';

  return (
    <div className="mt-2 pt-2 border-t border-zinc-700/50">
      <div className="text-[10px] text-zinc-500 font-medium mb-2">Status</div>
      <div className="flex gap-2 items-center mb-2">
        <select
          value={currentStatus}
          onChange={(e) => handleStatusChange(e.target.value)}
          className={`flex-1 text-[11px] px-2 py-1 rounded border bg-zinc-900 focus:outline-none focus:border-amber-600 cursor-pointer ${
            currentStatus ? colorClass : 'text-zinc-400 border-zinc-700'
          }`}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-zinc-900 text-zinc-200">
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {currentStatus && (
        <div className="flex gap-2 items-center">
          {currentBy ? (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className="text-[10px] text-zinc-500 shrink-0">by</span>
              <span className="text-[11px] text-zinc-300 truncate">{currentBy}</span>
              <button
                onClick={handleRemoveName}
                className="text-zinc-600 hover:text-red-400 text-[11px] ml-auto shrink-0"
              >
                ×
              </button>
            </div>
          ) : (
            <div className="flex gap-1.5 flex-1">
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleNameCommit(); }}
                placeholder="Who did this?"
                className="flex-1 text-[11px] px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-zinc-300 placeholder-zinc-600 focus:border-amber-600 focus:outline-none"
              />
              <button
                onClick={handleNameCommit}
                disabled={!nameInput.trim()}
                className="text-[11px] px-2 py-1 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ✓
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SignalInfo({ signalName, appearance }: { signalName: string; appearance?: WireAppearance | null }) {
  const harness = useHarnessStore((s) => s.harness);
  if (!harness) return null;

  const signal = harness.signals.find(
    (s: Signal) => s.name === signalName,
  );
  if (!signal) return null;

  const typeTags = signal.tags
    .filter((t) => t.includes(':'))
    .map((t) => ({ ns: t.slice(0, t.indexOf(':')), val: t.slice(t.indexOf(':') + 1) }));
  const otherTags = signal.tags.filter((t) => !t.includes(':'));

  return (
    <div className="mt-2 pt-2 border-t border-zinc-700/50">
      <div className="flex items-center gap-1.5 mb-1.5">
        <WireColorSwatch appearance={appearance ?? null} className="w-2 h-2 rounded-full" />
        <span className="text-[10px] text-zinc-400 font-medium">
          Signal: {signal.name}
        </span>
      </div>
      {typeTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {typeTags.map(({ ns, val }) => (
            <span
              key={`${ns}:${val}`}
              className="text-[9px] px-1.5 py-px rounded bg-zinc-700/60 text-zinc-400"
            >
              <span className="text-zinc-500">{ns}:</span>
              {val}
            </span>
          ))}
          {otherTags.map((t) => (
            <span
              key={t}
              className="text-[9px] px-1.5 py-px rounded bg-zinc-700/60 text-zinc-400"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      {Object.entries(signal.properties)
        .filter(([key]) => !key.startsWith('_'))
        .map(([key, value]) => (
          <PropertyRow key={key} label={key} value={value} />
        ))}
    </div>
  );
}

function ConnectorOccupancyTable({
  connector,
}: {
  connector: Connector;
}) {
  const harness = useHarnessStore((s) => s.harness);
  const connectorLibrary = useHarnessStore((s) => s.connectorLibrary);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  if (!harness) return null;

  const ct = connectorLibrary?.connector_types.find(
    (t: ConnectorType) => t.id === connector.connector_type,
  );
  const pinCount = ct?.pin_count ?? Math.max(0, ...getConnectorOccupancy(harness, connector.id).map((entry) => entry.pinNumber));
  const occupancy = getConnectorOccupancy(harness, connector.id);
  const rows = Array.from({ length: pinCount }, (_, index) => {
    const pinNumber = index + 1;
    const items = occupancy.filter((entry) => entry.pinNumber === pinNumber);
    return { pinNumber, items };
  });

  const togglePath = (key: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="mt-2 pt-2 border-t border-zinc-700/50">
      <div className="text-[10px] text-zinc-500 font-medium mb-1">
        Occupancy
      </div>
      <div className="space-y-0.5">
        {rows.map((row) => (
          <div key={row.pinNumber} className="border-b border-zinc-800/40 pb-0.5">
            <div className="flex gap-2 items-start py-0.5">
              {/* Pin number */}
              <span className="font-mono text-[10px] text-zinc-500 w-5 shrink-0 text-right pt-0.5">
                {row.pinNumber}
              </span>

              {/* Content */}
              <div className="flex-1 min-w-0">
                {row.items.length === 0 ? (
                  <span className="text-[10px] text-zinc-600 italic">— unconnected</span>
                ) : (
                  <div className="space-y-0.5">
                    {row.items.length > 1 && (
                      <div className="text-[9px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-800/40 mb-1">
                        ⚠ {row.items.length} paths share this pin
                      </div>
                    )}
                    {row.items.map((item, index) => {
                      const expandKey = `${row.pinNumber}:${item.pathId}`;
                      const isExpanded = expandedPaths.has(expandKey);
                      const path = harness.paths.find((p) => p.id === item.pathId);
                      const appearance = path ? getWireAppearance(path) : null;

                      return (
                        <div
                          key={`${item.pathId}-${index}`}
                          className={`rounded border ${
                            row.items.length > 1
                              ? 'border-amber-800/40 bg-amber-900/10'
                              : 'border-zinc-700/30 bg-zinc-800/30'
                          }`}
                        >
                          {/* Path header row */}
                          <div className="flex items-center gap-1 px-1.5 py-0.5">
                            <button
                              onClick={() => togglePath(expandKey)}
                              className="flex items-center gap-1 flex-1 min-w-0 text-left group"
                              title={isExpanded ? 'Collapse route' : 'Expand route'}
                            >
                              <span className="text-zinc-600 group-hover:text-zinc-400 text-[8px] shrink-0 transition-colors">
                                {isExpanded ? '▼' : '▶'}
                              </span>
                              <WireColorSwatch
                                appearance={appearance ?? null}
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                              />
                              <span className="text-[10px] text-zinc-300 truncate group-hover:text-zinc-100 transition-colors">
                                {item.pathName}
                              </span>
                              {item.signalName && (
                                <span className="text-[9px] text-zinc-500 ml-auto shrink-0 pl-1">
                                  {item.signalName}
                                </span>
                              )}
                            </button>
                            <button
                              onClick={() => selectItem({ type: 'path', id: item.pathId })}
                              className="text-zinc-600 hover:text-amber-400 text-[10px] shrink-0 transition-colors px-0.5"
                              title="Go to path"
                            >
                              ↗
                            </button>
                          </div>

                          {/* Expanded route */}
                          {isExpanded && path && (
                            <div className="px-2 pb-1.5 pt-1 border-t border-zinc-700/30">
                              <div className="text-[9px] text-zinc-500 mb-1">
                                Route · {path.nodes.length} node{path.nodes.length !== 1 ? 's' : ''}
                              </div>
                              <div className="space-y-px">
                                {path.nodes.map((node, nodeIndex) => {
                                  const label = getPathNodeLabel(harness, node);
                                  const isCurrent =
                                    node.kind === 'connector' &&
                                    node.connector_id === connector.id &&
                                    node.pin_number === row.pinNumber;
                                  const isLast = nodeIndex === path.nodes.length - 1;
                                  return (
                                    <div key={`${label}-${nodeIndex}`} className="flex items-start gap-1.5">
                                      <div className="flex flex-col items-center shrink-0 w-3">
                                        <span
                                          className={`font-mono text-[8px] leading-none mt-0.5 ${
                                            isCurrent ? 'text-amber-500' : 'text-zinc-600'
                                          }`}
                                        >
                                          {nodeIndex + 1}
                                        </span>
                                        {!isLast && (
                                          <span className="text-zinc-700 text-[8px] leading-none mt-px">│</span>
                                        )}
                                      </div>
                                      <span
                                        className={`text-[10px] leading-tight ${
                                          isCurrent
                                            ? 'text-amber-400 font-medium'
                                            : 'text-zinc-400'
                                        }`}
                                      >
                                        {label}
                                        {isCurrent && (
                                          <span className="text-[8px] text-amber-600 ml-1">← here</span>
                                        )}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BundleInspector({ pathIds }: { pathIds: string[] }) {
  const harness = useHarnessStore((s) => s.harness);
  const selectItem = useHarnessStore((s) => s.selectItem);

  if (!harness) return null;

  const paths = pathIds
    .map((id) => harness.paths.find((path) => path.id === id))
    .filter(Boolean) as Path[];

  if (paths.length === 0) return null;

  const signalAppearances = new Map<string, WireAppearance>();
  for (const path of paths) {
    const sig = getPathSignalName(path);
    if (sig && !signalAppearances.has(sig)) {
      signalAppearances.set(sig, getWireAppearance(path));
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-bold text-zinc-100">
          Path Bundle
        </span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">
          {paths.length} paths
        </span>
      </div>

      {signalAppearances.size > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {[...signalAppearances.entries()].map(([sig, appearance]) => (
            <span
              key={sig}
              className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/60"
            >
              <WireColorSwatch appearance={appearance} className="w-1.5 h-1.5 rounded-full" />
              <span className="text-zinc-300">{sig}</span>
            </span>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        {paths.map((path) => {
          const sig = getPathSignalName(path);
          const appearance = getWireAppearance(path);
          const start = path.nodes[0] ? getPathNodeLabel(harness, path.nodes[0]) : 'Unknown';
          const end = path.nodes[path.nodes.length - 1]
            ? getPathNodeLabel(harness, path.nodes[path.nodes.length - 1])
            : 'Unknown';

          return (
            <button
              key={path.id}
              onClick={() =>
                selectItem({ type: 'path', id: path.id })
              }
              className="w-full text-left p-1.5 rounded bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/30 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <WireColorSwatch appearance={appearance} className="w-2 h-2 rounded-full" />
                <span className="text-[10px] text-zinc-300 font-medium">
                  {sig ?? path.name}
                </span>
                <span className="text-[9px] text-zinc-500 ml-auto">
                  {appearance.label}
                </span>
              </div>
              <div className="text-[9px] text-zinc-500 mt-0.5">
                {start} → {end}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function EnclosureInspector({ enc }: { enc: Enclosure }) {
  const harness = useHarnessStore((s) => s.harness);
  const updateEnclosureProperty = useHarnessStore((s) => s.updateEnclosureProperty);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const [imgPickerOpen, setImgPickerOpen] = useState(false);
  const closeImgPicker = useCallback(() => setImgPickerOpen(false), []);

  if (!harness) return null;
  const childEnclosures = harness.enclosures.filter((e) => e.parent === enc.id);
  const allConnectors = getEnclosureConnectors(harness, enc.id);
  const directConnectors = harness.connectors.filter((c) => c.parent === enc.id);
  const directMergePoints = harness.mergePoints.filter((mergePoint) => mergePoint.parent === enc.id);
  const encImage = enc.properties?.image as string | undefined;
  const pathCount = countPathsTouchingConnectors(harness, allConnectors.map((connector) => connector.id));

  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-bold text-zinc-100">{enc.name}</span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded ${enc.container ? 'bg-zinc-700 text-zinc-300' : 'bg-teal-900/60 text-teal-300'}`}>
          {enc.container ? 'Container' : 'Surface'}
        </span>
      </div>
      {enc.parent && <div className="mb-1"><ParentLink parentId={enc.parent} /></div>}

      <div className="mb-2">
        {encImage ? (
          <div className="rounded overflow-hidden border border-zinc-700/60 bg-zinc-800">
            <img src={`/user-data/images/${encImage}`} alt={enc.name} className="w-full object-contain" style={{ maxHeight: 130 }} />
          </div>
        ) : (
          <div className="rounded border border-dashed border-zinc-700 bg-zinc-800/40 flex items-center justify-center text-[10px] text-zinc-600 italic" style={{ height: 52 }}>
            No image
          </div>
        )}
        <div className="mt-1 relative">
          <button onClick={() => setImgPickerOpen((p) => !p)} className="w-full text-[10px] text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded py-0.5 transition-colors">
            {encImage ? '⇄ Change image' : '+ Set image'}
          </button>
          {encImage && (
            <button onClick={() => updateEnclosureProperty(enc.id, 'image', '')} className="absolute right-0 top-0 bottom-0 px-2 text-zinc-500 hover:text-red-400 text-[10px]" title="Remove">✕</button>
          )}
          {imgPickerOpen && (
            <div className="absolute left-0 right-0 z-50" style={{ top: '100%' }}>
              <ImagePickerPanel onPick={(f) => { updateEnclosureProperty(enc.id, 'image', f); setImgPickerOpen(false); }} onClose={closeImgPicker} />
            </div>
          )}
        </div>
      </div>

      {Object.entries(enc.properties ?? {}).filter(([k]) => k !== 'image').map(([k, v]) => (
        <PropertyRow key={k} label={k} value={v} />
      ))}

      <div className="mt-2 pt-2 border-t border-zinc-700/50">
        <TagEditor entityType="enclosure" entityId={enc.id} tags={enc.tags} />
      </div>

      <div className="mt-2 pt-2 border-t border-zinc-700/50">
        <div className="text-[10px] text-zinc-500 font-medium mb-1">Summary</div>
        <div className="text-[11px] text-zinc-300 space-y-0.5">
          {childEnclosures.length > 0 && <div>{childEnclosures.length} sub-enclosure{childEnclosures.length !== 1 ? 's' : ''}</div>}
          <div>{allConnectors.length} connector{allConnectors.length !== 1 ? 's' : ''}</div>
          <div>{directMergePoints.length} merge point{directMergePoints.length !== 1 ? 's' : ''}</div>
          <div>{pathCount} path{pathCount !== 1 ? 's' : ''}</div>
        </div>
      </div>

      {childEnclosures.length > 0 && (
        <div className="mt-2 pt-2 border-t border-zinc-700/50">
          <div className="text-[10px] text-zinc-500 font-medium mb-1">Sub-enclosures</div>
          <div className="space-y-0.5">
            {childEnclosures.map((child) => {
              const childCons = harness.connectors.filter((c) => c.parent === child.id);
              return (
                <button
                  key={child.id}
                  onClick={() => selectItem({ type: 'enclosure', id: child.id })}
                  className="w-full text-left flex items-center justify-between py-0.5 px-1.5 rounded hover:bg-zinc-800 transition-colors"
                >
                  <span className="text-[11px] text-amber-400 hover:text-amber-300">{child.name}</span>
                  <span className="text-zinc-500 text-[10px]">{childCons.length} connector{childCons.length !== 1 ? 's' : ''}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-2 pt-2 border-t border-zinc-700/50">
        <div className="text-[10px] text-zinc-500 font-medium mb-1">Connectors</div>
        {directConnectors.length === 0 ? (
          <div className="text-[10px] text-zinc-600 italic">No connectors</div>
        ) : (
          <div className="space-y-0.5">
            {directConnectors.map((c) => (
              <button
                key={c.id}
                onClick={() => selectItem({ type: 'connector', id: c.id })}
                className="w-full text-left flex items-center justify-between py-0.5 px-1.5 rounded hover:bg-zinc-800 transition-colors"
              >
                <span className="text-[11px] text-amber-400 hover:text-amber-300">{c.name}</span>
                <span className="text-zinc-500 text-[10px]">{getConnectorOccupancy(harness, c.id).length} used</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {directMergePoints.length > 0 && (
        <div className="mt-2 pt-2 border-t border-zinc-700/50">
          <div className="text-[10px] text-zinc-500 font-medium mb-1">Merge Points</div>
          <div className="space-y-0.5">
            {directMergePoints.map((mergePoint) => (
              <button
                key={mergePoint.id}
                onClick={() => selectItem({ type: 'mergePoint', id: mergePoint.id })}
                className="w-full text-left flex items-center justify-between py-0.5 px-1.5 rounded hover:bg-zinc-800 transition-colors"
              >
                <span className="text-[11px] text-cyan-300">{mergePoint.name}</span>
                <span className="text-zinc-500 text-[10px]">{mergePoint.id}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function ConnectorInspector({ con }: { con: Connector }) {
  const harness = useHarnessStore((s) => s.harness);
  const connectorLibrary = useHarnessStore((s) => s.connectorLibrary);
  const updateConnectorTypeImage = useHarnessStore((s) => s.updateConnectorTypeImage);
  const updateConnectorTypeSideImage = useHarnessStore((s) => s.updateConnectorTypeSideImage);
  const updateConnectorProperty = useHarnessStore((s) => s.updateConnectorProperty);
  const [pinPickerOpen, setPinPickerOpen] = useState(false);
  const [sidePickerOpen, setSidePickerOpen] = useState(false);
  const [instanceImgPickerOpen, setInstanceImgPickerOpen] = useState(false);
  const closePinPicker = useCallback(() => setPinPickerOpen(false), []);
  const closeSidePicker = useCallback(() => setSidePickerOpen(false), []);
  const closeInstanceImgPicker = useCallback(() => setInstanceImgPickerOpen(false), []);

  if (!harness) return null;
  const ct = connectorLibrary?.connector_types.find((t) => t.id === con.connector_type);

  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-bold text-zinc-100">{con.name}</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">
          Connector
        </span>
      </div>

      {con.parent && (
        <div className="mb-2">
          <ParentLink parentId={con.parent} />
        </div>
      )}

      {(() => {
        const instanceImg = con.properties?.image as string | undefined;
        return (
          <div className="mb-2 relative">
            <div className="text-[9px] text-zinc-500 font-medium mb-1 uppercase tracking-wider">Connection box image</div>
            {instanceImg ? (
              <div className="rounded overflow-hidden border border-zinc-700/60 bg-zinc-800">
                <img src={`/user-data/images/${instanceImg}`} alt={con.name} className="w-full object-contain" style={{ maxHeight: 100 }} />
              </div>
            ) : (
              <div className="rounded border border-dashed border-zinc-700 bg-zinc-800/40 flex items-center justify-center text-[10px] text-zinc-600 italic" style={{ height: 44 }}>
                No image
              </div>
            )}
            <div className="mt-1 relative">
              <button
                onClick={() => setInstanceImgPickerOpen((p) => !p)}
                className="w-full text-[10px] text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded py-0.5 transition-colors"
              >
                {instanceImg ? '⇄ Change image' : '+ Set image'}
              </button>
              {instanceImg && (
                <button
                  onClick={() => updateConnectorProperty(con.id, 'image', '')}
                  className="absolute right-0 top-0 bottom-0 px-2 text-zinc-500 hover:text-red-400 text-[10px]"
                  title="Remove image"
                >
                  ✕
                </button>
              )}
              {instanceImgPickerOpen && (
                <div className="absolute left-0 right-0 z-50" style={{ top: '100%' }}>
                  <ImagePickerPanel
                    onPick={(f) => { updateConnectorProperty(con.id, 'image', f); setInstanceImgPickerOpen(false); }}
                    onClose={closeInstanceImgPicker}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {ct && (
        <>
          {/* Pin reading guide image */}
          <div className="mb-2">
            <div className="text-[9px] text-zinc-500 font-medium mb-1 uppercase tracking-wider">Pin guide</div>
            {ct.image ? (
              <div className="rounded overflow-hidden border border-zinc-700/60 bg-zinc-800">
                <img src={`/user-data/connectors/${ct.image}`} alt={ct.name} className="w-full object-contain" style={{ maxHeight: 120 }} />
              </div>
            ) : (
              <div className="rounded border border-dashed border-zinc-700 bg-zinc-800/40 flex items-center justify-center text-[10px] text-zinc-600 italic" style={{ height: 40 }}>
                No pin guide
              </div>
            )}
            <div className="mt-1 relative">
              <button onClick={() => setPinPickerOpen((p) => !p)} className="w-full text-[10px] text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded py-0.5 transition-colors">
                {ct.image ? '⇄ Change' : '+ Set pin guide'}
              </button>
              {ct.image && (
                <button onClick={() => updateConnectorTypeImage(ct.id, '')} className="absolute right-0 top-0 bottom-0 px-2 text-zinc-500 hover:text-red-400 text-[10px]" title="Remove">✕</button>
              )}
              {pinPickerOpen && (
                <div className="absolute left-0 right-0 z-50" style={{ top: '100%' }}>
                  <ImagePickerPanel onPick={(f) => { updateConnectorTypeImage(ct.id, f); setPinPickerOpen(false); }} onClose={closePinPicker} listEndpoint="/api/list-connector-assets" baseUrl="/user-data/connectors/" emptyStatePath="public/user-data/connectors/" />
                </div>
              )}
            </div>
          </div>

          {/* Side view image — shown on connector tabs in both views */}
          <div className="mb-2">
            <div className="text-[9px] text-zinc-500 font-medium mb-1 uppercase tracking-wider">Side view (on boxes)</div>
            {ct.side_image ? (
              <div className="rounded overflow-hidden border border-zinc-700/60 bg-zinc-800">
                <img src={`/user-data/connectors/${ct.side_image}`} alt="" className="w-full object-contain" style={{ maxHeight: 80 }} />
              </div>
            ) : (
              <div className="rounded border border-dashed border-zinc-700 bg-zinc-800/40 flex items-center justify-center text-[10px] text-zinc-600 italic" style={{ height: 36 }}>
                No side view
              </div>
            )}
            <div className="mt-1 relative">
              <button onClick={() => setSidePickerOpen((p) => !p)} className="w-full text-[10px] text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded py-0.5 transition-colors">
                {ct.side_image ? '⇄ Change' : '+ Set side view'}
              </button>
              {ct.side_image && (
                <button onClick={() => updateConnectorTypeSideImage(ct.id, '')} className="absolute right-0 top-0 bottom-0 px-2 text-zinc-500 hover:text-red-400 text-[10px]" title="Remove">✕</button>
              )}
              {sidePickerOpen && (
                <div className="absolute left-0 right-0 z-50" style={{ top: '100%' }}>
                  <ImagePickerPanel onPick={(f) => { updateConnectorTypeSideImage(ct.id, f); setSidePickerOpen(false); }} onClose={closeSidePicker} listEndpoint="/api/list-connector-assets" baseUrl="/user-data/connectors/" emptyStatePath="public/user-data/connectors/" />
                </div>
              )}
            </div>
          </div>

          <div className="text-[10px] text-zinc-400 mb-2 space-y-0.5 pb-2 border-b border-zinc-700/50">
            <div className="font-medium text-zinc-300">{ct.name}</div>
            <div className="flex gap-x-3 text-zinc-500">
              <span>{ct.crimp_spec}</span>
              <span>{ct.wire_gauge}</span>
            </div>
          </div>
        </>
      )}

      <div className="mb-1 pb-1 border-b border-zinc-700/50">
        <TagEditor entityType="connector" entityId={con.id} tags={con.tags} />
      </div>

      <ConnectorOccupancyTable connector={con} />
    </>
  );
}

function MergePointInspector({ mergePoint }: { mergePoint: MergePoint }) {
  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-bold text-zinc-100">{mergePoint.name}</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-900/50 text-cyan-300">
          Merge Point
        </span>
      </div>

      <PropertyRow label="ID" value={mergePoint.id} />
      {mergePoint.parent && <PropertyRow label="Parent" value={mergePoint.parent} />}
      {Object.entries(mergePoint.properties).map(([key, value]) => (
        <PropertyRow key={key} label={key} value={value} />
      ))}

      <div className="mt-2 pt-2 border-t border-zinc-700/50">
        <TagEditor entityType="mergePoint" entityId={mergePoint.id} tags={mergePoint.tags} />
      </div>
    </>
  );
}

function PathInspector({ path }: { path: Path }) {
  const harness = useHarnessStore((s) => s.harness);
  if (!harness) return null;

  const signalName = getPathSignalName(path);
  const appearance = getWireAppearance(path);

  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-bold text-zinc-100">Path</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">
          {path.id}
        </span>
      </div>

      <PropertyRow label="Name" value={path.name} />
      <PropertyRow label="Nodes" value={String(path.nodes.length)} />
      <PropertyRow label="Segments" value={String(Math.max(0, path.nodes.length - 1))} />

      <div className="mt-2 pt-2 border-t border-zinc-700/50">
        <div className="flex items-center gap-2 py-0.5">
          <span className="text-[10px] text-zinc-500 w-20 shrink-0 text-right">
            Color
          </span>
          <div className="flex items-center gap-2">
            <WireColorSwatch appearance={appearance} className="w-3 h-3 rounded-sm" />
            <span className="text-[11px] text-zinc-300">{appearance.label}</span>
          </div>
        </div>
      </div>

      {signalName && <SignalInfo signalName={signalName} appearance={appearance} />}

      <div className="mt-2 pt-2 border-t border-zinc-700/50">
        <div className="text-[10px] text-zinc-500 font-medium mb-1">Route</div>
        <div className="space-y-1">
          {path.nodes.map((node, index) => (
            <div key={`${getPathNodeLabel(harness, node)}-${index}`} className="text-[11px] text-zinc-300 flex items-center gap-2">
              <span className="text-zinc-500 font-mono text-[10px] w-6 shrink-0">{index + 1}</span>
              <span>{getPathNodeLabel(harness, node)}</span>
            </div>
          ))}
        </div>
      </div>

      {path.measurements.length > 0 && (
        <div className="mt-2 pt-2 border-t border-zinc-700/50">
          <div className="text-[10px] text-zinc-500 font-medium mb-1">Measurements</div>
          <div className="space-y-1">
            {path.measurements.map((measurement, index) => (
              <div key={`${getPathNodeLabel(harness, measurement.from)}-${getPathNodeLabel(harness, measurement.to)}-${index}`} className="text-[10px] text-zinc-300 rounded bg-zinc-800/60 px-2 py-1">
                {getPathNodeLabel(harness, measurement.from)} → {getPathNodeLabel(harness, measurement.to)}
                {measurement.length_mm !== undefined ? ` · ${measurement.length_mm} mm` : ''}
                {measurement.note ? ` · ${measurement.note}` : ''}
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.entries(path.properties)
        .filter(([key]) => key !== 'wire_color' && key !== 'color')
        .map(([key, value]) => (
          <PropertyRow key={key} label={key} value={value} />
        ))}

      <PathStatusEditor pathId={path.id} tags={path.tags} />

      <div className="mt-2 pt-2 border-t border-zinc-700/50">
        <div className="text-[10px] text-zinc-500 font-medium mb-1">Tags</div>
        <TagEditor entityType="path" entityId={path.id} tags={path.tags} />
      </div>
    </>
  );
}

// ─── Text Box Inspector ──────────────────────────────────────────────────────

const COLOR_PRESETS_DARK = [
  '#0a0a0a', '#1e293b', '#172554', '#14532d', '#450a0a', '#27272a',
  '#1c1917', '#0c0a09', '#1e1b4b', '#052e16', '#2d1515', '#18181b',
];
const COLOR_PRESETS_LIGHT = [
  '#f8fafc', '#fef9c3', '#dbeafe', '#dcfce7', '#fee2e2', '#f4f4f5',
  '#fef3c7', '#e0f2fe', '#d1fae5', '#fce7f3', '#ede9fe', '#ffffff',
];

function TbColorRow({
  label,
  value,
  presets,
  onChange,
}: {
  label: string;
  value: string;
  presets: string[];
  onChange: (v: string) => void;
}) {
  const [hex, setHex] = useState(value);
  useEffect(() => { setHex(value); }, [value]);

  return (
    <div className="py-1">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] text-zinc-500 w-16 shrink-0 text-right">{label}</span>
        <label className="relative flex items-center gap-1.5 cursor-pointer flex-1">
          <span
            className="w-5 h-5 rounded border border-zinc-600 shrink-0 inline-block"
            style={{ backgroundColor: value }}
          />
          <input
            type="color"
            value={value}
            onChange={(e) => { setHex(e.target.value); onChange(e.target.value); }}
            className="absolute opacity-0 left-0 top-0 w-5 h-5 cursor-pointer"
          />
          <input
            type="text"
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            onBlur={() => {
              if (/^#[0-9a-f]{6}$/i.test(hex)) onChange(hex);
              else setHex(value);
            }}
            className="flex-1 text-[10px] font-mono px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-300 focus:border-amber-600 focus:outline-none"
          />
        </label>
      </div>
      <div className="flex gap-1 flex-wrap pl-[4.75rem]">
        {presets.map((p) => (
          <button
            key={p}
            title={p}
            onClick={() => { setHex(p); onChange(p); }}
            className="w-4 h-4 rounded border transition-all hover:scale-110"
            style={{
              backgroundColor: p,
              borderColor: value === p ? '#f59e0b' : 'rgba(255,255,255,0.12)',
            }}
          />
        ))}
      </div>
    </div>
  );
}

function TbSliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-[10px] text-zinc-500 w-16 shrink-0 text-right">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1 accent-amber-500 cursor-pointer"
      />
      <span className="text-[10px] text-zinc-400 w-8 text-right tabular-nums shrink-0">
        {value}{unit}
      </span>
    </div>
  );
}

function TbSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 pt-2 border-t border-zinc-700/50">
      <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function TextBoxInspector({ tb }: { tb: TextBoxLayout }) {
  const updateTextBox = useHarnessStore((s) => s.updateTextBox);
  const removeTextBox = useHarnessStore((s) => s.removeTextBox);
  const selectTextBox = useHarnessStore((s) => s.selectTextBox);
  const [localText, setLocalText] = useState(tb.text);
  useEffect(() => { setLocalText(tb.text); }, [tb.text]);

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold text-zinc-100">Text Box</span>
        <button
          className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
          onClick={() => { removeTextBox(tb.id); selectTextBox(null); }}
        >
          Delete
        </button>
      </div>

      {/* Content */}
      <TbSection label="Content">
        <textarea
          value={localText}
          onChange={(e) => setLocalText(e.target.value)}
          onBlur={() => updateTextBox(tb.id, { text: localText })}
          rows={4}
          placeholder="Type here…"
          className="w-full text-[11px] px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:border-amber-600 focus:outline-none resize-none"
        />
      </TbSection>

      {/* Colors */}
      <TbSection label="Colors">
        <TbColorRow
          label="Background"
          value={tb.bgColor}
          presets={COLOR_PRESETS_DARK}
          onChange={(v) => updateTextBox(tb.id, { bgColor: v })}
        />
        <TbColorRow
          label="Text"
          value={tb.textColor}
          presets={COLOR_PRESETS_LIGHT}
          onChange={(v) => updateTextBox(tb.id, { textColor: v })}
        />
      </TbSection>

      {/* Typography */}
      <TbSection label="Typography">
        <TbSliderRow
          label="Font size"
          value={tb.fontSize}
          min={8}
          max={72}
          step={1}
          unit="px"
          onChange={(v) => updateTextBox(tb.id, { fontSize: v })}
        />

        <div className="flex items-center gap-2 py-0.5">
          <span className="text-[10px] text-zinc-500 w-16 shrink-0 text-right">Family</span>
          <select
            value={tb.fontFamily ?? 'sans'}
            onChange={(e) => updateTextBox(tb.id, { fontFamily: e.target.value as TextBoxFontFamily })}
            className="flex-1 text-[11px] px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-300 focus:border-amber-600 focus:outline-none"
          >
            <option value="sans">Sans-serif</option>
            <option value="serif">Serif</option>
            <option value="mono">Monospace</option>
          </select>
        </div>

        <div className="flex items-center gap-2 py-0.5">
          <span className="text-[10px] text-zinc-500 w-16 shrink-0 text-right">Weight</span>
          <div className="flex gap-1 flex-1">
            {(['normal', 'bold'] as TextBoxFontWeight[]).map((w) => (
              <button
                key={w}
                onClick={() => updateTextBox(tb.id, { fontWeight: w })}
                className={`flex-1 text-[10px] py-0.5 rounded border transition-colors capitalize ${
                  (tb.fontWeight ?? 'normal') === w
                    ? 'border-amber-500 text-amber-400 bg-amber-900/20'
                    : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 py-0.5">
          <span className="text-[10px] text-zinc-500 w-16 shrink-0 text-right">Align</span>
          <div className="flex gap-1 flex-1">
            {([['left', '⬅'], ['center', '↔'], ['right', '➡']] as [TextBoxTextAlign, string][]).map(([a, icon]) => (
              <button
                key={a}
                onClick={() => updateTextBox(tb.id, { textAlign: a })}
                title={a}
                className={`flex-1 text-[11px] py-0.5 rounded border transition-colors ${
                  (tb.textAlign ?? 'left') === a
                    ? 'border-amber-500 text-amber-400 bg-amber-900/20'
                    : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                }`}
              >
                {icon}
              </button>
            ))}
          </div>
        </div>
      </TbSection>

      {/* Border */}
      <TbSection label="Border">
        <TbSliderRow
          label="Width"
          value={tb.borderWidth ?? 0}
          min={0}
          max={8}
          unit="px"
          onChange={(v) => updateTextBox(tb.id, { borderWidth: v })}
        />
        <TbSliderRow
          label="Radius"
          value={tb.borderRadius ?? 4}
          min={0}
          max={32}
          unit="px"
          onChange={(v) => updateTextBox(tb.id, { borderRadius: v })}
        />
        {(tb.borderWidth ?? 0) > 0 && (
          <TbColorRow
            label="Color"
            value={tb.borderColor ?? '#4b5563'}
            presets={COLOR_PRESETS_LIGHT}
            onChange={(v) => updateTextBox(tb.id, { borderColor: v })}
          />
        )}
      </TbSection>

      {/* Layout */}
      <TbSection label="Layout">
        <TbSliderRow
          label="Padding"
          value={tb.padding ?? 10}
          min={0}
          max={40}
          unit="px"
          onChange={(v) => updateTextBox(tb.id, { padding: v })}
        />
        <TbSliderRow
          label="Opacity"
          value={Math.round((tb.opacity ?? 1) * 100)}
          min={10}
          max={100}
          unit="%"
          onChange={(v) => updateTextBox(tb.id, { opacity: v / 100 })}
        />
        <div className="flex items-start gap-2 py-0.5 mt-0.5">
          <span className="text-[10px] text-zinc-500 w-16 shrink-0 text-right">Size</span>
          <div className="flex gap-1.5 flex-1">
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-zinc-600">W</span>
              <input
                type="number"
                value={Math.round(tb.w)}
                onChange={(e) => updateTextBox(tb.id, { w: Number(e.target.value) })}
                className="w-14 text-[10px] font-mono px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-300 focus:border-amber-600 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-zinc-600">H</span>
              <input
                type="number"
                value={Math.round(tb.h)}
                onChange={(e) => updateTextBox(tb.id, { h: Number(e.target.value) })}
                className="w-14 text-[10px] font-mono px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-300 focus:border-amber-600 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </TbSection>
    </>
  );
}

export function InspectorPanel() {
  const selectedItem = useHarnessStore((s) => s.selectedItem);
  const selectedBundle = useHarnessStore((s) => s.selectedBundle);
  const selectedTextBoxId = useHarnessStore((s) => s.selectedTextBoxId);
  const textBoxLayouts = useHarnessStore((s) => s.textBoxLayouts);
  const findEntity = useHarnessStore((s) => s.findEntity);
  const harness = useHarnessStore((s) => s.harness);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.scrollTo(0, 0);
  }, [selectedItem, selectedBundle, selectedTextBoxId]);

  // Text box inspector
  if (selectedTextBoxId) {
    const tb = textBoxLayouts[selectedTextBoxId];
    return (
      <div ref={containerRef} className="overflow-y-auto h-full">
        <div className="px-2 py-1 flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
            Inspector
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-800/50">
            Text Box
          </span>
        </div>
        <div className="px-2 pb-3">
          {tb ? (
            <TextBoxInspector tb={tb} />
          ) : (
            <div className="text-xs text-zinc-500 italic">Text box not found</div>
          )}
        </div>
      </div>
    );
  }

  if (!harness) {
    return (
      <div className="p-3 text-xs text-zinc-500 italic">
        Select an item to inspect
      </div>
    );
  }

  // Bundle inspector
  if (selectedBundle && selectedBundle.length > 0) {
    return (
      <div ref={containerRef} className="overflow-y-auto h-full">
        <div className="px-2 py-1 flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
            Inspector
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">
            Bundle
          </span>
        </div>
        <div className="px-2 pb-3">
          <BundleInspector pathIds={selectedBundle} />
        </div>
      </div>
    );
  }

  if (!selectedItem) {
    return (
      <div className="p-3 text-xs text-zinc-500 italic">
        Select an item to inspect
      </div>
    );
  }

  const entity = findEntity(selectedItem.type, selectedItem.id);
  if (!entity) {
    return (
      <div className="p-3 text-xs text-red-400">
        Entity not found: {selectedItem.id}
      </div>
    );
  }

  const renderContent = () => {
    switch (selectedItem.type) {
      case 'enclosure': {
        const enc = entity as Enclosure;
        return <EnclosureInspector enc={enc} />;
      }
      case 'connector': {
        const con = entity as Connector;
        return <ConnectorInspector con={con} />;
      }
      case 'mergePoint': {
        return <MergePointInspector mergePoint={entity as MergePoint} />;
      }
      case 'path': {
        return <PathInspector path={entity as Path} />;
      }
      case 'signal': {
        return <SignalInfo signalName={(entity as Signal).name} />;
      }
      default:
        return null;
    }
  };

  const typeLabels: Record<string, string> = {
    enclosure: 'Enclosure',
    connector: 'Connector',
    mergePoint: 'Merge Point',
    path: 'Path',
    signal: 'Signal',
  };

  return (
    <div ref={containerRef} className="overflow-y-auto h-full">
      <div className="px-2 py-1 flex items-center gap-1.5">
        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
          Inspector
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">
          {typeLabels[selectedItem.type] ?? selectedItem.type}
        </span>
      </div>
      <div className="px-2 pb-3">{renderContent()}</div>
    </div>
  );
}
