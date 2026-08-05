import { useHarnessStore } from '../../store';

const STATUS_DETAILS = {
  live: {
    label: 'Live',
    title: 'Live updates connected',
    dot: 'bg-emerald-400',
    text: 'text-emerald-400/80',
  },
  polling: {
    label: 'Polling',
    title: 'Live updates unavailable — checking every 20s',
    dot: 'bg-amber-400',
    text: 'text-amber-400',
  },
  offline: {
    label: 'Offline',
    title: "Not syncing — your changes aren't reaching the server",
    dot: 'bg-red-500',
    text: 'text-red-400',
  },
} as const;

export function SyncStatus() {
  const collabAvailable = useHarnessStore((state) => state.collabAvailable);
  const syncStatus = useHarnessStore((state) => state.syncStatus);

  if (!collabAvailable) return null;

  const details = STATUS_DETAILS[syncStatus];
  return (
    <span
      className={`flex items-center gap-1.5 text-[10px] ${details.text}`}
      title={details.title}
      aria-label={details.title}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${details.dot}`} aria-hidden="true" />
      {details.label}
    </span>
  );
}
