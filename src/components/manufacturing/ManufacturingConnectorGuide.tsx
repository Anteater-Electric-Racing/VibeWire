import {
  getConnectorFamilyCode,
  getConnectorPinGuideImage,
  getEffectivePinCount,
} from '../../lib/connectorFamily';
import {
  getConnectorOccupancy,
  getPathWireAppearance,
} from '../../lib/harness';
import { getWireBackground } from '../../lib/colors';
import type { ManufacturingHarness } from '../../lib/manufacturing';
import type {
  ConnectorLibrary,
  HarnessData,
  ManufacturingConnectorGuideState,
  ManufacturingDocument,
  SelectedItem,
} from '../../types';

function nextGuideState(
  state: ManufacturingConnectorGuideState | undefined,
): ManufacturingConnectorGuideState | undefined {
  if (!state) return 'checking';
  if (state === 'checking') return 'verified';
  return undefined;
}

export function ManufacturingConnectorGuide({
  connectorId,
  ownerBundleId,
  manufacturingHarness,
  harness,
  library,
  manufacturing,
  isEditor,
  genderAssignable,
  genderConflict,
  onInspect,
  onOpenLibrary,
  onGenderChange,
  onGuideStateChange,
}: {
  connectorId: string;
  ownerBundleId: string;
  manufacturingHarness: ManufacturingHarness;
  harness: HarnessData;
  library: ConnectorLibrary | null;
  manufacturing: ManufacturingDocument;
  isEditor: boolean;
  genderAssignable: boolean;
  genderConflict?: string;
  onInspect: (item: SelectedItem) => void;
  onOpenLibrary: (typeId: string) => void;
  onGenderChange: (
    connectorId: string,
    bundleId: string,
    gender: 'male' | 'female' | undefined,
  ) => void;
  onGuideStateChange: (
    bundleId: string,
    connectorId: string,
    state: ManufacturingConnectorGuideState | undefined,
  ) => void;
}) {
  const connector = harness.connectors.find((candidate) => candidate.id === connectorId);
  if (!connector) return null;
  const type = library?.connector_types.find(
    (candidate) => candidate.id === connector.connector_type,
  );
  const endpoint = manufacturingHarness.bundles
    .flatMap((bundle) => bundle.wires)
    .flatMap((wire) => [wire.from, wire.to])
    .find((candidate) => candidate.connectorId === connectorId);
  const gender = manufacturing.bundles[ownerBundleId]?.endpoint_genders?.[connectorId]
    ?? endpoint?.terminalGender;
  const guideState =
    manufacturing.bundles[ownerBundleId]?.connector_guide_states?.[connectorId];
  const guideImage = connector.properties.pin_guide_image
    || getConnectorPinGuideImage(connector, type, gender);
  const occupancy = getConnectorOccupancy(harness, connectorId);
  const maxUsedPin = Math.max(0, ...occupancy.map((entry) => entry.pinNumber));
  const pinCount = Math.max(getEffectivePinCount(connector, type), maxUsedPin);
  const rows = Array.from({ length: pinCount }, (_, index) => {
    const pinNumber = index + 1;
    return {
      pinNumber,
      items: occupancy.filter((entry) => entry.pinNumber === pinNumber),
    };
  });
  const familyLabel = `${getConnectorFamilyCode(type)} ${gender ?? 'gender needed'}`;

  return (
    <section className={`w-full min-w-0 overflow-hidden rounded-lg border-2 ${
      genderConflict
        ? 'border-red-700 bg-red-950/10'
        : guideState === 'verified'
          ? 'border-emerald-800 bg-emerald-950/10'
          : guideState === 'checking'
            ? 'border-amber-800 bg-amber-950/10'
            : 'border-zinc-800 bg-zinc-900/40'
    }`}>
      <div className="flex items-start gap-2 border-b border-zinc-800 px-3 py-2">
        <button
          type="button"
          onClick={() => onInspect({ type: 'connector', id: connectorId })}
          className="min-w-0 flex-1 text-left"
          title="Open connector in inspector without moving the canvas"
        >
          <div className="truncate text-[11px] font-semibold text-zinc-100 hover:text-amber-300">
            {connector.name}
          </div>
          <div className={`text-[9px] ${gender ? 'text-zinc-500' : 'text-amber-500'}`}>
            {gender === 'male' ? '🍆' : gender === 'female' ? '🍑' : '🍆 / 🍑'} {familyLabel}
          </div>
        </button>
        <select
          disabled={!isEditor || (!genderAssignable && !gender)}
          title={genderAssignable
            ? undefined
            : 'This side is ambiguous; only clearing an existing assignment is allowed'}
          value={gender ?? ''}
          onChange={(event) => onGenderChange(
            connectorId,
            ownerBundleId,
            (event.target.value || undefined) as 'male' | 'female' | undefined,
          )}
          className={`rounded border bg-zinc-950 px-1.5 py-1 text-[9px] focus:border-amber-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
            gender ? 'border-zinc-700 text-zinc-200' : 'border-amber-800 text-amber-300'
          }`}
          aria-label={`${connector.name} contact gender`}
        >
          <option value="">Choose gender…</option>
          <option value="male" disabled={!genderAssignable}>🍆 Male</option>
          <option value="female" disabled={!genderAssignable}>🍑 Female</option>
        </select>
      </div>

      {genderConflict && (
        <div className="border-b border-red-900/70 bg-red-950/35 px-3 py-1.5 text-[9px] text-red-300">
          ⚑ Unresolved mating gender · {genderConflict}
        </div>
      )}

      <div className="grid grid-cols-[minmax(120px,0.8fr)_minmax(190px,1.2fr)]">
            <div className="border-r border-zinc-800 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
                  Pin guide
                </span>
                <span className={`text-[8px] ${
                  guideState === 'verified'
                    ? 'text-emerald-400'
                    : guideState === 'checking'
                      ? 'text-amber-400'
                      : 'text-red-400'
                }`}>
                  {guideState === 'verified'
                    ? 'verified'
                    : guideState === 'checking'
                      ? 'checking'
                      : 'not checked'}
                </span>
              </div>
              <button
                type="button"
                disabled={!isEditor}
                onDoubleClick={() => {
                  if (isEditor) {
                    onGuideStateChange(
                      ownerBundleId,
                      connectorId,
                      nextGuideState(guideState),
                    );
                  }
                }}
                className="group relative flex h-32 w-full items-center justify-center overflow-hidden rounded border-2 border-zinc-700 bg-zinc-950 disabled:cursor-not-allowed"
                title="Double-click: unchecked → checking (yellow) → verified (green)"
              >
                {guideImage ? (
                  <img
                    src={`/user-data/images/${guideImage}`}
                    alt={`${connector.name} ${familyLabel} pin guide`}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="px-3 text-center text-[10px] text-zinc-600">
                    <span className="block text-3xl">
                      {gender === 'male' ? '🍆' : gender === 'female' ? '🍑' : '🍆🍑'}
                    </span>
                    No {familyLabel} guide image
                  </span>
                )}
                {guideState && (
                  <span
                    className={`pointer-events-none absolute inset-0 ${
                      guideState === 'verified' ? 'bg-emerald-400/15' : 'bg-amber-300/15'
                    }`}
                  />
                )}
                <span className="pointer-events-none absolute inset-x-2 bottom-2 rounded bg-zinc-950/85 px-2 py-1 text-[8px] text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100">
                  Double-click to advance review
                </span>
              </button>
              {!guideImage && type && (
                <button
                  type="button"
                  disabled={!isEditor}
                  onClick={() => onOpenLibrary(type.id)}
                  className="mt-2 w-full rounded border border-dashed border-zinc-700 px-2 py-1.5 text-[9px] text-zinc-500 hover:border-amber-700 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  + Add inferred family image
                </button>
              )}
            </div>

            <div className="max-h-48 overflow-auto">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-zinc-900">
                  <tr className="border-b border-zinc-700">
                    {['Position', 'Color', 'Signal name', 'Wire'].map((label) => (
                      <th
                        key={label}
                        className="px-2 py-1.5 text-[8px] font-semibold uppercase tracking-wide text-zinc-500"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.pinNumber} className="border-b border-zinc-800/70">
                      <td className="px-2 py-1.5 align-top font-mono text-[10px] text-amber-300">
                        P{row.pinNumber}
                      </td>
                      {row.items.length === 0 ? (
                        <td colSpan={3} className="px-2 py-1.5 text-[9px] italic text-zinc-600">
                          Vacant
                        </td>
                      ) : (
                        <>
                          <td className="px-2 py-1.5 align-top">
                            <div className="space-y-1">
                              {row.items.map((item) => {
                                const path = harness.paths.find((candidate) => candidate.id === item.pathId);
                                const appearance = path ? getPathWireAppearance(path, harness) : null;
                                return (
                                  <div key={item.pathId} className="flex items-center gap-1.5">
                                    <span
                                      className="h-2.5 w-5 shrink-0 rounded-sm border border-zinc-600"
                                      style={{ background: getWireBackground(appearance, 1) }}
                                    />
                                    <span className="text-[9px] text-zinc-400">
                                      {appearance?.label ?? '—'}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            {row.items.map((item) => (
                              <div key={item.pathId} className="text-[9px] text-zinc-300">
                                {item.signalName || '—'}
                              </div>
                            ))}
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            {row.items.map((item) => (
                              <button
                                key={item.pathId}
                                type="button"
                                onClick={() => onInspect({ type: 'path', id: item.pathId })}
                                className="block max-w-32 truncate text-[9px] text-sky-400 hover:text-amber-300 hover:underline"
                              >
                                {item.pathName}
                              </button>
                            ))}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
      </div>
      <div className="border-t border-zinc-800 bg-zinc-950/50 px-3 py-1.5 text-[8px] text-zinc-500">
        Double-click the guide once for <span className="text-amber-400">checking</span>,
        then again for <span className="text-emerald-400">verified</span>. Tint stays light so labels remain readable.
      </div>
    </section>
  );
}
