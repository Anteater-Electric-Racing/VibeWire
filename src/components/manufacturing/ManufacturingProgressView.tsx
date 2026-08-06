import { useMemo } from 'react';
import type {
  ManufacturingHarness,
  ManufacturingWire,
} from '../../lib/manufacturing';
import type { ManufacturingDocument } from '../../types';

interface HarnessProgress {
  harness: ManufacturingHarness;
  cuts: { complete: number; total: number };
  crimps: { complete: number; total: number };
  splices: { complete: number; total: number };
  guides: { complete: number; total: number };
  complete: number;
  total: number;
}

interface OperatorMetrics {
  id: string;
  name: string;
  crimps: number;
  wireMm: number;
  splices: number;
  guides: number;
  totalTasks: number;
  days: Set<string>;
}

function isWireEndComplete(
  document: ManufacturingDocument,
  bundleId: string,
  wire: ManufacturingWire,
  end: 'from' | 'to',
): boolean {
  return !!document.bundles[bundleId]?.wire_progress?.[wire.id]?.ends?.[end];
}

function harnessProgress(
  harness: ManufacturingHarness,
  document: ManufacturingDocument,
): HarnessProgress {
  const wires = harness.bundles.flatMap((bundle) =>
    bundle.wires.map((wire) => ({ bundle, wire })),
  );
  const cuts = {
    complete: wires.filter(({ bundle, wire }) =>
      document.bundles[bundle.id]?.wire_progress?.[wire.id]?.cut
    ).length,
    total: wires.length,
  };
  const crimpEnds = wires.flatMap(({ bundle, wire }) => ([
    ...(wire.from.kind === 'connector' ? [{ bundle, wire, end: 'from' as const }] : []),
    ...(wire.to.kind === 'connector' && !wire.fromCrimpOnly
      ? [{ bundle, wire, end: 'to' as const }]
      : []),
  ]));
  const crimps = {
    complete: crimpEnds.filter(({ bundle, wire, end }) =>
      isWireEndComplete(document, bundle.id, wire, end)
    ).length,
    total: crimpEnds.length,
  };
  const splices = {
    complete: harness.spliceIds.filter((spliceId) =>
      harness.bundleIds.some((bundleId) =>
        document.bundles[bundleId]?.splice_measured?.[spliceId]
      )
    ).length,
    total: harness.spliceIds.length,
  };
  const guides = {
    complete: harness.connectorIds.filter((connectorId) =>
      harness.bundleIds.some((bundleId) =>
        document.bundles[bundleId]?.connector_guide_states?.[connectorId] === 'verified'
      )
    ).length,
    total: harness.connectorIds.length,
  };
  const complete = cuts.complete + crimps.complete + splices.complete + guides.complete;
  const total = cuts.total + crimps.total + splices.total + guides.total;
  return { harness, cuts, crimps, splices, guides, complete, total };
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const percentage = total === 0 ? 0 : completed / total * 100;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
      <div
        className={`h-full transition-all ${
          completed === total && total > 0 ? 'bg-emerald-500' : 'bg-amber-500'
        }`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

export function ManufacturingProgressView({
  harnesses,
  manufacturing,
  onSelectHarness,
}: {
  harnesses: ManufacturingHarness[];
  manufacturing: ManufacturingDocument;
  onSelectHarness: (harnessId: string) => void;
}) {
  const progress = useMemo(
    () => harnesses.map((harness) => harnessProgress(harness, manufacturing)),
    [harnesses, manufacturing],
  );
  const leaderboard = useMemo(() => {
    const wireByTask = new Map<string, ManufacturingWire>();
    for (const harness of harnesses) {
      for (const bundle of harness.bundles) {
        for (const wire of bundle.wires) {
          wireByTask.set(`wire:${wire.id}:cut`, wire);
        }
      }
    }
    const users = new Map<string, OperatorMetrics>();
    const seenTasks = new Set<string>();
    for (const bundleProgress of Object.values(manufacturing.bundles)) {
      for (const [taskKey, attribution] of Object.entries(
        bundleProgress.task_attribution ?? {},
      )) {
        if (seenTasks.has(taskKey)) continue;
        seenTasks.add(taskKey);
        const current = users.get(attribution.user_id) ?? {
          id: attribution.user_id,
          name: attribution.user_name,
          crimps: 0,
          wireMm: 0,
          splices: 0,
          guides: 0,
          totalTasks: 0,
          days: new Set<string>(),
        };
        current.name = attribution.user_name;
        current.totalTasks += 1;
        current.days.add(attribution.day);
        if (taskKey.includes(':end:')) current.crimps += 1;
        else if (taskKey.endsWith(':cut')) {
          current.wireMm += wireByTask.get(taskKey)?.lengthMm ?? 0;
        } else if (taskKey.startsWith('splice:')) current.splices += 1;
        else if (taskKey.endsWith(':guide')) current.guides += 1;
        users.set(current.id, current);
      }
    }
    return [...users.values()].sort(
      (left, right) => right.totalTasks - left.totalTasks
        || right.crimps - left.crimps
        || right.wireMm - left.wireMm
        || left.name.localeCompare(right.name),
    );
  }, [harnesses, manufacturing]);
  const recentEvents = useMemo(() =>
    Object.values(manufacturing.bundles)
      .flatMap((bundle) => bundle.work_log ?? [])
      .slice()
      .sort((left, right) => right.id.localeCompare(left.id))
      .slice(0, 20)
  , [manufacturing]);
  const complete = progress.reduce((sum, item) => sum + item.complete, 0);
  const total = progress.reduce((sum, item) => sum + item.total, 0);

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Harnessing progress</h2>
              <p className="mt-1 text-[10px] text-zinc-500">
                Cuts, crimps, splice measurements, and verified pin guides.
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-amber-300">
                {total === 0 ? 0 : Math.round(complete / total * 100)}%
              </div>
              <div className="text-[9px] text-zinc-600">{complete}/{total} visual tasks</div>
            </div>
          </div>
          <div className="mt-3"><ProgressBar completed={complete} total={total} /></div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40">
            <div className="border-b border-zinc-800 px-4 py-3">
              <h3 className="text-xs font-semibold text-zinc-200">Harnesses</h3>
            </div>
            <div className="divide-y divide-zinc-800">
              {progress.map((item) => (
                <button
                  key={item.harness.id}
                  type="button"
                  onClick={() => onSelectHarness(item.harness.id)}
                  className="block w-full px-4 py-3 text-left hover:bg-zinc-900"
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-semibold text-zinc-200">
                        {item.harness.name}
                      </div>
                      <div className="mt-1 grid grid-cols-4 gap-2 text-[8px]">
                        <span className="text-sky-400">Cuts {item.cuts.complete}/{item.cuts.total}</span>
                        <span className="text-violet-400">Crimps {item.crimps.complete}/{item.crimps.total}</span>
                        <span className="text-fuchsia-400">Splices {item.splices.complete}/{item.splices.total}</span>
                        <span className="text-emerald-400">Guides {item.guides.complete}/{item.guides.total}</span>
                      </div>
                      <div className="mt-2">
                        <ProgressBar completed={item.complete} total={item.total} />
                      </div>
                    </div>
                    <div className={`text-xs font-semibold ${
                      item.complete === item.total && item.total > 0
                        ? 'text-emerald-400'
                        : 'text-amber-400'
                    }`}>
                      {item.total === 0 ? 0 : Math.round(item.complete / item.total * 100)}%
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40">
            <div className="border-b border-zinc-800 px-4 py-3">
              <h3 className="text-xs font-semibold text-zinc-200">Top harnessers</h3>
              <p className="mt-0.5 text-[9px] text-zinc-600">Current completed work, attributed by day.</p>
            </div>
            <div className="divide-y divide-zinc-800">
              {leaderboard.map((operator, index) => (
                <div key={operator.id} className="flex items-center gap-3 px-4 py-3">
                  <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                    index === 0
                      ? 'bg-amber-400 text-zinc-950'
                      : 'border border-zinc-700 text-zinc-500'
                  }`}>
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-semibold text-zinc-200">
                      {operator.name}
                    </div>
                    <div className="mt-0.5 text-[8px] text-zinc-500">
                      {operator.crimps} crimps · {(operator.wireMm / 304.8).toFixed(1)} ft cut
                      {' · '}{operator.splices} splices · {operator.days.size} day{operator.days.size === 1 ? '' : 's'}
                    </div>
                  </div>
                  <span className="text-sm font-bold text-amber-300">{operator.totalTasks}</span>
                </div>
              ))}
              {leaderboard.length === 0 && (
                <div className="px-4 py-10 text-center text-[10px] text-zinc-600">
                  Complete a red manufacturing item to start the leaderboard.
                </div>
              )}
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40">
          <div className="border-b border-zinc-800 px-4 py-3">
            <h3 className="text-xs font-semibold text-zinc-200">Recent work log</h3>
          </div>
          <div className="divide-y divide-zinc-800">
            {recentEvents.map((event) => (
              <div key={event.id} className="grid grid-cols-[100px_140px_1fr_auto] gap-3 px-4 py-2 text-[9px]">
                <span className="font-mono text-zinc-500">{event.day}</span>
                <span className="truncate font-medium text-zinc-300">{event.user_name}</span>
                <span className="truncate text-zinc-500">
                  {event.action === 'complete' ? 'Completed' : 'Reopened'} {event.kind.replaceAll('-', ' ')}
                  {' · '}{event.task_key}
                </span>
                <span className={event.action === 'complete' ? 'text-emerald-400' : 'text-red-400'}>
                  {event.quantity !== undefined
                    ? `${event.quantity}${event.unit === 'mm' ? ' mm' : ''}`
                    : event.state ?? ''}
                </span>
              </div>
            ))}
            {recentEvents.length === 0 && (
              <div className="px-4 py-8 text-center text-[10px] text-zinc-600">
                No attributed manufacturing work yet.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
