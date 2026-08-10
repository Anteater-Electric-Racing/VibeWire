import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useHarnessStore } from '../../store';
import {
  MANUFACTURING_STEPS,
  completedManufacturingComponentStepCount,
  deriveManufacturingBom,
  deriveManufacturingBundles,
  deriveManufacturingHarnesses,
  manufacturingGenderBundleRelationship,
  manufacturingHopsMatch,
  manufacturingTaskCompleted,
  manufacturingComponentSteps,
  manufacturingBomToCsv,
  type ManufacturingBundle,
  type ManufacturingEndpoint,
  type ManufacturingHarness,
  type ManufacturingLengthHop,
  type ManufacturingWire,
} from '../../lib/manufacturing';
import { WIRE_COLOR_PRESETS } from '../../lib/colors';
import { WIRE_GAUGE_PRESETS } from '../../lib/gauge';
import {
  ManufacturingHarnessVisualizer,
  type ManufacturingVisualSelection,
  type ManufacturingVisualTask,
} from './ManufacturingHarnessVisualizer';
import { ManufacturingConnectorGuide } from './ManufacturingConnectorGuide';
import { ManufacturingProgressView } from './ManufacturingProgressView';
import type {
  ManufacturingConnectorGuideState,
  ManufacturingStep,
  SelectedItem,
} from '../../types';

function InspectorLink({
  item,
  className,
  title,
  children,
}: {
  item: SelectedItem | null | undefined;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const inspectEntity = useHarnessStore((state) => state.inspectEntityQuiet);
  if (!item) {
    return <span className={className}>{children}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => inspectEntity(item)}
      title={title ?? 'Open in inspector'}
      className={`text-left hover:underline underline-offset-2 decoration-zinc-600 hover:decoration-amber-500 ${className ?? ''}`}
    >
      {children}
    </button>
  );
}

interface WorkComponent {
  key: string;
  kind: 'connector' | 'splice';
  entityId: string;
  label: string;
  endpoint?: ManufacturingEndpoint;
  wireIds: string[];
  pins: number[];
}

function formatLength(mm: number): string {
  if (mm >= 1000) return `${(mm / 1000).toFixed(mm % 1000 === 0 ? 0 : 2)} m`;
  return `${Math.round(mm)} mm`;
}

function formatQuantity(quantity: number, unit: 'm' | 'ea'): string {
  if (unit === 'ea') return String(quantity);
  return quantity.toFixed(quantity < 10 ? 3 : 2).replace(/\.?0+$/, '');
}

function deriveWorkComponents(bundle: ManufacturingBundle): WorkComponent[] {
  const components = new Map<string, WorkComponent>();
  const add = (
    key: string,
    kind: WorkComponent['kind'],
    entityId: string,
    label: string,
    wireId: string,
    endpoint?: ManufacturingEndpoint,
  ) => {
    const current = components.get(key) ?? {
      key,
      kind,
      entityId,
      label,
      endpoint,
      wireIds: [],
      pins: [],
    };
    if (!current.endpoint && endpoint) current.endpoint = endpoint;
    if (!current.wireIds.includes(wireId)) current.wireIds.push(wireId);
    if (
      endpoint?.pinNumber !== undefined
      && !current.pins.includes(endpoint.pinNumber)
    ) {
      current.pins.push(endpoint.pinNumber);
    }
    components.set(key, current);
  };

  for (const wire of bundle.wires) {
    for (const endpoint of [wire.from, wire.to]) {
      if (endpoint.kind === 'connector' && endpoint.connectorId) {
        add(
          `connector:${endpoint.connectorId}`,
          'connector',
          endpoint.connectorId,
          endpoint.connectorName ?? endpoint.label,
          wire.id,
          endpoint,
        );
      } else if (endpoint.kind === 'merge' && endpoint.mergePointId) {
        add(
          `splice:${endpoint.mergePointId}`,
          'splice',
          endpoint.mergePointId,
          endpoint.label,
          wire.id,
          endpoint,
        );
      }
    }
    for (const splice of wire.viaSplices) {
      add(`splice:${splice.id}`, 'splice', splice.id, splice.label, wire.id);
    }
  }

  return [...components.values()].map((component) => ({
    ...component,
    pins: [...component.pins].sort((a, b) => a - b),
  }));
}

function ProgressBar({
  completed,
  total = MANUFACTURING_STEPS.length,
}: {
  completed: number;
  total?: number;
}) {
  const percentage = total === 0 ? 0 : completed / total * 100;
  return (
    <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
      <div
        className={`h-full transition-all ${
          completed === total ? 'bg-emerald-500' : 'bg-amber-500'
        }`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

function StepButton({
  step,
  checked,
  onChange,
}: {
  step: { id: ManufacturingStep; label: string };
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const isEditor = useHarnessStore((state) => state.session.isEditor);
  return (
    <button
      type="button"
      disabled={!isEditor}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`min-w-0 px-1.5 py-1.5 rounded border text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? 'border-emerald-700/70 bg-emerald-950/40 text-emerald-300'
          : 'border-zinc-700 bg-zinc-900 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
      }`}
    >
      <span
        className={`inline-flex w-3.5 h-3.5 mr-1 align-middle items-center justify-center rounded-sm border text-[9px] ${
          checked
            ? 'border-emerald-500 bg-emerald-500 text-zinc-950'
            : 'border-zinc-600'
        }`}
      >
        {checked ? '✓' : ''}
      </span>
      <span className="text-[9px] font-medium">{step.label}</span>
    </button>
  );
}

function EndpointCell({
  endpoint,
  crimpOwned = true,
}: {
  endpoint: ManufacturingEndpoint;
  crimpOwned?: boolean;
}) {
  if (endpoint.kind === 'merge') {
    return (
      <div>
        <InspectorLink
          item={endpoint.mergePointId
            ? { type: 'mergePoint', id: endpoint.mergePointId }
            : null}
          className="text-[11px] font-medium text-violet-300"
        >
          {endpoint.label}
        </InspectorLink>
        <div className="text-[9px] text-violet-500">Splice</div>
      </div>
    );
  }

  const crimp = endpoint.crimpPartNumber;
  const connectorItem = endpoint.connectorId
    ? { type: 'connector' as const, id: endpoint.connectorId }
    : null;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-1 text-[11px] font-medium text-zinc-200">
        <InspectorLink item={connectorItem} className="min-w-0 truncate text-[11px] font-medium text-zinc-200">
          {endpoint.connectorName ?? endpoint.connectorId}
        </InspectorLink>
        {endpoint.pinNumber !== undefined && (
          <span className="shrink-0 rounded bg-amber-950/60 px-1 py-0.5 text-amber-300 font-mono">
            P{endpoint.pinNumber}
          </span>
        )}
      </div>
      {crimpOwned && (
        <div className={`mt-1 truncate font-mono text-[9px] ${crimp ? 'text-sky-300' : 'text-amber-500'}`}>
          {crimp ?? 'Contact PN needed'}
        </div>
      )}
      {!crimpOwned && (
        <div className="text-[9px] mt-0.5 text-violet-500">Joined at splice</div>
      )}
    </div>
  );
}

function confirmMatchBundleLengths(
  bundle: ManufacturingBundle,
  sourceWire: ManufacturingWire,
  lengthMm: number | undefined,
): boolean {
  const others = bundle.wires.filter((candidate) => candidate.id !== sourceWire.id);
  if (others.length === 0) return false;

  if (lengthMm === undefined) {
    const withLength = others.filter((candidate) => candidate.lengthMm !== undefined);
    if (withLength.length === 0) return false;
    return window.confirm([
      `Clear cut length on the other ${withLength.length} wire${withLength.length === 1 ? '' : 's'} in “${bundle.name}”?`,
      '',
      ...withLength.map((candidate) => `• ${candidate.wireId}: ${candidate.lengthMm} mm`),
    ].join('\n'));
  }

  const differing = others.filter((candidate) => candidate.lengthMm !== lengthMm);
  if (differing.length === 0) return false;
  return window.confirm([
    `Apply ${lengthMm} mm to the other ${differing.length} wire${differing.length === 1 ? '' : 's'} in “${bundle.name}”?`,
    '',
    ...differing.map((candidate) =>
      `• ${candidate.wireId}: ${candidate.lengthMm === undefined ? 'no length' : `${candidate.lengthMm} mm`}`,
    ),
    '',
    'Totals are matched; multi-run wires keep their relative splice/connector proportions when possible.',
  ].join('\n'));
}

function confirmMatchBundleHopLengths(
  bundle: ManufacturingBundle,
  sourceWire: ManufacturingWire,
  hop: ManufacturingLengthHop,
  lengthMm: number | undefined,
): Array<{ pathId: string; segmentIndex: number }> {
  const matches: Array<{
    pathId: string;
    wireId: string;
    segmentIndex: number;
    lengthMm?: number;
  }> = [];
  for (const other of bundle.wires) {
    if (other.id === sourceWire.id) continue;
    const match = other.hops.find((candidate) => manufacturingHopsMatch(candidate, hop));
    if (!match) continue;
    matches.push({
      pathId: other.pathId,
      wireId: other.wireId,
      segmentIndex: match.segmentIndex,
      lengthMm: match.lengthMm,
    });
  }
  if (matches.length === 0) return [];

  const hopLabel = `${hop.fromLabel} → ${hop.toLabel}`;
  if (lengthMm === undefined) {
    const withLength = matches.filter((candidate) => candidate.lengthMm !== undefined);
    if (withLength.length === 0) return [];
    const confirmed = window.confirm([
      `Clear “${hopLabel}” on the other ${withLength.length} wire${withLength.length === 1 ? '' : 's'} in “${bundle.name}”?`,
      '',
      ...withLength.map((candidate) => `• ${candidate.wireId}: ${candidate.lengthMm} mm`),
      '',
      'Only this splice/connector section is cleared; other segments stay unchanged.',
    ].join('\n'));
    return confirmed
      ? withLength.map((candidate) => ({
        pathId: candidate.pathId,
        segmentIndex: candidate.segmentIndex,
      }))
      : [];
  }

  const differing = matches.filter((candidate) => candidate.lengthMm !== lengthMm);
  if (differing.length === 0) return [];
  const confirmed = window.confirm([
    `Apply ${lengthMm} mm to “${hopLabel}” on the other ${differing.length} wire${differing.length === 1 ? '' : 's'} in “${bundle.name}”?`,
    '',
    ...differing.map((candidate) =>
      `• ${candidate.wireId}: ${candidate.lengthMm === undefined ? 'no length' : `${candidate.lengthMm} mm`}`,
    ),
    '',
    'Only this splice/connector section is updated; other segments stay unchanged.',
  ].join('\n'));
  return confirmed
    ? differing.map((candidate) => ({
      pathId: candidate.pathId,
      segmentIndex: candidate.segmentIndex,
    }))
    : [];
}

function WireLengthEditor({
  wire,
  bundle,
}: {
  wire: ManufacturingWire;
  bundle: ManufacturingBundle;
}) {
  const updatePathSpanLengths = useHarnessStore((state) => state.updatePathSpanLengths);
  const updatePathSegmentLengths = useHarnessStore((state) => state.updatePathSegmentLengths);
  const isEditor = useHarnessStore((state) => state.session.isEditor);
  const initialTotal = wire.lengthMm === undefined ? '' : String(wire.lengthMm);
  const [totalDraft, setTotalDraft] = useState(initialTotal);
  const [hopDrafts, setHopDrafts] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      wire.hops.map((hop) => [hop.segmentIndex, hop.lengthMm === undefined ? '' : String(hop.lengthMm)]),
    ),
  );
  const cancelBlur = useRef(false);

  const applyTotal = (lengthMm: number | undefined) => {
    if (!isEditor) return;
    const updates = [{
      pathId: wire.pathId,
      fromNodeIndex: wire.fromNodeIndex,
      toNodeIndex: wire.toNodeIndex,
      lengthMm,
    }];
    if (confirmMatchBundleLengths(bundle, wire, lengthMm)) {
      for (const other of bundle.wires) {
        if (other.id === wire.id) continue;
        updates.push({
          pathId: other.pathId,
          fromNodeIndex: other.fromNodeIndex,
          toNodeIndex: other.toNodeIndex,
          lengthMm,
        });
      }
    }
    updatePathSpanLengths(updates);
  };

  const commitTotal = () => {
    if (!isEditor) return;
    if (cancelBlur.current) {
      cancelBlur.current = false;
      return;
    }
    const trimmed = totalDraft.trim();
    if (!trimmed) {
      if (wire.lengthMm === undefined) {
        setTotalDraft('');
        return;
      }
      applyTotal(undefined);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setTotalDraft(initialTotal);
      return;
    }
    if (wire.lengthMm === parsed) {
      setTotalDraft(String(parsed));
      return;
    }
    setTotalDraft(String(parsed));
    applyTotal(parsed);
  };

  const commitHop = (hop: ManufacturingLengthHop) => {
    if (!isEditor) return;
    if (cancelBlur.current) {
      cancelBlur.current = false;
      return;
    }
    const trimmed = (hopDrafts[hop.segmentIndex] ?? '').trim();
    const previous = hop.lengthMm;
    if (!trimmed) {
      if (previous === undefined) return;
      const updates: Array<{ pathId: string; segmentIndex: number; lengthMm: number | undefined }> = [{
        pathId: wire.pathId,
        segmentIndex: hop.segmentIndex,
        lengthMm: undefined,
      }];
      for (const match of confirmMatchBundleHopLengths(bundle, wire, hop, undefined)) {
        updates.push({
          pathId: match.pathId,
          segmentIndex: match.segmentIndex,
          lengthMm: undefined,
        });
      }
      updatePathSegmentLengths(updates);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setHopDrafts((current) => ({
        ...current,
        [hop.segmentIndex]: previous === undefined ? '' : String(previous),
      }));
      return;
    }
    if (previous === parsed) {
      setHopDrafts((current) => ({ ...current, [hop.segmentIndex]: String(parsed) }));
      return;
    }

    setHopDrafts((current) => ({ ...current, [hop.segmentIndex]: String(parsed) }));
    const updates: Array<{ pathId: string; segmentIndex: number; lengthMm: number | undefined }> = [{
      pathId: wire.pathId,
      segmentIndex: hop.segmentIndex,
      lengthMm: parsed,
    }];
    for (const match of confirmMatchBundleHopLengths(bundle, wire, hop, parsed)) {
      updates.push({
        pathId: match.pathId,
        segmentIndex: match.segmentIndex,
        lengthMm: parsed,
      });
    }
    updatePathSegmentLengths(updates);
  };

  const missingHop = wire.hops.some((hop) => hop.lengthMm === undefined);
  const showHopBreakdown = wire.hops.length > 1
    || wire.hops.some((hop) => hop.fromKind === 'merge' || hop.toKind === 'merge');
  const spliceMarks = wire.hops.reduce<{
    distanceMm: number | undefined;
    marks: Array<{ label: string; distanceMm: number | undefined }>;
  }>((state, hop) => {
    const distanceMm = state.distanceMm === undefined || hop.lengthMm === undefined
      ? undefined
      : state.distanceMm + hop.lengthMm;
    return {
      distanceMm,
      marks: hop.toKind === 'merge'
        ? [...state.marks, { label: hop.toLabel, distanceMm }]
        : state.marks,
    };
  }, { distanceMm: 0, marks: [] }).marks;

  return (
    <div className="min-w-[320px]">
      <div className={`grid items-start gap-3 ${
        showHopBreakdown ? 'grid-cols-[105px_minmax(190px,1fr)]' : 'grid-cols-1'
      }`}>
        <div>
          <div className="flex items-center gap-1">
            <input
              type="number"
              readOnly={!isEditor}
              min={0}
              step="any"
              inputMode="decimal"
              value={totalDraft}
              onChange={(event) => setTotalDraft(event.target.value)}
              onBlur={commitTotal}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') {
                  cancelBlur.current = true;
                  setTotalDraft(initialTotal);
                  event.currentTarget.blur();
                }
              }}
              placeholder={wire.lengthLabel ?? 'Total needed'}
              aria-label={`${wire.wireId} total cut length in millimeters`}
              className={`w-20 bg-zinc-950 border rounded px-2 py-1.5 text-right font-mono text-[11px] focus:outline-none focus:border-amber-500 ${
                wire.lengthMm === undefined
                  ? 'border-amber-800/60 text-amber-300 placeholder-amber-700'
                  : 'border-zinc-700 text-zinc-200'
              }`}
            />
            <span className="text-[9px] text-zinc-500">mm</span>
          </div>
          {wire.lengthMm === undefined && wire.lengthLabel && (
            <div className="mt-0.5 text-[8px] text-zinc-600">Legacy estimate</div>
          )}
          {spliceMarks.map((mark) => (
            <div
              key={`${wire.id}:${mark.label}`}
              className="mt-1 whitespace-normal text-[9px] font-medium text-violet-300"
            >
              Mark {mark.label}
              <span className="text-violet-500">
                {mark.distanceMm === undefined ? ' · position needed' : ` @ ${formatLength(mark.distanceMm)}`}
              </span>
            </div>
          ))}
        </div>

        {showHopBreakdown && (
          <div className="rounded-md border-2 border-zinc-800 bg-zinc-950/80 p-2">
            <div className={`mb-1.5 text-[8px] font-semibold uppercase tracking-wide ${
              missingHop ? 'text-amber-500' : 'text-zinc-500'
            }`}>
              Splice sections · {wire.hops.length}{missingHop ? ' · incomplete' : ''}
            </div>
            <div className="space-y-1.5">
              {wire.hops.map((hop) => (
                <div
                  key={`${wire.id}:${hop.segmentIndex}`}
                  className="grid grid-cols-[minmax(0,1fr)_56px_16px] items-center gap-1.5"
                >
                  <div
                    className="min-w-0 truncate text-[9px] text-zinc-400"
                    title={`${hop.fromLabel} → ${hop.toLabel}`}
                  >
                    {hop.fromLabel}
                    <span className="text-zinc-600"> → </span>
                    {hop.toLabel}
                  </div>
                  <input
                    type="number"
                    readOnly={!isEditor}
                    min={0}
                    step="any"
                    inputMode="decimal"
                    value={hopDrafts[hop.segmentIndex] ?? ''}
                    onChange={(event) => setHopDrafts((current) => ({
                      ...current,
                      [hop.segmentIndex]: event.target.value,
                    }))}
                    onBlur={() => commitHop(hop)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') {
                        cancelBlur.current = true;
                        setHopDrafts((current) => ({
                          ...current,
                          [hop.segmentIndex]: hop.lengthMm === undefined ? '' : String(hop.lengthMm),
                        }));
                        event.currentTarget.blur();
                      }
                    }}
                    placeholder="—"
                    aria-label={`${wire.wireId} ${hop.fromLabel} to ${hop.toLabel} length in millimeters`}
                    className={`w-14 bg-zinc-950 border rounded px-1.5 py-0.5 text-right font-mono text-[9px] focus:outline-none focus:border-amber-500 ${
                      hop.lengthMm === undefined
                        ? 'border-amber-800/60 text-amber-300'
                        : 'border-zinc-700 text-zinc-300'
                    }`}
                  />
                  <span className="text-[8px] text-zinc-600">mm</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WireRow({
  wire,
  bundle,
}: {
  wire: ManufacturingWire;
  bundle: ManufacturingBundle;
}) {
  const harness = useHarnessStore((state) => state.harness);
  const updatePathProperty = useHarnessStore((state) => state.updatePathProperty);
  const isEditor = useHarnessStore((state) => state.session.isEditor);
  const path = harness?.paths.find((candidate) => candidate.id === wire.pathId);
  const explicitColor = path?.properties.wire_color ?? path?.properties.color ?? '';
  const explicitGauge = path?.properties.wire_gauge ?? '';
  const colorOptions = Array.from(new Set([
    ...WIRE_COLOR_PRESETS,
    'white/blue',
    'white/brown',
    'black/orange',
    'black/green',
    explicitColor,
  ].filter(Boolean)));

  return (
    <tr className="border-b border-zinc-800/80 align-top hover:bg-zinc-900/70">
      <td className="px-3 py-2">
        <InspectorLink
          item={{ type: 'path', id: wire.pathId }}
          className="font-mono text-xs font-semibold text-amber-300"
          title="Open path in inspector without moving the camera"
        >
          {wire.wireId}
        </InspectorLink>
        <div className="mt-0.5 max-w-[180px] truncate text-[10px] text-zinc-400">
          {wire.signalName || wire.pathName}
        </div>
        {wire.issues.length > 0 && (
          <div className="mt-1 text-[9px] text-amber-500">
            ⚠ {wire.issues.join(' · ')}
          </div>
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <WireLengthEditor
          key={`${wire.id}:${wire.lengthMm ?? ''}:${wire.hops
            .map((hop) => `${hop.segmentIndex}:${hop.lengthMm ?? ''}`)
            .join('|')}`}
          wire={wire}
          bundle={bundle}
        />
      </td>
      <td className="px-3 py-2">
        <div className="space-y-1">
          <select
            disabled={!isEditor}
            value={explicitColor}
            onChange={(event) => updatePathProperty(
              wire.pathId,
              'wire_color',
              event.target.value,
            )}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-[9px] text-zinc-200 focus:border-amber-500 focus:outline-none disabled:opacity-50"
            aria-label={`${wire.wireId} wire color`}
          >
            <option value="">Auto · {wire.color || 'none'}</option>
            {colorOptions.map((color) => (
              <option key={color} value={color}>{color}</option>
            ))}
          </select>
          <select
            disabled={!isEditor}
            value={explicitGauge}
            onChange={(event) => updatePathProperty(
              wire.pathId,
              'wire_gauge',
              event.target.value,
            )}
            className={`w-full rounded border bg-zinc-950 px-1.5 py-1 text-[9px] focus:border-amber-500 focus:outline-none disabled:opacity-50 ${
              wire.gauge ? 'border-zinc-700 text-zinc-300' : 'border-amber-800 text-amber-300'
            }`}
            aria-label={`${wire.wireId} wire gauge`}
          >
            <option value="">Auto · {wire.gauge || 'missing'}</option>
            {Array.from(new Set([...WIRE_GAUGE_PRESETS, explicitGauge].filter(Boolean))).map(
              (gauge) => <option key={gauge} value={gauge}>{gauge}</option>,
            )}
          </select>
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="grid min-w-0 grid-cols-2 divide-x divide-zinc-800">
          <div className="min-w-0 pr-2">
            <div className="mb-1 text-[8px] font-semibold uppercase tracking-wide text-zinc-600">
              A
            </div>
            <EndpointCell endpoint={wire.from} />
          </div>
          <div className="min-w-0 pl-2">
            <div className="mb-1 text-[8px] font-semibold uppercase tracking-wide text-zinc-600">
              B
            </div>
            <EndpointCell endpoint={wire.to} crimpOwned={!wire.fromCrimpOnly} />
          </div>
        </div>
      </td>
    </tr>
  );
}

function BundleNotes({
  value,
  onSave,
}: {
  value: string;
  onSave: (notes: string) => void;
}) {
  const isEditor = useHarnessStore((state) => state.session.isEditor);
  const [draft, setDraft] = useState(value);
  return (
    <textarea
      readOnly={!isEditor}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (isEditor) onSave(draft);
      }}
      rows={1}
      placeholder="Build notes, blockers, assignee…"
      className="h-8 w-full resize-none bg-zinc-950 border border-zinc-700 rounded-md px-2.5 py-1.5 text-[10px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
    />
  );
}

function componentInstruction(
  component: WorkComponent,
  step: ManufacturingStep | undefined,
  crimpPartNumber: string | undefined,
): string {
  if (!step) return 'This end is complete.';
  if (component.kind === 'splice') {
    switch (step) {
      case 'ordered': return 'Gather the splice, seal, and required consumables.';
      case 'cut': return `Mark and strip the ${component.wireIds.length} splice leg${component.wireIds.length === 1 ? '' : 's'}.`;
      case 'crimped': return 'Join the splice legs using the approved splice process.';
      case 'populated': return 'Seal and finish the splice.';
      case 'qc': return 'Inspect, pull-test, and verify continuity.';
      case 'installed': return 'Secure the splice in the finished harness.';
    }
  }

  const endpoint = component.endpoint;
  switch (step) {
    case 'ordered':
      return `Gather ${endpoint?.housingPartNumber ?? 'the housing'} and ${crimpPartNumber ?? 'the correct contacts'}.`;
    case 'cut':
      return `Cut and strip the ${component.wireIds.length} wire${component.wireIds.length === 1 ? '' : 's'} for this end.`;
    case 'crimped':
      return `Crimp ${crimpPartNumber ?? 'the selected contact'} onto each wire.`;
    case 'populated':
      return component.pins.length > 0
        ? `Load ${component.pins.length === 1 ? 'cavity' : 'cavities'} ${component.pins.join(', ')}.`
        : 'Load each wire into its listed cavity.';
    case 'qc':
      return 'Pull-test every contact and verify the pinout.';
    case 'installed':
      return 'Lock, label, and install this connector end.';
  }
}

function ComponentWorkCard({
  bundle,
  bundles,
  component,
}: {
  bundle: ManufacturingBundle;
  bundles: ManufacturingBundle[];
  component: WorkComponent;
}) {
  const harness = useHarnessStore((state) => state.harness);
  const manufacturing = useHarnessStore((state) => state.manufacturing);
  const updateStep = useHarnessStore((state) => state.updateManufacturingStep);
  const updateGender = useHarnessStore(
    (state) => state.updateManufacturingEndpointGender,
  );
  const isEditor = useHarnessStore((state) => state.session.isEditor);
  const progress = manufacturing.bundles[bundle.id];
  const steps = manufacturingComponentSteps(manufacturing, bundle.id, component.key);
  const completed = completedManufacturingComponentStepCount(
    manufacturing,
    bundle.id,
    component.key,
  );
  const nextStep = MANUFACTURING_STEPS.find((step) => !steps[step.id]);
  const endpoint = component.endpoint;
  const gender = component.kind === 'connector'
    ? progress?.endpoint_genders?.[component.entityId]
    : undefined;
  const crimpPartNumber = gender === 'male'
    ? endpoint?.maleCrimpPartNumber
    : gender === 'female'
      ? endpoint?.femaleCrimpPartNumber
      : endpoint?.crimpPartNumber;
  const genderRelationship = component.kind === 'connector' && harness
    ? manufacturingGenderBundleRelationship(
        harness,
        bundles,
        bundle.id,
        component.entityId,
      )
    : { assignable: true, sameSideBundleIds: [], mateBundleIds: [] };
  const { assignable, sameSideBundleIds, mateBundleIds } = genderRelationship;
  const changeGender = (nextGender: 'male' | 'female' | undefined) => {
    if (!isEditor || (!assignable && nextGender !== undefined)) return;
    const expectedMate = nextGender === 'male'
      ? 'female'
      : nextGender === 'female'
        ? 'male'
        : undefined;
    const mateConflicts = mateBundleIds.filter((mateBundleId) => {
      const assigned =
        manufacturing.bundles[mateBundleId]?.endpoint_genders?.[component.entityId];
      return assigned !== undefined && assigned !== expectedMate;
    });
    const sameSideConflicts = sameSideBundleIds.filter((sameSideBundleId) => {
      const assigned =
        manufacturing.bundles[sameSideBundleId]?.endpoint_genders?.[component.entityId];
      return assigned !== undefined && assigned !== nextGender;
    });
    const conflictCount = mateConflicts.length + sameSideConflicts.length;
    if (conflictCount === 0) {
      updateGender(
        bundle.id,
        component.entityId,
        nextGender,
        mateBundleIds,
        sameSideBundleIds,
      );
      return;
    }
    const changeMate = window.confirm([
      `${conflictCount} related connector assignment${conflictCount === 1 ? '' : 's'} conflict.`,
      '',
      'OK: synchronize this physical side and its mating side.',
      'Cancel: keep the other assignments and leave an unresolved flag.',
    ].join('\n'));
    updateGender(
      bundle.id,
      component.entityId,
      nextGender,
      changeMate ? mateBundleIds : [],
      changeMate ? sameSideBundleIds : [],
    );
  };
  const inspectorItem: SelectedItem = component.kind === 'connector'
    ? { type: 'connector', id: component.entityId }
    : { type: 'mergePoint', id: component.entityId };

  return (
    <section className={`rounded-lg border p-2.5 ${
      completed === MANUFACTURING_STEPS.length
        ? 'border-emerald-800/70 bg-emerald-950/15'
        : component.kind === 'splice'
          ? 'border-violet-900/80 bg-violet-950/10'
          : 'border-zinc-800 bg-zinc-950/70'
    }`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide ${
              component.kind === 'splice'
                ? 'bg-violet-950 text-violet-300'
                : 'bg-zinc-800 text-zinc-400'
            }`}>
              {component.kind === 'splice' ? 'Splice' : 'Connector end'}
            </span>
            <span className="text-[9px] text-zinc-600">
              {completed}/{MANUFACTURING_STEPS.length}
            </span>
          </div>
          <InspectorLink
            item={inspectorItem}
            className="mt-1 block max-w-full truncate text-xs font-semibold text-zinc-100"
          >
            {component.label}
          </InspectorLink>
        </div>
        {component.kind === 'connector' && endpoint && (
          <select
            disabled={!isEditor || (!assignable && !gender)}
            title={assignable
              ? undefined
              : 'This side is ambiguous; only clearing an existing assignment is allowed'}
            value={gender ?? ''}
            onChange={(event) => changeGender(
              (event.target.value || undefined) as 'male' | 'female' | undefined,
            )}
            className={`shrink-0 rounded border bg-zinc-950 px-1.5 py-1 text-[9px] focus:outline-none focus:border-amber-500 ${
              gender ? 'border-zinc-700 text-zinc-200' : 'border-amber-800 text-amber-400'
            }`}
            aria-label={`${component.label} contact gender`}
          >
            <option value="">Contact…</option>
            <option value="male" disabled={!assignable}>Male</option>
            <option value="female" disabled={!assignable}>Female</option>
          </select>
        )}
      </div>

      <div className="mt-1 flex min-h-4 items-center gap-2 text-[9px]">
        {component.kind === 'connector' ? (
          <>
            <span className={gender ? 'text-zinc-300' : 'text-amber-500'}>
              {gender === 'male' ? '🍆' : gender === 'female' ? '🍑' : '🍆/🍑'}
              {' '}{endpoint?.familyCode ?? endpoint?.familyName ?? 'Unknown'} {gender ?? 'gender needed'}
            </span>
            <span className={crimpPartNumber ? 'font-mono text-sky-300' : 'text-amber-500'}>
              {crimpPartNumber ?? 'Select contact gender'}
            </span>
            {endpoint?.housingPartNumber && (
              <span className="truncate font-mono text-zinc-600">
                housing {endpoint.housingPartNumber}
              </span>
            )}
          </>
        ) : (
          <span className="text-violet-400">
            {component.wireIds.length} wire{component.wireIds.length === 1 ? '' : 's'} meet here
          </span>
        )}
      </div>

      <div className={`mt-2 flex items-center gap-2 rounded-md border px-2 py-1.5 ${
        nextStep
          ? 'border-amber-900/70 bg-amber-950/20'
          : 'border-emerald-900/70 bg-emerald-950/25'
      }`}>
        <div className="min-w-0 flex-1">
          <div className={`text-[8px] font-semibold uppercase tracking-wide ${
            nextStep ? 'text-amber-500' : 'text-emerald-500'
          }`}>
            {nextStep ? `Next · ${nextStep.label}` : 'Complete'}
          </div>
          <div className="truncate text-[9px] text-zinc-300" title={componentInstruction(component, nextStep?.id, crimpPartNumber)}>
            {componentInstruction(component, nextStep?.id, crimpPartNumber)}
          </div>
        </div>
        {nextStep && (
          <button
            type="button"
            disabled={!isEditor}
            onClick={() => updateStep(bundle.id, component.key, nextStep.id, true)}
            className="shrink-0 rounded bg-amber-500 px-2 py-1 text-[9px] font-semibold text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Mark done
          </button>
        )}
      </div>

      <div className="mt-2 grid grid-cols-6 gap-1">
        {MANUFACTURING_STEPS.map((step) => (
          <StepButton
            key={step.id}
            step={step}
            checked={!!steps[step.id]}
            onChange={(checked) => updateStep(bundle.id, component.key, step.id, checked)}
          />
        ))}
      </div>
    </section>
  );
}

function EmptyManufacturing() {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-3 w-10 h-10 rounded-full border border-zinc-700 bg-zinc-900 flex items-center justify-center text-zinc-500">
          ◇
        </div>
        <h2 className="text-sm font-semibold text-zinc-300">No manufacturable wires</h2>
        <p className="mt-1 text-xs text-zinc-600">
          Add paths between connectors. Each connector-to-connector run becomes a
          buildable harness; splice legs remain visible as marked work points.
        </p>
      </div>
    </div>
  );
}

function BundleCutList({
  manufacturingHarness,
  bundles,
}: {
  manufacturingHarness: ManufacturingHarness;
  bundles: ManufacturingBundle[];
}) {
  const harness = useHarnessStore((state) => state.harness);
  const connectorLibrary = useHarnessStore((state) => state.connectorLibrary);
  const manufacturing = useHarnessStore((state) => state.manufacturing);
  const updateNotes = useHarnessStore((state) => state.updateManufacturingNotes);
  const updateTasks = useHarnessStore((state) => state.updateManufacturingTasks);
  const updatePathSegmentLengths = useHarnessStore((state) => state.updatePathSegmentLengths);
  const updateGender = useHarnessStore(
    (state) => state.updateManufacturingEndpointGender,
  );
  const inspectEntityQuiet = useHarnessStore((state) => state.inspectEntityQuiet);
  const openConnectorLibrary = useHarnessStore((state) => state.openConnectorLibrary);
  const isEditor = useHarnessStore((state) => state.session.isEditor);
  const showBundleInHierarchy = useHarnessStore(
    (state) => state.showBundleInHierarchy,
  );
  const [selection, setSelection] = useState<ManufacturingVisualSelection | null>(null);
  const trunk = manufacturingHarness.bundles.find(
    (bundle) => bundle.id === manufacturingHarness.trunkBundleId,
  ) ?? manufacturingHarness.bundles[0];
  if (!harness || !trunk) return null;
  const progress = manufacturing.bundles[trunk.id] ?? { steps: {} };
  const bundleById = new Map(
    manufacturingHarness.bundles.map((bundle) => [bundle.id, bundle]),
  );

  const applyVisualTasks = (tasks: ManufacturingVisualTask[]) => {
    if (!isEditor) return;
    const byBundle = new Map<string, ManufacturingVisualTask[]>();
    for (const task of tasks) {
      byBundle.set(task.bundleId, [...(byBundle.get(task.bundleId) ?? []), task]);
    }
    for (const [bundleId, grouped] of byBundle) {
      updateTasks(bundleId, grouped.map((task) => task.update));
    }
  };

  const applySegmentLengthChange = ({
    bundleId,
    wireId,
    segmentIndex,
    lengthMm,
  }: {
    bundleId: string;
    wireId: string;
    segmentIndex: number;
    lengthMm: number | undefined;
  }) => {
    if (!isEditor) return;
    const bundle = manufacturingHarness.bundles.find((candidate) => candidate.id === bundleId);
    const wire = bundle?.wires.find((candidate) => candidate.id === wireId);
    const hop = wire?.hops.find((candidate) => candidate.segmentIndex === segmentIndex);
    if (!bundle || !wire || !hop || hop.lengthMm === lengthMm) return;
    const updates: Array<{ pathId: string; segmentIndex: number; lengthMm: number | undefined }> = [{
      pathId: wire.pathId,
      segmentIndex: hop.segmentIndex,
      lengthMm,
    }];
    for (const match of confirmMatchBundleHopLengths(bundle, wire, hop, lengthMm)) {
      updates.push({
        pathId: match.pathId,
        segmentIndex: match.segmentIndex,
        lengthMm,
      });
    }
    updatePathSegmentLengths(updates);
  };

  const spliceComplete = (spliceId: string): boolean =>
    manufacturingHarness.bundleIds.some(
      (bundleId) => manufacturing.bundles[bundleId]?.splice_measured?.[spliceId],
    );

  const ownerBundleForConnector = (connectorId: string): ManufacturingBundle | undefined => {
    const candidates = manufacturingHarness.bundles.filter(
      (bundle) => bundle.connectorIds.includes(connectorId),
    );
    return candidates.find(
      (bundle) => manufacturing.bundles[bundle.id]?.endpoint_genders?.[connectorId],
    ) ?? candidates[0];
  };

  const genderConflictFor = (
    connectorId: string,
    ownerBundleId: string,
  ): string | undefined => {
    const ownerGender =
      manufacturing.bundles[ownerBundleId]?.endpoint_genders?.[connectorId];
    if (!ownerGender) return undefined;
    const expected = ownerGender === 'male' ? 'female' : 'male';
    const relationship = manufacturingGenderBundleRelationship(
      harness,
      bundles,
      ownerBundleId,
      connectorId,
    );
    if (!relationship.assignable) {
      return 'Bulkhead side is mixed or cannot be classified';
    }
    const conflictingMates = relationship.mateBundleIds.filter((bundleId) => {
      const gender = manufacturing.bundles[bundleId]?.endpoint_genders?.[connectorId];
      return gender && gender !== expected;
    });
    const conflictingSameSide = relationship.sameSideBundleIds.filter((bundleId) => {
      const gender = manufacturing.bundles[bundleId]?.endpoint_genders?.[connectorId];
      return gender && gender !== ownerGender;
    });
    const messages = [
      conflictingSameSide.length > 0
        ? `${conflictingSameSide.length} same-side assignment${conflictingSameSide.length === 1 ? '' : 's'} should be ${ownerGender}`
        : '',
      conflictingMates.length > 0
        ? `${conflictingMates.length} mating side${conflictingMates.length === 1 ? '' : 's'} should be ${expected}`
        : '',
    ].filter(Boolean);
    return messages.length > 0 ? messages.join(' · ') : undefined;
  };

  const changeGender = (
    connectorId: string,
    bundleId: string,
    gender: 'male' | 'female' | undefined,
  ) => {
    if (!isEditor) return;
    const relationship = manufacturingGenderBundleRelationship(
      harness,
      bundles,
      bundleId,
      connectorId,
    );
    if (!relationship.assignable && gender !== undefined) return;
    const { sameSideBundleIds, mateBundleIds } = relationship;
    const expectedMate = gender === 'male'
      ? 'female'
      : gender === 'female'
        ? 'male'
        : undefined;
    const assignedConflicts = mateBundleIds.filter((mateBundleId) => {
      const assigned =
        manufacturing.bundles[mateBundleId]?.endpoint_genders?.[connectorId];
      return assigned !== undefined && assigned !== expectedMate;
    });
    const sameSideConflicts = sameSideBundleIds.filter((sameSideBundleId) => {
      const assigned =
        manufacturing.bundles[sameSideBundleId]?.endpoint_genders?.[connectorId];
      return assigned !== undefined && assigned !== gender;
    });
    const conflictCount = assignedConflicts.length + sameSideConflicts.length;
    if (conflictCount === 0) {
      updateGender(bundleId, connectorId, gender, mateBundleIds, sameSideBundleIds);
      return;
    }
    const changeMate = window.confirm([
      `${conflictCount} related side${conflictCount === 1 ? ' is' : 's are'} already assigned.`,
      '',
      'OK: synchronize this physical side and its mating side.',
      'Cancel: keep the other assignments and leave a visible unresolved flag.',
    ].join('\n'));
    updateGender(
      bundleId,
      connectorId,
      gender,
      changeMate ? mateBundleIds : [],
      changeMate ? sameSideBundleIds : [],
    );
  };

  const allWireTasks = manufacturingHarness.bundles.flatMap((bundle) =>
    bundle.wires.flatMap((wire) => {
      const tasks: ManufacturingVisualTask[] = [{
        bundleId: bundle.id,
        update: {
          kind: 'wire-cut',
          wireId: wire.id,
          completed: true,
          lengthMm: wire.lengthMm,
        },
      }];
      if (wire.from.kind === 'connector') {
        tasks.push({
          bundleId: bundle.id,
          update: {
            kind: 'wire-end',
            wireId: wire.id,
            end: 'from',
            connectorId: wire.from.connectorId,
            completed: true,
          },
        });
      }
      if (wire.to.kind === 'connector' && !wire.fromCrimpOnly) {
        tasks.push({
          bundleId: bundle.id,
          update: {
            kind: 'wire-end',
            wireId: wire.id,
            end: 'to',
            connectorId: wire.to.connectorId,
            completed: true,
          },
        });
      }
      return tasks;
    }),
  );
  const completedWireTasks = allWireTasks.filter((task) =>
    manufacturingTaskCompleted(manufacturing.bundles[task.bundleId], task.update)
  ).length;
  const completedSplices = manufacturingHarness.spliceIds.filter(spliceComplete).length;
  const verifiedGuides = manufacturingHarness.connectorIds.filter((connectorId) =>
    manufacturingHarness.bundleIds.some(
      (bundleId) =>
        manufacturing.bundles[bundleId]?.connector_guide_states?.[connectorId]
        === 'verified',
    )
  ).length;
  const visualCompleted = completedWireTasks + completedSplices + verifiedGuides;
  const visualTotal =
    allWireTasks.length
    + manufacturingHarness.spliceIds.length
    + manufacturingHarness.connectorIds.length;

  const selectedBundle = selection && 'bundleId' in selection
    ? bundleById.get(selection.bundleId)
    : undefined;
  const selectedComponent = selection?.kind === 'endpoint' && selectedBundle
    ? deriveWorkComponents(selectedBundle).find((component) => {
        const wire = selectedBundle.wires.find((candidate) => candidate.id === selection.wireId);
        return component.kind === 'connector'
          && component.entityId === wire?.[selection.end].connectorId;
      })
    : selection?.kind === 'splice' && selectedBundle
      ? deriveWorkComponents(selectedBundle).find(
          (component) => component.kind === 'splice'
            && component.entityId === selection.spliceId,
        )
      : undefined;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/30 px-3 py-2.5">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <button
                type="button"
                onClick={() => showBundleInHierarchy(manufacturingHarness.pathIds)}
                className="truncate text-left text-sm font-semibold text-zinc-100 hover:text-amber-300 hover:underline"
                title="Open this whole harness on the canvas and frame it"
              >
                {manufacturingHarness.name}
              </button>
              <span className="shrink-0 text-[9px] text-zinc-500">
                {manufacturingHarness.wireCount} wire{manufacturingHarness.wireCount === 1 ? '' : 's'}
                {' · '}
                {formatLength(manufacturingHarness.knownLengthMm)}
                {manufacturingHarness.issueCount > 0 && (
                  <span className="text-amber-500"> · {manufacturingHarness.issueCount} issues</span>
                )}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[8px] text-zinc-600">
              Click a wire for its inspector · click the harness name to move the canvas
            </p>
          </div>
          <div className="w-44 shrink-0">
            <BundleNotes
            key={`${trunk.id}:${isEditor ? 'editable' : 'read-only'}`}
              value={progress.notes ?? ''}
              onSave={(notes) => updateNotes(trunk.id, notes)}
            />
          </div>
          <div className="w-32 shrink-0">
            <div className={`mb-1 text-right text-[9px] font-semibold ${
              visualCompleted === visualTotal ? 'text-emerald-400' : 'text-amber-400'
            }`}>
              {visualCompleted}/{visualTotal} visual tasks
            </div>
            <ProgressBar completed={visualCompleted} total={visualTotal} />
          </div>
          <button
            type="button"
            onClick={() => showBundleInHierarchy(manufacturingHarness.pathIds)}
            className="shrink-0 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[9px] text-zinc-400 hover:border-amber-700 hover:text-amber-300"
            title="Show this harness in the hierarchy canvas"
          >
            View harness ↗
          </button>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 basis-0 flex-1 flex-col overflow-hidden">
          <div className="h-[58%] min-h-[360px] shrink-0 overflow-hidden border-b border-zinc-800">
            <ManufacturingHarnessVisualizer
              harness={manufacturingHarness}
              manufacturing={manufacturing}
              selection={selection}
              onSelect={setSelection}
              onInspectPath={(pathId) => inspectEntityQuiet({ type: 'path', id: pathId })}
              onTasks={applyVisualTasks}
              onSegmentLengthChange={applySegmentLengthChange}
              canEditLengths={isEditor}
            />
          </div>

          <div className="flex-1 min-h-[180px] overflow-auto bg-zinc-950">
            {selectedComponent && selectedBundle && (
              <div className="sticky left-0 top-0 z-20 border-b border-zinc-800 bg-zinc-950 p-2">
                <ComponentWorkCard
                  bundle={selectedBundle}
                  bundles={bundles}
                  component={selectedComponent}
                />
              </div>
            )}
            <table className="w-full min-w-[1000px] table-fixed border-collapse">
              <thead className="sticky top-0 z-10 bg-zinc-900">
                <tr className="border-b border-zinc-700">
                  {[
                    ['Wire / signal', 'w-[18%]'],
                    ['Cut + splice sections', 'w-[40%]'],
                    ['Material', 'w-[14%]'],
                    ['Connector ends', 'w-[28%]'],
                  ].map(([label, width]) => (
                    <th
                      key={label}
                      className={`${width} px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-wider text-zinc-500`}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {manufacturingHarness.bundles.flatMap((bundle) =>
                  bundle.wires.map((wire) => (
                    <WireRow key={`${bundle.id}:${wire.id}`} wire={wire} bundle={bundle} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="w-[380px] shrink-0 overflow-y-auto border-l-4 border-zinc-800 bg-zinc-950 2xl:w-[440px]">
          <div className="sticky top-0 z-20 border-b-2 border-zinc-800 bg-zinc-950/95 px-3 py-2.5 backdrop-blur">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-300">
              Connector reference
            </div>
            <div className="text-[8px] text-zinc-600">
              Pin guides and cavity tables stay outside the harness view.
            </div>
          </div>
          <div className="space-y-3 p-3">
            {manufacturingHarness.connectorIds.map((connectorId) => {
              const ownerBundle = ownerBundleForConnector(connectorId);
              if (!ownerBundle) return null;
              const genderRelationship = manufacturingGenderBundleRelationship(
                harness,
                bundles,
                ownerBundle.id,
                connectorId,
              );
              return (
                <ManufacturingConnectorGuide
                  key={connectorId}
                  connectorId={connectorId}
                  ownerBundleId={ownerBundle.id}
                  manufacturingHarness={manufacturingHarness}
                  harness={harness}
                  library={connectorLibrary}
                  manufacturing={manufacturing}
                  isEditor={isEditor}
                  genderAssignable={genderRelationship.assignable}
                  genderConflict={genderConflictFor(connectorId, ownerBundle.id)}
                  onInspect={inspectEntityQuiet}
                  onOpenLibrary={openConnectorLibrary}
                  onGenderChange={changeGender}
                  onGuideStateChange={(
                    bundleId: string,
                    id: string,
                    state: ManufacturingConnectorGuideState | undefined,
                  ) => applyVisualTasks([{
                    bundleId,
                    update: { kind: 'connector-guide', connectorId: id, state },
                  }])}
                />
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}

export function ManufacturingPage() {
  const harness = useHarnessStore((state) => state.harness);
  const connectorLibrary = useHarnessStore((state) => state.connectorLibrary);
  const manufacturing = useHarnessStore((state) => state.manufacturing);
  const manufacturingTargetBundleId = useHarnessStore(
    (state) => state.manufacturingTargetBundleId,
  );
  const setManufacturingTargetBundle = useHarnessStore(
    (state) => state.setManufacturingTargetBundle,
  );
  const tab = useHarnessStore((state) => state.manufacturingTab);
  const setTab = useHarnessStore((state) => state.setManufacturingTab);
  const activeHarnessName = useHarnessStore((state) => state.activeHarnessName);

  const [search, setSearch] = useState('');

  const bundles = useMemo(
    () => harness
      ? deriveManufacturingBundles(harness, connectorLibrary, manufacturing)
      : [],
    [harness, connectorLibrary, manufacturing],
  );
  const manufacturingHarnesses = useMemo(
    () => deriveManufacturingHarnesses(bundles),
    [bundles],
  );
  const bom = useMemo(
    () => harness ? deriveManufacturingBom(harness, connectorLibrary, bundles) : [],
    [harness, connectorLibrary, bundles],
  );
  const visibleHarnesses = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return manufacturingHarnesses;
    return manufacturingHarnesses.filter((manufacturingHarness) =>
      manufacturingHarness.name.toLowerCase().includes(query)
      || manufacturingHarness.id.toLowerCase().includes(query)
      || manufacturingHarness.bundles.some((bundle) => bundle.wires.some((wire) =>
        [
          wire.wireId,
          wire.pathName,
          wire.signalName,
          wire.from.label,
          wire.to.label,
          ...wire.viaSplices.map((splice) => splice.label),
        ].some((value) => value.toLowerCase().includes(query))
      ))
    );
  }, [manufacturingHarnesses, search]);

  const effectiveSelectedHarnessId = manufacturingHarnesses.find(
    (candidate) => candidate.bundleIds.includes(manufacturingTargetBundleId ?? '')
      || candidate.trunkBundleId === manufacturingTargetBundleId
      || candidate.id === manufacturingTargetBundleId,
  )?.id ?? manufacturingHarnesses[0]?.id ?? null;

  const selectManufacturingHarness = (manufacturingHarness: ManufacturingHarness) => {
    setManufacturingTargetBundle(manufacturingHarness.trunkBundleId);
  };

  // Keep store + per-user prefs aligned with the harness actually shown (including
  // fallback to the first harness when the saved target no longer exists).
  useEffect(() => {
    if (!effectiveSelectedHarnessId) return;
    const selected = manufacturingHarnesses.find(
      (candidate) => candidate.id === effectiveSelectedHarnessId,
    );
    if (!selected) return;
    const matches = !!manufacturingTargetBundleId && (
      selected.bundleIds.includes(manufacturingTargetBundleId)
      || selected.trunkBundleId === manufacturingTargetBundleId
      || selected.id === manufacturingTargetBundleId
    );
    if (!matches) setManufacturingTargetBundle(selected.trunkBundleId);
  }, [
    effectiveSelectedHarnessId,
    manufacturingHarnesses,
    manufacturingTargetBundleId,
    setManufacturingTargetBundle,
  ]);

  const selectedManufacturingHarness = manufacturingHarnesses.find(
    (candidate) => candidate.id === effectiveSelectedHarnessId,
  );
  const totalCuts = bundles.reduce((sum, bundle) => sum + bundle.wires.length, 0);
  const visualStats = new Map(manufacturingHarnesses.map((manufacturingHarness) => {
    let completed = 0;
    let total = 0;
    for (const bundle of manufacturingHarness.bundles) {
      for (const wire of bundle.wires) {
        total += 1;
        if (manufacturing.bundles[bundle.id]?.wire_progress?.[wire.id]?.cut) completed += 1;
        for (const end of ['from', 'to'] as const) {
          if (wire[end].kind !== 'connector') continue;
          if (end === 'to' && wire.fromCrimpOnly) continue;
          total += 1;
          if (manufacturing.bundles[bundle.id]?.wire_progress?.[wire.id]?.ends?.[end]) {
            completed += 1;
          }
        }
      }
    }
    total += manufacturingHarness.spliceIds.length;
    completed += manufacturingHarness.spliceIds.filter((spliceId) =>
      manufacturingHarness.bundleIds.some(
        (bundleId) => manufacturing.bundles[bundleId]?.splice_measured?.[spliceId],
      )
    ).length;
    total += manufacturingHarness.connectorIds.length;
    completed += manufacturingHarness.connectorIds.filter((connectorId) =>
      manufacturingHarness.bundleIds.some(
        (bundleId) =>
          manufacturing.bundles[bundleId]?.connector_guide_states?.[connectorId]
          === 'verified',
      )
    ).length;
    return [manufacturingHarness.id, { completed, total }];
  }));
  const totalVisualTasks = [...visualStats.values()].reduce(
    (sum, stats) => sum + stats.total,
    0,
  );
  const completedVisualTasks = [...visualStats.values()].reduce(
    (sum, stats) => sum + stats.completed,
    0,
  );
  const openIssues = bundles.reduce((sum, bundle) => sum + bundle.issueCount, 0);

  const downloadBom = () => {
    const csv = manufacturingBomToCsv(bom);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${activeHarnessName}-bom.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  if (!harness) return null;

  return (
    <div className="h-full min-h-0 flex flex-col bg-zinc-950">
      <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/70 px-3 py-2 flex items-center gap-4">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-zinc-100">Manufacturing</h1>
          <p className="max-w-44 truncate text-[9px] text-zinc-500">
            {harness.name ?? activeHarnessName}
          </p>
        </div>
        <div className="flex items-center rounded-md border border-zinc-700 overflow-hidden">
          {([
            ['cutlists', 'Build'],
            ['progress', 'Progress'],
            ['bom', 'BOM'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-3 py-1 text-[10px] transition-colors ${
                tab === id
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1 truncate text-[9px] text-zinc-500">
          <span className="text-zinc-300">{manufacturingHarnesses.length}</span> harnesses
          <span className="mx-2 text-zinc-700">·</span>
          <span className="text-zinc-300">{totalCuts}</span> wire cuts
          <span className="mx-2 text-zinc-700">·</span>
          <span className={completedVisualTasks === totalVisualTasks ? 'text-emerald-400' : 'text-amber-400'}>
            {completedVisualTasks}/{totalVisualTasks}
          </span> visual tasks
          {openIssues > 0 && (
            <>
              <span className="mx-2 text-zinc-700">·</span>
              <span className="text-amber-500">{openIssues}</span> issues
            </>
          )}
        </div>
        {tab === 'bom' && (
          <button
            type="button"
            onClick={downloadBom}
            disabled={bom.length === 0}
            className="px-3 py-1.5 rounded-md bg-amber-500 text-[10px] font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Download CSV
          </button>
        )}
      </div>

      {manufacturingHarnesses.length === 0 ? (
        <div className="flex-1 min-h-0"><EmptyManufacturing /></div>
      ) : tab === 'cutlists' ? (
        <div className="flex flex-1 min-h-0">
          <aside className="w-60 shrink-0 border-r border-zinc-800 bg-zinc-900/40 flex flex-col min-h-0">
            <div className="border-b border-zinc-800 p-2">
              <div className="mb-1.5 flex items-center justify-between px-0.5">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
                  Physical harnesses
                </span>
                <span className="text-[9px] text-zinc-600">{visibleHarnesses.length}</span>
              </div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find harness or wire…"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-2.5 py-1.5 text-[10px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
              {visibleHarnesses.map((manufacturingHarness, harnessIndex) => {
                const stats = visualStats.get(manufacturingHarness.id) ?? {
                  completed: 0,
                  total: 0,
                };
                return (
                  <button
                    key={manufacturingHarness.id}
                    type="button"
                    onClick={() => selectManufacturingHarness(manufacturingHarness)}
                    className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors ${
                      effectiveSelectedHarnessId === manufacturingHarness.id
                        ? 'border-amber-700/70 bg-amber-950/25'
                        : 'border-transparent hover:border-zinc-800 hover:bg-zinc-900'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {harnessIndex < 9 && (
                        <span className="w-3 shrink-0 pt-0.5 text-[10px] text-zinc-600 tabular-nums">
                          {harnessIndex + 1}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-200">
                        {manufacturingHarness.name}
                      </span>
                      <span className={`shrink-0 text-[9px] ${
                        stats.completed === stats.total && stats.total > 0
                          ? 'text-emerald-400'
                          : 'text-zinc-500'
                      }`}>
                        {stats.completed}/{stats.total}
                      </span>
                    </div>
                    <div className="mb-1.5 mt-1 flex items-center justify-between text-[8px] text-zinc-600">
                      <span>{manufacturingHarness.wireCount} wire{manufacturingHarness.wireCount === 1 ? '' : 's'}</span>
                      {manufacturingHarness.issueCount > 0 && (
                        <span className="text-amber-500">{manufacturingHarness.issueCount} issues</span>
                      )}
                    </div>
                    <ProgressBar
                      completed={stats.completed}
                      total={stats.total}
                    />
                  </button>
                );
              })}
              {visibleHarnesses.length === 0 && (
                <div className="py-8 text-center text-xs text-zinc-600">
                  No matching harnesses
                </div>
              )}
            </div>
          </aside>
          <main className="flex-1 min-w-0 min-h-0">
            {selectedManufacturingHarness
              ? (
                  <BundleCutList
                    key={selectedManufacturingHarness.id}
                    manufacturingHarness={selectedManufacturingHarness}
                    bundles={bundles}
                  />
                )
              : <div className="h-full flex items-center justify-center text-sm text-zinc-600">Select a harness</div>}
          </main>
        </div>
      ) : tab === 'progress' ? (
        <div className="flex-1 min-h-0">
          <ManufacturingProgressView
            harnesses={manufacturingHarnesses}
            manufacturing={manufacturing}
            onSelectHarness={(harnessId) => {
              const manufacturingHarness = manufacturingHarnesses.find(
                (candidate) => candidate.id === harnessId,
              );
              if (manufacturingHarness) selectManufacturingHarness(manufacturingHarness);
              setTab('cutlists');
            }}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full min-w-[1000px] border-collapse">
            <thead className="sticky top-0 z-10 bg-zinc-900">
              <tr className="border-b border-zinc-700">
                {['Category', 'Description', 'Part number', 'Color', 'Quantity', 'Unit', 'Notes'].map((label) => (
                  <th
                    key={label}
                    className="px-5 py-2.5 text-left text-[9px] font-semibold uppercase tracking-wider text-zinc-500"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bom.map((row, index) => {
                const startsCategory = index === 0 || bom[index - 1].category !== row.category;
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-zinc-800/80 hover:bg-zinc-900/70 ${
                      startsCategory && index > 0 ? 'border-t-2 border-t-zinc-700' : ''
                    }`}
                  >
                    <td className="px-5 py-3">
                      <span className={`text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${
                        row.category === 'Wire'
                          ? 'bg-sky-950 text-sky-300'
                          : row.category === 'Housing'
                            ? 'bg-violet-950 text-violet-300'
                            : 'bg-amber-950 text-amber-300'
                      }`}>
                        {row.category}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-zinc-200">{row.description}</td>
                    <td className={`px-5 py-3 font-mono text-[11px] ${
                      row.partNumber ? 'text-zinc-300' : 'text-amber-500'
                    }`}>
                      {row.partNumber || 'PN not set'}
                    </td>
                    <td className="px-5 py-3 text-[11px] text-zinc-300">
                      {row.color || '—'}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-xs text-zinc-100">
                      {formatQuantity(row.quantity, row.unit)}
                    </td>
                    <td className="px-5 py-3 text-[10px] text-zinc-500">{row.unit}</td>
                    <td className="px-5 py-3 text-[10px] text-zinc-500">{row.notes || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
