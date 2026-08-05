import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useHarnessStore } from '../../store';
import {
  MANUFACTURING_STEPS,
  completedManufacturingComponentStepCount,
  deriveManufacturingBom,
  deriveManufacturingBundles,
  manufacturingComponentSteps,
  manufacturingBomToCsv,
  matingBundleIdsForConnector,
  type ManufacturingBundle,
  type ManufacturingEndpoint,
  type ManufacturingLengthHop,
  type ManufacturingWire,
} from '../../lib/manufacturing';
import type { ManufacturingStep, SelectedItem } from '../../types';

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
  const inspectEntity = useHarnessStore((state) => state.inspectEntity);
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

type PageTab = 'cutlists' | 'bom';

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
    <div className="min-w-[120px]">
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

function WireLengthEditor({
  wire,
  bundle,
}: {
  wire: ManufacturingWire;
  bundle: ManufacturingBundle;
}) {
  const updatePathSpanLengths = useHarnessStore((state) => state.updatePathSpanLengths);
  const updatePathSegmentLength = useHarnessStore((state) => state.updatePathSegmentLength);
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
      updatePathSegmentLength(wire.pathId, hop.segmentIndex, undefined);
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

    updatePathSegmentLength(wire.pathId, hop.segmentIndex, parsed);

    const nextTotal = wire.hops.reduce((sum, candidate) => {
      if (candidate.segmentIndex === hop.segmentIndex) return sum + parsed;
      if (candidate.lengthMm === undefined) return Number.NaN;
      return sum + candidate.lengthMm;
    }, 0);
    if (!Number.isFinite(nextTotal)) return;

    if (confirmMatchBundleLengths(bundle, wire, nextTotal)) {
      updatePathSpanLengths(
        bundle.wires
          .filter((other) => other.id !== wire.id)
          .map((other) => ({
            pathId: other.pathId,
            fromNodeIndex: other.fromNodeIndex,
            toNodeIndex: other.toNodeIndex,
            lengthMm: nextTotal,
          })),
      );
    }
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
    <div className="min-w-[120px]">
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
          className="mt-1 text-[9px] font-medium text-violet-300"
        >
          Mark {mark.label}
          <span className="text-violet-500">
            {mark.distanceMm === undefined ? ' · position needed' : ` @ ${formatLength(mark.distanceMm)}`}
          </span>
        </div>
      ))}

      {showHopBreakdown && (
        <details className="mt-1.5">
          <summary className={`cursor-pointer text-[9px] ${
            missingHop ? 'text-amber-500' : 'text-zinc-500 hover:text-zinc-300'
          }`}>
            {wire.hops.length} splice sections{missingHop ? ' · incomplete' : ''}
          </summary>
          <div className="mt-1.5 w-[270px] space-y-1.5 rounded border border-zinc-800 bg-zinc-950 p-2">
            {wire.hops.map((hop) => (
              <div key={`${wire.id}:${hop.segmentIndex}`} className="flex items-center gap-1.5">
                <div
                  className="min-w-0 flex-1 truncate text-[9px] text-zinc-400"
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
        </details>
      )}
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
  const signalItem = wire.signalId
    ? { type: 'signal' as const, id: wire.signalId }
    : null;

  return (
    <tr className="border-b border-zinc-800/80 align-top hover:bg-zinc-900/70">
      <td className="px-3 py-2">
        <div className="font-mono text-xs font-semibold text-amber-300">{wire.wireId}</div>
        <InspectorLink
          item={signalItem}
          className="mt-0.5 block max-w-[160px] truncate text-[10px] text-zinc-400"
          title="Open signal in inspector"
        >
          {wire.signalName || wire.pathName}
        </InspectorLink>
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
        <div className="text-[11px] font-medium text-zinc-200">
          {wire.color || '—'}
          {wire.colorInferred && (
            <span className="ml-1 text-[8px] text-sky-500">default</span>
          )}
        </div>
        <div className={`text-[9px] mt-0.5 ${wire.gauge ? 'text-zinc-500' : 'text-amber-500'}`}>
          {wire.gauge || 'Gauge missing'}
          {wire.gaugeInferred ? ' · inferred' : ''}
        </div>
      </td>
      <td className="px-3 py-2"><EndpointCell endpoint={wire.from} /></td>
      <td className="px-3 py-2">
        <EndpointCell endpoint={wire.to} crimpOwned={!wire.fromCrimpOnly} />
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
  const mateBundleIds = component.kind === 'connector'
    ? matingBundleIdsForConnector(bundles, bundle.id, component.entityId)
    : [];
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
            disabled={!isEditor}
            value={gender ?? ''}
            onChange={(event) => updateGender(
              bundle.id,
              component.entityId,
              (event.target.value || undefined) as 'male' | 'female' | undefined,
              mateBundleIds,
            )}
            className={`shrink-0 rounded border bg-zinc-950 px-1.5 py-1 text-[9px] focus:outline-none focus:border-amber-500 ${
              gender ? 'border-zinc-700 text-zinc-200' : 'border-amber-800 text-amber-400'
            }`}
            aria-label={`${component.label} contact gender`}
          >
            <option value="">Contact…</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        )}
      </div>

      <div className="mt-1 flex min-h-4 items-center gap-2 text-[9px]">
        {component.kind === 'connector' ? (
          <>
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
  bundle,
  bundles,
}: {
  bundle: ManufacturingBundle;
  bundles: ManufacturingBundle[];
}) {
  const manufacturing = useHarnessStore((state) => state.manufacturing);
  const updateNotes = useHarnessStore((state) => state.updateManufacturingNotes);
  const isEditor = useHarnessStore((state) => state.session.isEditor);
  const showBundleInHierarchy = useHarnessStore(
    (state) => state.showBundleInHierarchy,
  );
  const progress = manufacturing.bundles[bundle.id] ?? { steps: {} };
  const pathIds = Array.from(new Set(bundle.wires.map((wire) => wire.pathId)));
  const components = deriveWorkComponents(bundle);
  const completedComponents = components.filter((component) =>
    completedManufacturingComponentStepCount(
      manufacturing,
      bundle.id,
      component.key,
    ) === MANUFACTURING_STEPS.length
  ).length;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/30 px-3 py-2.5">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h2 className="truncate text-sm font-semibold text-zinc-100">{bundle.name}</h2>
              <span className="shrink-0 text-[9px] text-zinc-500">
                {bundle.wires.length} wire{bundle.wires.length === 1 ? '' : 's'}
                {' · '}
                {formatLength(bundle.knownLengthMm)}
                {bundle.issueCount > 0 && (
                  <span className="text-amber-500"> · {bundle.issueCount} issues</span>
                )}
              </span>
            </div>
            <p className="mt-0.5 truncate font-mono text-[8px] text-zinc-600">{bundle.id}</p>
          </div>
          <div className="w-44 shrink-0">
            <BundleNotes
            key={`${bundle.id}:${isEditor ? 'editable' : 'read-only'}`}
              value={progress.notes ?? ''}
              onSave={(notes) => updateNotes(bundle.id, notes)}
            />
          </div>
          <div className={`shrink-0 text-[10px] font-semibold ${
            completedComponents === components.length ? 'text-emerald-400' : 'text-amber-400'
          }`}>
            {completedComponents}/{components.length} ends done
          </div>
          <button
            type="button"
            onClick={() => showBundleInHierarchy(pathIds)}
            className="shrink-0 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[9px] text-zinc-400 hover:border-amber-700 hover:text-amber-300"
            title="Show this harness in the hierarchy canvas"
          >
            Hierarchy ↗
          </button>
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
          {components.map((component) => (
            <ComponentWorkCard
              key={component.key}
              bundle={bundle}
              bundles={bundles}
              component={component}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full min-w-[720px] table-fixed border-collapse">
          <thead className="sticky top-0 z-10 bg-zinc-900">
            <tr className="border-b border-zinc-700">
              {[
                ['Wire / signal', 'w-[22%]'],
                ['Cut + marks', 'w-[20%]'],
                ['Material', 'w-[15%]'],
                ['End A', 'w-[21.5%]'],
                ['End B', 'w-[21.5%]'],
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
            {bundle.wires.map((wire) => (
              <WireRow key={wire.id} wire={wire} bundle={bundle} />
            ))}
          </tbody>
        </table>
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
  const activeHarnessName = useHarnessStore((state) => state.activeHarnessName);

  const [tab, setTab] = useState<PageTab>('cutlists');
  const [search, setSearch] = useState('');
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(
    manufacturingTargetBundleId,
  );

  const bundles = useMemo(
    () => harness
      ? deriveManufacturingBundles(harness, connectorLibrary, manufacturing)
      : [],
    [harness, connectorLibrary, manufacturing],
  );
  const bom = useMemo(
    () => harness ? deriveManufacturingBom(harness, connectorLibrary, bundles) : [],
    [harness, connectorLibrary, bundles],
  );
  const visibleBundles = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return bundles;
    return bundles.filter((bundle) =>
      bundle.name.toLowerCase().includes(query)
      || bundle.id.toLowerCase().includes(query)
      || bundle.wires.some((wire) =>
        [
          wire.wireId,
          wire.pathName,
          wire.signalName,
          wire.from.label,
          wire.to.label,
          ...wire.viaSplices.map((splice) => splice.label),
        ].some((value) => value.toLowerCase().includes(query))
      )
    );
  }, [bundles, search]);

  const effectiveSelectedBundleId = selectedBundleId
    && bundles.some((bundle) => bundle.id === selectedBundleId)
      ? selectedBundleId
      : bundles[0]?.id ?? null;
  const selectedBundle = bundles.find((bundle) => bundle.id === effectiveSelectedBundleId);
  const totalCuts = bundles.reduce((sum, bundle) => sum + bundle.wires.length, 0);
  const componentStats = new Map(bundles.map((bundle) => {
    const components = deriveWorkComponents(bundle);
    const completedStages = components.reduce(
      (sum, component) => sum + completedManufacturingComponentStepCount(
        manufacturing,
        bundle.id,
        component.key,
      ),
      0,
    );
    const completedComponents = components.filter((component) =>
      completedManufacturingComponentStepCount(
        manufacturing,
        bundle.id,
        component.key,
      ) === MANUFACTURING_STEPS.length
    ).length;
    return [bundle.id, {
      completedStages,
      totalStages: components.length * MANUFACTURING_STEPS.length,
      completedComponents,
      totalComponents: components.length,
    }];
  }));
  const totalComponents = [...componentStats.values()].reduce(
    (sum, stats) => sum + stats.totalComponents,
    0,
  );
  const completedComponents = [...componentStats.values()].reduce(
    (sum, stats) => sum + stats.completedComponents,
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
          <span className="text-zinc-300">{bundles.length}</span> harnesses
          <span className="mx-2 text-zinc-700">·</span>
          <span className="text-zinc-300">{totalCuts}</span> wire cuts
          <span className="mx-2 text-zinc-700">·</span>
          <span className={completedComponents === totalComponents ? 'text-emerald-400' : 'text-amber-400'}>
            {completedComponents}/{totalComponents}
          </span> ends done
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

      {bundles.length === 0 ? (
        <div className="flex-1 min-h-0"><EmptyManufacturing /></div>
      ) : tab === 'cutlists' ? (
        <div className="flex flex-1 min-h-0">
          <aside className="w-60 shrink-0 border-r border-zinc-800 bg-zinc-900/40 flex flex-col min-h-0">
            <div className="border-b border-zinc-800 p-2">
              <div className="mb-1.5 flex items-center justify-between px-0.5">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
                  Harness runs
                </span>
                <span className="text-[9px] text-zinc-600">{visibleBundles.length}</span>
              </div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find harness or wire…"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-2.5 py-1.5 text-[10px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
              {visibleBundles.map((bundle) => {
                const stats = componentStats.get(bundle.id) ?? {
                  completedStages: 0,
                  totalStages: 0,
                  completedComponents: 0,
                  totalComponents: 0,
                };
                return (
                  <button
                    key={bundle.id}
                    type="button"
                    onClick={() => setSelectedBundleId(bundle.id)}
                    className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors ${
                      effectiveSelectedBundleId === bundle.id
                        ? 'border-amber-700/70 bg-amber-950/25'
                        : 'border-transparent hover:border-zinc-800 hover:bg-zinc-900'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-200">
                        {bundle.name}
                      </span>
                      <span className={`shrink-0 text-[9px] ${
                        stats.completedComponents === stats.totalComponents
                          ? 'text-emerald-400'
                          : 'text-zinc-500'
                      }`}>
                        {stats.completedComponents}/{stats.totalComponents}
                      </span>
                    </div>
                    <div className="mb-1.5 mt-1 flex items-center justify-between text-[8px] text-zinc-600">
                      <span>{bundle.wires.length} wire{bundle.wires.length === 1 ? '' : 's'}</span>
                      {bundle.issueCount > 0 && (
                        <span className="text-amber-500">{bundle.issueCount} issues</span>
                      )}
                    </div>
                    <ProgressBar
                      completed={stats.completedStages}
                      total={stats.totalStages}
                    />
                  </button>
                );
              })}
              {visibleBundles.length === 0 && (
                <div className="py-8 text-center text-xs text-zinc-600">
                  No matching harnesses
                </div>
              )}
            </div>
          </aside>
          <main className="flex-1 min-w-0 min-h-0">
            {selectedBundle
              ? (
                  <BundleCutList
                    key={selectedBundle.id}
                    bundle={selectedBundle}
                    bundles={bundles}
                  />
                )
              : <div className="h-full flex items-center justify-center text-sm text-zinc-600">Select a bundle</div>}
          </main>
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
