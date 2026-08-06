import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ModalShell } from '../collab/ModalShell';

interface EntityCounts {
  enclosures: number;
  connectors: number;
  mergePoints: number;
  paths: number;
  signals: number;
}

interface Contributor {
  id: string;
  displayName: string;
}

interface CheckpointMeta {
  id: string;
  label: string;
  createdAt: string;
  createdBy: Contributor;
  rev: number;
  auto: boolean;
  counts: EntityCounts;
  dailyKey?: string;
  contributors?: Contributor[];
}

interface CheckpointDetails extends CheckpointMeta {
  countDiff: EntityCounts;
}

interface RestoreResult {
  restored: CheckpointMeta;
  automaticCheckpoint: CheckpointMeta;
  rev: number;
}

interface CheckpointPanelProps {
  harness: string;
  isEditor: boolean;
  onClose: () => void;
}

const COUNT_LABELS: Array<[keyof EntityCounts, string]> = [
  ['enclosures', 'enclosures'],
  ['connectors', 'connectors'],
  ['mergePoints', 'merge points'],
  ['paths', 'paths'],
  ['signals', 'signals'],
];

function isAutomatic(checkpoint: CheckpointMeta): boolean {
  return checkpoint.auto;
}

function isDaily(checkpoint: CheckpointMeta): boolean {
  return checkpoint.dailyKey !== undefined;
}

function contributorNames(checkpoint: CheckpointMeta): string {
  const contributors = checkpoint.contributors;
  if (!contributors || contributors.length === 0) return checkpoint.createdBy.displayName;
  return contributors.map((contributor) => contributor.displayName).join(', ');
}

function relativeTime(value: string): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value;
  const seconds = Math.round((time - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, 'day');
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return formatter.format(months, 'month');
  return formatter.format(Math.round(months / 12), 'year');
}

function countsSummary(counts: EntityCounts): string {
  return COUNT_LABELS.map(([key, label]) => `${counts[key]} ${label}`).join(' · ');
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error || fallback;
}

export function CheckpointPanel({ harness, isEditor, onClose }: CheckpointPanelProps) {
  const [checkpoints, setCheckpoints] = useState<CheckpointMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<CheckpointDetails | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);

  const query = `harness=${encodeURIComponent(harness)}`;

  const loadCheckpoints = useCallback(async () => {
    const response = await fetch(`/api/checkpoints?${query}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    }).catch(() => null);
    setLoading(false);
    if (!response) {
      setError('Checkpoints could not be loaded.');
      return;
    }
    if (!response.ok) {
      setError(await responseError(response, 'Checkpoints could not be loaded.'));
      return;
    }
    setCheckpoints(await response.json() as CheckpointMeta[]);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadInitialCheckpoints() {
      const response = await fetch(`/api/checkpoints?${query}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      }).catch(() => null);
      if (controller.signal.aborted) return;
      setLoading(false);
      if (!response) {
        setError('Checkpoints could not be loaded.');
        return;
      }
      if (!response.ok) {
        setError(await responseError(response, 'Checkpoints could not be loaded.'));
        return;
      }
      setCheckpoints(await response.json() as CheckpointMeta[]);
    }
    void loadInitialCheckpoints();
    return () => controller.abort();
  }, [query]);

  async function saveCheckpoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!label.trim() || saving) return;
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/checkpoints?${query}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: label.trim() }),
    }).catch(() => null);
    setSaving(false);
    if (!response) {
      setError('The checkpoint could not reach the server.');
      return;
    }
    if (!response.ok) {
      setError(await responseError(response, 'The checkpoint could not be saved.'));
      return;
    }
    const checkpoint = await response.json() as CheckpointMeta;
    setCheckpoints((current) => [checkpoint, ...current]);
    setLabel('');
    setSelectedId(checkpoint.id);
    setDetails({ ...checkpoint, countDiff: {
      enclosures: 0,
      connectors: 0,
      mergePoints: 0,
      paths: 0,
      signals: 0,
    } });
  }

  async function selectCheckpoint(id: string) {
    setSelectedId(id);
    setDetails(null);
    setConfirmingRestore(false);
    setDetailLoading(true);
    setError(null);
    const response = await fetch(`/api/checkpoints/${encodeURIComponent(id)}?${query}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    }).catch(() => null);
    setDetailLoading(false);
    if (!response) {
      setError('Checkpoint details could not be loaded.');
      return;
    }
    if (!response.ok) {
      setError(await responseError(response, 'Checkpoint details could not be loaded.'));
      return;
    }
    setDetails(await response.json() as CheckpointDetails);
  }

  async function restoreCheckpoint() {
    if (!selectedId || !details || restoring) return;
    setRestoring(true);
    setError(null);
    const response = await fetch(
      `/api/checkpoints/${encodeURIComponent(selectedId)}/restore?${query}`,
      {
        method: 'POST',
        credentials: 'same-origin',
      },
    ).catch(() => null);
    setRestoring(false);
    if (!response) {
      setError('The restore request could not reach the server.');
      return;
    }
    if (!response.ok) {
      setError(await responseError(response, 'The checkpoint could not be restored.'));
      return;
    }
    const result = await response.json() as RestoreResult;
    const automaticCheckpoint = result.automaticCheckpoint;
    setCheckpoints((current) => [
      automaticCheckpoint,
      ...current.filter((checkpoint) => checkpoint.id !== automaticCheckpoint.id),
    ]);
    setHighlightedId(automaticCheckpoint.id);
    setRestoreNotice(
      `"${result.restored.label}" was restored. The previous state is highlighted at the top so you can undo this restore.`,
    );
    setSelectedId(null);
    setDetails(null);
    setConfirmingRestore(false);
  }

  return (
    <ModalShell title="Checkpoints" onClose={onClose} widthClassName="w-[760px]">
      <div className="grid min-h-[420px] gap-4 md:grid-cols-[1.2fr_0.8fr]">
        <div className="min-w-0 space-y-3">
          {isEditor && (
            <form onSubmit={saveCheckpoint} className="flex gap-2">
              <input
                type="text"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Checkpoint label"
                className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-amber-500"
              />
              <button
                type="submit"
                disabled={saving || !label.trim()}
                className="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save checkpoint'}
              </button>
            </form>
          )}

          {!isEditor && (
            <p className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-500">
              Checkpoints are viewable in read-only mode. Log in as an editor to create or restore one.
            </p>
          )}

          {restoreNotice && (
            <p className="rounded border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs leading-relaxed text-amber-300">
              {restoreNotice}
            </p>
          )}

          {error && (
            <p role="alert" className="rounded border border-red-900/70 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-300">Saved checkpoints</h3>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setError(null);
                void loadCheckpoints();
              }}
              className="text-xs text-zinc-500 hover:text-zinc-200"
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <p className="py-8 text-center text-xs text-zinc-500">Loading checkpoints…</p>
          ) : checkpoints.length === 0 ? (
            <p className="rounded border border-dashed border-zinc-800 py-8 text-center text-xs text-zinc-500">
              No checkpoints saved yet.
            </p>
          ) : (
            <div className="space-y-2">
              {checkpoints.map((checkpoint) => {
                const daily = isDaily(checkpoint);
                const automatic = isAutomatic(checkpoint);
                return (
                  <button
                    key={checkpoint.id}
                    type="button"
                    onClick={() => void selectCheckpoint(checkpoint.id)}
                    className={`block w-full rounded border px-3 py-2.5 text-left transition-colors ${
                      selectedId === checkpoint.id
                        ? 'border-amber-500 bg-amber-950/20'
                        : highlightedId === checkpoint.id
                          ? 'border-amber-700/70 bg-amber-950/30'
                          : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700 hover:bg-zinc-800/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 truncate text-xs font-medium text-zinc-100">
                        {checkpoint.label}
                      </span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${
                        daily
                          ? 'bg-sky-950 text-sky-400'
                          : automatic
                            ? 'bg-amber-950 text-amber-400'
                            : 'bg-zinc-800 text-zinc-500'
                      }`}>
                        {daily ? 'Daily' : automatic ? 'Automatic' : 'Named'}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[10px] text-zinc-500">
                      {daily ? `Edited by ${contributorNames(checkpoint)}` : checkpoint.createdBy.displayName}
                      {' · '}{relativeTime(checkpoint.createdAt)} · rev {checkpoint.rev}
                    </p>
                    <p className="mt-1 truncate text-[10px] text-zinc-600">
                      {countsSummary(checkpoint.counts)}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <aside className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
          {!selectedId ? (
            <div className="flex h-full min-h-48 items-center justify-center text-center text-xs text-zinc-600">
              Select a checkpoint to see how it differs from the current harness.
            </div>
          ) : detailLoading ? (
            <p className="py-8 text-center text-xs text-zinc-500">Loading details…</p>
          ) : details ? (
            <div>
              <div className="flex items-center gap-2">
                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-100">
                  {details.label}
                </h3>
                {isDaily(details) ? (
                  <span className="rounded bg-sky-950 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-sky-400">
                    Daily
                  </span>
                ) : isAutomatic(details) && (
                  <span className="rounded bg-amber-950 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-amber-400">
                    Automatic
                  </span>
                )}
              </div>
              <p className="mt-1 text-[10px] text-zinc-500">
                {isDaily(details)
                  ? `Edited by ${contributorNames(details)} · ${relativeTime(details.createdAt)}`
                  : `Saved by ${details.createdBy.displayName} ${relativeTime(details.createdAt)}`}
              </p>

              <h4 className="mt-5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Difference versus current
              </h4>
              <div className="mt-2 space-y-1.5">
                {COUNT_LABELS.map(([key, text]) => {
                  const difference = details.countDiff[key];
                  return (
                    <div key={key} className="flex items-center justify-between text-xs">
                      <span className="capitalize text-zinc-400">{text}</span>
                      <span className={difference === 0
                        ? 'text-zinc-600'
                        : difference > 0 ? 'text-emerald-400' : 'text-red-400'}
                      >
                        {difference > 0 ? `+${difference}` : difference}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
                Positive counts will be added by the restore; negative counts will be removed.
              </p>

              {isEditor && !confirmingRestore && (
                <button
                  type="button"
                  onClick={() => setConfirmingRestore(true)}
                  className="mt-5 w-full rounded border border-amber-700 bg-amber-950/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-950/60"
                >
                  Restore this checkpoint
                </button>
              )}

              {isEditor && confirmingRestore && (
                <div className="mt-5 rounded border border-amber-700/70 bg-amber-950/30 p-3">
                  <p className="text-xs font-medium text-amber-300">Restore this checkpoint?</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">
                    The current harness state will be replaced by this checkpoint. A checkpoint of the current state is saved automatically first, so this restore can itself be undone.
                  </p>
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmingRestore(false)}
                      className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void restoreCheckpoint()}
                      disabled={restoring}
                      className="rounded bg-amber-500 px-2.5 py-1 text-xs font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
                    >
                      {restoring ? 'Restoring…' : 'Restore and save current first'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </aside>
      </div>
    </ModalShell>
  );
}
