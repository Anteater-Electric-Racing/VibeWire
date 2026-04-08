import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { ImagePickerPanel } from '../graph/ImagePickerPanel';
import { useHarnessStore } from '../../store';
import type {
  Enclosure,
  PCB,
  Connector,
  Pin,
  Wire,
  Signal,
  ConnectorType,
} from '../../types';
import { getSignalColor } from '../../lib/colors';
import {
  getConnectorEnclosure,
  getEnclosureConnectors,
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

function ParentLink({ parentId }: { parentId: string }) {
  const selectItem = useHarnessStore((s) => s.selectItem);
  const harness = useHarnessStore((s) => s.harness);

  if (!harness) return null;

  const enc = harness.enclosures.find((e) => e.id === parentId);
  const pcb = harness.pcbs.find((p) => p.id === parentId);
  const name = enc?.name ?? pcb?.name ?? parentId;
  const type = enc ? 'enclosure' : pcb ? 'pcb' : 'enclosure';

  return (
    <button
      onClick={() => selectItem({ type, id: parentId })}
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

function WireStatusEditor({ wireId, tags }: { wireId: string; tags: string[] }) {
  const addTag = useHarnessStore((s) => s.addTag);
  const removeTag = useHarnessStore((s) => s.removeTag);
  const [nameInput, setNameInput] = useState('');

  const currentStatusTag = tags.find((t) => t.startsWith('status:'));
  const currentStatus = currentStatusTag?.slice(7) ?? '';
  const currentByTag = tags.find((t) => t.startsWith('by:'));
  const currentBy = currentByTag?.slice(3) ?? '';

  const handleStatusChange = (newVal: string) => {
    if (currentStatusTag) removeTag('wire', wireId, currentStatusTag);
    if (newVal) addTag('wire', wireId, `status:${newVal}`);
  };

  const handleNameCommit = () => {
    const name = nameInput.trim();
    if (!name) return;
    if (currentByTag) removeTag('wire', wireId, currentByTag);
    addTag('wire', wireId, `by:${name}`);
    setNameInput('');
  };

  const handleRemoveName = () => {
    if (currentByTag) removeTag('wire', wireId, currentByTag);
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

function SignalInfo({ signalName }: { signalName: string }) {
  const harness = useHarnessStore((s) => s.harness);
  if (!harness) return null;

  const signal = harness.signals.find(
    (s: Signal) => s.name === signalName,
  );
  if (!signal) return null;

  return (
    <div className="mt-2 pt-2 border-t border-zinc-700/50">
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="w-2 h-2 rounded-full inline-block"
          style={{ background: getSignalColor(signalName) }}
        />
        <span className="text-[10px] text-zinc-400 font-medium">
          Signal: {signal.name}
        </span>
      </div>
      {Object.entries(signal.properties).map(([key, value]) => (
        <PropertyRow key={key} label={key} value={value} />
      ))}
    </div>
  );
}

function WireEndpointLink({
  pinId,
  label,
}: {
  pinId: string;
  label: string;
}) {
  const findPinOwner = useHarnessStore((s) => s.findPinOwner);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const harness = useHarnessStore((s) => s.harness);
  const connector = findPinOwner(pinId);
  const pin = connector?.pins.find((p) => p.id === pinId);

  if (!connector || !pin || !harness) {
    return (
      <div className="flex items-center gap-1.5 py-0.5">
        <span className="text-[10px] text-zinc-500 w-8 shrink-0">
          {label}
        </span>
        <span className="text-[11px] text-zinc-400">{pinId}</span>
      </div>
    );
  }

  const encId = getConnectorEnclosure(harness, connector.id);
  const encName = encId
    ? harness.enclosures.find((e) => e.id === encId)?.name ?? ''
    : '';

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <span className="text-[10px] text-zinc-500 w-8 shrink-0">
        {label}
      </span>
      <button
        onClick={() =>
          selectItem({ type: 'connector', id: connector.id })
        }
        className="text-[11px] text-amber-400 hover:text-amber-300 underline underline-offset-2"
      >
        {connector.name}-{pin.pin_number}
        {encName && ` (${encName})`}
      </button>
    </div>
  );
}

function PinoutTable({
  connector,
}: {
  connector: Connector;
}) {
  const harness = useHarnessStore((s) => s.harness);
  const connectorLibrary = useHarnessStore((s) => s.connectorLibrary);
  const findPinOwner = useHarnessStore((s) => s.findPinOwner);
  const selectItem = useHarnessStore((s) => s.selectItem);

  if (!harness) return null;

  const ct = connectorLibrary?.connector_types.find(
    (t: ConnectorType) => t.id === connector.connector_type,
  );
  const pinCount = ct?.pin_count ?? connector.pins.length;

  const rows = [];
  for (let i = 1; i <= pinCount; i++) {
    const pin = connector.pins.find((p) => p.pin_number === i);
    const wires = pin
      ? harness.wires.filter(
          (w) => w.from === pin.id || w.to === pin.id,
        )
      : [];
    const signal =
      pin?.tags.find((t) => t.startsWith('signal:'))?.slice(7) ?? null;

    const connections = wires.map((wire) => {
      const otherPinId =
        wire.from === pin!.id ? wire.to : wire.from;
      const otherCon = findPinOwner(otherPinId);
      const otherPin = otherCon?.pins.find((p) => p.id === otherPinId);
      const otherEncId = otherCon
        ? getConnectorEnclosure(harness, otherCon.id)
        : null;
      const otherEncName = otherEncId
        ? harness.enclosures.find((e) => e.id === otherEncId)?.name ?? ''
        : '';
      const statusTags = wire.tags.filter((t) => t.startsWith('status:'));
      return {
        wireId: wire.id,
        label:
          otherCon && otherPin
            ? `${otherCon.name}-${otherPin.pin_number}${otherEncName ? ` (${otherEncName})` : ''}`
            : otherPinId,
        statusTags,
      };
    });

    rows.push({ pinNumber: i, pin, signal, connections });
  }

  return (
    <div className="mt-2 pt-2 border-t border-zinc-700/50">
      <div className="text-[10px] text-zinc-500 font-medium mb-1">
        Pinout
      </div>
      <table className="w-full text-[10px] border-collapse">
        <thead>
          <tr className="border-b border-zinc-700/50">
            <th className="text-left text-zinc-500 font-medium py-0.5 px-1 w-7">
              #
            </th>
            <th className="text-left text-zinc-500 font-medium py-0.5 px-1">
              Signal
            </th>
            <th className="text-left text-zinc-500 font-medium py-0.5 px-1">
              Connects to
            </th>
            <th className="text-left text-zinc-500 font-medium py-0.5 px-1 w-14">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.pinNumber}
              className="border-b border-zinc-800/50 hover:bg-zinc-800/50 cursor-pointer"
              onClick={() => {
                if (row.connections.length > 0) {
                  selectItem({
                    type: 'wire',
                    id: row.connections[0].wireId,
                  });
                }
              }}
            >
              <td className="py-0.5 px-1 font-mono text-zinc-500 text-right">
                {row.pinNumber}
              </td>
              <td className="py-0.5 px-1">
                {row.signal ? (
                  <span className="flex items-center gap-1">
                    <span
                      className="w-1.5 h-1.5 rounded-full inline-block shrink-0"
                      style={{
                        background: getSignalColor(row.signal),
                      }}
                    />
                    <span className="text-zinc-300">{row.signal}</span>
                  </span>
                ) : (
                  <span className="text-zinc-600">—</span>
                )}
              </td>
              <td className="py-0.5 px-1">
                {row.connections.length > 0 ? (
                  row.connections.map((c, ci) => (
                    <div key={ci} className="text-zinc-300 leading-tight">
                      {c.label}
                    </div>
                  ))
                ) : (
                  <span className="text-zinc-600 italic">
                    — unconnected
                  </span>
                )}
              </td>
              <td className="py-0.5 px-1">
                {row.connections
                  .flatMap((c) => c.statusTags)
                  .map((tag) => {
                    const val = tag.slice(7);
                    const cls =
                      val === 'cut' ? 'bg-yellow-900/50 text-yellow-300' :
                      val === 'crimped' ? 'bg-teal-900/50 text-teal-300' :
                      val === 'qcd' ? 'bg-green-900/50 text-green-300' :
                      'bg-zinc-700 text-zinc-400';
                    return (
                      <span
                        key={tag}
                        className={`inline-block text-[8px] px-1 rounded mr-0.5 ${cls}`}
                      >
                        {val === 'qcd' ? "QC'd" : val}
                      </span>
                    );
                  })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BundleInspector({ wireIds }: { wireIds: string[] }) {
  const harness = useHarnessStore((s) => s.harness);
  const findPinOwner = useHarnessStore((s) => s.findPinOwner);
  const selectItem = useHarnessStore((s) => s.selectItem);

  if (!harness) return null;

  const wires = wireIds
    .map((id) => harness.wires.find((w) => w.id === id))
    .filter(Boolean) as Wire[];

  if (wires.length === 0) return null;

  const signals = new Set<string>();
  for (const w of wires) {
    const sig = w.tags.find((t) => t.startsWith('signal:'))?.slice(7);
    if (sig) signals.add(sig);
  }

  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-bold text-zinc-100">
          Wire Bundle
        </span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">
          {wires.length} wires
        </span>
      </div>

      {signals.size > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {[...signals].map((sig) => (
            <span
              key={sig}
              className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/60"
            >
              <span
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ background: getSignalColor(sig) }}
              />
              <span className="text-zinc-300">{sig}</span>
            </span>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        {wires.map((wire) => {
          const fromCon = findPinOwner(wire.from);
          const toCon = findPinOwner(wire.to);
          const fromPin = fromCon?.pins.find((p) => p.id === wire.from);
          const toPin = toCon?.pins.find((p) => p.id === wire.to);
          const fromEncId = fromCon
            ? getConnectorEnclosure(harness, fromCon.id)
            : null;
          const toEncId = toCon
            ? getConnectorEnclosure(harness, toCon.id)
            : null;
          const fromEncName = fromEncId
            ? harness.enclosures.find((e) => e.id === fromEncId)?.name
            : '';
          const toEncName = toEncId
            ? harness.enclosures.find((e) => e.id === toEncId)?.name
            : '';
          const sig = wire.tags
            .find((t) => t.startsWith('signal:'))
            ?.slice(7);

          return (
            <button
              key={wire.id}
              onClick={() =>
                selectItem({ type: 'wire', id: wire.id })
              }
              className="w-full text-left p-1.5 rounded bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/30 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                {sig && (
                  <span
                    className="w-1.5 h-1.5 rounded-full inline-block shrink-0"
                    style={{ background: getSignalColor(sig) }}
                  />
                )}
                <span className="text-[10px] text-zinc-300 font-medium">
                  {sig ?? wire.id}
                </span>
              </div>
              <div className="text-[9px] text-zinc-500 mt-0.5">
                {fromCon?.name}-{fromPin?.pin_number}
                {fromEncName ? ` (${fromEncName})` : ''} →{' '}
                {toCon?.name}-{toPin?.pin_number}
                {toEncName ? ` (${toEncName})` : ''}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function ConnectorInspector({ con }: { con: Connector }) {
  const harness = useHarnessStore((s) => s.harness);
  const connectorLibrary = useHarnessStore((s) => s.connectorLibrary);
  const updateConnectorTypeImage = useHarnessStore((s) => s.updateConnectorTypeImage);
  const [imgPickerOpen, setImgPickerOpen] = useState(false);
  const closeImgPicker = useCallback(() => setImgPickerOpen(false), []);

  if (!harness) return null;
  const parentPcb = harness.pcbs.find((p) => p.id === con.parent);
  const derivedType = parentPcb ? 'Header' : 'Bulkhead';
  const ct = connectorLibrary?.connector_types.find((t) => t.id === con.connector_type);

  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-bold text-zinc-100">{con.name}</span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded ${derivedType === 'Header' ? 'bg-teal-900/60 text-teal-300' : 'bg-zinc-700 text-zinc-300'}`}>
          {derivedType}
        </span>
      </div>

      <div className="mb-2">
        <ParentLink parentId={con.parent} />
      </div>

      {ct && (
        <>
          {/* Connector type image with picker */}
          <div className="mb-2 relative">
            {ct.image ? (
              <div className="rounded overflow-hidden border border-zinc-700/60 bg-zinc-800">
                <img
                  src={`/connector-lib-photos/${ct.image}`}
                  alt={ct.name}
                  className="w-full object-contain"
                  style={{ maxHeight: 130 }}
                />
              </div>
            ) : (
              <div className="rounded border border-dashed border-zinc-700 bg-zinc-800/40 flex items-center justify-center text-[10px] text-zinc-600 italic" style={{ height: 48 }}>
                No image
              </div>
            )}
            <div className="mt-1 relative">
              <button
                onClick={() => setImgPickerOpen((p) => !p)}
                className="w-full text-[10px] text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded py-0.5 transition-colors"
              >
                {ct.image ? '⇄ Change image (all ' + ct.name + ')' : '+ Set image (all ' + ct.name + ')'}
              </button>
              {ct.image && (
                <button
                  onClick={() => updateConnectorTypeImage(ct.id, '')}
                  className="absolute right-0 top-0 bottom-0 px-2 text-zinc-500 hover:text-red-400 text-[10px]"
                  title="Remove image"
                >
                  ✕
                </button>
              )}
              {imgPickerOpen && (
                <div className="absolute left-0 right-0 z-50" style={{ top: '100%' }}>
                  <ImagePickerPanel
                    onPick={(filename) => { updateConnectorTypeImage(ct.id, filename); setImgPickerOpen(false); }}
                    onClose={closeImgPicker}
                    listEndpoint="/api/list-connector-assets"
                    baseUrl="/connector-lib-photos/"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="text-[10px] text-zinc-400 mb-2 space-y-0.5">
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

      <PinoutTable connector={con} />
    </>
  );
}

function PCBInspector({ pcb }: { pcb: PCB }) {
  const harness = useHarnessStore((s) => s.harness);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const updatePcbProperty = useHarnessStore((s) => s.updatePcbProperty);
  const [imgPickerOpen, setImgPickerOpen] = useState(false);
  const closeImgPicker = useCallback(() => setImgPickerOpen(false), []);

  if (!harness) return null;
  const pcbConnectors = harness.connectors.filter((c) => c.parent === pcb.id);
  const pcbImage = pcb.properties?.image as string | undefined;

  return (
    <>
      <div className="text-sm font-bold text-zinc-100 mb-1">{pcb.name}</div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] text-zinc-500">in</span>
        <ParentLink parentId={pcb.parent} />
      </div>

      {/* PCB image */}
      <div className="mb-2 relative">
        {pcbImage ? (
          <div className="rounded overflow-hidden border border-zinc-700/60 bg-zinc-800">
            <img
              src={`/img-assets/${pcbImage}`}
              alt={pcb.name}
              className="w-full object-contain"
              style={{ maxHeight: 140 }}
            />
          </div>
        ) : (
          <div className="rounded border border-dashed border-zinc-700 bg-zinc-800/40 flex items-center justify-center text-[10px] text-zinc-600 italic" style={{ height: 56 }}>
            No image
          </div>
        )}
        <div className="mt-1 relative">
          <button
            onClick={() => setImgPickerOpen((p) => !p)}
            className="w-full text-[10px] text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded py-0.5 transition-colors"
          >
            {pcbImage ? '⇄ Change image' : '+ Set image'}
          </button>
          {pcbImage && (
            <button
              onClick={() => updatePcbProperty(pcb.id, 'image', '')}
              className="absolute right-0 top-0 bottom-0 px-2 text-zinc-500 hover:text-red-400 text-[10px]"
              title="Remove image"
            >
              ✕
            </button>
          )}
          {imgPickerOpen && (
            <div className="absolute left-0 right-0 z-50" style={{ top: '100%' }}>
              <ImagePickerPanel
                onPick={(filename) => {
                  updatePcbProperty(pcb.id, 'image', filename);
                  setImgPickerOpen(false);
                }}
                onClose={closeImgPicker}
              />
            </div>
          )}
        </div>
      </div>

      {Object.entries(pcb.properties)
        .filter(([k]) => k !== 'image')
        .map(([k, v]) => (
          <PropertyRow key={k} label={k} value={v} />
        ))}

      <div className="mt-2 pt-2 border-t border-zinc-700/50">
        <TagEditor entityType="pcb" entityId={pcb.id} tags={pcb.tags} />
      </div>

      <div className="mt-2 pt-2 border-t border-zinc-700/50">
        <div className="text-[10px] text-zinc-500 font-medium mb-1.5">
          Connectors ({pcbConnectors.length})
        </div>
        {pcbConnectors.length === 0 ? (
          <div className="text-[10px] text-zinc-600 italic">No connectors</div>
        ) : (
          <div className="space-y-0.5">
            {pcbConnectors.map((c) => (
              <button
                key={c.id}
                onClick={() => selectItem({ type: 'connector', id: c.id })}
                className="w-full text-left flex items-center justify-between py-0.5 px-1.5 rounded hover:bg-zinc-800 transition-colors"
              >
                <span className="text-[11px] text-amber-400 hover:text-amber-300 font-mono">
                  {c.name}
                </span>
                <span className="text-[10px] text-zinc-500">{c.pins.length} pins</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function InspectorPanel() {
  const selectedItem = useHarnessStore((s) => s.selectedItem);
  const selectedBundle = useHarnessStore((s) => s.selectedBundle);
  const findEntity = useHarnessStore((s) => s.findEntity);
  const harness = useHarnessStore((s) => s.harness);
  const findPinOwner = useHarnessStore((s) => s.findPinOwner);
  const selectItem = useHarnessStore((s) => s.selectItem);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.scrollTo(0, 0);
  }, [selectedItem, selectedBundle]);

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
          <BundleInspector wireIds={selectedBundle} />
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
        const pcbs = harness.pcbs.filter((p) => p.parent === enc.id);
        const allConnectors = getEnclosureConnectors(harness, enc.id);
        const bulkheads = allConnectors.filter((c) => c.parent === enc.id);
        const headers = allConnectors.filter((c) =>
          harness.pcbs.some((p) => p.id === c.parent),
        );

        let internalWires = 0;
        let externalWires = 0;
        for (const wire of harness.wires) {
          const fromCon = findPinOwner(wire.from);
          const toCon = findPinOwner(wire.to);
          if (!fromCon || !toCon) continue;
          const fromEnc = getConnectorEnclosure(harness, fromCon.id);
          const toEnc = getConnectorEnclosure(harness, toCon.id);
          if (fromEnc === enc.id && toEnc === enc.id) internalWires++;
          else if (fromEnc === enc.id || toEnc === enc.id)
            externalWires++;
        }

        return (
          <>
            <div className="text-sm font-bold text-zinc-100 mb-1">
              {enc.name}
            </div>
            {enc.parent && (
              <div className="mb-1">
                <ParentLink parentId={enc.parent} />
              </div>
            )}
            {Object.entries(enc.properties).map(([k, v]) => (
              <PropertyRow key={k} label={k} value={v} />
            ))}

            <div className="mt-2 pt-2 border-t border-zinc-700/50">
              <TagEditor
                entityType="enclosure"
                entityId={enc.id}
                tags={enc.tags}
              />
            </div>

            <div className="mt-2 pt-2 border-t border-zinc-700/50">
              <div className="text-[10px] text-zinc-500 font-medium mb-1">
                Summary
              </div>
              <div className="text-[11px] text-zinc-300 space-y-0.5">
                <div>{pcbs.length} PCBs</div>
                <div>
                  {allConnectors.length} connectors ({bulkheads.length}{' '}
                  bulkheads, {headers.length} headers)
                </div>
                <div>
                  {internalWires} wires internal, {externalWires} wires
                  external
                </div>
              </div>
            </div>

            <div className="mt-2 pt-2 border-t border-zinc-700/50">
              <div className="text-[10px] text-zinc-500 font-medium mb-1">
                Bulkhead Connectors
              </div>
              {bulkheads.map((c) => (
                <button
                  key={c.id}
                  onClick={() =>
                    selectItem({ type: 'connector', id: c.id })
                  }
                  className="w-full text-left text-[11px] text-amber-400 hover:text-amber-300 py-0.5 flex items-center justify-between"
                >
                  <span>{c.name}</span>
                  <span className="text-zinc-500 text-[10px]">
                    {c.pins.length} pins
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-3 pt-2 border-t border-zinc-700/50">
              <div className="border border-dashed border-zinc-700 rounded p-4 text-center">
                <div className="text-zinc-600 text-[11px]">
                  Drop image here
                </div>
                <div className="text-zinc-700 text-[9px]">
                  (coming soon)
                </div>
              </div>
            </div>
          </>
        );
      }
      case 'pcb': {
        const pcb = entity as PCB;
        return <PCBInspector pcb={pcb} />;
      }
      case 'connector': {
        const con = entity as Connector;
        return <ConnectorInspector con={con} />;
      }
      case 'pin': {
        const pin = entity as Pin;
        const owner = harness.connectors.find((c) =>
          c.pins.some((p) => p.id === pin.id),
        );
        return (
          <>
            <PropertyRow label="ID" value={pin.id} />
            <PropertyRow label="Name" value={pin.name} />
            <PropertyRow label="Pin #" value={String(pin.pin_number)} />
            {owner && (
              <div className="flex items-center gap-2 py-0.5">
                <span className="text-[10px] text-zinc-500 w-20 shrink-0 text-right">
                  Connector
                </span>
                <button
                  onClick={() =>
                    selectItem({ type: 'connector', id: owner.id })
                  }
                  className="text-[11px] text-amber-400 hover:text-amber-300 underline underline-offset-2"
                >
                  {owner.name}
                </button>
              </div>
            )}
            {Object.entries(pin.properties).map(([k, v]) => (
              <PropertyRow key={k} label={k} value={v} />
            ))}
            <div className="mt-2 pt-2 border-t border-zinc-700/50">
              <div className="text-[10px] text-zinc-500 font-medium mb-1">
                Tags
              </div>
              <TagEditor
                entityType="pin"
                entityId={pin.id}
                tags={pin.tags}
              />
            </div>
          </>
        );
      }
      case 'wire': {
        const wire = entity as Wire;
        const signalTag = wire.tags.find((t) => t.startsWith('signal:'));
        const signalName = signalTag?.slice(7);
        const bundleTag = wire.tags.find((t) => t.startsWith('bundle:'));
        const bundleName = bundleTag?.slice(7);

        return (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-bold text-zinc-100">
                Wire
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">
                {wire.id}
              </span>
            </div>

            <WireEndpointLink pinId={wire.from} label="From" />
            <WireEndpointLink pinId={wire.to} label="To" />

            {signalName && <SignalInfo signalName={signalName} />}

            {Object.entries(wire.properties).map(([k, v]) => (
              <PropertyRow key={k} label={k} value={v} />
            ))}

            <WireStatusEditor wireId={wire.id} tags={wire.tags} />

            <div className="mt-2 pt-2 border-t border-zinc-700/50">
              <div className="text-[10px] text-zinc-500 font-medium mb-1">
                Tags
              </div>
              <TagEditor
                entityType="wire"
                entityId={wire.id}
                tags={wire.tags}
              />
            </div>

            {bundleName && (
              <div className="mt-2 pt-2 border-t border-zinc-700/50">
                <div className="text-[10px] text-zinc-500 italic">
                  Part of bundle:{' '}
                  <span className="text-zinc-400">{bundleName}</span>
                </div>
              </div>
            )}
          </>
        );
      }
      default:
        return null;
    }
  };

  const typeLabels: Record<string, string> = {
    enclosure: 'Enclosure',
    pcb: 'PCB',
    connector: 'Connector',
    pin: 'Pin',
    wire: 'Wire',
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
