import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { ImagePickerPanel } from '../graph/ImagePickerPanel';
import { useSystemStore, type EnclosureKindConvertImpact } from '../../store';
import type {
  Connector,
  ConnectorType,
  Enclosure,
  HierarchyEntity,
  EntityType,
  SystemData,
  BranchPoint,
  Path,
  PathNode,
  Signal,
  SubsystemDocument,
  TextBoxFontFamily,
  TextBoxFontWeight,
  TextBoxLayout,
  TextBoxTextAlign,
  CanvasImageLayout,
  CanvasImageLayer,
} from '../../types';
import {
  getPreferredWireColorDeviation,
  type WireAppearance,
} from '../../lib/colors';
import { branchPointToSharedAnchorBlockReason } from '../../lib/sharedAnchorJoin';
import {
  countPathsTouchingConnectors,
  getHarnessBundleWires,
  getConnectorPairSegments,
  getEntityRevealContext,
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
  isInlineConnector,
  getPathNodeLabel,
  getPathNodeRefKey,
  getPathSegmentMeasurement,
  getPathSignalId,
  getPathSignalName,
  getPathWireAppearance,
  getBranchPointSignalGroups,
  getBranchPointHarnessBundleFamilies,
  parseHarnessBundleId,
  parseHarnessBundleThruKey,
  getThroughKeyLabel,
  isBranchPointRefKey,
  type BulkheadWireSide,
} from '../../lib/systemTopology';
import { WIRE_GAUGE_PRESETS } from '../../lib/gauge';
import {
  deriveManufacturingBundles,
  getPathInferredGauge,
  manufacturingGenderBundleRelationship,
  type ManufacturingBundle,
  type ManufacturingEndpoint,
  type ManufacturingWire,
} from '../../lib/manufacturing';
import { normalizeDisplayName } from '../../lib/rename';
import { requestAddTextBox } from '../../lib/textBoxes';
import { WireColorEditor, WireColorSwatch } from '../WireColorEditor';
import { HarnessBundleRouteStyleControls } from '../graph/RouteStyleBar';
import {
  CONNECTOR_SHELL,
  DEVICE_SHELL,
  ENCLOSURE_SHELL,
  ENTITY_SHELL_PRESETS,
  parseHexColor,
} from '../../lib/entityColors';
import {
  isAutoBulkheadPlaceholder,
  isBulkheadDot,
} from '../../lib/bulkheadRouting';
import { newestAttribution } from '../../lib/collaborationPresence';
import {
  AttributionDisplay,
  PresenceBadge,
  PresenceEditingRegion,
} from '../collab/PresenceBadge';
import type { AttributionEntry, PresenceTarget } from '../../types/collab';

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
  const addTag = useSystemStore((s) => s.addTag);
  const removeTag = useSystemStore((s) => s.removeTag);
  const getAllExistingTags = useSystemStore((s) => s.getAllExistingTags);
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
  const isEditor = useSystemStore((state) => state.session.isEditor);

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
  const revealItem = useSystemStore((s) => s.revealItem);
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
  className = '',
}: {
  node: PathNode;
  children: React.ReactNode;
  className?: string;
}) {
  const item = node.kind === 'connector'
    ? { type: 'connector' as const, id: node.connector_id }
    : { type: 'branchPoint' as const, id: node.branch_point_id };
  const colorClass = node.kind === 'connector'
    ? 'text-vw-connector hover:opacity-80'
    : 'text-cyan-300 hover:opacity-80';
  return (
    <EntityLink
      item={item}
      className={`underline underline-offset-2 ${colorClass} ${className}`}
      title="Reveal referenced entity"
    >
      {children}
    </EntityLink>
  );
}

function NameEditor({
  name,
  type,
  id,
  label = 'Name',
  textClassName = 'text-zinc-100',
}: {
  name: string;
  type: EntityType;
  id: string;
  label?: string;
  textClassName?: string;
}) {
  const renameEntity = useSystemStore((s) => s.renameEntity);
  const pushUndoSnapshot = useSystemStore((s) => s.pushUndoSnapshot);
  const commitUndoSnapshot = useSystemStore((s) => s.commitUndoSnapshot);
  const cancelUndoSnapshot = useSystemStore((s) => s.cancelUndoSnapshot);
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
          data-presence-field="name"
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
          className={`min-w-0 flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] ${textClassName} focus:border-amber-500 focus:outline-none`}
        />
      </label>
      {error && <div className="pl-[5.5rem] pt-0.5 text-[9px] text-red-400">{error}</div>}
    </div>
  );
}

function EntityColorPicker({
  value,
  fallback,
  onChange,
  hint,
}: {
  value: string;
  fallback: string;
  onChange: (next: string) => void;
  hint?: string;
}) {
  const parsed = parseHexColor(value);
  const display = parsed ?? fallback;
  const [hex, setHex] = useState(display);
  useEffect(() => { setHex(display); }, [display]);

  return (
    <div className="py-1">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] text-zinc-500 w-20 shrink-0 text-right">Color</span>
        <label className="relative flex min-w-0 flex-1 items-center gap-1.5 cursor-pointer">
          <span
            className="w-5 h-5 rounded border border-zinc-600 shrink-0 inline-block"
            style={{ backgroundColor: display }}
          />
          <input
            type="color"
            value={display}
            onChange={(event) => {
              setHex(event.target.value);
              onChange(event.target.value);
            }}
            className="absolute left-0 top-0 h-5 w-5 cursor-pointer opacity-0"
          />
          <input
            type="text"
            value={hex}
            onChange={(event) => setHex(event.target.value)}
            onBlur={() => {
              if (/^#[0-9a-f]{6}$/i.test(hex) || /^#[0-9a-f]{3}$/i.test(hex)) onChange(hex);
              else setHex(display);
            }}
            className="flex-1 text-[10px] font-mono px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-300 focus:border-amber-600 focus:outline-none"
          />
        </label>
        <button
          type="button"
          disabled={!parsed}
          onClick={() => onChange('')}
          className="shrink-0 text-[10px] text-zinc-500 hover:text-zinc-300 disabled:opacity-30 disabled:hover:text-zinc-500"
        >
          Reset
        </button>
      </div>
      <div className="flex flex-wrap gap-1 pl-[5.5rem]">
        {ENTITY_SHELL_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            title={preset}
            onClick={() => { setHex(preset); onChange(preset); }}
            className="h-4 w-4 rounded border transition-all hover:scale-110"
            style={{
              backgroundColor: preset,
              borderColor: parsed === preset.toLowerCase() ? '#f59e0b' : 'rgba(255,255,255,0.12)',
            }}
          />
        ))}
      </div>
      {hint && <div className="pl-[5.5rem] pt-0.5 text-[9px] text-zinc-600">{hint}</div>}
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
  const system = useSystemStore((s) => s.system);
  const updateConnectorPathsGauge = useSystemStore((s) => s.updateConnectorPathsGauge);
  const [text, setText] = useState('');
  const [side, setSide] = useState<BulkheadWireSide>('both');

  if (!system) return null;
  const bulkhead = isBulkheadConnector(system, connector.id);
  const targets = getPathsTouchingConnector(system, connector.id, bulkhead ? side : 'both');
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
  const system = useSystemStore((s) => s.system);

  if (!system) return null;

  const enc = system.hierarchy.find((e) => e.id === parentId);
  const name = enc?.name ?? parentId;

  const isDevice = enc && enc.kind === 'device';

  return (
    <EntityLink
      item={{ type: 'enclosure', id: parentId }}
      className={`text-[11px] underline underline-offset-2 hover:opacity-80 ${
        isDevice ? 'text-vw-device' : 'text-vw-enclosure'
      }`}
    >
      {name}
    </EntityLink>
  );
}

function SignalInfo({ signalId, appearance }: { signalId: string; appearance?: WireAppearance | null }) {
  const system = useSystemStore((s) => s.system);
  if (!system) return null;

  const signal = system.signals.find(
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
  const system = useSystemStore((s) => s.system);
  const connectorLibrary = useSystemStore((s) => s.connectorLibrary);
  const splitBulkheadDotPath = useSystemStore((s) => s.splitBulkheadDotPath);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  if (!system) return null;

  const ct = connectorLibrary?.connector_types.find(
    (t: ConnectorType) => t.id === connector.connector_type,
  );
  const occupancy = getConnectorOccupancy(system, connector.id);
  const canReleaseWire = isBulkheadDot(connector)
    && new Set(occupancy.map((entry) => entry.pathId)).size > 1;
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
                      const path = system.paths.find((p) => p.id === item.pathId);
                      const appearance = path ? getPathWireAppearance(path, system) : null;

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
                            {canReleaseWire && (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  splitBulkheadDotPath(connector.id, item.pathId);
                                }}
                                className="shrink-0 rounded border border-zinc-700 px-1 text-[8px] text-zinc-500 hover:border-amber-700 hover:text-amber-300"
                                title="Pop this wire out into its own bulkhead dot"
                              >
                                Pop out
                              </button>
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
                                  const label = getPathNodeLabel(system, node);
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
                                        className={`text-[10px] leading-tight ${isCurrent ? 'font-medium' : ''}`}
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

function HarnessBundleLengthEditor({
  bundleId,
  pathIds,
  segments,
}: {
  bundleId: string;
  pathIds: string[];
  segments: ReturnType<typeof getHarnessBundleWires>;
}) {
  const updateHarnessBundleWireLengths = useSystemStore((s) => s.updateHarnessBundleWireLengths);
  const pushUndoSnapshot = useSystemStore((s) => s.pushUndoSnapshot);
  const commitUndoSnapshot = useSystemStore((s) => s.commitUndoSnapshot);
  const cancelUndoSnapshot = useSystemStore((s) => s.cancelUndoSnapshot);
  const lengths = segments.map(
    (segment) => getPathSegmentMeasurement(segment.path, segment.wireIndex)?.length_mm,
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
        const lengthMm = getPathSegmentMeasurement(segment.path, segment.wireIndex)?.length_mm;
        return lengthMm !== undefined;
      });
      if (existing.length > 0) {
        const confirmed = window.confirm([
          `Clear stretch length on ${existing.length} wire${existing.length === 1 ? '' : 's'} in this Harness Bundle?`,
          '',
          ...existing.map((segment) => {
            const lengthMm = getPathSegmentMeasurement(segment.path, segment.wireIndex)?.length_mm;
            return `• ${segment.path.name}: ${lengthMm} mm`;
          }),
        ].join('\n'));
        if (!confirmed) {
          setDraft(initialValue);
          return;
        }
      }
      setDraft('');
      updateHarnessBundleWireLengths(bundleId, pathIds, undefined);
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(initialValue);
      return;
    }
    setDraft(String(parsed));

    const withLength = segments.filter((segment) => {
      const lengthMm = getPathSegmentMeasurement(segment.path, segment.wireIndex)?.length_mm;
      return lengthMm !== undefined;
    });
    if (
      withLength.length === segments.length
      && withLength.every((segment) =>
        getPathSegmentMeasurement(segment.path, segment.wireIndex)?.length_mm === parsed)
    ) {
      return;
    }

    if (withLength.length > 0) {
      const confirmed = window.confirm([
        `${withLength.length} wire${withLength.length === 1 ? '' : 's'} in this Harness Bundle already have a length:`,
        '',
        ...withLength.map((segment) => {
          const lengthMm = getPathSegmentMeasurement(segment.path, segment.wireIndex)?.length_mm;
          return `• ${segment.path.name}: ${lengthMm} mm`;
        }),
        '',
        `Apply ${parsed} mm to all ${segments.length} wires in this Harness Bundle?`,
        '',
        'This only changes the stretch on this Harness Bundle hop (e.g. connector → branch point), not other segments of the path.',
      ].join('\n'));
      if (!confirmed) {
        setDraft(initialValue);
        return;
      }
    }

    updateHarnessBundleWireLengths(bundleId, pathIds, parsed);
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
          aria-label={`Length for all ${segments.length} wires in this Harness Bundle, in millimeters`}
          className="ml-auto w-20 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-right font-mono text-[10px] text-zinc-200 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
        />
        <span className="w-5 text-[9px] text-zinc-500">mm</span>
      </div>
      <div className="mt-1 text-[9px] text-zinc-600">
        Applies to this Harness Bundle hop only
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
  const system = useSystemStore((s) => s.system);
  const connectorLibrary = useSystemStore((s) => s.connectorLibrary);
  const manufacturing = useSystemStore((s) => s.manufacturing);
  const openManufacturing = useSystemStore((s) => s.openManufacturing);
  const deletePathHarnessBundle = useSystemStore((s) => s.deletePathHarnessBundle);
  const selectedRoutePoint = useSystemStore((s) =>
    s.selectedHarnessBundle?.id === bundleId ? s.selectedHarnessBundle.routePoint : undefined
  );
  const deleteSelectedRoutePoint = useSystemStore((s) => s.deleteSelectedRoutePoint);
  const sharedAnchors = useSystemStore((s) => s.sharedAnchors);
  const waypointLayouts = useSystemStore((s) => s.waypointLayouts);
  const convertSharedAnchorToBranchPoint = useSystemStore((s) => s.convertSharedAnchorToBranchPoint);
  const isEditor = useSystemStore((s) => s.session.isEditor);

  if (!system) return null;

  const paths = pathIds
    .map((id) => system.paths.find((path) => path.id === id))
    .filter(Boolean) as Path[];

  if (paths.length === 0) return null;

  const segments = bundleId ? getHarnessBundleWires(system, bundleId, pathIds) : [];
  const segmentByPathId = new Map(segments.map((segment) => [segment.path.id, segment]));
  const parsedBundle = bundleId ? parseHarnessBundleId(bundleId) : null;

  const selectedPathIds = new Set(pathIds);
  const selectedSegmentKeys = new Set(
    segments.map((segment) => `${segment.path.id}:${segment.wireIndex}`),
  );
  const manufacturingBundle = deriveManufacturingBundles(
    system,
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
    const signalName = getPathSignalName(path, system);
    if (signalId && signalName && !signalAppearances.has(signalId)) {
      signalAppearances.set(signalId, {
        name: signalName,
        appearance: getPathWireAppearance(path, system),
      });
    }
  }

  const firstSegment = segments[0];
  const hopLabel = firstSegment
    ? `${getPathNodeLabel(system, firstSegment.from)} → ${getPathNodeLabel(system, firstSegment.to)}`
    : null;
  const selectedWaypoint = selectedRoutePoint
    ? (waypointLayouts[bundleId] ?? [])[selectedRoutePoint.index]
    : undefined;
  const selectedSharedAnchorId = selectedWaypoint && 'sharedAnchorId' in selectedWaypoint
    ? selectedWaypoint.sharedAnchorId
    : null;
  const selectedSharedAnchor = selectedSharedAnchorId
    ? sharedAnchors[selectedSharedAnchorId]
    : undefined;
  const canPromoteSharedAnchor = isEditor
    && !!selectedSharedAnchor
    && !selectedSharedAnchor.branchPointId;

  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-bold text-zinc-100">
          Harness Bundle
        </span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">
          {paths.length} paths
        </span>
        {selectedRoutePoint && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-lime-900/50 text-lime-300 border border-lime-800/50">
            Route point
          </span>
        )}
        <button
          type="button"
          className="ml-auto text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
          onClick={() => {
            if (selectedRoutePoint) {
              deleteSelectedRoutePoint();
              return;
            }
            const label = paths.length === 1
              ? `Delete path “${paths[0].name}”?`
              : `Delete all ${paths.length} paths in this Harness Bundle?`;
            if (window.confirm(`${label}\n\nThis removes the complete underlying path${paths.length === 1 ? '' : 's'}, including any other visible hops.`)) {
              deletePathHarnessBundle(bundleId, paths.map((path) => path.id));
            }
          }}
        >
          {selectedRoutePoint ? 'Delete point' : 'Delete'}
        </button>
      </div>

      {selectedRoutePoint && (
        <div className="mb-2 text-[10px] text-zinc-400">
          This bend is selected. Delete removes it, not the path. Click the wire to select the whole Harness Bundle.
        </div>
      )}
      {canPromoteSharedAnchor && selectedSharedAnchor && (
        <button
          type="button"
          onClick={() => convertSharedAnchorToBranchPoint(selectedSharedAnchor.id)}
          className="w-full mb-2 px-2.5 py-1.5 rounded border border-cyan-800/70 bg-cyan-950/30 text-[10px] text-cyan-200 hover:bg-cyan-950/60 hover:border-cyan-600 transition-colors"
        >
          Convert to branch point
        </button>
      )}

      {hopLabel && (
        <div className="mb-2 text-[10px] text-zinc-400">
          {hopLabel}
          {parsedBundle && (isBranchPointRefKey(parsedBundle.sourceRefKey) || isBranchPointRefKey(parsedBundle.targetRefKey))
            ? ' · ends at branch point'
            : ''}
          {bundleId && parseHarnessBundleThruKey(bundleId) && system && (
            <span className="text-zinc-500">
              {' · continues to '}
              {getThroughKeyLabel(system, parseHarnessBundleThruKey(bundleId)!)}
            </span>
          )}
        </div>
      )}

      <div className="mb-2">
        <HarnessBundleRouteStyleControls edgeId={bundleId} extraEdgeIds={[bundleId]} />
      </div>

      {bundleId && (
        <HarnessBundleLengthEditor bundleId={bundleId} pathIds={pathIds} segments={segments} />
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
          const appearance = getPathWireAppearance(path, system);
          const segment = segmentByPathId.get(path.id);
          const hopIndex = segment?.wireIndex;
          const lengthMm = segment
            ? getPathSegmentMeasurement(path, segment.wireIndex)?.length_mm
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
                    const label = getPathNodeLabel(system, node);
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
                            className={`text-[10px] leading-tight ${isHopEndpoint ? 'font-medium' : ''}`}
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

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function confirmEnclosureKindConvert(name: string, impact: EnclosureKindConvertImpact): boolean {
  const fromKind = impact.fromEnclosure ? 'enclosure' : 'device';
  const toKind = impact.fromEnclosure ? 'device' : 'enclosure';
  const deletions: string[] = [];
  if (impact.nestedDeviceIds.length > 0) {
    deletions.push(countLabel(impact.nestedDeviceIds.length, 'device'));
  }
  if (impact.nestedEnclosureIds.length > 0) {
    deletions.push(countLabel(impact.nestedEnclosureIds.length, 'nested enclosure'));
  }
  if (impact.connectorIds.length > 0) {
    deletions.push(countLabel(impact.connectorIds.length, 'connector'));
  }
  if (impact.branchPointIds.length > 0) {
    deletions.push(countLabel(impact.branchPointIds.length, 'branch point'));
  }
  if (impact.pathIds.length > 0) {
    deletions.push(countLabel(impact.pathIds.length, 'path', 'paths'));
  }

  const header = `Convert "${name}" from ${fromKind} to ${toKind}?`;
  const body = impact.fromEnclosure && deletions.length > 0
    ? `${header}\n\nThis will delete everything inside it:\n${deletions.map((line) => `• ${line}`).join('\n')}\n\nYou can restore this with Undo.`
    : impact.fromEnclosure
      ? `${header}\n\nIts bulkheads will become device connectors. You will no longer be able to put devices inside it.`
      : `${header}\n\nIts connectors will become bulkheads. You will be able to put devices inside it.`;
  if (!window.confirm(body)) return false;
  if (impact.nestedDeviceIds.length >= 2) {
    return window.confirm(
      `Are you sure? This permanently deletes ${impact.nestedDeviceIds.length} devices inside "${name}".`,
    );
  }
  return true;
}

function deviceMatchesQuery(
  device: HierarchyEntity,
  parentName: string | null,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return device.name.toLowerCase().includes(needle)
    || device.id.toLowerCase().includes(needle)
    || (parentName?.toLowerCase().includes(needle) ?? false);
}

function listSubsystemDevices(
  system: SystemData,
  subsystem: SubsystemDocument,
  query: string,
) {
  const enclosureById = new Map(system.hierarchy.map((item) => [item.id, item]));
  const devices = system.hierarchy
    .filter((item) => item.kind === 'device')
    .map((device) => ({
      device,
      parentName: device.parent ? enclosureById.get(device.parent)?.name ?? null : null,
      included: Object.hasOwn(subsystem.devices, device.id),
    }))
    .filter(({ device, parentName }) => deviceMatchesQuery(device, parentName, query))
    .sort((left, right) => left.device.name.localeCompare(right.device.name));
  return devices.filter((item) => !item.included);
}

function isRepresentedInSubsystem(
  system: SystemData,
  subsystem: SubsystemDocument,
  type: 'enclosure' | 'connector',
  id: string,
): boolean {
  if (type === 'connector') {
    if (Object.hasOwn(subsystem.connectors, id)) return true;
    if ((subsystem.hidden_connectors ?? []).includes(id)) return false;
    const connector = system.connectors.find((item) => item.id === id);
    if (!connector?.parent) return false;
    const parent = system.hierarchy.find((item) => item.id === connector.parent);
    if (!parent || parent.kind === 'enclosure' || !Object.hasOwn(subsystem.devices, parent.id)) return false;
    return (subsystem.device_connector_mode?.[parent.id] ?? 'all') === 'all';
  }
  const entity = system.hierarchy.find((item) => item.id === id);
  if (!entity) return false;
  return entity.kind === 'enclosure'
    ? Object.hasOwn(subsystem.enclosures, id)
    : Object.hasOwn(subsystem.devices, id);
}

function SubsystemMembershipButton({
  type,
  id,
}: {
  type: 'enclosure' | 'connector';
  id: string;
}) {
  const editingSurface = useSystemStore((s) => s.editingSurface);
  const system = useSystemStore((s) => s.system);
  const subsystem = useSystemStore((s) => (
    s.activeSubsystemId ? s.subsystems[s.activeSubsystemId] : undefined
  ));
  const addEntity = useSystemStore((s) => s.addEntityToActiveSubsystem);
  const removeEntity = useSystemStore((s) => s.removeEntityFromActiveSubsystem);
  const [confirming, setConfirming] = useState(false);

  // A newly selected entity starts outside the destructive confirmation state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfirming(false);
  }, [id]);

  if (editingSurface !== 'subsystem' || !system || !subsystem) return null;

  const entity = type === 'enclosure'
    ? system.hierarchy.find((item) => item.id === id)
    : null;
  const kindLabel = type === 'connector'
    ? 'connector'
    : entity?.kind === 'enclosure'
      ? 'enclosure'
      : 'device';
  const included = isRepresentedInSubsystem(system, subsystem, type, id);
  const needsRemoveConfirm = type === 'enclosure' && entity?.kind === 'enclosure';

  if (confirming && included && needsRemoveConfirm) {
    return (
      <div className="mt-2 pt-2 border-t border-zinc-700/50">
        <div className="rounded border border-amber-800/70 bg-amber-950/30 p-2">
          <p className="text-[10px] font-medium text-amber-300">Remove enclosure from subsystem?</p>
          <p className="mt-1 text-[10px] leading-relaxed text-zinc-400">
            This removes the enclosure and nested devices from this subsystem view. They stay in the system. You can restore them with Undo.
          </p>
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                removeEntity(type, id);
                setConfirming(false);
              }}
              className="rounded bg-amber-500 px-2 py-1 text-[10px] font-medium text-zinc-950 hover:bg-amber-400"
            >
              Remove enclosure
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 pt-2 border-t border-zinc-700/50">
      <button
        type="button"
        onClick={() => {
          if (included) {
            if (needsRemoveConfirm) {
              setConfirming(true);
              return;
            }
            removeEntity(type, id);
          } else {
            addEntity(type, id);
          }
        }}
        className={`w-full rounded border px-2 py-1.5 text-[10px] transition-colors ${
          included
            ? 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-red-800/70 hover:bg-red-950/20 hover:text-red-300'
            : 'border-amber-800/60 bg-amber-950/20 text-amber-300 hover:border-amber-600 hover:bg-amber-950/40 hover:text-amber-200'
        }`}
      >
        {included ? `Remove ${kindLabel} from subsystem` : `Add ${kindLabel} to this subsystem`}
      </button>
    </div>
  );
}

function AddChildDeviceForm({ parentId }: { parentId: string }) {
  const addEnclosure = useSystemStore((s) => s.addEnclosure);
  const addEntity = useSystemStore((s) => s.addEntityToActiveSubsystem);
  const editingSurface = useSystemStore((s) => s.editingSurface);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const submit = () => {
    if (!trimmed) return;
    const createdId = addEnclosure({
      name: trimmed,
      parent: parentId,
      kind: 'device',
    });
    if (createdId && editingSurface === 'subsystem') {
      addEntity('enclosure', createdId);
    }
    setName('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Add a device inside this enclosure"
        className="w-full flex items-center justify-center py-1.5 rounded border border-dashed border-zinc-700 text-zinc-400 hover:text-vw-device hover:border-vw-device/60 hover:bg-vw-device/10 transition-colors text-[10px]"
      >
        + Device
      </button>
    );
  }

  return (
    <form
      className="flex gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        ref={inputRef}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setName('');
            setOpen(false);
          }
        }}
        onBlur={() => {
          if (!trimmed) setOpen(false);
        }}
        placeholder="Device name…"
        aria-label="New device name"
        className="min-w-0 flex-1 text-[11px] px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-vw-device placeholder-zinc-600 focus:border-vw-device focus:outline-none"
      />
      <button
        type="submit"
        disabled={!trimmed}
        className="shrink-0 rounded border border-vw-device/60 bg-vw-device/10 px-2 py-1 text-[10px] text-vw-device hover:bg-vw-device/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Add
      </button>
    </form>
  );
}

function SubsystemAddDeviceFooter() {
  const system = useSystemStore((s) => s.system);
  const subsystem = useSystemStore((s) => (
    s.activeSubsystemId ? s.subsystems[s.activeSubsystemId] : undefined
  ));
  const addEntity = useSystemStore((s) => s.addEntityToActiveSubsystem);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const available = useMemo(() => {
    if (!system || !subsystem) return [];
    return listSubsystemDevices(system, subsystem, query).slice(0, 12);
  }, [system, query, subsystem]);

  if (!system || !subsystem) return null;

  return (
    <div className="shrink-0 border-t border-zinc-800 px-2 pt-2">
      <div className="relative">
        {open && available.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-48 overflow-y-auto rounded border border-zinc-700 bg-zinc-900 shadow-lg">
            {available.map(({ device, parentName }) => (
              <button
                key={device.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  addEntity('enclosure', device.id);
                  setQuery('');
                  setOpen(false);
                }}
                className="flex w-full items-start justify-between gap-2 px-2 py-1.5 text-left hover:bg-zinc-800"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[11px] text-vw-device">{device.name}</span>
                  {parentName && (
                    <span className="block truncate text-[9px] text-vw-enclosure/50">{parentName}</span>
                  )}
                </span>
                <span className="shrink-0 text-[10px] text-amber-400">Add</span>
              </button>
            ))}
          </div>
        )}
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && available[0]) {
              event.preventDefault();
              addEntity('enclosure', available[0].device.id);
              setQuery('');
              setOpen(false);
            } else if (event.key === 'Escape') {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          placeholder="Add device…"
          aria-label="Add a device to this subsystem"
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-amber-600"
        />
      </div>
    </div>
  );
}

function EnclosureInspector({ enc }: { enc: HierarchyEntity }) {
  const system = useSystemStore((s) => s.system);
  const connectorLibrary = useSystemStore((s) => s.connectorLibrary);
  const updateEnclosureProperty = useSystemStore((s) => s.updateEnclosureProperty);
  const addConnector = useSystemStore((s) => s.addConnector);
  const addEntityToActiveSubsystem = useSystemStore((s) => s.addEntityToActiveSubsystem);
  const editingSurface = useSystemStore((s) => s.editingSurface);
  const subsystem = useSystemStore((s) => (
    s.activeSubsystemId ? s.subsystems[s.activeSubsystemId] : undefined
  ));
  const getEnclosureKindConvertImpact = useSystemStore((s) => s.getEnclosureKindConvertImpact);
  const convertEnclosureKind = useSystemStore((s) => s.convertEnclosureKind);
  const [imgPickerOpen, setImgPickerOpen] = useState(false);
  const closeImgPicker = useCallback(() => setImgPickerOpen(false), []);

  const handleConvertKind = useCallback(() => {
    const impact = getEnclosureKindConvertImpact(enc.id);
    if (!impact) return;
    if (!confirmEnclosureKindConvert(enc.name, impact)) return;
    convertEnclosureKind(enc.id);
  }, [convertEnclosureKind, enc.id, enc.name, getEnclosureKindConvertImpact]);

  if (!system) return null;
  const childEnclosures = system.hierarchy.filter((e) => e.parent === enc.id);
  const allConnectors = getEnclosureConnectors(system, enc.id);
  const directConnectors = system.connectors.filter((c) => c.parent === enc.id);
  const directBranchPoints = system.branchPoints.filter((branchPoint) => branchPoint.parent === enc.id);
  const encImage = enc.properties?.image as string | undefined;
  const extraProperties = Object.entries(enc.properties ?? {}).filter(([key]) => key !== 'image' && key !== 'color');
  const pathCount = countPathsTouchingConnectors(system, allConnectors.map((connector) => connector.id));
  const isDevice = enc.kind === 'device';

  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-sm font-bold ${enc.kind === 'enclosure' ? 'text-vw-enclosure' : 'text-vw-device'}`}>
          {enc.kind === 'enclosure' ? 'Enclosure' : 'Device'}
        </span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded ${enc.kind === 'enclosure' ? 'bg-white/10 text-vw-enclosure' : 'bg-vw-device/15 text-vw-device'}`}>
          {enc.kind === 'enclosure' ? 'Container' : 'Device'}
        </span>
        <button
          type="button"
          onClick={handleConvertKind}
          title={isDevice ? 'Convert this device into an enclosure' : 'Convert this enclosure into a device'}
          className="ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:text-amber-300 hover:border-amber-700/60 hover:bg-amber-950/20 transition-colors"
        >
          {isDevice ? 'Make enclosure' : 'Make device'}
        </button>
      </div>
      <NameEditor
        key={`${enc.id}:${enc.name}`}
        name={enc.name}
        type="enclosure"
        id={enc.id}
        textClassName={enc.kind === 'enclosure' ? 'text-vw-enclosure' : 'text-vw-device'}
      />
      <EntityColorPicker
        value={enc.properties?.color ?? ''}
        fallback={(enc.kind === 'enclosure' ? ENCLOSURE_SHELL : DEVICE_SHELL).fill}
        onChange={(next) => updateEnclosureProperty(enc.id, 'color', next)}
      />
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
        <div className="mt-1 flex gap-1">
          <div className="relative min-w-0 flex-1">
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
          <button
            type="button"
            onClick={() => requestAddTextBox(enc.id)}
            title="Add a text box on this device"
            className="shrink-0 px-2 text-[10px] text-zinc-400 hover:text-amber-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded py-0.5 transition-colors"
          >
            + Text box
          </button>
        </div>
      </div>

      <div className="mt-2 pt-2 border-t border-zinc-700/50">
        <div className="text-[10px] text-zinc-500 font-medium mb-1">Summary</div>
        <div className="text-[11px] text-zinc-300 space-y-0.5">
          {childEnclosures.length > 0 && <div>{childEnclosures.length} sub-enclosure{childEnclosures.length !== 1 ? 's' : ''}</div>}
          <div>{allConnectors.length} connector{allConnectors.length !== 1 ? 's' : ''}</div>
          <div>{directBranchPoints.length} branch point{directBranchPoints.length !== 1 ? 's' : ''}</div>
          <div>{pathCount} path{pathCount !== 1 ? 's' : ''}</div>
        </div>
      </div>

      <SubsystemMembershipButton type="enclosure" id={enc.id} />

      {childEnclosures.length > 0 && (
        <div className="mt-2 pt-2 border-t border-zinc-700/50">
          <div className="text-[10px] text-zinc-500 font-medium mb-1">
            {enc.kind === 'enclosure' ? 'Contents' : 'Sub-enclosures'}
          </div>
          <div className="space-y-0.5">
            {childEnclosures.map((child) => {
              const childCons = system.connectors.filter((c) => c.parent === child.id);
              const childInSubsystem = editingSurface === 'subsystem' && subsystem
                ? isRepresentedInSubsystem(system, subsystem, 'enclosure', child.id)
                : true;
              const canAddChild = editingSurface === 'subsystem' && !!subsystem && !childInSubsystem;
              return (
                <div
                  key={child.id}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-zinc-800"
                >
                  <EntityLink
                    item={{ type: 'enclosure', id: child.id }}
                    className="min-w-0 flex-1 text-left flex items-center justify-between"
                  >
                    <span className={`truncate text-[11px] hover:opacity-80 ${child.kind === 'enclosure' ? 'text-vw-enclosure' : 'text-vw-device'}`}>
                      {child.name}
                    </span>
                    <span className="ml-2 shrink-0 text-zinc-500 text-[10px]">
                      {childCons.length} connector{childCons.length !== 1 ? 's' : ''}
                    </span>
                  </EntityLink>
                  {canAddChild && (
                    <button
                      type="button"
                      title={`Add ${child.kind === 'enclosure' ? 'enclosure' : 'device'} to this subsystem`}
                      aria-label={`Add ${child.name} to this subsystem`}
                      onClick={() => addEntityToActiveSubsystem('enclosure', child.id)}
                      className="flex h-5 w-5 shrink-0 items-center justify-center text-sm leading-none text-zinc-500 hover:text-amber-300"
                    >
                      ＋
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-2 pt-2 border-t border-zinc-700/50">
        <div className="text-[10px] text-zinc-500 font-medium mb-1">
          {isDevice ? 'Connectors' : 'Bulkheads & inline connectors'}
        </div>
        {directConnectors.length === 0 ? (
          <div className="text-[10px] text-zinc-600 italic">
            No connectors
          </div>
        ) : (
          <div className="space-y-0.5">
            {directConnectors.map((c) => {
              const connectorType = connectorLibrary?.connector_types.find(
                (type) => type.id === c.connector_type,
              );
              const occupancySummary = formatConnectorOccupancySummary(
                getConnectorOccupancy(system, c.id).length,
                c,
                connectorType,
              );
              return (
                <EntityLink
                  key={c.id}
                  item={{ type: 'connector', id: c.id }}
                  className="w-full text-left flex items-center justify-between py-0.5 px-1.5 rounded hover:bg-zinc-800 transition-colors"
                >
                  <span className="min-w-0 truncate text-[11px] text-vw-connector hover:opacity-80">
                    {c.name}
                    {isInlineConnector(system, c) && (
                      <span className="ml-1 rounded bg-violet-950/70 px-1 py-0.5 text-[8px] uppercase tracking-wide text-violet-300">
                        inline
                      </span>
                    )}
                  </span>
                  <span className="text-zinc-500 text-[10px]">{occupancySummary}</span>
                </EntityLink>
              );
            })}
          </div>
        )}
      </div>

      {directBranchPoints.length > 0 && (
        <div className="mt-2 pt-2 border-t border-zinc-700/50">
          <div className="text-[10px] text-zinc-500 font-medium mb-1">Branch Points</div>
          <div className="space-y-0.5">
            {directBranchPoints.map((branchPoint) => (
              <EntityLink
                key={branchPoint.id}
                item={{ type: 'branchPoint', id: branchPoint.id }}
                className="w-full text-left flex items-center justify-between py-0.5 px-1.5 rounded hover:bg-zinc-800 transition-colors"
              >
                <span className="text-[11px] text-cyan-300">{branchPoint.name}</span>
                <span className="text-zinc-500 text-[10px]">{branchPoint.id}</span>
              </EntityLink>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 pt-2 border-t border-zinc-700/50 space-y-1.5">
        {!isDevice && editingSurface !== 'subsystem' && <AddChildDeviceForm parentId={enc.id} />}
        <button
          type="button"
          onClick={() => addConnector(enc.id)}
          title={isDevice ? 'Add connector' : 'Add bulkhead'}
          aria-label={isDevice ? 'Add connector' : 'Add bulkhead'}
          className="w-full flex items-center justify-center py-1.5 rounded border border-dashed border-zinc-700 text-zinc-400 hover:text-vw-connector hover:border-vw-connector/60 hover:bg-vw-connector/10 transition-colors text-[10px]"
        >
          {isDevice ? '+ Connector' : '+ Bulkhead'}
        </button>
      </div>

      <div className="mt-3 pt-2 border-t border-zinc-700/50">
        <TagEditor entityType="enclosure" entityId={enc.id} tags={enc.tags} />
      </div>

      {extraProperties.length > 0 && (
        <div className="mt-3 pt-2 border-t border-zinc-700/50">
          {extraProperties.map(([key, value]) => (
            <PropertyRow key={key} label={key} value={value} />
          ))}
        </div>
      )}
    </>
  );
}

type ContactGender = 'male' | 'female';

interface ConnectorGenderPath {
  key: string;
  pathId: string;
  pathName: string;
  otherLabel: string;
  otherItem: { type: EntityType; id: string } | null;
  sheetId: string | null;
  sheetName: string;
}

interface ConnectorGenderSide {
  bundle: ManufacturingBundle;
  bundleNames: string[];
  endpoint?: ManufacturingEndpoint;
  gender?: ContactGender;
  genderMixed: boolean;
  assignable: boolean;
  bulkheadSide: 'internal' | 'external' | 'mixed' | null;
  paths: ConnectorGenderPath[];
}

function connectorRelationForWire(
  wire: ManufacturingWire,
  connectorId: string,
): {
  endpoint: ManufacturingEndpoint;
  otherEndpoint: ManufacturingEndpoint;
} | null {
  if (wire.from.connectorId === connectorId) {
    return {
      endpoint: wire.from,
      otherEndpoint: wire.to,
    };
  }
  if (wire.to.connectorId === connectorId) {
    return {
      endpoint: wire.to,
      otherEndpoint: wire.from,
    };
  }
  return null;
}

function ConnectorGenderEditor({ connector }: { connector: Connector }) {
  const system = useSystemStore((s) => s.system);
  const connectorLibrary = useSystemStore((s) => s.connectorLibrary);
  const manufacturing = useSystemStore((s) => s.manufacturing);
  const updateGender = useSystemStore((s) => s.updateManufacturingEndpointGender);
  const isEditor = useSystemStore((s) => s.session.isEditor);

  const bundles = useMemo(
    () => system
      ? deriveManufacturingBundles(system, connectorLibrary, manufacturing)
      : [],
    [system, connectorLibrary, manufacturing],
  );
  const sides = useMemo<ConnectorGenderSide[]>(() => {
    if (!system) return [];
    const bulkhead = isBulkheadConnector(system, connector.id);
    const sideOrder = { internal: 0, external: 1, mixed: 2 } as const;

    const bundleSides = bundles
      .filter((bundle) => bundle.connectorIds.includes(connector.id))
      .map((bundle) => {
        let endpoint: ManufacturingEndpoint | undefined;
        const pathByKey = new Map<string, ConnectorGenderPath>();

        for (const wire of bundle.wires) {
          const relation = connectorRelationForWire(wire, connector.id);
          if (!relation) continue;
          endpoint ??= relation.endpoint;

          const otherItem: ConnectorGenderPath['otherItem'] =
            relation.otherEndpoint.connectorId
              ? { type: 'connector', id: relation.otherEndpoint.connectorId }
              : relation.otherEndpoint.branchPointId
                ? { type: 'branchPoint', id: relation.otherEndpoint.branchPointId }
                : null;
          const otherLabel = relation.otherEndpoint.connectorName
            ?? relation.otherEndpoint.label
            ?? 'Unresolved endpoint';
          const sheetId = getEntityRevealContext(
            system,
            otherItem ?? { type: 'path', id: wire.pathId },
            null,
          );
          const sheetName = sheetId
            ? system.hierarchy.find((item) => item.id === sheetId)?.name ?? sheetId
            : system.name ?? 'Root';
          const key = `${wire.pathId}:${otherItem?.type ?? 'endpoint'}:${otherItem?.id ?? otherLabel}`;
          if (!pathByKey.has(key)) {
            pathByKey.set(key, {
              key,
              pathId: wire.pathId,
              pathName: wire.pathName || wire.pathId,
              otherLabel,
              otherItem,
              sheetId,
              sheetName,
            });
          }
        }

        const relationship = manufacturingGenderBundleRelationship(
          system,
          bundles,
          bundle.id,
          connector.id,
        );
        const bulkheadSide = bulkhead ? relationship.physicalSide ?? null : null;
        return {
          bundle,
          endpoint,
          gender:
            manufacturing.bundles[bundle.id]?.endpoint_genders?.[connector.id]
            ?? endpoint?.terminalGender,
          assignable: relationship.assignable,
          bulkheadSide,
          paths: [...pathByKey.values()].sort(
            (a, b) => a.pathName.localeCompare(b.pathName, undefined, { numeric: true })
              || a.otherLabel.localeCompare(b.otherLabel, undefined, { numeric: true }),
          ),
        };
      });

    const groupedSides: ConnectorGenderSide[] = [];
    if (bulkhead) {
      const groups = new Map<string, typeof bundleSides>();
      for (const side of bundleSides) {
        const groupKey = side.bulkheadSide === 'internal' || side.bulkheadSide === 'external'
          ? side.bulkheadSide
          : `bundle:${side.bundle.id}`;
        groups.set(groupKey, [...(groups.get(groupKey) ?? []), side]);
      }
      for (const group of groups.values()) {
        const first = group[0];
        if (!first) continue;
        const genderKeys = new Set(
          group.map((side) => side.gender ?? 'unassigned'),
        );
        const pathByKey = new Map<string, ConnectorGenderPath>();
        for (const side of group) {
          for (const path of side.paths) pathByKey.set(path.key, path);
        }
        groupedSides.push({
          bundle: first.bundle,
          bundleNames: group.map((side) => side.bundle.name),
          endpoint: first.endpoint,
          gender: genderKeys.size === 1 ? first.gender : undefined,
          genderMixed: genderKeys.size > 1,
          assignable: group.every((side) => side.assignable),
          bulkheadSide: first.bulkheadSide,
          paths: [...pathByKey.values()].sort(
            (a, b) => a.pathName.localeCompare(b.pathName, undefined, { numeric: true })
              || a.otherLabel.localeCompare(b.otherLabel, undefined, { numeric: true }),
          ),
        });
      }
    } else {
      groupedSides.push(...bundleSides.map((side) => ({
        ...side,
        bundleNames: [side.bundle.name],
        genderMixed: false,
      })));
    }

    return groupedSides.sort((a, b) => {
      if (a.bulkheadSide && b.bulkheadSide) {
        const sideComparison = sideOrder[a.bulkheadSide] - sideOrder[b.bulkheadSide];
        if (sideComparison !== 0) return sideComparison;
      } else if (a.bulkheadSide) {
        return -1;
      } else if (b.bulkheadSide) {
        return 1;
      }
      return a.bundle.name.localeCompare(b.bundle.name, undefined, { numeric: true });
    });
  }, [bundles, connector, system, manufacturing]);

  if (!system) return null;

  const bulkhead = isBulkheadConnector(system, connector.id);
  const connectorKind = bulkhead
    ? 'Bulkhead connector'
    : sides.length > 1
      ? 'Inline connector'
      : 'Connector end';
  const assignGender = (
    side: ConnectorGenderSide,
    gender: ContactGender | undefined,
  ) => {
    if (!side.assignable) {
      if (gender !== undefined) return;
      updateGender(side.bundle.id, connector.id, undefined, [], []);
      return;
    }
    const relationship = manufacturingGenderBundleRelationship(
      system,
      bundles,
      side.bundle.id,
      connector.id,
    );
    updateGender(
      side.bundle.id,
      connector.id,
      gender,
      relationship.mateBundleIds,
      relationship.sameSideBundleIds,
    );
  };

  return (
    <div className="mt-2 pt-2 border-t border-zinc-700/50 space-y-2">
      <div className="text-[10px] text-zinc-500 font-medium">Contact gender</div>
      <div className="text-[9px] leading-relaxed text-zinc-600">
        {connectorKind}
        {sides.length > 1
          ? ' · choosing one side sets the opposite gender on the mating side'
          : sides.length === 1
            ? ' · only one manufacturable side is connected'
            : ''}
      </div>

      {sides.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-700 bg-zinc-900/30 px-2 py-3 text-center text-[10px] text-zinc-500">
          No manufacturable path ends at this connector.
        </div>
      ) : (
        sides.map((side, index) => {
          const sideLabel = side.bulkheadSide === 'internal'
            ? 'Internal side'
            : side.bulkheadSide === 'external'
              ? 'External side'
              : side.bulkheadSide === 'mixed'
                ? 'Mixed bulkhead side'
              : bulkhead
                ? 'Unresolved bulkhead side'
                : sides.length > 1
                  ? `Side ${index + 1}`
                  : 'Harness side';
          const contactPart = side.gender === 'male'
            ? side.endpoint?.maleCrimpPartNumber
            : side.gender === 'female'
              ? side.endpoint?.femaleCrimpPartNumber
              : undefined;

          return (
            <section
              key={side.bundle.id}
              className="overflow-hidden rounded border border-zinc-700/70 bg-zinc-950/40"
            >
              <div className="flex items-start gap-2 border-b border-zinc-800 px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-semibold text-zinc-200">{sideLabel}</div>
                  <div
                    className="truncate text-[9px] text-zinc-500"
                    title={side.bundleNames.join('\n')}
                  >
                    {side.bundleNames.length === 1
                      ? side.bundleNames[0]
                      : `${side.bundleNames.length} system runs`}
                  </div>
                </div>
                <select
                  disabled={
                    !isEditor
                    || (!side.assignable && !side.gender && !side.genderMixed)
                  }
                  title={side.assignable
                    ? undefined
                    : 'This side is ambiguous; only clearing an existing assignment is allowed'}
                  value={side.genderMixed ? '__mixed__' : side.gender ?? ''}
                  onChange={(event) => assignGender(
                    side,
                    (event.target.value || undefined) as ContactGender | undefined,
                  )}
                  aria-label={`${connector.name} ${sideLabel} contact gender`}
                  className={`shrink-0 rounded border bg-zinc-900 px-1.5 py-1 text-[10px] focus:border-amber-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                    side.gender
                      ? 'border-zinc-700 text-zinc-200'
                      : 'border-amber-800 text-amber-300'
                  }`}
                >
                  {side.genderMixed && <option value="__mixed__" disabled>Mixed assignments</option>}
                  <option value="">Unassigned</option>
                  <option value="male" disabled={!side.assignable}>Male</option>
                  <option value="female" disabled={!side.assignable}>Female</option>
                </select>
              </div>

              <div className="space-y-1 p-2">
                {side.paths.map((path) => (
                  <div key={path.key} className="rounded bg-zinc-900/60 px-1.5 py-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="shrink-0 text-[8px] uppercase tracking-wide text-zinc-600">
                        Path
                      </span>
                      <EntityLink
                        item={{ type: 'path', id: path.pathId }}
                        className="truncate text-[10px] text-amber-400 hover:text-amber-300 underline underline-offset-2"
                        title={`Reveal ${path.pathName}`}
                      >
                        {path.pathName}
                      </EntityLink>
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[9px]">
                      <span className="shrink-0 text-zinc-600">Connector</span>
                      {path.otherItem ? (
                        <EntityLink
                          item={path.otherItem}
                          className={`truncate underline underline-offset-2 hover:opacity-80 ${
                            path.otherItem.type === 'connector' ? 'text-vw-connector' : 'text-cyan-300'
                          }`}
                          title={`Reveal ${path.otherLabel}`}
                        >
                          {path.otherLabel}
                        </EntityLink>
                      ) : (
                        <span className="truncate text-zinc-400">{path.otherLabel}</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[9px]">
                      <span className="shrink-0 text-zinc-600">Sheet</span>
                      {path.sheetId ? (
                        <EntityLink
                          item={{ type: 'enclosure', id: path.sheetId }}
                          className="truncate text-vw-enclosure hover:opacity-80 underline underline-offset-2"
                          title={`Reveal ${path.sheetName}`}
                        >
                          {path.sheetName}
                        </EntityLink>
                      ) : (
                        <span className="truncate text-zinc-400">{path.sheetName}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-zinc-800 px-2 py-1 text-[9px]">
                {!side.assignable ? (
                  <span className="text-red-400">
                    Ambiguous bulkhead side · clear any saved assignment or fix the paths
                  </span>
                ) : side.genderMixed ? (
                  <span className="text-red-400">
                    Conflicting assignments on this physical side
                  </span>
                ) : side.gender ? (
                  <span className={contactPart ? 'text-zinc-400' : 'text-zinc-600'}>
                    {contactPart ? `Manufacturing contact · ${contactPart}` : 'No contact part configured'}
                  </span>
                ) : (
                  <span className="text-amber-500">Choose a contact gender for manufacturing</span>
                )}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function ConnectorInspector({ con }: { con: Connector }) {
  const system = useSystemStore((s) => s.system);
  const connectorLibrary = useSystemStore((s) => s.connectorLibrary);
  const updateConnectorTypeImage = useSystemStore((s) => s.updateConnectorTypeImage);
  const updateConnectorTypeSideImage = useSystemStore((s) => s.updateConnectorTypeSideImage);
  const setConnectorType = useSystemStore((s) => s.setConnectorType);
  const openConnectorLibrary = useSystemStore((s) => s.openConnectorLibrary);
  const setConnectorKeying = useSystemStore((s) => s.setConnectorKeying);
  const addConnectorCavity = useSystemStore((s) => s.addConnectorCavity);
  const removeConnectorCavity = useSystemStore((s) => s.removeConnectorCavity);
  const updateConnectorProperty = useSystemStore((s) => s.updateConnectorProperty);
  const setConnectorDotDisplay = useSystemStore((s) => s.setConnectorDotDisplay);
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

  if (!system) return null;
  const typeOptions = [...(connectorLibrary?.connector_types ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const maxUsedPin = Math.max(0, ...getConnectorOccupancy(system, con.id).map((entry) => entry.pinNumber));
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
  const bulkhead = isBulkheadConnector(system, con.id);
  const dot = isBulkheadDot(con);
  const canChangeBulkheadDisplay = bulkhead
    && (dot || isAutoBulkheadPlaceholder(con));

  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-bold text-vw-connector">Connector</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">
          Instance
        </span>
        {con.derived && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-900/50 text-sky-300 border border-sky-800/50">
            Derived
          </span>
        )}
        {isInlineConnector(system, con) && (
          <span className="rounded border border-violet-800/50 bg-violet-950/60 px-1.5 py-0.5 text-[9px] text-violet-300">
            Inline
          </span>
        )}
        {dot && (
          <span className="rounded border border-amber-800/50 bg-amber-950/50 px-1.5 py-0.5 text-[9px] text-amber-300">
            Dot
          </span>
        )}
      </div>
      <NameEditor key={`${con.id}:${con.name}`} name={con.name} type="connector" id={con.id} textClassName="text-vw-connector" />
      <EntityColorPicker
        value={con.properties?.color ?? ''}
        fallback={CONNECTOR_SHELL.fill}
        onChange={(next) => updateConnectorProperty(con.id, 'color', next)}
        hint="Default uses the signal tint when this connector has a single signal."
      />
      <PropertyRow label="Stable ID" value={con.id} />
      <SubsystemMembershipButton type="connector" id={con.id} />

      {con.parent && (
        <div className="mb-2">
          <ParentLink parentId={con.parent} />
        </div>
      )}

      {canChangeBulkheadDisplay && (
        <div className="mb-2 rounded border border-zinc-700/60 bg-zinc-900/40 p-2">
          <div className="mb-1 text-[10px] font-medium text-zinc-300">
            Unresolved bulkhead display
          </div>
          <div className="mb-1.5 text-[9px] leading-relaxed text-zinc-500">
            This changes only the visual form. The stable ID, wall crossing, cavities, and routed wires stay intact.
          </div>
          <button
            type="button"
            onClick={() => setConnectorDotDisplay(con.id, !dot)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 hover:border-amber-700 hover:text-amber-300"
          >
            {dot ? 'Convert back to unresolved bulkhead' : 'Convert to visual dot'}
          </button>
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
      <ConnectorGenderEditor connector={con} />

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

function BranchPointBundlesEditor({ branchPoint }: { branchPoint: BranchPoint }) {
  const system = useSystemStore((s) => s.system);
  const separateBranchPointFamily = useSystemStore((s) => s.separateBranchPointFamily);
  const families = useMemo(
    () => system ? getBranchPointHarnessBundleFamilies(system, branchPoint.id) : [],
    [system, branchPoint.id],
  );
  if (families.length < 2) return null;

  return (
    <div className="mt-3 pt-2 border-t border-zinc-700/50">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
          Bundles
        </div>
        <span className="text-[9px] px-1.5 py-px rounded bg-zinc-800 text-zinc-500">
          {families.length} distinct connections
        </span>
      </div>
      <div className="mb-1.5 text-[9px] leading-relaxed text-zinc-500">
        Each row below is a distinct connection through this branch point. Split one onto its own new branch point — the inverse of whatever fuse joined them here.
      </div>
      <div className="space-y-1">
        {families.map((family) => (
          <div
            key={family.key}
            className="flex items-center gap-2 rounded border border-zinc-700/40 bg-zinc-900/40 px-1.5 py-1"
          >
            <span className="flex-1 min-w-0 text-[10px] text-zinc-300 truncate" title={family.label}>
              {family.label}
            </span>
            <span className="text-[9px] text-zinc-500 shrink-0">
              {family.pathIds.length} path{family.pathIds.length !== 1 ? 's' : ''}
            </span>
            <button
              type="button"
              onClick={() => separateBranchPointFamily(
                branchPoint.id,
                family.occurrences.map((occurrence) => ({ pathId: occurrence.pathId, nodeIndex: occurrence.nodeIndex })),
              )}
              className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-400 hover:border-amber-700 hover:text-amber-300 transition-colors"
              title="Move this connection onto a new, separate branch point"
            >
              Split out
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function BranchPointInspector({ branchPoint }: { branchPoint: BranchPoint }) {
  const system = useSystemStore((s) => s.system);
  const isEditor = useSystemStore((s) => s.session.isEditor);
  const convertBranchPointToSharedAnchor = useSystemStore((s) => s.convertBranchPointToSharedAnchor);
  const demoteReason = system ? branchPointToSharedAnchorBlockReason(system, branchPoint.id) : 'No system is loaded.';
  const signalGroups = useMemo(
    () => system ? getBranchPointSignalGroups(system, branchPoint.id) : [],
    [system, branchPoint.id],
  );
  const pathCount = signalGroups.reduce((sum, group) => sum + group.paths.length, 0);

  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-bold text-zinc-100">Branch Point</span>
        {branchPoint.derived && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-900/50 text-sky-300 border border-sky-800/50">
            Derived
          </span>
        )}
      </div>

      {isEditor && (
        demoteReason ? (
          <div className="mb-2 text-[10px] text-zinc-500">
            Convert to shared anchor is unavailable. {demoteReason}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => convertBranchPointToSharedAnchor(branchPoint.id)}
            className="w-full mb-2 px-2.5 py-1.5 rounded border border-zinc-600 bg-zinc-800/70 text-[10px] text-zinc-200 hover:bg-zinc-800 hover:border-zinc-400 transition-colors"
          >
            Convert to shared anchor
          </button>
        )
      )}
      <NameEditor key={`${branchPoint.id}:${branchPoint.name}`} name={branchPoint.name} type="branchPoint" id={branchPoint.id} />
      {branchPoint.derived && <DerivedFromPortNote portId={branchPoint.derived_from_port} />}

      <PropertyRow label="Stable ID" value={branchPoint.id} />
      {branchPoint.parent && (
        <div className="flex items-start gap-2 py-0.5">
          <span className="text-[10px] text-zinc-500 w-20 shrink-0 text-right">Parent</span>
          <ParentLink parentId={branchPoint.parent} />
        </div>
      )}
      {Object.entries(branchPoint.properties).map(([key, value]) => (
        <PropertyRow key={key} label={key} value={value} />
      ))}

      <BranchPointBundlesEditor branchPoint={branchPoint} />

      <div className="mt-3 pt-2 border-t border-zinc-700/50">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
            Signals
          </div>
          <span className="text-[9px] px-1.5 py-px rounded bg-zinc-800 text-zinc-500">
            {pathCount} path{pathCount !== 1 ? 's' : ''}
          </span>
        </div>
        {signalGroups.length === 0 ? (
          <div className="text-[10px] text-zinc-600 italic">No wires through this branch point</div>
        ) : (
          <div className="space-y-2">
            {signalGroups.map((group) => (
              <div
                key={group.key}
                className="rounded border border-zinc-700/40 bg-zinc-900/40 overflow-hidden"
              >
                <div className="flex items-center gap-1.5 px-1.5 py-1 bg-zinc-800/50">
                  <WireColorSwatch appearance={group.appearance} className="w-2 h-2 rounded-full shrink-0" />
                  {group.signalId ? (
                    <EntityLink
                      item={{ type: 'signal', id: group.signalId }}
                      className="text-[11px] font-medium text-zinc-200 hover:text-amber-300"
                      title="Reveal signal"
                    >
                      {group.signalName}
                    </EntityLink>
                  ) : (
                    <span className="text-[11px] font-medium text-zinc-400">{group.signalName}</span>
                  )}
                  <span className="ml-auto text-[9px] text-zinc-500">
                    {group.paths.length} path{group.paths.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="divide-y divide-zinc-800/70">
                  {group.paths.map((entry) => (
                    <div key={entry.pathId} className="px-1.5 py-1.5">
                      <EntityLink
                        item={{ type: 'path', id: entry.pathId }}
                        className="text-[10px] text-zinc-400 hover:text-amber-300 font-medium"
                        title="Reveal path"
                      >
                        {entry.pathName}
                      </EntityLink>
                      <div className="mt-1 flex flex-wrap items-center gap-x-0.5 gap-y-0.5">
                        {entry.stops.map((stop, stopIndex) => {
                          const item = stop.kind === 'connector'
                            ? { type: 'connector' as const, id: stop.id }
                            : { type: 'branchPoint' as const, id: stop.id };
                          const isLast = stopIndex === entry.stops.length - 1;
                          return (
                            <span key={`${stop.id}:${stopIndex}`} className="inline-flex items-center gap-0.5">
                              <EntityLink
                                item={item}
                                className={`text-[10px] ${
                                  stop.isBranchStop
                                    ? 'text-cyan-300 font-medium'
                                    : stop.kind === 'connector'
                                      ? 'text-vw-connector hover:opacity-80'
                                      : 'text-cyan-400/80 hover:opacity-80'
                                }`}
                                title="Reveal"
                              >
                                {stop.label}
                              </EntityLink>
                              {!isLast && (
                                <span className="text-[9px] text-zinc-600 px-0.5">→</span>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2 pt-2 border-t border-zinc-700/50">
        <TagEditor entityType="branchPoint" entityId={branchPoint.id} tags={branchPoint.tags} />
      </div>
    </>
  );
}

function SignalInspector({ signal }: { signal: Signal }) {
  const updateSignalProperty = useSystemStore((s) => s.updateSignalProperty);
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
  const system = useSystemStore((s) => s.system);
  const updatePathSegmentLength = useSystemStore((s) => s.updatePathSegmentLength);
  const updateConnectorPairSegmentLengths = useSystemStore(
    (s) => s.updateConnectorPairSegmentLengths,
  );
  const pushUndoSnapshot = useSystemStore((s) => s.pushUndoSnapshot);
  const commitUndoSnapshot = useSystemStore((s) => s.commitUndoSnapshot);
  const cancelUndoSnapshot = useSystemStore((s) => s.cancelUndoSnapshot);
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
    const currentPath = system?.paths.find((path) => path.id === pathId);
    const from = currentPath?.nodes[segmentIndex];
    const to = currentPath?.nodes[segmentIndex + 1];
    if (system && currentPath && from?.kind === 'connector' && to?.kind === 'connector') {
      const matches = getConnectorPairSegments(system, from.connector_id, to.connector_id);
      const matchingPathIds = new Set(matches.map((match) => match.path.id));
      if (matchingPathIds.size > 1) {
        const connectorA = system.connectors.find(
          (connector) => connector.id === from.connector_id,
        );
        const connectorB = system.connectors.find(
          (connector) => connector.id === to.connector_id,
        );
        const connectorAName = connectorA?.name ?? from.connector_id;
        const connectorBName = connectorB?.name ?? to.connector_id;
        const wireLines = matches.map((match) => {
          const isCurrent =
            match.path.id === pathId && match.wireIndex === segmentIndex;
          const route = `${getPathNodeLabel(system, match.from)} → ${getPathNodeLabel(system, match.to)}`;
          return `• ${match.path.name} (${route})${isCurrent ? ' — edited wire' : ''}`;
        });
        const overridden = matches.filter((match) => {
          if (match.path.id === pathId && match.wireIndex === segmentIndex) return false;
          const existingLength = getPathSegmentMeasurement(
            match.path,
            match.wireIndex,
          )?.length_mm;
          return existingLength !== undefined && existingLength !== parsed;
        });
        const overrideMessage = overridden.length > 0
          ? [
              'This will override existing lengths on:',
              ...overridden.map((match) => {
                const existingLength = getPathSegmentMeasurement(
                  match.path,
                  match.wireIndex,
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
  const updatePathProperty = useSystemStore((s) => s.updatePathProperty);
  const pushUndoSnapshot = useSystemStore((s) => s.pushUndoSnapshot);
  const commitUndoSnapshot = useSystemStore((s) => s.commitUndoSnapshot);
  const cancelUndoSnapshot = useSystemStore((s) => s.cancelUndoSnapshot);
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
  const system = useSystemStore((s) => s.system);
  const connectorLibrary = useSystemStore((s) => s.connectorLibrary);
  const addSignal = useSystemStore((s) => s.addSignal);
  const updatePathSignal = useSystemStore((s) => s.updatePathSignal);
  const updatePathProperty = useSystemStore((s) => s.updatePathProperty);
  const openSignalLibrary = useSystemStore((s) => s.openSignalLibrary);
  if (!system) return null;

  const signalName = getPathSignalName(path, system);
  const signalId = getPathSignalId(path);
  const appearance = getPathWireAppearance(path, system);
  const wireColor = (path.properties?.wire_color ?? path.properties?.color ?? '').trim();
  const wireGauge = (path.properties?.wire_gauge ?? '').trim();
  const inferredGauge = getPathInferredGauge(system, path, connectorLibrary);
  const signal = signalId
    ? system.signals.find((candidate) => candidate.id === signalId)
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
          {[...system.signals]
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
            const nodeLabel = getPathNodeLabel(system, node);
            const nextNode = path.nodes[index + 1];
            const nextLabel = nextNode ? getPathNodeLabel(system, nextNode) : '';
            return (
              <div key={`${getPathNodeRefKey(node)}-${index}`}>
                <div className="text-[11px] text-zinc-300 flex items-center gap-2">
                  <span className="text-zinc-500 font-mono text-[10px] w-6 shrink-0">{index + 1}</span>
                  <PathNodeLink
                    node={node}
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
                >
                  {getPathNodeLabel(system, measurement.from)}
                </PathNodeLink>
                {' → '}
                <PathNodeLink
                  node={measurement.to}
                >
                  {getPathNodeLabel(system, measurement.to)}
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
  const updateTextBox = useSystemStore((s) => s.updateTextBox);
  const removeTextBox = useSystemStore((s) => s.removeTextBox);
  const selectTextBox = useSystemStore((s) => s.selectTextBox);
  const pushUndoSnapshot = useSystemStore((s) => s.pushUndoSnapshot);
  const commitUndoSnapshot = useSystemStore((s) => s.commitUndoSnapshot);

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
          value={tb.text}
          onChange={(e) => updateTextBox(tb.id, { text: e.target.value, autoFit: true })}
          onKeyDown={(e) => e.stopPropagation()}
          onFocus={() => pushUndoSnapshot(`textBox:${tb.id}:text`)}
          onBlur={() => commitUndoSnapshot()}
          rows={6}
          placeholder="Type here… Enter for a new line"
          className="w-full text-[11px] px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:border-amber-600 focus:outline-none resize-y whitespace-pre-wrap"
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
        <div className="flex items-center gap-2 py-0.5">
          <span className="text-[10px] text-zinc-500 w-16 shrink-0 text-right">Size</span>
          <span className="text-[11px] text-zinc-400">Auto-fits the box ({tb.fontSize}px)</span>
        </div>

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
            {([['left', 'Left'], ['center', 'Center']] as [TextBoxTextAlign, string][]).map(([a, label]) => (
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
                {label}
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
                onChange={(e) => updateTextBox(tb.id, { w: Number(e.target.value), autoFit: true })}
                className="w-14 text-[10px] font-mono px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-300 focus:border-amber-600 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-zinc-600">H</span>
              <input
                type="number"
                value={Math.round(tb.h)}
                onChange={(e) => updateTextBox(tb.id, { h: Number(e.target.value), autoFit: true })}
                className="w-14 text-[10px] font-mono px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-300 focus:border-amber-600 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </TbSection>
    </>
  );
}

function ImageInspector({ img }: { img: CanvasImageLayout }) {
  const updateImage = useSystemStore((s) => s.updateImage);
  const removeImage = useSystemStore((s) => s.removeImage);
  const selectImage = useSystemStore((s) => s.selectImage);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <input
          value={img.name}
          onChange={(e) => updateImage(img.id, { name: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 text-sm font-bold bg-transparent text-zinc-100 focus:outline-none focus:border-b focus:border-amber-600"
        />
        <button
          className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
          onClick={() => { removeImage(img.id); selectImage(null); }}
        >
          Delete
        </button>
      </div>

      <div className="relative mb-2 overflow-hidden rounded border border-zinc-700 bg-zinc-950">
        <img
          src={`/user-data/images/${img.image}`}
          alt={img.name}
          className="mx-auto max-h-32 object-contain"
        />
      </div>

      <TbSection label="Placement">
        <label className="flex items-center gap-2 py-1 cursor-pointer">
          <input
            type="checkbox"
            checked={img.locked}
            onChange={(e) => updateImage(img.id, { locked: e.target.checked })}
            className="accent-amber-500"
          />
          <span className="text-[11px] text-zinc-300">Locked</span>
        </label>
        <p className="text-[10px] text-zinc-500 pl-6 mb-1.5">
          Dragging does not move a locked image. Double-click it on the canvas to select it.
        </p>
        <div className="flex items-center gap-2 py-0.5">
          <span className="text-[10px] text-zinc-500 w-16 shrink-0 text-right">Layer</span>
          <div className="flex gap-1 flex-1">
            {([['background', 'Background'], ['foreground', 'Foreground']] as [CanvasImageLayer, string][]).map(([layer, label]) => (
              <button
                key={layer}
                type="button"
                onClick={() => updateImage(img.id, { layer })}
                className={`flex-1 text-[10px] py-0.5 rounded border transition-colors ${
                  (img.layer ?? 'background') === layer
                    ? 'border-amber-500 text-amber-400 bg-amber-900/20'
                    : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </TbSection>

      <TbSection label="Size">
        <div className="flex items-start gap-2 py-0.5">
          <span className="text-[10px] text-zinc-500 w-16 shrink-0 text-right">Size</span>
          <div className="flex gap-1.5 flex-1">
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-zinc-600">W</span>
              <input
                type="number"
                value={Math.round(img.w)}
                onChange={(e) => updateImage(img.id, { w: Number(e.target.value) })}
                className="w-14 text-[10px] font-mono px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-300 focus:border-amber-600 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-zinc-600">H</span>
              <input
                type="number"
                value={Math.round(img.h)}
                onChange={(e) => updateImage(img.id, { h: Number(e.target.value) })}
                className="w-14 text-[10px] font-mono px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-300 focus:border-amber-600 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </TbSection>

      <TbSection label="File">
        <div className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-[10px] text-zinc-300 hover:border-amber-700/60 hover:text-amber-300"
          >
            Change image
          </button>
          {pickerOpen && (
            <ImagePickerPanel
              title="Replace image"
              onPick={(filename) => {
                updateImage(img.id, { image: filename });
                setPickerOpen(false);
              }}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
        <div className="mt-1 text-[10px] text-zinc-500 truncate" title={img.image}>
          {img.image}
        </div>
      </TbSection>
    </>
  );
}

function SubsystemLayoutResetFooter() {
  const activeSubsystemId = useSystemStore((s) => s.activeSubsystemId);
  const resetActiveSubsystemLayoutFromSystem = useSystemStore(
    (s) => s.resetActiveSubsystemLayoutFromSystem,
  );
  const [confirming, setConfirming] = useState(false);

  // Switching subsystems cancels a confirmation opened for the previous one.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfirming(false);
  }, [activeSubsystemId]);

  if (!activeSubsystemId) return null;

  if (!confirming) {
    return (
      <div className="shrink-0 border-t border-zinc-800 px-2 py-2">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-[10px] text-zinc-400 hover:border-amber-700/60 hover:bg-amber-950/20 hover:text-amber-300 transition-colors"
        >
          Reset to system layout
        </button>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-zinc-800 px-2 py-2">
      <div className="rounded border border-amber-800/70 bg-amber-950/30 p-2">
        <p className="text-[10px] font-medium text-amber-300">Reset to system layout?</p>
        <p className="mt-1 text-[10px] leading-relaxed text-zinc-400">
          This overwrites positions and sizes in this subsystem with the current System view layout. You can restore it with Undo.
        </p>
        <div className="mt-2 flex justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              resetActiveSubsystemLayoutFromSystem();
              setConfirming(false);
            }}
            className="rounded bg-amber-500 px-2 py-1 text-[10px] font-medium text-zinc-950 hover:bg-amber-400"
          >
            Reset layout
          </button>
        </div>
      </div>
    </div>
  );
}

function InspectorShell({
  children,
  scrollKey,
  attribution,
}: {
  children: React.ReactNode;
  scrollKey: unknown;
  attribution?: AttributionEntry | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editingSurface = useSystemStore((s) => s.editingSurface);
  const activeSubsystemId = useSystemStore((s) => s.activeSubsystemId);
  const selectedItem = useSystemStore((s) => s.selectedItem);
  const selectedHarnessBundle = useSystemStore((s) => s.selectedHarnessBundle);
  const selectedTextBoxId = useSystemStore((s) => s.selectedTextBoxId);
  const selectedImageId = useSystemStore((s) => s.selectedImageId);
  const isEditor = useSystemStore((s) => s.session.isEditor);
  const showReset = editingSurface === 'subsystem' && !!activeSubsystemId && isEditor;
  const showAddDevice = showReset && !!(selectedItem || selectedHarnessBundle || selectedTextBoxId || selectedImageId);

  useEffect(() => {
    containerRef.current?.scrollTo(0, 0);
  }, [scrollKey]);

  return (
    <div className="flex h-full flex-col">
      <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>
      <AttributionDisplay entry={attribution ?? null} />
      {showAddDevice && <SubsystemAddDeviceFooter />}
      {showReset && <SubsystemLayoutResetFooter />}
    </div>
  );
}

export function InspectorPanel() {
  const selectedItem = useSystemStore((s) => s.selectedItem);
  const selectedHarnessBundle = useSystemStore((s) => s.selectedHarnessBundle);
  const selectedTextBoxId = useSystemStore((s) => s.selectedTextBoxId);
  const selectedImageId = useSystemStore((s) => s.selectedImageId);
  const textBoxLayouts = useSystemStore((s) => s.textBoxLayouts);
  const imageLayouts = useSystemStore((s) => s.imageLayouts);
  const findEntity = useSystemStore((s) => s.findEntity);
  const system = useSystemStore((s) => s.system);
  const attribution = useSystemStore((s) => s.attribution);
  const scrollKey = selectedImageId ?? selectedTextBoxId ?? selectedHarnessBundle?.id ?? selectedItem?.id;
  const selectedAttribution = newestAttribution(
    attribution,
    selectedHarnessBundle?.pathIds
      ?? (selectedImageId
        ? [selectedImageId]
        : selectedTextBoxId
          ? [selectedTextBoxId]
          : selectedItem
            ? [selectedItem.id]
            : []),
  );

  if (selectedImageId) {
    const img = imageLayouts[selectedImageId];
    return (
      <InspectorShell scrollKey={scrollKey} attribution={selectedAttribution}>
        <div className="px-2 py-1 flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
            Inspector
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-800/50">
            Image
          </span>
          <PresenceBadge kind="image" id={selectedImageId} />
        </div>
        <div className="px-2 pb-3">
          <PresenceEditingRegion target={{ kind: 'image', id: selectedImageId }}>
            <ReadOnlyInspectorControls>
              {img ? (
                <ImageInspector img={img} />
              ) : (
                <div className="text-xs text-zinc-500 italic">Image not found</div>
              )}
            </ReadOnlyInspectorControls>
          </PresenceEditingRegion>
        </div>
      </InspectorShell>
    );
  }

  // Text box inspector
  if (selectedTextBoxId) {
    const tb = textBoxLayouts[selectedTextBoxId];
    return (
      <InspectorShell scrollKey={scrollKey} attribution={selectedAttribution}>
        <div className="px-2 py-1 flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
            Inspector
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-800/50">
            Text Box
          </span>
          <PresenceBadge kind="textBox" id={selectedTextBoxId} />
        </div>
        <div className="px-2 pb-3">
          <PresenceEditingRegion target={{ kind: 'textBox', id: selectedTextBoxId }}>
            <ReadOnlyInspectorControls>
              {tb ? (
                <TextBoxInspector tb={tb} />
              ) : (
                <div className="text-xs text-zinc-500 italic">Text box not found</div>
              )}
            </ReadOnlyInspectorControls>
          </PresenceEditingRegion>
        </div>
      </InspectorShell>
    );
  }

  if (!system) {
    return (
      <InspectorShell scrollKey={scrollKey} attribution={selectedAttribution}>
        <div className="p-3 text-xs text-zinc-500 italic">
          Select an item to inspect
        </div>
      </InspectorShell>
    );
  }

  // Harness Bundle inspector
  if (selectedHarnessBundle && selectedHarnessBundle.pathIds.length > 0) {
    return (
      <InspectorShell scrollKey={scrollKey}>
        <div className="px-2 py-1 flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
            Inspector
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">
            Harness Bundle
          </span>
          <PresenceBadge kind="harnessBundle" id={selectedHarnessBundle.id} />
        </div>
        <div className="px-2 pb-3">
          <PresenceEditingRegion target={{ kind: 'harnessBundle', id: selectedHarnessBundle.id }}>
            <ReadOnlyInspectorControls>
              <BundleInspector bundleId={selectedHarnessBundle.id} pathIds={selectedHarnessBundle.pathIds} />
            </ReadOnlyInspectorControls>
          </PresenceEditingRegion>
        </div>
      </InspectorShell>
    );
  }

  if (!selectedItem) {
    return (
      <InspectorShell scrollKey={scrollKey}>
        <div className="p-3 text-xs text-zinc-500 italic">
          Select an item to inspect
        </div>
      </InspectorShell>
    );
  }

  const entity = findEntity(selectedItem.type, selectedItem.id);
  if (!entity) {
    return (
      <InspectorShell scrollKey={scrollKey}>
        <div className="p-3 text-xs text-red-400">
          Entity not found: {selectedItem.id}
        </div>
      </InspectorShell>
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
      case 'branchPoint': {
        return <BranchPointInspector branchPoint={entity as BranchPoint} />;
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
    branchPoint: 'Branch Point',
    path: 'Path',
    signal: 'Signal',
  };

  return (
    <InspectorShell scrollKey={scrollKey} attribution={selectedAttribution}>
      <div className="px-2 py-1 flex items-center gap-1.5">
        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
          Inspector
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">
          {typeLabels[selectedItem.type] ?? selectedItem.type}
        </span>
        <PresenceBadge kind={selectedItem.type} id={selectedItem.id} />
      </div>
      <div className="px-2 pb-3">
        <PresenceEditingRegion
          target={{ kind: selectedItem.type, id: selectedItem.id } as PresenceTarget}
        >
          <ReadOnlyInspectorControls>{renderContent()}</ReadOnlyInspectorControls>
        </PresenceEditingRegion>
      </div>
    </InspectorShell>
  );
}
