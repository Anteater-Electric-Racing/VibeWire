import { useEffect, useMemo, useRef, type FocusEvent, type ReactNode } from 'react';
import { peerLocationLabel } from '../../lib/collaborationPresence';
import { usePeersForEntity, useSystemStore } from '../../store';
import type {
  AttributionEntry,
  PeerPresence,
  PresenceTarget,
  PresenceTargetKind,
} from '../../types/collab';

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

function useLocationNames() {
  const system = useSystemStore((state) => state.system);
  const subsystems = useSystemStore((state) => state.subsystems);
  return useMemo(() => ({
    enclosureNames: Object.fromEntries(
      (system?.hierarchy ?? []).map((entity) => [entity.id, entity.name]),
    ),
    subsystemNames: Object.fromEntries(
      Object.values(subsystems).map((subsystem) => [subsystem.id, subsystem.name]),
    ),
  }), [subsystems, system]);
}

function peerDescription(peer: PeerPresence, names: ReturnType<typeof useLocationNames>): string {
  const location = peerLocationLabel(peer, names);
  return `${peer.displayName} — ${location}${peer.editing ? ' — editing' : ''}`;
}

export function PresenceBadge({
  kind,
  id,
  className = '',
}: {
  kind: PresenceTargetKind;
  id: string;
  className?: string;
}) {
  const peers = usePeersForEntity(kind, id);
  const names = useLocationNames();
  if (peers.length === 0) return null;

  const descriptions = peers.map((peer) => peerDescription(peer, names));
  return (
    <span
      className={`inline-flex items-center -space-x-1 ${className}`}
      title={descriptions.join('\n')}
      aria-label={descriptions.join('; ')}
    >
      {peers.slice(0, 3).map((peer) => {
        const editing = peer.editing?.kind === kind && peer.editing.id === id;
        return (
          <span
            key={peer.sessionId}
            className={`relative flex h-4 w-4 items-center justify-center rounded-full border border-zinc-950 text-[7px] font-bold text-white shadow ${
              editing ? 'animate-pulse ring-1 ring-white/80' : ''
            }`}
            style={{ backgroundColor: peer.color }}
            aria-hidden="true"
          >
            {initials(peer.displayName)}
          </span>
        );
      })}
      {peers.length > 3 && (
        <span
          className="relative flex h-4 min-w-4 items-center justify-center rounded-full border border-zinc-950 bg-zinc-700 px-0.5 text-[7px] text-zinc-100"
          aria-hidden="true"
        >
          +{peers.length - 3}
        </span>
      )}
    </span>
  );
}

export function PresenceStack() {
  const peerRecord = useSystemStore((state) => state.peers);
  const peers = useMemo(() => Object.values(peerRecord), [peerRecord]);
  const names = useLocationNames();
  if (peers.length === 0) return null;

  const shown = peers.slice(0, 3);
  const overflow = peers.slice(3);
  return (
    <div className="flex min-w-0 shrink items-center gap-1" aria-label="People on this system">
      {shown.map((peer) => {
        const location = peerLocationLabel(peer, names);
        return (
          <span
            key={peer.sessionId}
            className={`flex min-w-0 max-w-36 items-center gap-1 rounded-full border border-zinc-700 bg-zinc-950/60 px-1.5 py-0.5 text-[9px] text-zinc-300 ${
              peer.editing ? 'ring-1 ring-white/25' : ''
            }`}
            title={peerDescription(peer, names)}
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${peer.editing ? 'animate-pulse' : ''}`}
              style={{ backgroundColor: peer.color }}
              aria-hidden="true"
            />
            <span className="truncate">{peer.displayName}</span>
            <span className="shrink-0 text-zinc-500">· {location}</span>
          </span>
        );
      })}
      {overflow.length > 0 && (
        <span
          tabIndex={0}
          className="rounded-full border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-300"
          title={overflow.map((peer) => peerDescription(peer, names)).join('\n')}
          aria-label={`${overflow.length} more people: ${overflow
            .map((peer) => peerDescription(peer, names))
            .join('; ')}`}
        >
          +{overflow.length}
        </span>
      )}
    </div>
  );
}

function fieldName(element: HTMLElement): string {
  return element.dataset.presenceField
    ?? element.getAttribute('name')
    ?? element.getAttribute('aria-label')
    ?? element.getAttribute('placeholder')
    ?? 'property';
}

function isEditableControl(element: HTMLElement): boolean {
  return element.matches('input:not([readonly]), textarea:not([readonly]), select, [contenteditable="true"]')
    && !element.matches(':disabled');
}

export function PresenceEditingRegion({
  target,
  children,
  className,
}: {
  target: PresenceTarget;
  children: ReactNode;
  className?: string;
}) {
  const publishPresence = useSystemStore((state) => state.publishPresence);
  const activeRef = useRef<PresenceTarget | null>(null);

  useEffect(() => () => {
    if (activeRef.current) {
      activeRef.current = null;
      publishPresence({ editing: null });
    }
  }, [publishPresence, target.kind, target.id]);

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const element = event.target as HTMLElement;
    if (!isEditableControl(element)) return;
    const editing = { ...target, field: fieldName(element) };
    activeRef.current = editing;
    publishPresence({ editing });
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const element = event.target as HTMLElement;
    if (!isEditableControl(element) || !activeRef.current) return;
    activeRef.current = null;
    publishPresence({ editing: null });
  };

  return (
    <div className={className} onFocusCapture={onFocus} onBlurCapture={onBlur}>
      {children}
    </div>
  );
}

function formatSavedTime(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return iso;
  const elapsed = Date.now() - timestamp;
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(elapsed) < 60_000) return formatter.format(-Math.round(elapsed / 1_000), 'second');
  if (Math.abs(elapsed) < 3_600_000) return formatter.format(-Math.round(elapsed / 60_000), 'minute');
  if (Math.abs(elapsed) < 86_400_000) return formatter.format(-Math.round(elapsed / 3_600_000), 'hour');
  if (Math.abs(elapsed) < 7 * 86_400_000) return formatter.format(-Math.round(elapsed / 86_400_000), 'day');
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    .format(timestamp);
}

export function AttributionDisplay({ entry }: { entry: AttributionEntry | null }) {
  if (!entry) return null;
  const exact = new Date(entry.at).toLocaleString();
  return (
    <div
      className="border-t border-zinc-800 px-2 py-1.5 text-[9px] text-zinc-500"
      title={`${exact} · revision ${entry.rev}`}
    >
      Last saved by <span className="text-zinc-300">{entry.by.displayName}</span>
      {' · '}
      <time dateTime={entry.at}>{formatSavedTime(entry.at)}</time>
    </div>
  );
}
