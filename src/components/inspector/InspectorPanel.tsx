import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { ImagePickerPanel } from '../graph/ImagePickerPanel';
import { useHarnessStore } from '../../store';
import type {
  Connector,
  ConnectorType,
  Enclosure,
  EntityType,
  MergePoint,
  Path,
  PathNode,
  Signal,
  TextBoxFontFamily,
  TextBoxFontWeight,
  TextBoxLayout,
  TextBoxTextAlign,
} from '../../types';
import {
  getWireAppearance,
  getPreferredWireColorDeviation,
} from '../../lib/colors';
import {
  countPathsTouchingConnectors,
  getBundleSegments,
  getConnectorPairSegments,
  formatConnectorOccupancySummary,
  getConnectorOccupancy,
  getConnectorPinGuideImage,
  getConnectorSideImage,
  getConnectorSupportedKeyings,
  getConnectorSupportedPinCounts,
  getConnectorTypeCavityFloor,
  getEffectivePinCount,
  getNextConnectorPinCount,
  getPreviousConnectorPinCount,
  getEnclosureConnectors,
  getPathsTouchingConnector,
  isBulkheadConnector,
  isConnectorFamily,
  getPathNodeLabel,
  getPathNodeRefKey,
  getPathSegmentMeasurement,
  getPathSignalId,
  getPathSignalName,
  getPathWireAppearance,
  parseBundleId,
  type BulkheadWireSide,
} from '../../lib/harness';
import { WIRE_GAUGE_PRESETS } from '../../lib/gauge';
import { deriveManufacturingBundles, getPathInferredGauge } from '../../lib/manufacturing';
import { normalizeDisplayName } from '../../lib/rename';
import { WireColorEditor, WireColorSwatch } from '../WireColorEditor';

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

function ReadOnlyInspectorControls({ children }: { children: React.ReactNode }) {
  const isEditor = useHarnessStore((state) => state.session.isEditor);

  const blockReadOnlyControl = (event: React.SyntheticEvent) => {
    if (isEditor) return;
    if (event.type === 'keydown' && (event.nativeEvent as KeyboardEvent).key === 'Tab') return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-readonly-allowed]')) return;
    const control = target.closest('button, input, textarea, select, [contenteditable="true"]');
    const labelControl = target.closest('label')?.querySelector(
      'input, textarea, select, [contenteditable="true"]',
    );
    if (!control && !labelControl) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      key={isEditor ? 'editable' : 'read-only'}
      aria-readonly={!isEditor}
      onBeforeInputCapture={blockReadOnlyControl}
      onChangeCapture={blockReadOnlyControl}
      onClickCapture={blockReadOnlyControl}
      onKeyDownCapture={blockReadOnlyControl}
      onPointerDownCapture={blockReadOnlyControl}
      className={isEditor ? undefined : '[&_input]:cursor-not-allowed [&_textarea]:cursor-not-allowed [&_select]:cursor-not-allowed'}
    >
      {children}
    </div>
  );
}

function EntityLink({
  item,
  children,
  className = 'text-amber-400 hover:text-amber-300 underline underline-offset-2',
  title,
}: {
  item: { type: EntityType; id: string };
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  const revealItem = useHarnessStore((s) => s.revealItem);
  return (
    <button
      type="button"
      data-readonly-allowed
      onClick={() => revealItem(item)}
      className={className}
      title={title ?? `Reveal ${item.type}`}
    >
      {children}
    </button>
  );
}

function PathNodeLink({
  node,
  children,
  className,
}: {
  node: PathNode;
  children: React.ReactNode;
  className?: string;
}) {
  const item = node.kind === 'connector'
    ? { type: 'connector' as const, id: node.connector_id }
    : { type: 'mergePoint' as const, id: node.merge_point_id };
  return (
    <EntityLink item={item} className={className} title="Reveal referenced entity">
      {children}
    </EntityLink>
  );
}

function NameEditor({
  name,
  type,
  id,
  label = 'Name',
}: {
  name: string;
  type: EntityType;
  id: string;
  label?: string;
}) {
  const renameEntity = useHarnessStore((s) => s.renameEntity);
  const pushUndoSnapshot = useHarnessStore((s) => s.pushUndoSnapshot);
  const commitUndoSnapshot = useHarnessStore((s) => s.commitUndoSnapshot);
  const cancelUndoSnapshot = useHarnessStore((s) => s.cancelUndoSnapshot);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const cancelBlur = useRef(false);

  const commit = (value: string) => {
    try {
      const normalized = normalizeDisplayName(value);
      renameEntity(type, id, normalized);
      setDraft(normalized);
      setError(null);
    } catch (reason) {
      setDraft(name);
      setError(reason instanceof Error ? reason.message : 'Invalid name.');
    }
  };

  return (
    <div className="py-1">
      <label className="flex items-center gap-2">
        <span className="text-[10px] text-zinc-500 w-20 shrink-0 text-right">{label}</span>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => pushUndoSnapshot(`rename:${type}:${id}`)}
          onBlur={(event) => {
            if (cancelBlur.current) {
              cancelBlur.current = false;
              cancelUndoSnapshot();
              return;
            }
            commit(event.target.value);
            commitUndoSnapshot();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              cancelBlur.current = true;
              setDraft(name);
              event.currentTarget.blur();
            }
          }}
          aria-label={`Rename ${label.toLowerCase()}`}
          className="min-w-0 flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100 focus:border-amber-500 focus:outline-none"
        />
      </label>
      {error && <div className="pl-[5.5rem] pt-0.5 text-[9px] text-red-400">{error}</div>}
    </div>
  );
}

function WireGaugeEditor({
  label,
  value,
  onChange,
  hint,
  clearLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  clearLabel?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);

  const commit = (next: string) => {
    const trimmed = next.trim();
    setText(trimmed);
    onChange(trimmed);
  };

  return (
    <div className="py-1">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] text-zinc-500 w-20 shrink-0 text-right">{label}</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => commit(text)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(text);
          }}
          placeholder="e.g. 20 AWG"
          className="min-w-0 flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-300 placeholder-zinc-600 focus:border-amber-600 focus:outline-none"
        />
      </div>
      <div className="flex gap-1 flex-wrap pl-[5.5rem]">
        {WIRE_GAUGE_PRESETS.map((preset) => {
          const selected = value.trim() === preset;
          return (
            <button
              key={preset}
              type="button"
              title={preset}
              onClick={() => commit(preset)}
              className={`px-1.5 py-0.5 rounded border text-[10px] transition-colors ${
                selected
                  ? 'border-amber-500 text-amber-300 bg-amber-950/40'
                  : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
              }`}
            >
              {preset.replace(' AWG', '')}
            </button>
          );
        })}
      </div>
      {clearLabel && (
        <div className="pl-[5.5rem] pt-1.5">
          <button
            type="button"
            disabled={!value.trim()}
            onClick={() => commit('')}
            className="text-[10px] text-zinc-400 hover:text-amber-400 disabled:text-zinc-700 disabled:cursor-default"
          >
            {clearLabel}
          </button>
        </div>
      )}
      {hint && (
        <div className="pl-[5.5rem] pt-1 text-[9px] text-zinc-600">{hint}</div>
      )}
    </div>
  );
}

function ConnectorGaugeBulkEditor({ connector }: { connector: Connector }) {
  const harness = useHarnessStore((s) => s.harness);
  const updateConnectorPathsGauge = useHarnessStore((s) => s.updateConnectorPathsGauge);
  const [text, setText] = useState('');
  const [side, setSide] = useState<BulkheadWireSide>('both');

  if (!harness) return null;
  const bulkhead = isBulkheadConnector(harness, connector.id);
  const targets = getPathsTouchingConnector(harness, connector.id, bulkhead ? side : 'both');
  const sideLabel = !bulkhead
    ? 'all wires'
    : side === 'both'
      ? 'internal + external'
      : side;

  const apply = (gauge: string) => {
    const trimmed = gauge.trim();
    if (targets.length === 0) return;
    const summary = targets
      .slice(0, 8)
      .map((path) => {
        const current = path.properties.wire_gauge?.trim() || '(inferred)';
        const next = trimmed || '(inferred)';
        return `• ${path.name || path.id}: ${current} → ${next}`;
      })
      .join('\n');
    const extra = targets.length > 8 ? `\n…and ${targets.length - 8} more` : '';
    const confirmed = window.confirm(
      `Set wire gauge to ${trimmed || '(clear / use inferred)'} on ${targets.length} ${sideLabel} path${targets.length === 1 ? '' : 's'} at ${connector.name}?\n\n${summary}${extra}`,
    );
    if (!confirmed) return;
    updateConnectorPathsGauge(connector.id, trimmed, bulkhead ? side : 'both');
    setText(trimmed);
  };

  return (
    <div className="mt-2 pt-2 border-t border-zinc-700/50">
      <div className="text-[10px] text-zinc-500 font-medium mb-1">Set wire gauge</div>
      {bulkhead && (
        <div className="flex gap-1 mb-1.5">
          {([
            ['internal', 'Internal'],
            ['external', 'External'],
            ['both', 'Both'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setSide(value)}
              className={`flex-1 px-1 py-0.5 rounded border text-[10px] transition-colors ${
                side === value
                  ? 'border-amber-500 text-amber-300 bg-amber-950/40'
                  : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply(text);
          }}
          placeholder="e.g. 18 AWG"
          className="min-w-0 flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-300 placeholder-zinc-600 focus:border-amber-600 focus:outline-none"
        />
        <button
          type="button"
          disabled={targets.length === 0 || !text.trim()}
          onClick={() => apply(text)}
          className="shrink-0 px-2 py-1 rounded border border-zinc-700 text-[10px] text-zinc-300 hover:border-amber-600 hover:text-amber-300 disabled:opacity-30 disabled:hover:border-zinc-700 disabled:hover:text-zinc-300"
        >
          Apply
        </button>
      </div>
      <div className="flex gap-1 flex-wrap mt-1.5">
        {WIRE_GAUGE_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            disabled={targets.length === 0}
            onClick={() => apply(preset)}
            className="px-1.5 py-0.5 rounded border border-zinc-700 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-30"
          >
            {preset.replace(' AWG', '')}
          </button>
        ))}
      </div>
      <div className="pt-1 text-[9px] text-zinc-600">
        {targets.length === 0
          ? bulkhead
            ? `No ${sideLabel} wires on this bulkhead`
            : 'No wires on this connector'
          : `${targets.length} ${sideLabel} path${targets.length === 1 ? '' : 's'} will be updated`}
      </div>
    </div>
  );
}

function DerivedFromPortNote({ portId }: { portId?: string }) {
  return (
    <div className="mb-2 text-[10px] leading-snug px-2 py-1.5 rounded border border-sky-800/50 bg-sky-900/20 text-sky-300">
      <span className="font-medium text-sky-200">Derived</span> — this entity isn't authored
      directly. It's synthesized from a bulkhead port{portId ? ` ('${portId}')` : ''} declared on
      the parent sheet, based on which wires actually reach into this enclosure. Its stable ID is
      managed by that port, while name, tags, and properties edited here safely round-trip back to it.
    </div>
  );
}

function ParentLink({ parentId }: { parentId: string }) {
  const harness = useHarnessStore((s) => s.harness);

  if (!harness) return null;

  const enc = harness.enclosures.find((e) => e.id === parentId);
  const name = enc?.name ?? parentId;

  return (
    <EntityLink
      item={{ type: 'enclosure', id: parentId }}
      className="text-[11px] text-amber-400 hover:text-amber-300 underline underline-offset-2"
    >
      {name}
    </EntityLink>
  );
}

function SignalInfo({ signalId, appearance }: { signalId: string; appearance?: WireAppearance | null }) {
  const harness = useHarnessStore((s) => s.harness);
  if (!harness) return null;

  const signal = harness.signals.find(
    (s: Signal) => s.id === signalId,
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
          Signal:{' '}
          <EntityLink
            item={{ type: 'signal', id: signal.id }}
            className="text-amber-400 hover:text-amber-300 underline underline-offset-2"
          >
            {signal.name}
          </EntityLink>
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
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  if (!harness) return null;

  const ct = connectorLibrary?.connector_types.find(
    (t: ConnectorType) => t.id === connector.connector_type,
  );
  const occupancy = getConnectorOccupancy(harness, connector.id);
  const maxUsedPin = Math.max(0, ...occupancy.map((entry) => entry.pinNumber));
  const pinCount = Math.max(getEffectivePinCount(connector, ct), maxUsedPin);
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
                      const appearance = path ? getPathWireAppearance(path, harness) : null;

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
                              type="button"
                              data-readonly-allowed
                              onClick={() => togglePath(expandKey)}
                              className="text-zinc-600 hover:text-zinc-400 text-[8px] shrink-0 transition-colors"
                              title={isExpanded ? 'Collapse route' : 'Expand route'}
                            >
                              {isExpanded ? '▼' : '▶'}
                            </button>
                            <EntityLink
                              item={{ type: 'path', id: item.pathId }}
                              className="flex items-center gap-1 flex-1 min-w-0 text-left group"
                              title="Reveal path"
                            >
                              <WireColorSwatch
                                appearance={appearance ?? null}
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                              />
                              <span className="text-[10px] text-zinc-300 truncate group-hover:text-amber-300 transition-colors">
                                {item.pathName}
                              </span>
                            </EntityLink>
                            {item.signalName && path && getPathSignalId(path) && (
                              <EntityLink
                                item={{ type: 'signal', id: getPathSignalId(path)! }}
                                className="text-[9px] text-zinc-500 hover:text-amber-300 shrink-0 pl-1"
                                title="Reveal signal"
                              >
                                {item.signalName}
                              </EntityLink>
                            )}
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
                                    <div key={`${getPathNodeRefKey(node)}-${nodeIndex}`} className="flex items-start gap-1.5">
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
                                      <PathNodeLink
                                        node={node}
                                        className={`text-[10px] leading-tight ${
                                          isCurrent
                                            ? 'text-amber-400 font-medium'
                                            : 'text-zinc-400 hover:text-amber-300 underline underline-offset-2'
                                        }`}
                                      >
                                        {label}
                                        {isCurrent && (
                                          <span className="text-[8px] text-amber-600 ml-1">← here</span>
                                        )}
                                      </PathNodeLink>
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

function BundleLengthEditor({
  bundleId,
  pathIds,
  segments,
}: {
  bundleId: string;
  pathIds: string[];
  segments: ReturnType<typeof getBundleSegments>;
}) {
  const updateBundleSegmentLengths = useHarnessStore((s) => s.updateBundleSegmentLengths);
  const pushUndoSnapshot = useHarnessStore((s) => s.pushUndoSnapshot);
  const commitUndoSnapshot = useHarnessStore((s) => s.commitUndoSnapshot);
  const cancelUndoSnapshot = useHarnessStore((s) => s.cancelUndoSnapshot);
  const lengths = segments.map(
    (segment) => getPathSegmentMeasurement(segment.path, segment.segmentIndex)?.length_mm,
  );
  const uniqueLengths = [...new Set(lengths.filter((length): length is number => length !== undefined))];
  const allSame = lengths.length > 0
    && lengths.every((length) => length !== undefined)
    && uniqueLengths.length === 1;
  const initialValue = allSame ? String(uniqueLengths[0]) : '';
  const [draft, setDraft] = useState(initialValue);
  const cancelBlur = useRef(false);

  useEffect(() => {
    setDraft(initialValue);
  }, [initialValue]);

  const commit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      const existing = segments.filter((segment) => {
        const lengthMm = getPathSegmentMeasurement(segment.path, segment.segmentIndex)?.length_mm;
        return lengthMm !== undefined;
      });
      if (existing.length > 0) {
        const confirmed = window.confirm([
          `Clear stretch length on ${existing.length} wire${existing.length === 1 ? '' : 's'} in this bundle?`,
          '',
          ...existing.map((segment) => {
            const lengthMm = getPathSegmentMeasurement(segment.path, segment.segmentIndex)?.length_mm;
            return `• ${segment.path.name}: ${lengthMm} mm`;
          }),
        ].join('\n'));
        if (!confirmed) {
          setDraft(initialValue);
          return;
        }
      }
      setDraft('');
      updateBundleSegmentLengths(bundleId, pathIds, undefined);
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(initialValue);
      return;
    }
    setDraft(String(parsed));

    const withLength = segments.filter((segment) => {
      const lengthMm = getPathSegmentMeasurement(segment.path, segment.segmentIndex)?.length_mm;
      return lengthMm !== undefined;
    });
    if (
      withLength.length === segments.length
      && withLength.every((segment) =>
        getPathSegmentMeasurement(segment.path, segment.segmentIndex)?.length_mm === parsed)
    ) {
      return;
    }

    if (withLength.length > 0) {
      const confirmed = window.confirm([
        `${withLength.length} wire${withLength.length === 1 ? '' : 's'} in this bundle already have a length:`,
        '',
        ...withLength.map((segment) => {
          const lengthMm = getPathSegmentMeasurement(segment.path, segment.segmentIndex)?.length_mm;
          return `• ${segment.path.name}: ${lengthMm} mm`;
        }),
        '',
        `Apply ${parsed} mm to all ${segments.length} wires in this bundle?`,
        '',
        'This only changes the stretch on this bundle hop (e.g. connector → splice), not other segments of the path.',
      ].join('\n'));
      if (!confirmed) {
        setDraft(initialValue);
        return;
      }
    }

    updateBundleSegmentLengths(bundleId, pathIds, parsed);
  };

  if (segments.length === 0) return null;

  const mixed = !allSame && lengths.some((length) => length !== undefined);

  return (
    <div className="mb-2 p-1.5 rounded border border-zinc-700/50 bg-zinc-800/40">
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-zinc-500 uppercase tracking-wide">Stretch</span>
        <span className="text-[9px] text-zinc-600">
          {segments.length} wire{segments.length === 1 ? '' : 's'}
        </span>
        <input
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => pushUndoSnapshot(`bundle:${bundleId}:length`)}
          onBlur={(event) => {
            if (cancelBlur.current) {
              cancelBlur.current = false;
              cancelUndoSnapshot();
              return;
            }
            commit(event.currentTarget.value);
            commitUndoSnapshot();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              cancelBlur.current = true;
              setDraft(initialValue);
              event.currentTarget.blur();
            }
          }}
          placeholder={mixed ? 'mixed' : '—'}
          aria-label={`Length for all ${segments.length} wires in this bundle, in millimeters`}
          className="ml-auto w-20 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-right font-mono text-[10px] text-zinc-200 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
        />
        <span className="w-5 text-[9px] text-zinc-500">mm</span>
      </div>
      <div className="mt-1 text-[9px] text-zinc-600">
        Applies to this bundle hop only
        {mixed ? ' · some wires already have lengths' : ''}
      </div>
    </div>
  );
}

function BundleInspector({
  bundleId,
  pathIds,
}: {
  bundleId: string;
  pathIds: string[];
}) {
  const harness = useHarnessStore((s) => s.harness);
  const connectorLibrary = useHarnessStore((s) => s.connectorLibrary);
  const manufacturing = useHarnessStore((s) => s.manufacturing);
  const openManufacturing = useHarnessStore((s) => s.openManufacturing);
  const deletePathBundle = useHarnessStore((s) => s.deletePathBundle);

  if (!harness) return null;

  const paths = pathIds
    .map((id) => harness.paths.find((path) => path.id === id))
    .filter(Boolean) as Path[];

  if (paths.length === 0) return null;

  const segments = bundleId ? getBundleSegments(harness, bundleId, pathIds) : [];
  const segmentByPathId = new Map(segments.map((segment) => [segment.path.id, segment]));
  const parsedBundle = bundleId ? parseBundleId(bundleId) : null;

  const selectedPathIds = new Set(pathIds);
  const selectedSegmentKeys = new Set(
    segments.map((segment) => `${segment.path.id}:${segment.segmentIndex}`),
  );
  const manufacturingBundle = deriveManufacturingBundles(
    harness,
    connectorLibrary,
    manufacturing,
  )
    .map((bundle) => {
      const pathOverlap = new Set(
        bundle.wires
          .map((wire) => wire.pathId)
          .filter((pathId) => selectedPathIds.has(pathId)),
      ).size;
      const segmentOverlap = new Set(
        bundle.wires.flatMap((wire) => {
          const lo = Math.min(wire.fromNodeIndex, wire.toNodeIndex);
          const hi = Math.max(wire.fromNodeIndex, wire.toNodeIndex);
          return Array.from({ length: hi - lo }, (_, offset) => `${wire.pathId}:${lo + offset}`)
            .filter((key) => selectedSegmentKeys.has(key));
        }),
      ).size;
      return { bundle, pathOverlap, segmentOverlap };
    })
    .filter((entry) => entry.pathOverlap > 0)
    .sort((a, b) =>
      b.segmentOverlap - a.segmentOverlap
      || b.pathOverlap - a.pathOverlap
    )[0]?.bundle;

  const signalAppearances = new Map<string, { name: string; appearance: WireAppearance }>();
  for (const path of paths) {
    const signalId = getPathSignalId(path);
    const signalName = getPathSignalName(path, harness);
    if (signalId && signalName && !signalAppearances.has(signalId)) {
      signalAppearances.set(signalId, {
        name: signalName,
        appearance: getPathWireAppearance(path, harness),
      });
    }
  }

  const firstSegment = segments[0];
  const hopLabel = firstSegment
    ? `${getPathNodeLabel(harness, firstSegment.from)} → ${getPathNodeLabel(harness, firstSegment.to)}`
    : null;

  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-bold text-zinc-100">
          Path Bundle
        </span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">
          {paths.length} paths
        </span>
        <button
          type="button"
          className="ml-auto text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
          onClick={() => {
            const label = paths.length === 1
              ? `Delete path “${paths[0].name}”?`
              : `Delete all ${paths.length} paths in this bundle?`;
            if (window.confirm(`${label}\n\nThis removes the complete underlying path${paths.length === 1 ? '' : 's'}, including any other visible hops.`)) {
              deletePathBundle(bundleId, paths.map((path) => path.id));
            }
          }}
        >
          Delete
        </button>
      </div>

      {hopLabel && (
        <div className="mb-2 text-[10px] text-zinc-400">
          {hopLabel}
          {parsedBundle && (parsedBundle.sourceRefKey.startsWith('merge:') || parsedBundle.targetRefKey.startsWith('merge:'))
            ? ' · ends at splice'
            : ''}
        </div>
      )}

      {bundleId && (
        <BundleLengthEditor bundleId={bundleId} pathIds={pathIds} segments={segments} />
      )}

      {manufacturingBundle && (
        <button
          type="button"
          data-readonly-allowed
          onClick={() => openManufacturing(manufacturingBundle.id)}
          className="w-full mb-2 px-2.5 py-1.5 rounded border border-amber-800/70 bg-amber-950/30 text-[10px] text-amber-300 hover:bg-amber-950/60 hover:border-amber-600 transition-colors"
        >
          Open “{manufacturingBundle.name}” in Manufacturing →
        </button>
      )}

      {signalAppearances.size > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {[...signalAppearances.entries()].map(([signalId, { name, appearance }]) => (
            <EntityLink
              key={signalId}
              item={{ type: 'signal', id: signalId }}
              className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/60"
              title="Reveal signal"
            >
              <WireColorSwatch appearance={appearance} className="w-1.5 h-1.5 rounded-full" />
              <span className="text-zinc-300 hover:text-amber-300">{name}</span>
            </EntityLink>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        {paths.map((path) => {
          const sig = getPathSignalName(path);
          const signalId = getPathSignalId(path);
          const appearance = getPathWireAppearance(path, harness);
          const segment = segmentByPathId.get(path.id);
          const hopIndex = segment?.segmentIndex;
          const lengthMm = segment
            ? getPathSegmentMeasurement(path, segment.segmentIndex)?.length_mm
            : undefined;

          return (
            <div
              key={path.id}
              className="w-full text-left p-1.5 rounded bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/30 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <WireColorSwatch appearance={appearance} className="w-2 h-2 rounded-full" />
                <EntityLink
                  item={{ type: 'path', id: path.id }}
                  className="text-[10px] text-zinc-300 hover:text-amber-300 font-medium underline underline-offset-2"
                  title="Reveal path"
                >
                  {path.name}
                </EntityLink>
                {sig && signalId && (
                  <EntityLink
                    item={{ type: 'signal', id: signalId }}
                    className="text-[9px] text-zinc-500 hover:text-amber-300"
                    title="Reveal signal"
                  >
                    {sig}
                  </EntityLink>
                )}
                <span className="text-[9px] text-zinc-500 ml-auto">
                  {lengthMm !== undefined ? `${lengthMm} mm` : appearance.label}
                </span>
              </div>
              <div className="mt-1 pt-1 border-t border-zinc-700/30">
                <div className="text-[9px] text-zinc-500 mb-0.5">
                  Route · {path.nodes.length} node{path.nodes.length !== 1 ? 's' : ''}
                </div>
                <div className="space-y-px">
                  {path.nodes.map((node, nodeIndex) => {
                    const label = getPathNodeLabel(harness, node);
                    const isHopEndpoint =
                      hopIndex !== undefined &&
                      (nodeIndex === hopIndex || nodeIndex === hopIndex + 1);
                    const isLast = nodeIndex === path.nodes.length - 1;
                    const afterHop =
                      hopIndex !== undefined && nodeIndex === hopIndex;
                    return (
                      <div key={`${getPathNodeRefKey(node)}-${nodeIndex}`}>
                        <div className="flex items-start gap-1.5">
                          <div className="flex flex-col items-center shrink-0 w-3">
                            <span
                              className={`font-mono text-[8px] leading-none mt-0.5 ${
                                isHopEndpoint ? 'text-amber-500' : 'text-zinc-600'
                              }`}
                            >
                              {nodeIndex + 1}
                            </span>
                            {!isLast && (
                              <span
                                className={`text-[8px] leading-none mt-px ${
                                  afterHop ? 'text-amber-700' : 'text-zinc-700'
                                }`}
                              >
                                │
                              </span>
                            )}
                          </div>
                          <PathNodeLink
                            node={node}
                            className={`text-[10px] leading-tight ${
                              isHopEndpoint
                                ? 'text-amber-400 font-medium'
                                : 'text-zinc-400 hover:text-amber-300 underline underline-offset-2'
                            }`}
                          >
                            {label}
                            {afterHop && (
                              <span className="text-[8px] text-amber-600 ml-1">← this stretch</span>
                            )}
                          </PathNodeLink>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function EnclosureInspector({ enc }: { enc: Enclosure }) {
  const harness = useHarnessStore((s) => s.harness);
  const connectorLibrary = useHarnessStore((s) => s.connectorLibrary);
  const updateEnclosureProperty = useHarnessStore((s) => s.updateEnclosureProperty);
  const addConnector = useHarnessStore((s) => s.addConnector);
  const [imgPickerOpen, setImgPickerOpen] = useState(false);
  const closeImgPicker = useCallback(() => setImgPickerOpen(false), []);

  if (!harness) return null;
  const childEnclosures = harness.enclosures.filter((e) => e.parent === enc.id);
  const allConnectors = getEnclosureConnectors(harness, enc.id);
  const directConnectors = harness.connectors.filter((c) => c.parent === enc.id);
  const directMergePoints = harness.mergePoints.filter((mergePoint) => mergePoint.parent === enc.id);
  const encImage = enc.properties?.image as string | undefined;
  const pathCount = countPathsTouchingConnectors(harness, allConnectors.map((connector) => connector.id));
  const isDevice = !enc.container;

  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-bold text-zinc-100">
          {enc.container ? 'Enclosure' : 'Device'}
        </span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded ${enc.container ? 'bg-zinc-700 text-zinc-300' : 'bg-teal-900/60 text-teal-300'}`}>
          {enc.container ? 'Container' : 'Device'}
        </span>
      </div>
      <NameEditor key={`${enc.id}:${enc.name}`} name={enc.name} type="enclosure" id={enc.id} />
      <PropertyRow label="Stable ID" value={enc.id} />
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
                <EntityLink
                  key={child.id}
                  item={{ type: 'enclosure', id: child.id }}
                  className="w-full text-left flex items-center justify-between py-0.5 px-1.5 rounded hover:bg-zinc-800 transition-colors"
                >
                  <span className="text-[11px] text-amber-400 hover:text-amber-300">{child.name}</span>
                  <span className="text-zinc-500 text-[10px]">{childCons.length} connector{childCons.length !== 1 ? 's' : ''}</span>
                </EntityLink>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-2 pt-2 border-t border-zinc-700/50">
        <div className="text-[10px] text-zinc-500 font-medium mb-1">
          {isDevice ? 'Connectors' : 'Bulkheads'}
        </div>
        {directConnectors.length === 0 ? (
          <div className="text-[10px] text-zinc-600 italic">
            {isDevice ? 'No connectors' : 'No bulkheads'}
          </div>
        ) : (
          <div className="space-y-0.5">
            {directConnectors.map((c) => {
              const connectorType = connectorLibrary?.connector_types.find(
                (type) => type.id === c.connector_type,
              );
              const occupancySummary = formatConnectorOccupancySummary(
                getConnectorOccupancy(harness, c.id).length,
                c,
                connectorType,
              );
              return (
                <EntityLink
                  key={c.id}
                  item={{ type: 'connector', id: c.id }}
                  className="w-full text-left flex items-center justify-between py-0.5 px-1.5 rounded hover:bg-zinc-800 transition-colors"
                >
                  <span className="text-[11px] text-amber-400 hover:text-amber-300">{c.name}</span>
                  <span className="text-zinc-500 text-[10px]">{occupancySummary}</span>
                </EntityLink>
              );
            })}
          </div>
        )}
      </div>

      {directMergePoints.length > 0 && (
        <div className="mt-2 pt-2 border-t border-zinc-700/50">
          <div className="text-[10px] text-zinc-500 font-medium mb-1">Merge Points</div>
          <div className="space-y-0.5">
            {directMergePoints.map((mergePoint) => (
              <EntityLink
                key={mergePoint.id}
                item={{ type: 'mergePoint', id: mergePoint.id }}
                className="w-full text-left flex items-center justify-between py-0.5 px-1.5 rounded hover:bg-zinc-800 transition-colors"
              >
                <span className="text-[11px] text-cyan-300">{mergePoint.name}</span>
                <span className="text-zinc-500 text-[10px]">{mergePoint.id}</span>
              </EntityLink>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 pt-2 border-t border-zinc-700/50">
        <button
          type="button"
          onClick={() => addConnector(enc.id)}
          title={isDevice ? 'Add connector' : 'Add bulkhead'}
          aria-label={isDevice ? 'Add connector' : 'Add bulkhead'}
          className="w-full flex items-center justify-center py-1.5 rounded border border-dashed border-zinc-700 text-zinc-400 hover:text-amber-400 hover:border-amber-700/60 hover:bg-amber-950/20 transition-colors text-sm leading-none"
        >
          +
        </button>
      </div>
    </>
  );
}

function ConnectorInspector({ con }: { con: Connector }) {
  const harness = useHarnessStore((s) => s.harness);
  const connectorLibrary = useHarnessStore((s) => s.connectorLibrary);
  const updateConnectorTypeImage = useHarnessStore((s) => s.updateConnectorTypeImage);
  const updateConnectorTypeSideImage = useHarnessStore((s) => s.updateConnectorTypeSideImage);
  const setConnectorType = useHarnessStore((s) => s.setConnectorType);
  const openConnectorLibrary = useHarnessStore((s) => s.openConnectorLibrary);
  const setConnectorKeying = useHarnessStore((s) => s.setConnectorKeying);
  const addConnectorCavity = useHarnessStore((s) => s.addConnectorCavity);
  const removeConnectorCavity = useHarnessStore((s) => s.removeConnectorCavity);
  const updateConnectorProperty = useHarnessStore((s) => s.updateConnectorProperty);
  const [pinPickerOpen, setPinPickerOpen] = useState(false);
  const [sidePickerOpen, setSidePickerOpen] = useState(false);
  const [instanceImgPickerOpen, setInstanceImgPickerOpen] = useState(false);
  const closePinPicker = useCallback(() => setPinPickerOpen(false), []);
  const closeSidePicker = useCallback(() => setSidePickerOpen(false), []);
  const closeInstanceImgPicker = useCallback(() => setInstanceImgPickerOpen(false), []);
  const cavityControlsRef = useRef<HTMLDivElement>(null);
  const prevCavityStateRef = useRef<{ connectorId: string; pinCount: number } | null>(null);

  const ct = connectorLibrary?.connector_types.find((t) => t.id === con.connector_type);
  const effectivePinCount = getEffectivePinCount(con, ct);

  useLayoutEffect(() => {
    const prev = prevCavityStateRef.current;
    if (
      prev
      && prev.connectorId === con.id
      && effectivePinCount > prev.pinCount
    ) {
      cavityControlsRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' });
    }
    prevCavityStateRef.current = { connectorId: con.id, pinCount: effectivePinCount };
  }, [con.id, effectivePinCount]);

  if (!harness) return null;
  const typeOptions = [...(connectorLibrary?.connector_types ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const maxUsedPin = Math.max(0, ...getConnectorOccupancy(harness, con.id).map((entry) => entry.pinNumber));
  const familyType = isConnectorFamily(ct);
  const supportedPinCounts = getConnectorSupportedPinCounts(ct);
  const previousPinCount = getPreviousConnectorPinCount(ct, effectivePinCount, maxUsedPin);
  const nextPinCount = getNextConnectorPinCount(ct, effectivePinCount);
  const canRemoveCavity = previousPinCount < effectivePinCount;
  const canAddCavity = nextPinCount > effectivePinCount;
  const typeFloor = getConnectorTypeCavityFloor(ct);
  const exceedsType = ct != null
    && !familyType
    && effectivePinCount > Math.max(ct.pin_count, typeFloor)
    && ct.pin_count > 0;
  const keyingOptions = getConnectorSupportedKeyings(con, ct);
  const pinGuideImage = getConnectorPinGuideImage(con, ct);
  const sideImage = getConnectorSideImage(con, ct);

  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-bold text-zinc-100">Connector</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">
          Instance
        </span>
        {con.derived && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-900/50 text-sky-300 border border-sky-800/50">
            Derived
          </span>
        )}
      </div>
      <NameEditor key={`${con.id}:${con.name}`} name={con.name} type="connector" id={con.id} />
      <PropertyRow label="Stable ID" value={con.id} />

      {con.parent && (
        <div className="mb-2">
          <ParentLink parentId={con.parent} />
        </div>
      )}

      {con.derived && <DerivedFromPortNote portId={con.derived_from_port} />}

      <div className="mb-2 pb-2 border-b border-zinc-700/50">
        <label className="flex items-center gap-2 py-0.5">
          <span className="text-[10px] text-zinc-500 w-20 shrink-0 text-right">Type</span>
          <select
            value={con.connector_type}
            onChange={(event) => {
              if (event.target.value === '__manage_connector_library__') {
                openConnectorLibrary(con.connector_type);
                return;
              }
              setConnectorType(con.id, event.target.value);
            }}
            className="min-w-0 flex-1 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[11px] text-zinc-300 focus:border-amber-500 focus:outline-none"
          >
            {!typeOptions.some((option) => option.id === con.connector_type) && (
              <option value={con.connector_type}>
                {con.connector_type || '— unknown type —'}
              </option>
            )}
            {typeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
                {isConnectorFamily(option)
                  ? ` (${getConnectorTypeCavityFloor(option)}–${getConnectorSupportedPinCounts(option).at(-1)}p family)`
                  : option.pin_count > 0
                    ? ` (${option.pin_count}p)`
                    : ''}
              </option>
            ))}
            <option disabled>──────────</option>
            <option value="__manage_connector_library__">Manage connector library…</option>
          </select>
        </label>
        <div className="pl-[5.5rem] text-[9px] text-zinc-600">
          {con.connector_type}
          {' · '}
          {effectivePinCount} {effectivePinCount === 1 ? 'cavity' : 'cavities'}
          {familyType ? ' (family housing)' : con.pin_count != null ? ' (instance)' : ' (type)'}
        </div>
        {familyType && supportedPinCounts.length > 0 && (
          <div className="pl-[5.5rem] text-[9px] text-zinc-600">
            Available: {supportedPinCounts.join(', ')} cavities
          </div>
        )}
        {ct && (ct.crimp_spec || ct.wire_gauge) && (
          <div className="pl-[5.5rem] flex gap-x-3 text-[10px] text-zinc-500">
            {ct.crimp_spec && <span>{ct.crimp_spec}</span>}
            {ct.wire_gauge && <span>{ct.wire_gauge}</span>}
          </div>
        )}
      </div>

      {familyType && keyingOptions.length > 0 && (
        <div className="mb-2 pb-2 border-b border-zinc-700/50">
          <label className="flex items-center gap-2 py-0.5">
            <span className="text-[10px] text-zinc-500 w-20 shrink-0 text-right">Keying</span>
            <select
              value={con.keying ?? ''}
              onChange={(event) => setConnectorKeying(con.id, event.target.value || undefined)}
              className="min-w-0 flex-1 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[11px] text-zinc-300 focus:border-amber-500 focus:outline-none"
            >
              <option value="">Standard / unspecified</option>
              {keyingOptions.map((keying) => (
                <option key={keying} value={keying}>{keying}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {exceedsType && (
        <div className="mb-2 rounded border border-amber-700/60 bg-amber-950/40 px-2 py-1 text-[10px] text-amber-300">
          Instance has {effectivePinCount} cavities; type defines {ct.pin_count}. Extra cavities are an instance override.
        </div>
      )}
      {maxUsedPin > effectivePinCount && (
        <div className="mb-2 rounded border border-amber-700/60 bg-amber-950/40 px-2 py-1 text-[10px] text-amber-300">
          Uses cavity {maxUsedPin}, beyond the {effectivePinCount}-cavity instance capacity. Allowed, but unresolved.
        </div>
      )}

      {(() => {
        const freeHangingImg = con.properties?.image as string | undefined;
        return (
          <div className="mb-2 relative">
            <div className="text-[9px] text-zinc-500 font-medium mb-1 uppercase tracking-wider">Free hanging connector</div>
            {freeHangingImg ? (
              <div className="rounded overflow-hidden border border-zinc-700/60 bg-zinc-800">
                <img src={`/user-data/images/${freeHangingImg}`} alt={con.name} className="w-full object-contain" style={{ maxHeight: 100 }} />
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
                {freeHangingImg ? '⇄ Change image' : '+ Set image'}
              </button>
              {freeHangingImg && (
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
          {/* Pin-reading guide — inspector / manufacturing only; never on schematics */}
          <div className="mb-2">
            <div className="text-[9px] text-zinc-500 font-medium mb-1 uppercase tracking-wider">Pin guide</div>
            {pinGuideImage ? (
              <div className="rounded overflow-hidden border border-zinc-700/60 bg-zinc-800">
                <img src={`/user-data/images/${pinGuideImage}`} alt={ct.name} className="w-full object-contain" style={{ maxHeight: 120 }} />
              </div>
            ) : (
              <div className="rounded border border-dashed border-zinc-700 bg-zinc-800/40 flex items-center justify-center text-[10px] text-zinc-600 italic" style={{ height: 40 }}>
                No pin guide
              </div>
            )}
            <div className="mt-1 relative">
              <button onClick={() => setPinPickerOpen((p) => !p)} className="w-full text-[10px] text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded py-0.5 transition-colors">
                {pinGuideImage ? '⇄ Change' : '+ Set pin guide'}
              </button>
              {pinGuideImage && (
                <button onClick={() => updateConnectorTypeImage(ct.id, '', familyType ? effectivePinCount : undefined)} className="absolute right-0 top-0 bottom-0 px-2 text-zinc-500 hover:text-red-400 text-[10px]" title="Remove">✕</button>
              )}
              {pinPickerOpen && (
                <div className="absolute left-0 right-0 z-50" style={{ top: '100%' }}>
                  <ImagePickerPanel onPick={(f) => { updateConnectorTypeImage(ct.id, f, familyType ? effectivePinCount : undefined); setPinPickerOpen(false); }} onClose={closePinPicker} />
                </div>
              )}
            </div>
          </div>

          {/* Bulkhead side view — schematic thumbnail when wall-mounted on an enclosure */}
          <div className="mb-2">
            <div className="text-[9px] text-zinc-500 font-medium mb-1 uppercase tracking-wider">Side view (on boxes)</div>
            {sideImage ? (
              <div className="rounded overflow-hidden border border-zinc-700/60 bg-zinc-800">
                <img src={`/user-data/images/${sideImage}`} alt="" className="w-full object-contain" style={{ maxHeight: 80 }} />
              </div>
            ) : (
              <div className="rounded border border-dashed border-zinc-700 bg-zinc-800/40 flex items-center justify-center text-[10px] text-zinc-600 italic" style={{ height: 36 }}>
                No side view
              </div>
            )}
            <div className="mt-1 relative">
              <button onClick={() => setSidePickerOpen((p) => !p)} className="w-full text-[10px] text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded py-0.5 transition-colors">
                {sideImage ? '⇄ Change' : '+ Set side view'}
              </button>
              {sideImage && (
                <button onClick={() => updateConnectorTypeSideImage(ct.id, '', familyType ? effectivePinCount : undefined)} className="absolute right-0 top-0 bottom-0 px-2 text-zinc-500 hover:text-red-400 text-[10px]" title="Remove">✕</button>
              )}
              {sidePickerOpen && (
                <div className="absolute left-0 right-0 z-50" style={{ top: '100%' }}>
                  <ImagePickerPanel onPick={(f) => { updateConnectorTypeSideImage(ct.id, f, familyType ? effectivePinCount : undefined); setSidePickerOpen(false); }} onClose={closeSidePicker} />
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <div className="mb-1 pb-1 border-b border-zinc-700/50">
        <TagEditor entityType="connector" entityId={con.id} tags={con.tags} />
      </div>

      <ConnectorOccupancyTable connector={con} />
      <ConnectorGaugeBulkEditor connector={con} />

      <div ref={cavityControlsRef} className="mt-3 pt-2 border-t border-zinc-700/50 flex gap-1.5">
        <button
          type="button"
          onClick={() => removeConnectorCavity(con.id)}
          disabled={!canRemoveCavity}
          title={
            canRemoveCavity
              ? 'Remove last cavity'
              : maxUsedPin >= effectivePinCount && effectivePinCount > typeFloor
                ? 'Highest cavity is occupied'
                : familyType
                  ? 'No smaller family housing can fit the occupied cavities'
                  : 'Cannot go below connector type cavity count'
          }
          aria-label="Remove cavity"
          className="flex-1 flex items-center justify-center py-1.5 rounded border border-dashed border-zinc-700 text-zinc-400 hover:text-amber-400 hover:border-amber-700/60 hover:bg-amber-950/20 transition-colors text-sm leading-none disabled:opacity-30 disabled:hover:text-zinc-400 disabled:hover:border-zinc-700 disabled:hover:bg-transparent disabled:cursor-not-allowed"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => addConnectorCavity(con.id)}
          disabled={!canAddCavity}
          title={canAddCavity ? 'Select next cavity count' : 'Largest family housing selected'}
          aria-label="Add cavity"
          className="flex-1 flex items-center justify-center py-1.5 rounded border border-dashed border-zinc-700 text-zinc-400 hover:text-amber-400 hover:border-amber-700/60 hover:bg-amber-950/20 transition-colors text-sm leading-none disabled:opacity-30 disabled:hover:text-zinc-400 disabled:hover:border-zinc-700 disabled:hover:bg-transparent disabled:cursor-not-allowed"
        >
          +
        </button>
      </div>
    </>
  );
}

function MergePointInspector({ mergePoint }: { mergePoint: MergePoint }) {
  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-bold text-zinc-100">Merge Point</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-900/50 text-cyan-300">
          Junction
        </span>
        {mergePoint.derived && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-900/50 text-sky-300 border border-sky-800/50">
            Derived
          </span>
        )}
      </div>

      <NameEditor key={`${mergePoint.id}:${mergePoint.name}`} name={mergePoint.name} type="mergePoint" id={mergePoint.id} />
      {mergePoint.derived && <DerivedFromPortNote portId={mergePoint.derived_from_port} />}

      <PropertyRow label="Stable ID" value={mergePoint.id} />
      {mergePoint.parent && (
        <div className="flex items-start gap-2 py-0.5">
          <span className="text-[10px] text-zinc-500 w-20 shrink-0 text-right">Parent</span>
          <ParentLink parentId={mergePoint.parent} />
        </div>
      )}
      {Object.entries(mergePoint.properties).map(([key, value]) => (
        <PropertyRow key={key} label={key} value={value} />
      ))}

      <div className="mt-2 pt-2 border-t border-zinc-700/50">
        <TagEditor entityType="mergePoint" entityId={mergePoint.id} tags={mergePoint.tags} />
      </div>
    </>
  );
}

function SignalInspector({ signal }: { signal: Signal }) {
  const updateSignalProperty = useHarnessStore((s) => s.updateSignalProperty);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const preferredColor = signal.properties.preferred_wire_color ?? '';
  return (
    <>
      <div className="text-sm font-bold text-zinc-100 mb-2">Signal</div>
      <NameEditor key={`${signal.id}:${signal.name}`} name={signal.name} type="signal" id={signal.id} />
      <PropertyRow label="Stable ID" value={signal.id} />
      <div className="mt-2 pt-2 border-t border-zinc-700/50">
        <WireColorEditor
          label="Preferred"
          value={preferredColor}
          onChange={(value) => updateSignalProperty(signal.id, 'preferred_wire_color', value)}
          clearLabel="Remove preferred color"
          hint="Design guidance for paths using this signal. Stripes: white/brown"
        />
      </div>
      <div className="mt-2 text-[10px] text-zinc-500 font-medium">Properties</div>
      {Object.entries(signal.properties)
        .filter(([key]) => key !== 'preferred_wire_color')
        .map(([key, value]) => (
        <label key={key} className="flex items-center gap-2 py-1">
          <span className="text-[10px] text-zinc-500 w-24 text-right truncate" title={key}>{key}</span>
          <input
            defaultValue={value}
            onBlur={(event) => updateSignalProperty(signal.id, key, event.target.value)}
            className="min-w-0 flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px]"
          />
        </label>
      ))}
      <div className="flex gap-1 mt-1">
        <input value={newKey} onChange={(event) => setNewKey(event.target.value)} placeholder="property" className="min-w-0 w-1/2 bg-zinc-800 border border-zinc-700 rounded px-1 py-1 text-[10px]" />
        <input value={newValue} onChange={(event) => setNewValue(event.target.value)} placeholder="value" className="min-w-0 w-1/2 bg-zinc-800 border border-zinc-700 rounded px-1 py-1 text-[10px]" />
        <button
          className="text-amber-400"
          onClick={() => {
            if (!newKey.trim()) return;
            updateSignalProperty(signal.id, newKey.trim(), newValue);
            setNewKey('');
            setNewValue('');
          }}
        >
          +
        </button>
      </div>
      <div className="mt-3 pt-2 border-t border-zinc-700/50">
        <TagEditor entityType="signal" entityId={signal.id} tags={signal.tags} />
      </div>
    </>
  );
}

function StretchLengthEditor({
  pathId,
  segmentIndex,
  fromLabel,
  toLabel,
  lengthMm,
  note,
}: {
  pathId: string;
  segmentIndex: number;
  fromLabel: string;
  toLabel: string;
  lengthMm?: number;
  note?: string;
}) {
  const harness = useHarnessStore((s) => s.harness);
  const updatePathSegmentLength = useHarnessStore((s) => s.updatePathSegmentLength);
  const updateConnectorPairSegmentLengths = useHarnessStore(
    (s) => s.updateConnectorPairSegmentLengths,
  );
  const pushUndoSnapshot = useHarnessStore((s) => s.pushUndoSnapshot);
  const commitUndoSnapshot = useHarnessStore((s) => s.commitUndoSnapshot);
  const cancelUndoSnapshot = useHarnessStore((s) => s.cancelUndoSnapshot);
  const initialValue = lengthMm === undefined ? '' : String(lengthMm);
  const [draft, setDraft] = useState(initialValue);
  const cancelBlur = useRef(false);

  useEffect(() => {
    setDraft(initialValue);
  }, [initialValue]);

  const commit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setDraft('');
      updatePathSegmentLength(pathId, segmentIndex, undefined);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(initialValue);
      return;
    }
    setDraft(String(parsed));

    if (parsed === lengthMm) return;
    const currentPath = harness?.paths.find((path) => path.id === pathId);
    const from = currentPath?.nodes[segmentIndex];
    const to = currentPath?.nodes[segmentIndex + 1];
    if (harness && currentPath && from?.kind === 'connector' && to?.kind === 'connector') {
      const matches = getConnectorPairSegments(harness, from.connector_id, to.connector_id);
      const matchingPathIds = new Set(matches.map((match) => match.path.id));
      if (matchingPathIds.size > 1) {
        const connectorA = harness.connectors.find(
          (connector) => connector.id === from.connector_id,
        );
        const connectorB = harness.connectors.find(
          (connector) => connector.id === to.connector_id,
        );
        const connectorAName = connectorA?.name ?? from.connector_id;
        const connectorBName = connectorB?.name ?? to.connector_id;
        const wireLines = matches.map((match) => {
          const isCurrent =
            match.path.id === pathId && match.segmentIndex === segmentIndex;
          const route = `${getPathNodeLabel(harness, match.from)} → ${getPathNodeLabel(harness, match.to)}`;
          return `• ${match.path.name} (${route})${isCurrent ? ' — edited wire' : ''}`;
        });
        const overridden = matches.filter((match) => {
          if (match.path.id === pathId && match.segmentIndex === segmentIndex) return false;
          const existingLength = getPathSegmentMeasurement(
            match.path,
            match.segmentIndex,
          )?.length_mm;
          return existingLength !== undefined && existingLength !== parsed;
        });
        const overrideMessage = overridden.length > 0
          ? [
              'This will override existing lengths on:',
              ...overridden.map((match) => {
                const existingLength = getPathSegmentMeasurement(
                  match.path,
                  match.segmentIndex,
                )?.length_mm;
                return `• ${match.path.name}: ${existingLength} mm`;
              }),
            ].join('\n')
          : 'No existing lengths on the other wires will be overridden.';
        const applyToAll = window.confirm([
          `${matchingPathIds.size} wires run between ${connectorAName} and ${connectorBName}:`,
          '',
          ...wireLines,
          '',
          `Apply ${parsed} mm to all of these wires?`,
          '',
          overrideMessage,
          '',
          `OK: Change all wires\nCancel: Change only ${currentPath.name}`,
        ].join('\n'));
        if (applyToAll) {
          updateConnectorPairSegmentLengths(pathId, segmentIndex, parsed);
          return;
        }
      }
    }
    updatePathSegmentLength(pathId, segmentIndex, parsed);
  };

  return (
    <div className="ml-3 pl-5 py-1 border-l border-zinc-700/60">
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-zinc-600 uppercase tracking-wide">Stretch</span>
        <input
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => pushUndoSnapshot(`path:${pathId}:segment:${segmentIndex}:length`)}
          onBlur={(event) => {
            if (cancelBlur.current) {
              cancelBlur.current = false;
              cancelUndoSnapshot();
              return;
            }
            commit(event.currentTarget.value);
            commitUndoSnapshot();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              cancelBlur.current = true;
              setDraft(initialValue);
              event.currentTarget.blur();
            }
          }}
          placeholder="—"
          aria-label={`Length from ${fromLabel} to ${toLabel} in millimeters`}
          className="ml-auto w-20 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-right font-mono text-[10px] text-zinc-200 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
        />
        <span className="w-5 text-[9px] text-zinc-500">mm</span>
      </div>
      {note && <div className="pt-0.5 pr-7 text-[9px] text-zinc-500">{note}</div>}
    </div>
  );
}

function PathCommentEditor({ pathId, comment }: { pathId: string; comment: string }) {
  const updatePathProperty = useHarnessStore((s) => s.updatePathProperty);
  const pushUndoSnapshot = useHarnessStore((s) => s.pushUndoSnapshot);
  const commitUndoSnapshot = useHarnessStore((s) => s.commitUndoSnapshot);
  const cancelUndoSnapshot = useHarnessStore((s) => s.cancelUndoSnapshot);
  const [draft, setDraft] = useState(comment);
  const cancelBlur = useRef(false);

  useEffect(() => {
    setDraft(comment);
  }, [comment]);

  return (
    <textarea
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => pushUndoSnapshot(`path:${pathId}:property:notes`)}
      onBlur={(event) => {
        if (cancelBlur.current) {
          cancelBlur.current = false;
          cancelUndoSnapshot();
          return;
        }
        updatePathProperty(pathId, 'notes', event.currentTarget.value);
        commitUndoSnapshot();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelBlur.current = true;
          setDraft(comment);
          event.currentTarget.blur();
        }
      }}
      rows={3}
      placeholder="Add a comment…"
      aria-label="Wire comment"
      className="w-full resize-y bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-[11px] leading-relaxed text-zinc-200 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
    />
  );
}

const CREATE_NEW_SIGNAL_VALUE = '__create_new_signal__';

function PathInspector({ path }: { path: Path }) {
  const harness = useHarnessStore((s) => s.harness);
  const connectorLibrary = useHarnessStore((s) => s.connectorLibrary);
  const addSignal = useHarnessStore((s) => s.addSignal);
  const updatePathSignal = useHarnessStore((s) => s.updatePathSignal);
  const updatePathProperty = useHarnessStore((s) => s.updatePathProperty);
  const openSignalLibrary = useHarnessStore((s) => s.openSignalLibrary);
  if (!harness) return null;

  const signalName = getPathSignalName(path, harness);
  const signalId = getPathSignalId(path);
  const appearance = getPathWireAppearance(path, harness);
  const wireColor = (path.properties?.wire_color ?? path.properties?.color ?? '').trim();
  const wireGauge = (path.properties?.wire_gauge ?? '').trim();
  const inferredGauge = getPathInferredGauge(harness, path, connectorLibrary);
  const signal = signalId
    ? harness.signals.find((candidate) => candidate.id === signalId)
    : undefined;
  const colorDeviation = getPreferredWireColorDeviation(path, signal);
  const changeSignal = (nextSignalId: string) => {
    if (nextSignalId === CREATE_NEW_SIGNAL_VALUE) {
      const createdSignalId = addSignal({
        name: 'new signal',
        tags: [],
        properties: { preferred_wire_color: 'grey' },
      });
      if (!createdSignalId) return;
      updatePathSignal(path.id, createdSignalId);
      // Clear path override so the route follows the new signal's preferred color.
      updatePathProperty(path.id, 'wire_color', '');
      openSignalLibrary(createdSignalId);
      return;
    }
    updatePathSignal(path.id, nextSignalId || null);
  };
  const segmentMeasurements = path.nodes.slice(0, -1).map((from, index) => {
    const to = path.nodes[index + 1];
    const fromKey = getPathNodeRefKey(from);
    const toKey = getPathNodeRefKey(to);
    return path.measurements.find((measurement) => {
      const measurementFromKey = getPathNodeRefKey(measurement.from);
      const measurementToKey = getPathNodeRefKey(measurement.to);
      return (
        (measurementFromKey === fromKey && measurementToKey === toKey) ||
        (measurementFromKey === toKey && measurementToKey === fromKey)
      );
    });
  });
  const segmentMeasurementSet = new Set(segmentMeasurements.filter(Boolean));
  const spanningMeasurements = path.measurements.filter(
    (measurement) => !segmentMeasurementSet.has(measurement),
  );

  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-bold text-zinc-100">Path</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">
          {path.id}
        </span>
      </div>

      <NameEditor key={`${path.id}:${path.name}`} name={path.name} type="path" id={path.id} />
      <PropertyRow label="Stable ID" value={path.id} />
      <PropertyRow label="Nodes" value={String(path.nodes.length)} />
      <PropertyRow label="Segments" value={String(Math.max(0, path.nodes.length - 1))} />
      <label className="flex items-center gap-2 py-0.5">
        <span className="text-[10px] text-zinc-500 w-20 shrink-0 text-right">Signal</span>
        <select
          value={signalId ?? ''}
          onChange={(event) => changeSignal(event.target.value)}
          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-amber-500"
        >
          {!signalId && <option value="">Select signal…</option>}
          {signalId && !signal && (
            <option value={signalId}>{signalName ?? signalId} · missing</option>
          )}
          {[...harness.signals]
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name} · {candidate.id}
              </option>
            ))}
          <option disabled>──────────</option>
          <option value={CREATE_NEW_SIGNAL_VALUE}>+ Create new signal</option>
        </select>
      </label>
      {signalId && (
        <div className="flex items-center gap-2 py-0.5">
          <span className="text-[10px] text-zinc-500 w-20 shrink-0 text-right">Signal ID</span>
          <EntityLink
            item={{ type: 'signal', id: signalId }}
            className="truncate text-[10px] text-amber-400 hover:text-amber-300"
            title="Reveal signal"
          >
            {signalId}
          </EntityLink>
        </div>
      )}

      <div className="mt-2 pt-2 border-t border-zinc-700/50">
        <WireColorEditor
          label="Wire color"
          value={wireColor}
          onChange={(value) => updatePathProperty(path.id, 'wire_color', value)}
          clearLabel="Remove color (signal default)"
          hint={wireColor ? undefined : `Using signal default: ${appearance.label}. Stripes: white/brown`}
        />
        <WireGaugeEditor
          label="Wire gauge"
          value={wireGauge}
          onChange={(value) => updatePathProperty(path.id, 'wire_gauge', value)}
          clearLabel="Remove gauge (use crimp range)"
          hint={
            wireGauge
              ? undefined
              : inferredGauge.gauge
                ? `Using both-end crimp range: ${inferredGauge.gauge}`
                : 'No explicit gauge; both-end crimp ranges do not resolve a value'
          }
        />
      </div>

      {signalName && signalId && <SignalInfo signalId={signalId} appearance={appearance} />}
      {colorDeviation && (
        <div className="mt-2 rounded border border-amber-700/60 bg-amber-950/40 px-2 py-1 text-[10px] text-amber-300">
          Wire color {colorDeviation.actual} deviates from preferred {colorDeviation.preferred}.
        </div>
      )}

      <div className="mt-2 pt-2 border-t border-zinc-700/50">
        <div className="text-[10px] text-zinc-500 font-medium mb-1">Route</div>
        <div>
          {path.nodes.map((node, index) => {
            const nodeLabel = getPathNodeLabel(harness, node);
            const nextNode = path.nodes[index + 1];
            const nextLabel = nextNode ? getPathNodeLabel(harness, nextNode) : '';
            return (
              <div key={`${getPathNodeRefKey(node)}-${index}`}>
                <div className="text-[11px] text-zinc-300 flex items-center gap-2">
                  <span className="text-zinc-500 font-mono text-[10px] w-6 shrink-0">{index + 1}</span>
                  <PathNodeLink
                    node={node}
                    className="text-amber-400 hover:text-amber-300 underline underline-offset-2"
                  >
                    {nodeLabel}
                  </PathNodeLink>
                </div>
                {nextNode && (
                  <StretchLengthEditor
                    pathId={path.id}
                    segmentIndex={index}
                    fromLabel={nodeLabel}
                    toLabel={nextLabel}
                    lengthMm={segmentMeasurements[index]?.length_mm}
                    note={segmentMeasurements[index]?.note}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-2 pt-2 border-t border-zinc-700/50">
        <div className="text-[10px] text-zinc-500 font-medium mb-1">Comment</div>
        <PathCommentEditor pathId={path.id} comment={path.properties.notes ?? ''} />
      </div>

      {spanningMeasurements.length > 0 && (
        <div className="mt-2 pt-2 border-t border-zinc-700/50">
          <div className="text-[10px] text-zinc-500 font-medium mb-1">Other measurements</div>
          <div className="space-y-1">
            {spanningMeasurements.map((measurement, index) => (
              <div key={`${getPathNodeRefKey(measurement.from)}-${getPathNodeRefKey(measurement.to)}-${index}`} className="text-[10px] text-zinc-300 rounded bg-zinc-800/60 px-2 py-1">
                <PathNodeLink
                  node={measurement.from}
                  className="text-amber-400 hover:text-amber-300 underline underline-offset-2"
                >
                  {getPathNodeLabel(harness, measurement.from)}
                </PathNodeLink>
                {' → '}
                <PathNodeLink
                  node={measurement.to}
                  className="text-amber-400 hover:text-amber-300 underline underline-offset-2"
                >
                  {getPathNodeLabel(harness, measurement.to)}
                </PathNodeLink>
                {measurement.length_mm !== undefined ? ` · ${measurement.length_mm} mm` : ''}
                {measurement.note ? ` · ${measurement.note}` : ''}
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.entries(path.properties)
        .filter(([key]) => key !== 'wire_color' && key !== 'color' && key !== 'wire_gauge' && key !== 'notes')
        .map(([key, value]) => (
          <PropertyRow key={key} label={key} value={value} />
        ))}

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
  const pushUndoSnapshot = useHarnessStore((s) => s.pushUndoSnapshot);
  const commitUndoSnapshot = useHarnessStore((s) => s.commitUndoSnapshot);
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
          onFocus={() => pushUndoSnapshot(`textBox:${tb.id}:text`)}
          onBlur={() => {
            updateTextBox(tb.id, { text: localText });
            commitUndoSnapshot();
          }}
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
          <ReadOnlyInspectorControls>
            {tb ? (
              <TextBoxInspector tb={tb} />
            ) : (
              <div className="text-xs text-zinc-500 italic">Text box not found</div>
            )}
          </ReadOnlyInspectorControls>
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
  if (selectedBundle && selectedBundle.pathIds.length > 0) {
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
          <ReadOnlyInspectorControls>
            <BundleInspector bundleId={selectedBundle.id} pathIds={selectedBundle.pathIds} />
          </ReadOnlyInspectorControls>
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
        return <SignalInspector signal={entity as Signal} />;
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
      <div className="px-2 pb-3">
        <ReadOnlyInspectorControls>{renderContent()}</ReadOnlyInspectorControls>
      </div>
    </div>
  );
}
